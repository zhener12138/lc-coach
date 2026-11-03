// 用 DOM stub 加载真实 app.js，验证判题区块渲染正确
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n + (e ? '  → ' + e : '')); } };

// 极简 DOM stub
const nodes = {};
function mkEl(tag = 'div', id = '') {
  const el = {
    tagName: tag.toUpperCase(), id, className: '', _html: '', children: [], style: {},
    dataset: {}, classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    appendChild(c) { this.children.push(c); if (c.id) nodes[c.id] = c; c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
    focus() {}, blur() {}, click() {},
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) {
      this._html = String(v);
      // 关键：真浏览器解析 innerHTML 会建 DOM，stub 必须补这步，
      // 否则 $('#xxx') 永远返回 null，测试会假装通过。
      for (const m of this._html.matchAll(/id="([^"]+)"/g)) {
        if (!nodes[m[1]]) nodes[m[1]] = mkEl('div', m[1]);
      }
    },
  });
  if (id) nodes[id] = el;
  return el;
}
['main','toast','streak-num','side-meta','build-stamp','badge-mistakes','badge-notify',
 'grade-out','grade-stamp','btn-grade','my-code','q','btn-search'].forEach(id => { if (!nodes[id]) mkEl('div', id); });

const ctx = {
  console,
  document: {
    createElement: (t) => mkEl(t),
    getElementById: (id) => nodes[id] || null,
    querySelector: (s) => (s.startsWith('#') ? nodes[s.slice(1)] : null),
    querySelectorAll: () => [],
    body: mkEl('body'),
    addEventListener() {}, onkeydown: null,
  },
  window: { addEventListener() {}, location: { hash: '#/today' } },
  location: { hash: '#/today' },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: async (u, o) => {
    const url = /^https?:/.test(u) ? u : 'http://127.0.0.1:8099' + u;
    return global.fetch(url, o);
  },
  AbortSignal, URL, URLSearchParams, Response, Headers, Request,
  alert() {}, confirm: () => true, prompt: () => null,
};
ctx.globalThis = ctx;
vm.createContext(ctx);

for (const f of ['lock.js', 'roast.js', 'mistake-fill.js', 'app.js']) {
  const p = path.join(ROOT, 'static', f);
  if (!fs.existsSync(p)) { ok(f + ' 存在', false); continue; }
  try {
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  } catch (e) {
    ok('加载 ' + f, false, e.message);
  }
}

const render = (g) => vm.runInContext('renderGradeResult', ctx)(g);

(async () => {
  console.log('\n【1】判题全过');
  const allPass = {
    ok: true, total: 10, compiled: true, signatureOk: true,
    expectedMethod: 'twoSum', expectedParams: 'int[], int',
    dimensions: [
      { key: 'compile', label: '编译通过', score: 10, verifiable: true, reason: 'javac 通过', evidence: [] },
      { key: 'correctness', label: '正确性（真跑）', score: 10, verifiable: true, reason: '全对', evidence: [] },
    ],
    judge: { ran: true, total: 3, passed: 3, failures: [] },
  };
  const h1 = render(allPass);
  ok('有判题区块', /class="judge-box/.test(h1), h1.slice(0, 100));
  ok('显示 3 / 3', /3 \/ 3/.test(h1));
  ok('说人话：全部通过', /全部通过/.test(h1));
  ok('样式是 good', /judge-box good/.test(h1));

  console.log('\n【2】判题有失败');
  const partial = JSON.parse(JSON.stringify(allPass));
  partial.total = 6.9;
  partial.judge = { ran: true, total: 3, passed: 2,
    failures: [{ input: '[3,2,4], 6', expected: '[1,2]', got: '[0,1]' }] };
  const h2 = render(partial);
  ok('显示 2 / 3', /2 \/ 3/.test(h2));
  ok('说清楚错几个', /1 个用例答案是错的/.test(h2), h2.match(/有 \d+ 个用例[^<]*/));
  ok('列出失败用例的输入', /\[3,2,4\], 6/.test(h2));
  ok('列出期望值', /\[1,2\]/.test(h2));
  ok('列出实际值', /\[0,1\]/.test(h2));
  ok('失败值单独着色', /jf-got/.test(h2));

  console.log('\n【3】判不了（设计类）');
  const skip = JSON.parse(JSON.stringify(allPass));
  skip.dimensions = skip.dimensions.filter(d => d.key !== 'correctness');
  delete skip.judge;
  const h3 = render(skip);
  ok('有跳过提示', /judge-box skip/.test(h3));
  ok('说明已剔除而不是 0 分', /剔除/.test(h3) && /不是按 0 分算/.test(h3));
  ok('没有显示 0 / 0 这种误导性数字', !/0 \/ 0/.test(h3));

  console.log('\n【4】免责声明不再是「不判答案对错」');
  const h4 = render(allPass);
  ok('声明正确性是真跑的', /真跑官方示例用例/.test(h4));
  ok('没再说「没有测试用例」', !/没有测试用例/.test(h4), h4.match(/没有测试用例[^<]*/) ? '仍存在' : '');
  ok('说明判不了会重新归一', /剔除并重新归一|剔除/.test(h4));
  ok('说明只有 compile 和 correctness 是实测', /静态推断/.test(h4));

  console.log('\n【5】判题出错时不能把评分搞挂');
  const err = JSON.parse(JSON.stringify(allPass));
  err.judge = { ran: false, reason: '判题过程出错：timeout' };
  const h5 = render(err);
  ok('仍能渲染出卡片', /grade-card/.test(h5));
  ok('显示出错原因', /无法真跑|不支持真跑|判题过程出错/.test(h5));

  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})();
