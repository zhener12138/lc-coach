/* 上锁交互的「点击链路」测试：
   验证真正的页面里 main 上的事件委托确实能解锁、且解锁后 DOM 换成了正文。

   做法：用 Node vm 跑真实的 lock.js + app.js，fetch 指向真实后端，
   让 app.js 自己走完 boot → 渲染 → 导航到题目页 → 绑定事件，
   然后取出 main 上真正注册的 click 处理函数，喂一个模拟事件进去。
   浏览器在本沙箱起不来（Chromium crashpad OpenProcess 拒绝访问），只能这么做。 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'static');
const LOCK_SRC = fs.readFileSync(path.join(ROOT, 'lock.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const BASE = 'http://127.0.0.1:8099';

/* ---------- sessionStorage ---------- */
const store = new Map();
const sessionStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

/* ---------- 元素：支持 querySelector / querySelectorAll / closest ---------- */
function mkEl(tag, id) {
  const box = { html: '' };
  const el = {
    tagName: tag, id: id || '', textContent: '', value: '', disabled: false,
    dataset: {}, _l: {}, _c: new Set(), style: {},
    classList: {
      add: c => el._c.add(c), remove: c => el._c.delete(c), contains: c => el._c.has(c),
      toggle(c, on) {
        if (on === undefined) { el._c.has(c) ? el._c.delete(c) : el._c.add(c); }
        else if (on) el._c.add(c); else el._c.delete(c);
      }
    },
    addEventListener(t, f) { (el._l[t] = el._l[t] || []).push(f); },
    removeEventListener(t, f) {
      const a = el._l[t]; if (!a) return;
      const i = a.indexOf(f); if (i >= 0) a.splice(i, 1);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest(sel) { return null; },
    appendChild() {},
    contains(n) { return n === el || byIdCache.has(n && n.id); },
    offsetWidth: 1,
    get firstElementChild() { return null; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return box.html; },
    set(v) { box.html = String(v); }
  });
  return el;
}

const byIdCache = new Map();
function byId(id) {
  if (!byIdCache.has(id)) byIdCache.set(id, mkEl('div', id));
  return byIdCache.get(id);
}

const VIEWS = ['today', 'library', 'mistakes', 'snippets', 'plan', 'account', 'notify'];
const navItems = VIEWS.map(v => { const e = mkEl('button'); e.dataset.view = v; return e; });

const mainEl = byId('main');
/* #main 是真实 DOM 节点，querySelector('#sol-1') 必须能找到 panel；
   contains() 必须对传进来的任意元素返回 true（假事件里的 card 没有 id）。 */
mainEl.querySelector = (sel) => (sel && sel[0] === '#' ? byId(sel.slice(1)) : null);
mainEl.contains = () => true;

const document = {
  querySelector(sel) { return sel && sel[0] === '#' ? byId(sel.slice(1)) : null; },
  querySelectorAll(sel) { return sel === '.nav-item' ? navItems : []; }
};

/* ---------- location / window（让 ctx 自己当 window） ---------- */
let hash = '#/today';
const winL = {};
const location = {
  get hash() { return hash; },
  set hash(v) {
    const ch = hash !== v; hash = v;
    if (ch) (winL['hashchange'] || []).forEach(f => f());
  }
};

const ctx = vm.createContext({
  setTimeout, clearTimeout, console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, Promise,
  navigator: { clipboard: { writeText: async () => { } } },
  confirm: () => true, alert: () => { },
  fetch: (input, init) => fetch(String(input).startsWith('http') ? input : BASE + input, init)
});
ctx.document = document;
ctx.sessionStorage = sessionStorage;
ctx.localStorage = sessionStorage;
ctx.location = location;
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;
ctx.addEventListener = (t, f) => { (winL[t] = winL[t] || []).push(f); };
ctx.removeEventListener = () => { };

