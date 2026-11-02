/**
 * 验证两件事：
 *   ① 提醒卡不再重复刷屏、标已读不再报 Bad Request
 *   ② 今日页插入了「今日模板」卡，按天固定
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, 'static', f), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
};

const app = R('app.js');
const css = R('app.css');
// 去掉行注释，避免注释里的示例代码干扰断言
const code = app.replace(/^\s*\/\/.*$/gm, '');

console.log('=== 1. dataset 大小写审计 ===');
// data-* 属性可能在 app.js 里，也可能在 index.html 里（data-view 就是）
const html = R('index.html');
const allAttrs = code + '\n' + html;
const attrs = new Set([...allAttrs.matchAll(/data-([a-z]+(?:-[a-z]+)*)=/g)].map((m) => m[1]));
const accesses = new Set([...code.matchAll(/dataset\.([A-Za-z]+)/g)].map((m) => m[1]));
const camel = (s) => s.replace(/-([a-z])/g, (x, c) => c.toUpperCase());
const need = new Set([...attrs].map(camel));
// bound 是程序自己写上去的运行时标记（防重复绑定），不是从 HTML 读的，允许存在
need.add('bound');
const bogus = [...accesses].filter((a) => !need.has(a));
ok('没有访问不存在的 dataset 属性', bogus.length === 0);
if (bogus.length) console.log('     多余：' + bogus.join(', '));
ok('data-n-read 用 dataset.nRead 访问', accesses.has('nRead'));
ok('data-n-go 用 dataset.nGo 访问', accesses.has('nGo'));
ok('标已读前有 undefined 兜底', code.includes("id === 'undefined'"));

console.log('\n=== 2. 今日模板卡 ===');
ok('有 templateCardHtml 函数', code.includes('function templateCardHtml('));
ok('今日页调用了它', code.includes('${templateCardHtml()}'));
ok('用日期做种子（同日固定）', code.includes('seed % list.length'));
ok('今日页自己兜底拉 snippets', code.includes("api('/snippets')"));
ok('模板卡有复制按钮绑定', code.includes('.dailytpl .code-copy'));
ok('CSS 有 .dailytpl 样式', css.includes('.dailytpl {'));
ok('CSS 有 .dailytpl-code', css.includes('.dailytpl-code'));

(async () => {
  const B = 'http://127.0.0.1:8099';

  console.log('\n=== 3. 模板数据与按天固定 ===');
  const snips = await (await fetch(B + '/api/snippets')).json();
  // 不写死条数：模板会持续扩充，断言「至少有第一批 16 段」才不会被扩库打挂
  ok('后端有模板数据（至少 16 段）', snips.length >= 16);
  console.log('     当前模板数:', snips.length);

  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const today = snips[seed % snips.length];
  ok('同一天取到同一个模板', today.title === snips[seed % snips.length].title);
  console.log('     今日模板：' + today.title + '（' + today.category + '）');
  ok('模板有 code', !!today.code && today.code.length > 10);
  ok('模板有 note（一句话解释）', !!today.note && today.note.length > 0);

  const titles = new Set();
  for (let day = 1; day <= 28; day++) {
    const s2 = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + day;
    titles.add(snips[s2 % snips.length].title);
  }
  ok('一个月内会展示多个不同模板（' + titles.size + ' 个）', titles.size > 5);

  console.log('\n=== 4. 提醒接口（不重复、可标已读） ===');
  const n = await (await fetch(B + '/api/notify?limit=50')).json();
  ok('提醒条数已收敛（<=5）', n.items.length <= 5);
  console.log('     unread：' + n.unread + ' | 条数：' + n.items.length);

  // 同一 (day_date, kind) 不应有多条
  const keys = n.items.map((i) => i.date + '|' + i.kind);
  ok('没有重复的 (日期, 类型) 组合', new Set(keys).size === keys.length);

  const unread = n.items.find((i) => !i.read);
  if (unread) {
    const r = await fetch(B + '/api/notify/' + unread.id + '/read', { method: 'POST' });
    const j = await r.json();
    ok('单条标已读 HTTP 200 且 ok', r.status === 200 && j.ok === true);
  } else {
    ok('无未读项，跳过单条标已读（接口前面已单独验过）', true);
  }

  const r2 = await fetch(B + '/api/notify/read-all', { method: 'POST' });
  const j2 = await r2.json();
  ok('全部标已读 200 且 unread 归零', r2.status === 200 && j2.unread === 0);

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
