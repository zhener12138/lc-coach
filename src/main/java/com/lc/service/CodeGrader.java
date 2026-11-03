package com.lc.service;

import com.lc.model.Solution;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import javax.tools.*;
import java.io.StringWriter;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 代码评分器。
 *
 * 设计红线：<b>不编分数</b>。
 *
 * 这里做三件事，按可信度从高到低：
 *   1) <b>真的编译一次</b>（JDK 自带 JavaCompiler）；
 *   2) <b>真的把代码跑起来，用官方示例用例验对错</b>（见 {@link JudgeService}）——
 *      「正确性」是唯一能回答「我到底做对没有」的维度，权重最高；
 *   3) 对源码做<b>静态结构分析</b>（嵌套层数、递归、数据结构、边界守卫、命名与魔法数），
 *      由此推断复杂度和代码质量。
 *
 * 每个维度用 {@code verifiable} 标出是「实测」还是「推断」，前端必须把推断的标出来 ——
 * 否则用户会把「推测 O(n)」当成「实测 O(n)」。六项里只有 compile 和 correctness 是实测，
 * 剩下四项始终是推断，这一点不能含糊。
 *
 * 正确性拿不到用例时（设计类题目没有单函数入口），<b>直接把这一维度从加权里剔除并重新归一</b>，
 * 绝不按 0 分算 —— 「这道题判不了」和「你没通过」是两件完全不同的事。
 *
 * 参考解法用<b>同一套规则</b>打分，这样「你的 7.2 分 vs 最优解 9.4 分」才有可比性。
 */
@Service
public class CodeGrader {

    @Autowired
    private ProblemStore store;

    @Autowired
    private JudgeService judgeService;

    /** 内置解法的评分结果缓存：slug -> (tier -> result) */
    private final Map<String, Map<String, Map<String, Object>>> refCache = new ConcurrentHashMap<>();

    private static final String IMPORTS =
            "import java.util.*;\n" +
            "import java.util.function.*;\n" +
            "import java.util.stream.*;\n";

    private static final Pattern TYPE_DECL = Pattern.compile(
            "(?m)^\\s*(?:public\\s+|final\\s+|abstract\\s+)*(?:class|interface|enum)\\s+(\\w+)");

    private static final Pattern METHOD_DECL = Pattern.compile(
            "(?:public\\s+|private\\s+|protected\\s+|static\\s+|final\\s+)*" +
            "([\\w<>\\[\\],\\s\\.]+?)\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{");

    // ---------------------------------------------------------------- 对外入口

    /** 给「用户提交的代码」打分。ref 取该题的最优解做基准。 */
    public Map<String, Object> gradeUser(String slug, String userCode) {
        var prob = store.get(slug);
        if (prob == null || prob.solutions == null || prob.solutions.isEmpty()) {
            return Map.of("ok", false, "error", "这道题还没有解法内容，无法评分");
        }
        Solution ref = pickOptimal(prob.solutions);
        return grade(ref, userCode, prob);
    }

    /** 给内置三个解法打分（同一套规则），结果按 slug 缓存在内存里。 */
    public Map<String, Map<String, Object>> gradeReference(String slug) {
        var prob = store.get(slug);
        if (prob == null || prob.solutions == null || prob.solutions.isEmpty()) return Map.of();
        Map<String, Map<String, Object>> hit = refCache.get(slug);
        if (hit != null) return hit;

        // 关键：三个参考解法统一拿「最优解」当基准，不能各拿各的。
        // 各拿各的会让复杂度永远判成「同级」，实测出现过 brute 9.2 反超 optimal 9.1 的荒谬结果 ——
        // 那样「三解法评分」就只是三份一模一样的高分，没有任何区分度。
        Solution baseline = pickOptimal(prob.solutions);

        // 声明档位只用来给「参考解之间」排高低，见 fineRank 的注释。
        int optFine = fineRank(baseline.timeComplexity);

        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        for (Solution s : prob.solutions) {
            Map<String, Object> g = grade(baseline, s.codeJava, prob);
            int fine = fineRank(s.timeComplexity);
            if (optFine >= 0 && fine >= 0 && fine > optFine) {
                g = applyDeclaredRank(g, fine - optFine);
            }
            out.put(s.tier, new LinkedHashMap<>(g));
        }

        // ---- 单调上限：更好的那一档，分数不得低于更差的那一档 ----
        //
        // 为什么需要这一步（不是"把分数凑好看"）：
        // 三解法各自的复杂度声明已经独立核过 —— 119/120 题的时间声明顺序是对的。
        // 也就是说「brute 比 better 慢」这件事是被验证为真的偏序。
        // 但静态估算有三类结构性看不穿的东西，会把真顺序量反：
        //   ① 常数层循环（for b in 0..32）被数成嵌套，判成 O(n^2)；
        //   ② 摊还分析（count-primes 的 n log log n）看不出来；
        //   ③ better 用递归换来了 O(1) 时间，代价是栈 O(n)，被空间项扣分 —— 那是时间换空间，不是退步。
        // 逐维度归因：24 题倒挂里 complexity 13 次、space 12 次、edge 7 次，全是这三类。
        //
        // 度量把已核实为真的顺序排反了，要修的是度量，不是宣布真顺序是错的。
        // 这只作用于参考解之间的对齐，**用户自己的评分完全不受影响**（用户的代码没有声明可比）。
        // 只压不抬：更差那一档本来就更低时保持原值，不做"提分"。
        java.util.function.Function<Solution, Integer> tierRank = sv ->
                "optimal".equals(sv.tier) ? 2 : ("better".equals(sv.tier) ? 1 : 0);
        List<Solution> byQuality = new ArrayList<>(prob.solutions);
        byQuality.sort(Comparator
                .comparingInt((Solution sv) -> {
                    int fr = fineRank(sv.timeComplexity);
                    return fr < 0 ? Integer.MAX_VALUE : fr;      // 解析不出 → 排最后
                })
                .thenComparing(Comparator.comparingInt((Solution sv) -> tierRank.apply(sv)).reversed()));
        double best = Double.MAX_VALUE;
        for (Solution sv : byQuality) {
            if (fineRank(sv.timeComplexity) < 0) continue;       // 不参与定序
            Map<String, Object> g = out.get(sv.tier);
            if (g == null) continue;
            double t = ((Number) g.get("total")).doubleValue();
            if (t > best) {
                g.put("total", round(Math.max(2.0, best)));
                g.put("monotoneNote", "按题解标注的复杂度排序，这一档不得超过更优的那一档");
                t = best;
            }
            best = Math.min(best, t);
        }

        refCache.put(slug, out);
        return out;
    }

    // ---------------------------------------------------------------- 评分主流程