vm.runInContext(LOCK_SRC, ctx, { filename: 'lock.js' });
vm.runInContext(APP_SRC, ctx, { filename: 'app.js' });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  \u2705 ' + m)) : (fail++, console.log('  \u274C ' + m)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 等到「页面真的画完了」为止，而不是盲等一个固定毫秒数。
 *
 * 之前这里写的是 await sleep(900)，冷启动/GC/H2 查询抖一下就会超时，
 * 于是拿着上一次渲染的旧 innerHTML 去做断言 —— 测试会偶发失败。
 * 偶发失败的测试比没有测试更坏：真回归失败会被当成噪声忽略掉。
 *
 * cond 是「可以开始断言了」的条件；超时仍然返回，让后续断言自己报错，
 * 而不是在这里 throw —— 崩掉会掩盖掉真正的失败信息。
 */
async function waitFor(cond, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (cond()) return true; } catch { /* 页面还没画完，正常 */ }
    await sleep(50);
  }
  if (label) console.log('  ⚠️ 等待超时：' + label + '（断言会接着跑，失败信息在下面）');
  return false;
}

(async () => {
  // 等 boot 的首屏渲染结束：main 里有内容且不再是 loading 占位
  await waitFor(() => mainEl.innerHTML && !mainEl.innerHTML.includes('class="loading"'), 8000, '首屏渲染');

  console.log('\n=== 1. 进入题目页后事件委托是否注册 ===');
  sessionStorage.clear();
  location.hash = '#/problem/two-sum';
  // 等题目页真画出来：锁屏卡在 DOM 里才算好
  await waitFor(() => (mainEl.innerHTML || '').includes('class="lock-card"'), 8000, '题目页锁屏卡');

  ok(typeof mainEl._lockHandler === 'function', '#main 上注册了 .lock-card 的 click 委托');
  ok(typeof mainEl._lockKeyHandler === 'function', '#main 上注册了键盘解锁');
  ok(typeof mainEl._tabHandler === 'function', '#main 上注册了 .sol-tab 的 click 委托');
  ok(typeof mainEl._lockAllHandler === 'function', '#main 上注册了「全部重新上锁」的委托');

  const page = mainEl.innerHTML;
  ok(page.includes('class="lock-bar"'), '页面里有 lock-bar（解锁计数条）');
  ok(page.includes('已解锁 <b>0</b> / 3'), '初始计数 0 / 3');
  ok((page.match(/class="lock-card"/g) || []).length === 3, '页面里有 3 张锁屏卡');
  ok(!page.includes('暴力双循环'), '暴力解法标题没进 DOM');

  console.log('\n=== 2. 模拟点击第 2 张锁屏卡 ===');
  const fakeCard = { dataset: { idx: '1' } };
  const fakeEv = {
    target: { closest: (sel) => (sel === '.lock-card' ? fakeCard : null) },
    preventDefault() { }
  };
  mainEl._lockHandler(fakeEv);
  await sleep(50);

  ok(ctx.Lock.isUnlocked('two-sum', 1) === true, '第 2 个解法已写入 sessionStorage');
  ok(ctx.Lock.isUnlocked('two-sum', 0) === false, '第 1 个仍然锁着（没有一键全开）');
  ok(ctx.Lock.isUnlocked('two-sum', 2) === false, '第 3 个仍然锁着');

  const panel1 = byId('sol-1').innerHTML;
  ok(panel1.includes('sol-body') || panel1.includes('sol-head'), 'panel#sol-1 被重画成解法正文');
  ok(!panel1.includes('lock-card'), 'panel#sol-1 里不再有锁屏卡');
  ok(panel1.includes('class="pseudo"'), '解法正文里有中文伪代码块');
  ok(panel1.includes('class="code-wrap"'), '解法正文里有 Java 代码块');

  const panel0 = byId('sol-0').innerHTML;
  const panel2 = byId('sol-2').innerHTML;
  ok(panel0 === '' , 'panel#sol-0 没被误重画（本次只解锁第 2 个）');
  ok(panel2 === '', 'panel#sol-2 也没被误重画');

  console.log('\n=== 3. 越界 / 畸形 idx 不能造成副作用 ===');
  const before = store.get('lc.sol.unlocked');
  mainEl._lockHandler({ target: { closest: (s) => (s === '.lock-card' ? { dataset: { idx: '99' } } : null) }, preventDefault() { } });
  mainEl._lockHandler({ target: { closest: (s) => (s === '.lock-card' ? { dataset: { idx: 'abc' } } : null) }, preventDefault() { } });
  mainEl._lockHandler({ target: { closest: (s) => (s === '.lock-card' ? { dataset: { idx: '-1' } } : null) }, preventDefault() { } });
  await sleep(30);
  ok(store.get('lc.sol.unlocked') === before, 'idx=99 / abc / -1 全部被挡掉，存储没变');

  console.log('\n=== 4. 「全部重新上锁」 ===');
  mainEl._lockHandler({ target: { closest: (s) => (s === '.lock-card' ? { dataset: { idx: '0' } } : null) }, preventDefault() { } });
  await sleep(30);
  ok(ctx.Lock.isUnlocked('two-sum', 0) === true && ctx.Lock.isUnlocked('two-sum', 1) === true, '先解锁 1、2 两个');

  mainEl._lockAllHandler({ target: { closest: (s) => (s === '#btn-lock-all' ? {} : null) } });
  await sleep(50);
  ok(ctx.Lock.isUnlocked('two-sum', 0) === false, 'lockAll 之后第 1 个回到锁住');
  ok(ctx.Lock.isUnlocked('two-sum', 1) === false, '第 2 个也回到锁住');
  ok(byId('sol-0').innerHTML.includes('lock-card'), 'panel#sol-0 被重画成锁屏卡');
  ok(byId('sol-1').innerHTML.includes('lock-card'), 'panel#sol-1 被重画成锁屏卡');

  console.log('\n=== 5. 换到另一道题，状态互不污染 ===');
  location.hash = '#/problem/group-anagrams';
  await sleep(900);
  ok(!ctx.Lock.isUnlocked('group-anagrams', 0), '新题目默认也是锁的');
  ok(mainEl.innerHTML.includes('已解锁 <b>0</b> / 3'), '新题目计数从 0 开始');

  console.log('\n=== 6. 回到原题，之前的解锁状态还在（同标签页） ===');
  ctx.Lock.unlock('two-sum', 2);
  location.hash = '#/problem/two-sum';
  await sleep(900);
  ok(ctx.Lock.isUnlocked('two-sum', 2) === true, 'two-sum 的第 3 个仍记着已解锁');
  ok(mainEl.innerHTML.includes('已解锁 <b>1</b> / 3'), '计数正确恢复成 1 / 3');

  console.log('\n=== 7. 再点一次已解锁的 tab → 重新锁上 ===');
  ctx.Lock.unlock('two-sum', 1);
  // 造 3 个 tab 桩，让 $$('.sol-tab', main) 能取到
  const tabStubs = [0, 1, 2].map(i => {
    const t = mkEl('button');
    t.dataset = { idx: String(i), target: 'sol-' + i };
    if (i === 1) t.classList.add('active');
    return t;
  });
  mainEl.querySelectorAll = (sel) => (sel === '.sol-tab' ? tabStubs : []);
  ok(ctx.Lock.isUnlocked('two-sum', 1) === true, '前置：第 2 个是解锁的');

  mainEl._tabHandler({ target: { closest: (sel) => (sel === '.sol-tab' ? tabStubs[1] : null) } });
  await sleep(40);
  ok(ctx.Lock.isUnlocked('two-sum', 1) === false, '点已解锁且已激活的 tab → 这一块被重新锁上');
  ok(byId('sol-1').innerHTML.includes('lock-card'), 'panel#sol-1 换回锁屏卡');

  ctx.Lock.unlock('two-sum', 1);
  const tab0 = tabStubs[0];
  mainEl._tabHandler({ target: { closest: (sel) => (sel === '.sol-tab' ? tab0 : null) } });
  await sleep(40);
  ok(ctx.Lock.isUnlocked('two-sum', 1) === true, '切换 tab 时不会误锁别的解法');
  ok(tab0.classList.contains('active'), '切过去的 tab 变成 active');

  mainEl.querySelectorAll = () => [];
  sessionStorage.clear();
  console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  process.exit(fail ? 1 : 0);
})();
