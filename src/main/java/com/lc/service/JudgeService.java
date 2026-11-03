package com.lc.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;

/**
 * 真判题：把用户代码编译出来，在同一个 JVM 里跑官方示例用例，比对输出。
 *
 * <h3>为什么不用「编译成 class，再起一个 java 进程去跑」</h3>
 * 本机沙箱禁止创建子进程 —— ProcessBuilder.start 报 CreatePipe error=5，
 * 换成文件重定向则是 STATUS_DLL_INIT_FAILED，连 cmd /c echo 都起不来。
 * 所以在服务进程内用 URLClassLoader 加载，反射调用。
 *
 * <h3>代价（必须记住）</h3>
 * 用户代码和主服务共享一个 JVM：
 * <ul>
 *   <li>死循环靠 Future.get(timeout) 掐断，但**线程本身停不下来**，只能放弃等它；</li>
 *   <li>System.exit 拦不住，会把整个服务带走。这是已知残余风险，不是没想到。</li>
 * </ul>
 *
 * <h3>期望值从哪来</h3>
 * 力扣只给 exampleTestcases（输入），不给期望输出。这里用题目自带的最优参考解
 * 跑一遍得到期望值。前提是参考解本身是对的 —— 那是 120 题内容生产阶段验证过的事。
 */
@Service
public class JudgeService {

    private final ObjectMapper om = new ObjectMapper();
    private final Map<String, Judging> cache = new ConcurrentHashMap<>();
    private static final int MAX_CASES = 40;

    /** 答案顺序不唯一、但集合必须一致的题。 */
    private static final Set<String> ORDER_FREE = new HashSet<>(Arrays.asList(
            "permutations", "generate-parentheses", "group-anagrams",
            "subsets", "combination-sum", "letter-combinations-of-a-phone-number"));

    /** 答案本身不唯一、机器判不了对错的题。判不了就说不判，绝不硬判。 */
    private static final Map<String, String> UNJUDGEABLE = new HashMap<>();

    static {
        UNJUDGEABLE.put("convert-sorted-array-to-binary-search-tree",
                "这道题可以构造出很多个都正确的二叉搜索树，形状不一样也算对 —— 机器没法判，所以不判对错");
        UNJUDGEABLE.put("course-schedule-ii",
                "拓扑排序的正确顺序不止一种 —— 机器没法判，所以不判对错");
        UNJUDGEABLE.put("linked-list-cycle",
                "返回值要求判断「有没有环」，用例只给了节点数组，构不出环 —— 判不了");
        UNJUDGEABLE.put("linked-list-cycle-ii",
                "要求返回环的入口节点，用例只给了节点数组，构不出环 —— 判不了");
        UNJUDGEABLE.put("intersection-of-two-linked-lists",
                "要求返回两条链表的交点节点，用例造不出共享节点 —— 判不了");
        UNJUDGEABLE.put("lowest-common-ancestor-of-a-binary-tree",
                "参数是树里的节点对象，用例只给层序数组，定位不到那个节点 —— 判不了");
        UNJUDGEABLE.put("clone-graph",
                "图节点类需要题目自带的 Node 定义，判题器里没有 —— 判不了");
    }
    private static final int CASE_TIMEOUT_MS = 3000;

    // ------------------------------------------------------------------ 数据结构

    /** 一个题的判题素材。 */
    public static class Judging {
        public String slug;
        public String status;          // ready / no-cases / ref-broken
        public String reason;
        public String methodName;
        public List<String> paramNames = new ArrayList<>();
        public List<String> paramTypes = new ArrayList<>();
        public String returnType = "void";
        public List<String[]> inputs = new ArrayList<>();
        public List<String> expected = new ArrayList<>();
        public boolean orderFree;
        /** 参考解与题面期望不一致时的说明。有值不代表用户错，恰恰相反。 */
        public String refNote;
        /** 当前正在跑的用例下标，void 型题目挑答案时要用。 */
        public int cursor = -1;

