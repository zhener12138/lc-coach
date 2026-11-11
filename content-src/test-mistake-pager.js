// 错题本分页的测试。
// 重点是「删到空页」「单页不显示分页条」「翻页不重新请求接口」这三条 ——
// 它们都属于「实现看起来对、边界一碰就错」的类型。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'static', 'app.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  →  ' + extra : '')); }
}

console.log('\n【1】常量与接线');
ok('一页 6 道', /const MISTAKE_PAGE_SIZE = 6;/.test(APP));
ok('有 pagerHtml 函数', /function pagerHtml\(page, totalPages, totalItems\)/.test(APP));
ok('State 里有 mistakesPage', /mistakesPage:\s*1/.test(APP));
ok('渲染时切片', /list\.slice\(from, from \+ MISTAKE_PAGE_SIZE\)/.test(APP));
ok('拼上了分页条', /\.join\(''\) \+ pagerHtml\(page, totalPages, list\.length\)/.test(APP));
ok('页码被夹住（删到空页不会越界）',
  /Math\.min\(Math\.max\(1, State\.mistakesPage \|\| 1\), totalPages\)/.test(APP));
ok('翻页绑了 data-mpage', /\\\$\\\$\(\'\[data-mpage\]\'/.test(APP) || /\$\$\('\[data-mpage\]'/.test(APP));
ok('翻页后滚回顶部', /scrollIntoView/.test(APP));
ok('翻页不重新拉接口（复用 State.mistakes）', /renderMistakeList\(State\.mistakes\)/.test(APP));

console.log('\n【2】pagerHtml 的真实行为（从 app.js 里切出来跑）');
// 把 pagerHtml 整段切出来：从 function 声明到下一个顶层 function 之前
const start = APP.indexOf('function pagerHtml(');
const nextFn = APP.indexOf('\nfunction renderMistakeList(', start);
const src = APP.slice(start, nextFn);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const pagerHtml = ctx.pagerHtml;

ok('只有一页时返回空串', pagerHtml(1, 1, 3) === '', JSON.stringify(pagerHtml(1, 1, 3)));
ok('两页时出现分页条', pagerHtml(1, 2, 8).includes('class="pager"'));
ok('第一页的上一页按钮禁用', /data-mpage="prev" disabled/.test(pagerHtml(1, 3, 15)));
ok('最后一页的下一页按钮禁用', /data-mpage="next" disabled/.test(pagerHtml(3, 3, 15)));
ok('中间页两个按钮都可用',
  !/data-mpage="prev" disabled/.test(pagerHtml(2, 3, 15)) &&
  !/data-mpage="next" disabled/.test(pagerHtml(2, 3, 15)));
ok('当前页有 cur 类', /class="pager-btn cur" data-mpage="2"/.test(pagerHtml(2, 3, 15)));
ok('显示总条数', /共 15 条/.test(pagerHtml(2, 3, 15)));
ok('显示第几页', /第 2 \/ 3 页/.test(pagerHtml(2, 3, 15)));

const many = pagerHtml(8, 20, 120);
ok('20 页时用省略号收中间', many.includes('pager-gap'));
ok('20 页时页码不超过 9 个按钮', (many.match(/data-mpage="\d+"/g) || []).length <= 9,
  String((many.match(/data-mpage="\d+"/g) || []).length));
ok('首页永远可见', /data-mpage="1"/.test(many));
ok('末页永远可见', /data-mpage="20"/.test(many));
ok('当前页永远可见', /data-mpage="8"/.test(many));

console.log('\n【3】CSS');
ok('.pager 有样式', /\.pager\s*\{/.test(CSS));
ok('.pager-btn 有样式', /\.pager-btn\s*\{/.test(CSS));
ok('当前页有高亮', /\.pager-btn\.cur\s*\{/.test(CSS));
ok('禁用态有样式', /\.pager-btn:disabled/.test(CSS));
ok('窄屏下总条数换行', /\.pager-info\s*\{ margin-left: 0; width: 100%; \}/.test(CSS));

console.log('\n【4】版本号（不提用户刷新拿不到新 JS）');
// 断言「所有静态资源用同一个版本号」，而不是钉死某个具体日期。
// 写死版本的测试每发一次版就挂一次 —— 那不是测出了问题，是测试自己在偷懒。
const verAll = [...HTML.matchAll(/\?v=([0-9a-z]+)/g)].map(m => m[1]);
ok('index.html 里所有静态资源用同一个版本号', new Set(verAll).size === 1,
  [...new Set(verAll)].join(' / ') || '一个都没找到');
ok('app.js 带了版本号（不提版本用户刷新拿不到新 JS）', /app\.js\?v=/.test(HTML));
ok('没有残留旧版本号', !/v=20261103e/.test(HTML));

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;
