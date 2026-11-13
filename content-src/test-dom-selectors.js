/**
 * 拦住「把 $ 的返回值当数组用」这类错误。
 *
 * 背景：app.js 第 9-10 行
 *   const $  = (s, r = document) => r.querySelector(s);                 // 单个节点
 *   const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));  // 数组
 *
 * 我在加「复制整份代码」按钮时把 $$ 手滑写成 $，
 * 于是 inputs.forEach 直接抛 "inputs.forEach is not a function"，整个页面白屏。
 * `node --check` 能过（只查语法），只有真跑起来才炸。
 *
 * ★ 这个脚本自己踩过的坑（第一版报出 11 条全是误报）：
 *   判据写成了「这行出现过这个变量名 + 之后出现过 .length/.forEach」，
 *   于是 `t.slugs.length` 被算成「t 被当数组用」（slugs 是 t 的字段）。
 *   改成：只看「这个变量名后面紧跟的链式调用」—— 名字和用法必须直接相邻。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const app = read('static/app.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('=== 【1】$ 和 $$ 的定义没被改坏 ===');
ok('$ 返回单个节点（querySelector）',
  app.includes('const $  = (s, r = document) => r.querySelector(s);'));
ok('$$ 返回数组（Array.from + querySelectorAll）',
  app.includes('const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));'));

console.log('');
console.log('=== 【2】从 $ 取到的变量，不许紧跟数组方法 ===');
// 收集「= $(...)」赋的变量名
const fromDollar = new Map();   // name -> line
app.split('\n').forEach((line, i) => {
  const code = line.replace(/\/\/.*$/, '');
  // 注意 $$ 会先被匹配成「$」+「$」，所以要求 $ 后面不是 $
  const m = code.match(/\b(?:const|let|var)\s+(\w+)\s*=\s*\$(?!\$)\s*\(/);
  if (m) fromDollar.set(m[1], i + 1);
});
console.log('    从 $ 取值：' + [...fromDollar.keys()].join(', '));

// ★ 判据：变量名后面【直接相邻】出现数组方法 / 下标 / .length
//    `t.slugs.length` 里 t 后面紧跟的是 `.slugs`，不匹配 → 不误报
function arrayUseAfter(name) {
  const re = new RegExp(
    '\\b' + name + '\\b' +
    '\\s*(?:\\.(?:forEach|map|filter|slice|some|every|find|indexOf|join|reduce|sort|push|pop|shift|concat|includes)\\b|\\.length\\b|\\[)'
  );
  const hits = [];
  app.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (re.test(code)) hits.push({ line: i + 1, text: line.trim() });
  });
  return hits;
}

const bad = [];
for (const [name, declLine] of fromDollar) {
  const hits = arrayUseAfter(name).filter((h) => h.line !== declLine);
  if (hits.length) bad.push({ name, declLine, hit: hits[0] });
}
ok('没有把 $ 的结果当数组用', bad.length === 0,
  bad.map((b) => '第 ' + b.declLine + ' 行声明 ' + b.name + '，第 ' + b.hit.line + ' 行当数组：' + b.hit.text).join(' | '));

console.log('');
console.log('=== 【3】对照：从 $$ 取到的变量本来就该当数组用 ===');
const fromDollarDollar = new Map();
app.split('\n').forEach((line, i) => {
  const code = line.replace(/\/\/.*$/, '');
  const m = code.match(/\b(?:const|let|var)\s+(\w+)\s*=\s*\$\$\s*\(/);
  if (m) fromDollarDollar.set(m[1], i + 1);
});
ok('$$ 的变量确实存在', fromDollarDollar.size > 0, [...fromDollarDollar.keys()].join(', '));
// 反过来：$$ 的变量如果被当单节点用（.value / .addEventListener 不带下标）也是可疑的，
// 但那条判据误报率高（for 循环里取单个写法很常见），这里只做提示不判失败。
console.log('    （' + [...fromDollarDollar.keys()].length + ' 个：' + [...fromDollarDollar.keys()].join(', ') + '）');

console.log('');
console.log('=== 【4】三个卷面的 inputs 都必须用 $$ 取 ===');
ok('空白卷面用 $$（踩过：写成 $ 导致白屏）',
  app.includes("const inputs = $$('.pad-input', box);"));
ok('挖空卷面用 $$',
  app.includes("const inputs = $$('.fl-input', $('#fill-body'));"));
ok('自由卷面用 $$',
  app.includes("inputs = $$('.pad-input', box);"));
ok('**一个都不许写成 $**',
  !app.includes("const inputs = $('.pad-input'") &&
  !app.includes("const inputs = $('.fl-input'"));

console.log('');
console.log('=== 【5】复制按钮的绑定还在（上一轮新加的）===');
ok('空白卷面绑了复制按钮', app.includes("$('#btn-fill-copy', box).addEventListener('click', copySheet);"));
ok('挖空卷面也绑了', app.includes("$('#btn-fill-copy').addEventListener('click', copySheet);"));

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exitCode = fail ? 1 : 0;
