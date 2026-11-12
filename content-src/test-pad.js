/**
 * 自由卷面（#/pad）测试。
 *
 * 这一页要验的就三件事，用户验收标准里逐字写了：
 *   ① 打开即三行空行
 *   ② 任意行按回车，能在它后面长出新行
 *   ③ 点复制，拿到的是整份代码，粘进力扣能直接跑
 *
 * 【4】是重点。复制内容必须
 *   - 保留行首缩进（trim 掉粘到力扣里就编译不过）
 *   - 没填的行留成一个空行（不是被过滤掉 —— 过滤掉行号全错）
 *   - 行间用 \n 连，末尾不多一个空行
 * 所以这一节不靠"看源码里有没有 join"，而是把 viewPad 真正跑起来，
 * 敲进去一段两数之和，把复制出来的字符串逐字符对一遍。
 *
 * 沙箱禁止 Node 派生子进程（execFileSync 恒 EPERM），所以不调 javac。
 * 改成用 vm 跑真实 viewPad + 手写 DOM stub —— stub 的保真度是这测试的全部价值，
 * 保真度不够就是自己在骗自己。
 *
 * 注意：这个文件用 require，是 CommonJS，不能写顶层 await。
 * （之前 test-fill-ui.js 就栽在这上面：both 'require' and top-level await are present）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'static/app.js'), 'utf8').replace(/\r\n/g, '\n');
const HTML = fs.readFileSync(path.join(ROOT, 'static/index.html'), 'utf8').replace(/\r\n/g, '\n');
const CSS = fs.readFileSync(path.join(ROOT, 'static/app.css'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? ' → ' + extra : '')); }
};

// ---------- 按行切出一个顶层函数 ----------
// 数花括号的办法在 app.js 上翻过车：注释里一个裸 { 就能让计数器永远配不平。
// 顶层函数的特征是最后那个 } 顶格，用这个当边界比数括号可靠。
function sliceFn(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex(l => l.startsWith('async function ' + name + '(') || l.startsWith('function ' + name + '('));
  if (start < 0) return '';
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '}') return lines.slice(start, i + 1).join('\n');
  }
  return '';
}

// ---------- DOM stub ----------
// 保真度三条：
//   ① innerHTML setter 要扫出 id="..." 注册节点（否则 $('#pad-copy') 永远是 null，
//      测试会一路"通过"其实一条没验）
//   ② addEventListener 要能真派发（派发器自己写，不是调一次回调就算）
//   ③ input 要有 selectionStart / setSelectionRange / focus（Tab 缩进和回车跳行都依赖）
function makeDom() {
  const nodes = {};

  function mkEl(tag, id) {
    const el = {
      tagName: tag.toUpperCase(),
      _s: new Set(),
      _listeners: {},
      children: [],
      parentNode: null,
      value: '',
      textContent: '',
      placeholder: '',
      disabled: false,
      selectionStart: 0,
      selectionEnd: 0,
      style: {},
      id: id || '',
      className: '',
      dataset: {},
      get classList() {
        const self = this;
        return {
          add: c => self._s.add(c),
          remove: c => self._s.delete(c),
          contains: c => self._s.has(c) || (self.className || '').split(/\s+/).includes(c),
          toggle: (c, on) => (on === undefined ? (self._s.has(c) ? self._s.delete(c) : self._s.add(c)) : (on ? self._s.add(c) : self._s.delete(c))),
        };
      },
      setAttribute(k, v) { if (k === 'id') { this.id = v; nodes[v] = this; } },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
      addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
      removeEventListener() { },
      dispatch(t, ev) {
        const list = this._listeners[t] || [];
        const e = Object.assign({
          type: t, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { },
          currentTarget: this, target: this,
        }, ev || {});
        list.forEach(fn => fn.call(this, e));
        return e;
      },
      click() { return this.dispatch('click', {}); },
      focus() { ctx._focused = this; },
      blur() { },
      select() { },
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b === undefined ? a : b; },
      scrollIntoView() { },
      get firstElementChild() { return this.children[0] || null; },
    };
    // innerHTML：真浏览器会把 HTML 解析成元素树。
    // 不补这一步，$('#xxx') 永远是 null、$$('.xxx') 永远返回空数组 ——
    // 测试会一路"通过"，其实一条都没验。这是 DOM stub 最容易骗过自己的地方。
    //
    // 这里不是通用解析器，只认 viewPad 自己产出的四种形状：
    //   <div class="pad-row">   <input class="pad-input" data-row="0" value="...">
    //   <span class="pad-no">    <button class="..." id="...">
    // 但这四种必须认全，少一种对应那节就是假的。
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._html || ''; },
      set(v) {
        const html = String(v);
        this._html = html;
        this.children = [];

        // 逐个开标签扫。属性区到 '>' 为止（属性值里不会有裸的 '>'，viewPad 的模板里
        // escAttr 会把 > 转成 &gt;，所以这个简化是安全的）。
        const tagRe = /<(div|span|input|button|pre|details|summary|p|h1|a)\b([^>]*)>/g;
        let m;
        while ((m = tagRe.exec(html)) !== null) {
          const tag = m[1];
          const attrs = m[2];
          const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
          const id = (attrs.match(/id="([^"]*)"/) || [])[1] || '';

          const child = mkEl(tag, id);
          child.className = cls;
          if (id) nodes[id] = child;

          // value 只在 input 上有意义，但统一读出来没坏处
          const val = attrs.match(/value="([^"]*)"/);
          if (val) child.value = val[1];

          // data-* → dataset（小驼峰），viewPad 用 dataset.row 找行号
          for (const dm of attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)) {
            child.dataset[dm[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())] = dm[2];
          }

          child.parentNode = this;
          this.children.push(child);
        }
      },
    });
    if (id) nodes[id] = el;
    return el;
  }

  const ESC = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ctx = {
    _focused: null,
    nodes,
    mkEl,
    document: {
      createElement: t => mkEl(t),
      body: mkEl('body'),
      querySelector: s => (s.startsWith('#') ? nodes[s.slice(1)] || null : null),
      querySelectorAll: () => [],
    },
    localStorage: (() => {
      const store = {};
      return {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; },
      };
    })(),
    toast: () => { },
    // viewPad 的复制回调里有 setTimeout（「已复制」1.6 秒后改回去）。
    // vm 沙箱不继承 Node 的全局，不补这个一点复制就 ReferenceError。
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    esc: ESC,
    escAttr: ESC,
    copied: null,
    copyText: async t => { ctx.copied = t; return true; },
    console,
  };
  return ctx;
}

/**
 * 建一个能跑 viewPad 的 vm 上下文。
 *
 * `$$` 在 stub 里按 className 从 host.children 里扫 —— viewPad 只对 `.pad-input` 用它。
 * 真浏览器是 querySelectorAll 遍历整棵树，这里够用（一层的行输入框）。
 */
