/**
 * 回归防护：在历史页打卡，不能污染 State.today / 侧栏统计。
 *
 * 这是本次修复最容易踩坏的地方 —— 原来打卡后台固定调
 *   await refreshToday(null)
 * 那会把 State.today 覆盖成「真实今天」。如果我不小心保留了这个调用，
 * 在历史页点完勾，侧栏的连续打卡/累计完成会被刷成另一天的数据。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const API = process.env.LC_API || 'http://127.0.0.1:8099';

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log('  ✅ ' + m + (extra !== undefined ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + m + (extra !== undefined ? '  ← ' + extra : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n=== 1. 代码层面：历史页打卡不能调 refreshToday(null) ===');
  const app = await (await fetch(API + '/app.js')).text();

  // 找到打卡那段（[data-check] forEach 到结尾）
  const i = app.indexOf("$$('[data-check]', main).forEach");
  ok(i > 0, '找到打卡绑定代码');
  // 取到下一个顶层闭合（0 缩进的 }); ）
  const seg = app.slice(i, app.indexOf('\n}', i) + 2);

  ok(!/refreshToday\(null\)/.test(seg),
     '打卡后不再无条件刷新「真实今天」（那会覆盖 State.today）');
  ok(/refreshToday\(t\.isToday === false \? t\.dayNo : null\)/.test(seg),
     '改成按当前视图刷新：历史页刷那一天，今天刷今天');
  ok(/const fresh = await refreshToday/.test(seg) && /const shown = fresh \|\| t/.test(seg),
     '进度条数字取自「当前渲染的那一天」，不是 State.today');

  console.log('\n=== 2. 运行时：在历史页打卡后 State.today 不变 ===');

  // 极简 stub（同 test-check-click.js）
  const nodes = {};
  function mkEl(tag, id) {
    const el = {
      tagName: (tag || 'div').toUpperCase(), id: id || '', _s: new Set(),
      className: '', innerHTML: '', textContent: '', value: '', title: '',
      style: {}, dataset: {}, disabled: false, type: '', children: [], parentNode: null, _l: {},
      classList: {
        add(c) { el._s.add(c); }, remove(c) { el._s.delete(c); },
        contains(c) { return el._s.has(c) || (el.className || '').split(/\s+/).includes(c); },
        toggle(c, f) { const v = f === undefined ? !el.classList.contains(c) : !!f; v ? el.classList.add(c) : el.classList.remove(c); return v; }
      },
      addEventListener(t, f) { (el._l[t] = el._l[t] || []).push(f); },
      removeEventListener() { },
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      removeChild(c) { el.children = el.children.filter(x => x !== c); c.parentNode = null; return c; },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      closest(sel) {
        let n = el; const want = sel.replace(/^\./, '');
        while (n) { if (n.classList && n.classList.contains(want)) return n; n = n.parentNode; }
        return null;
      },
      querySelector() { return null; }, querySelectorAll() { return []; },
      setAttribute() { }, getAttribute() { return null; },
      focus() { }, setSelectionRange() { },
      click() { if (el.disabled) return; (el._l.click || []).forEach(f => f({ target: el, preventDefault() { }, stopPropagation() { } })); }
    };
    if (id) nodes[id] = el;
    return el;
  }
  function hydrate(root, html) {
    const re = /id="([^"]+)"/g; let m;
    while ((m = re.exec(html))) if (!nodes[m[1]]) nodes[m[1]] = mkEl('div', m[1]);
  }
  function mkNode() {
    const el = mkEl('div');
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html || ''; },
      set(v) { el._html = v; hydrate(el, v); }
    });
    return el;
  }
  ['main', 'toast', 'streak-num', 'side-meta', 'build-stamp', 'badge-mistakes',
   'badge-notify', 'grade-out', 'grade-stamp', 'btn-grade', 'my-code'].forEach(id => nodes[id] = mkEl('div', id));
  const main = nodes['main'];

  const plan = await (await fetch(API + '/api/plan/today')).json();
  const realDay = plan.realDayNo || plan.dayNo;
  const histDay = realDay > 1 ? realDay - 1 : realDay + 1;

  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Date, Math, Object, Array, String, Number, RegExp, Error, parseInt, parseFloat, isNaN,
    location: { hash: '#/today' },
    navigator: { clipboard: { writeText: async () => { } } },
    sessionStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    fetch: async (u, o) => fetch(/^https?:/.test(u) ? u : API + u, o),
    document: {
      createElement: t => mkEl(t), getElementById: id => nodes[id] || null,
      querySelector: s => (s.startsWith('#') ? nodes[s.slice(1)] || null : null),
      querySelectorAll: () => [], body: mkEl('body'), addEventListener() { }
    },
    addEventListener() { }
  };
  ctx.window = ctx;
  ctx.document.body.appendChild(main);
  const sandbox = vm.createContext(ctx);
  for (const f of ['lock.js', 'roast.js', 'mistake-fill.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'static', f), 'utf8'), sandbox, { filename: f });
  }
  await sleep(400);

  // 先加载「真实今天」，记下 State.today
  const viewToday = vm.runInContext('viewToday', sandbox);
  await viewToday(main, null);
  await sleep(400);
  const ST = () => vm.runInContext('State', sandbox);
  const snap = JSON.stringify(ST().today);
  const realDayNo = ST().today.dayNo;
  ok(!!snap && snap.length > 10, 'State.today 已加载', 'dayNo=' + realDayNo);

  // 再翻到历史日，点勾
  const histJson = await (await fetch(API + '/api/today?day=' + histDay)).json();
  const target = (histJson.items || [])[0];
  if (!target) {
    ok(false, '历史日没有题目，无法验证');
  } else {
    await fetch(API + '/api/progress/' + encodeURIComponent(target.slug), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todo' })
    });
    await viewToday(main, String(histDay));
    await sleep(400);
    ok(ST().todayView.dayNo === histDay, 'todayView 指向历史日', ST().todayView.dayNo);

    // 手动走一遍打卡流程（用的是 app.js 里那段逻辑的关键路径）
    await fetch(API + '/api/progress/' + encodeURIComponent(target.slug), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    const t = ST().todayView;
    await vm.runInContext('refreshToday', sandbox)(t.isToday === false ? t.dayNo : null);
    await sleep(300);

    ok(JSON.stringify(ST().today) === snap,
       '在历史页打卡后，State.today 没被覆盖', JSON.stringify(ST().today).slice(0, 80));
    ok(ST().today.dayNo === realDayNo, '侧栏用的「今天」还是原来的今天', ST().today.dayNo);

    // 清理
    await fetch(API + '/api/progress/' + encodeURIComponent(target.slug), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todo' })
    });
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('\n探针自身出错：' + (e && e.stack || e));
  process.exitCode = 1;
});
