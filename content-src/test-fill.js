/**
 * 填空练习（P0-1）测试。
 *
 * 这件事的意义：能想出思路但写不出代码的人，缺的不是整体思路，是「这一行该怎么写」。
 * 所以这里要钉死的不是「界面长得对」，而是四件事：
 *   1. 挖出来的模板结构是完整的 —— 花括号配不平的话人根本没法填
 *   2. 正解不下发前端 —— 下了就等于没练
 *   3. 对错以真跑为准 —— 写法不同但用例过了必须算过
 *   4. 同一题同一档每次挖的是同一批行 —— 否则没法比较自己有没有进步
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const API = process.env.LC_API || 'http://127.0.0.1:8099';

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

async function getJson(p) {
  const r = await fetch(API + p);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
  return r.json();
}
async function postJson(p, body) {
  const r = await fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
}

/** 花括号 / 圆括号 / 方括号是否配平（先剥掉字符串和字符字面量，否则 } 会被数进去） */
function balanced(src) {
  const s = String(src || '')
    .replace(/@@HOLE:\d+@@/g, 'X')          // 空位占位符本身不含括号，换成 X 避免干扰
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const st = [];
  for (const c of s) {
    if (c === '(' || c === '[' || c === '{') st.push(c);
    else if (pairs[c]) {
      if (st.pop() !== pairs[c]) return false;
    }
  }
  return st.length === 0;
}

