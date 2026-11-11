package com.lc.api;

import com.lc.model.Problem;
import com.lc.model.Solution;
import com.lc.service.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class ApiController {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired private Db db;
    @Autowired private ProblemStore store;
    @Autowired private PlanService plan;
    @Autowired private LeetCodeService lc;
    @Autowired private ReminderService reminder;
    @Autowired private com.lc.service.CodeGrader grader;
    @Autowired private PracticeService practice;
    @Autowired private AihotService aihot;
    @Autowired private javax.servlet.http.HttpServletRequest servletRequest;

    // ---------------- 提醒 ----------------

    /** 站内信列表 + 未读数，前端每次进页面轮询一次 */
    @GetMapping("/notify")
    public Map<String, Object> notifyList(@RequestParam(defaultValue = "30") int limit) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", reminder.enabled());
        out.put("time", reminder.remindTime());
        out.put("unread", reminder.unreadCount());
        out.put("items", reminder.list(limit));
        return out;
    }

    @GetMapping("/notify/unread")
    public Map<String, Object> notifyUnread() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("unread", reminder.unreadCount());
        return out;
    }

    @PostMapping("/notify/{id}/read")
    public Map<String, Object> notifyRead(@PathVariable long id) {
        reminder.markRead(id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("unread", reminder.unreadCount());
        return out;
    }

    @PostMapping("/notify/read-all")
    public Map<String, Object> notifyReadAll() {
        reminder.markAllRead();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("unread", 0);
        return out;
    }

    /** 账号页「立即试一下」，不用等到设定时间 */
    @PostMapping("/notify/push")
    public Map<String, Object> notifyPush() {
        return reminder.pushNow();
    }

    /** 开关与提醒时间，时间格式 H:mm（如 8:00 / 21:30） */
    @PostMapping("/notify/setting")
    public Map<String, Object> notifySetting(@RequestBody Map<String, Object> body) {
        Object enabled = body.get("enabled");
        Object time = body.get("time");
        if (enabled != null) db.setSetting("remind.enabled", String.valueOf(enabled));
        if (time != null && !String.valueOf(time).isBlank()) {
            db.setSetting("remind.time", String.valueOf(time).trim());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("enabled", reminder.enabled());
        out.put("time", reminder.remindTime());
        return out;
    }

    // ---------------- 今日任务 ----------------

    /**
     * 今日任务。带 ?day=N 就返回第 N 天的安排（用于日历卡上的前一天/后一天）。
     *
     * day 只决定「看哪天」，打卡接口仍然记在真实今天 ——
     * 让浏览历史能改掉打卡日期，等于让进度条可以随便骗自己。
     */
    @GetMapping("/today")
    public Map<String, Object> today(@RequestParam(value = "day", required = false) Integer day) {
        Map<String, Object> t = plan.dayAt(day);
        Map<String, String[]> progress = db.allProgress();

        @SuppressWarnings("unchecked")
        List<String> slugs = (List<String>) t.getOrDefault("slugs", List.of());

        List<Map<String, Object>> items = new ArrayList<>();
        int done = 0;
        for (String s : slugs) {
            Problem p = store.get(s);
            Map<String, Object> it = new LinkedHashMap<>();
            it.put("slug", s);
            if (p != null) {
                it.put("title", p.displayTitle());
                it.put("titleEn", p.titleEn);
                it.put("frontendId", p.frontendId);
                it.put("difficulty", p.difficulty);
                it.put("tags", p.tags);
                it.put("hasContent", true);
                it.put("solutionCount", p.solutions == null ? 0 : p.solutions.size());
            } else {
                it.put("title", s);
                it.put("hasContent", false);
                it.put("solutionCount", 0);
            }
            String[] pr = progress.get(s);
            String status = pr == null ? "todo" : pr[0];
            it.put("status", status);
            if ("done".equals(status)) done++;
            items.add(it);
        }
        t.put("items", items);
        t.put("doneCount", done);
        t.put("totalCount", slugs.size());

        // 连续打卡天数
        t.put("streak", computeStreak(progress));
        // 全站统计
        t.put("stats", stats());
        return t;
    }

    private int computeStreak(Map<String, String[]> progress) {
        Set<String> doneDates = new HashSet<>();
        for (String[] v : progress.values()) {
            if ("done".equals(v[0]) && v[1] != null) doneDates.add(v[1]);
        }
        int streak = 0;
        var d = java.time.LocalDate.now();
        if (!doneDates.contains(d.toString())) d = d.minusDays(1);
        while (doneDates.contains(d.toString())) {
            streak++;
            d = d.minusDays(1);
        }
        return streak;
    }

    private Map<String, Object> stats() {
        Map<String, String[]> pr = db.allProgress();
        long done = pr.values().stream().filter(v -> "done".equals(v[0])).count();
        List<Map<String, Object>> mistakes = db.listMistakes();
        long unmastered = mistakes.stream().filter(m -> !Boolean.TRUE.equals(m.get("mastered"))).count();
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("doneProblems", done);
        s.put("mistakes", mistakes.size());
        s.put("unmastered", unmastered);
        s.put("contentProblems", store.size());
        s.put("snippets", db.countSnippets());
        s.put("solvedSynced", db.listSolved().size());
        return s;
    }

    // ---------------- 题目 ----------------

    @GetMapping("/problem/{slug}")
    public ResponseEntity<?> problem(@PathVariable String slug) {
        Problem p = store.get(slug);
        if (p == null) {
            return ResponseEntity.status(404).body(Map.of(
                    "error", "题库里还没有这道题的内容",
                    "slug", slug,
                    "hint", "去「题库」页面点「拉取并生成」补上"));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("slug", p.slug);
        out.put("frontendId", p.frontendId);
        out.put("titleEn", p.titleEn);
        out.put("titleCn", p.titleCn);
        out.put("title", p.displayTitle());
        out.put("difficulty", p.difficulty);
        out.put("tags", p.tags);
        out.put("contentHtml", p.contentHtml);
        out.put("contentCnHtml", p.contentCnHtml);
        out.put("solutions", p.solutions);
        Map<String, String[]> pr = db.allProgress();
        String[] st = pr.get(slug);
        out.put("status", st == null ? "todo" : st[0]);
        out.put("myNote", st == null ? "" : (st[2] == null ? "" : st[2]));
        out.put("mistake", db.listMistakes().stream()
                .filter(m -> slug.equals(m.get("problemSlug")))
                .findFirst().orElse(null));
        // 我写的代码 + 上次评分（没有就是 null，前端据此决定编辑器里放什么）
        Map<String, Object> mine = db.getMyCode(slug);
        out.put("myCode", mine == null ? null : mine.get("code"));
        out.put("myScore", mine == null ? null : mine.get("totalScore"));
        // 复习模式用：把带 mistakeId 的请求转成该错题的复习代码（独立于 my_code）。
        // query 参数 mistakeId 只在复习界面出现；看题请求不带，行为完全不变。
        String mid = servletRequest.getParameter("mistakeId");
        if (mid != null && mid.matches("\\d+")) {
            String rc = db.getReviewCode(Long.parseLong(mid));
            out.put("reviewCode", rc == null ? "" : rc);
        }
        // 参考解法也用同一套标准打分，前端好横向对比
        out.put("refGrades", grader.gradeReference(slug));
        return ResponseEntity.ok(out);
    }

    // ---------------- 代码评分 ----------------

    /**
     * 给我的代码打分。
     * 请求体 { code: "..." }；返回各维度分数、总分、编译报错。
     * 实测两项：编译（javac 真跑）+ 正确性（用例真跑）；其余五项是静态推断。
     * 判不了题的题会把正确性从加权里剔除再重新归一，不按 0 分算。
     */
    @PostMapping("/problem/{slug}/grade")
    public ResponseEntity<?> grade(@PathVariable String slug, @RequestBody Map<String, String> body) {
        String code = body.getOrDefault("code", "");
        if (code.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "先粘一段代码再评分"));
        }
        Map<String, Object> r = grader.gradeUser(slug, code);
        if (!Boolean.TRUE.equals(r.get("ok"))) {
            return ResponseEntity.badRequest().body(r);
        }
        // 存代码 + 评分快照，下次进来能回看
        try {
            String json = MAPPER.writeValueAsString(r);
            double total = ((Number) r.get("total")).doubleValue();
            db.saveMyCode(slug, code, json, total);
        } catch (Exception ignore) {
            // 存不进不该影响评分结果的返回
        }
        return ResponseEntity.ok(r);
    }

    // ---------------- 填空练习 ----------------

    /**
     * 出一道填空题：把参考解挖掉几行，只留骨架。
     *
     * <p>tier 取 brute/better/optimal（默认 optimal），level 取 easy/medium/hard（默认 easy）。
     * 返回的 template 里空位是 {@code @@HOLE:n@@}，前端换成输入框。
     *
     * <p><b>正确答案不下发。</b>连「这空该填什么」的提示都不给 —— 想看原文走题目页的解锁流程。
     */
    @GetMapping("/problem/{slug}/fill")
    public ResponseEntity<?> fill(@PathVariable String slug,
                                  @RequestParam(defaultValue = "optimal") String tier,
                                  @RequestParam(defaultValue = "easy") String level) {
        if (store.get(slug) == null) {
            return ResponseEntity.status(404).body(Map.of(
                    "error", "题库里还没有这道题的内容",
                    "slug", slug,
                    "hint", "去「题库」页面点「拉取并生成」补上"));
        }
        PracticeService.Sheet s = practice.sheet(slug, tier, level);
        if (s == null) {
            return ResponseEntity.status(404).body(Map.of(
                    "error", "这道题出不了填空题",
                    "hint", "参考解的代码里没有可挖的逻辑行"));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("slug", s.slug);
        out.put("tier", s.tier);
        out.put("tierName", s.tierName);
        out.put("level", s.level);
        out.put("template", s.template);
        out.put("totalLines", s.totalLines);
        List<Map<String, Object>> blanks = new ArrayList<>();
        for (PracticeService.Blank b : s.blanks) {
            Map<String, Object> one = new LinkedHashMap<>();
            one.put("id", b.id);
            one.put("line", b.line);
            one.put("indent", b.indent);
            one.put("shape", b.shape);
            one.put("around", b.around);
            blanks.add(one);   // 刻意不带 answer
        }
        out.put("blanks", blanks);
        out.put("levels", PracticeService.LEVELS);
        out.put("tiers", PracticeService.TIERS);
        return ResponseEntity.ok(out);
    }

    /**
     * 交卷：把填的行拼回完整代码，走真正的判题。
     *
     * <p><b>对错以「用例跑不跑得过」为准，不以「和参考解一字不差」为准。</b>
     * 写法不同但跑得通，就是学会了；照抄才算学会是反的。
     * 逐空比对只用来告诉人「这个空和参考写法不一样」，不当判分依据。
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/problem/{slug}/fill/check")
    public ResponseEntity<?> fillCheck(@PathVariable String slug, @RequestBody Map<String, Object> body) {
        String tier = body.get("tier") == null ? "optimal" : String.valueOf(body.get("tier"));
        String level = body.get("level") == null ? "easy" : String.valueOf(body.get("level"));

        Map<String, String> answers = new LinkedHashMap<>();
        Object raw = body.get("answers");
        if (raw instanceof Map) {
            for (Map.Entry<String, Object> e : ((Map<String, Object>) raw).entrySet()) {
                answers.put(e.getKey(), e.getValue() == null ? "" : String.valueOf(e.getValue()));
            }
        }

        Map<String, Object> out = new LinkedHashMap<>(practice.check(slug, tier, level, answers));
        if (!Boolean.TRUE.equals(out.get("ok"))) {
            return ResponseEntity.badRequest().body(out);
        }
        if (!Boolean.TRUE.equals(out.get("rebuilt"))) {
            // 没填完就别送去编译 —— 报「语法错」会让人以为自己写错了
            return ResponseEntity.ok(out);
        }

        String code = practice.rebuild(slug, tier, level, answers);
        if (code == null) {
            return ResponseEntity.ok(out);
        }
        Map<String, Object> g = grader.gradeUser(slug, code);
        out.put("grade", g);

        boolean passed = false;
        Object judgeObj = g.get("judge");
        if (judgeObj instanceof Map) {
            Map<String, Object> jm = (Map<String, Object>) judgeObj;
            Object total = jm.get("total");
            Object ok = jm.get("passed");
            if (total instanceof Number && ok instanceof Number) {
                passed = ((Number) total).intValue() > 0
                        && ((Number) ok).intValue() == ((Number) total).intValue();
            }
        }
        out.put("passedJudge", passed);
        return ResponseEntity.ok(out);
    }

    /** 只取上次的评分（不重新算），用于页面初始化时直接展示历史分数 */
    @GetMapping("/problem/{slug}/my-code")
    public Map<String, Object> myCode(@PathVariable String slug) {
        Map<String, Object> m = db.getMyCode(slug);
        if (m == null) return Map.of("saved", false);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("saved", true);
        out.put("code", m.get("code"));
        out.put("totalScore", m.get("totalScore"));
        out.put("updatedAt", m.get("updatedAt"));
        try {
            out.put("grade", MAPPER.readTree((String) m.get("gradeJson")));
        } catch (Exception ignore) {
            out.put("grade", null);
        }
        return out;
    }

    /** 题目列表：题库里已有的 */
    @GetMapping("/problems")
    public List<Map<String, Object>> problems() {
        Map<String, String[]> progress = db.allProgress();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Problem p : store.all()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("slug", p.slug);
            m.put("frontendId", p.frontendId);
            m.put("title", p.displayTitle());
            m.put("titleEn", p.titleEn);
            m.put("difficulty", p.difficulty);
            m.put("tags", p.tags);
            m.put("solutionCount", p.solutions == null ? 0 : p.solutions.size());
            String[] st = progress.get(p.slug);
            m.put("status", st == null ? "todo" : st[0]);
            out.add(m);
        }
        out.sort(Comparator.comparing(o -> {
            String id = String.valueOf(o.get("frontendId"));
            try { return Integer.parseInt(id); } catch (Exception e) { return 99999; }
        }));
        return out;
    }

    /** 从力扣拉题面元信息（不覆盖已有解法） */
    @PostMapping("/problem/{slug}/fetch")
    public ResponseEntity<?> fetchProblem(@PathVariable String slug) {
        try {
            Map<String, Object> meta = lc.fetchQuestion(slug);
            if (meta == null) return ResponseEntity.status(404).body(Map.of("error", "力扣上找不到这道题"));

            Problem p = store.get(slug);
            boolean isNew = (p == null);
            if (isNew) {
                p = new Problem();
                p.slug = slug;
                p.solutions = new ArrayList<>();
            }
            p.frontendId = str(meta.get("frontendId"));
            p.titleEn = str(meta.get("titleEn"));
            p.titleCn = str(meta.get("titleCn"));
            p.difficulty = str(meta.get("difficulty"));
            p.tags = str(meta.get("tags"));
            p.contentHtml = str(meta.get("contentHtml"));
            p.contentCnHtml = str(meta.get("contentCnHtml"));

            // 首次拉取时，用官方 Java 模板占位一个"暴力解法"，方便后续补全
            if (p.solutions == null) p.solutions = new ArrayList<>();
            if (p.solutions.isEmpty()) {
                Solution s = new Solution();
                s.tier = "brute";
                s.title = "待补充：暴力解法";
                s.idea = "先写出最直白的解法，哪怕超时。目的是把题意跑通。";
                s.pseudocode = "（在这里写中文伪代码）";
                s.codeJava = str(meta.get("javaTemplate"));
                s.timeComplexity = "待填";
                s.spaceComplexity = "待填";
                s.sortOrder = 1;
                p.solutions.add(s);
            }
            store.save(p);
            return ResponseEntity.ok(Map.of("ok", true, "isNew", isNew, "slug", slug,
                    "solutionCount", p.solutions.size()));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    private String str(Object o) { return o == null ? "" : String.valueOf(o); }

    /** 保存一道题（含解法），用于编辑 */
    @PostMapping("/problem/{slug}/save")
    public ResponseEntity<?> saveProblem(@PathVariable String slug, @RequestBody Problem body) {
        try {
            body.slug = slug;
            if (body.solutions == null) body.solutions = new ArrayList<>();
            for (int i = 0; i < body.solutions.size(); i++) {
                body.solutions.get(i).problemSlug = slug;
                if (body.solutions.get(i).sortOrder == 0) body.solutions.get(i).sortOrder = i + 1;
            }
            store.save(body);
            return ResponseEntity.ok(Map.of("ok", true, "solutionCount", body.solutions.size()));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    /** 力扣题目搜索（用于选题） */
    @GetMapping("/leetcode/search")
    public ResponseEntity<?> lcSearch(@RequestParam(defaultValue = "") String q,
                                      @RequestParam(defaultValue = "ALL") String difficulty,
                                      @RequestParam(defaultValue = "0") int skip,
                                      @RequestParam(defaultValue = "30") int limit) {
        try {
            List<Map<String, Object>> list = lc.listProblems(q, difficulty, skip, limit);
            for (Map<String, Object> m : list) {
                m.put("inLibrary", store.has(str(m.get("slug"))));
            }
            return ResponseEntity.ok(list);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // ---------------- 打卡 ----------------

    @PostMapping("/progress/{slug}")
    public Map<String, Object> setProgress(@PathVariable String slug, @RequestBody Map<String, String> body) {
        String status = body.getOrDefault("status", "done");
        db.markProgress(slug, status);
        return Map.of("ok", true, "slug", slug, "status", status);
    }

    @PostMapping("/progress/{slug}/note")
    public Map<String, Object> noteProgress(@PathVariable String slug, @RequestBody Map<String, String> body) {
        db.noteProgress(slug, body.getOrDefault("note", ""));
        return Map.of("ok", true);
    }

    // ---------------- 错题本 ----------------

    @GetMapping("/mistakes")
    public List<Map<String, Object>> mistakes() {
        List<Map<String, Object>> list = db.listMistakes();
        // 早先手记的错题 slug 是选填的，很多人只写题名不写 slug，
        // 于是 problem_slug 是空串，前端就画不出「看题」按钮。
        // 这里按题名反查题库补上并写回数据库 —— 只补一次，不是每次请求都白算。
        for (Map<String, Object> m : list) {
            Object slug = m.get("problemSlug");
            if (slug != null && !String.valueOf(slug).isBlank()) continue;
            String guess = store.resolveSlugByTitle(String.valueOf(m.get("problemTitle")));
            if (guess == null) continue;
            m.put("problemSlug", guess);
            m.put("slugGuessed", true);   // 前端标一句「按题名自动关联」，别让人以为是当初填的
            db.update("UPDATE mistake SET problem_slug = ? WHERE id = ?", guess, m.get("id"));
        }
        return list;
    }

    @PostMapping("/mistakes")
    public Map<String, Object> addMistake(@RequestBody Map<String, String> b) {
        // 入库时就把 slug 落实：slug 空着就先按题名反查，别让「看题」按钮再次缺失
        String slug = b.getOrDefault("problemSlug", "").trim();
        String title = b.getOrDefault("problemTitle", "");
        if (slug.isEmpty()) {
            String guess = store.resolveSlugByTitle(title);
            if (guess != null) slug = guess;
        }
        long id = db.addMistake(
                slug,
                b.getOrDefault("problemTitle", ""),
                b.getOrDefault("whereStuck", ""),
                b.getOrDefault("oneLiner", ""),
                b.getOrDefault("tag", ""));
        return Map.of("ok", true, "id", id);
    }

    @PostMapping("/mistakes/{id}/review")
    public Map<String, Object> reviewMistake(@PathVariable long id) {
        db.reviewMistake(id);
        return Map.of("ok", true);
    }

    // ---------------- 复习模式的代码（独立于看题页的 my_code） ----------------

    /** 复习时保存代码：按错题 id 隔离存储，绝不写进 my_code。请求体 { code: "..." } */
    @PostMapping("/mistakes/{id}/review-code")
    public Map<String, Object> saveReviewCode(@PathVariable long id,
                                              @RequestBody Map<String, String> body) {
        String code = body.getOrDefault("code", "");
        if (code.isBlank()) {
            return Map.of("error", "先写点代码再保存");
        }
        // 带上 slug 是为了复习记录能反查是哪道题（错题删了代码也还在，只是没了题面入口）
        Map<String, Object> mk = db.listMistakes().stream()
                .filter(m -> ((Number) m.get("id")).longValue() == id)
                .findFirst().orElse(null);
        String slug = mk == null ? null : String.valueOf(mk.get("problemSlug"));
        db.saveReviewCode(id, slug, code);
        return Map.of("ok", true);
    }

    /** 取某条错题复习时写的代码（前端进复习界面时回填）。 */
    @GetMapping("/mistakes/{id}/review-code")
    public Map<String, Object> getReviewCode(@PathVariable long id) {
        String code = db.getReviewCode(id);
        if (code == null) return Map.of("saved", false);
        return Map.of("saved", true, "code", code);
    }

    // ---------------- 复习卡片（一次复习一张卡，历史各自留痕，永不覆盖） ----------------

    /** 某条错题的全部复习卡片，最新在前。 */
    @GetMapping("/mistakes/{id}/review-cards")
    public Map<String, Object> listReviewCards(@PathVariable long id) {
        List<Map<String, Object>> cards = db.listReviewCards(id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("cards", cards);
        out.put("count", cards.size());
        return out;
    }

    /** 新增一张复习卡片。只 INSERT，不动任何已有卡片。请求体 { code: "..." } */
    @PostMapping("/mistakes/{id}/review-cards")
    public Map<String, Object> addReviewCard(@PathVariable long id,
                                             @RequestBody Map<String, String> body) {
        String code = body.getOrDefault("code", "");
        if (code.isBlank()) {
            return Map.of("error", "先写点代码再保存");
        }
        Map<String, Object> mk = db.listMistakes().stream()
                .filter(m -> ((Number) m.get("id")).longValue() == id)
                .findFirst().orElse(null);
        String slug = mk == null ? null : String.valueOf(mk.get("problemSlug"));
        long cardId = db.addReviewCard(id, slug, code);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("cardId", cardId);
        out.put("count", db.countReviewCards(id));
        return out;
    }

    /**
     * 复习判题：把这次复习写的代码真跑一遍，再存成一张带分数的卡。
     * 和看题页的 /grade 复用同一个评分器，但结果只写进 review_card，
     * 绝不碰 my_code —— 复习重写不该覆盖当初第一次写的那份。
     */
    @PostMapping("/mistakes/{id}/review-cards/grade")
    public ResponseEntity<?> gradeReviewCard(@PathVariable long id,
                                             @RequestBody Map<String, String> body) {
        String code = body.getOrDefault("code", "");
        if (code.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "先写点代码再检查"));
        }
        Map<String, Object> mk = db.listMistakes().stream()
                .filter(m -> ((Number) m.get("id")).longValue() == id)
                .findFirst().orElse(null);
        if (mk == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "这条错题已经不在了"));
        }
        String slug = String.valueOf(mk.get("problemSlug"));
        if (slug == null || slug.isBlank() || "null".equals(slug)) {
            return ResponseEntity.badRequest().body(Map.of("error", "这条错题没关联到题库里的题，判不了"));
        }
        Map<String, Object> r = grader.gradeUser(slug, code);
        if (!Boolean.TRUE.equals(r.get("ok"))) {
            return ResponseEntity.badRequest().body(r);
        }
        // 判完立刻落成一张卡：复习的价值就在「写完马上知道对不对」，
        // 让用户再点一次保存，多半就忘了，那张带分数的记录也就没了。
        String json = null;
        Double total = null;
        try {
            json = MAPPER.writeValueAsString(r);
            total = ((Number) r.get("total")).doubleValue();
        } catch (Exception ignore) { }
        long cardId = db.addReviewCard(id, slug, code, json, total);
        Map<String, Object> out = new LinkedHashMap<>(r);
        out.put("cardId", cardId);
        out.put("count", db.countReviewCards(id));
        return ResponseEntity.ok(out);
    }

    /** 删一张卡片。路径里带 mistakeId 是为了不让人拿别的错题的 cardId 越权删。 */
    @DeleteMapping("/mistakes/{id}/review-cards/{cardId}")
    public Map<String, Object> deleteReviewCard(@PathVariable long id, @PathVariable long cardId) {
        boolean gone = db.deleteReviewCard(id, cardId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", gone);
        out.put("count", db.countReviewCards(id));
        return out;
    }

    @PostMapping("/mistakes/{id}/mastered")
    public Map<String, Object> masterMistake(@PathVariable long id, @RequestBody Map<String, Boolean> b) {
        db.setMastered(id, b.getOrDefault("mastered", true));
        return Map.of("ok", true);
    }

    @DeleteMapping("/mistakes/{id}")
    public Map<String, Object> delMistake(@PathVariable long id) {
        db.deleteMistake(id);
        return Map.of("ok", true);
    }

    // ---------------- 模板库 ----------------

    @GetMapping("/snippets")
    public List<Map<String, Object>> snippets() {
        return db.listSnippets();
    }

    @PostMapping("/snippets")
    public Map<String, Object> addSnippet(@RequestBody Map<String, Object> b) {
        long id = db.addSnippet(
                String.valueOf(b.getOrDefault("category", "其他")),
                String.valueOf(b.getOrDefault("title", "")),
                String.valueOf(b.getOrDefault("code", "")),
                String.valueOf(b.getOrDefault("note", "")),
                b.get("sortOrder") == null ? 0 : ((Number) b.get("sortOrder")).intValue());
        return Map.of("ok", true, "id", id);
    }

    @DeleteMapping("/snippets/{id}")
    public Map<String, Object> delSnippet(@PathVariable long id) {
        db.deleteSnippet(id);
        return Map.of("ok", true);
    }

    // ---------------- 力扣账号 ----------------

    @GetMapping("/account")
    public Map<String, Object> account() {
        Map<String, Object> m = new LinkedHashMap<>();
        String cookie = db.getSetting("lc_cookie");
        m.put("bound", cookie != null && !cookie.isBlank());
        m.put("username", db.getSetting("lc_username"));
        m.put("lastSync", db.getSetting("lc_last_sync"));
        m.put("solvedCount", db.listSolved().size());
        return m;
    }

    @PostMapping("/account/bind")
    public ResponseEntity<?> bind(@RequestBody Map<String, String> b) {
        String cookie = b.getOrDefault("cookie", "").trim();
        if (cookie.isBlank()) return ResponseEntity.badRequest().body(Map.of("error", "Cookie 不能为空"));
        try {
            String name = lc.checkCookie(cookie);
            if (name == null) {
                return ResponseEntity.status(400).body(Map.of(
                        "error", "Cookie 无效或已过期。请重新从浏览器复制（要包含 LEETCODE_SESSION 和 csrftoken）"));
            }
            db.setSetting("lc_cookie", cookie);
            db.setSetting("lc_username", name);
            return ResponseEntity.ok(Map.of("ok", true, "username", name));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/account/unbind")
    public Map<String, Object> unbind() {
        db.deleteSetting("lc_cookie");
        db.deleteSetting("lc_username");
        db.deleteSetting("lc_last_sync");
        return Map.of("ok", true);
    }

    @PostMapping("/account/sync")
    public ResponseEntity<?> sync() {
        String cookie = db.getSetting("lc_cookie");
        if (cookie == null || cookie.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "还没绑定力扣账号"));
        }
        try {
            Map<String, String[]> solved = lc.fetchSolved(cookie);
            db.replaceSolved(solved);
            String now = java.time.LocalDateTime.now().toString();
            db.setSetting("lc_last_sync", now);
            return ResponseEntity.ok(Map.of("ok", true, "count", solved.size(), "syncedAt", now));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/account/solved")
    public List<Map<String, Object>> solved() {
        return db.listSolved();
    }

    // ---------------- 计划 ----------------

    @GetMapping("/plan")
    public List<Map<String, Object>> planAll() {
        return plan.fullPlan();
    }

    @GetMapping("/plan/today")
    public Map<String, Object> planToday() {
        return plan.today();
    }

    // ---------------- AIHOT 资讯 ----------------

    /**
     * 精选资讯流。
     * 这里刻意不暴露 AIHOT 的全部参数 —— 只给「精选/全量」和翻页用的 cursor。
     * 参数面越小，前端越不容易拼出「每次都不同 URL」的请求，缓存也就不会被绕过去。
     */
    @GetMapping("/aihot/items")
    public Map<String, Object> aihotItems(
            @RequestParam(defaultValue = "selected") String mode,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) String category) {
        AihotService.Result r = aihot.items(mode, limit, cursor, category);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("meta", aihot.meta(r));
        if (r.body() == null) {
            out.put("items", List.of());
            out.put("page", Map.of("count", 0, "hasMore", false));
            return out;
        }
        JsonNode b = r.body();
        out.put("items", MAPPER.convertValue(b.path("items"), List.class));
        out.put("page", MAPPER.convertValue(b.path("page"), Map.class));
        return out;
    }

    /** Top10 热点 */
    @GetMapping("/aihot/hot")
    public Map<String, Object> aihotHot() {
        AihotService.Result r = aihot.hotTopics();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("meta", aihot.meta(r));
        out.put("items", r.body() == null ? List.of()
                : MAPPER.convertValue(r.body().path("items"), List.class));
        return out;
    }

    /** 日报：不给日期就是最新一份 */
    @GetMapping("/aihot/daily")
    public Map<String, Object> aihotDaily(@RequestParam(required = false) String date) {
        AihotService.Result r = (date == null || date.isBlank())
                ? aihot.dailyLatest() : aihot.daily(date);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("meta", aihot.meta(r));
        out.put("report", r.body() == null ? null
                : MAPPER.convertValue(r.body().path("report"), Map.class));
        return out;
    }

    /** 周刊 / 月报 */
    @GetMapping("/aihot/weekly")
    public Map<String, Object> aihotWeekly() {
        AihotService.Result r = aihot.weeklyLatest();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("meta", aihot.meta(r));
        out.put("report", r.body() == null ? null
                : MAPPER.convertValue(r.body().path("report"), Map.class));
        return out;
    }

    @GetMapping("/aihot/monthly")
    public Map<String, Object> aihotMonthly() {
        AihotService.Result r = aihot.monthlyLatest();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("meta", aihot.meta(r));
        out.put("report", r.body() == null ? null
                : MAPPER.convertValue(r.body().path("report"), Map.class));
        return out;
    }
}
