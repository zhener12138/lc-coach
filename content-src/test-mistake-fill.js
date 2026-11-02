/**
 * 错题「自动填写」的验收测试。
 *
 * 这块最容易滑向「编一段听起来有道理的话」。所以测试重点不是「有没有填上字」，
 * 而是**填的每一个事实都能追溯到评分数据**：
 *   - 卡点是不是真的取差距最大的维度
 *   - 说的是不是人话（第一人称），而不是把机器判据原文抄一遍
 *   - 没评分的时候会不会硬编
 *   - 编译不过时会不会被维度差距掩盖
 *
 * 口径来自用户 m04329：他自己写的错题是「想到暴力双循环，不知道哈希表怎么用；
 * HashMap 语法写不出来」。所以这里有一条硬红线 ——
 * 正文里不许出现「识别到的手法：」「最大循环嵌套」「差 X 分」「你 4，最优解 10」
 * 这类机器判据原文，它们只准进 notes。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e) => c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (e !== undefined ? '  ← ' + e : '')));

// ---- 加载 mistake-fill.js ----
const ctx = { console, JSON, Math, Date, String, Number, Array };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(R('static/mistake-fill.js'), ctx, { filename: 'mistake-fill.js' });

function dim(key, label, score, reason, evidence) {
  return { key, label, score, verifiable: false, reason, evidence: evidence || [reason] };
}

// 我的评分：复杂度 3 分是最大短板
const mine = {
  ok: true, total: 7.3, compiled: true, signatureOk: true,
  expectedMethod: 'twoSum', expectedParams: 'int[], int',
  dimensions: [
    dim('compile', '编译通过', 10, 'javac 实际编译通过，无报错。', ['javac -encoding UTF-8 退出码 0']),
    dim('approach', '思路匹配', 7.5, '参考最优解用的是「哈希、辅助数组」，你这里用上了「辅助数组」。', ['识别到的手法：辅助数组']),
    dim('complexity', '时间复杂度', 3, '推测 O(n^2)，最优解是 O(n)，差 2 档。', ['最大循环嵌套 2 层', '无递归', '参考最优：O(n)']),
    dim('space', '空间复杂度', 8, '开了辅助数组，额外 O(n) 空间。', ['开了辅助数组，额外 O(n) 空间']),
    dim('edge', '边界处理', 7, '可能出问题的地方：直接下标访问但没先判长度', ['直接下标访问但没先判长度，空数组会抛越界']),
    dim('style', '代码规范', 9, '一行注释都没有', ['一行注释都没有'])
  ],
  inferred: { time: 'O(n^2)', nesting: 2, recursive: false, techs: ['辅助数组'] },
  reference: { optimalTime: 'O(n)', optimalSpace: 'O(n)', optimalTechs: ['哈希', '辅助数组'] }
};

// 最优解评分
const ref = {
  ok: true, total: 9.1,
  dimensions: [
    dim('compile', '编译通过', 10, 'ok'),
    dim('approach', '思路匹配', 10, '都用哈希', ['识别到的手法：哈希、辅助数组']),
    dim('complexity', '时间复杂度', 10, '与最优解同级', ['最大循环嵌套 1 层', '无递归', '参考最优：O(n)']),
    dim('space', '空间复杂度', 7, '开了哈希表', ['开了哈希表，额外 O(n) 空间']),
    dim('edge', '边界处理', 7, '可能出问题', ['直接下标访问但没先判长度，空数组会抛越界']),
    dim('style', '代码规范', 9, '一行注释', ['一行注释都没有'])
  ],
  inferred: { time: 'O(n)', nesting: 1, recursive: false, techs: ['哈希', '辅助数组'] },
  reference: { optimalTime: 'O(n)', optimalSpace: 'O(n)', optimalTechs: ['哈希', '辅助数组'] }
};

/** 机器判据原文，一个都不许出现在正文里 */
const JARGON = [
  '识别到的手法',
  '最大循环嵌套',
  '参考最优',
  '维度匹配度',
  '差 ' ,
  '（你 ',
  '最优解是：'
];
function hasJargon(s) {
  return JARGON.filter(j => s.includes(j));
}