(async () => {
  console.log('=== 【1】后端：挖空规则 ===');
  const svc = read('src/main/java/com/lc/service/PracticeService.java');
  ok('PracticeService 是 @Service', /@Service/.test(svc));
  ok('有三档难度', /LEVELS\s*=\s*Arrays\.asList\("easy",\s*"medium",\s*"hard"\)/.test(svc));
  ok('有三种解法档', /TIERS\s*=\s*Arrays\.asList\("brute",\s*"better",\s*"optimal"\)/.test(svc));
  ok('以 { 结尾的行一律不挖（挖了花括号会错配）',
    /if\s*\(\s*s\.endsWith\("\{"\)\s*\)\s*return false;/.test(svc),
    '找不到 endsWith("{") 的排除规则');
  ok('注释行不挖', /startsWith\("\/\/"\)/.test(svc));
  ok('只有括号的行不挖', /matches\("\[\{\\\}\\\[\\\\\]\(\);\]+"\)/.test(svc) || /只有括号和分号的行/.test(svc));
  ok('答案有 @JsonIgnore（不随对象序列化出去）', /@JsonIgnore[\s\S]{0,80}public String answer;/.test(svc));
  ok('有确定性种子（同一题同一档每次一样）', /private static int seed\(/.test(svc) && /cache\.put\(key, built\)/.test(svc));
  // 别拿正则去抠 Java 的字符串拼接 —— 改一个空格就失效，而且失效时看着像产品坏了。
  // 改成钉语义：没填满时把 rebuilt 置 false，后端的做法就藏在这条分支里。
  ok('空没填完不送去编译', /if\s*\(\s*!missing\.isEmpty\(\)\s*\)[\s\S]{0,200}rebuilt",\s*false/.test(svc),
    '找不到「missing 非空 → rebuilt=false」的分支');

  console.log('\n=== 【2】接口：出卷 ===');
  let up = true;
  try { await getJson('/api/plan/today'); } catch { up = false; }
  ok('服务在跑（后面的断言都依赖它）', up, '连不上 ' + API);
  if (!up) { console.log('\n通过 ' + pass + ' / 失败 ' + fail); process.exitCode = fail ? 1 : 0; return; }

  const easy = await getJson('/api/problem/two-sum/fill?tier=brute&level=easy');
  const medium = await getJson('/api/problem/two-sum/fill?tier=brute&level=medium');
  const hard = await getJson('/api/problem/two-sum/fill?tier=optimal&level=hard');

  ok('easy 挖 1 个空', easy.blanks.length === 1, '实际 ' + easy.blanks.length);
  ok('medium 挖得比 easy 多', medium.blanks.length > easy.blanks.length,
    `${easy.blanks.length} vs ${medium.blanks.length}`);
  ok('hard 挖得比 medium 多', hard.blanks.length > medium.blanks.length,
    `${medium.blanks.length} vs ${hard.blanks.length}`);
  ok('返回里有 template / blanks / tierName / totalLines',
    !!easy.template && Array.isArray(easy.blanks) && !!easy.tierName && easy.totalLines > 0);
  ok('每个空带位置信息（行号 / 缩进 / 结构）',
    easy.blanks.every(b => b.line > 0 && typeof b.indent === 'number' && !!b.shape));
  ok('每个空带上下文（around）', easy.blanks.every(b => typeof b.around === 'string'));

  const raw = JSON.stringify(medium) + JSON.stringify(hard);
  ok('正解没有下发到前端（响应里不存在 answer 字段）', !/"answer"/.test(raw));
  ok('响应里没有参考解原文', !raw.includes('new int[]{i, j}'));

  console.log('\n=== 【3】模板结构必须完整 ===');
  // 挖掉一行控制流，它自带的 { 就没了，后面的 } 会错配到外层 —— 模板看上去就是坏的。
  // 这一节把「结构完整」钉死：括号配不平就是 bug，不是审美问题。
  const slugs = (await getJson('/api/problems')).map(x => x.slug).slice(0, 24);
  let brokenTpl = [];
  let checked = 0;
  for (const s of slugs) {
    for (const level of ['easy', 'medium', 'hard']) {
      for (const tier of ['brute', 'optimal']) {
        let j;
        try { j = await getJson(`/api/problem/${s}/fill?tier=${tier}&level=${level}`); }
        catch { continue; }
        if (!j || !j.template) continue;
        checked++;
        if (!balanced(j.template)) brokenTpl.push(`${s}/${tier}/${level}`);
      }
    }
  }
  ok(`抽了 ${checked} 份模板，花括号全部配平`, brokenTpl.length === 0,
    brokenTpl.slice(0, 5).join(', '));
  ok('真的抽到了足够多的模板（否则上面那条是空转）', checked >= 50, '只抽到 ' + checked);

  console.log('\n=== 【4】确定性：同一题同一档每次一样 ===');
  const again = await getJson('/api/problem/two-sum/fill?tier=brute&level=easy');
  ok('两次请求的模板完全一致', again.template === easy.template);
  ok('两次请求的挖空位置一致',
    JSON.stringify(again.blanks.map(b => b.line)) === JSON.stringify(easy.blanks.map(b => b.line)));
  const other = await getJson('/api/problem/two-sum/fill?tier=brute&level=medium');
  ok('不同难度挖的不是同一批（否则调档没意义）',
    JSON.stringify(other.blanks.map(b => b.line)) !== JSON.stringify(easy.blanks.map(b => b.line)));

  console.log('\n=== 【5】交卷：对错以真跑为准 ===');
  let r = await postJson('/api/problem/two-sum/fill/check', {
    tier: 'brute', level: 'easy', answers: { '1': 'return new int[]{i, j};' },
  });
  ok('填对 → HTTP 200', r.status === 200, 'HTTP ' + r.status);
  ok('填对 → 用例全过', r.j && r.j.passedJudge === true);
  ok('填对 → 判题结果 3/3', r.j && r.j.grade && r.j.grade.judge
    && r.j.grade.judge.passed === r.j.grade.judge.total && r.j.grade.judge.total > 0);
  ok('填对 → 每空都对上', r.j && r.j.mismatch === 0);
  const goodTotal = r.j && r.j.grade ? r.j.grade.total : null;
  ok('填对 → 也给了分（但那是解法本身的分）', typeof goodTotal === 'number');

  r = await postJson('/api/problem/two-sum/fill/check', {
    tier: 'brute', level: 'easy', answers: { '1': 'return new int[0];' },
  });
  ok('填错 → 用例没过', r.j && r.j.passedJudge === false);
  ok('填错 → 判题结果里有失败用例', r.j && r.j.grade && r.j.grade.judge
    && (r.j.grade.judge.failures || []).length > 0);
  ok('填错 → 分比填对低', r.j && r.j.grade && r.j.grade.total < goodTotal,
    `${r.j && r.j.grade && r.j.grade.total} vs ${goodTotal}`);
  ok('填错 → 指出哪个空和参考不一致', r.j && r.j.mismatch > 0);

  r = await postJson('/api/problem/two-sum/fill/check', {
    tier: 'brute', level: 'easy', answers: {},
  });
  ok('没填完 → 不送编译（rebuilt=false）', r.j && r.j.rebuilt === false);
  ok('没填完 → 列出缺哪个空', r.j && (r.j.missing || []).length > 0);
  ok('没填完 → 给一句人话', r.j && /没填/.test(r.j.message || ''), r.j && r.j.message);
  ok('没填完 → 不去报语法错（那会让人以为自己写错了）', !r.j.grade);

  r = await postJson('/api/problem/two-sum/fill/check', {
    tier: 'brute', level: 'easy', answers: { '1': 'return new int[]{i, j' },
  });
  ok('语法错 → 编译不过', r.j && r.j.grade && r.j.grade.compiled === false);
  ok('语法错 → 报出行号', r.j && r.j.grade && (r.j.grade.compileErrors || []).length > 0,
    r.j && r.j.grade && r.j.grade.compileErrors && r.j.grade.compileErrors[0]);

  console.log('\n=== 【6】不许「照抄才算对」 ===');
  // 这是整个功能的价值观：写法和参考不一样但跑得通，就是学会了。
  // 如果这里判「错」，这个功能就变成了练抄写。
  r = await postJson('/api/problem/two-sum/fill/check', {
    tier: 'brute', level: 'easy', answers: { '1': 'return new int[] { i, j };' },
  });
  ok('写法不同（多空格）→ 用例仍然全过', r.j && r.j.passedJudge === true);
  ok('写法不同 → 会提示「和参考写法不一致」', r.j && r.j.mismatch > 0);
  ok('写法不同但过了 → 依然算过（mismatch 不能当判据）', r.j && r.j.passedJudge === true && r.j.mismatch > 0);

  console.log('\n=== 【7】前端接线 ===');
  const app = read('static/app.js');
  ok('有 viewFill', /async function viewFill\(/.test(app));
  ok('有 fillSheetHtml', /function fillSheetHtml\(/.test(app));
  ok('有 renderFillResult', /function renderFillResult\(/.test(app));
  ok('路由里有 fill', /view === 'fill'/.test(app) && /await viewFill\(main, param\)/.test(app));
  ok('题目页有入口链接', /#\/fill\/\$\{escAttr\(slug\)\}/.test(app));
  ok('交卷打的是 /fill/check', /\/fill\/check/.test(app));
  ok('三档难度选择器在', /const LEVELS = \[\['easy'/.test(app));
  ok('三档解法选择器在', /const TIERS = \[\['brute'/.test(app));
  ok('回车跳下一个空', /inputs\[i \+ 1\]\.focus\(\)/.test(app));
  ok('清空重填不重拉接口', /btn-fill-reset/.test(app));
  ok('交卷结果不调用 renderGradeResult（那会带假锐评）',
    !/function renderFillResult[\s\S]{0,2500}renderGradeResult\(/.test(app));
  ok('空位用 @@HOLE:n@@ 占位', /\@\@HOLE:\(\\d\+\)\@\@/.test(app));

  const css = read('static/app.css');
  for (const cls of ['.fill-code', '.fl-row', '.fl-input', '.fl-tag', '.fill-res', '.fr-head',
    '.fr-line', '.fr-fail', '.fbtn', '.fill-hints', '.fr-note']) {
    ok('CSS 有 ' + cls, css.includes(cls));
  }
  ok('卷面用等宽字体（换字体缩进就乱了）', /\.fill-code\s*\{[\s\S]{0,200}f-mono/.test(css));

  console.log('\n=== 【8】版本号 ===');
  const html = read('static/index.html');
  const vers = [...html.matchAll(/\?v=([0-9a-z]+)/g)].map(m => m[1]);
  ok('所有静态资源用同一个版本号', new Set(vers).size === 1, vers.join(','));
  ok('版本号已提到 20261112a 或更新', vers[0] >= '20261112a', vers[0]);

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exitCode = fail ? 1 : 0;
})();
