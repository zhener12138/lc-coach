/**
 * 锐评的验收测试。
 *
 * 这里不能只测「有没有渲染出一段文字」——那种测试对空壳实现也能过。
 * 真正要守的是三条设计红线：
 *   1. 每句话都能追到真实数据（编译结果 / 某个维度分数 / evidence 那一行）
 *   2. 分数不同骂法不同，且档位之间有明确分界
 *   3. 骂完必须给出下一步（没有 advice 的锐评就是在耍流氓）
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = 'E:/moren/lc-coach';
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e) => c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (e !== undefined ? '  ← ' + e : '')));

// ---- 加载 roast.js ----
const ctx = { console, JSON, Math, Date, window: null, esc: s => String(s == null ? '' : s) };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(R('static/roast.js'), ctx, { filename: 'roast.js' });

// ---- 构造各种分数的假评分结果 ----
function mk(over) {
  const base = {
    ok: true, total: 7.0, compiled: true, signatureOk: true,
    expectedMethod: 'twoSum', expectedParams: 'int[], int',
    dimensions: [
      { key: 'compile', label: '编译通过', score: 10, verifiable: true, reason: '编译通过', evidence: ['javac 退出码 0'] },
      { key: 'approach', label: '思路匹配', score: 7, verifiable: false, reason: '用了哈希', evidence: ['识别到的手法：哈希'] },
      { key: 'complexity', label: '时间复杂度', score: 7, verifiable: false, reason: 'O(n)', evidence: ['最大循环嵌套 1 层', '无递归'] },
      { key: 'space', label: '空间复杂度', score: 8, verifiable: false, reason: 'O(n)', evidence: ['用了额外数组'] },
      { key: 'edge', label: '边界处理', score: 6, verifiable: false, reason: '可能漏了空数组守卫', evidence: ['直接下标访问但没判长度'] },
      { key: 'style', label: '代码规范', score: 8, verifiable: false, reason: '命名合理', evidence: ['单字母变量：i'] }
    ]
  };
  return Object.assign(base, over || {});
}

console.log('=== 1. 四个档位各说各的话 ===');
const tiers = [
  ['<5 分', mk({ total: 4.2 }), /离「能过」还隔着|努力程度|脑子好像没收尾/],
  ['5~7 分', mk({ total: 6.1 }), /只是「能跑」|及格线上下|抄了个形状/],
  ['7~8.5 分', mk({ total: 7.8 }), /最容易被刷掉|过得不漂亮|不是在对答案/],
  ['>=8.5 分', mk({ total: 9.2 }), /真懂了|干净|该有的都有/]
];
for (const [name, g, re] of tiers) {
  const r = ctx.roastFor(g);
  ok(`${name} 命中对应档位`, re.test(r.head), r.head);
}

console.log('\n=== 2. 编译不过 / 方法名错，必须优先于分数档 ===');
const broken = ctx.roastFor(mk({ total: 3.9, compiled: false, compileErrors: ['第 6 行：需要;'] }));
ok('编译不过时说的是编译', /javac|编译/.test(broken.head), broken.head);
ok('引用了真实编译报错', broken.body.includes('第 6 行：需要;'), broken.body);
ok('明确说其他维度此刻没意义', /空谈|没有意义|不存在的程序/.test(broken.body));

const wrongSig = ctx.roastFor(mk({ total: 5.5, signatureOk: false, expectedMethod: 'twoSum', expectedParams: 'int[], int' }));
ok('方法名错时点名期望签名', wrongSig.body.includes('twoSum') && wrongSig.body.includes('int[], int'), wrongSig.body);
ok('方法名错时说明这是白丢分', /最不该丢|零分/.test(wrongSig.advice + wrongSig.body));

console.log('\n=== 3. 骂点必须来自真实最弱维度 ===');
const g = mk({ total: 7.0 });
const r = ctx.roastFor(g);
ok('点了最弱维度的名字（边界处理 6 分）', r.body.includes('边界处理'), r.body);
ok('报出了该维度的真实分数', r.body.includes('6'), r.body);
ok('引用了该维度的 evidence 原话', r.body.includes('直接下标访问但没判长度'), r.body);
ok('没有乱点别的维度（最弱不是编译）', !r.body.includes('编译通过」6'));

const allGood = mk({ total: 9.6 });
allGood.dimensions.forEach(d => { d.score = 10; });
const r2 = ctx.roastFor(allGood);
ok('满分时不硬找茬', /没有短板/.test(r2.body), r2.body);
ok('满分时建议往前走', /往前走|进阶|浪费时间/.test(r2.advice), r2.advice);

console.log('\n=== 4. 每条锐评都必须给下一步 ===');
const cases = [
  mk({ total: 3.0 }), mk({ total: 4.9 }), mk({ total: 6.0 }), mk({ total: 7.5 }),
  mk({ total: 8.0 }), mk({ total: 9.9 }), mk({ total: 3.9, compiled: false }),
  mk({ total: 5.5, signatureOk: false })
];
let missing = 0;
for (const c of cases) {
  const rr = ctx.roastFor(c);
  if (!rr.advice || rr.advice.length < 8) { missing++; console.log('     缺 advice:', JSON.stringify(rr)); }
}
ok('8 种情况全部给出了 advice（>=8 字）', missing === 0, missing + ' 个缺失');

console.log('\n=== 5. 同一份代码重复评分，说的话必须一样 ===');
const a1 = ctx.roastFor(mk({ total: 6.6 })).head;
const a2 = ctx.roastFor(mk({ total: 6.6 })).head;
const a3 = ctx.roastFor(mk({ total: 6.6 })).head;
ok('三次生成同一句话（用分数做种子）', a1 === a2 && a2 === a3, [a1, a2, a3].join(' | '));

console.log('\n=== 6. 渲染成 HTML，且不注入脏东西 ===');
const html = ctx.renderRoast(mk({ total: 7.0 }));
ok('有 .roast 容器', html.includes('class="roast"'));
ok('有「锐评」标签', html.includes('锐评'));
ok('有 head 段', html.includes('roast-head'));
ok('有 advice 段', html.includes('roast-advice'));
ok('没有裸露 undefined', !html.includes('undefined'));
ok('没有裸露 null', !html.includes('>null<'));
// 空输入不该崩；但它也不该返回空 —— 评分失败时更需要一句人话
ok('空输入不抛异常', !!ctx.renderRoast(null) && !!ctx.renderRoast({}));
ok('评分失败时给出的是可读提示，不是空白', /没跑起来|再点一次/.test(ctx.renderRoast(null)));

const xss = mk({ total: 3.9, compiled: false, compileErrors: ['<script>alert(1)</script>'] });
const xssHtml = ctx.renderRoast(xss);
ok('编译报错里的 HTML 被转义', !xssHtml.includes('<script>'), xssHtml.slice(0, 200));
ok('转义后仍能看到原文', xssHtml.includes('&lt;script&gt;'));

console.log('\n=== 7. 接线：评分结果里真的有锐评 ===');
const app = R('static/app.js');
const idxHtml = R('static/index.html');
const css = R('static/app.css');
ok('roast.js 在 app.js 之前加载', idxHtml.indexOf('roast.js') > 0 && idxHtml.indexOf('roast.js') < idxHtml.indexOf('app.js'));
ok('renderGradeResult 调用了 renderRoast', /renderGradeResult[\s\S]{0,3000}renderRoast\(g\)/.test(app));
ok('有 typeof 兜底（roast.js 没加载也不崩）', app.includes("typeof renderRoast === 'function'"));
ok('CSS 有 .roast', css.includes('.roast {'));
ok('CSS 有 .roast-head', css.includes('.roast-head'));
ok('CSS 有 .roast-advice', css.includes('.roast-advice'));
ok('CSS 有 .roast-tag', css.includes('.roast-tag'));

console.log('\n=== 8. 真实后端数据也能跑出锐评 ===');
(async () => {
  const g = await (await fetch('http://127.0.0.1:8099/api/problem/two-sum')).json();
  ok('拿到两数之和三解法评分', !!(g.refGrades && g.refGrades.brute));

  // 用法：把参考解法的评分喂给 roastFor，确认不抛异常
  let threw = null;
  try { ctx.roastFor(g.refGrades.brute); ctx.roastFor(g.refGrades.optimal); }
  catch (e) { threw = e.message; }
  ok('真实评分数据喂进去不抛异常', threw === null, threw);

  const rb = ctx.roastFor(g.refGrades.brute);
  const ro = ctx.roastFor(g.refGrades.optimal);
  ok('暴力解和最优解的锐评不一样', rb.head !== ro.head || rb.body !== ro.body);
  console.log('     暴力解锐评：' + rb.head);
  console.log('     最优解锐评：' + ro.head);

  console.log('\n' + '='.repeat(56));
  console.log(`通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