console.log('=== 1. 卡点必须来自真实差距最大的维度，但要用说人话的方式 ===');
const f = ctx.mistakeAutofill(mine, ref, '哈希表');
ok('填了 whereStuck', !!f.whereStuck, JSON.stringify(f));
ok('点的是复杂度（差距 7 分最大），说的是「循环套循环」',
  /O\(n\^2\)/.test(f.whereStuck) && /循环/.test(f.whereStuck), f.whereStuck);
ok('第一人称，不是诊断腔', /^我/.test(f.whereStuck), f.whereStuck);
ok('正文里没有「识别到的手法」「最大循环嵌套」「差 X 分」这类机器原文',
  hasJargon(f.whereStuck).length === 0, '含：' + hasJargon(f.whereStuck).join(' / '));
ok('分数和维度名只进了 notes', f.notes.some(n => n.includes('时间复杂度')), JSON.stringify(f.notes));

console.log('\n=== 2. 一句话结论必须说清下次该抓什么 ===');
ok('填了 oneLiner', !!f.oneLiner, f.oneLiner);
ok('点名我漏掉的手法「哈希」', f.oneLiner.includes('哈希'), f.oneLiner);
ok('没有把我已经会的手法「辅助数组」说成漏掉', !/先想.*辅助数组/.test(f.oneLiner), f.oneLiner);
ok('带上了复杂度对比（O(n^2) → O(n)）', /O\(n\^2\)/.test(f.oneLiner) && /O\(n\)/.test(f.oneLiner), f.oneLiner);
ok('也是第一人称口吻', /^下次/.test(f.oneLiner) || /^我/.test(f.oneLiner), f.oneLiner);

console.log('\n=== 3. 手法要翻成人话，不能把内部代号直接甩出来 ===');
ok('哈希 → 哈希表', ctx.techSay('哈希') === '哈希表');
ok('BFS → 广搜', ctx.techSay('BFS') === '广搜');
ok('辅助数组 → 另开数组存', ctx.techSay('辅助数组') === '另开数组存');
ok('没登记的手法原样输出，不会变成 undefined', ctx.techSay('某种没见过的写法') === '某种没见过的写法');
const weird = JSON.parse(JSON.stringify(mine));
weird.inferred.techs = ['某种没见过的写法'];
const fw = ctx.mistakeAutofill(weird, ref, '');
ok('遇到没登记的手法也不崩、也不出 undefined', !/undefined/.test(fw.whereStuck + fw.oneLiner), fw.whereStuck + ' | ' + fw.oneLiner);

console.log('\n=== 4. 思路维度真的落后时，要写成「没想到这一步」而不是报分数 ===');
// 用户 m04329 的原场景：思路匹配 4 分，手法是「排序」，最优解是「哈希+辅助数组」
const mySort = JSON.parse(JSON.stringify(mine));
mySort.total = 6.4;
mySort.inferred = { time: 'O(n log n)', nesting: 1, recursive: false, techs: ['排序'] };
mySort.dimensions = mySort.dimensions.map(d => {
  if (d.key === 'approach') return dim('approach', '思路匹配', 4, '参考最优解用的是「哈希、辅助数组」，你这里用上了「排序」。', ['识别到的手法：排序']);
  if (d.key === 'complexity') return dim('complexity', '时间复杂度', 6, '推测 O(n log n)，最优解是 O(n)', ['最大循环嵌套 1 层', '参考最优：O(n)']);
  if (d.key === 'space') return dim('space', '空间复杂度', 8, '没额外开空间', ['没额外开空间']);
  if (d.key === 'edge') return dim('edge', '边界处理', 8, '没问题', ['无明显边界问题']);
  if (d.key === 'style') return dim('style', '代码规范', 9, '一行注释', ['一行注释都没有']);
  return d;
});
const fSort = ctx.mistakeAutofill(mySort, ref, '哈希表');
console.log('     → ' + fSort.whereStuck);
ok('思路差最多时，卡点落在思路上', /没往.*哈希表.*上想/.test(fSort.whereStuck), fSort.whereStuck);
ok('说出了我当时的做法（先排序）', /先排序/.test(fSort.whereStuck), fSort.whereStuck);
ok('说出了我卡在哪个语法上（HashMap 的 put / getOrDefault）',
  /HashMap/.test(fSort.whereStuck) && /put/.test(fSort.whereStuck), fSort.whereStuck);
