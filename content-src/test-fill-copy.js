const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const app = read('static/app.js');
const css = read('static/app.css');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('=== 【1】两套卷面都有复制按钮 ===');
ok('空白卷面有复制按钮', /id="btn-fill-copy"/.test(app));
ok('按钮上写的是「复制整份代码」', /id="btn-fill-copy">复制整份代码</.test(app));
ok('复制按钮出现两次（空白卷面 + 挖空卷面各一个）',
  (app.match(/id="btn-fill-copy"/g) || []).length >= 2);
ok('按钮包在 .pad-wrap 里（absolute 定位需要一个 relative 祖先）',
  /<div class="pad-wrap">[\s\S]{0,200}id="btn-fill-copy"/.test(app));
ok('.pad-wrap 是 position: relative', /\.pad-wrap \{ position: relative; \}/.test(css));
ok('.pad-copy 绝对定位到右上角',
  /\.pad-copy \{[\s\S]{0,200}position: absolute;[\s\S]{0,80}top: 8px;[\s\S]{0,80}right: 8px/.test(css));
ok('.pad-code 顶部留了 46px 给按钮让位', /\.pad-code \{[\s\S]{0,200}padding: 46px var\(--s4\) var\(--s4\)/.test(css));

console.log('');
console.log('=== 【2】复制的内容就是交上去判的那份代码 ===');
ok('有 blankCode()（空白卷面拼代码）', /const blankCode = \(\) => \(st\.rows \|\| \[\]\)\.join\('\\n'\)/.test(app));
ok('有 sheetCode()（挖空卷面拼代码）', /function sheetCode\(\)/.test(app));
ok('sheetCode 把 @@HOLE:n@@ 换成填进去的内容',
  /replace\(\/@@HOLE:\(\\d\+\)@@\/g/.test(app));
ok('没填的空留成空串（不是删掉整行）', /const v = \(st\.answers && st\.answers\[id\]\) \|\| '';/.test(app));
ok('currentCode() 按档位分派', /return st\.tier === 'blank' \? blankCode\(\) : sheetCode\(\);/.test(app));
ok('复制走 currentCode()', /copyText\(currentCode\(\)\)/.test(app));
ok('交卷也用 blankCode()，不是另写一遍 join',
  /const code = blankCode\(\);/.test(app) && !/const code = \(st\.rows \|\| \[\]\)\.join\('\\n'\);/.test(app));

console.log('');
console.log('=== 【3】复制按钮真的绑定了 ===');
ok('空白卷面绑了 copySheet', /const box = \$\('#fill-body'\);\s*\n\s*\$\('#btn-fill-copy', box\)\.addEventListener\('click', copySheet\);/.test(app));
ok('挖空卷面也绑了', /st\.sheet, st\.answers\);\s*\n\s*\$\('#btn-fill-copy'\)\.addEventListener\('click', copySheet\);/.test(app));
ok('复制成功有提示', /toast\('整份代码已复制/.test(app));
ok('用的是已有的 copyText（有 execCommand 兜底）', /async function copyText/.test(app));

console.log('');
console.log('=== 【4】真值：用真实接口的数据拼一遍 ===');
(async () => {
  const base = process.env.LC_API || 'http://127.0.0.1:8099';

  // 空白卷面
  const blank = await (await fetch(base + '/api/problem/two-sum/fill?tier=blank&level=hard')).json();
  const rows = blank.template.replace(/\r\n/g, '\n').split('\n')
    .map((l) => /@@HOLE:\d+@@/.test(l) ? '' : l);
  while (rows.length && rows[rows.length - 1].trim() === '') rows.pop();
  const blankCode = rows.join('\n');
  ok('空白卷面拼出来是合法 Java（含 class Solution）', /class Solution \{/.test(blankCode));
  ok('空白卷面里没有残留的 @@HOLE', !blankCode.includes('@@HOLE'));
  ok('空白卷面保留缩进和空行', blankCode.includes('\n\n\n'));

  // 挖空卷面：拿 easy 档，把每个空填上参考解那一行
  const easy = await (await fetch(base + '/api/problem/two-sum/fill?tier=brute&level=easy')).json();
  const prob = await (await fetch(base + '/api/problem/two-sum')).json();
  const sol = prob.solutions.find((s) => s.tier === 'brute') || prob.solutions[0];
  const src = sol.codeJava.replace(/\r\n/g, '\n').split('\n');
  const answers = {};
  for (const b of easy.blanks) {
    let v = (src[b.line - 1] || '').trim().replace(/\/\/.*$/, '').trim();
    if (v.endsWith('{')) v = v.slice(0, -1).trim();
    if (b.prefix && v.startsWith(b.prefix)) v = v.slice(b.prefix.length).trim();
    answers[b.id] = v;
  }
  const sheetCode = easy.template.replace(/@@HOLE:(\d+)@@/g, (w, id) => answers[id] || '');
  ok('挖空卷面拼出来没有残留的 @@HOLE', !sheetCode.includes('@@HOLE'));
  ok('挖空卷面每个空都被替换进去了',
    Object.values(answers).every((v) => v === '' || sheetCode.includes(v.trim().slice(0, 8))));

  // ★ 关键：拼出来的代码拿去真判题，必须能过
  const r = await fetch(base + '/api/problem/two-sum/fill/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: 'brute', level: 'easy', answers }),
  });
  const res = await r.json();
  ok('拼出来的代码真判题能过（复制出去粘进力扣也能跑）',
    res.rebuilt === true && res.passedJudge === true,
    JSON.stringify({ rebuilt: res.rebuilt, passedJudge: res.passedJudge }));

  console.log('');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exitCode = fail ? 1 : 0;
})();
