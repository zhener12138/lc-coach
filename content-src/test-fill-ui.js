/**
 * 填空题的两块渲染必须真跑一遍。
 *
 * 为什么单独测这两个：`viewFill` 是异步 + 需要 DOM，模拟起来成本高；
 * 但真正拼 HTML 的是 `fillSheetHtml` / `renderFillResult` 这两个纯函数 ——
 * 它们里面一句变量名写错、一个未定义函数，页面就是白屏，而且正则检查看不出来。
 * 把这两个函数从 app.js 里切出来在 vm 里直接调用，是最省事又最接近真机的验证。
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'static/app.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

/**
 * 从源码里按名字切出一个顶层函数。
 *
 * 不用「数花括号」：app.js 的注释里就写着裸的 { （解释行尾那个花括号为什么留着），
 * 计数器把它当代码算进去，永远配不平，切出 0 字符 —— 而且报错信息只会说「切得出 X → 0 字符」，
 * 看的人根本猜不到是注释里的一个字符干的。
 *
 * 改成按行切：顶层函数以顶格的 } 结尾。这依赖一个稳定事实（app.js 的顶层函数都顶格写），
 * 比「注释里不能出现某个字符」这种约定可靠得多。
 * 行尾的 \r 要先去掉 —— 这个仓库里的文件是 CRLF。
 */
function sliceFn(src, name) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const sig = 'function ' + name + '(';
  const start = lines.findIndex(l => l.startsWith(sig));
  if (start < 0) return '';
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '}') return lines.slice(start, i + 1).join('\n');
  }
  return '';
}

const ctx = {
  esc: s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  escAttr: s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  console,
};
vm.createContext(ctx);

const sheetHtmlSrc = sliceFn(APP, 'fillSheetHtml');
const resultHtmlSrc = sliceFn(APP, 'renderFillResult');

console.log('=== 【1】能不能切出这两个函数 ===');
ok('切得出 fillSheetHtml', sheetHtmlSrc.length > 500, sheetHtmlSrc.length + ' 字符');
ok('切得出 renderFillResult', resultHtmlSrc.length > 800, resultHtmlSrc.length + ' 字符');
ok('fillSheetHtml 里没有别的未定义依赖', !/renderGradeResult/.test(sheetHtmlSrc));

vm.runInContext(sheetHtmlSrc, ctx);
vm.runInContext(resultHtmlSrc, ctx);

console.log('\n=== 【2】fillSheetHtml 真的能画出卷面 ===');
const sheet = {
  slug: 'two-sum', tier: 'brute', tierName: '暴力解 · 两层循环',
  level: 'easy', totalLines: 12,
  template: [
    'class Solution {',
    '    public int[] twoSum(int[] nums, int target) {',
    '        int n = nums.length;',
    '        for (int i = 0; i < n; i++) {',
    '            @@HOLE:1@@',
    '        }',
    '        return new int[0];',
    '    }',
    '}',
    '',
  ].join('\n'),
  blanks: [{
    id: 1, line: 5, indent: 12,
    shape: '在「for (int i = 0; i < n; i++) {」里面',
    around: '上面：for (int i = 0; i < n; i++) {　下面：}',
  }],
};

let html = vm.runInContext('fillSheetHtml(' + JSON.stringify(sheet) + ', {})', ctx);
ok('画出了 .fill-code 容器', html.includes('class="fill-code"'));
ok('空位变成了输入框', html.includes('class="fl-input"'));
ok('输入框带 data-hole 方便收集答案', /data-hole="1"/.test(html));
ok('空位上标了编号', html.includes('#1') && html.includes('class="fl-tag"'));
ok('保留了原来的缩进（缩进丢了就没法填）',
  html.includes('<pre class="fl-txt">            </pre>'),
  '找不到 12 个空格的缩进');
ok('非空行原样显示', html.includes('public int[] twoSum(int[] nums, int target) {'));
ok('占位符没有漏到 HTML 里', !html.includes('@@HOLE:'));
ok('结构提示挂在 title 上（不剧透答案）', /title="[^"]*for \(int i = 0/.test(html));
ok('有空位时给出了「看不出该填什么」的折叠提示', html.includes('class="fill-hints"'));
ok('折叠提示里不含答案', !/answer/i.test(html));
ok('有交卷按钮', html.includes('id="btn-fill-check"'));
ok('有清空重填', html.includes('id="btn-fill-reset"'));

