package com.lc.service;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.lc.model.Problem;
import com.lc.model.Solution;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 填空练习：把参考解挖掉几行，让人在骨架上把骨肉填回去。
 *
 * <p>为什么要有这个东西：能想出思路但写不出代码的人，缺的不是「看懂整体思路」（他有了），
 * 而是「这一行到底该怎么写」。给他完整答案让他看，他看完还是不会写；给他空白编辑器，
 * 他连第一行都下不去手。填空卡在中间：骨架已经搭好，只需要写那几行。
 *
 * <p>三条设计红线：
 * <ol>
 *   <li><b>按整行挖，不挖半句。</b>挖掉半个表达式等于让人猜谜，填对了也是运气。</li>
 *   <li><b>对错以真跑为准，不以「和参考解一样」为准。</b>他把 {@code for (int i = 0; i < n; i++)}
 *       写成 {@code for (int i = n - 1; i >= 0; i--)} 只要用例全过就是对的 —— 那样才算学会了，
 *       照抄才算学会是错的。</li>
 *   <li><b>正解不下发前端。</b>逐空比对的结果只返回「这空和参考写法不一致」，
 *       不返回参考原文；想看原文走题目页的解锁流程。</li>
 * </ol>
 *
 * <p>生成必须是确定性的：同一题、同一档、同一难度，每次挖出来的是同一批行。
 * 否则今天挖第 3 行明天挖第 7 行，用户没法比较自己有没有进步。
 */
@Service
public class PracticeService {

    /** 允许的难度档。easy 挖 1 行、medium 挖 3-5 行、hard 只留骨架。 */
    public static final List<String> LEVELS = Arrays.asList("blank", "easy", "medium", "hard");

    /** 允许的解法档。默认最优解；但「能从暴力解开始填」对新手更友好。 */
    public static final List<String> TIERS = Arrays.asList("brute", "better", "optimal");

    private static final String HOLE_PREFIX = "@@HOLE:";
    private static final String HOLE_SUFFIX = "@@";

    @Autowired
    private ProblemStore store;

    /** 挖好的题目缓存。key = slug|tier|level。内容是只读的，取出来别再改。 */
    private final Map<String, Sheet> cache = new ConcurrentHashMap<>();

    // ---------------------------------------------------------------- 数据

    /** 一个空。answer 只留在服务端，不序列化给前端。 */
    public static class Blank {
        public int id;
        /** 原文里的行号（1 起） */
        public int line;
        /** 这一行的缩进宽度（空格数），前端拿它做 padding */
        public int indent;
        /** 这个空在什么结构里，比如「在 for (int i = 0; i < n; i++) 里面」 */
        public String shape;
        /** 前后的代码，帮人回忆上下文 */
        public String around;
        @JsonIgnore
        public String answer;
        /**
         * 这个空挖掉的行是不是以 { 结尾。
         * 是的话卷面上行尾那个 { 是白送的，人不用也不该再打一个。
         */
        public boolean branch;
        /**
         * 白送在卷面上的关键字，比如 for / while / if / else if。
         * 空白档几乎每行都是空的，如果连关键字也挖掉，人光看一个空猜不到该写 for 还是 if ——
         * 那就是猜谜。所以关键字留在卷面上，只让人填括号里的条件。
         * 它不是答案的一部分：check 比对前会先把它从人的输入里剥掉。
         */
        public String prefix;
    }

    /** 一张卷子。 */
    public static class Sheet {
        public String slug;
        public String tier;
        public String tierName;
        public String level;
        /** 挖空后的代码，空位是 {@code @@HOLE:n@@} 占位 */
        public String template;
        public List<Blank> blanks = new ArrayList<>();
        public int totalLines;
    }

    // ---------------------------------------------------------------- 对外

    /**
     * 出卷子。
     *
     * @return 出不了（题不在库、没有解法、挖不出空）时返回 null
     */
    public Sheet sheet(String slug, String tier, String level) {
        String t = TIERS.contains(tier) ? tier : "optimal";
        String lv = LEVELS.contains(level) ? level : "easy";
        String key = slug + "|" + t + "|" + lv;
        Sheet hit = cache.get(key);
        if (hit != null) return hit;

        Problem p = store.get(slug);
        Solution s = pickSolution(p, t);
        if (s == null || s.codeJava == null || s.codeJava.isBlank()) return null;

        Sheet built = build(slug, t, lv, s);
        if (built == null) return null;
        cache.put(key, built);
        return built;
    }

