// 端到端：用 Node vm + DOM stub 跑真实 app.js，看错题本分页实际渲染成什么样。
//
// stub 保真度的两个关键点（以前踩过）：
// 1) innerHTML 的 setter 里要按正则扫 id="xxx" 注册节点，否则 $('#mistake-list') 永远 null；
// 2) 重新赋值 innerHTML 前要递归注销旧节点，否则查到的还是上一次的幽灵节点。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const API = 'http://127.0.0.1:8099';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  →  ' + extra : '')); }
}

const nodes = {};
const registry = [];

function mkEl(tag, id) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: id || '',
    children: [],
    parentNode: null,
    _html: '',
    _cls: new Set(),
    _attrs: {},
    dataset: {},
    style: {},
    disabled: false,
    value: '',
    title: '',
    textContent: '',
    _listeners: {},
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() { },
    click() { (this._listeners.click || []).forEach(fn => fn({ target: this, stopPropagation() { }, preventDefault() { } })); },
    focus() { }, blur() { }, select() { }, setSelectionRange() { },
    scrollIntoView() { },
    appendChild(c) { c.parentNode = this; this.children.push(c); if (c.id) nodes[c.id] = c; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    remove() { killDeep(this); if (this.parentNode) this.parentNode.removeChild(this); },
    querySelector(s) { return this.querySelectorAll(s)[0] || null; },
    querySelectorAll(s) {
      // 只支持这次测试真正用到的几种：id、[data-xxx]、.class
      const sel = String(s);
      if (sel.startsWith('#')) return nodes[sel.slice(1)] ? [nodes[sel.slice(1)]] : [];
      if (sel.startsWith('[data-')) {
        const key = sel.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return (this._buttons || []).filter(b => b.dataset[key] !== undefined);
      }
      if (sel.startsWith('.')) return (this.children || []).filter(c => c.classList.contains(sel.slice(1)));
      return [];
    },
    getAttribute(k) { return this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; },
    classList: null,
  };
  el.classList = {
    add: c => el._cls.add(c),
    remove: c => el._cls.delete(c),
    contains: c => el._cls.has(c) || String(el.className || '').split(/\s+/).includes(c),
    toggle: (c, on) => (on ? el._cls.add(c) : el._cls.delete(c)),
  };
  // hydrate：从 innerHTML 里把 id="xxx" 注册成节点，模拟真浏览器解析 DOM
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) {
      (el.children || []).slice().forEach(killDeep);
      el.children = [];
      el._html = String(v);
      for (const m of el._html.matchAll(/id="([^"]+)"/g)) {
        if (!nodes[m[1]]) nodes[m[1]] = mkEl('div', m[1]);
      }
      // data-mpage 之类的按钮也登记一下，翻页测试要能点到
      el._buttons = [];
      for (const m of el._html.matchAll(/<button([^>]*)>/g)) {
        const attrs = m[1];
        const b = mkEl('button');
        for (const a of attrs.matchAll(/([a-z-]+)="([^"]*)"/g)) {
          const k = a[1], val = a[2];
          if (k.startsWith('data-')) {
            b.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
          } else b._attrs[k] = val;
        }
        if (/\sdisabled(\s|$)/.test(attrs)) b.disabled = true;
        b._raw = m[0];
        el._buttons.push(b);
      }
    }
  });
  registry.push(el);
  return el;
}

function killDeep(e) {
  if (!e) return;
  if (e.id && nodes[e.id] === e) delete nodes[e.id];
  (e.children || []).forEach(killDeep);
}

const document = {
  createElement: t => mkEl(t),
  getElementById: id => nodes[id] || null,
  addEventListener() { },
  body: mkEl('body'),
  querySelector: s => (String(s).startsWith('#') ? nodes[String(s).slice(1)] || null : null),
  querySelectorAll: () => [],
  head: mkEl('head'),
  documentElement: mkEl('html'),
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() { },
  Promise, Date, Math, JSON, URL, URLSearchParams, encodeURIComponent, decodeURIComponent,
  parseInt, parseFloat, isNaN, String, Number, Boolean, Array, Object, Error, RegExp,
  Map, Set, Intl, AbortController,
  document,
  navigator: { clipboard: { writeText: async () => { } }, language: 'zh-CN' },
  location: { hash: '#/mistakes', href: 'http://127.0.0.1:8099/', reload() { }, replace() { } },
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  sessionStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  confirm: () => true,
  alert: () => { },
  addEventListener(type, fn) { if (type === 'hashchange') sandbox.__hash = fn; },
  fetch: (u, o) => fetch(/^https?:/.test(u) ? u : API + u, o),
};
// lock.js / app.js 都往 window 上挂东西，vm 里没有 window
sandbox.window = sandbox;