let withAnswer = vm.runInContext(
  'fillSheetHtml(' + JSON.stringify(sheet) + ', {"1": "return new int[]{i, j};"})', ctx);
ok('已经填过的内容会回填到输入框', /value="return new int\[\]\{i, j\};"/.test(withAnswer));

const xssSheet = JSON.parse(JSON.stringify(sheet));
xssSheet.blanks[0].shape = '<script>alert(1)</script>';
const xss = vm.runInContext('fillSheetHtml(' + JSON.stringify(xssSheet) + ', {})', ctx);
ok('提示文字做了转义（不会把标签当 HTML 渲染）',
  xss.includes('&lt;script&gt;') && !xss.includes('<script>alert'));

console.log('\n=== 【2b】空白档：关键字白送、行尾花括号和注释留在卷面 ===');

// 空白档几乎每行都是空的。如果把 `for` `if` 这些关键字也挖掉，人光看一个空
// 根本猜不到该写 for 还是 if —— 那是猜谜不是练习。所以：
//   · prefix（for/while/if…）白送，只让人填括号里的条件
//   · 行尾的 { 留在卷面上，人不用也不该再打一个
//   · 行尾的 // 注释留着（注释解释「为什么这么写」，是提示不是答案）
const blankSheet = {
  slug: 'two-sum', tier: 'brute', level: 'blank',
  // 关键字在模板里 —— 后端拼的，前端直接照画。
  // 这是线上真实返回的形状：第 4 行就是 'for @@HOLE:2@@ {'。
  template: [
    'class Solution {',
    '    public int[] twoSum(int[] nums, int target) {',
    '        int n = nums.length;',
    '        for @@HOLE:1@@ {',
    '            if @@HOLE:2@@ {',
    '                @@HOLE:3@@',
    '            }',
    '        }',
    '        while @@HOLE:4@@ {  // 收敛点',
    '        }',
    '        return new int[0];',
    '    }',
    '}',
    '',
  ].join('\n'),
  blanks: [
    { id: 1, line: 4, indent: 8, prefix: 'for', branch: true, shape: '在方法体里' },
    { id: 2, line: 5, indent: 12, prefix: 'if', branch: true, shape: '在「for」里面' },
    { id: 3, line: 6, indent: 16, branch: false, shape: '在「if」里面' },
    { id: 4, line: 9, indent: 8, prefix: 'while', branch: true, shape: '在方法体里' },
  ],
};
const bh = vm.runInContext('fillSheetHtml(' + JSON.stringify(blankSheet) + ', {})', ctx);
ok('空白档：四个空都变成输入框', (bh.match(/class="fl-input"/g) || []).length === 4);
ok('空白档：for 关键字在卷面上（缩进 + 关键字 + 输入框）',
  /<pre class="fl-txt">        for <\/pre>\s*<input/.test(bh), bh.slice(0, 500));
ok('空白档：if 关键字在卷面上',
  /<pre class="fl-txt">            if <\/pre>\s*<input/.test(bh));
ok('空白档：while 关键字在卷面上',
  /<pre class="fl-txt">        while <\/pre>\s*<input/.test(bh));
ok('空白档：带了关键字的空，占位符说的是「填括号里的条件」',
  bh.includes('for 后面填括号里的条件'), '占位符没跟着变');
