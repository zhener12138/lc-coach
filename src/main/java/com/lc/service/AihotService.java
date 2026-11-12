package com.lc.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * AIHOT（aihot.news）接入层。
 *
 * 这个类存在的唯一理由是：**不能把上游当成随便能打的接口**。
 * AIHOT 的响应头写得很清楚 —— Cache-Control: public, must-revalidate, max-age=60, s-maxage=60。
 * 翻译成人话：同一个 URL 一分钟内重复请求，对上游毫无价值，只会消耗你自己的配额。
 * 单 IP 大约 60 次/分钟就 429。
 *
 * 所以这里的每条请求都要过三道闸：
 *   1. 本地缓存还在新鲜期（60 秒内）→ 直接返回，一个字节都不发出去
 *   2. 过了新鲜期 → 带上 If-None-Match 去问，没变就 304 空 body，只刷新时间戳
 *   3. 被 429 打了 → 按 Retry-After 记住冷却到什么时候，冷却期内直接用缓存
 *
 * 另外每把 key 一把锁，防止两个请求同时发现缓存过期、同时打上游（single-flight）。
 * 这类「同一份数据的并发回源」如果不管，高峰期就是自己把自己限流。
 */
@Service
public class AihotService {

    private static final String BASE = "https://aihot.news";
    private static final ObjectMapper M = new ObjectMapper();
    private static final ZoneId SH = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter HHMM = DateTimeFormatter.ofPattern("HH:mm").withZone(SH);

    /** 上游要求的最小间隔，低于这个值重复请求就是纯浪费 */
    private static final long MIN_FRESH_MS = 60_000L;
    /** 429 兜底冷却时长，防止上游没给 Retry-After 时我们立刻又撞上去 */
    private static final long DEFAULT_COOL_MS = 90_000L;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    /** 每个上游路径一份缓存 */
    private static class Entry {
        volatile String etag;
        volatile JsonNode body;
        volatile long fetchedAt;
    }

    private final Map<String, Entry> cache = new ConcurrentHashMap<>();
    private final Map<String, ReentrantLock> locks = new ConcurrentHashMap<>();
    /** 被 429 之后，这个 key 到什么时候为止不要再打上游 */
    private final Map<String, Long> cooldownUntil = new ConcurrentHashMap<>();

    public record Result(JsonNode body, boolean fromCache, boolean notModified, String fetchedAt, String error) {
    }

    // ---------------- 对外入口 ----------------

    /** 精选资讯（mode=selected 才是编辑挑过的，all 是全量原始流） */
    public Result items(String mode, int limit, String cursor, String category) {
        StringBuilder u = new StringBuilder("/api/v1/items?mode=")
                .append(enc(mode == null || mode.isBlank() ? "selected" : mode))
                .append("&limit=").append(Math.max(1, Math.min(100, limit)));
        if (cursor != null && !cursor.isBlank()) u.append("&cursor=").append(enc(cursor));
        if (category != null && !category.isBlank()) u.append("&category=").append(enc(category));
        return fetch(u.toString());
    }

    /** 当前 Top10 热点 */
    public Result hotTopics() {
        return fetch("/api/v1/hot-topics");
    }

    /** 最新一份日报 */
    public Result dailyLatest() {
        return fetch("/api/v1/dailies/latest");
    }

    /** 指定日期的日报，date 形如 2026-11-01 */
    public Result daily(String date) {
        if (date == null || !date.matches("\\d{4}-\\d{2}-\\d{2}")) {
            return new Result(null, false, false, null, "日期格式要像 2026-11-01");
        }
        return fetch("/api/v1/dailies/" + date);
    }

    /** 最新周刊 / 月报 */
    public Result weeklyLatest() {
        return fetch("/api/v1/weeklies/latest");
    }

    public Result monthlyLatest() {
        return fetch("/api/v1/monthlies/latest");
    }


    // ---------------- 核心：带缓存的取数 ----------------