        public String peekExpected() {
            if (cursor >= 0 && cursor < expected.size()) return expected.get(cursor);
            return expected.isEmpty() ? "" : expected.get(0);
        }
    }

    /** 判题结果。 */
    public static class Verdict {
        public boolean ran;            // 有没有真跑起来
        public String reason;          // 没跑的原因（说人话）
        public boolean compiled = true;
        public String compileError;
        public int total;
        public int passed;
        public List<Map<String, Object>> failures = new ArrayList<>();
        /** 只在算期望值时用：每个用例的返回值。判用户代码时不用。 */
        public List<String> outputs = new ArrayList<>();
    }

    // ------------------------------------------------------------------ 对外入口

    public Judging prepare(String slug, Path root) {
        Judging hit = cache.get(slug);
        if (hit != null) return hit;
        Judging j = new Judging();
        j.slug = slug;
        try {
            Path testFile = root.resolve("content").resolve("tests").resolve(slug + ".json");
            Path probFile = root.resolve("content").resolve("problems").resolve(slug + ".json");
            if (!Files.isRegularFile(testFile)) { return miss(j, "没有这个题的官方示例用例"); }
            if (!Files.isRegularFile(probFile)) { return miss(j, "找不到题目文件"); }

            JsonNode t = om.readTree(testFile.toFile());
            j.methodName = t.path("name").asText("");
            for (JsonNode p : t.path("params")) {
                j.paramNames.add(p.path("name").asText());
                j.paramTypes.add(p.path("type").asText());
            }
            j.returnType = t.path("return").path("type").asText("void");
            for (JsonNode c : t.path("cases")) {
                List<String> args = new ArrayList<>();
                for (JsonNode a : c) args.add(a.asText());
                j.inputs.add(args.toArray(new String[0]));
            }
            if (j.inputs.isEmpty()) return miss(j, "这个题的示例用例是空的");
            if (j.inputs.size() > MAX_CASES) j.inputs = new ArrayList<>(j.inputs.subList(0, MAX_CASES));

            JsonNode prob = om.readTree(probFile.toFile());
            String refCode = null;
            for (JsonNode s : prob.path("solutions")) {
                if ("optimal".equals(s.path("tier").asText())) { refCode = s.path("codeJava").asText(); break; }
            }
            if (refCode == null) return miss(j, "题目没有最优参考解，没法算期望值");

            // 期望值只认题面，不认参考解。
            // 曾经用「参考解跑一遍」当标准，结果是循环论证：参考解判自己永远全过，
            // 于是 longest-consecutive-sequence 那种写错的参考解也能一直「3/3」，
            // 而用户正确的代码被判 0/3。力扣的 exampleTestcases 本身也和题面不符，
            // 所以 content/tests 现在是从题面 HTML 重建的，expected 就在里面。
            for (JsonNode e : t.path("expected")) j.expected.add(e.asText());
            if (j.expected.size() != j.inputs.size()) {
                return miss(j, "这个题的用例和期望值条数对不上（" + j.inputs.size() + " 个输入 / "
                        + j.expected.size() + " 个期望），不敢拿去判对错");
            }

            // 参考解仍然跑一遍，但只用来交叉校验：它和题面期望不一致时，
            // 说明写错的是参考解，不是用户。这时候把差异记下来，供人排查。
            // 必须先定 orderFree，再做参考解比对 —— 否则比对时它还恒为 false，
            // 像 permutations / group-anagrams 这种答案顺序不唯一的题会被误报「参考解写错」。
            j.orderFree = prob.path("tags").asText("").contains("哈希表") || ORDER_FREE.contains(slug);

            Verdict v = execute(refCode, j);
            if (!v.compiled) {
                j.refNote = "参考解编译不过：" + firstLine(v.compileError != null ? v.compileError : v.reason);
            } else if (v.outputs.size() == v.total) {
                List<Integer> refWrong = new ArrayList<>();
                for (int i = 0; i < j.expected.size(); i++) {
                    String got = v.outputs.get(i);
                    if (!same(got, j.expected.get(i), j.orderFree)) refWrong.add(i + 1);
                }
                if (!refWrong.isEmpty()) {
                    j.refNote = "参考解自己在第 " + refWrong.toString().replace("[", "").replace("]", "")
                            + " 个用例上就和题面期望不一致 —— 错的是参考解，你的提交按题面判";
                }
            }
            // 顺序无关：哈希表类（两数之和）和多解类（全排列、括号生成、字母异位词分组）。
            // 排序题不能用这个 —— 那里顺序就是对错本身。
            // (orderFree 已提前到参考解比对之前赋值)

            // 这几类题的「正确答案」根本不唯一，机器判不了对错：
            //   · 构造 BST：任何合法平衡 BST 都对，形状可以完全不同
            //   · 拓扑排序：任何合法拓扑序都对
            //   · 返回节点/判环：答案是一个对象引用，不是值
            // 硬判只会把对的判成错的 —— 那比不判更害人。直接标成判不了。
            if (UNJUDGEABLE.containsKey(slug)) {
                cache.put(slug, j);
                return missWhy(j, UNJUDGEABLE.get(slug));
            }
            j.status = "ready";
            cache.put(slug, j);
            return j;
        } catch (Exception e) {
            return miss(j, "读判题素材失败：" + firstLine(e.toString()));
        }
    }