ok('空白档：行尾的 { 留在卷面上（人不用再打一个）',
  /<pre class="fl-tail">\s*\{<\/pre>/.test(bh), (bh.match(/class="fl-tail"[^>]*>[^<]*/g) || []).join(' | '));
ok('空白档：行尾注释留在卷面上（注释是提示不是答案）',
  bh.includes('// 收敛点'), '找不到行尾注释');
ok('空白档：占位符自己不带 for/if 前缀（否则会重复）',
  !/@@HOLE:/.test(bh));
ok('空白档：提示文案说的是「把这一行写出来」', bh.includes('把这一行写出来'));


const passedRes = {
  ok: true, rebuilt: true, passedJudge: true, mismatch: 0,
  blanks: [{ id: 1, line: 5, filled: true, matches: true }],
  grade: { total: 7.9, compiled: true, judge: { ran: true, total: 3, passed: 3, failures: [] } },
};
html = vm.runInContext('renderFillResult(' + JSON.stringify(passedRes) + ', ' + JSON.stringify(sheet) + ')', ctx);
ok('全过 → 标题是「过了」', html.includes('<div class="fr-head">过了</div>'), html.slice(0, 120));
ok('全过 → 报出 3 / 3 全过', /3 \/ 3/.test(html));
ok('全过 → 说每个空都对', html.includes('每个空都和参考写法一致'));
ok('全过 → 说明分数是解法本身的分', html.includes('不是你填空的分数'));
ok('全过 → 外层带 good 类', /class="fill-res good"/.test(html));

const failedRes = {
  ok: true, rebuilt: true, passedJudge: false, mismatch: 1,
  blanks: [{ id: 1, line: 5, filled: true, matches: false }],
  grade: {
    total: 5.8, compiled: true,
    judge: {
      ran: true, total: 3, passed: 0,
      failures: [{ index: 1, input: '[2,7,11,15], 9', expected: '[0,1]', got: '[0,0]' }],
    },
  },
};
html = vm.runInContext('renderFillResult(' + JSON.stringify(failedRes) + ', ' + JSON.stringify(sheet) + ')', ctx);
ok('没过 → 标题是「还没过」', html.includes('还没过'));
ok('没过 → 列出失败的输入', html.includes('[2,7,11,15], 9'));
ok('没过 → 列出期望值', html.includes('[0,1]'));
ok('没过 → 把「你的」单独标出来', /class="bad">\[0,0\]/.test(html));
ok('没过 → 指出哪个空和参考不一致', html.includes('#1'));
ok('没过 → 外层带 bad 类', /class="fill-res bad"/.test(html));

const diffPassRes = {
  ok: true, rebuilt: true, passedJudge: true, mismatch: 1,
  blanks: [{ id: 1, line: 5, filled: true, matches: false }],
  grade: { total: 7.9, compiled: true, judge: { ran: true, total: 3, passed: 3, failures: [] } },
};
html = vm.runInContext('renderFillResult(' + JSON.stringify(diffPassRes) + ', ' + JSON.stringify(sheet) + ')', ctx);
ok('写法不同但过了 → 明说「那就是对的，不用改成我的写法」',
  html.includes('那就是对的') && html.includes('不用改成我的写法'));
ok('写法不同但过了 → 不会被当成错', !html.includes('还没过'));

const partialRes = { ok: true, rebuilt: false, missing: [1, 3], message: '还有 2 个空没填，填完再提交。' };
html = vm.runInContext('renderFillResult(' + JSON.stringify(partialRes) + ', ' + JSON.stringify(sheet) + ')', ctx);
ok('没填完 → 提示还差点', html.includes('还差点'));
ok('没填完 → 列出缺哪几个空', html.includes('#1、#3'));
ok('没填完 → 不出现分数', !/\/ 10/.test(html));

const compileFailRes = {
  ok: true, rebuilt: true, passedJudge: false, mismatch: 1,
  blanks: [{ id: 1, line: 5, filled: true, matches: false }],
  grade: { total: 3.9, compiled: false, compileErrors: ['第 6 行：缺少分号'] },
};
html = vm.runInContext('renderFillResult(' + JSON.stringify(compileFailRes) + ', ' + JSON.stringify(sheet) + ')', ctx);
ok('编译不过 → 先报编译', html.includes('编译没过'));
ok('编译不过 → 带上具体报错', html.includes('第 6 行'));

const unjudgeableRes = {
  ok: true, rebuilt: true, passedJudge: false, mismatch: 0,
  blanks: [{ id: 1, line: 5, filled: true, matches: true }],
  grade: { total: 9.0, compiled: true, judge: { ran: false, reason: '这题答案不唯一，判不了' } },
};
html = vm.runInContext('renderFillResult(' + JSON.stringify(unjudgeableRes) + ', ' + JSON.stringify(sheet) + ')', ctx);
ok('判不了 → 说明为什么', html.includes('答案不唯一'));
ok('判不了 → 不显示 0 / 0 那种唬人的数字', !/0 \/ 0/.test(html));

const broken = vm.runInContext('renderFillResult(null, null)', ctx);
ok('返回空时也不崩', typeof broken === 'string' && broken.length > 0);

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exitCode = fail ? 1 : 0;