    private Result fetch(String path) {
        Entry e = cache.computeIfAbsent(path, k -> new Entry());
        long now = System.currentTimeMillis();

        // 闸 1：新鲜期内直接返回，不发请求
        if (e.body != null && now - e.fetchedAt < MIN_FRESH_MS) {
            return new Result(e.body, true, false, HHMM.format(Instant.ofEpochMilli(e.fetchedAt)), null);
        }

        // 闸 3：冷却期内也不要打上游（宁可给旧数据，也不去撞 429）
        Long cool = cooldownUntil.get(path);
        if (cool != null && now < cool) {
            if (e.body != null) {
                return new Result(e.body, true, false, HHMM.format(Instant.ofEpochMilli(e.fetchedAt)),
                        "上游限流中，先看 " + HHMM.format(Instant.ofEpochMilli(cool)) + " 之后的数据");
            }
            return new Result(null, false, false, null,
                    "上游限流中，" + HHMM.format(Instant.ofEpochMilli(cool)) + " 之后再试");
        }

        ReentrantLock lock = locks.computeIfAbsent(path, k -> new ReentrantLock());
        lock.lock();
        try {
            // 双重检查：等锁期间别人可能已经刷新过了
            now = System.currentTimeMillis();
            if (e.body != null && now - e.fetchedAt < MIN_FRESH_MS) {
                return new Result(e.body, true, false, HHMM.format(Instant.ofEpochMilli(e.fetchedAt)), null);
            }

            HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(BASE + path))
                    .header("User-Agent", "lc-coach/1.0 (personal use)")
                    .header("Accept", "application/json")
                    .timeout(Duration.ofSeconds(20))
                    .GET();
            // 闸 2：有 etag 就带上，让上游有机会直接回 304
            if (e.etag != null) rb.header("If-None-Match", e.etag);

            HttpResponse<String> res = http.send(rb.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            int sc = res.statusCode();

            if (sc == 304) {
                // 没变。这是最好情况：零 body 传输，只刷新新鲜度
                e.fetchedAt = System.currentTimeMillis();
                return new Result(e.body, true, true, HHMM.format(Instant.ofEpochMilli(e.fetchedAt)), null);
            }

            if (sc == 429) {
                long waitMs = parseRetryAfter(res.headers().firstValue("Retry-After").orElse(null));
                cooldownUntil.put(path, System.currentTimeMillis() + waitMs);
                if (e.body != null) {
                    return new Result(e.body, true, false, HHMM.format(Instant.ofEpochMilli(e.fetchedAt)),
                            "上游限流，先给你看缓存的数据");
                }
                return new Result(null, false, false, null,
                        "上游限流了，" + (waitMs / 1000) + " 秒后再试");
            }

            if (sc != 200) {
                if (e.body != null) {
                    return new Result(e.body, true, false, HHMM.format(Instant.ofEpochMilli(e.fetchedAt)),
                            "上游返回 HTTP " + sc + "，先给你看缓存的数据");
                }
                return new Result(null, false, false, null, "上游返回 HTTP " + sc);
            }

            JsonNode node = M.readTree(res.body());
            e.body = node;
            e.etag = res.headers().firstValue("ETag").orElse(null);
            e.fetchedAt = System.currentTimeMillis();
            cooldownUntil.remove(path);
            return new Result(node, false, false, HHMM.format(Instant.ofEpochMilli(e.fetchedAt)), null);

        } catch (Exception ex) {
            // 网络炸了就把能给的给出去，别让页面整块空着
            if (e.body != null) {
                return new Result(e.body, true, false, HHMM.format(Instant.ofEpochMilli(e.fetchedAt)),
                        "连不上上游（" + ex.getClass().getSimpleName() + "），先给你看缓存的数据");
            }
            return new Result(null, false, false, null, "连不上 AIHOT：" + ex.getMessage());
        } finally {
            lock.unlock();
        }
    }

    /** Retry-After 可能是秒数，也可能是 HTTP 日期。两种都要认。 */
    private long parseRetryAfter(String v) {
        if (v == null || v.isBlank()) return DEFAULT_COOL_MS;
        try {
            long sec = Long.parseLong(v.trim());
            return Math.max(1, sec) * 1000L;
        } catch (NumberFormatException ignore) {
            try {
                var t = java.time.ZonedDateTime.parse(v.trim(), DateTimeFormatter.RFC_1123_DATE_TIME);
                long ms = t.toInstant().toEpochMilli() - System.currentTimeMillis();
                return ms > 0 ? ms : DEFAULT_COOL_MS;
            } catch (Exception ignore2) {
                return DEFAULT_COOL_MS;
            }
        }
    }

    private static String enc(String s) {
        return java.net.URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    /** 给前端一个「数据是从哪来的、新不新鲜」的说明，不藏起来 */
    public Map<String, Object> meta(Result r) {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("fromCache", r.fromCache());
        m.put("notModified", r.notModified());
        m.put("fetchedAt", r.fetchedAt());
        m.put("source", "AIHOT");
        m.put("sourceUrl", "https://aihot.news");
        if (r.error() != null) m.put("note", r.error());
        return m;
    }
}
