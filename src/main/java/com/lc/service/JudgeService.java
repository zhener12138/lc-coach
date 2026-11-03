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

            Verdict v = execute(refCode, j);
            if (!v.compiled) { return miss(j, "参考解编译不过：" + firstLine(v.compileError != null ? v.compileError : v.reason)); }
            // 算期望值这一趟没有比对对象，passed 天然是 0，所以不能看 passed 判断成败 ——
            // 要看「每个用例都拿到了输出」。
            if (v.outputs.size() != v.total || v.outputs.contains(null)) {
                return miss(j, "参考解没能跑出全部用例的答案，不能拿它当标准");
            }
            j.expected.addAll(v.outputs);
            // 顺序无关：只有哈希表类题目（两数之和这种，答案顺序本来就不唯一）。
            // 排序题不能用这个 —— 那里顺序就是对错本身。
            j.orderFree = prob.path("tags").asText("").contains("哈希表");
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
                // 原地修改型题目：把（复制过的）入参再序列化回来
                String printed = cap.toString(StandardCharsets.UTF_8).trim();
                List<String> parts = new ArrayList<>();
                for (Object a : args) parts.add(serialize(a));
                String argsStr = parts.size() == 1 ? parts.get(0) : "[" + String.join(",", parts) + "]";
                // 有 System.out 输出就以输出为准（比如要求打印的题），否则看入参
                return printed.isEmpty() ? argsStr : printed;
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

    private static boolean same(String got, String want, boolean orderFree) {
        if (got == null) return false;
        String a = canon(got), b = canon(want);
        if (a.equals(b)) return true;
        if (!orderFree) return false;
        // 只有题目明确顺序无关时才比「排序后是否一致」
        return canon(sortedForm(got)).equals(canon(sortedForm(want)));
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
        Deque<Object> q = new ArrayDeque<>();
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
            Deque<Object> q = new ArrayDeque<>();
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
            return "[]";
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