function buildCtx() {
  const c = makeDom();
  c.$ = sel => (sel.startsWith('#') ? c.nodes[sel.slice(1)] || null : null);
  c.$$ = (sel, root) => {
    const key = sel.replace(/^\./, '');
    const host = root || c.document.body;
    return (host.children || []).filter(x => (x.className || '').split(/\s+/).includes(key));
  };
  return c;
}

/** 起一个页面，返回 { ctx, main, box, inputs } */
async function openPad() {
  const ctx = buildCtx();
  vm.createContext(ctx);
  vm.runInContext(sliceFn(APP, 'viewPad'), ctx);
  const main = ctx.mkEl('div', 'main');
  ctx.document.body.appendChild(main);
  await vm.runInContext('viewPad(document.querySelector("#main"))', ctx);
  const box = ctx.nodes['pad-code'];
  return { ctx, main, box, inputs: ctx.$$('.pad-input', box) };
}

/** 输入一行内容（模拟真打字：先 input 事件，再可选回车） */
function typeLine(ctx, box, i, text, enter) {
  const ins = ctx.$$('.pad-input', box);
  ins[i].value = text;
  ins[i].dispatch('input', {});
  if (enter) ins[i].dispatch('keydown', { key: 'Enter' });
  return ins;
}

async function main() {
  // ============================================================
  console.log('\n【1】路由与入口');
  // ============================================================
  {
    ok('viewPad 函数存在', sliceFn(APP, 'viewPad').length > 400, sliceFn(APP, 'viewPad').length + ' 字符');
    ok('路由里有 pad 分支', /else if \(view === 'pad'\)\s+await viewPad\(main\)/.test(APP));
ok('导航里不再有「自由卷面」（它的用途被空白解覆盖了，留着是重复入口）', !/data-view="pad"/.test(HTML));
ok('但路由还在 —— 直接敲 #/pad 还能用', /view === 'pad'/.test(APP));
  }

  // ============================================================
  console.log('\n【2】打开即三行');
  // ============================================================
  {
    const { ctx, box, inputs } = await openPad();
    ok('卷面容器渲染出来了', !!box && box.innerHTML.includes('pad-row'));
    const rowCount = (box.innerHTML.match(/class="pad-row"/g) || []).length;
    ok('初始就是 3 行', rowCount === 3, rowCount + ' 行');
    ok('右上角有复制按钮', !!ctx.nodes['pad-copy'], ctx.nodes['pad-copy'] ? ctx.nodes['pad-copy'].textContent : 'null');
    ok('每行一个输入框', inputs.length === 3, inputs.length + ' 个');
    ok('有行号（力扣报错按行给，没行号对不上）', /class="pad-no"/.test(box.innerHTML));
  }

  // ============================================================
  console.log('\n【3】回车新增一行');
  // ============================================================
  {
    const { ctx, box } = await openPad();
    let inputs = typeLine(ctx, box, 0, 'class Solution {', true);

    ok('回车被拦下了（不拦会提交表单/换页）', inputs[0]._lastPrevented !== false);

    inputs = ctx.$$('.pad-input', box);
    ok('行数从 3 变成 4', inputs.length === 4, inputs.length + ' 行');
    ok('新行插在第 1 行后面（不是追加到末尾）', inputs[1].value === '', JSON.stringify(inputs[1].value));
    ok('原来第 1 行的内容还在', inputs[0].value === 'class Solution {', inputs[0].value);
    ok('光标自动跳到新行', ctx._focused === inputs[1]);

    // 连按三次回车 → 能连续往下写，这是"写长代码"的最低要求
    ctx.$$('.pad-input', box)[1].dispatch('keydown', { key: 'Enter' });
    ctx.$$('.pad-input', box)[2].dispatch('keydown', { key: 'Enter' });
    inputs = ctx.$$('.pad-input', box);
    ok('连按三次回车 → 6 行', inputs.length === 6, inputs.length + ' 行');

    // 缩进继承：在已缩进的行上回车，新行要跟着缩进，
    // 否则写嵌套代码时每行都得自己敲一遍空格
    const ins2 = ctx.$$('.pad-input', box);
    ins2[0].value = '        int n = nums.length;';
    ins2[0].dispatch('input', {});
    ins2[0].dispatch('keydown', { key: 'Enter' });
    const ins3 = ctx.$$('.pad-input', box);
    ok('新行继承了上一行的缩进', ins3[1].value === '        ', JSON.stringify(ins3[1].value));

    // 空行退格删一行。只能加不能删的话，敲错一行就收拾不了。
    // 注意要拿一个"真的是空"的行来试 —— 上一节刚给第 2 行打了 8 个空格，
    // 那不是空行，在它上面按退格本来就该什么都没发生。
    const before = ctx.$$('.pad-input', box).length;
    const target = ctx.$$('.pad-input', box).findIndex(x => x.value === '');
    ok('卷面上有一个真空行可用来试删', target >= 0, target);
    ctx.$$('.pad-input', box)[target].dispatch('keydown', { key: 'Backspace' });
    const after = ctx.$$('.pad-input', box).length;
    ok('空行上按退格能删掉这一行', after === before - 1, before + ' → ' + after);

    // 反过来：非空行按退格绝不能删行（否则打错一个字就丢一整行）
    const n1 = ctx.$$('.pad-input', box).length;
    const filled = ctx.$$('.pad-input', box).findIndex(x => x.value !== '');
    ctx.$$('.pad-input', box)[filled].dispatch('keydown', { key: 'Backspace' });
    const n2 = ctx.$$('.pad-input', box).length;
    ok('非空行按退格不删行（只由浏览器自己删字符）', n2 === n1, n1 + ' → ' + n2);

    // 但至少留一行 —— 全删光就没地方放光标了
    const { ctx: c2, box: b2 } = await openPad();
    for (let k = 0; k < 8; k++) {
      const xs = c2.$$('.pad-input', b2);
      if (xs.length <= 1) break;
      xs[xs.length - 1].dispatch('keydown', { key: 'Backspace' });
    }
    ok('删到底至少留 1 行', c2.$$('.pad-input', b2).length >= 1, c2.$$('.pad-input', b2).length + ' 行');
  }

  // ============================================================
  console.log('\n【4】复制出来的东西能直接粘进力扣');
  // ============================================================
  {
    const { ctx, box } = await openPad();

    // 真敲一段能过力扣的两数之和，缩进照力扣的习惯（4 空格一层）。
    // 注意 need 那行是 12 个空格 —— class → 方法 → for → if，四层。
    const typed = [
      'class Solution {',
      '    public int[] twoSum(int[] nums, int target) {',
      '        Map<Integer, Integer> seen = new HashMap<>();',
      '        for (int i = 0; i < nums.length; i++) {',
      '            int need = target - nums[i];',
      '            if (seen.containsKey(need)) {',
      '                return new int[]{seen.get(need), i};',
      '            }',
      '            seen.put(nums[i], i);',
      '        }',
      '        return new int[]{};',
      '    }',
      '}',
    ];

    /**
     * 写第 i 行：行不够就先回车造出来，然后往里写，不按回车。
     *
     * 前一版无条件每行按一次回车，13 行敲出 15 行 —— 多出来的空行是测试自己按的，
     * 然后被拿去断言"产品多给了空行"。自己造 bug 自己修，纯浪费。
     * 真人也不会这样：已经存在的行是直接点进去写的。
     */
    const write = (i, text) => {
      let ins = ctx.$$('.pad-input', box);
      while (ins.length <= i) {
        ins[ins.length - 1].dispatch('keydown', { key: 'Enter' });
        ins = ctx.$$('.pad-input', box);
      }
      ins[i].value = text;
      ins[i].dispatch('input', {});
    };

    typed.forEach((line, i) => write(i, line));
    ok('敲完 13 行，卷面也是 13 行', ctx.$$('.pad-input', box).length === 13, ctx.$$('.pad-input', box).length + ' 行');

    ctx.nodes['pad-copy'].click();
    await new Promise(r => setTimeout(r, 10));

    const got = ctx.copied;
    ok('复制出来的是完整 13 行', got === typed.join('\n'),
      got === null ? 'copyText 没被调用' : got.split('\n').length + ' 行 vs 13 行');

    // 逐条硬指标。缩进这一条从数据里取，不凭印象写死空格数。
    const needLine = typed[4];
    const needIndent = (needLine.match(/^\s*/) || [''])[0].length;
    ok('need 那行确实是 12 个空格缩进（数据的自我检查）', needIndent === 12, needIndent + ' 个');
    ok('行首缩进没被 trim', got.includes('\n' + needLine), '缩进丢了');
    ok('花括号和分号原样保留', got.includes('return new int[]{seen.get(need), i};'));
    ok('行数 = 13', got.split('\n').length === 13, got.split('\n').length + ' 行');
    ok('末尾没有多余空行', !got.endsWith('\n'), JSON.stringify(got.slice(-8)));
    ok('开头没有空行', got.startsWith('class Solution {'), JSON.stringify(got.slice(0, 20)));

    // 空行必须留成空行。被过滤掉的话，力扣报的行号全对不上。
    // 初始就有 3 行，正好够写「class { / 空 / }」—— 一行回车都不用按。
    const p2 = await openPad();
    const ins2 = p2.ctx.$$('.pad-input', p2.box);
    ins2[0].value = 'class Solution {';
    ins2[0].dispatch('input', {});
    ins2[2].value = '}';
    ins2[2].dispatch('input', {});
    p2.ctx.nodes['pad-copy'].click();
    await new Promise(r => setTimeout(r, 10));
    ok('没填的行留成一个空行（不是被过滤掉）', p2.ctx.copied === 'class Solution {\n\n}', JSON.stringify(p2.ctx.copied));

    // 缩进也要逐行验：全部 13 行拼回去必须和目标串一模一样，
    // 差一个空格都不行 —— 粘到力扣里缩进错了虽然能编译，但人看不出哪层是哪层。
    ok('整份代码逐字节等于输入（含所有缩进）', got === typed.join('\n'),
      got === null ? 'null' : '首处差异在第 ' + (typed.join('\n').split('\n').findIndex((l, i) => l !== got.split('\n')[i]) + 1) + ' 行');
  }

  console.log('\n【5】草稿：切走再回来不丢');
  // ============================================================
  {
    const { ctx, box } = await openPad();
    typeLine(ctx, box, 0, 'int x = 1;', true);
    ok('输入即存草稿', !!ctx.localStorage.getItem('lc.pad.rows'), ctx.localStorage.getItem('lc.pad.rows'));

    // 切走再回来：同一 vm 里再调一次 viewPad（等价于离开页面又点回来）
    const main2 = ctx.mkEl('div', 'main2');
    ctx.document.body.appendChild(main2);
    ctx.nodes['main2'] = main2;
    await vm.runInContext('viewPad(document.querySelector("#main2"))', ctx);
    const back = ctx.$$('.pad-input', ctx.nodes['pad-code']);
    ok('回来时内容还在', back[0].value === 'int x = 1;', JSON.stringify(back[0].value));
    ok('回来时行数也还在（回车加的那行没丢）', back.length === 4, back.length + ' 行');

    ctx.nodes['pad-clear'].click();
    const cleared = ctx.$$('.pad-input', ctx.nodes['pad-code']);
    ok('清空后回到 3 行', cleared.length === 3, cleared.length + ' 行');
    ok('清空后内容为空', cleared.every(i => i.value === ''));
  }

  // ============================================================
  console.log('\n【6】localStorage 被禁也不能崩');
  // ============================================================
  {
    const ctx = buildCtx();
    ctx.localStorage.setItem = () => { throw new Error('storage disabled'); };
    ctx.localStorage.getItem = () => { throw new Error('storage disabled'); };
    vm.createContext(ctx);
    vm.runInContext(sliceFn(APP, 'viewPad'), ctx);
    const m = ctx.mkEl('div', 'main');
    ctx.document.body.appendChild(m);
    let threw = null;
    try { await vm.runInContext('viewPad(document.querySelector("#main"))', ctx); } catch (e) { threw = e; }
    ok('隐私模式下照样能写（存不了只是没草稿）', threw === null, threw && threw.message);
    ok('隐私模式下还是 3 行', ctx.$$('.pad-input', ctx.nodes['pad-code']).length === 3);
  }

  // ============================================================
  console.log('\n【7】样式与版本');
  // ============================================================
  {
    ok('.pad-code 卷面样式在', /\.pad-code\s*\{/.test(CSS));
    ok('.pad-input 行输入样式在', /\.pad-input\s*\{/.test(CSS));
    ok('复制按钮绝对定位在右上角', /\.pad-copy\s*\{[\s\S]{0,220}position:\s*absolute/.test(CSS));
    ok('卷面顶部给按钮留了位置（否则第一行被压住）', /\.pad-code\s*\{[\s\S]{0,320}padding:\s*46px/.test(CSS));
    ok('输入框用等宽字体', /\.pad-input\s*\{[\s\S]{0,320}font-family:\s*var\(--f-mono\)/.test(CSS));
    ok('行号样式在', /\.pad-no\s*\{/.test(CSS));

    const vers = [...HTML.matchAll(/\?v=([0-9a-z]+)/g)].map(m => m[1]);
    ok('所有静态资源用同一个版本号', new Set(vers).size === 1, JSON.stringify(vers));
    ok('版本不早于 20261112f', vers[0] >= '20261112f', vers[0]);
  }

  console.log('\n' + '='.repeat(52));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exitCode = fail ? 1 : 0;
}

main().catch(e => {
  console.error('\n测试自己崩了：', e && e.message);
  console.error(e && e.stack);
  process.exitCode = 1;
});
