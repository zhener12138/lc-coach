package com.lc.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;

/**
 * 力扣中国站 GraphQL 客户端。
 * 只用公开 GraphQL 接口 + 用户自己提供的 Cookie，不做任何登录模拟。
 */
@Service
public class LeetCodeService {

    private static final String ENDPOINT = "https://leetcode.cn/graphql/";
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();
    private final ObjectMapper om = new ObjectMapper();

    private JsonNode post(String query, Map<String, Object> vars, String cookie) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("query", query);
        body.put("variables", vars == null ? Map.of() : vars);

        HttpRequest.Builder b = HttpRequest.newBuilder()
                .uri(URI.create(ENDPOINT))
                .timeout(Duration.ofSeconds(25))
                .header("Content-Type", "application/json")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")
                .header("Referer", "https://leetcode.cn/problemset/")
                .header("Origin", "https://leetcode.cn")
                .POST(HttpRequest.BodyPublishers.ofString(om.writeValueAsString(body)));
        if (cookie != null && !cookie.isBlank()) b.header("Cookie", cookie);

        HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 200) {
            throw new RuntimeException("力扣返回 HTTP " + r.statusCode());
        }
        JsonNode root = om.readTree(r.body());
        if (root.has("errors") && root.get("errors").size() > 0) {
            throw new RuntimeException("力扣 GraphQL 错误: " + root.get("errors").get(0).get("message").asText());
        }
        return root.get("data");
    }

    /** 校验 Cookie 是否有效，返回用户名 */
    public String checkCookie(String cookie) throws Exception {
        JsonNode d = post("query { userStatus { isSignedIn username userSlug } }", Map.of(), cookie);
        JsonNode st = d.get("userStatus");
        if (st == null || !st.path("isSignedIn").asBoolean(false)) return null;
        String name = st.path("username").asText("");
        if (name.isBlank()) name = st.path("userSlug").asText("");
        return name.isBlank() ? "(已登录)" : name;
    }

    /**
     * 同步已解决的题。
     *
     * 踩过的坑（2026-11-01 实测）：
     * 1) userProgressQuestionList.questions 的类型是 UserProgressQuestionNode，
     *    它没有 status 字段（写了会 HTTP 400 / GraphQL error），判断是否通过要用 lastResult。
     *    而且这个接口一次只吐 10 条，跟 totalNum 对不上，不能当主力。
     * 2) problemsetQuestionList 的正确过滤方式是 filters:{status:"AC"}，
     *    比扫全库 4000 题快一个数量级。注意 status 是 QuestionLightNode 上真实存在的字段。
     */
    public Map<String, String[]> fetchSolved(String cookie) throws Exception {
        Map<String, String[]> solved = new LinkedHashMap<>();

        // 主力：直接用 status:AC 过滤，一次拿到全部已通过题目
        try {
            int skip = 0, limit = 100, total = Integer.MAX_VALUE;
            while (skip < total && skip < 4000) {
                JsonNode d = post("query p($skip:Int,$limit:Int,$f:QuestionListFilterInput){ "
                                + "problemsetQuestionList(skip:$skip, limit:$limit, filters:$f) { "
                                + "total questions { titleSlug title difficulty status } } }",
                        Map.of("skip", skip, "limit", limit, "f", Map.of("status", "AC")), cookie);
                JsonNode node = d.get("problemsetQuestionList");
                if (node == null) break;
                total = node.path("total").asInt(0);
                JsonNode qs = node.get("questions");
                if (qs == null || qs.isEmpty()) break;
                for (JsonNode q : qs) {
                    String st = q.path("status").asText("");
                    if ("AC".equalsIgnoreCase(st) || "SOLVED".equalsIgnoreCase(st)) {
                        solved.put(q.path("titleSlug").asText(),
                                new String[]{q.path("title").asText(), q.path("difficulty").asText()});
                    }
                }
                if (qs.size() < limit) break;
                skip += limit;
            }
        } catch (Exception ignore) {
            // 降级到下面的方式
        }

        // 兜底：用户进度列表（用 lastResult 判断，且只能拿到前 10 条）
        if (solved.isEmpty()) {
            JsonNode d = post("query { userProgressQuestionList { totalNum questions { titleSlug title difficulty lastResult } } }",
                    Map.of(), cookie);
            JsonNode list = d.get("userProgressQuestionList");
            if (list != null && list.has("questions")) {
                for (JsonNode q : list.get("questions")) {
                    String st = q.path("lastResult").asText("");
                    if ("AC".equalsIgnoreCase(st) || "SOLVED".equalsIgnoreCase(st)) {
                        solved.put(q.path("titleSlug").asText(),
                                new String[]{q.path("title").asText(), q.path("difficulty").asText()});
                    }
                }
            }
        }
        return solved;
    }

    /** 拉一道题的元信息（标题、难度、题面、标签、Java 模板） */
    public Map<String, Object> fetchQuestion(String slug) throws Exception {
        String q = "query q($titleSlug: String!) { question(titleSlug: $titleSlug) { " +
                "questionId questionFrontendId title translatedTitle titleSlug difficulty " +
                "content translatedContent " +
                "topicTags { name slug translatedName } codeSnippets { lang langSlug code } } }";
        JsonNode d = post(q, Map.of("titleSlug", slug), null);
        JsonNode qn = d.get("question");
        if (qn == null) return null;

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("frontendId", qn.path("questionFrontendId").asText(qn.path("questionId").asText()));
        m.put("titleEn", qn.path("title").asText());
        m.put("titleCn", qn.path("translatedTitle").asText(qn.path("title").asText()));
        m.put("difficulty", qn.path("difficulty").asText());
        m.put("contentHtml", qn.path("content").asText(""));
        m.put("contentCnHtml", qn.path("translatedContent").asText(""));

        List<String> tags = new ArrayList<>();
        JsonNode tt = qn.get("topicTags");
        if (tt != null) {
            for (JsonNode t : tt) {
                String cn = t.path("translatedName").asText("");
                tags.add(cn.isBlank() ? t.path("name").asText() : cn);
            }
        }
        m.put("tags", String.join(", ", tags));

        String javaTemplate = "";
        JsonNode sn = qn.get("codeSnippets");
        if (sn != null) {
            for (JsonNode s : sn) {
                if ("java".equals(s.path("langSlug").asText())) {
                    javaTemplate = s.path("code").asText("");
                    break;
                }
            }
        }
        m.put("javaTemplate", javaTemplate);
        return m;
    }

    /** 拉题目列表（用于选题器） */
    public List<Map<String, Object>> listProblems(String keyword, String difficulty, int skip, int limit) throws Exception {
        String q = "query p($skip:Int,$limit:Int,$filters:QuestionListFilterInput){" +
                " problemsetQuestionList(categorySlug:\"\", skip:$skip, limit:$limit, filters:$filters) {" +
                " total questions { titleSlug title titleCn difficulty frontendQuestionId paidOnly topicTags { name slug nameTranslated } } } }";
        Map<String, Object> filters = new LinkedHashMap<>();
        if (keyword != null && !keyword.isBlank()) filters.put("searchKeywords", keyword);
        if (difficulty != null && !difficulty.isBlank() && !"ALL".equals(difficulty)) filters.put("difficulty", difficulty);

        JsonNode d = post(q, Map.of("skip", skip, "limit", limit, "filters", filters), null);
        JsonNode node = d.get("problemsetQuestionList");
        List<Map<String, Object>> out = new ArrayList<>();
        if (node == null) return out;
        JsonNode qs = node.get("questions");
        if (qs == null) return out;
        for (JsonNode x : qs) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("slug", x.path("titleSlug").asText());
            m.put("titleEn", x.path("title").asText());
            m.put("titleCn", x.path("titleCn").asText(""));
            m.put("frontendId", x.path("frontendQuestionId").asText());
            m.put("difficulty", x.path("difficulty").asText());
            m.put("paidOnly", x.path("paidOnly").asBoolean(false));
            out.add(m);
        }
        return out;
    }
}
