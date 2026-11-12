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
/** 剥掉行尾 // 注释（和产品 stripComment 同语义，但独立实现 —— 两条路径互相验证）。 */
function stripC(s) {
  let inStr = false, inCh = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr || inCh) {
      if (c === '\\') { i++; continue; }
      if (inStr && c === '"') inStr = false;
      else if (inCh && c === "'") inCh = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "'") { inCh = true; continue; }
    if (c === '/' && s[i + 1] === '/') return s.slice(0, i);
  }
  return s;
}

/**
 * 按接口返回的 line 号，从参考解原文回填出正确答案。
 *
 * 为什么不写死 { '1': 'return ...' }：空的编号会随挖空规则变。
 * 写死之后，规则一改测试就红，而红的理由是「测试过期了」不是「功能坏了」，
 * 两者混在一起，看日志的人分不出哪个是真问题。
 */
function answersFrom(problem, sheet) {
  const src = problem.solutions
    .find(s => s.tier === (sheet.tier || '').split('|')[0])
    || problem.solutions[0];
  const lines = src.codeJava.replace(/\r\n/g, '\n').split('\n');
  const out = {};
  for (const b of sheet.blanks) {
    let v = stripC(lines[b.line - 1] || '').trim();
    if (v.endsWith('{')) v = v.slice(0, -1).trim();
    // 卷面上白送的关键字（for / while / if）要从答案里剥掉 ——
    // 那个关键字后端会自己拼回去，人只负责填括号里的部分。
    // 不剥的话 mismatch 会一直是 0：后端比之前也会剥，两边都剥就抵消了，
    // 测试永远看不出问题。
    if (b.prefix && v.startsWith(b.prefix)) v = v.slice(b.prefix.length).trim();
    out[b.id] = v;
  }
  return out;
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
  // 空白档排在第一位：只留 class 和 public 方法签名，方法体全留白。
  // 那才是力扣编辑器刚打开的样子 —— 考「能不能从零写出来」，不是「记不记得某一行」。
  ok('难度只剩三档（空白已经搬去解法档了）',
    /LEVELS\s*=\s*Arrays\.asList\("hard",\s*"medium",\s*"easy"\)/.test(svc));
  ok('空白档有独立的挖空逻辑', /blankEveryLine\(/.test(svc));
  ok('空白档留方法签名', /isSignature\(/.test(svc));
  ok('空白解是独立的一档，排在第一个', /TIERS\s*=\s*Arrays\.asList\("blank",\s*"brute",\s*"better",\s*"optimal"\)/.test(svc));
  // 挖空的三条红线，每一条都对应一次真实事故：
  ok('行尾注释先剥掉再判断（否则带注释的控制流头会被挖走）',
    /stripComment\(/.test(svc) && /String code = stripComment\(s\)\.trim\(\)/.test(svc));
  ok('行首是 } 的一律不挖（} else if 净增量为 0，但那个 } 关的是上一层块）',
    /if\s*\(\s*code\.startsWith\("\}"\)\s*\)\s*return false;/.test(svc));
  ok('跨行结构（多行数组 / 跨行签名）不挖',
    /openBraces\(code\) != 0/.test(svc) && /openParens\(code\) != 0/.test(svc));
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

  // 空白解现在是解法档，不是难度档 —— 它的 level 无所谓，传什么都返回同一份骨架
  const blank = await getJson('/api/problem/two-sum/fill?tier=blank&level=hard');
  const easy = await getJson('/api/problem/two-sum/fill?tier=brute&level=easy');
  const medium = await getJson('/api/problem/two-sum/fill?tier=brute&level=medium');
  const hard = await getJson('/api/problem/two-sum/fill?tier=optimal&level=hard');

  // 空白解不是「挖得多」，是「挖得对」—— 它给的就是力扣打开题目的那张纸：
  // class + public 方法 + 方法体里三行可写。所以验的是这个契约，不是数量比大小。
  ok('空白解固定给三行可写', blank.blanks.length === 3, '实际 ' + blank.blanks.length);
  ok('空白解的名字叫「空白解」', /空白/.test(blank.tierName || ''), blank.tierName);
  ok('空白解只留 class 和 public 方法（没别的）',
    (() => {
      const keep = blank.template.split('\n')
        .filter(l => l.trim() && !/@@HOLE/.test(l));
      return keep.every(l => /class\s+\w+/.test(l) || /\(.*\)\s*\{|^}\s*$/.test(l.trim()));
    })(),
    JSON.stringify(blank.template.split('\n').filter(l => l.trim() && !/@@HOLE/.test(l))));
  ok('空白解里没有多余的空行（方法体原空行已去掉）',
    !/@@HOLE:3@@\n\s*\n\s*}/.test(blank.template),
    JSON.stringify(blank.template));

  // 白送关键字是「从参考解挖空」那三档的事 —— 挖走 for (...) { 之后
  // 光看一个空猜不到该写 for 还是 if，那是猜谜不是练习。
  //
  // 空白解不挖任何东西（它就是一张白纸 + 三个空行），自然没有前缀可送。
  // 所以这一节验的是 brute/hard，不是 blank。
  // hard 档的设计是「控制流留着当骨架」——它压根不挖 for / if，所以没有前缀可送。
  // 白送关键字只发生在 medium 档（那里会挖到控制流头）。
  const prefixed = medium.blanks.filter(b => b.prefix);
  ok('挖空档有「白送关键字」的空（否则就是猜谜）',
    prefixed.length > 0, `前缀数 ${prefixed.length} / 空 ${medium.blanks.length}`);
  ok('白送的只能是控制流关键字',
    prefixed.every(b => /^(for|while|if|else if|switch|catch)$/.test(b.prefix)),
    JSON.stringify(prefixed.map(b => b.prefix)));
  ok('关键字已经拼进模板了（前端不用再加一次，否则渲染成 for for）',
    prefixed.every(b => {
      const l = (medium.template || '').split('\n')[b.line - 1] || '';
      const at = l.indexOf('@@HOLE');
      return at >= 0 && l.slice(0, at).trim().endsWith(b.prefix);
    }), JSON.stringify(prefixed.map(b => (medium.template || '').split('\n')[b.line - 1])));
  ok('前端占位符对带关键字的空说的是「填括号里的条件」',
    read('static/app.js').includes('后面填括号里的条件'));

  ok('空白档只留下 class 和方法签名', (() => {
    const keep = blank.template.split('\n')
      .map(l => l.trim())
      .filter(l => l && !/@@HOLE/.test(l) && !/^[}{;]+$/.test(l));
    return keep.every(l => /class\s+\w+/.test(l) || /\(.*\)\s*\{/.test(l));
  })(), JSON.stringify(blank.template.split('\n').filter(l => l.trim() && !/@@HOLE/.test(l))));
  ok('easy 挖 1 个空', easy.blanks.length >= 1, '实际 ' + easy.blanks.length);
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
  const prob = await getJson('/api/problem/two-sum');
  const good = answersFrom(prob, easy);
  ok('能从原文回填出正确答案（否则本节全在空转）',
    Object.keys(good).length === easy.blanks.length && Object.values(good).every(v => v),
    JSON.stringify(good));

  let r = await postJson('/api/problem/two-sum/fill/check', {
    tier: 'brute', level: 'easy', answers: good,
  });
  ok('填对 → HTTP 200', r.status === 200, 'HTTP ' + r.status);
  ok('填对 → 用例全过', r.j && r.j.passedJudge === true);
  ok('填对 → 判题结果 3/3', r.j && r.j.grade && r.j.grade.judge
    && r.j.grade.judge.passed === r.j.grade.judge.total && r.j.grade.judge.total > 0);
  ok('填对 → 每空都对上', r.j && r.j.mismatch === 0);
  const goodTotal = r.j && r.j.grade ? r.j.grade.total : null;
  ok('填对 → 也给了分（但那是解法本身的分）', typeof goodTotal === 'number');

  // 错答案要「能编译但答错」。
  // 这里的坑很深：直接把循环头换成 return，循环体里的 i / j 就找不到符号了 ——
  // 那测出来的是「编译失败」，不是「判题失败」，两件事不能混。
  // 所以按空的类型分别处理，目的只有一个：让它编译过、但算错。
  const wrong = {};
  for (const id of Object.keys(good)) {
    const a = good[id].trim();
    // 注意：good 里的答案已经剥掉了白送的关键字。
    // 所以 for 的答案长这样 → (int j = i + 1; j < n; j++)
    // 两个分号是唯一可靠的判据：三段说明它是 for 的括号体。
    const parenBody = /^\(.*\)$/.test(a) && (a.match(/;/g) || []).length === 2;
    if (/^for\s*\(/.test(a) || parenBody) {
      // 条件换掉、变量还在，循环体里的 i / j 照样有定义。
      // 三个坑：①a 自己已经带着结尾的 )，别再补一个；
      //        ②条件不能写成字面量 false —— 常量条件下 javac 会判定循环体不可达，报「无法访问的语句」；
      //        ③现在 a 可能连 for 都没有（关键字白送了），不能靠前缀判断。
      const body = /^for\s*\(/.test(a) ? a.slice(a.indexOf('(') + 1) : a.slice(1, -1);
      const parts = body.split(';');
      if (parts.length === 3) {
        const v = (parts[1].match(/[A-Za-z_$][\w$]*/) || ['i'])[0];
        parts[1] = ' ' + v + ' < 0';
      }
      wrong[id] = /^for\s*\(/.test(a)
        ? a.slice(0, a.indexOf('(') + 1) + parts.join(';')
        : '(' + parts.join(';') + ')';
    } else if (/^(while|if)\s*\(/.test(a)) {
      wrong[id] = a.replace(/\(.*\)/, '(false)');
    } else if (/^int\s+\w+\s*=/.test(a)) {
      wrong[id] = a.replace(/=.*;$/, '= 0;');
    } else {
      wrong[id] = 'return new int[0];';
    }
  }
  r = await postJson('/api/problem/two-sum/fill/check', {
    tier: 'brute', level: 'easy', answers: wrong,
  });
  ok('能构造出「能编译但答错」的卷子',
    r.j && r.j.grade && r.j.grade.compiled === true,
    r.j && r.j.grade && (r.j.grade.compileErrors || [])[0]);
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
  // 挑任意一个空，把运算符两边的空格去掉 —— 这正是新手常见的真实差异。
  // 不能用「加空格」：norm() 会把连续空白折叠成一个，加空格反而不算差异。
  // 去掉空格后 norm 前后确实不同（它只折叠空白，不删空格），mismatch 才会 > 0。
  const tgt = easy.blanks[0];
  const spaced = Object.assign({}, good);
  spaced[tgt.id] = good[tgt.id].replace(/\s*([=<>+;])\s*/g, '$1');
  ok('改写后的写法和原文确实不同（否则本节测不到东西）',
    spaced[tgt.id] !== good[tgt.id], spaced[tgt.id]);
  r = await postJson('/api/problem/two-sum/fill/check', {
    tier: 'brute', level: 'easy', answers: spaced,
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
  // 顺序是 困难 → 中等 → 简单，最狠的排第一个
  ok('难度选择器还在，只剩三档（空白已搬去解法档）',
    /const LEVELS = \[\['hard'/.test(app) && !/const LEVELS = \[\['blank'/.test(app));
  ok('默认就落在空白解上（练的是从零写，不是填回别人挖的空）', /tier: 'blank'/.test(app));
  ok('空白解下不显示难度条（那三档只对挖空有意义）', /style\.display = 'none'/.test(app));
  ok('空白卷面按模板行拆出来，拼回去和模板一致',
    /const blankSeed = \(\) =>/.test(app) && app.includes('@@HOLE:'));
  ok('尾部多出来的空行会被去掉（后端模板以 \\n 结尾，split 会多一个空串）',
    /while \(lines\.length && lines\[lines\.length - 1\]\.trim\(\) === ''\) lines\.pop\(\)/.test(app));
  ok('空白卷面的回车是真新增一行，不是跳下一个空', /st\.rows\.splice\(i \+ 1, 0, lead\)/.test(app));
  ok('解法档选择器里空白排第一', /const TIERS = \[\['blank', '空白解'\]/.test(app));
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