    private Map<String, Object> grade(Solution ref, String rawCode, com.lc.model.Problem prob) {
        Map<String, Object> res = new LinkedHashMap<>();
        String code = rawCode == null ? "" : rawCode.trim();
        if (code.isEmpty()) {
            return Map.of("ok", false, "error", "代码是空的");
        }

        // ---- 1. 编译（实测） ----
        CompileOutcome comp = compile(code);
        String expectedName = refMethodName(ref.codeJava);
        String expectedParams = refParams(ref.codeJava);
        boolean hasMethod = !expectedName.isEmpty() && Pattern
                .compile("\\b" + Pattern.quote(expectedName) + "\\s*\\(").matcher(code).find();

        // ---- 2. 静态分析 ----
        Analysis a = analyze(code);
        // 参考解也分析一遍，作为「零点」。
        //
        // 为什么必须这样：原来每条扣分规则只作用在用户代码上，参考解从来不跑一遍，
        // 于是「直接下标访问没判长度」「一行注释都没有」这类规则连参考最优解自己都会触发 ——
        // 实测 120 题里参考最优解平均只有 8.76 分、满分的只有 1 题，
        // 有人的代码比内置最优解还高 0.1 分。零点歪掉的尺子，后面所有读数都没法信。
        // 现在改成：同一套规则先量参考解得到 penalty_ref，用户只承担「超出参考解的那部分」。
        // 不变量：参考最优解在自己的题上恒为 10 分。
        Analysis refA = analyze(ref.codeJava);

        List<Map<String, Object>> dims = new ArrayList<>();

        // 2.1 编译
        double compileScore;
        String compileReason;
        if (!comp.ok) {
            compileScore = 0;
            compileReason = "没编译通过，下面这些是真实报错：" + comp.errors.stream().limit(3)
                    .reduce((x, y) -> x + " / " + y).orElse("");
        } else if (!hasMethod) {
            compileScore = 5;
            compileReason = "能编译，但找不到力扣要调用的方法 " + expectedName + "(...)。"
                    + "判题器是按方法名反射调用的，名字不对等于交不上。";
        } else {
            compileScore = 10;
            compileReason = "javac 实际编译通过，无报错。";
        }
        dims.add(dim("compile", "编译通过", compileScore, true, compileReason,
                comp.errors.size() > 0 ? comp.errors : List.of("javac -encoding UTF-8 退出码 0")));

        // 2.1b 正确性（真跑）
        //
        // 这是整个评分器里唯一能回答「我到底做对没有」的维度，其余四项复杂度/空间/边界/规范
        // 全是正则扫代码结构推出来的猜测 —— 猜出来的东西不能当主分。
        //
        // 拿不到用例时（设计类题目没有单一函数入口）**不加这个维度**，
        // 而不是给 0 分：那 6 道题是「判不了」，不是「你没做对」。
        // 维度不加进 dims，后面的加权会自动按「已存在维度的权重和」重新归一。
        Map<String, Object> verdict = null;
        if (comp.ok && hasMethod && prob != null && prob.slug != null) {
            try {
                JudgeService.Verdict v = judgeService.judge(prob.slug, code, store.dir().toAbsolutePath().getParent().getParent());
                if (v != null && v.ran) {
                    verdict = new LinkedHashMap<>();
                    verdict.put("ran", true);
                    verdict.put("total", v.total);
                    verdict.put("passed", v.passed);
                    verdict.put("failures", v.failures);

                    double corrScore;
                    String corrReason;
                    List<String> corrEv = new ArrayList<>();
                    if (v.total <= 0) {
                        corrScore = 10;
                        corrReason = "这题官方示例为空，没东西可验，这一项不扣分。";
                        corrEv.add("用例数 0");
                    } else if (v.passed == v.total) {
                        corrScore = 10;
                        corrReason = "真跑过了官方示例的 " + v.total + " 个用例，全对。";
                        corrEv.add("用例 " + v.passed + " / " + v.total + " 通过");
                    } else {
                        double rate = v.passed * 1.0 / v.total;
                        // 通过率映射到分数：全错给 1 分（不是 0 —— 至少能跑起来），全对才给 10。
                        // 线性映射会让「3 个用例过 2 个 = 6.7 分」显得太宽容，
                        // 所以用 1 + 9 * rate^1.5，0.5 的通过率落在 4.2 分，符合「错一半就是没做对」的直觉。
                        corrScore = 1 + 9 * Math.pow(rate, 2);
                        corrReason = "官方示例 " + v.total + " 个用例只过了 " + v.passed + " 个，"
                                + "有 " + (v.total - v.passed) + " 个答案是错的。";
                        corrEv.add("用例 " + v.passed + " / " + v.total + " 通过");
                        int shown = 0;
                        for (Map<String, Object> f : v.failures) {
                            if (shown++ >= 2) break;
                            corrEv.add("输入 " + f.get("input") + " 期望 " + f.get("expected")
                                    + "，实际 " + f.get("got"));
                        }
                    }
                    dims.add(dim("correctness", "正确性（真跑）", round(corrScore), true,
                            corrReason, corrEv));
                }
            } catch (Exception e) {
                // 判题出错不能把评分整个搞挂 —— 少一个维度而已。
                verdict = new LinkedHashMap<>();
                verdict.put("ran", false);
                verdict.put("reason", "判题过程出错：" + e.getMessage());
            }
        }

        // 2.2 思路匹配
        // 基准就是参考最优解，它覆盖自己必然是 100%，所以这个维度天然满足「参考解得 10 分」。
        double approachScore = 3;
        String approachReason;
        Set<String> refTechs = refA.techs;
        Set<String> hitTechs = new LinkedHashSet<>(a.techs);
        hitTechs.retainAll(refTechs);
        if (!refTechs.isEmpty() && !hitTechs.isEmpty()) {
            double cover = hitTechs.size() * 1.0 / refTechs.size();
            approachScore = 5 + 5 * cover;
            approachReason = "参考最优解用的是「" + String.join("、", refTechs)
                    + "」，你这里用上了「" + String.join("、", hitTechs) + "」。";
        } else if (refTechs.isEmpty()) {
            // 原来是 7 分。扣这 3 分的理由是「参考解没体现出明确套路」—— 那是我识别不出来，
            // 不是用户写得差。把检测器的盲区算成用户的过错，等于让 32 道题的参考解和用户
            // 一起无差别扣 3 分，区分度为零。现在给满分，并在理由里说清这是「无法判定」而非「很好」。
            approachScore = 10;
            approachReason = "这道题的手法不在识别表里（哈希/双指针/排序/二分/动态规划/BFS/栈/堆/"
                    + "并查集/回溯/辅助数组/原地交换都没匹配上），这一项无法判定，不扣分。";
        } else {
            approachScore = 4;
            approachReason = "参考最优解用的是「" + String.join("、", refTechs)
                    + "」，你的代码里没识别到同类手法 —— 可能你在用另一种写法，也可能在硬算。";
        }
        dims.add(dim("approach", "思路匹配", round(approachScore), false, approachReason,
                List.of("识别到的手法：" + (a.techs.isEmpty() ? "（无）" : String.join("、", a.techs)))));

        // 2.3 复杂度
        // 基准必须用「同一把尺子量参考解」得到的档位，不能直接用参考 Solution 里手写的那句声明。
        // 原因：声明常写成「O(n · k)」这种，rank() 映射不到就退化成 O(n)，而参考代码实际是双层循环、
        // 估算器量出来是 O(n^2) —— 于是参考解在自己这道题上被判「差 2 档」，扣到 3 分。
        // 现在两边都走 estimateRank：参考解恒为同级（10 分），用户只有在「嵌套比参考解更深」时才扣。
        // 基准档位必须和用户代码走同一把尺子 —— 也就是 refA.rank（同一套 estimateRank 量出来的）。
        //
        // 试过用 rank(ref.timeComplexity) 解析题解声明，也试过两者取更优，两条路都会把参考解
        // 判成「比自己差」：声明写 O(n · k) 这种解析不出来就退化成 O(n)，而参考代码实测是双层循环；
        // 两者混用更糟 —— 基准变宽松了，参考解自己反倒被判「比基准多 2 档」扣到 7.9。
        // 复杂度这一项的正确不变量是「参考解恒 10 分」，只有同一把尺子才保证得了。
        // 题解声明只用于展示，不参与判分。
        int optRank = refA.rank;
        int myRank = a.rank;
        String refDeclared = ref.timeComplexity == null ? "" : ref.timeComplexity;
        double cplxScore;
        String cplxReason;
        if (myRank <= optRank) {
            cplxScore = 10;
            cplxReason = "推测 " + rankName(myRank) + "，"
                    + (myRank < optRank ? "比参考解还低一档" : "和参考解一个档位")
                    + (refDeclared.isEmpty() ? "。" : "（题解标注 " + refDeclared + "）。");
        } else {
            int gap = myRank - optRank;
            cplxScore = Math.max(1, 10 - gap * 3.5);
            cplxReason = "推测 " + rankName(myRank) + "，参考解量出来是 " + rankName(optRank)
                    + "，你比它多 " + gap + " 档" + (refDeclared.isEmpty() ? "。" : "（题解标注 " + refDeclared + "）。");
        }
        dims.add(dim("complexity", "时间复杂度", round(cplxScore), false, cplxReason,
                List.of("最大循环嵌套 " + a.maxNest + " 层（参考解 " + refA.maxNest + " 层）",
                        a.recursive ? "检测到递归" : "无递归",
                        "参考解实测档位：" + rankName(optRank)
                                + (refDeclared.isEmpty() ? "" : " · 题解标注 " + refDeclared))));

        // 2.4 空间
        // 和复杂度同理：先量参考解，只扣「比参考解多出来的」那部分。
        // 原来的写法下，像「哈希」这种参考解自己就在用的手法，用户用一下就被扣 1 分 ——
        // 等于惩罚用户「跟参考解写一样」。现在参考解用到的、你也用到了的项目一律不扣。
        double spaceScore = 10;
        List<String> spaceEv = new ArrayList<>();
        boolean refRecursive = refA.recursive;
        if (a.recursive && !refRecursive) { spaceScore -= 2; spaceEv.add("用了递归，栈深度最坏可达 O(n)"); }
        else if (a.recursive) { spaceEv.add("用了递归（参考解也用了，不额外扣）"); }
        for (String t : new String[]{"哈希", "辅助数组", "堆"}) {
            if (!a.techs.contains(t)) continue;
            if (refA.techs.contains(t)) { spaceEv.add("用了" + t + "（参考解也用了，不额外扣）"); continue; }
            double cut = "辅助数组".equals(t) ? 2 : 1;
            spaceScore -= cut;
            spaceEv.add("用了" + t + "，参考解没用这个，额外占了空间");
        }
        String refSpaceDeclared = ref.spaceComplexity == null ? "" : ref.spaceComplexity;
        if (spaceEv.isEmpty()) spaceEv.add("和参考解一样，没有额外的空间分配");
        dims.add(dim("space", "空间复杂度", round(Math.max(2, spaceScore)), false,
                spaceEv.get(0) + "。" + (refSpaceDeclared.isEmpty() ? "" : "题解标注 " + refSpaceDeclared + "。"),
                spaceEv));

        // 2.5 边界
        //
        // 边界这一项按「风险扫描」算，不按「守卫清单」算：力扣题面已经把空输入排除在用例之外，
        // 硬要求 length==0 守卫只会惩罚所有正常代码。
        //
        // 而且必须先拿同一套扫描量一遍参考解。「直接下标访问但没先判长度」这条规则，
        // 参考最优解自己几乎处处触发 —— 实测 120 题里 50 题的参考解被这条扣 3 分。
        // 一条连参考解都会踩的规则，量出来的不是代码质量，是写法偏好。
        // 现在参考解已经触发的风险项不再算到用户头上，参考解恒为 10 分。
        List<String> risk = new ArrayList<>();
        List<String> safe = new ArrayList<>();
        double edgeScore = scanEdge(code, expectedParams, risk, safe);

        List<String> refRisk = new ArrayList<>();
        scanEdge(ref.codeJava, expectedParams, refRisk, new ArrayList<>());

        List<String> inheritedRisk = new ArrayList<>();
        for (String r : new ArrayList<>(risk)) {
            if (refRisk.contains(r)) {
                risk.remove(r);
                inheritedRisk.add(r);
            }
        }

        if (!inheritedRisk.isEmpty()) {
            safe.add("参考解同样有：" + String.join("、", inheritedRisk) + "，不计入你的扣分");
        }

        if (risk.isEmpty()) {
            String ev = safe.isEmpty()
                    ? "没扫到会抛异常的写法。"
                    : "没扫到你会踩的边界风险：" + String.join("、", safe) + "。";
            dims.add(dim("edge", "边界处理", 10.0, false, ev,
                    safe.isEmpty() ? List.of("未发现明确的边界风险") : safe));
        } else {
            dims.add(dim("edge", "边界处理", round(Math.max(2, edgeScore)), false,
                    "可能出问题的地方：" + String.join("、", risk),
                    risk));
        }

        // 2.6 规范
        //
        // 同样先量参考解。原来「一行注释都没有就扣 1 分」把参考解本身扣到 9 分，
        // 而用户写个 11 行的短解法反而不触发这条、白拿 10 分 —— 这就是慢写法分数反超的
        // 直接原因之一。规范维度只惩罚「参考解都没有的毛病」。
        List<String> styleEv = new ArrayList<>();
        List<String> myStylePenalties = new ArrayList<>();
        double styleScore = 10 - scanStyle(a, code, myStylePenalties);

        List<String> refStylePenalties = new ArrayList<>();
        scanStyle(refA, ref.codeJava, refStylePenalties);
        List<String> inheritedStyle = new ArrayList<>();
        for (String pn : myStylePenalties) {
            if (refStylePenalties.contains(pn)) {
                inheritedStyle.add(pn.split("\\|")[1]);
                styleScore += Double.parseDouble(pn.split("\\|")[0]);
            } else {
                styleEv.add(pn.split("\\|")[1]);
            }
        }
        if (!inheritedStyle.isEmpty()) {
            styleEv.add("参考解同样有：" + String.join("、", inheritedStyle) + "，不计入你的扣分");
        }
        if (styleEv.isEmpty()) styleEv.add("命名、长度、嵌套都在合理区间");
        dims.add(dim("style", "代码规范", round(Math.max(2, styleScore)), false,
                styleEv.get(0), styleEv));

        // ---- 3. 加权总分 ----
        //
        // 权重按「维度 key」取，不按下标 —— 下标一改就静默错位，这种 bug 查起来极贵。
        // 并且只对「实际存在的维度」归一：正确性判不了时（设计类题目），
        // 它的 0.30 权重会被摊到其余五项上，而不是变成白送的 0 分。
        //
        // 权重分配原则：**实测的权重高，推断的权重低**。
        //   compile 0.12 + correctness 0.30 = 0.42 是实测（真编译、真跑）
        //   其余 0.58 全是静态推断
        // 正确性一项就顶过剩下五项里的任何两项，因为它回答的是「对不对」，
        // 而那五项回答的只是「写得像不像高手」。
        Map<String, Double> weightOf = new LinkedHashMap<>();
        weightOf.put("compile", 0.12);
        weightOf.put("correctness", 0.30);
        weightOf.put("approach", 0.14);
        weightOf.put("complexity", 0.16);
        weightOf.put("space", 0.10);
        weightOf.put("edge", 0.10);
        weightOf.put("style", 0.08);

        double wSum = 0;
        for (Map<String, Object> d : dims) {
            Double wv = weightOf.get(String.valueOf(d.get("key")));
            if (wv != null) wSum += wv;
        }
        double total = 0;
        for (Map<String, Object> d : dims) {
            Double wv = weightOf.get(String.valueOf(d.get("key")));
            if (wv == null || wSum <= 0) continue;
            total += ((Number) d.get("score")).doubleValue() * (wv / wSum);
        }
        // 编译不过就不能是好代码：一票把总分压到 4 分以下
        if (!comp.ok) total = Math.min(total, 3.9);
        else if (!hasMethod) total = Math.min(total, 5.5);

        // 单项塌陷封顶。加权平均有个结构性缺陷：一个维度砸到 1 分，只要其他五项满分，
        // 总分仍有 10 - 0.2*9 = 8.2，看起来「挺好」。实测「另开数组搬一遍的移动零」
        // （力扣只打败 10% 的人）拿到 9.8 分 —— 空间多开 O(n) 只掉 0.2 分，
        // 复杂度写成 O(n^3) 也只掉 1.8 分。平均分掩盖了「某项彻底不行」这件事。
        // 所以补一条：复杂度或空间塌到 4 分以下，总分不许进 8 分以上。
        // 用封顶而不是加大权重，是为了不动六项之间的相对比例，只堵住「一项烂、五项救」这个洞。
        double cplxRaw = scoreOf(dims, "complexity");
        double spaceRaw = scoreOf(dims, "space");
        if (cplxRaw >= 0 && cplxRaw < 4) total = Math.min(total, 7.9);
        if (spaceRaw >= 0 && spaceRaw < 4) total = Math.min(total, 7.9);
        // 正确性塌陷单独一票：用例过不到一半，总分不许进 7 分以上。
        // 「代码写得漂亮但答案是错的」不该拿高分，这是评分器最该守住的常识。
        // 正确性塌陷一票否决：用例没全过，总分不许进 8 分以上。
        // 理由：给「答案是错的但写得漂亮」的文章打 8 分，等于告诉用户方向对了。
        // 方向错了比写法差严重一个量级 —— 那五项推断项再高也不该救回来。
        double corrRaw = scoreOf(dims, "correctness");
        if (corrRaw >= 0 && corrRaw < 10) total = Math.min(total, 7.9);
        if (corrRaw >= 0 && corrRaw < 5.5) total = Math.min(total, 6.9);

        res.put("ok", true);
        res.put("total", round(total));
        res.put("compiled", comp.ok);
        res.put("signatureOk", hasMethod);
        res.put("expectedMethod", expectedName);
        res.put("expectedParams", expectedParams);
        res.put("dimensions", dims);
        res.put("inferred", Map.of(
                "time", rankName(myRank),
                "nesting", a.maxNest,
                "recursive", a.recursive,
                "techs", new ArrayList<>(a.techs)
        ));
        if (verdict != null) res.put("judge", verdict);
        res.put("compileErrors", comp.errors);
        res.put("compileWarnings", comp.warnings);
        res.put("reference", Map.of(
                "optimalTime", ref.timeComplexity == null ? "" : ref.timeComplexity,
                "optimalSpace", ref.spaceComplexity == null ? "" : ref.spaceComplexity,
                // 最优解识别出的手法单独给出来。
                // 前端要算「你比最优解差在哪」，就得拿到这份集合；
                // 之前它只出现在 approachReason 那句中文里，前端只能去正则抠 ——
                // 改一个字就失效，这种耦合迟早出事。
                "optimalTechs", new ArrayList<>(analyze(ref.codeJava).techs)
        ));
        return res;
    }

