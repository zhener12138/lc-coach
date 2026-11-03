/* 端到端前端测试：加载真实 app.js + 打真实后端（127.0.0.1:8099），
   逐个点击侧栏导航，断言页面真的渲染出了内容。

   浏览器在本沙箱起不来（Chromium crashpad OpenProcess 拒绝访问），
   所以用 Node vm + 手写 DOM stub 跑真实代码路径。

   要点：页面里的子容器（#search-results / #mistake-list / #snip-list 等）
   也是通过 $('#'+id).innerHTML 写入的，所以断言必须扫「所有 #id 容器」，
   只看 #main 会漏掉子容器里的内容，误判成「没渲染」。 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP = path.join(__dirname, '..', 'static', 'app.js');
const BASE = 'http://127.0.0.1:8099';

/* ---------------- 极简但够用的 DOM ---------------- */
function mkEl(tag) {
  const store = { html: '' };
  const el = {
    tagName: tag, textContent: '', value: '', disabled: false,
    dataset: {}, _l: {}, _c: new Set(),
    classList: {
      add: c => el._c.add(c), remove: c => el._c.delete(c), contains: c => el._c.has(c),
      toggle(c, on) {
        if (on === undefined) { el._c.has(c) ? el._c.delete(c) : el._c.add(c); }
        else if (on) el._c.add(c); else el._c.delete(c);
      }
    },
    addEventListener(t, f) { (el._l[t] = el._l[t] || []).push(f); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    get firstElementChild() { return null; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return store.html; },
    set(v) { store.html = String(v); }
  });
  return el;
}

const VIEWS = ['today', 'library', 'mistakes', 'snippets', 'plan', 'account', 'notify'];
const navItems = VIEWS.map(v => { const e = mkEl('button'); e.dataset.view = v; return e; });

const byIdCache = {};
function byId(id) {
  if (!byIdCache[id]) byIdCache[id] = mkEl('div');
  return byIdCache[id];
}

const document = {
  querySelector(sel) {
    if (sel && sel[0] === '#') return byId(sel.slice(1));
    return null;
  },
  querySelectorAll(sel) { return sel === '.nav-item' ? navItems : []; }
};

/* ---------------- location / window ---------------- */
let hash = '#/today';
const winL = {};
const location = {
  get hash() { return hash; },
  set hash(v) {
    const changed = hash !== v;
    hash = v;
    if (changed) (winL['hashchange'] || []).forEach(f => f());
  }
};
const window = {
  addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
  location
};

/* ---------------- 真实 fetch 指向本地服务 ---------------- */
const realFetch = globalThis.fetch;
async function fetchToServer(input, init) {
  const url = typeof input === 'string' ? input : input.url;
  return realFetch(BASE + url, init);
}

const ctx = vm.createContext({
  document, window, location,
  fetch: fetchToServer,
  setTimeout, clearTimeout, console, JSON, Math, Date, Promise,
  navigator: { clipboard: { writeText: async () => {} } },
  confirm: () => true, alert: () => {}
});

vm.runInContext(fs.readFileSync(APP, 'utf8'), ctx, { filename: 'app.js' });

/* ---------------- 工具 ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 把所有已知 id 容器的 innerHTML 拼起来，作为「当前页面内容」 */
function pageText() {
  const parts = [];
  for (const id of Object.keys(byIdCache)) parts.push(byIdCache[id].innerHTML);
  return parts.join('\n');
}

function resetAll() {
  for (const k of Object.keys(byIdCache)) byIdCache[k].innerHTML = '';
}

/* 轮询等待页面渲染完成（不再出现「正在加载」且长度稳定） */
async function waitRendered(timeout = 6000) {
  const t0 = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - t0 < timeout) {
    const txt = pageText();
    const loading = txt.includes('正在加载');
    if (!loading && txt.length > 0 && txt.length === last) {
      if (++stable >= 2) return txt;
    } else { stable = 0; }
    last = txt.length;
    await sleep(120);
  }
  return pageText();
}

/* 视图 -> 应当出现的关键词
 *
 * 这里只放「结构上一定在」的词，不放具体题名。曾经 today/mistakes 都断言
 * 「两数之和」，那是把测试绑死在某一天的计划和某一条错题上：
 * 计划第 1 天是两数之和，第 2 天就换成别的题了；错题本清空也就没有了。
 * 结果同一个断言，换个日期或清个数据就红 —— 而功能其实没坏。
 * 题库那行保留「两数之和」是对的：它固定是列表第一题。 */
const EXPECT = {
  today:    ['今日任务'],
  library:  ['题库', '两数之和'],
  mistakes: ['错题本'],
  snippets: ['模板库', 'HashMap'],
  plan:     ['路线图', 'W1'],
  account:  ['力扣'],
  notify:   ['提醒', '每日提醒时间']
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (c, m) => { c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)); };

  console.log('\n=== 首屏（#/today）自动渲染 ===');
  const first = await waitRendered();
  ok(first.length > 200, `首屏有内容（${first.length} 字符）`);
  // 不断言具体题名：今日页显示的是「今天的计划」，第 1 天是两数之和，
  // 第 2 天就换成别的题了 —— 断言具体题名等于让测试随日期变红。
  // 断言渲染出了可点的题目卡（class="task" + data-slug），这才是功能判据。
  ok(/class="task[^"]*"[^>]*data-slug="[^"]+"/.test(first), '首屏渲染出了题目卡（带 slug）');
  ok(!first.includes('加载失败'), '首屏无「加载失败」');

  for (const v of VIEWS) {
    console.log(`\n=== 点击「${v}」 ===`);
    hash = '#/today';
    resetAll();
    const btn = navItems.find(e => e.dataset.view === v);
    const fn = btn._l.click && btn._l.click[0];
    if (!fn) { ok(false, v + ' 未绑定 click'); continue; }
    fn();

    ok(hash === '#/' + v, `hash → ${hash}`);

    const txt = await waitRendered();
    ok(txt.length > 200, `渲染出内容（${txt.length} 字符）`);
    ok(!txt.includes('加载失败'), '无「加载失败」提示');
    for (const kw of EXPECT[v]) ok(txt.includes(kw), `含关键词「${kw}」`);
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}  ${pass} passed, ${fail} failed\n`);
  // Windows 上 process.exit() 会在句柄没关完时触发 libuv 断言
  // （Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)），
  // 断言明明全过却报 exit 127。用 exitCode 让 Node 自然退出。
  process.exitCode = fail === 0 ? 0 : 1;
})();
