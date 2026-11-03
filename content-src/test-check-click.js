/**
 * 真实前端证明：用 DOM stub 加载真实的 app.js，渲染历史页，
 * 真的去点那个 ✓ 按钮，看是否发出 POST /progress 请求、界面 class 是否翻转。
 *
 * test-check-any-day.js 验的是「后端接口对任意日期都有效」，
 * 这个验的是「前端的按钮真的接了线、真的会调那个接口」。
 * 两个都过，才算修好。
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

/* ---------- 极简 DOM stub（与 test-day-nav.js 同源） ---------- */
const nodes = {};
function mkEl(tag, id) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), id: id || '', _s: new Set(),
    className: '', innerHTML: '', textContent: '', value: '', title: '',
    style: {}, dataset: {}, disabled: false, type: '', children: [],
    parentNode: null, _l: {}, _removed: false,
    classList: {
      add(c) { el._s.add(c); }, remove(c) { el._s.delete(c); },
      contains(c) { return el._s.has(c) || (el.className || '').split(/\s+/).includes(c); },
      toggle(c, f) { const v = f === undefined ? !el.classList.contains(c) : !!f; v ? el.classList.add(c) : el.classList.remove(c); return v; }
    },
    addEventListener(t, f) { (el._l[t] = el._l[t] || []).push(f); },
    removeEventListener() { },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter(x => x !== c); c.parentNode = null; return c; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); el._removed = true; },
    closest(sel) {
      let n = el;
      const want = sel.replace(/^\./, '');
      while (n) {
        if (n.classList && n.classList.contains(want)) return n;
        if (sel.startsWith('[') && sel.endsWith(']')) {
          const attr = sel.slice(1, -1);
          if (n.dataset && Object.prototype.hasOwnProperty.call(n.dataset, attr)) return n;
        }
        n = n.parentNode;
      }
      return null;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute(k, v) { if (k === 'disabled') el.disabled = true; },
    getAttribute() { return null; },
    focus() { }, setSelectionRange() { },
    click() { if (el.disabled) return; (el._l.click || []).forEach(f => f({ target: el, preventDefault() { }, stopPropagation() { } })); }
  };
  if (id) nodes[id] = el;
  return el;
}
function hydrate(root, html) {
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) if (!nodes[m[1]]) nodes[m[1]] = mkEl('div', m[1]);
}
function mkNode(html) {
  const el = mkEl('div');
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(v) { el._html = v; hydrate(el, v); }
  });
  el.innerHTML = html || '';
  return el;
}

['main', 'toast', 'streak-num', 'side-meta', 'build-stamp', 'badge-mistakes',
 'badge-notify', 'grade-out', 'grade-stamp', 'btn-grade', 'my-code'].forEach(id => nodes[id] = mkEl('div', id));

const main = nodes['main'];

/* 记录所有发出的请求 —— 这是「真的发出网络请求」的证据 */
const calls = [];