ok('思路的卡点也不许出现「识别到的手法：排序」这种原文',
  hasJargon(fSort.whereStuck).length === 0, '含：' + hasJargon(fSort.whereStuck).join(' / '));

console.log('\n=== 5. 边界 / 空间 / 规范各自能说出对应的人话 ===');
const myEdge = JSON.parse(JSON.stringify(mine));
// 复杂度也得先抬起来，否则它永远是差距最大那一项，测不到边界
myEdge.dimensions = myEdge.dimensions.map(d => {
  if (d.key === 'complexity') return dim('complexity', '时间复杂度', 10, '与最优解同级', ['最大循环嵌套 1 层', '参考最优：O(n)']);
  if (d.key === 'edge') return dim('edge', '边界处理', 3, '空数组会崩', ['直接下标访问但没先判长度，空数组会抛越界']);
  return d;
});
const fEdge = ctx.mistakeAutofill(myEdge, ref, '');
console.log('     → ' + fEdge.whereStuck);
ok('边界差最多时说「漏了哪种输入」', /边界上我漏了/.test(fEdge.whereStuck) && /空数组/.test(fEdge.whereStuck), fEdge.whereStuck);

const mySpace = JSON.parse(JSON.stringify(mine));
mySpace.dimensions = mySpace.dimensions.map(d => {
  if (d.key === 'complexity') return dim('complexity', '时间复杂度', 10, '与最优解同级', ['最大循环嵌套 1 层', '参考最优：O(n)']);
  if (d.key === 'space') return dim('space', '空间复杂度', 2, '开了两层辅助', ['new int[n][n]']);
  return d;
});
const fSpace = ctx.mistakeAutofill(mySpace, ref, '');
console.log('     → ' + fSpace.whereStuck);
ok('空间差最多时说「我多开了什么 / 最优解只用多少」',
  /空间上我/.test(fSpace.whereStuck) && /最优解只用/.test(fSpace.whereStuck), fSpace.whereStuck);

const myStyle = JSON.parse(JSON.stringify(mine));
myStyle.dimensions = myStyle.dimensions.map(d => {
  if (d.key === 'complexity') return dim('complexity', '时间复杂度', 10, '与最优解同级', ['最大循环嵌套 1 层', '参考最优：O(n)']);
  if (d.key === 'style') return dim('style', '代码规范', 3, '变量全是 a b c', ['没有一行注释，变量名是 a、b、c']);
  return d;
});
const fStyle = ctx.mistakeAutofill(myStyle, ref, '');
console.log('     → ' + fStyle.whereStuck);
ok('规范差最多时说「哪几行让人读不下去」', /代码里/.test(fStyle.whereStuck) && /a、b、c/.test(fStyle.whereStuck), fStyle.whereStuck);

console.log('\n=== 6. tag 沿用题目的，没有才用手法兜底 ===');
ok('有题目 tag 就用题目的', f.tag === '哈希表', f.tag);
const f2 = ctx.mistakeAutofill(mine, ref, '');
ok('没题目 tag 时用最优解的手法', f2.tag === '哈希', f2.tag);
ok('并说明了 tag 的来源', f2.notes.some(n => n.includes('tag')));

console.log('\n=== 7. 编译不过是压倒性卡点，不能被维度差距掩盖 ===');
const broken = JSON.parse(JSON.stringify(mine));
broken.compiled = false;
broken.total = 3.9;
broken.compileErrors = ['第 6 行：需要;'];
const fb = ctx.mistakeAutofill(broken, ref, '');
ok('卡在哪说的是编译不过', fb.whereStuck.includes('没编译通过'), fb.whereStuck);
ok('引用了真实报错行', fb.whereStuck.includes('第 6 行：需要;'), fb.whereStuck);
ok('没有跑去说复杂度', !fb.whereStuck.includes('O(n^2)'), fb.whereStuck);
ok('说明了这是最高优先级', fb.notes.some(n => n.includes('最高优先级')));

