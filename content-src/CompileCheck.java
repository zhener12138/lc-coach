import javax.tools.*;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import java.util.stream.*;

/**
 * 校验模板库里的 Java 代码。
 *
 * 模板库里有两种东西，必须分开验，否则这个工具就是在自欺欺人：
 *
 *   【可执行模板】带方法体，能直接贴进力扣跑 —— 必须真编译通过
 *   【速查片段】  `x & (-x)`、`(x & 1) == 1` 这种表达式笔记，
 *                 本来就不是完整程序，编译不过不是错；
 *                 但仍要检查括号配对、注释未闭合这种低级错
 *
 * 判定：含「返回类型 + 方法名 + 参数 + 方法体左括号」就算可执行模板。
 *
 * 为什么不 spawn javac 命令：沙箱里 EPERM，只有 JVM 内部
 * ToolProvider.getSystemJavaCompiler() 可用。
 */
public class CompileCheck {

    static final String BASE = "http://127.0.0.1:8099";

    /** 形如 `int[] f(int[] a) {` 或 `public void f() {` —— 说明它在写一个真方法 */
    static final Pattern HAS_METHOD = Pattern.compile(
            "^[^/\\n]*\\b[A-Za-z_$][\\w$<>\\[\\],\\s\\.]*\\s+[A-Za-z_$][\\w$]*\\s*\\([^)]*\\)\\s*\\{",
            Pattern.MULTILINE);
    static final Pattern HAS_TYPE = Pattern.compile(
            "^\\s*(public\\s+|private\\s+|protected\\s+|static\\s+|final\\s+|abstract\\s+)*"
          + "(class|interface|enum|record)\\s",
            Pattern.MULTILINE);

    static final String IMPORTS =
            "import java.util.*;\nimport java.util.function.*;\nimport java.util.stream.*;\n";

    public static void main(String[] args) throws Exception {
        List<Map<String, String>> items = parse(get(BASE + "/api/snippets"));
        System.out.println("检查 " + items.size() + " 段模板…\n");

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            System.out.println("❌ 拿不到 JavaCompiler —— 当前不是 JDK？");
            return;
        }

        Path tmp = Files.createTempDirectory("snipchk-");
        int ok = 0, frag = 0, bad = 0;
        List<String> fails = new ArrayList<>();
        List<String[]> fragList = new ArrayList<>();

        for (Map<String, String> it : items) {
            String cat = it.getOrDefault("category", "");
            String title = it.getOrDefault("title", "");
            String code = it.getOrDefault("code", "").trim();
            if (code.isEmpty()) continue;

            // 括号/引号/注释闭合是所有模板的底线，不论哪种类型都要过
            String bracketErr = checkBrackets(code);
            if (bracketErr != null) {
                bad++;
                System.out.println("  ❌ " + cat + " / " + title + "  ← " + bracketErr);
                fails.add(title + " → " + bracketErr);
                continue;
            }

            boolean runnable = HAS_METHOD.matcher(code).find() || HAS_TYPE.matcher(code).find();

            if (!runnable) {
                frag++;
                fragList.add(new String[]{cat + " / " + title, "纯表达式速查，不是完整程序"});
                System.out.println("  ○  速查 " + cat + " / " + title);
                continue;
            }

            List<String> variants = new ArrayList<>();
            variants.add(IMPORTS + code);
            if (!HAS_TYPE.matcher(code).find()) {
                variants.add(IMPORTS + "class Solution {\n" + code + "\n}");
            }

            Result r = null;
            for (String src : variants) {
                r = compileOne(compiler, tmp, src);
                if (r.ok) break;
            }

            if (r != null && r.ok) {
                ok++;
                System.out.println("  ✅ 可编译 " + cat + " / " + title);
                continue;
            }

            // 编译不过：区分「依赖外部符号的片段」和「真写错了」
            // 依赖外部（找不到符号 / 顶层语句 / 中文占位符）→ 片段，不是错
            // 其余（语法级错误）→ 真错误
            List<String> missing = new ArrayList<>();
            boolean fragmentish = false;
            if (r != null) {
                for (Err e : r.errors) {
                    String m = e.msg;
                    if (m.contains("找不到符号") || m.contains("程序包") && m.contains("不存在")) {
                        fragmentish = true;
                    } else if (m.contains("非法的类型开始") || m.contains("需要<标识符>")
                            || m.contains("需要']'") || m.contains("未命名类")
                            || m.contains("类, 接口或枚举") ) {
                        fragmentish = true;   // 顶层散语句，本身就是片段写法
                    }
                }
                missing.addAll(symbolsOf(r.errors));
            }
            boolean placeholder = PLACEHOLDER.matcher(code).find();

            if (fragmentish || placeholder) {
                frag++;
                List<String> why = new ArrayList<>();
                if (placeholder) why.add("含中文占位符（伪代码写法）");
                if (!missing.isEmpty()) why.add("依赖外部符号 " + String.join("、", missing));
                if (why.isEmpty()) why.add("顶层散语句，不是完整类");
                String reason = String.join("；", why);
                fragList.add(new String[]{cat + " / " + title, reason});
                System.out.println("  ○  片段 " + cat + " / " + title + "  ← " + reason);
            } else {
                bad++;
                String msg = (r == null || r.errors.isEmpty())
                        ? "编译失败但没给出错误"
                        : "第 " + r.errors.get(0).line + " 行：" + r.errors.get(0).msg;
                System.out.println("  ❌ " + cat + " / " + title + "  ← " + msg);
                fails.add(title + " → " + msg);
            }
        }