// 预注册 app.js 启动时要写的静态 id，否则 boot 会抛错
['main', 'toast', 'streak-num', 'side-meta', 'build-stamp', 'badge-mistakes',
 'badge-notify', 'grade-out', 'grade-stamp', 'btn-grade', 'my-code',
 'mistake-list', 'btn-add-mistake'].forEach(id => { nodes[id] = mkEl('div', id); });

vm.createContext(sandbox);
const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'static', f), 'utf8'), sandbox, { filename: f });
// 顺序按 index.html：lock → roast → mistake-fill → app
load('lock.js'); load('roast.js'); load('mistake-fill.js'); load('app.js');

(async () => {
  const ST = () => vm.runInContext('State', sandbox);
  const mainEl = nodes['main'];

  // 真进错题本页
  await vm.runInContext('viewMistakes(document.getElementById("main"))', sandbox);

  const list = ST().mistakes;
  const box = nodes['mistake-list'];
  const html = box.innerHTML;

  console.log(`\n【1】真实数据渲染（${list.length} 条错题）`);
  ok('拉到全部错题', list.length > 0, String(list.length));
  ok('一页最多 6 张卡', (html.match(/class="mistake-card/g) || []).length === Math.min(6, list.length),
    String((html.match(/class="mistake-card/g) || []).length));
  ok(`${list.length} 条 → 2 页`, list.length <= 6 || /第 1 \/ 2 页/.test(html), (html.match(/第 \d+ \/ \d+ 页[^<]*/) || [''])[0]);
  ok('显示了总条数', new RegExp('共 ' + list.length + ' 条').test(html), (html.match(/共 \d+ 条/) || [''])[0]);
  ok('第一页上一页禁用', /data-mpage="prev" disabled/.test(html));
  ok('第一页下一页可点', !/data-mpage="next" disabled/.test(html));

  console.log('\n【2】翻到第 2 页');
  const nextBtn = (box._buttons || []).find(b => b.dataset.mpage === 'next');
  ok('找到了下一页按钮', !!nextBtn);
  nextBtn.click();
  const html2 = nodes['mistake-list'].innerHTML;
  ok('页码变成第 2 页', /第 2 \/ 2 页/.test(html2), (html2.match(/第 \d+ \/ \d+ 页[^<]*/) || [''])[0]);
  const cardCount2 = (html2.match(/class="mistake-card/g) || []).length;
  ok(`第 2 页剩 ${list.length - 6} 张卡`, cardCount2 === list.length - 6, String(cardCount2));
  ok('第 2 页下一页禁用', /data-mpage="next" disabled/.test(html2));
  ok('第 2 页上一页可点', !/data-mpage="prev" disabled/.test(html2));
  ok('第 2 页换了内容（不是同一批卡）',
    (html2.match(/data-del="(\d+)"/g) || []).join() !== (html.match(/data-del="(\d+)"/g) || []).join());

  console.log('\n【3】页码状态记在 State 里');
  ok('State.mistakesPage === 2', ST().mistakesPage === 2, String(ST().mistakesPage));

  console.log('\n【4】点「上一页」回到第 1 页');
  const prevBtn = (box._buttons || []).find(b => b.dataset.mpage === 'prev');
  prevBtn.click();
  ok('回到第 1 页', /第 1 \/ 2 页/.test(nodes['mistake-list'].innerHTML));
  ok('卡片数恢复 6', (nodes['mistake-list'].innerHTML.match(/class="mistake-card/g) || []).length === 6);

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('崩了：', e); process.exitCode = 1; });