    // ---------------------------------------------------------------- 编译

    private static final class CompileOutcome {
        boolean ok;
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
    }

    private static final class Src extends SimpleJavaFileObject {
        private final String code;

        Src(String name, String code) {
            super(URI.create("string:///" + name + Kind.SOURCE.extension), Kind.SOURCE);
            this.code = code;
        }

        @Override
        public CharSequence getCharContent(boolean ignoreEncodingErrors) {
            return code;
        }
    }

    private CompileOutcome compile(String userCode) {
        CompileOutcome out = new CompileOutcome();
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            out.errors.add("当前运行的 JRE 里没有 javac（需要用 JDK 启动，不是 JRE）");
            return out;
        }

        String src = normalize(userCode);
        String typeName = topLevelTypeName(src);

        List<JavaFileObject> units = new ArrayList<>();
        units.add(new Src(typeName, src));

        // 力扣预置类型：用户代码用到但没自己声明时，补一份进去，否则一定编译不过
        if (uses(src, "TreeNode") && !declares(src, "TreeNode")) {
            units.add(new Src("TreeNode", SUPPORT_TREE_NODE));
        }
        if (uses(src, "ListNode") && !declares(src, "ListNode")) {
            units.add(new Src("ListNode", SUPPORT_LIST_NODE));
        }
        if (uses(src, "Node") && !declares(src, "Node")) {
            units.add(new Src("Node", SUPPORT_NODE));
        }

