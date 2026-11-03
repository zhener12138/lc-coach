/**
 * 今日页「前一天 / 后一天」切换的端到端测试。
 *
 * 光有箭头不算做完，这四件事必须同时对：
 *   1. 翻到别的日子，看到的是那天的安排（不是今天的）
 *   2. 翻页**不能**改掉 State.today —— 侧栏统计、计划页、真实打卡都只认今天
 *   3. 第 1 天没有「上一天」、第 112 天没有「下一天」，按钮是 disabled 而不是点了没反应
 *   4. 翻到历史/未来时打卡按钮**照样能点** —— 打卡记的是「这道题做没做过」
 *      （progress 表主键是 slug，done_date 只记第一次完成日），没有按日切账，
 *      所以不存在「在历史页点勾会改今天」这回事。曾经第 4 条写成「停用」，
 *      那是把 bug 当规格钉住了，现在反过来防它复发。
 *
 * DOM stub 说明见 test-mistake-fill-e2e.js —— 同一套，
 * 关键是 innerHTML setter 里要 hydrate 出真实节点，否则 $('#day-prev') 永远是 null。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BASE = 'http://127.0.0.1:8099';

let pass = 0, fail = 0;
const ok = (n, c, e) => c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (e !== undefined ? '  ← ' + e : '')));

// ---------------- DOM stub ----------------
const nodes = {};
const registry = [];

function mkEl(tag, id) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), id: id || '', textContent: '',
    value: '', dataset: {}, style: {}, disabled: false, type: '', placeholder: '',
    className: '', _attrs: {}, children: [], parentNode: null, _removed: false, _html: '',
    title: '',
    classList: {
      _s: new Set(),
      add(...a) { a.forEach(x => x && this._s.add(x)); },
      remove(...a) { a.forEach(x => this._s.delete(x)); },
      toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c) || splitCls(el.className).includes(c); }
    },
    _l: {},
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    removeEventListener(t, f) { if (this._l[t]) this._l[t] = this._l[t].filter(x => x !== f); },
    appendChild(c) { if (!c) return c; this.children.push(c); if (c.id) nodes[c.id] = c; c.parentNode = this; registry.push(c); return c; },
    remove() {
      const kill = e => {
        e._removed = true;
        if (e.id) delete nodes[e.id];
        const i = registry.indexOf(e); if (i >= 0) registry.splice(i, 1);
        (e.children || []).forEach(kill);
      };
      kill(this);
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this);
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] == null ? null : this._attrs[k]; },
    focus() { this._focused = true; },
    setSelectionRange() {},
    click() { if (this.disabled) return; (this._l.click || []).forEach(f => f({ target: this, preventDefault() {}, stopPropagation() {} })); },
    querySelector(s) { return q1(this, s); },
    querySelectorAll(s) { return qAll(this, s); },
    contains(el) { let p = el; while (p) { if (p === this) return true; p = p.parentNode; } return false; },
    offsetWidth: 1, scrollTop: 0, scrollHeight: 0
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) {
      el._html = String(v);
      // 真浏览器重设 innerHTML 会把旧节点全部销毁、重建新的。
      // stub 不清理登记表的话，nodes['day-prev'] 还会指向上一次渲染那个按钮
      // （disabled 状态是旧的），测出来的箭头状态就是假的。
      (el.children || []).forEach(killDeep);
      el.children = [];
      hydrate(el, el._html);
    }
  });
  if (id) nodes[id] = el;
  registry.push(el);
  return el;
}

function hydrate(root, html) {
  const src = String(html);
  const tagRe = /<(div|span|input|textarea|button|aside|p|label|h3|pre|code|b|i)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const attrs = m[2] || '';
    const idM = /id="([^"]+)"/.exec(attrs);
    const clsM = /class="([^"]+)"/.exec(attrs);
    if (!idM && !clsM) continue;
    const id = idM ? idM[1] : '';
    if (id && nodes[id]) continue;
    const el = mkEl(m[1], id);
    if (clsM) { el.className = clsM[1]; clsM[1].split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c)); }
    // disabled 是属性，真浏览器解析 HTML 就会设上，stub 必须一起补，
    // 否则「第一天没有上一天」这条永远测不出来
    if (/\sdisabled(\s|>|=|$)/.test(attrs)) el.disabled = true;
    const dsM = /data-([a-z-]+)="([^"]*)"/g;
    let d;
    while ((d = dsM.exec(attrs))) {
      const key = d[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      el.dataset[key] = d[2];
    }
    el.parentNode = root;
    root.children.push(el);
  }
}

// 递归注销一棵子树：id 登记、registry、parentNode 全部断掉。
function killDeep(e) {
  if (!e) return;
  e._removed = true;
  if (e.id) delete nodes[e.id];
  const i = registry.indexOf(e); if (i >= 0) registry.splice(i, 1);
  (e.children || []).forEach(killDeep);
  e.children = [];
}

function splitCls(s) { return String(s || '').split(/\s+/).filter(Boolean); }function q1(root, s) {
  if (!s || !root) return null;
  if (s[0] === '#') return nodes[s.slice(1)] || null;
  const r = qAll(root, s);
  return r.length ? r[0] : null;
}
function qAll(root, s) {
  const out = [];
  if (!root) return out;
  const want = s[0] === '.' ? s.slice(1).split('.').filter(Boolean) : null;
  const walk = e => {
    if (!e || e._removed) return;
    if (want) {
      const cl = splitCls(e.className).concat(e.classList ? [...e.classList._s] : []);
      if (want.every(c => cl.includes(c))) out.push(e);
    } else if (e.tagName === s.toUpperCase()) out.push(e);
    (e.children || []).forEach(walk);
  };
  (root.children || []).forEach(walk);
  return out;
}

const ctx = {
  console, setTimeout, clearTimeout, Date, Math, JSON, String, Number, Array, RegExp, Set, Object,
  document: {
    getElementById: id => nodes[id] || null,
    querySelector: s => q1(ctx.document.body, s),
    querySelectorAll: s => qAll(ctx.document.body, s),
    createElement: t => mkEl(t, ''),
    addEventListener() {},
    onkeydown: null,
    body: null
  },
  location: { hash: '#/today' },
  navigator: { clipboard: { writeText: async () => {} } },
  sessionStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  fetch: (u, o) => fetch(String(u).startsWith('http') ? u : BASE + u, o),
  addEventListener() {}, alert() {}, confirm: () => true
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document.body = mkEl('body', 'body');

['main', 'toast', 'streak-num', 'side-meta', 'build-stamp', 'badge-mistakes',
  'badge-notify', 'grade-out', 'grade-stamp', 'btn-grade', 'my-code']
  .forEach(id => ctx.document.body.appendChild(mkEl('div', id)));
const nav = mkEl('nav', 'nav'); ctx.document.body.appendChild(nav);
['#/today', '#/mistakes', '#/snippets', '#/aihot'].forEach(h => {
  const a = mkEl('a', ''); a.className = 'nav-item'; a.dataset.hash = h; nav.appendChild(a);
});

vm.createContext(ctx);
['lock.js', 'roast.js', 'mistake-fill.js', 'app.js'].forEach(f =>
  vm.runInContext(R('static/' + f), ctx, { filename: f }));

const J = async u => { const r = await fetch(BASE + u); return [r.status, await r.json()]; };
const main = nodes['main'];
// State 是 app.js 里的 const，块级作用域，不会挂到 vm context 上。
// 要读它只能回 vm 里求值 —— 直接 ctx.State 永远是 undefined。
const ST = () => vm.runInContext('State', ctx);

(async () => {
  // ---------- 1. 后端：day 参数 ----------
  console.log('=== 1. 后端按 day 返回对应那天 ===');
  const [s0, t0] = await J('/api/today');
  ok('今天接口 200', s0 === 200, s0);
  ok('今天 isToday=true', t0.isToday === true, t0.isToday);
  ok('今天 dayNo = realDayNo', t0.dayNo === t0.realDayNo, `${t0.dayNo} vs ${t0.realDayNo}`);
  ok('返回了 date 字段', /^\d{4}-\d{2}-\d{2}$/.test(t0.date || ''), t0.date);

  const [s3, t3] = await J('/api/today?day=3');
  ok('day=3 返回 200', s3 === 200, s3);
  ok('day=3 的 dayNo 是 3', t3.dayNo === 3, t3.dayNo);
  ok('day=3 的 isToday=false', t3.isToday === false, t3.isToday);
  ok('day=3 的日期是开始日 +2 天', t3.date === '2026-11-04', t3.date);
  ok('day=3 带了那天的题目', Array.isArray(t3.items) && t3.items.length > 0, t3.items && t3.items.length);

  const [, t1] = await J('/api/today?day=1');
  ok('第 1 天上一天不可用', t1.hasPrev === false, t1.hasPrev);
  ok('第 1 天下一天可用', t1.hasNext === true, t1.hasNext);

  const [, t112] = await J('/api/today?day=112');
  ok('第 112 天（最后一天）下一天不可用', t112.hasNext === false, t112.hasNext);
  ok('第 112 天上一天可用', t112.hasPrev === true, t112.hasPrev);

  const [, t113] = await J('/api/today?day=113');
  ok('day 超过 112 会被夹到 112，不返回空页', t113.dayNo === 112, t113.dayNo);
  const [, t0b] = await J('/api/today?day=0');
  ok('day=0 会被夹到 1', t0b.dayNo === 1, t0b.dayNo);
  const [, tNeg] = await J('/api/today?day=-5');
  ok('负数也会被夹到 1', tNeg.dayNo === 1, tNeg.dayNo);

  // ---------- 2. 前端接线 ----------
  console.log('=== 2. 前端接线 ===');
  const app = R('static/app.js');
  ok('路由把 param 传给 viewToday', /await viewToday\(main, param\)/.test(app));
  ok('viewToday 接受第二个参数', /async function viewToday\(main, dayParam\)/.test(app));
  ok('refreshToday 支持指定哪天', /async function refreshToday\(day\)/.test(app));
  ok('翻看历史时写 todayView，不覆盖 today', /State\.todayView = await api\('\/today\?day='/.test(app));
  ok('回到今天时才写 State.today 并刷侧栏', /State\.today = await api\('\/today'\);\s*\n\s*State\.todayView = State\.today;\s*\n\s*updateSidebar\(\)/.test(app));
  ok('State 里有 todayView', /todayView: null/.test(app));
  ok('有前后两个箭头按钮', /id="day-prev"/.test(app) && /id="day-next"/.test(app));
  ok('箭头按后端 hasPrev/hasNext 禁用，前端不自己算 112', /t\.hasPrev \? '' : ' disabled'/.test(app) && /t\.hasNext \? '' : ' disabled'/.test(app));
  ok('换页时清掉全局左右键监听', /document\.onkeydown = null/.test(app));
  // 曾经这里断言「翻到别的日子时打卡按钮停用」，那是把 bug 当成规格写进测试。
  // 打卡记的是「这道题做没做过」（progress 主键是 slug），不分哪天，
  // 所以在历史/未来页都能勾。现在反过来钉死：不能再有按日期拦路的闸。
  ok('打卡按钮不再按日期停用（check 不再被 isToday 拦住）',
     !/const canCheck = t\.isToday !== false/.test(app)
     && /\[data-check\]', main\)\.forEach/.test(app));
  ok('有「回到今天」按钮', /id="back-today"/.test(app));

  // ---------- 3. 真实渲染：今天 ----------
  console.log('=== 3. 渲染今天：箭头状态 ===');
  ctx.location.hash = '#/today';
  await ctx.render();
  ok('今天页画出来了', main.innerHTML.length > 200, main.innerHTML.length);
  ok('今天有左箭头', !!nodes['day-prev']);
  ok('今天有右箭头', !!nodes['day-next']);
  const firstDay = t0.dayNo <= 1;
  ok('第 1 天时左箭头被禁用', firstDay ? nodes['day-prev'].disabled === true : nodes['day-prev'].disabled === false,
    `dayNo=${t0.dayNo} disabled=${nodes['day-prev'].disabled}`);
  ok('今天页没有「不是今天」的提示条', !nodes['back-today']);
  ok('今天页打卡按钮可点', qAll(main, 'btn-check').every(b => !b.disabled) || qAll(main, 'btn-check').length === 0);

  // ---------- 4. 渲染第 3 天 ----------
  console.log('=== 4. 渲染第 3 天：看的是那天，改的不是今天 ===');
  const todaySnapshot = JSON.stringify(ST().today);
  ctx.location.hash = '#/today/3';
  await ctx.render();
  ok('第 3 天页画出来了', main.innerHTML.length > 200, main.innerHTML.length);
  ok('页面标题是第 3 天', /Day 3/.test(main.innerHTML), (main.innerHTML.match(/Day \d+/) || [])[0]);
  ok('显示的是那天的日期', main.innerHTML.includes('2026-11-04'));
  ok('有「不是今天」的提示条', !!nodes['back-today']);
  ok('eyebrow 标了「计划预览」', /计划预览/.test(main.innerHTML));
  const leaked = /今日任务 · Day/.test(main.innerHTML);
  ok('没有把历史日说成「今日任务」', !leaked);
  const afterJson = JSON.stringify(ST().today);
  ok('翻页没有污染 State.today', afterJson === todaySnapshot, 'State.today 被改了');
  ok('今天的 dayNo 还是原来那个', ST().today.dayNo === t0.dayNo, ST().today.dayNo);
  ok('todayView 指向第 3 天', ST().todayView && ST().todayView.dayNo === 3, ST().todayView && ST().todayView.dayNo);
  ok('历史页打卡按钮全部可点（不再被禁用）',
     qAll(main, 'btn-check').every(b => !b.disabled) || qAll(main, 'btn-check').length === 0,
     '有 disabled 的按钮');
  ok('第 3 天左箭头可点', nodes['day-prev'].disabled === false);
  ok('第 3 天右箭头可点', nodes['day-next'].disabled === false);

  // ---------- 5. 点箭头 ----------
  console.log('=== 5. 点箭头真的换路由 ===');
  ctx.location.hash = '#/today/3';
  nodes['day-prev'].click();
  // 第 2 天是不是「真实今天」取决于跑测试的日期，不能写死 '#/today/2'。
  // goDay() 的规则是：落到真实今天就用 '#/today'（不写死天数，明天才不用改），
  // 否则用 '#/today/N'。这里按本次拿到的 realDayNo 判断。
  const wantPrev = t0.realDayNo === 2 ? '#/today' : '#/today/2';
  ok('点左箭头去第 2 天', ctx.location.hash === wantPrev,
    ctx.location.hash + '（期望 ' + wantPrev + '，realDayNo=' + t0.realDayNo + '）');
  ctx.location.hash = '#/today/3';
  await ctx.render();
  nodes['day-next'].click();
  const wantNext = t0.realDayNo === 4 ? '#/today' : '#/today/4';
  ok('点右箭头去第 4 天', ctx.location.hash === wantNext,
    ctx.location.hash + '（期望 ' + wantNext + '）');

  ctx.location.hash = '#/today/1';
  await ctx.render();
  ok('第 1 天左箭头禁用', nodes['day-prev'].disabled === true);
  const hashBefore = ctx.location.hash;
  nodes['day-prev'].click();
  ok('禁用状态下点了不动', ctx.location.hash === hashBefore, ctx.location.hash);

  // ---------- 6. 回到今天 ----------
  console.log('=== 6. 回到今天 ===');
  ctx.location.hash = '#/today/3';
  await ctx.render();
  nodes['back-today'].click();
  ok('点「回到今天」回 #/today', ctx.location.hash === '#/today', ctx.location.hash);
  ctx.location.hash = '#/today';
  await ctx.render();
  const [, tNow] = await J('/api/today');
  ok('回今天的页面显示 isToday 的状态', /今日任务/.test(main.innerHTML));
  ok('回到今天后 State.today 是今天的', ST().today.dayNo === tNow.dayNo, ST().today.dayNo);

  // ---------- 7. 键盘翻页 ----------
  console.log('=== 7. 左右键翻页 ===');
  ctx.location.hash = '#/today/5';
  await ctx.render();
  ok('今日页装了键盘监听', typeof ctx.document.onkeydown === 'function');
  ctx.location.hash = '#/today/5';
  ctx.document.onkeydown({ key: 'ArrowLeft', target: { tagName: 'BODY' } });
  ok('按 ← 去第 4 天', ctx.location.hash === '#/today/4', ctx.location.hash);
  ctx.location.hash = '#/today/5';
  await ctx.render();
  ctx.document.onkeydown({ key: 'ArrowRight', target: { tagName: 'BODY' } });
  ok('按 → 去第 6 天', ctx.location.hash === '#/today/6', ctx.location.hash);

  ctx.location.hash = '#/today/5';
  await ctx.render();
  ctx.location.hash = '#/today/5';
  ctx.document.onkeydown({ key: 'ArrowLeft', target: { tagName: 'TEXTAREA' } });
  ok('在输入框里按 ← 不翻页', ctx.location.hash === '#/today/5', ctx.location.hash);

  // 换到别的页面必须解绑，否则在题库里按 ← 会跳去前一天
  ctx.location.hash = '#/snippets';
  await ctx.render();
  ok('离开今日页后键盘监听被清掉', ctx.document.onkeydown === null, String(ctx.document.onkeydown));

  // ---------- 8. CSS ----------
  console.log('=== 8. 样式 ===');
  const css = R('static/app.css');
  ok('.day-nav 存在', /\.day-nav\s*\{/.test(css));
  ok('.day-arrow 存在', /\.day-arrow\s*\{/.test(css));
  ok('箭头有 hover 态', /\.day-arrow:hover/.test(css));
  ok('箭头有禁用态', /\.day-arrow:disabled/.test(css));
  ok('箭头有键盘焦点态', /\.day-arrow:focus-visible/.test(css));
  ok('历史页 eyebrow 变红', /\.page-head-hist \.eyebrow/.test(css));
  ok('提示条用 flex 布局', /\.notice-view\s*\{/.test(css));

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('测试自身崩了：', e); process.exitCode = 1; });