    private Judging miss(Judging j, String why) {
        j.status = "no-cases";
        j.reason = why;
        cache.put(j.slug, j);
        return j;
    }

    /** 素材在、但机器判不了。原因要能一眼看懂，不能让人以为是自己的错。 */
    private Judging missWhy(Judging j, String why) {
        j.status = "no-cases";
        j.reason = why;
        cache.put(j.slug, j);
        return j;
    }

    /** 判一个提交。 */
    public Verdict judge(String slug, String userCode, Path root) {
        Judging j = prepare(slug, root);
        if (!"ready".equals(j.status)) {
            Verdict v = new Verdict();
            v.ran = false;
            v.reason = j.reason;
            return v;
        }
        return execute(userCode, j);
    }

    // ------------------------------------------------------------------ 执行

    private Verdict execute(String code, Judging j) {
        Verdict v = new Verdict();
        v.total = j.inputs.size();
        Path out = null;
        try {
            out = newOutDir();
            Path srcDir = Files.createDirectories(out.resolve("src"));

            StringBuilder src = new StringBuilder("import java.util.*;\nimport java.util.function.*;\n");
            // import 必须全在类声明之前。用户代码自己可能也带 import（参考解里就有），
            // 所以要先把它们全部抽到最前面，helper 类插在 import 之后、正文之前。
            // 否则会生成「class 后面又跟了个 import」这种语法错误。
            StringBuilder body = new StringBuilder();
            for (String line : code.split("\n", -1)) {
                if (line.trim().startsWith("import ")) src.append(line).append('\n');
                else body.append(line).append('\n');
            }
            if (!code.contains("class ListNode")) src.append(LIST_NODE);
            if (!code.contains("class TreeNode")) src.append(TREE_NODE);
            src.append(body);
            Path sol = srcDir.resolve("Solution.java");
            Files.write(sol, src.toString().getBytes(StandardCharsets.UTF_8));

            JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
            ByteArrayOutputStream err = new ByteArrayOutputStream();
            int rc = javac.run(null, null, err, "-encoding", "UTF-8", "-nowarn",
                                "-d", out.toString(), sol.toString());
            if (rc != 0) {
                v.compiled = false;
                v.ran = true;
                v.compileError = err.toString(StandardCharsets.UTF_8);
                if (v.compileError.isBlank()) {
                    // javac 返回非零但没写错误流时，别假装有内容 —— 把现场留下来
                    v.compileError = "javac 返回 " + rc + "，但没有给出错误信息";
                }
                v.failures = new ArrayList<>();
                return v;
            }

            try (URLClassLoader cl = new URLClassLoader(new URL[]{out.toUri().toURL()},
                                                        JudgeService.class.getClassLoader())) {
                Class<?> cls = cl.loadClass("Solution");
                Constructor<?> ctor = cls.getDeclaredConstructor();
                ctor.setAccessible(true);
                // 先把参数解析一次（和用户代码无关，失败了就是素材问题）
                List<Object[]> parsed = new ArrayList<>();
                for (String[] raw : j.inputs) {
                    Object[] args = new Object[raw.length];
                    for (int i = 0; i < raw.length; i++) args[i] = parseValue(raw[i], j.paramTypes.get(i), cl);
                    parsed.add(args);
                }

                v.ran = true;
                ExecutorService pool = Executors.newSingleThreadExecutor(r -> {
                    Thread th = new Thread(r, "judge-case");
                    th.setDaemon(true);
                    return th;
                });
                try {
                    for (int i = 0; i < parsed.size(); i++) {
                        // 告诉 runCase「现在跑第几个用例」—— void 型题要靠它从入参里挑出答案
                        j.cursor = i;
                        final Object[] args = parsed.get(i);
                        final Class<?> fcls = cls;
                        final Constructor<?> fctor = ctor;
                        Future<String> fut = pool.submit(() -> runCase(fcls, fctor, args, j));
                        String got;
                        boolean timedOut = false;
                        try {
                            got = fut.get(CASE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                        } catch (TimeoutException te) {
                            fut.cancel(true);
                            got = null;
                            timedOut = true;
                        } catch (Throwable te) {
                            got = null;
                        }
                        v.outputs.add(got);
                        // 算期望值的这一趟，j.expected 还是空的 —— 没有可比的东西，只收集输出
                        if (j.expected.size() <= i) {
                            if (timedOut) throw new java.util.concurrent.TimeoutException("参考解在用例 " + (i + 1) + " 上超时");
                            continue;
                        }
                        if (timedOut) {
                            Map<String, Object> f = new LinkedHashMap<>();
                            f.put("index", i + 1);
                            f.put("input", String.join(", ", j.inputs.get(i)));
                            f.put("expected", j.expected.get(i));
                            f.put("got", "超时（超过 " + CASE_TIMEOUT_MS + " 毫秒，可能有死循环）");
                            v.failures.add(f);
                            continue;
                        }
                        String want = j.expected.get(i);
                        if (same(got, want, j.orderFree)) v.passed++;
                        else {
                            Map<String, Object> f = new LinkedHashMap<>();
                            f.put("index", i + 1);
                            f.put("input", String.join(", ", j.inputs.get(i)));
                            f.put("expected", want);
                            f.put("got", got == null ? "抛异常或返回 null" : got);
                            v.failures.add(f);
                        }
                    }
                } finally {
                    pool.shutdownNow();
                }
            }
        } catch (Throwable t) {
            v.ran = true;
            v.reason = "判题环境出错：" + firstLine(t.toString());
            v.compileError = t.toString();
            v.compiled = false;
        } finally {
            deleteQuietly(out);
        }

        return v;
    }

    /** 跑单个用例：反射找到方法、造参数、调用、序列化返回值。 */
    private static String runCase(Class<?> cls, Constructor<?> ctor, Object[] args, Judging j) throws Exception {
        Object inst = ctor.newInstance();
        Method target = null;
        for (Method m : cls.getDeclaredMethods()) {
            if (m.getName().equals(j.methodName) && m.getParameterCount() == args.length) { target = m; break; }
        }
        if (target == null) throw new NoSuchMethodException(j.methodName);
        target.setAccessible(true);

        PrintStream oldOut = System.out;
        ByteArrayOutputStream cap = new ByteArrayOutputStream();
        try {
            System.setOut(new PrintStream(cap, true, StandardCharsets.UTF_8));
            Object res = target.invoke(inst, args);
            if ("void".equals(j.returnType)) {
                // 原地修改型题目：答案在被改过的入参里，不在返回值里。
                // 以前把**所有**入参拼成一个串当答案（rotate-array 就变成 "[[5,6,7,1,2,3,4],3]"），
                // 现在只挑「和题面期望形状像」的那一个 —— 判题器不该要求用户按它的拼接顺序作答。
                String printed = cap.toString(StandardCharsets.UTF_8).trim();
                if (!printed.isEmpty()) return printed;
                for (Object a : args) {
                    String one = serialize(a);
                    if (same(one, j.peekExpected(), false)) return one;
                }
                // 都不是，就按第一个入参报（大多数原地修改题的答案就是首个数组参数）
                return args.length > 0 ? serialize(args[0]) : "null";
            }
            return serialize(res);
        } finally {
            System.setOut(oldOut);
        }
    }

    // ------------------------------------------------------------------ 比较

    private static String canon(String s) {
        if (s == null) return "";
        return s.replaceAll("\\s+", "");
    }

    /** 能不能当成一个数读。 */
    private static Double num(String s) {
        if (s == null) return null;
        try { return Double.valueOf(s.trim()); } catch (Exception e) { return null; }
    }

    /**
     * 判「这个答案算不算对」。
     *
     * 这里刻意放宽了几种「写法不同但意思相同」的情况 —— 判题器测不准还报错，
     * 比不判更害人：
     *   · 浮点：题面写 1024.00000，代码返回 1024.0，是同一个数
     *   · 空集合：链表/树返回 null 和返回 [] 都是空
     *   · 顺序无关：题目声明顺序不唯一时（多解、哈希表答案），排序后比
     */
    private static boolean same(String got, String want, boolean orderFree) {
        if (want == null) return got == null;
        // 空 -> null 与 [] 等价
        // 空的东西有四种写法：null、"null"、"[]"、空串。它们是同一个意思。
        // 链表/树的空返回 null，力扣题面写 []，判成「不同」等于平白扣分。
        String g = canon(got), w = canon(want);
        boolean gEmpty = g.isEmpty() || g.equals("[]") || g.equals("null");
        boolean wEmpty = w.isEmpty() || w.equals("[]") || w.equals("null");
        if (gEmpty && wEmpty) return true;
        if (g.equals(w)) return true;

        // 浮点：允许 1e-5 的相对/绝对误差
        Double a = num(got), b = num(want);
        if (a != null && b != null) {
            double diff = Math.abs(a - b);
            if (diff <= 1e-5) return true;
            double scale = Math.max(1.0, Math.max(Math.abs(a), Math.abs(b)));
            if (diff / scale <= 1e-5) return true;
        }

        if (!orderFree) return false;
        // 顺序无关的题有两层：
        //   · 一层：两数之和这种，数组元素顺序不唯一
        //   · 两层：字母异位词分组这种，组内顺序和组间顺序都不唯一
        //     期望 [["bat"],["nat","tan"],["ate","eat","tea"]]
        //     实际 [["bat"],["tan","nat"],["eat","tea","ate"]]  是同一组答案
        if (canon(sortedForm(got)).equals(canon(sortedForm(want)))) return true;
        return canon(deepSortedForm(got)).equals(canon(deepSortedForm(want)));
    }

    /**
     * 两层排序：每个内层数组先排序，再把外层元素排序。
     * 字母异位词分组这类题，正确答案的组内顺序和组间顺序都不唯一。
     */
    private static String deepSortedForm(String s) {
        String outer = sortedForm(s);
        String t = outer.trim();
        if (!t.startsWith("[") || !t.endsWith("]")) return t;
        String inner = t.substring(1, t.length() - 1).trim();
        if (inner.isEmpty()) return "[]";
        List<String> items = new ArrayList<>();
        int depth = 0;
        StringBuilder cur = new StringBuilder();
        boolean inStr = false;
        for (int i = 0; i < inner.length(); i++) {
            char c = inner.charAt(i);
            if (c == '"') inStr = !inStr;
            if (!inStr) {
                if (c == '[' || c == '(' || c == '{') depth++;
                if (c == ']' || c == ')' || c == '}') depth--;
                if (c == ',' && depth == 0) { items.add(cur.toString().trim()); cur.setLength(0); continue; }
            }
            cur.append(c);
        }
        if (cur.length() > 0) items.add(cur.toString().trim());
        List<String> norm = new ArrayList<>();
        for (String it : items) norm.add(sortedForm(it));
        Collections.sort(norm);
        return "[" + String.join(",", norm) + "]";
    }

    private static String sortedForm(String s) {
        String t = s.trim();
        if (!t.startsWith("[") || !t.endsWith("]")) return t;
        String inner = t.substring(1, t.length() - 1).trim();
        if (inner.isEmpty()) return "[]";
        List<String> items = new ArrayList<>();
        int depth = 0;
        StringBuilder cur = new StringBuilder();
        boolean inStr = false;
        for (int i = 0; i < inner.length(); i++) {
            char c = inner.charAt(i);
            if (c == '"') inStr = !inStr;
            if (!inStr) {
                if (c == '[' || c == '(' || c == '{') depth++;
                if (c == ']' || c == ')' || c == '}') depth--;
                if (c == ',' && depth == 0) { items.add(cur.toString().trim()); cur.setLength(0); continue; }
            }
            cur.append(c);
        }
        if (cur.length() > 0) items.add(cur.toString().trim());
        Collections.sort(items);
        return "[" + String.join(",", items) + "]";
    }

    // ------------------------------------------------------------------ 参数解析（全程反射）

    static final String LIST_NODE =
        "class ListNode { int val; ListNode next; ListNode() {} ListNode(int v) { val = v; } ListNode(int v, ListNode n) { val = v; next = n; } }\n";
    static final String TREE_NODE =
        "class TreeNode { int val; TreeNode left, right; TreeNode() {} TreeNode(int v) { val = v; } TreeNode(int v, TreeNode l, TreeNode r) { val = v; left = l; right = r; } }\n";

    private final ObjectMapper json = new ObjectMapper();

    private Object parseValue(String text, String type, ClassLoader cl) throws Exception {
        JsonNode n = json.readTree(text);
        return fromJson(n, type, cl);
    }

    private Object fromJson(JsonNode n, String type, ClassLoader cl) throws Exception {
        switch (type) {
            case "integer": return n.isNull() ? 0 : n.asInt();
            case "boolean": return n.asBoolean();
            case "double": return n.isNull() ? 0.0 : n.asDouble();
            case "string": return n.isNull() ? "" : n.asText();
            case "integer[]": {
                int[] a = new int[n.size()];
                for (int i = 0; i < a.length; i++) a[i] = n.get(i).asInt();
                return a;
            }
            case "integer[][]": {
                int[][] a = new int[n.size()][];
                for (int i = 0; i < a.length; i++) {
                    JsonNode row = n.get(i);
                    a[i] = new int[row.size()];
                    for (int k = 0; k < a[i].length; k++) a[i][k] = row.get(k).asInt();
                }
                return a;
            }
            case "character[]": {
                char[] a = new char[n.size()];
                for (int i = 0; i < a.length; i++) a[i] = firstChar(n.get(i).asText());
                return a;
            }
            case "character[][]": {
                char[][] a = new char[n.size()][];
                for (int i = 0; i < a.length; i++) {
                    JsonNode row = n.get(i);
                    a[i] = new char[row.size()];
                    for (int k = 0; k < a[i].length; k++) a[i][k] = firstChar(row.get(k).asText());
                }
                return a;
            }
            case "string[]": {
                String[] a = new String[n.size()];
                for (int i = 0; i < a.length; i++) a[i] = n.get(i).asText();
                return a;
            }
            case "ListNode": return buildList(n, cl);
            case "ListNode[]": {
                Object arr = java.lang.reflect.Array.newInstance(cl.loadClass("ListNode"), n.size());
                for (int i = 0; i < n.size(); i++) java.lang.reflect.Array.set(arr, i, buildList(n.get(i), cl));
                return arr;
            }
            case "TreeNode": return buildTree(n, cl);
            default: break;
        }
        if (type.startsWith("list<")) {
            String inner = type.substring(5, type.length() - 1);
            List<Object> list = new ArrayList<>();
            for (JsonNode e : n) list.add(fromJson(e, inner, cl));
            return list;
        }
        return n.asText();
    }

    private static char firstChar(String s) { return s == null || s.isEmpty() ? ' ' : s.charAt(0); }

    /** JSON 数组 → ListNode 链。全程反射，因为 ListNode 是在用户代码那个 classloader 里定义的。 */
    private static Object buildList(JsonNode n, ClassLoader cl) throws Exception {
        Class<?> lc = cl.loadClass("ListNode");
        Constructor<?> c = lc.getDeclaredConstructor(int.class);
        c.setAccessible(true);
        Field next = lc.getDeclaredField("next");
        next.setAccessible(true);
        Object head = null, tail = null;
        for (JsonNode e : n) {
            Object node = c.newInstance(e.asInt());
            if (head == null) { head = node; tail = node; }
            else { next.set(tail, node); tail = node; }
        }
        return head;
    }

    /** JSON 层序数组（含 null）→ TreeNode。 */
    private static Object buildTree(JsonNode n, ClassLoader cl) throws Exception {
        if (n == null || n.isNull() || n.size() == 0 || n.get(0).isNull()) return null;
        Class<?> tc = cl.loadClass("TreeNode");
        Constructor<?> c = tc.getDeclaredConstructor(int.class);
        c.setAccessible(true);
        Field left = tc.getDeclaredField("left"), right = tc.getDeclaredField("right");
        left.setAccessible(true);
        right.setAccessible(true);

        Object root = c.newInstance(n.get(0).asInt());
        // 同样用 LinkedList：这里目前只 add 非空节点，是安全的，
        // 但序列化那边已经因为 ArrayDeque 收 null 炸过一次，两边保持一致省得以后又踩。
        Deque<Object> q = new java.util.LinkedList<>();
        q.add(root);
        int i = 1;
        while (!q.isEmpty() && i < n.size()) {
            Object cur = q.poll();
            if (i < n.size()) {
                JsonNode v = n.get(i++);
                if (!v.isNull()) {
                    Object l = c.newInstance(v.asInt());
                    left.set(cur, l);
                    q.add(l);
                }
            }
            if (i < n.size()) {
                JsonNode v = n.get(i++);
                if (!v.isNull()) {
                    Object r = c.newInstance(v.asInt());
                    right.set(cur, r);
                    q.add(r);
                }
            }
        }
        return root;
    }

    // ------------------------------------------------------------------ 结果序列化（同样全程反射）

    private static String serialize(Object o) {
        if (o == null) return "null";
        if (o instanceof Integer || o instanceof Long || o instanceof Short || o instanceof Byte) return String.valueOf(o);
        if (o instanceof Boolean || o instanceof Double || o instanceof Float) return String.valueOf(o);
        if (o instanceof String) return "\"" + o + "\"";
        if (o instanceof Character) return "\"" + o + "\"";
        if (o instanceof int[]) return Arrays.toString((int[]) o).replace(" ", "");
        if (o instanceof boolean[]) return Arrays.toString((boolean[]) o).replace(" ", "");
        if (o instanceof double[]) return Arrays.toString((double[]) o).replace(" ", "");
        if (o instanceof char[]) {
            List<String> parts = new ArrayList<>();
            for (char c : (char[]) o) parts.add("\"" + c + "\"");
            return "[" + String.join(",", parts) + "]";
        }
        if (o instanceof Object[]) {
            List<String> parts = new ArrayList<>();
            for (Object e : (Object[]) o) parts.add(serialize(e));
            return "[" + String.join(",", parts) + "]";
        }
        if (o instanceof Collection) {
            List<String> parts = new ArrayList<>();
            for (Object e : (Collection<?>) o) parts.add(serialize(e));
            return "[" + String.join(",", parts) + "]";
        }
        String cn = o.getClass().getSimpleName();
        if ("ListNode".equals(cn)) return serializeList(o);
        if ("TreeNode".equals(cn)) return serializeTree(o);
        return String.valueOf(o);
    }

    private static String serializeList(Object head) {
        List<String> parts = new ArrayList<>();
        try {
            Class<?> lc = head.getClass();
            Field val = lc.getDeclaredField("val"), next = lc.getDeclaredField("next");
            val.setAccessible(true);
            next.setAccessible(true);
            Object cur = head;
            int guard = 0;
            while (cur != null && guard++ < 100000) {
                parts.add(String.valueOf(val.getInt(cur)));
                cur = next.get(cur);
            }
        } catch (Exception e) {
            return "null";
        }
        return "[" + String.join(",", parts) + "]";
    }

    private static String serializeTree(Object root) {
        if (root == null) return "[]";
        List<String> parts = new ArrayList<>();
        try {
            Class<?> tc = root.getClass();
            Field val = tc.getDeclaredField("val"), left = tc.getDeclaredField("left"), right = tc.getDeclaredField("right");
            val.setAccessible(true);
            left.setAccessible(true);
            right.setAccessible(true);
            // 用 LinkedList 而不是 ArrayDeque —— ArrayDeque 不接受 null 元素，
            // 而叶子节点的 left/right 就是 null。之前这里静默抛 NPE 被 catch 成 "[]"，
            // 于是每道树题都判「答案错」，把正确的提交全冤枉了。
            Deque<Object> q = new java.util.LinkedList<>();
            q.add(root);
            while (!q.isEmpty()) {
                Object cur = q.poll();
                if (cur == null) { parts.add("null"); continue; }
                parts.add(String.valueOf(val.getInt(cur)));
                q.add(left.get(cur));
                q.add(right.get(cur));
            }
            // 去掉尾部 null，和力扣的显示一致
            while (!parts.isEmpty() && "null".equals(parts.get(parts.size() - 1))) parts.remove(parts.size() - 1);
        } catch (Exception e) {
            // 以前这里 return "[]"，把序列化失败伪装成「空树」，于是每道树题都判错。
            // 现在显式说明是判题器的问题，让上层能识别出来，不要扣用户的分。
            return "「判题器序列化这棵树时出错：" + e.getClass().getSimpleName() + "，这一条不算你的错」";
        }
        return "[" + String.join(",", parts) + "]";
    }

    // ------------------------------------------------------------------ 杂项

    private static String firstLine(String s) {
        if (s == null) return "";
        int i = s.indexOf('\n');
        return i < 0 ? s : s.substring(0, i);
    }

    private static Path newOutDir() throws Exception {
        List<Path> candidates = new ArrayList<>();
        String tmp = System.getProperty("java.io.tmpdir");
        if (tmp != null && !tmp.isBlank()) candidates.add(Path.of(tmp));
        candidates.add(Path.of("data", "grade-tmp"));
        Exception last = null;
        for (Path base : candidates) {
            try {
                Files.createDirectories(base);
                return Files.createTempDirectory(base, "judge");
            } catch (Exception e) { last = e; }
        }
        throw last == null ? new java.io.IOException("没有可写的临时目录") : last;
    }

    private static void deleteQuietly(Path p) {
        if (p == null) return;
        try (Stream<Path> s = Files.walk(p)) {
            List<Path> all = s.sorted(Comparator.reverseOrder()).collect(Collectors.toList());
            for (Path x : all) { try { Files.deleteIfExists(x); } catch (Exception ignored) { } }
        } catch (Exception ignored) { }
    }
}