const wrongSig = JSON.parse(JSON.stringify(mine));
wrongSig.signatureOk = false;
wrongSig.expectedMethod = 'twoSum';
wrongSig.expectedParams = 'int[], int';
const fs2 = ctx.mistakeAutofill(wrongSig, ref, '');
ok('签名错优先于维度差距', fs2.whereStuck.includes('twoSum'), fs2.whereStuck);
ok('说明判题器调不到', /调不到/.test(fs2.oneLiner), fs2.oneLiner);

console.log('\n=== 8. 没有数据就不编 ===');
ok('没 my 评分 → 全空', ctx.mistakeAutofill(null, ref, '').whereStuck === '');
ok('没 ref → 全空', ctx.mistakeAutofill(mine, null, '').whereStuck === '');
const notOk = ctx.mistakeAutofill({ ok: false }, ref, '');
ok('评分失败 → 全空（不硬凑）', notOk.whereStuck === '' && notOk.oneLiner === '', JSON.stringify(notOk));

console.log('\n=== 9. 我没有明显落后时不许乱扣帽子 ===');
const perfect = JSON.parse(JSON.stringify(ref));
const fp = ctx.mistakeAutofill(perfect, ref, '');
ok('完全相同 → 不说有卡点', fp.whereStuck === '', fp.whereStuck);
ok('说明没有单项差距', fp.notes.some(n => n.includes('没有单项差距')) || fp.whereStuck === '');

const better = JSON.parse(JSON.stringify(ref));
better.total = 9.8;
better.dimensions.forEach(d => { d.score = 10; });
const fbetter = ctx.mistakeAutofill(better, ref, '');
ok('我比最优解还好 → 不找茬', fbetter.whereStuck === '', fbetter.whereStuck);

console.log('\n=== 10. 真正接入前端了吗 ===');
const app = R('static/app.js');
const idx = R('static/index.html');
const css = R('static/app.css');
ok('mistake-fill.js 在 app.js 之前加载', idx.indexOf('mistake-fill.js') > 0 && idx.indexOf('mistake-fill.js') < idx.indexOf('app.js'));
ok('评分后把结果存进 State', app.includes('State.lastGrade = g'));
ok('同时存了 slug（防张冠李戴）', app.includes('State.lastGradeSlug = slug'));
ok('State 里声明了这两个字段', app.includes('lastGrade: null') && app.includes('lastGradeSlug: null'));
ok('错题入口只传同题的成绩', app.includes('sameSlug ? State.lastGrade : null'));
ok('弹窗有自动填写按钮', app.includes('id="m-autofill"'));
ok('按钮调用了 mistakeAutofill', app.includes('mistakeAutofill('));
ok('没评分时按钮不出现，并说明原因', app.includes('m-side-idle') && app.includes('先在上面点一次'));
ok('填完显示依据', app.includes('m-side-why') && app.includes('依据'));
ok('填完把光标放进输入框', app.includes('setSelectionRange'));
ok('CSS 有双栏布局', css.includes('.m-grid') && css.includes('grid-template-columns'));
ok('CSS 有窄屏回退', css.includes('@media (max-width: 720px)'));

console.log('\n=== 11. 真实后端数据跑一遍 ===');
(async () => {
  const p = await (await fetch('http://127.0.0.1:8099/api/problem/two-sum')).json();
  ok('后端返回了 optimalTechs', !!(p.refGrades.optimal.reference.optimalTechs));

  // 造一份「像用户会写的暴力解」的评分：直接拿后端的 brute 当用户成绩
  const r = ctx.mistakeAutofill(p.refGrades.brute, p.refGrades.optimal, '哈希表');
  ok('真实数据能生成填写内容', !!r.whereStuck && !!r.oneLiner, JSON.stringify(r));
  console.log('     卡在哪：' + r.whereStuck);
  console.log('     一句话：' + r.oneLiner);
  console.log('     依据：' + r.notes.join(' / '));
  ok('真实数据的正文也没有机器原文',
    hasJargon(r.whereStuck).length === 0 && hasJargon(r.oneLiner).length === 0,
    '含：' + hasJargon(r.whereStuck + r.oneLiner).join(' / '));

  console.log('\n' + '='.repeat(56));
  console.log(`通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