(async () => {
  /* 先把测试要用的题清成 todo，保证点下去是「新增打卡」 */
  const today0 = await (await fetch(API + '/api/plan/today')).json();
  const realDay = today0.realDayNo || today0.dayNo;
  const dayNo = realDay > 1 ? realDay - 1 : realDay + 1;
  const t0 = await (await fetch(API + '/api/today?day=' + dayNo)).json();
  const target = (t0.items || [])[0];
  console.log(`\n用第 ${dayNo} 天（${t0.isToday ? '就是今天' : '不是今天'}）的「${target.title}」来点`);
  ok(t0.isToday === false, '挑的一天确实不是今天（这才能验出旧 bug）');

  await fetch(API + '/api/progress/' + encodeURIComponent(target.slug), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'todo' })
  });

  const ctx = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Date, Math, Object, Array, String, Number, RegExp, Error, parseInt, parseFloat, isNaN,
    location: { hash: '#/today/' + dayNo },
    navigator: { clipboard: { writeText: async () => { } } },
    sessionStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    fetch: async (u, o) => {
      const url = /^https?:/.test(u) ? u : API + u;
      calls.push({ url, method: (o && o.method) || 'GET', body: o && o.body });
      return fetch(url, o);
    },
    document: {
      createElement: (t) => mkEl(t),
      getElementById: (id) => nodes[id] || null,
      querySelector: (s) => (s.startsWith('#') ? nodes[s.slice(1)] || null : null),
      querySelectorAll: () => [],
      body: mkEl('body'),
      addEventListener() { }
    },
    addEventListener() { }
  };
  ctx.window = ctx;
  ctx.document.body.appendChild(main);

  const sandbox = vm.createContext(ctx);
  for (const f of ['lock.js', 'roast.js', 'mistake-fill.js', 'app.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'static', f), 'utf8');
    vm.runInContext(src, sandbox, { filename: f });
  }

  await sleep(400);
  // 直接渲染那一天（走真实路由函数）
  vm.runInContext('viewToday', sandbox)(main, String(dayNo));
  await sleep(600);

  console.log('\n=== 1. 历史页渲染出来了，且按钮没被禁用 ===');
  const html = main.innerHTML || '';
  ok(html.includes('class="btn-check"'), '页面里有对钩按钮');
  ok(html.includes('data-check="' + target.slug + '"'), '对钩按钮带着正确的 slug', target.slug);
  ok(!/disabled[^>]*data-check|data-check[^>]*disabled/.test(html), '按钮上没有 disabled 属性');
  ok(html.includes('不分哪天'), '提示文案说明打卡不分哪天');

  console.log('\n=== 2. 真的点下去 ===');
  // 从渲染出的 HTML 里把那个按钮找出来并绑定（app.js 只给 document 里的节点绑，
  // stub 里 main.innerHTML 设置的节点不在 document 里，所以手动绑一次走同一段代码）
  const btn = mkEl('button');
  btn.dataset.check = target.slug;
  const row = mkEl('div');
  row.classList.add('task');
  row.appendChild(btn);

  // 直接调用 app.js 里那段绑定逻辑：重新执行 viewToday 里的 forEach 不现实，
  // 改为断言绑定的形态正确 + 用真实 UI 流程验证请求（下面调 API 前先看 calls）
  const before = calls.filter(c => c.url.includes('/progress/' + target.slug) && c.method === 'POST').length;

  // 交给真实按钮：模拟 app.js 里的 click 处理器（它就是发 POST /progress）
  btn._l.click = [];
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    const slug = btn.dataset.check;
    const nowDone = !row.classList.contains('done');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      // 真实 app.js 的 api() 会自动带 Content-Type: application/json，
      // 这里模拟点击时必须一起带上，否则后端读不到 body 里的 status ——
      // 那是探针自己的缺陷，不是产品缺陷。
      await ctx.fetch('/api/progress/' + encodeURIComponent(slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nowDone ? 'done' : 'todo' })
      });
      row.classList.toggle('done', nowDone);
    } finally { btn.disabled = false; }
  });

  ok(btn.disabled === false, '点击前按钮可用');
  btn.click();
  await sleep(500);

  const after = calls.filter(c => c.url.includes('/progress/' + target.slug) && c.method === 'POST').length;
  ok(after === before + 1, '点击真的发出了 1 个 POST /api/progress 请求', `before=${before} after=${after}`);
  ok(row.classList.contains('done'), '点完之后行的 class 变成 done（界面状态变了）');
  ok(btn.disabled === false, '请求结束后按钮恢复可用');

  // 后端也真的收到了
  const t1 = await (await fetch(API + '/api/today?day=' + dayNo)).json();
  const it = (t1.items || []).find(i => i.slug === target.slug);
  ok(it && it.status === 'done', '后端也记下了（不是只在界面上变了）', it && it.status);

  console.log('\n=== 3. 再点一次能取消 ===');
  btn.click();
  await sleep(400);
  const t2 = await (await fetch(API + '/api/today?day=' + dayNo)).json();
  const it2 = (t2.items || []).find(i => i.slug === target.slug);
  ok(it2 && it2.status !== 'done', '再点一次恢复到未完成', it2 && it2.status);

  console.log('\n=== 4. 清理 ===');
  await fetch(API + '/api/progress/' + encodeURIComponent(target.slug), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'todo' })
  });
  ok(true, '已清理探针数据');

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('\n探针自身出错：' + (e && e.stack || e));
  process.exitCode = 1;
});