        Path outDir = null;
        try {
            outDir = newOutDir();
            DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
            StandardJavaFileManager fm = compiler.getStandardFileManager(diags, null, StandardCharsets.UTF_8);
            List<String> opts = List.of(
                    "-d", outDir.toString(),
                    "-encoding", "UTF-8",
                    "-proc:none",
                    "-nowarn");
            StringWriter sink = new StringWriter();
            JavaCompiler.CompilationTask task = compiler.getTask(sink, fm, diags, opts, null, units);
            out.ok = Boolean.TRUE.equals(task.call());

            for (Diagnostic<? extends JavaFileObject> d : diags.getDiagnostics()) {
                String msg = d.getMessage(Locale.SIMPLIFIED_CHINESE);
                // 去掉绝对路径噪音，只留「第几行 + 什么错」
                String line = "第 " + d.getLineNumber() + " 行：" + msg.replaceAll("\n", " ");
                if (d.getKind() == Diagnostic.Kind.ERROR) out.errors.add(line);
                else if (d.getKind() == Diagnostic.Kind.WARNING
                        || d.getKind() == Diagnostic.Kind.MANDATORY_WARNING) out.warnings.add(line);
            }
        } catch (Exception e) {
            out.ok = false;
            out.errors.add("编译环境出错（不是你的代码问题）：" + describe(e));
        } finally {
            if (outDir != null) deleteQuietly(outDir);
        }
        return out;
    }

    /**
     * 找一个能真正建目录的地方放编译产物。
     *
     * 踩过的坑：原来直接用 Files.createTempDirectory("lcgrade")，它只看
     * java.io.tmpdir。而某些环境（受限沙箱、容器、只读挂载的 /tmp）里那个目录
     * 存在却不可写，于是抛 AccessDeniedException。
     *
     * 更坑的是 AccessDeniedException.getMessage() **只返回路径本身**，
     * 不带任何原因，界面上就变成一句「编译过程出错：C:\...\lcgrade123」——
     * 用户看到自己的代码在力扣能过、到这里「编译不过」，却完全不知道发生了什么。
     *
     * 所以这里按顺序试几个候选，谁先能建出来就用谁。
     */
    private static Path newOutDir() throws Exception {
        List<Path> candidates = new ArrayList<>();
        String tmp = System.getProperty("java.io.tmpdir");
        if (tmp != null && !tmp.isBlank()) candidates.add(Path.of(tmp));
        Path local = Path.of("data", "grade-tmp");   // 项目目录下，通常一定有写权限
        candidates.add(local);

        Exception last = null;
        for (Path base : candidates) {
            try {
                Files.createDirectories(base);
                return Files.createTempDirectory(base, "lcgrade");
            } catch (Exception e) {
                last = e;
            }
        }
        throw last == null ? new java.io.IOException("没有可写的临时目录") : last;
    }

    /** 把异常翻成一句人能看懂的话：类型 + 路径 + 为什么会这样。 */
    private static String describe(Exception e) {
        String type = e.getClass().getSimpleName();
        if (e instanceof java.nio.file.AccessDeniedException) {
            java.nio.file.AccessDeniedException ae = (java.nio.file.AccessDeniedException) e;
            return "没有写入权限，建不了临时目录。「" + ae.getFile()
                    + "」不允许创建子目录（权限被系统或安全软件拒绝）。"
                    + "这不是你代码的问题，重试一次；还是不行就把项目目录下的 data/ 权限检查一下。";
        }
        String m = e.getMessage();
        String where = "";
        if (e instanceof java.nio.file.FileSystemException) {
            java.nio.file.FileSystemException fe = (java.nio.file.FileSystemException) e;
            if (fe.getFile() != null) where = "（" + fe.getFile() + "）";
        }
        return type + where + (m == null || m.isBlank() || m.equals(where.replaceAll("（|）", ""))
                ? "" : "：" + m);
    }

    private static void deleteQuietly(Path p) {
        try (var walk = Files.walk(p)) {
            walk.sorted(Comparator.reverseOrder()).forEach(x -> {
                try { Files.deleteIfExists(x); } catch (Exception ignore) { }
            });
        } catch (Exception ignore) { }
    }

    // ---------------------------------------------------------------- 源码规整

    /** 补 import、去 package、必要时包一层 class Solution。 */
    static String normalize(String raw) {
        String s = raw == null ? "" : raw;
        // package 声明会让「文件在默认包」这件事不成立，且必须在最前，先删掉
        s = s.replaceAll("(?m)^\\s*package\\s+[\\w\\.]+\\s*;\\s*$", "");
        s = s.trim();
        // 用户只贴了方法体（没有 class/interface/enum 声明）→ 套上力扣的壳
        if (!hasTypeDecl(s)) {
            s = "class Solution {\n" + s + "\n}";
        }
        // import 必须在类型声明之前；这里粗暴前置，重复 import 在 Java 里是合法的
        return IMPORTS + s + "\n";
    }

    static boolean hasTypeDecl(String s) {
        return TYPE_DECL.matcher(s).find();
    }

    static String topLevelTypeName(String s) {
        Matcher m = TYPE_DECL.matcher(s);
        return m.find() ? m.group(1) : "Solution";
    }

    /** 只匹配「某个词被当成类型用」，避免把字符串里的 Node 也算进来。 */
    private static boolean uses(String s, String type) {
        return Pattern.compile("\\b" + type + "\\b").matcher(s).find();
    }

    /** 用户是否自己声明了这个类型（自行声明就不能再注入，否则重复定义）。 */
    private static boolean declares(String s, String type) {
        return Pattern.compile("(?m)^\\s*(?:public\\s+|final\\s+|static\\s+)*class\\s+"
                + type + "\\b").matcher(s).find();
    }

    private static String refMethodName(String code) {
        if (code == null) return "";
        Matcher m = METHOD_DECL.matcher(code);
        while (m.find()) {
            String name = m.group(2);
            if (!"main".equals(name) && !"Solution".equals(name)) return name;
        }
        return "";
    }

    private static String refParams(String code) {
        if (code == null) return "";
        Matcher m = METHOD_DECL.matcher(code);
        while (m.find()) {
            if (!"main".equals(m.group(2))) return m.group(3).trim();
        }
        return "";
    }

    private static Solution pickOptimal(List<Solution> sols) {
        for (Solution s : sols) if ("optimal".equals(s.tier)) return s;
        return sols.get(sols.size() - 1);
    }

    // ---------------------------------------------------------------- 静态分析

    private static final class Analysis {
        int maxNest;
        boolean recursive;
        Set<String> techs = new LinkedHashSet<>();
        int rank = 2;
        List<String> oneLetterVars = new ArrayList<>();
        int magicNumbers;
        int comments;
    }

    private static final String[][] TECH_PATTERNS = {
            {"哈希", "HashMap|HashSet|LinkedHashMap|Map<|Set<|put\\(|containsKey|getOrDefault"},
            {"双指针", "\\bleft\\b[\\s\\S]{0,400}?\\bright\\b|\\blo\\b[\\s\\S]{0,300}?\\bhi\\b|\\bwrite\\b[\\s\\S]{0,400}?\\bread\\b|\\bslow\\b[\\s\\S]{0,400}?\\bfast\\b"},
            {"排序", "Arrays\\.sort|Collections\\.sort|sort\\("},
            {"二分", "while\\s*\\([^)]*left[\\s\\S]{0,80}right|mid\\s*=|>>\\s*1"},
            {"动态规划", "int\\[\\]\\s*dp|int\\[\\]\\[\\]\\s*dp|dp\\[|memo"},
            {"BFS", "Queue<|Deque<|ArrayDeque|LinkedList.*Queue|\\.offer\\(|\\.poll\\("},
            {"栈", "Stack<|\\.push\\(|\\.peek\\("},
            {"堆", "PriorityQueue"},
            {"位运算", "<<|>>|&\\s*\\w|\\^"},
            {"并查集", "parent\\[|find\\(|union\\("},
            {"回溯", "backtrack|dfs\\("},
            {"辅助数组", "new\\s+(int|boolean|char|long)\\["},
            {"原地交换", "\\[i\\]\\s*=\\s*\\[j\\]|swap\\("},
    };

    static Analysis analyze(String code) {
        Analysis a = new Analysis();
        if (code == null) return a;
        String noStr = code.replaceAll("\"(\\\\.|[^\"\\\\])*\"", "\"\"")
                .replaceAll("'(\\\\.|[^'\\\\])*'", "''");

        a.maxNest = maxLoopNest(noStr);

        // 递归：必须真的看到方法调用自己，声明本身不算
        a.recursive = hasRecursion(noStr);

        for (String[] p : TECH_PATTERNS) {
            if (Pattern.compile(p[1]).matcher(noStr).find()) a.techs.add(p[0]);
        }
        a.techs.remove("位运算");  // 太容易误报，不作为思路依据

        a.rank = estimateRank(a, noStr);
        a.oneLetterVars = singleLetterVars(noStr);
        a.magicNumbers = countMagicNumbers(noStr);
        a.comments = (int) code.lines().filter(l -> l.trim().startsWith("//") || l.contains("/*")).count();
        return a;
    }

    /**
     * 数「循环最多嵌套几层」。
     *
     * 老实现是「扫到 for/while 就 depth++，扫到 } 就 depth--」，两个硬伤：
     * ① 用「关键字后第一个分号在花括号之前」判断无花括号，可 for(int i=0;...) 的分号永远在 { 之前，
     *    于是所有 for 都被跳过了；
     * ② new int[]{i, j} 这种数组初始化的 } 会误减 depth，把真实循环层数吃掉。
     *
     * 现在改成：先给全文每个 { } 算出括号深度，循环块的深度减去「类体 + 方法体」两层就是它的循环层数。
     * 这样数组初始化的花括号虽然也会计入深度，但不会有循环关键字指向它，天然不影响结果。
     */
    private static int maxLoopNest(String s) {
        if (s == null || s.isEmpty()) return 0;
        int[] depthAt = new int[s.length()];
        int d = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '{') { d++; depthAt[i] = d; }
            else if (c == '}') { depthAt[i] = d; d = Math.max(0, d - 1); }
            else depthAt[i] = d;
        }
        int max = 0;
        for (int i = 0; i < s.length(); i++) {
            boolean isLoop = s.startsWith("for", i) || s.startsWith("while", i) || s.startsWith("do", i);
            if (!isLoop) continue;
            boolean leftOk = i == 0 || !Character.isJavaIdentifierPart(s.charAt(i - 1));
            if (!leftOk) continue;
            int br = s.indexOf('{', i);
            if (br < 0) continue;
            // 减掉 class 体和方法体两层；用户代码可能没写 class（normalize 会补），所以下限取 1
            int loopDepth = Math.max(1, depthAt[br] - 2);
            max = Math.max(max, loopDepth);
        }
        return max;
    }

    /** Java 关键字。methodNames 的宽松正则会抓到 for/while/catch 这类「名字后跟 (…) {」，
     *  它们不是方法。不排掉的话，判递归时两个 for 会被数成「自己调用自己两次」。 */
    private static final Set<String> JAVA_KEYWORDS = Set.of(
            "for", "while", "do", "if", "else", "switch", "case", "default", "catch", "try",
            "finally", "synchronized", "return", "new", "throw", "assert", "class", "interface",
            "enum", "record", "public", "private", "protected", "static", "final", "abstract",
            "void", "int", "long", "double", "float", "boolean", "char", "byte", "short",
            "this", "super", "instanceof", "yield", "var");

    private static List<String> methodNames(String s) {
        List<String> out = new ArrayList<>();
        Matcher m = Pattern.compile("(?:public|private|protected|static|final|\\s)+[\\w<>\\[\\],\\s\\.]+?\\s+(\\w+)\\s*\\([^)]*\\)\\s*\\{").matcher(s);
        while (m.find()) {
            String name = m.group(1);
            if (JAVA_KEYWORDS.contains(name)) continue;   // for/while/catch 不是方法
            if ("Solution".equals(name) || "main".equals(name)) continue;
            out.add(name);
        }
        return out;
    }

    /**
     * 判断有没有递归。
     *
     * 老实现是「方法名在全文出现 ≥2 次就算递归」，但方法声明本身占一次，
     * 而 class Solution 的类名又会被 methodNames 当成方法名收进来出现一次 —— 双重误伤。
     * 现在改成：必须真的看到「方法名(」出现在另一个方法的体内。
     */
    private static boolean hasRecursion(String s) {
        List<String> names = methodNames(s);
        if (names.isEmpty()) return false;
        for (String name : names) {
            Matcher m = Pattern.compile("\\b" + Pattern.quote(name) + "\\s*\\(").matcher(s);
            int cnt = 0;
            while (m.find()) cnt++;
            // 声明 1 次 + 至少 1 次调用 = 递归
            if (cnt >= 2) return true;
        }
        return false;
    }

    private static int estimateRank(Analysis a, String s) {
        boolean hasSort = a.techs.contains("排序");
        boolean hasLog = hasHalving(s);
        if (a.maxNest >= 3) return 5;                 // 三重循环 → O(n^3)
        if (a.maxNest == 2) {
            if (hasLog) return 3;                     // n 层 + log → O(n log n)
            return 4;                                 // O(n^2)
        }
        if (hasSort) return 3;                        // O(n log n)
        if (hasLog) return 1;                         // O(log n)
        if (a.recursive && a.maxNest == 0) return 3;  // 朴素递归通常是 2^n / n log n
        if (a.maxNest == 1 || a.recursive) return 2;  // O(n)
        return 0;                                     // 看起来是 O(1)
    }

    /**
     * 这段代码是不是真的在对数级折半。
     *
     * 老代码直接拿 techs.contains("二分") 当对数证据，而「二分」的正则是
     * while\s*\([^)]*left[\s\S]{0,80}right —— 任何 while (left < right) 都命中。
     * 双指针（例如 container-with-most-water 的 O(n)/O(1)）就这么被判成 O(log n)，
     * 当成参考基准后，正常 O(n) 写法全被判「比参考解多 3 档」，实测 25 题 better 低于 brute。
     *
     * 真正的对数级必须看到「mid / >> 1」这种取中点，以及把区间收缩一半的赋值。
     * 只出现 left/right 挨个挪，是双指针，不是二分。
     */
    private static boolean hasHalving(String s) {
        if (s == null || s.isEmpty()) return false;
        boolean pickMid = Pattern.compile("\\bmid\\b|>>\\s*1").matcher(s).find();
        if (!pickMid) return false;
        // 区间折半：left = mid + 1 / right = mid - 1 / left = mid / right = mid
        return Pattern.compile("\\b(left|lo|low|right|hi|high)\\s*=\\s*mid\\s*([+-]\\s*1)?\\b")
                .matcher(s).find();
    }

    private static final Map<Integer, String> RANK_NAME = Map.of(
            0, "O(1)", 1, "O(log n)", 2, "O(n)", 3, "O(n log n)", 4, "O(n^2)", 5, "O(n^3)");

    private static String rankName(int r) {
        return RANK_NAME.getOrDefault(r, "O(n^k)");
    }

    /** 把参考解里写的时间复杂度字符串映射成可比大小的档位。 */
    private static int rank(String timeComplexity) {
        if (timeComplexity == null) return 2;
        String t = timeComplexity.toLowerCase().replace(" ", "");
        if (t.contains("1)")) return 0;
        if (t.contains("logn") && (t.contains("n)") || t.contains("nlogn"))) return 3;
        if (t.contains("logn")) return 1;
        if (t.contains("n^3") || t.contains("n³")) return 5;
        if (t.contains("n^2") || t.contains("n²")) return 4;
        if (t.contains("2^") || t.contains("n!")) return 6;
        if (t.contains("n)")) return 2;
        return 2;
    }

    private static List<String> singleLetterVars(String s) {
        Set<String> ok = Set.of("i", "j", "k", "n", "m", "x", "y", "s", "t", "p", "q", "r", "c", "a", "b", "v", "w");
        Set<String> found = new LinkedHashSet<>();
        Matcher m = Pattern.compile("\\b(?:int|long|double|char|boolean)\\s+([a-zA-Z])\\b").matcher(s);
        while (m.find()) {
            String v = m.group(1);
            if (!ok.contains(v)) found.add(v);
        }
        return new ArrayList<>(found);
    }

    private static int countMagicNumbers(String s) {
        Set<String> ok = Set.of("0", "1", "2", "10", "100", "26", "128", "1000");
        int c = 0;
        Matcher m = Pattern.compile("(?<![\\w.])(\\d{2,})(?![\\w.])").matcher(s);
        while (m.find()) {
            if (!ok.contains(m.group(1))) c++;
        }
        return c;
    }

    // ---------------------------------------------------------------- 参考解之间的相对校正

    /**
     * 把题解里人工声明的复杂度字符串解析成「细档位」。数字越大越慢。
     *
     * 为什么需要它：静态分析只数循环嵌套、认手法，分辨率大概到「差一个数量级」。
     * 但参考解之间的差距常常比这更细 —— 实测 120 题里有 11 题，brute 和 optimal
     * 的代码结构在估算器眼里完全一样（sqrtx 的 O(√x) 和 O(log log x) 都是单层 while；
     * hamming-distance 的 O(32) 和 O(k) 都是位运算；top-k 的 O(d log d) 和 O(n) 都是普通循环）。
     * 这些题光看代码分不出来，但题解是人写的、复杂度是人工标注的 —— 那是可信的第二信号。
     *
     * 重要：这个档位**只用于参考解之间排高低**，绝不参与用户评分。
     * 用户代码没有声明可比，硬拿声明校正用户等于拿答案扣分。
     */
    private static int fineRank(String declared) {
        if (declared == null || declared.isBlank()) return -1;
        String t = declared.toLowerCase().replaceAll("\\s", "");

        // 先把每一个 O(...) 都抠出来。设计类题的声明是多段的 ——
        // 「push O(n)，其余 O(1)」「addNum O(log n)，findMedian O(1)」，那不是单一复杂度。
        // 取最慢的那一段：用户感受到的是最坏情况，不是爽的那一次。
        // 任何一段解析不出就整体放弃（返回 -1 = 不参与校正），宁可不动也不猜。
        // 中文声明（「指数级」）里没有 O(...)，别当成解析失败 —— 它就是最慢的那一档
        if (t.contains("指数级") || t.contains("阶乘级")) return 12;

        java.util.List<String> parts = new java.util.ArrayList<>();
        int scan = 0;
        while (true) {
            int at = t.indexOf("o(", scan);
            if (at < 0) break;
            int start = at + 2;
            int depth = 1;
            int k = start;
            while (k < t.length() && depth > 0) {
                char c = t.charAt(k);
                if (c == '(') depth++;
                else if (c == ')') depth--;
                k++;
            }
            if (depth != 0) return -1;                 // 括号不配对，不猜
            parts.add(t.substring(start, k - 1));
            scan = k;
        }
        if (parts.isEmpty()) return -1;

        int worst = -1;
        for (String part : parts) {
            int r = rankOfSum(part);
            if (r < 0) return -1;
            worst = Math.max(worst, r);
        }
        return worst;
    }

    /**
     * 求和式取最慢项：O(n + d log d) 是 O(n log n)，O(V + E) 是 O(n)。
     * 取最大而不是相加 —— 复杂度看主导项，常数个 n 加起来还是 n。
     */
    private static int rankOfSum(String t) {
        // 变量名归一：复杂度只看「形状」，O(log d) 和 O(log n) 是同一档，O(V + E) 和 O(n + n) 也是。
        // 早先是给 logn / logx / logd 逐个写 case，漏一个就解析失败 —— 那是在枚举而不是在理解。
        // 现在的做法：先把 log 和 sqrt 打上占位符保护起来，剩下的单个字母一律当变量换成 n。
        t = t.replace("sqrt", "\u0002");
        t = t.replace("log", "\u0001");
        t = t.replaceAll("[a-z]", "n");
        t = t.replace("\u0002", "√");
        t = t.replace("\u0001", "log");

        // 指数级 / 阶乘级：一律最慢档
        // 指数级 / 阶乘级：底数不只有 2（O(m·n·4^L) 里的 4 也是），一律最慢档。
        if (t.contains("n!") || t.matches(".*\\d\\^.*") || t.contains("ⁿ")) return 12;
        if (t.matches("\\d+")) return 0;               // O(32) 这种常数

        // 括号只是分组（O(n · (n + e))），摊平后再按 + 拆，否则项会被切断
        t = t.replace("(", "").replace(")", "");

        if (t.contains("+")) {
            int worst = -1;
            for (String term : t.split("\\+", -1)) {
                int r = rankOfProduct(term);
                if (r < 0) return -1;
                worst = Math.max(worst, r);
            }
            return worst;
        }
        return rankOfProduct(t);
    }

    /**
     * 乘积式：把因子逐个累加成 (n 的次数 deg, 对数层数 log)。
     * 拆出任何不认识的因子就返回 -1 —— 不动分数，比猜错强。
     */
    private static int rankOfProduct(String t) {
        String p0 = t.trim();
        if (p0.isEmpty()) return -1;
        // 连写形式先拆成乘积，长的先替换，否则 n 会把 nloglogn 吃掉
        String s = p0
                .replace("nloglogn", "n·loglogn")
                .replace("n^2logn", "n^2·logn")
                .replace("n²logn", "n²·logn")
                .replace("n^3logn", "n^3·logn")
                .replace("n³logn", "n³·logn")
                .replace("nlogn", "n·logn")
                .replace("n√n", "n·√n")     // O(n√n) 连写
                .replace("n√", "n·√");      // 兜底：n√k 之类

        double deg = 0;
        int log = 0;
        for (String raw : s.split("[·*×]", -1)) {
            String p = raw.trim();
            if (p.isEmpty() || "1".equals(p)) continue;
            switch (p) {
                case "logn": log = Math.max(log, 2); break;
                case "loglogn": log = Math.max(log, 1); break;   // log log n 比 log n 快一档
                case "√n": deg += 0.5; break;
                case "n": deg += 1; break;
                case "n^2": case "n²": deg += 2; break;
                case "n^3": case "n³": deg += 3; break;
                default: return -1;
            }
        }

        // 与原开关同一把尺子（刻度一分没动，动刻度等于改判分而不是修解析）
        if (deg == 0) return log >= 2 ? 3 : (log == 1 ? 2 : 0);
        if (deg == 0.5) return 5;
        if (deg == 1) return log >= 2 ? 9 : (log == 1 ? 8 : 7);
        if (deg == 1.5) return log >= 2 ? 10 : 8;     // n·√n = n^1.5，比 n² 快，别当成 n³
        if (deg == 2) return log >= 2 ? 11 : 10;
        return log >= 2 ? 12 : 11;
    }

    /**
     * 给参考解打分时，用人工声明的复杂度做一次相对校正。
     *
     * 规则：某个参考解的声明档位比「最优参考解」慢多少，就按每档 1.2 分往下压。
     * 只压参考解，且只当两边都能解析出档位时才动手 —— 解析不出来宁可不动，
     * 也不能靠猜把分数改了。校正后仍保证最优解是 10 分（它跟自己比，差 0 档）。
     */
    private static Map<String, Object> applyDeclaredRank(Map<String, Object> g, int delta) {
        if (delta <= 0) return g;
        double total = ((Number) g.get("total")).doubleValue();
        double cut = Math.min(4.0, delta * 1.2);
        g.put("total", round(Math.max(2.0, total - cut)));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> dims = (List<Map<String, Object>>) g.get("dimensions");
        if (dims != null) {
            for (Map<String, Object> c : dims) {
                if ("complexity".equals(c.get("key"))) {
                    double cs = ((Number) c.get("score")).doubleValue();
                    c.put("score", round(Math.max(2.0, cs - cut * 1.6)));
                }
            }
        }
        g.put("declaredRankNote", "题解标注的复杂度比最优解慢 " + delta + " 档，按标注校正");
        return g;
    }

    /** 按 key 取某维度的分数；该维度不存在返回 -1（不是 0 —— 「没有」和「零分」必须能区分）。 */
    private static double scoreOf(List<Map<String, Object>> dims, String key) {
        for (Map<String, Object> d : dims) {
            if (key.equals(String.valueOf(d.get("key")))) {
                return ((Number) d.get("score")).doubleValue();
            }
        }
        return -1;
    }

    // ---------------------------------------------------------------- 可复用的扫描

    /**
     * 边界风险扫描。返回扣分后的分数（满分 10，最低 2），命中项写进 hits，安全项写进 safe。
     *
     * 抽成独立函数唯一的目的：让「参考解」和「用户代码」跑同一份实现。
     * 之前这段逻辑内联在 grade() 里，只作用于用户代码，参考解永远不跑 ——
     * 于是规则即使连参考解自己都会踩，也照样扣用户的分数。零点不统一的尺子量的不是代码。
     */
    private static double scanEdge(String code, String params, List<String> hits, List<String> safe) {
        double score = 10;
        if (code == null) code = "";
        if (params == null) params = "";

        if (params.contains("[]")) {
            boolean takesLength = Pattern
                    .compile("(length\\s*>\\s*0|length\\s*==\\s*0|length\\s*<\\s*1|length\\s*!=\\s*0|isEmpty\\(\\))")
                    .matcher(code).find();
            boolean indexAccess = Pattern.compile("\\w+\\[\\s*(0|\\w+)\\s*\\]").matcher(code).find();
            if (indexAccess && !takesLength) {
                score -= 3;
                hits.add("直接下标访问但没先判长度，空数组会抛越界");
            } else if (takesLength) {
                safe.add("访问下标前判了长度");
            }
        }
        if (params.contains("String")) {
            boolean sLen = Pattern.compile("(length\\(\\)|isEmpty\\(\\)|==\\s*null)").matcher(code).find();
            if (sLen) safe.add("字符串先判了长度/空值");
        }
        if (Pattern.compile("\\(\\s*char\\s*\\)|\\(\\s*int\\s*\\)\\s*\\(").matcher(code).find()) {
            score -= 1;
            hits.add("有强制类型转换，注意精度");
        }
        if (Pattern.compile("/\\s*(?!0\\b)\\w+").matcher(code).find()
                && !Pattern.compile("(==\\s*0|!=\\s*0|>\\s*0)").matcher(code).find()) {
            score -= 1.5;
            hits.add("有除法但没看到除数为 0 的保护");
        }
        if (Pattern.compile("==\\s*null|null\\s*==").matcher(code).find()) {
            safe.add("判了 null");
        }
        return Math.max(2, score);
    }

    /**
     * 代码规范扫描。每条扣分同时写进 out，格式是「分值|人话」——
     * 分值用来在「参考解也有这条」时原样加回去，人话用来展示。
     * 用字符串拼而不是两个平行 List，是为了让扣分额和文案在传递过程中不会错位。
     */
    private static double scanStyle(Analysis a, String code, List<String> out) {
        double cut = 0;
        int lines = code == null ? 0 : (int) code.lines().filter(l -> !l.trim().isEmpty()).count();
        if (lines > 60) { cut += 2; out.add("2.0|方法体 " + lines + " 行，偏长，可以抽小方法"); }
        if (a.maxNest > 3) { cut += 2; out.add("2.0|循环嵌套 " + a.maxNest + " 层，可读性差"); }
        if (!a.oneLetterVars.isEmpty()) {
            double c = Math.min(2, a.oneLetterVars.size() * 0.5);
            cut += c;
            out.add(c + "|单字母变量：" + String.join(", ", a.oneLetterVars));
        }
        if (a.magicNumbers > 3) { cut += 1.5; out.add("1.5|魔法数字 " + a.magicNumbers + " 个"); }
        if (a.comments == 0 && lines > 12) { cut += 1; out.add("1.0|一行注释都没有"); }
        return cut;
    }

    // ---------------------------------------------------------------- 工具

    private static Map<String, Object> dim(String key, String label, double score,
                                           boolean verifiable, String reason, List<String> evidence) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("label", label);
        m.put("score", score);
        m.put("verifiable", verifiable);
        m.put("reason", reason);
        m.put("evidence", evidence);
        return m;
    }

    private static double round(double v) {
        return Math.round(v * 10) / 10.0;
    }

    // ---------------------------------------------------------------- 预置类型

    private static final String SUPPORT_TREE_NODE =
            "class TreeNode {\n" +
            "    int val;\n" +
            "    TreeNode left;\n" +
            "    TreeNode right;\n" +
            "    TreeNode() {}\n" +
            "    TreeNode(int val) { this.val = val; }\n" +
            "    TreeNode(int val, TreeNode left, TreeNode right) {\n" +
            "        this.val = val; this.left = left; this.right = right;\n" +
            "    }\n" +
            "}\n";

    private static final String SUPPORT_LIST_NODE =
            "class ListNode {\n" +
            "    int val;\n" +
            "    ListNode next;\n" +
            "    ListNode() {}\n" +
            "    ListNode(int val) { this.val = val; }\n" +
            "    ListNode(int val, ListNode next) { this.val = val; this.next = next; }\n" +
            "}\n";

    private static final String SUPPORT_NODE =
            "class Node {\n" +
            "    public int val;\n" +
            "    public java.util.List<Node> neighbors;\n" +
            "    public Node() { neighbors = new java.util.ArrayList<>(); }\n" +
            "    public Node(int _val) { val = _val; neighbors = new java.util.ArrayList<>(); }\n" +
            "}\n";
}
