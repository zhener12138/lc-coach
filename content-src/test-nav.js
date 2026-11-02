/* 最小 DOM 模拟：验证 app.js 的侧栏导航点击绑定是否生效。
   本机浏览器起不来（Chromium headless 报 crashpad OpenProcess 拒绝访问），
   所以用 Node + 手写 DOM stub 来验证交互逻辑，不依赖真实浏览器。 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP = path.join(__dirname, '..', 'static', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

/* ---------- 极简元素 ---------- */
function mkEl(tag, attrs) {
  const el = {
    tagName: tag,
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    dataset: attrs && attrs.dataset ? attrs.dataset : {},
    _listeners: {},
    _classes: new Set(),
    classList: {
      toggle(c, on) { if (on === undefined) { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); } else if (on) el._classes.add(c); else el._classes.delete(c); },
      add(c) { el._classes.add(c); },
      remove(c) { el._classes.delete(c); },
      contains(c) { return el._classes.has(c); }
    },
    addEventListener(type, fn) {
      (el._listeners[type] = el._listeners[type] || []).push(fn);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    get firstElementChild() { return null; }
  };
  return el;
}

/* ---------- 6 个导航按钮 ---------- */
const VIEWS = ['today', 'library', 'mistakes', 'snippets', 'plan', 'account'];
const navItems = VIEWS.map(v => mkEl('button', { dataset: { view: v } }));
const mainEl = mkEl('main');
const toastEl = mkEl('div');
const streakEl = mkEl('div');
const sideMetaEl = mkEl('div');
const badgeEl = mkEl('span');

const byId = {
  '#main': mainEl,
  '#toast': toastEl,
  '#streak-num': streakEl,
  '#side-meta': sideMetaEl,
  '#badge-mistakes': badgeEl
};

const document = {
  querySelector(sel) { return byId[sel] || null; },
  querySelectorAll(sel) { return sel === '.nav-item' ? navItems : []; }
};

/* ---------- location / window ---------- */
let hash = '#/today';
const windowListeners = {};
const location = {
  get hash() { return hash; },
  set hash(v) {
    const changed = hash !== v;
    hash = v;
    if (changed && windowListeners['hashchange']) {
      windowListeners['hashchange'].forEach(fn => fn());
    }
  }
};
const window = {
  addEventListener(type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn); },
  location
};

/* ---------- fetch stub：一律失败，让 render 走 catch 分支 ---------- */
async function fetchStub() { throw new Error('stub: 无网络（本测试只验证导航绑定）'); }

const ctx = vm.createContext({
  document, window, location, fetch: fetchStub,
  setTimeout, clearTimeout, console, JSON, Math, Date,
  navigator: { clipboard: { writeText: async () => {} } },
  confirm: () => true,
  alert: () => {}
});

vm.runInContext(src, ctx, { filename: 'app.js' });

/* ---------- 断言 ---------- */
setTimeout(() => {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

  console.log('\n=== 1. 每个 nav-item 是否注册了 click 监听 ===');
  for (const el of navItems) {
    const has = !!(el._listeners.click && el._listeners.click.length);
    ok(has, `nav-item[data-view=${el.dataset.view}] ${has ? '已绑定' : '未绑定'}`);
  }

  console.log('\n=== 2. 点击后 hash 是否跳到对应路由 ===');
  for (const el of navItems) {
    hash = '#/today';
    const fn = el._listeners.click && el._listeners.click[0];
    if (!fn) { ok(false, el.dataset.view + ' 无监听，跳过'); continue; }
    fn();
    ok(hash === '#/' + el.dataset.view, `点「${el.dataset.view}」→ hash=${hash}`);
  }

  console.log('\n=== 3. 点击当前页是重渲染而不是静默 ===');
  hash = '#/library';
  const libBtn = navItems.find(e => e.dataset.view === 'library');
  let rerendered = false;
  const origInner = Object.getOwnPropertyDescriptor(mainEl, 'innerHTML');
  // 用一个 setter 拦截 render() 对 main.innerHTML 的写入
  let mainHTML = '';
  Object.defineProperty(mainEl, 'innerHTML', {
    get() { return mainHTML; },
    set(v) { mainHTML = v; rerendered = true; }
  });
  rerendered = false;
  libBtn._listeners.click[0]();
  ok(rerendered, `已在 ${hash} 时再点「library」触发了重渲染（未静默）`);

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}, 300);