        deleteTree(tmp);
        System.out.println("\n" + "=".repeat(58));
        System.out.println("可编译 " + ok + " / 片段（按设计如此）" + frag + " / 真错误 " + bad);
        if (!fragList.isEmpty()) {
            System.out.println("\n片段清单 —— 这些是教学示意，贴进力扣前要自己补上下文：");
            for (String[] f : fragList) System.out.println("  · " + f[0] + "\n      " + f[1]);
        }
        if (!fails.isEmpty()) {
            System.out.println("\n真错误清单：");
            fails.forEach(f -> System.out.println("  - " + f));
        }

        // 把判定结果落成前端能读的文件：前端不该自己再写一套正则，
        // 否则两套规则迟早漂移，界面上标「可编译」而实际编译不过。
        writeKinds(ok, frag, bad);
        if (bad > 0) System.exit(1);
    }

    /** 生成 static/snippet-kinds.json：{ "分类/标题": {"kind":"runnable|fragment|broken", "reason":"..."} } */
    static void writeKinds(int ok, int frag, int bad) throws Exception {
        // 重新扫一遍只为收集 kind（上面的循环是打印用的，不保存状态）
        Map<String, String[]> kinds = new LinkedHashMap<>();
        List<Map<String, String>> items = parse(get(BASE + "/api/snippets"));
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        Path tmp = Files.createTempDirectory("snipkind-");
        for (Map<String, String> it : items) {
            String key = it.getOrDefault("category", "") + " / " + it.getOrDefault("title", "");
            String code = it.getOrDefault("code", "").trim();
            if (code.isEmpty()) continue;
            if (checkBrackets(code) != null) { kinds.put(key, new String[]{"broken", "括号或注释没闭合"}); continue; }
            boolean runnable = HAS_METHOD.matcher(code).find() || HAS_TYPE.matcher(code).find();
            if (!runnable) { kinds.put(key, new String[]{"fragment", "速查表达式，不是完整程序"}); continue; }

            List<String> variants = new ArrayList<>();
            variants.add(IMPORTS + code);
            if (!HAS_TYPE.matcher(code).find()) variants.add(IMPORTS + "class Solution {\n" + code + "\n}");
            Result r = null;
            for (String src : variants) { r = compileOne(compiler, tmp, src); if (r.ok) break; }

            if (r != null && r.ok) { kinds.put(key, new String[]{"runnable", ""}); continue; }

            boolean fragmentish = false;
            for (Err e : r == null ? List.<Err>of() : r.errors) {
                String m = e.msg;
                if (m.contains("找不到符号") || (m.contains("程序包") && m.contains("不存在"))
                        || m.contains("非法的类型开始") || m.contains("需要<标识符>")
                        || m.contains("需要']'") || m.contains("未命名类") || m.contains("类, 接口或枚举")) {
                    fragmentish = true;
                }
            }
            if (fragmentish || PLACEHOLDER.matcher(code).find()) {
                List<String> why = new ArrayList<>();
                if (PLACEHOLDER.matcher(code).find()) why.add("含中文占位符");
                if (r != null && !r.errors.isEmpty()) why.add("依赖外部变量/类");
                kinds.put(key, new String[]{"fragment", String.join("，", why)});
            } else {
                kinds.put(key, new String[]{"broken", r == null || r.errors.isEmpty() ? "编译失败" : r.errors.get(0).msg});
            }
        }
        deleteTree(tmp);

        StringBuilder sb = new StringBuilder();
        sb.append("{\n  \"generatedAt\": \"").append(java.time.LocalDateTime.now().withNano(0)).append("\",\n");
        sb.append("  \"summary\": {\"runnable\": ").append(ok).append(", \"fragment\": ").append(frag)
          .append(", \"broken\": ").append(bad).append("},\n");
        sb.append("  \"kinds\": {\n");
        int i = 0;
        for (Map.Entry<String, String[]> e : kinds.entrySet()) {
            sb.append("    \"").append(js(e.getKey())).append("\": {\"kind\": \"").append(e.getValue()[0])
              .append("\", \"reason\": \"").append(js(e.getValue()[1])).append("\"}");
            if (++i < kinds.size()) sb.append(",");
            sb.append("\n");
        }
        sb.append("  }\n}\n");

        Path out = Paths.get("static", "snippet-kinds.json");
        Files.createDirectories(out.getParent());
        Files.writeString(out, sb.toString(), StandardCharsets.UTF_8);
        System.out.println("\n已写 " + out.toAbsolutePath());
    }

    static String js(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "").replace("\t", "\\t");
    }

    /** 中文占位符：说明这段是伪代码骨架，本来就不能编译 */
    static final Pattern PLACEHOLDER = Pattern.compile(
            "(参数|选择列表|选择|满足结束条件|处理|此处|省略|伪代码|\\.\\.\\.|…|\\.\\.\\s*\\.)");

    /** 从编译错误里抠出「找不到符号」的符号名 */
    static List<String> symbolsOf(List<Err> errs) {
        List<String> out = new ArrayList<>();
        for (Err e : errs) {
            Matcher m = Pattern.compile("符号:\\s*(?:变量|方法|类)\\s*(\\S+)").matcher(e.msg);
            while (m.find()) {
                String s = m.group(1).replaceAll("[^A-Za-z0-9_$]", "");
                if (!s.isEmpty() && !out.contains(s)) out.add(s);
            }
        }
        return out;
    }

    /** 括号 / 引号 / 块注释是否闭合。返回 null 表示没问题。 */
    static String checkBrackets(String code) {
        Deque<Character> st = new ArrayDeque<>();
        boolean inLine = false, inBlock = false, inStr = false, inChar = false;
        for (int i = 0; i < code.length(); i++) {
            char c = code.charAt(i);
            char n = i + 1 < code.length() ? code.charAt(i + 1) : '\0';
            if (inLine) { if (c == '\n') inLine = false; continue; }
            if (inBlock) { if (c == '*' && n == '/') { inBlock = false; i++; } continue; }
            if (inStr || inChar) {
                if (c == '\\') { i++; continue; }
                if (inStr && c == '"') inStr = false;
                if (inChar && c == '\'') inChar = false;
                continue;
            }
            if (c == '/' && n == '/') { inLine = true; i++; continue; }
            if (c == '/' && n == '*') { inBlock = true; i++; continue; }
            if (c == '"') { inStr = true; continue; }
            if (c == '\'') { inChar = true; continue; }
            if (c == '(' || c == '[' || c == '{') st.push(c);
            else if (c == ')' || c == ']' || c == '}') {
                if (st.isEmpty()) return "多了一个 " + c;
                char open = st.pop();
                boolean match = (open == '(' && c == ')') || (open == '[' && c == ']') || (open == '{' && c == '}');
                if (!match) return "括号不配对：" + open + " 被 " + c + " 关闭";
            }
        }
        if (!st.isEmpty()) return "有 " + st.size() + " 个括号没闭合";
        if (inBlock) return "块注释没闭合";
        if (inStr) return "字符串没闭合";
        return null;
    }

    record Err(long line, String msg) { }
    record Result(boolean ok, List<Err> errors) { }

    static Result compileOne(JavaCompiler compiler, Path tmp, String src) throws IOException {
        Path f = tmp.resolve("Solution.java");
        Files.writeString(f, src, StandardCharsets.UTF_8);

        DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
        StandardJavaFileManager fm = compiler.getStandardFileManager(diags, null, StandardCharsets.UTF_8);
        boolean passed;
        try {
            Iterable<? extends JavaFileObject> units = fm.getJavaFileObjectsFromFiles(List.of(f.toFile()));
            List<String> opts = List.of("-d", tmp.toString(), "-encoding", "UTF-8",
                    "-proc:none", "-nowarn", "-Xlint:none");
            passed = compiler.getTask(new StringWriter(), fm, diags, opts, null, units).call();
        } finally {
            fm.close();
        }

        try (Stream<Path> s = Files.list(tmp)) {
            s.filter(p -> p.toString().endsWith(".class")).forEach(p -> {
                try { Files.deleteIfExists(p); } catch (IOException ignore) { }
            });
        }

        List<Err> errs = new ArrayList<>();
        for (Diagnostic<? extends JavaFileObject> d : diags.getDiagnostics()) {
            if (d.getKind() == Diagnostic.Kind.ERROR) {
                errs.add(new Err(d.getLineNumber(), d.getMessage(Locale.CHINA).split("\n")[0]));
            }
        }
        return new Result(passed, errs);
    }

    // ---------- 极简 JSON 解析 ----------

    static String get(String url) throws Exception {
        HttpClient c = HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(10)).build();
        HttpRequest r = HttpRequest.newBuilder(URI.create(url))
                .header("Accept", "application/json")
                .timeout(java.time.Duration.ofSeconds(30)).GET().build();
        return c.send(r, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).body();
    }

    static List<Map<String, String>> parse(String json) {
        List<Map<String, String>> out = new ArrayList<>();
        int i = 0, n = json.length();
        while (i < n && json.charAt(i) != '[') i++;
        i++;
        while (i < n) {
            while (i < n && (Character.isWhitespace(json.charAt(i)) || json.charAt(i) == ',')) i++;
            if (i >= n || json.charAt(i) == ']') break;
            if (json.charAt(i) != '{') { i++; continue; }
            i++;
            Map<String, String> m = new LinkedHashMap<>();
            while (i < n && json.charAt(i) != '}') {
                while (i < n && (Character.isWhitespace(json.charAt(i)) || json.charAt(i) == ',')) i++;
                if (i >= n || json.charAt(i) == '}') break;
                if (json.charAt(i) != '"') { i++; continue; }
                StringBuilder key = new StringBuilder();
                i = readString(json, i, key);
                while (i < n && (Character.isWhitespace(json.charAt(i)) || json.charAt(i) == ':')) i++;
                if (i < n && json.charAt(i) == '"') {
                    StringBuilder val = new StringBuilder();
                    i = readString(json, i, val);
                    m.put(key.toString(), val.toString());
                } else {
                    int st = i;
                    while (i < n && json.charAt(i) != ',' && json.charAt(i) != '}') i++;
                    m.put(key.toString(), json.substring(st, i).trim());
                }
            }
            if (i < n) i++;
            out.add(m);
        }
        return out;
    }

    static int readString(String s, int i, StringBuilder sb) {
        i++;
        while (i < s.length()) {
            char ch = s.charAt(i);
            if (ch == '\\') {
                char nx = s.charAt(i + 1);
                switch (nx) {
                    case 'n' -> sb.append('\n');
                    case 't' -> sb.append('\t');
                    case 'r' -> sb.append('\r');
                    case 'u' -> { sb.append((char) Integer.parseInt(s.substring(i + 2, i + 6), 16)); i += 4; }
                    default -> sb.append(nx);
                }
                i += 2;
            } else if (ch == '"') {
                return i + 1;
            } else {
                sb.append(ch);
                i++;
            }
        }
        return i;
    }

    static void deleteTree(Path p) {
        try (Stream<Path> s = Files.walk(p)) {
            s.sorted(Comparator.reverseOrder()).forEach(x -> {
                try { Files.deleteIfExists(x); } catch (IOException ignore) { }
            });
        } catch (IOException ignore) { }
    }
}