    /**
     * 收卷并判分。
     *
     * @param answers key 是空的 id（字符串），value 是用户填的那一行
     * @return {@code {ok, level, missing, blanks, rebuilt, grade}}
     */
    public Map<String, Object> check(String slug, String tier, String level, Map<String, String> answers) {
        Sheet sheet = sheet(slug, tier, level);
        if (sheet == null) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("ok", false);
            err.put("error", "这道题出不了填空题（题库里没有可挖的参考解）");
            return err;
        }

        String code = sheet.template;
        List<Integer> missing = new ArrayList<>();
        List<Map<String, Object>> perBlank = new ArrayList<>();
        int mismatch = 0;

        for (Blank b : sheet.blanks) {
            String v = answers == null ? "" : answers.getOrDefault(String.valueOf(b.id), "");
            if (v == null) v = "";
            if (v.isBlank()) missing.add(b.id);
            code = code.replace(token(b.id), rebuildWith(b, v));

            boolean match = matchKey(v).equals(matchKey(b.answer));
            if (!match) mismatch++;
            Map<String, Object> one = new LinkedHashMap<>();
            one.put("id", b.id);
            one.put("line", b.line);
            one.put("filled", !v.isBlank());
            one.put("matches", match);
            perBlank.add(one);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("tier", sheet.tier);
        out.put("level", sheet.level);
        out.put("missing", missing);
        out.put("blanks", perBlank);
        out.put("mismatch", mismatch);
        out.put("total", sheet.blanks.size());

        if (!missing.isEmpty()) {
            // 没填完就别去编译了，报「语法错」只会让人以为是自己写错了
            out.put("rebuilt", false);
            out.put("message", "还有 " + missing.size() + " 个空没填，填完再提交。");
            return out;
        }

        out.put("rebuilt", true);
        return out;
    }

    /** 把用户填的拼回成完整代码，交给评分器。空没填满时返回 null。 */
    public String rebuild(String slug, String tier, String level, Map<String, String> answers) {
        Sheet sheet = sheet(slug, tier, level);
        if (sheet == null) return null;
        String code = sheet.template;
        for (Blank b : sheet.blanks) {
            String v = answers == null ? "" : answers.getOrDefault(String.valueOf(b.id), "");
            if (v == null || v.isBlank()) return null;
            code = code.replace(token(b.id), rebuildWith(b, v));
        }
        return code;
    }

    // ---------------------------------------------------------------- 出卷

