// 测试：评分器必须真跑判题，且「答案错」不许拿高分
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API = process.env.LC_API || 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
};
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
  console.log('\n【1】判题服务存在且能真跑');
  const judgeSrc = read('src/main/java/com/lc/service/JudgeService.java');
  ok('JudgeService 标注为 @Service', /@Service[\s\S]{0,40}public class JudgeService/.test(judgeSrc));
  ok('有 prepare / judge 两个入口', /public Judging prepare\(/.test(judgeSrc) && /public Verdict judge\(/.test(judgeSrc));
  // 注意：类注释里提到过 ProcessBuilder 解释「为什么不能起子进程」，那不是调用。
  // 要查的是有没有真的 new 一个，不是关键词出现没出现。
  ok('用 URLClassLoader 在同进程加载（沙箱禁止子进程）',
    /URLClassLoader/.test(judgeSrc) && !/new\s+ProcessBuilder/.test(judgeSrc));
  ok('有超时保护，死循环不会挂住服务', /CASE_TIMEOUT_MS/.test(judgeSrc) && /get\(\s*CASE_TIMEOUT_MS/.test(judgeSrc));
  ok('用例来自 content/tests 的官方示例', /content[\s\S]{0,20}tests/.test(judgeSrc));

  console.log('\n【2】评分器接了判题，且正确性是最高权重');
  const gradeSrc = read('src/main/java/com/lc/service/CodeGrader.java');
  ok('注入了 JudgeService', /@Autowired[\s\S]{0,60}JudgeService judgeService/.test(gradeSrc));
  ok('grade() 里真的调了 judge()', /judgeService\.judge\(/.test(gradeSrc));
  ok('新增 correctness 维度', /dim\("correctness", "正确性（真跑）"/.test(gradeSrc));
  // dim(...) 的第三个参数是 round(corrScore) 带括号，用 [^)]* 会提前截断，
  // 所以这里用 [\s\S]{0,160}? 惰性跨行匹配。
  ok('correctness 标记为实测', /dim\("correctness"[\s\S]{0,160}?,\s*true,/.test(gradeSrc));

  const w = {};
  for (const m of gradeSrc.matchAll(/weightOf\.put\("(\w+)",\s*([\d.]+)\)/g)) w[m[1]] = parseFloat(m[2]);
  ok('correctness 权重最高', w.correctness === Math.max(...Object.values(w)), JSON.stringify(w));
  ok('实测项（compile+correctness）权重过半', w.compile + w.correctness > 0.4,
    `compile=${w.compile} correctness=${w.correctness}`);
  ok('七项权重加起来是 1', Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-6,
    Object.values(w).reduce((a, b) => a + b, 0).toFixed(4));

  console.log('\n【3】权重按 key 取，不按下标（下标一改就静默错位）');
  ok('用 weightOf.get 取权重', /weightOf\.get\(/.test(gradeSrc));
  ok('有 scoreOf 工具方法', /private static double scoreOf\(/.test(gradeSrc));
  ok('塌陷封顶不再用 dims.get(2) 这类硬下标',
    !/dims\.get\(\d\)\.get\("score"\)/.test(gradeSrc));

  console.log('\n【4】判不了的时候剔除维度，不是给 0 分');
  ok('只在 v.ran 时才加维度',
    /if \(v != null && v\.ran\)[\s\S]{0,2500}?dims\.add\(dim\("correctness"/.test(gradeSrc));
  ok('注释写明「判不了 ≠ 你没做对」', /判不了/.test(gradeSrc));
  ok('权重重归一，不把缺项的权重算成 0 分', /wSum \+= wv/.test(gradeSrc) && /wv \/ wSum/.test(gradeSrc));

  console.log('\n【5】答案错不许拿高分（一票否决）');
  ok('用例没全过就封顶 7.9', /corrRaw < 10\) total = Math\.min\(total, 7\.9\)/.test(gradeSrc));
  ok('过不到一半再压到 6.9', /corrRaw < 5\.5\) total = Math\.min\(total, 6\.9\)/.test(gradeSrc));
  ok('通过率映射不是线性的（过一半 = 差评）', /Math\.pow\(rate, 2\)/.test(gradeSrc));

  console.log('\n【6】真跑：用真实评分器验行为');
  // 这个沙箱禁止 Node 派生子进程（execFileSync / spawnSync 一律 EPERM），
  // 所以不能在测试里直接起 java。改成读 run-all.sh 事先跑好的探针输出。
  // 没有这份输出时标记为「跳过」而不是「失败」—— 缺素材和测出问题是两件事。
  // 这个沙箱禁止 Node 派生子进程（execFileSync / spawnSync 一律 EPERM），
  // 也不能在测试里起 java。但 Node 的 fetch 是通的 —— 直接打已经在跑的服务。
  //
  // 早先这一节读的是 content-src/_tmp/grade-probe.out（由预先跑的探针生成），
  // 那份文件后来被清理，这一节就悄悄走了「跳过」分支 —— 不报红，但也没验证。
  // 一个永远跳过的测试等于没有测试，所以改成打接口：服务在跑就必须真验。
  const post = async (slug, code) => {
    const r = await fetch(API + '/api/problem/' + slug + '/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };
  const getJson = async (p) => {
    const r = await fetch(API + p, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };

  let online = false;
  try { await getJson('/api/plan/today'); online = true; } catch { }

  if (!online) {
    // 服务没起就真跳过，但这是「环境没起来」，不是「验过了」—— 所以算失败并说清原因。
    ok('服务在跑（真跑验证需要它）', false, '连不上 ' + API + '，先启动服务再跑这个测试');
  } else {
    const p = await getJson('/api/problem/two-sum');
    const ref = p.solutions.find(s => s.tier === 'optimal');

    const good = await post('two-sum', ref.codeJava);
    ok('正确答案真的跑了判题', good.judge && good.judge.ran === true, JSON.stringify(good.judge));
    ok('正确答案全部用例通过', good.judge && good.judge.passed === good.judge.total,
      good.judge ? good.judge.passed + '/' + good.judge.total : '无 judge');
    ok('正确答案拿满分', Math.abs(good.total - 10) < 0.01, '总分 ' + good.total);
    const corr = (good.dimensions || []).find(d => d.key === 'correctness');
    ok('correctness 维度存在且标为实测', !!corr && corr.verifiable === true,
      corr ? corr.score + ' 分 verifiable=' + corr.verifiable : '维度缺失');

    // 写死返回值：两数之和第 2 个用例输入 [3,2,4], 6，期望 [1,2]
    const fakeCode = 'class Solution {' + String.fromCharCode(10)
      + '    public int[] twoSum(int[] nums, int target) {' + String.fromCharCode(10)
      + '        return new int[]{0, 1};' + String.fromCharCode(10)
      + '    }' + String.fromCharCode(10) + '}';
    const fake = await post('two-sum', fakeCode);
    ok('写死返回值的代码被真跑抓到', fake.judge && fake.judge.ran === true, JSON.stringify(fake.judge));
    ok('写死的代码不是全部通过', fake.judge && fake.judge.passed < fake.judge.total,
      fake.judge ? fake.judge.passed + '/' + fake.judge.total : '无 judge');
    ok('答案错的总分明显低于满分（≤ 7.9）', fake.total <= 7.9, '总分 ' + fake.total);
    ok('答案错的比正确答案低 2 分以上', good.total - fake.total >= 2,
      '好 ' + good.total + ' 差 ' + fake.total);
    ok('失败项列出了输入和期望',
      !!(fake.judge && fake.judge.failures && fake.judge.failures.length
        && fake.judge.failures[0].input && fake.judge.failures[0].expected),
      JSON.stringify(fake.judge && fake.judge.failures && fake.judge.failures[0]));

    // 设计类题目（LRU 缓存）：没有单一 Solution 函数，判不了
    const lp = await getJson('/api/problem/lru-cache');
    const lref = lp.solutions.find(s => s.tier === 'optimal');
    const lru = await post('lru-cache', lref.codeJava);
    ok('判不了的题不返回 judge 结果', !lru.judge || lru.judge.ran !== true, JSON.stringify(lru.judge));
    ok('判不了时 correctness 维度被剔除',
      !(lru.dimensions || []).some(d => d.key === 'correctness'),
      (lru.dimensions || []).map(d => d.key).join(','));
    ok('判不了不按 0 分算（参考解仍拿高分）', lru.total >= 9.5, '总分 ' + lru.total);
  }
  console.log('\n【7】前端能显示判题结果');
  const app = read('static/app.js');
  ok('前端读 judge 字段', /\.judge\b/.test(app));
  ok('前端显示通过用例数', /passed/.test(app) && /total/.test(app));

  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})();
