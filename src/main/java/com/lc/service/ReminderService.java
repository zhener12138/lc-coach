package com.lc.service;

import com.lc.model.Problem;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * 每日提醒：到点把「今天该做哪几道题」写进 notify 表。
 *
 * 设计取舍：
 * - 不用第三方推送（要 token、要公网），就用站内信 + 前端轮询。
 *   打开页面就能看到红点，不需要配置任何外部服务，离线可用。
 * - 定时任务每 60 秒扫一次，而不是精确到 08:00 触发。
 *   原因：应用随时可能重启，精确 cron 会漏掉当天已经过去的时刻；
 *   每分钟"补课"式检查能保证重启后也能补发当天提醒。
 * - 用 (day_date, kind) 做幂等键，同一天同一类提醒只发一次。
 */
@Service
public class ReminderService {

    @Autowired private Db db;
    @Autowired private PlanService plan;
    @Autowired private ProblemStore store;

    /** 默认每天早上 8:00，可在账号页改 */
    private static final String DEFAULT_TIME = "08:00";

    @PostConstruct
    public void init() {
        db.exec("CREATE TABLE IF NOT EXISTS notify(" +
            "  id BIGINT AUTO_INCREMENT PRIMARY KEY," +
            "  day_date DATE," +
            "  kind VARCHAR(32)," +
            "  title VARCHAR(256)," +
            "  body VARCHAR(2048)," +
            "  slug VARCHAR(128)," +
            "  read_at TIMESTAMP," +
            "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    }

    public boolean enabled() {
        return !"false".equalsIgnoreCase(db.getSetting("remind.enabled"));
    }

    public String remindTime() {
        String t = db.getSetting("remind.time");
        return (t == null || t.isBlank()) ? DEFAULT_TIME : t;
    }

    /**
     * 每 60 秒检查一次：到点且今天还没发过，就发。
     *
     * 幂等的关键：必须按「今天到底该发哪一类」去查，不能只查 daily。
     * 早期这里写死 alreadySent(today, "daily")，但预览期实际插入的是 kind="preview"，
     * 于是每分钟都判定「daily 还没发过」→ 又插一条 preview，一天下来堆了上百条重复提醒。
     */
    @Scheduled(fixedDelay = 60_000, initialDelay = 15_000)
    public void tick() {
        if (!enabled()) return;

        LocalDate today = LocalDate.now();
        LocalTime now = LocalTime.now();
        LocalTime target;
        try {
            target = LocalTime.parse(remindTime(), DateTimeFormatter.ofPattern("H:mm"));
        } catch (Exception e) {
            target = LocalTime.parse(DEFAULT_TIME);
        }
        if (now.isBefore(target)) return;

        // 先算出今天该发哪一类，再拿这一类去查重
        String kind = plan.today().get("preview") != null
                      && Boolean.TRUE.equals(plan.today().get("preview")) ? "preview" : "daily";
        if (alreadySent(today, kind)) return;

        pushDaily(today);
    }

    /** 手动触发一次（账号页「立即试一下」按钮走这个） */
    public Map<String, Object> pushNow() {
        LocalDate today = LocalDate.now();
        pushDaily(today);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ok", true);
        r.put("date", today.toString());
        r.put("count", unreadCount());
        return r;
    }

    private void pushDaily(LocalDate date) {
        Map<String, Object> t = plan.today();

        // 还没到计划开始日：只发一条开跑预告，不要把 Day 1 的任务当成「今天的」
        // 否则 11-01 和 11-02 会推同一套题，用户会以为系统算错了
        if (Boolean.TRUE.equals(t.get("preview"))) {
            Object days = t.get("daysToStart");
            long n = (days instanceof Number) ? ((Number) days).longValue() : 0;
            String body = "计划 " + t.get("startDate") + " 开跑，还有 " + n + " 天。\n"
                + "第一天是：" + t.getOrDefault("tag", "") + "，先热身一下也行。";
            insert(date, "preview", "距离开跑还有 " + n + " 天", body, null);
            return;
        }

        @SuppressWarnings("unchecked")
        List<String> slugs = (List<String>) t.getOrDefault("slugs", List.of());

        StringBuilder body = new StringBuilder();
        if (slugs.isEmpty()) {
            body.append("今天是复盘日，把错题本过一遍就行。");
        } else {
            body.append("今天 ").append(slugs.size()).append(" 道题：\n");
            int i = 1;
            for (String s : slugs) {
                body.append(i++).append(". ").append(titleOf(s)).append("\n");
            }
            body.append("\n每道题先自己卡 20 分钟，再看解法。");
        }

        String title = "Day " + t.get("dayNo") + " · " + t.getOrDefault("tag", "今日任务");
        insert(date, "daily", title, body.toString().trim(), slugs.isEmpty() ? null : slugs.get(0));
    }

    private String titleOf(String slug) {
        Problem p = store.get(slug);
        return p == null ? slug : p.displayTitle();
    }

    private boolean alreadySent(LocalDate date, String kind) {
        return db.queryLong(
            "SELECT COUNT(*) FROM notify WHERE day_date = ? AND kind = ?",
            java.sql.Date.valueOf(date), kind) > 0;
    }

    private void insert(LocalDate date, String kind, String title, String body, String slug) {
        // 幂等的最后一道锁：同一天同一类只允许有一行。
        // 定时任务走这里不会重复；「立即试一下」也走这里，于是重复点击只会把旧那条重新标成未读，
        // 而不是越点越多 —— 早期没有这道检查，一天堆过上百条重复。
        int n = db.update(
            "UPDATE notify SET title = ?, body = ?, slug = ?, read_at = NULL WHERE day_date = ? AND kind = ?",
            title, body, slug, java.sql.Date.valueOf(date), kind);
        if (n > 0) return;
        db.update("INSERT INTO notify(day_date, kind, title, body, slug) VALUES (?,?,?,?,?)",
            java.sql.Date.valueOf(date), kind, title, body, slug);
    }

    public List<Map<String, Object>> list(int limit) {
        List<Map<String, Object>> out = new ArrayList<>();
        String sql = "SELECT id, day_date, kind, title, body, slug, read_at, created_at " +
                     "FROM notify ORDER BY id DESC LIMIT " + Math.max(1, Math.min(limit, 200));
        db.each(sql, rs -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rs.getLong("id"));
            m.put("date", String.valueOf(rs.getDate("day_date")));
            m.put("kind", rs.getString("kind"));
            m.put("title", rs.getString("title"));
            m.put("body", rs.getString("body"));
            m.put("slug", rs.getString("slug"));
            Object readAt = rs.getTimestamp("read_at");
            m.put("read", readAt != null);
            m.put("createdAt", String.valueOf(rs.getTimestamp("created_at")));
            out.add(m);
        });
        return out;
    }

    public int unreadCount() {
        return (int) db.queryLong("SELECT COUNT(*) FROM notify WHERE read_at IS NULL");
    }

    public void markRead(long id) {
        db.update("UPDATE notify SET read_at = ? WHERE id = ? AND read_at IS NULL",
            LocalDateTime.now(), id);
    }

    public void markAllRead() {
        db.update("UPDATE notify SET read_at = ? WHERE read_at IS NULL", LocalDateTime.now());
    }
}