    private Sheet build(String slug, String tier, String level, Solution s) {
        List<String> lines = new ArrayList<>(Arrays.asList(s.codeJava.replace("\r\n", "\n").split("\n", -1)));
        while (!lines.isEmpty() && lines.get(lines.size() - 1).trim().isEmpty()) {
            lines.remove(lines.size() - 1);
        }
        if (lines.isEmpty()) return null;

        List<Integer> holes = "blank".equals(level)
                ? blankEveryLine(lines)
                : pick(lines, level, seed(slug, tier, level));
        if (holes.isEmpty()) return null;

        Sheet sheet = new Sheet();
        sheet.slug = slug;
        sheet.tier = tier;
        sheet.tierName = tierName(tier, s);
        sheet.level = level;
        sheet.totalLines = lines.size();

        StringBuilder sb = new StringBuilder();
        int id = 1;
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            if (holes.contains(i)) {
                Blank b = new Blank();
                b.id = id;
                b.line = i + 1;
                b.indent = indentOf(line);
                b.shape = shapeOf(lines, i);
                b.around = aroundOf(lines, i);
                String body = line.trim();
                // 先剥掉行尾注释再判断。for (int j = 0; j < n; j++) {   // 注释
                // 这一行直接 endsWith("{") 是 false，会被当成普通行挖走，{ 跟着消失，
                // 后面的 } 就错配到外层去了 —— 卷面直接坏掉。
                String codeOnly = stripComment(body).trim();
                String tailComment = body.substring(stripComment(body).length()).trim();
                b.branch = codeOnly.endsWith("{");
                String answerText = b.branch
                        ? codeOnly.substring(0, codeOnly.length() - 1).trim()
                        : codeOnly;
                // 控制流头把关键字白送出去：for (int j = ...; j < n; j++) 只让人填括号里的部分。
                // 只对「以 { 结尾的控制流头」做 —— 普通语句没有前缀可送。
                int k = b.branch ? keywordEnd(answerText) : 0;
                if (k > 0) {
                    b.prefix = answerText.substring(0, k);
                    answerText = answerText.substring(k).trim();
                }
                b.answer = answerText;
                sheet.blanks.add(b);
                sb.append(spaces(b.indent))
                        .append(b.prefix == null ? "" : b.prefix + " ")
                        .append(token(id))
                        .append(b.branch ? " {" : "")
                        // 注释解释「为什么这么写」，是提示不是答案，留在卷面上人还能看懂
                        .append(tailComment.isEmpty() ? "" : "  " + tailComment)
                        .append('\n');
                id++;
            } else {
                sb.append(line).append('\n');
            }
        }
        sheet.template = sb.toString();
        return sheet;
    }

    /**
     * 空白档：只留 class 声明、public 方法签名、纯括号行和注释，方法体一行都不给。
     * 这是「力扣编辑器刚打开」那个样子 —— 它不考你记不记得某一行，
     * 它考你能不能从零把这道题的解法写出来。
     */
    private List<Integer> blankEveryLine(List<String> lines) {
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            String s = lines.get(i).trim();
            if (s.isEmpty()) continue;
            if (s.startsWith("//") || s.startsWith("/*") || s.startsWith("*") || s.startsWith("*/")) continue;
            if (s.startsWith("import ") || s.startsWith("package ") || s.startsWith("@")) continue;
            // 类声明留着
            if (s.contains(" class ") || s.startsWith("class ") || s.startsWith("public class ")
                    || s.startsWith("interface ") || s.startsWith("enum ")) continue;
            // 方法签名留着 —— 用户说的「只保留 class 和 public」就是这一行
            if (isSignature(stripComment(s).trim())) continue;
            // 纯括号行留着：} 挖走了这一层块就没尽头了
            String code = stripComment(s).trim();
            if (code.matches("[{}\\[\\]();]+")) continue;
            // 跨行结构（多行数组初始化）的任一行都不能挖 —— 挖了另一半就成了孤儿
            if (!braceHead(code) && openBraces(code) != 0) continue;
            // 行首是 } 的一律不挖：它关的是上一层块，挖了模板就少一个 }
            if (code.startsWith("}")) continue;
            // 括号没闭合的跨行签名不挖
            if (openParens(code) != 0) continue;
            out.add(i);
        }
        return out;
    }

    /**
     * 剥掉行尾的 // 注释，字符串和字符字面量里的 // 不算。
     * 注释里可能写着条件（「不是 <=」），直接拿来判断会把控制流头当成普通行。
     */
    private static String stripComment(String raw) {
        if (raw == null) return "";
        boolean inStr = false, inChar = false;
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (inStr || inChar) {
                if (c == '\\') { i++; continue; }
                if (inStr && c == '"') inStr = false;
                else if (inChar && c == '\'') inChar = false;
                continue;
            }
            if (c == '"') { inStr = true; continue; }
            if (c == '\'') { inChar = true; continue; }
            if (c == '/' && i + 1 < raw.length() && raw.charAt(i + 1) == '/') {
                return raw.substring(0, i);
            }
        }
        return raw;
    }

    /** 这一行里 { 和 } 的净增量。 */
    private static int openBraces(String s) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '{') n++;
            else if (c == '}') n--;
        }
        return n;
    }

    /** 这一行里 ( [ 和 ) ] 的净增量。不为 0 说明括号跨行了。 */
    private static int openParens(String s) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '(' || c == '[') n++;
            else if (c == ')' || c == ']') n--;
        }
        return n;
    }

    /** 是控制流头（for / if / while ... 且以 { 结尾）。 */
    private static boolean braceHead(String s) {
        return skeleton(s) && s.endsWith("{");
    }

    /** 方法签名：有括号、有返回类型，而且不是控制流。 */
    private static boolean isSignature(String s) {
        if (skeleton(s)) return false;
        if (!s.endsWith("{")) return false;
        int open = s.indexOf('(');
        if (open <= 0) return false;
        // 「返回类型 + 方法名」至少两个词；控制流已经被 skeleton 挡掉了
        return s.substring(0, open).trim().split("\\s+").length >= 2;
    }

    /** 人习惯把整行打全（连行尾的 { 也打上），不能因此算错。 */
    private static String stripTailBrace(String s) {
        String t = s == null ? "" : s.trim();
        return t.endsWith("{") ? t.substring(0, t.length() - 1).trim() : t;
    }

    /** 比对用的键：空白归一 + 去掉行尾的 {。 */
    /**
     * 这一行开头有多少个字符是「白送的关键字」。
     *
     * 只认控制流关键字，而且必须跟一个左括号 ——
     * else if 要排在 if 前面判断，否则 "else if (x)" 会被 "if" 抢走前面的 else。
     * 找不到返回 0（普通语句没有前缀可送）。
     */
    private static int keywordEnd(String s) {
        String t = s.trim();
        for (String kw : new String[]{"else if", "while", "for", "if", "switch", "catch"}) {
            if (t.startsWith(kw)) {
                int open = t.indexOf('(', kw.length());
                if (open > 0 && t.substring(kw.length(), open).trim().isEmpty()) {
                    return kw.length();
                }
            }
        }
        return 0;
    }

    /**
     * 把人的输入拼回代码。两件事要做：
     *
     * 1. 剥掉人自己打的关键字。卷面上已经给了 for，人可能习惯性把整行打全
     *    （for (int j = ...; j < n; j++)）—— 那不是错，只是多打了。
     *    不剥的话拼出来是 for for (...) { { ，编译都过不了。
     * 2. 剥掉行尾多打的 {。那个 { 卷面上已经留着了，人再打一个是重复的。
     */
    private static String rebuildWith(Blank b, String raw) {
        String v = raw == null ? "" : raw.trim();
        if (b.prefix != null && !b.prefix.isEmpty() && v.startsWith(b.prefix)) {
            v = v.substring(b.prefix.length()).trim();
        }
        return b.branch ? stripTailBrace(v) : v;
    }

    private static String matchKey(String s) {
        return stripTailBrace(norm(s));
    }

    /** 挑出这一档要挖哪些行。 */
    private List<Integer> pick(List<String> lines, String level, int seed) {
        List<Integer> cand = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            if (blankable(lines.get(i))) cand.add(i);
        }
        if (cand.isEmpty()) return cand;

        if ("hard".equals(level)) {
            // 困难档：控制流留着当骨架，把骨肉全挖掉。
            // 注意别全挖 —— 什么都不留就不叫填空了，叫默写。
            List<Integer> out = new ArrayList<>();
            for (int i : cand) {
                if (!skeleton(lines.get(i))) out.add(i);
            }
            return out.isEmpty() ? top(lines, cand, Math.min(5, cand.size())) : out;
        }

        if ("medium".equals(level)) {
            int n = Math.min(5, Math.max(3, Math.round(cand.size() * 0.35f)));
            return top(lines, cand, Math.min(n, cand.size()));
        }

        // 简单档：只挖一行，而且从最重要的三行里按种子挑一个 ——
        // 永远挖同一行的话，记住那一行就等于做完了。
        List<Integer> best = top(lines, cand, Math.min(3, cand.size()));
        return List.of(best.get(Math.floorMod(seed, best.size())));
    }

    /** 按「这一行有多关键」排序，取前 n 个。 */
    private List<Integer> top(List<String> lines, List<Integer> cand, int n) {
        List<Integer> sorted = new ArrayList<>(cand);
        sorted.sort(Comparator
                .comparingInt((Integer i) -> -score(lines.get(i)))
                .thenComparingInt(i -> i));
        return new ArrayList<>(sorted.subList(0, Math.min(n, sorted.size())));
    }

    /** 这一行值不值得挖。太重要的（签名、括号）挖了就没骨架了，太没用的（注释）挖了没意义。 */
    private static boolean blankable(String raw) {
        String s = raw.trim();
        // 用剥掉行尾注释后的代码判断，而不是原始行。
        // 「while (left < right) {   // 不是 <=」直接 endsWith("{") 是 false。
        String code = stripComment(s).trim();
        if (s.isEmpty() || code.isEmpty()) return false;
        if (s.startsWith("//") || s.startsWith("/*") || s.startsWith("*") || s.startsWith("*/")) return false;
        if (s.startsWith("import ") || s.startsWith("package ")) return false;
        if (s.startsWith("@")) return false;
        // 只有括号和分号的行：挖了只剩空白，没有练习价值
        if (s.matches("[{}\\[\\]();]+")) return false;
        // 任何以 { 结尾的行都留着：它自带一个左花括号，挖掉之后花括号没了配对的另一半，
        // 后面的 } 会错配到外层去 —— 挖完的模板看上去就是坏的，人没法填。
        // （之前这里写成「以 { 结尾且不含 =」，而 for (int j = i + 1; ...) { 正好含 =，
        //   于是被当成可挖行，模板里就多出孤零零的 }，撑坏了整个结构。）
        if (!braceHead(code) && openBraces(code) != 0) return false;
        // 行首是 } 的一律不挖。哪怕净增量为 0（} else if (...) { 就是这样），
        // 开头那个 } 关的是上一层块 —— 挖走之后模板里就少一个 }，怎么填都配不平。
        if (code.startsWith("}")) return false;
        if (code.startsWith("catch ") || code.equals("try {")) return false;
        if (code.startsWith("finally") || code.startsWith("switch ")
                || code.startsWith("case ") || code.startsWith("default:")) return false;
        if (code.equals("do {")) return false;
        // 圆括号/方括号没闭合的行不挖：那是跨行的方法签名或跨行调用，
        // 只挖第一行会把后面的参数行变成孤儿。
        if (openParens(code) != 0) return false;
        return true;
    }

    /** 骨架行：控制流。困难档留这些，让人看得出「这里有个循环」。 */
    private static boolean skeleton(String raw) {
        String s = raw.trim();
        return s.startsWith("for (") || s.startsWith("while (") || s.startsWith("if (")
                || s.startsWith("else") || s.startsWith("switch ") || s.startsWith("case ")
                || s.startsWith("default:") || s.startsWith("do {") || s.startsWith("try")
                || s.startsWith("catch ");
    }

    /** 越关键分越高。return 和赋值是最容易「想得到但写不出」的地方。 */
    private static int score(String raw) {
        String t = raw.trim();
        int v = 0;
        if (t.startsWith("return")) v += 5;
        boolean assign = t.contains("=") && !t.contains("==") && !t.contains("!=")
                && !t.contains("<=") && !t.contains(">=");
        if (assign) v += 3;
        if (t.matches(".*\\w+\\(.*\\).*")) v += 2;
        if (t.contains("if (") || t.contains("while (") || t.contains("for (")) v += 2;
        if (t.length() > 30) v += 1;
        return v;
    }

    /** 这个空在什么结构里 —— 给提示用，不剧透答案。 */
    private static String shapeOf(List<String> lines, int idx) {
        int ind = indentOf(lines.get(idx));
        for (int j = idx - 1; j >= 0; j--) {
            String s = lines.get(j).trim();
            if (s.isEmpty() || s.startsWith("//")) continue;
            int jind = indentOf(lines.get(j));
            if (jind >= ind) continue;
            if (s.startsWith("for (") || s.startsWith("while (") || s.startsWith("if (")) {
                return "在「" + cut(s, 46) + "」里面";
            }
            return "在方法体里";
        }
        return "在方法体里";
    }

    /** 前后各一行，帮人回忆「这行夹在哪两句中间」。 */
    private static String aroundOf(List<String> lines, int idx) {
        String prev = nearest(lines, idx, -1);
        String next = nearest(lines, idx, 1);
        StringBuilder sb = new StringBuilder();
        if (prev != null) sb.append("上面：" ).append(cut(prev, 52));
        if (next != null) {
            if (sb.length() > 0) sb.append("　");
            sb.append("下面：").append(cut(next, 52));
        }
        return sb.toString();
    }

    private static String nearest(List<String> lines, int idx, int step) {
        for (int j = idx + step; j >= 0 && j < lines.size(); j += step) {
            String s = lines.get(j).trim();
            if (s.isEmpty()) continue;
            if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")) continue;
            return s;
        }
        return null;
    }

    // ---------------------------------------------------------------- 小工具

    private static Solution pickSolution(Problem p, String tier) {
        if (p == null || p.solutions == null || p.solutions.isEmpty()) return null;
        for (Solution s : p.solutions) {
            if (tier.equals(s.tier)) return s;
        }
        for (Solution s : p.solutions) {
            if ("optimal".equals(s.tier)) return s;
        }
        return p.solutions.get(0);
    }

    private static String tierName(String tier, Solution s) {
        String base = "brute".equals(tier) ? "暴力解" : "better".equals(tier) ? "进阶解" : "最优解";
        return (s.title == null || s.title.isBlank()) ? base : base + " · " + s.title;
    }

    private static String token(int id) {
        return HOLE_PREFIX + id + HOLE_SUFFIX;
    }

    private static int seed(String slug, String tier, String level) {
        int h = 17;
        for (char c : (slug + "|" + tier + "|" + level).toCharArray()) {
            h = h * 31 + c;
        }
        return h;
    }

    private static int indentOf(String s) {
        int i = 0;
        while (i < s.length() && (s.charAt(i) == ' ' || s.charAt(i) == '\t')) i++;
        return i;
    }

    private static String spaces(int n) {
        char[] c = new char[Math.max(0, n)];
        Arrays.fill(c, ' ');
        return new String(c);
    }

    private static String cut(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n - 1) + "…";
    }

    private static String norm(String s) {
        return s == null ? "" : s.replaceAll("\\s+", " ").trim();
    }
}
