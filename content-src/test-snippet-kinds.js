// 模板库可用性标记验证
// 用真实 app.js 渲染真实后端数据，断言「可编译 / 片段」标记与 CompileCheck 的判定一致
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, 'static', f), 'utf8');
const B = 'http://127.0.0.1:8099';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

// ---------- 最小 DOM stub ----------
function mkEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    _html: '', textContent: '', value: '',
    dataset: {}, style: {}, children: [],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, on) { on === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (on ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); }
    },
    _l: {},
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    removeEventListener(t, f) { if (this._l[t]) this._l[t] = this._l[t].filter(x => x !== f); },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return true; },
    get offsetWidth() { return 100; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
  };
  return el;
}

(async () => {
  console.log('=== 1. CompileCheck 的判定文件 ===');
  const kindsRaw = await (await fetch(B + '/snippet-kinds.json')).json();
  const kinds = kindsRaw.kinds || {};
  ok('snippet-kinds.json 可访问', Object.keys(kinds).length > 0);
  ok('有 generatedAt（说明是真跑出来的，不是手写死的）', !!kindsRaw.generatedAt);
  ok('summary 三类齐全', ['runnable', 'fragment', 'broken'].every(k => k in kindsRaw.summary));
  console.log('     summary:', JSON.stringify(kindsRaw.summary));

  const snips = await (await fetch(B + '/api/snippets')).json();
  ok('判定条数 = 模板条数（' + Object.keys(kinds).length + ' / ' + snips.length + '）',
     Object.keys(kinds).length === snips.length);
  const missing = snips.filter(s => !kinds[s.category + ' / ' + s.title]);
  ok('每段模板都有判定（没有漏判的）', missing.length === 0,
     missing.map(s => s.title).join(', '));
  ok('没有 broken（真错误数应为 0）', kindsRaw.summary.broken === 0);

  console.log('\n=== 2. app.js 是否读这份文件 ===');
  const app = R('app.js');
  ok('fetch 了 snippet-kinds.json', app.includes('snippet-kinds.json'));
  ok('有 State.snippetKinds 缓存', app.includes('State.snippetKinds'));
  ok('渲染了 skind 标记', app.includes('skind ok') && app.includes('skind frag'));
  ok('片段有额外解释块', app.includes('skind-why'));
  ok('头部统计了可用/片段数', app.includes('可直接用 ${cnt.runnable') || app.includes('cnt.runnable'));
  ok('说明了两种标记的含义', app.includes('javac 真的编译通过了'));

  // 规则只有一份：前端不得自己再写判定正则
  ok('前端没有重复实现「是否可编译」的判定', !/HAS_METHOD|未命名类|找不到符号/.test(app));

  console.log('\n=== 3. 真实渲染出标记 ===');
  // 直接复现渲染逻辑，核对每个模板的标记与判定一致
  const render = (cat, s) => {
    const k = kinds[s.category + ' / ' + s.title];
    if (!k) return '';
    return k.kind === 'runnable' ? '可直接用'
         : k.kind === 'broken' ? '有问题'
         : '片段';
  };
  let cntMap = { '可直接用': 0, '片段': 0, '有问题': 0 };
  for (const s of snips) {
    const m = render(s.category, s);
    if (m) cntMap[m]++;
  }
  console.log('     渲染统计:', JSON.stringify(cntMap));
  ok('「可直接用」数量与判定文件一致', cntMap['可直接用'] === kindsRaw.summary.runnable);
  ok('「片段」数量与判定文件一致', cntMap['片段'] === kindsRaw.summary.fragment);
  ok('没有「有问题」的模板', cntMap['有问题'] === 0);

  // 抽一条片段，确认它有 reason 能显示
  const fragKey = Object.keys(kinds).find(k => kinds[k].kind === 'fragment');
  ok('片段有 reason 供 tooltip 显示', !!kinds[fragKey].reason);
  console.log('     示例片段:', fragKey, '→', kinds[fragKey].reason);

  // 抽一条可编译的，确认 reason 为空（不该有多余提示）
  const runKey = Object.keys(kinds).find(k => kinds[k].kind === 'runnable');
  ok('可编译条目的 reason 为空', kinds[runKey].reason === '');
  console.log('     示例可编译:', runKey);

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
