/**
 * 错题弹窗「自动填写」的端到端测试。
 *
 * 单元测试证明了算得对，这里要证明**点得动**：
 * 弹窗能弹出来、按钮能点、点了输入框里的值真的变了。
 * 这两件事缺一件，功能就是假的。
 *
 * ⚠️ stub 保真度说明：真浏览器解析 innerHTML 会真的建 DOM，
 * 所以 $('#m-stuck', mask) 能找到节点。stub 里必须手动补这一步，
 * 否则节点是 null、fill 静默不生效，测试还可能因为断言写得太松而"通过"。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e) => c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (e !== undefined ? '  ← ' + e : '')));

// ---- DOM stub ----
const nodes = {};      // id -> element
const registry = [];   // 所有还活着的元素

function mkEl(tag, id) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), id: id || '', textContent: '',
    value: '', dataset: {}, style: {}, disabled: false, type: '', placeholder: '',
    className: '', _attrs: {}, children: [], parentNode: null, _removed: false,
    _html: '',
    classList: {
      _s: new Set(),
      add(...a) { a.forEach(x => x && this._s.add(x)); },
      remove(...a) { a.forEach(x => this._s.delete(x)); },
      toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); },
      // 真浏览器的 classList 和 className 是同一份数据。stub 里 app.js 有时直接
      // 写 el.className = 'modal-mask'，只查 _s 会漏掉 —— 之前 mask 找不到就是这个原因。
      contains(c) { return this._s.has(c) || splitCls(el.className).includes(c); }
    },
    _l: {},
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    removeEventListener(t, f) { if (this._l[t]) this._l[t] = this._l[t].filter(x => x !== f); },
    appendChild(c) { if (!c) return c; this.children.push(c); if (c.id) nodes[c.id] = c; c.parentNode = this; registry.push(c); return c; },
    // remove 必须递归清掉子孙的 id 登记，否则第二次弹窗还能查到上一次的按钮（假通过）
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
    setSelectionRange(a, b) { this._sel = [a, b]; },
    click() { (this._l.click || []).forEach(f => f({ target: this, preventDefault() {}, stopPropagation() {} })); },
    querySelector(s) { return q1(this, s); },
    querySelectorAll(s) { return qAll(this, s); },
    contains(el) { let p = el; while (p) { if (p === this) return true; p = p.parentNode; } return false; },
    offsetWidth: 1, scrollTop: 0, scrollHeight: 0
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) {
      el._html = String(v);
      el.children = [];               // 重设 innerHTML 会丢弃旧的子节点（真浏览器行为）
      hydrate(el, el._html);
    }
  });
  if (id) nodes[id] = el;
  registry.push(el);
  return el;
}

// 把 innerHTML 里的 id="x" / class="y" 解析成真实节点
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
    el.parentNode = root;
    root.children.push(el);
  }
}

// 支持 #id 和 .class，class 搜索沿子树走（真浏览器 querySelector 就是子树搜索）
function splitCls(s) { return String(s || '').split(/\s+/).filter(Boolean); }

function q1(root, s) {
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
    body: null
  },
  location: { hash: '#/problem/two-sum' },
  navigator: { clipboard: { writeText: async () => {} } },
  sessionStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  fetch: (u, o) => fetch(String(u).startsWith('http') ? u : 'http://127.0.0.1:8099' + u, o),
  addEventListener() {}, alert() {}, confirm: () => true
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document.body = mkEl('body', 'body');

// 这些 id 在 index.html 里是静态存在的，app.js 的 boot() 会直接写它们。
// 不预注册的话 boot 第一句 main.innerHTML 就抛，后面全是连带的假失败。
const STATIC_IDS = ['main', 'toast', 'streak-num', 'side-meta', 'build-stamp',
  'badge-mistakes', 'badge-notify', 'grade-out', 'grade-stamp', 'btn-grade', 'my-code'];
STATIC_IDS.forEach(id => { const el = mkEl('div', id); ctx.document.body.appendChild(el); });
// 导航区也补几个，boot 里会 querySelectorAll('.nav-item')
const nav = mkEl('nav', 'nav'); ctx.document.body.appendChild(nav);
['#/today', '#/mistakes', '#/snippets', '#/aihot'].forEach(h => {
  const a = mkEl('a', ''); a.className = 'nav-item'; a.dataset.hash = h; nav.appendChild(a);
});

vm.createContext(ctx);
vm.runInContext(R('static/lock.js'), ctx, { filename: 'lock.js' });
vm.runInContext(R('static/roast.js'), ctx, { filename: 'roast.js' });
vm.runInContext(R('static/mistake-fill.js'), ctx, { filename: 'mistake-fill.js' });
vm.runInContext(R('static/app.js'), ctx, { filename: 'app.js' });

const maskOf = () => registry.filter(e => !e._removed && e.classList.contains('modal-mask')).pop() || null;

(async () => {
  const p = await (await fetch('http://127.0.0.1:8099/api/problem/two-sum')).json();

  console.log('=== 有评分时：自动填写可用 ===');
  ctx.openMistakeModal({
    problemSlug: 'two-sum', problemTitle: '两数之和', tag: '数组',
    gradeResult: p.refGrades.brute, refGrades: p.refGrades
  });

  const mask = maskOf();
  ok('弹窗出现了', !!mask);
  ok('有自动填写按钮', !!nodes['m-autofill']);
  ok('三个要填的输入框都在', !!nodes['m-stuck'] && !!nodes['m-one'] && !!nodes['m-tag']);
  ok('点之前「卡在哪」是空的', !nodes['m-stuck'].value, JSON.stringify(nodes['m-stuck'].value));

  nodes['m-autofill'].click();

  const stuck = nodes['m-stuck'].value, one = nodes['m-one'].value, tag = nodes['m-tag'].value;
  ok('点完「卡在哪」被填上了', !!stuck, JSON.stringify(stuck));
  ok('点完「一句话结论」被填上了', !!one, JSON.stringify(one));
  ok('点完「tag」被填上了', !!tag, JSON.stringify(tag));
  console.log('     卡在哪：' + stuck);
  console.log('     一句话：' + one);
  console.log('     分类：' + tag);

  // 文案口径见 test-mistake-fill.js 文件头：正文要第一人称说人话，
  // 「识别到的手法：」「最大循环嵌套」「差 X 分」这类机器判据只准进右侧「依据」。
  ok('卡在哪是第一人称写的', /^我/.test(stuck), stuck);
  ok('卡在哪说出了复杂度差距（O(n^2) vs O(n)）', /O\(n\^2\)/.test(stuck) && /O\(n\)/.test(stuck), stuck);
  ok('卡在哪没有抄机器判据原文',
    !/识别到的手法|最大循环嵌套/.test(stuck) && !/差 [\d.]+ 分/.test(stuck), stuck);
  ok('一句话点名漏掉的手法', /哈希/.test(one), one);
  ok('一句话说的是「下次先想什么」', /^下次/.test(one), one);
  ok('按钮变已填状态', /已填好/.test(nodes['m-autofill'].textContent), nodes['m-autofill'].textContent);
  ok('按钮已禁用（防覆盖手改）', nodes['m-autofill'].disabled === true);
  ok('光标停在「卡在哪」', nodes['m-stuck']._focused === true);

  // 依据块是运行时 createElement 造出来再 appendChild 的，不在 mask.innerHTML 里，
  // 必须沿 .m-side 子树按 className 找 —— 之前查 innerHTML 是测试自己找错了地方。
  const side = q1(mask, '.m-side');
  const why = side ? q1(side, '.m-side-why') : null;
  ok('依据块挂到了右侧栏里', !!why, side ? side.children.map(c => c.className).join('|') : 'no .m-side');
  ok('依据块写明了怎么算的', !!why && /依据/.test(why._html) && /差距最大/.test(why._html), why ? why._html : '');

  console.log('\n=== 没评分时：不给按钮，说清原因 ===');
  const cancel = nodes['m-cancel'];
  if (cancel) cancel.click(); else mask.remove();

  ok('旧按钮已随弹窗销毁（否则下次会查到幽灵节点）', !nodes['m-autofill'], 'm-autofill 仍存在');

  ctx.openMistakeModal({
    problemSlug: 'two-sum', problemTitle: '两数之和', tag: '数组',
    gradeResult: null, refGrades: p.refGrades
  });

  ok('没评分时没有自动填写按钮', !nodes['m-autofill']);
  const mask2 = maskOf();
  ok('弹窗照样能打开', !!mask2);
  ok('但说明了为什么（先评分）', !!mask2 && /先在上面点一次/.test(mask2._html),
     mask2 ? mask2._html.slice(0, 160) : 'no mask');
  ok('没评分时也不给假按钮', !q1(mask2, '#m-autofill'));

  console.log('\n=== 不同题目的成绩不能串用 ===');
  const appSrc = R('static/app.js');
  ok('存评分时同时存了 slug', appSrc.includes('State.lastGradeSlug = slug'));
  ok('入口做了 slug 校验', appSrc.includes('sameSlug'));

  console.log('\n' + '='.repeat(56));
  console.log(`通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
