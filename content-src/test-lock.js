/* 解法上锁的行为测试：验证「三个解法默认各自上锁 / 点一个只解一个 / 全部重新上锁」。
   浏览器在本沙箱起不来（Chromium crashpad OpenProcess 拒绝访问），
   所以用 Node vm + 手写 DOM stub 跑真实的 lock.js + app.js。
   只测 renderSolTabs / lockCard / Lock 这三个真实函数，不接后端。 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'static');
const LOCK_SRC = fs.readFileSync(path.join(ROOT, 'lock.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

/* ---------- sessionStorage / localStorage stub ---------- */
function mkStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    get _size() { return m.size; }
  };
}
const sessionStorage = mkStore();

/* ---------- 极简 DOM ---------- */
function mkEl(tag) {
  const box = { html: '' };
  const el = {
    tagName: tag, textContent: '', value: '', disabled: false,
    dataset: {}, _l: {}, _c: new Set(),
    classList: {
      add: c => el._c.add(c),
      remove: c => el._c.delete(c),
      contains: c => el._c.has(c),
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
    appendChild() {},
    contains() { return true; },
    get firstElementChild() { return null; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return box.html; },
    set(v) { box.html = String(v); }
  });
  return el;
}

const byIdCache = {};
function byId(id) { if (!byIdCache[id]) byIdCache[id] = mkEl('div'); return byIdCache[id]; }

const document = {
  querySelector(sel) { return sel && sel[0] === '#' ? byId(sel.slice(1)) : null; },
  querySelectorAll() { return []; }
};

let hash = '#/today';
const winL = {};
const location = {
  get hash() { return hash; },
  set hash(v) { const ch = hash !== v; hash = v; if (ch) (winL['hashchange'] || []).forEach(f => f()); }
};

/* 关键：浏览器里 window 就是全局对象，所以 window.Lock = ... 之后裸 Lock 才可用。
   stub 必须让 ctx 自己充当 window，否则 app.js 里的 Lock 会是 undefined。 */
const ctx = vm.createContext({
  setTimeout, clearTimeout, console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error,
  fetch: async () => { throw new Error('stub: 本测试不连后端'); },
  navigator: { clipboard: { writeText: async () => { } } },
  confirm: () => true, alert: () => { }
});
ctx.location = location;
ctx.sessionStorage = sessionStorage;
ctx.localStorage = sessionStorage;
ctx.document = document;
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;
ctx.addEventListener = (t, f) => { (winL[t] = winL[t] || []).push(f); };
ctx.removeEventListener = () => { };

vm.runInContext(LOCK_SRC, ctx, { filename: 'lock.js' });
vm.runInContext(APP_SRC, ctx, { filename: 'app.js' });

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  \u2705 ' + msg); }
  else { fail++; console.log('  \u274C ' + msg); }
};

const SLUG = 'two-sum';
const SOLS = [
  { tier: 'brute', title: '双重循环', idea: 'aaa', pseudocode: '1. x', codeJava: 'class Solution{}', timeComplexity: 'O(n^2)', spaceComplexity: 'O(1)' },
  { tier: 'better', title: '排序+哈希', idea: 'bbb', pseudocode: '1. y', codeJava: 'class Solution{}', timeComplexity: 'O(n)', spaceComplexity: 'O(n)' },
  { tier: 'optimal', title: '一次遍历', idea: 'ccc', pseudocode: '1. z', codeJava: 'class Solution{}', timeComplexity: 'O(n)', spaceComplexity: 'O(1)' }
];

console.log('\n=== 1. Lock 基础语义 ===');
sessionStorage.clear();
ok(ctx.Lock.isUnlocked(SLUG, 0) === false, '默认锁住：isUnlocked(two-sum,0) === false');
ctx.Lock.unlock(SLUG, 1);
ok(ctx.Lock.isUnlocked(SLUG, 1) === true, '解锁第 2 个后 isUnlocked(two-sum,1) === true');
ok(ctx.Lock.isUnlocked(SLUG, 0) === false, '但第 1 个仍然锁着（不是一键全开）');
ok(ctx.Lock.isUnlocked(SLUG, 2) === false, '第 3 个也仍然锁着');
ctx.Lock.unlock(SLUG, 1);
ok(JSON.parse(sessionStorage.getItem('lc.sol.unlocked'))[SLUG].length === 1, '重复解锁同一个不会写重复项');
ok(ctx.Lock.isUnlocked('group-anagrams', 1) === false, '别的题不受影响（按 slug 隔离）');
ctx.Lock.lockAll(SLUG);
ok(ctx.Lock.isUnlocked(SLUG, 1) === false, 'lockAll 之后全部回到锁住');

console.log('\n=== 2. renderSolTabs 默认全部上锁 ===');
sessionStorage.clear();
let html = ctx.renderSolTabs(SOLS, SLUG);
ok((html.match(/class="lock-card"/g) || []).length === 3, '三个 panel 各渲染一张锁屏卡（共 3 个）');
ok((html.match(/\uD83D\uDD12/g) || []).length === 3, '三个 tab 的锁图标都是 \uD83D\uDD12');
ok((html.match(/\uD83D\uDD13/g) || []).length === 0, '没有任何 \uD83D\uDD13（没有预先解锁的）');
ok(html.includes('已解锁 <b>0</b> / 3'), '计数显示 已解锁 0 / 3');
ok(!html.includes('双重循环') && !html.includes('一次遍历'), '锁住时解法标题不出现（内容真的没下发到 DOM）');
ok(!html.includes('class Solution{}'), '锁住时 Java 代码不出现在 HTML 里');
ok(html.includes('data-idx="0"') && html.includes('data-idx="1"') && html.includes('data-idx="2"'), '三张卡各带正确的 data-idx');

console.log('\n=== 3. 解锁一个只放一个 ===');
ctx.Lock.unlock(SLUG, 1);
html = ctx.renderSolTabs(SOLS, SLUG);
ok((html.match(/class="lock-card"/g) || []).length === 2, '解锁第 2 个后只剩 2 张锁屏卡');
ok((html.match(/\uD83D\uDD13/g) || []).length === 1, '恰好一个 tab 变成 \uD83D\uDD13');
ok(html.includes('排序+哈希'), '第 2 个的标题出现了');
ok(!html.includes('双重循环') && !html.includes('一次遍历'), '第 1、3 个仍然不出现');
ok(html.includes('已解锁 <b>1</b> / 3'), '计数变成 已解锁 1 / 3');
ok(html.includes('id="btn-lock-all"'), '「全部重新上锁」按钮在');

console.log('\n=== 4. 全解锁 ===');
ctx.Lock.unlock(SLUG, 0);
ctx.Lock.unlock(SLUG, 2);
html = ctx.renderSolTabs(SOLS, SLUG);
ok((html.match(/class="lock-card"/g) || []).length === 0, '全解锁后没有锁屏卡');
ok(html.includes('双重循环') && html.includes('排序+哈希') && html.includes('一次遍历'), '三个标题都在');
ok(html.includes('已解锁 <b>3</b> / 3'), '计数 3 / 3');

console.log('\n=== 5. lockCard 的转义与结构 ===');
const card = ctx.lockCard('a"><script>x</script>', 2);
ok(!card.includes('<script>'), 'slug 里的尖括号被转义，不产生可执行标签');
ok(card.includes('data-idx="2"'), 'data-idx 正确');
ok(card.includes('role="button"') && card.includes('tabindex="0"'), '可聚焦、可键盘触发');
ok(card.includes('\u89E3\u6CD5 3 \u5DF2\u9501\u4F4F'), '文案正确显示「解法 3 已锁住」');

console.log('\n=== 6. sessionStorage 损坏时降级不崩 ===');
sessionStorage.setItem('lc.sol.unlocked', '{{{ not json');
let threw = false;
try { ok(ctx.Lock.isUnlocked(SLUG, 0) === false, '坏数据当没解锁处理'); }
catch (e) { threw = true; }
ok(!threw, '解析失败不抛异常');
sessionStorage.clear();

console.log('\n=== 7. 真实后端数据（两数之和）默认上锁 ===');
(async () => {
  let real = null;
  try {
    const r = await fetch('http://127.0.0.1:8099/api/problem/two-sum');
    if (r.ok) real = await r.json();
  } catch (e) { /* 服务没起就跳过 */ }

  if (!real) {
    console.log('  \u26A0 后端没在跑，跳过真实数据这一段');
  } else {
    const rs = (real.solutions || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    ok(rs.length === 3, `真实数据有 3 个解法（实际 ${rs.length}）`);
    ok(rs.map(s => s.tier).join(',') === 'brute,better,optimal', 'tier 顺序 brute>better>optimal');

    sessionStorage.clear();
    let h = ctx.renderSolTabs(rs, 'two-sum');
    ok((h.match(/class="lock-card"/g) || []).length === 3, '真实数据默认渲染 3 张锁屏卡');
    ok(!h.includes(rs[0].title), '暴力解法标题未下发到 DOM');
    ok(!h.includes(rs[2].title), '最优解法标题未下发到 DOM');
    ok(!h.includes('public int[]'), 'Java 代码未下发到 DOM');
    ok(h.includes('已解锁 <b>0</b> / 3'), '计数 0 / 3');

    ctx.Lock.unlock('two-sum', 0);
    h = ctx.renderSolTabs(rs, 'two-sum');
    ok((h.match(/class="lock-card"/g) || []).length === 2, '解锁第 1 个后剩 2 张卡');
    ok(h.includes(rs[0].title), '暴力解法标题出现');
    ok(!h.includes(rs[1].title), '较好解法仍隐藏');

    ctx.Lock.unlock('two-sum', 2);
    h = ctx.renderSolTabs(rs, 'two-sum');
    ok((h.match(/class="lock-card"/g) || []).length === 1, '再解第 3 个后剩 1 张卡');
    ok(h.includes(rs[2].title), '最优解法标题出现');
    ok(h.includes('已解锁 <b>2</b> / 3'), '计数 2 / 3');
    sessionStorage.clear();
  }

  console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  process.exit(fail ? 1 : 0);
})();
