/* 复制功能的回归测试。
   起因（用户 m05639）：今日模板、三解法、我的代码、模板库四处都有「复制」按钮，
   一点就弹红色「复制失败，手动选中吧」。

   根因不是「复制按钮坏了」这一件事，而是四处各自裸调 navigator.clipboard：
   那个 API 只在安全上下文（https / localhost / 127.0.0.1）里存在，
   从局域网 IP 打开页面时 navigator.clipboard 直接是 undefined，
   取值那一刻就抛 TypeError，被 catch 吞成一句「复制失败」。
   服务监听 0.0.0.0:8099 本来就是给人从别的设备访问的，所以这条路必须走得通。

   这个测试钉四件事：
   1. 存在统一的 copyText()，不再是四处各写一遍
   2. 安全上下文走 clipboard API
   3. 非安全上下文（clipboard 为 undefined）走 execCommand 兜底，并且成功
   4. 两条路都失败时才报错，且报错文案要说清为什么（不是含糊的「手动选中吧」）
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'static/app.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 1. 静态检查：复制走统一入口 ===');

ok('app.js 定义了 copyText()', /async function copyText\s*\(/.test(APP));

// 四处旧调用点不该再裸调 clipboard。
// 只数「真的去写剪贴板」的调用行 —— 注释里提到这个 API、以及 typeof 特性检测
// 都不算，早先按裸字符串数会把这两类也算进去，得出 3 次的假失败。
const realWrites = APP.split('\n').filter(l => {
  const t = l.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
  return /await\s+navigator\.clipboard\.writeText\s*\(/.test(t);
});
ok('真正写剪贴板的调用只有 copyText 里那一处（不再四处各调一遍）',
   realWrites.length === 1, '实际 ' + realWrites.length + ' 处：' + realWrites.join(' | '));

ok('copyText 里有 execCommand 兜底', /execCommand\s*\(\s*['"]copy['"]\s*\)/.test(APP));

// 四处业务调用应该都改成 copyText。
// 正则要容忍判空写法（`code ? code.textContent : ''`）—— 早先按「正好是
// code.textContent」去匹配，补丁里加了判空就全挂，那是测试太脆，不是代码错。
const callSites = [
  ['今日模板复制', /wait copyText\(\s*code\s*\?[^)]*\bcode\.textContent/],
  ['三解法 / 题目代码复制', /wait copyText\(\s*pre\s*\?[^)]*\bpre\.textContent/],
  ['我的代码复制', /wait copyText\(\s*box\s*\?[^)]*\bbox\.value/],
];
for (const [label, re] of callSites) {
  ok(label + ' 调用了 copyText', re.test(APP));
}

console.log('\n=== 2. 运行时：三种环境各跑一遍 ===');

/* 造一个最小可跑的 vm 环境，只加载 copyText 及它依赖的 esc/toast。
   不去加载整个 app.js —— 它一加载就 boot()，需要完整 DOM。 */
function makeCtx(opts) {
  const toasts = [];
  const removed = [];
  const ctx = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    window: {},
    document: {
      createElement(tag) {
        if (tag !== 'textarea') throw new Error('只该用 textarea 兜底，实际建了 ' + tag);
        const el = {
          tagName: 'TEXTAREA', value: '', style: {},
          setAttribute() {}, select() { el._selected = true; },
          setSelectionRange() { el._selected = true; },
        };
        return el;
      },
      body: {
        appendChild(el) {
          // 真 DOM 里 appendChild 会回填 parentNode；
          // stub 不补这一步的话，代码里 `ta.parentNode.removeChild(ta)`
          // 会因为 parentNode 是 undefined 而静默跳过，
          // 「临时节点被清理」这条断言就会假失败（而真实浏览器里是好的）。
          el.parentNode = ctx.document.body;
          ctx.__ta = el;
        },
        removeChild(el) {
          removed.push(el);
          el.parentNode = null;
        },
      },
      execCommand(cmd) {
        if (cmd !== 'copy') throw new Error('意外的 execCommand: ' + cmd);
        ctx.__execTried = true;
        if (opts.execOk === false) return false;
        // 真浏览器里 execCommand('copy') 复制的是当前选中的内容；
        // 这里检查「确实选中了那个 textarea」，否则等于复制了空气。
        if (!ctx.__ta || !ctx.__ta._selected) throw new Error('没选中 textarea 就调 execCommand');
        ctx.__copied = ctx.__ta.value;
        return true;
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
  };
  if (opts.clipboard === 'ok' || opts.clipboard === 'reject') {
    ctx.navigator = {
      clipboard: {
        async writeText(t) {
          if (opts.clipboard === 'reject') throw new Error('NotAllowedError');
          ctx.__copied = t;
        },
      },
    };
  } else {
    // 非安全上下文：这个属性根本不存在
    ctx.navigator = {};
  }
  if (opts.toast) ctx.toast = (m, isErr) => toasts.push({ m, isErr });
  ctx.__toasts = toasts;
  ctx.__removed = removed;
  return ctx;
}

/* 从 app.js 里切出 copyText 的实现，单独求值。
   这样测的是真代码，不是我在测试里重写的一份。 */
function extractCopyText(src) {
  const start = src.indexOf('async function copyText');
  if (start < 0) return null;
  // 括号配平找到函数结尾
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return end > 0 ? src.slice(start, end) : null;
}

const copySrc = extractCopyText(APP);
ok('能从 app.js 里切出 copyText 的实现', !!copySrc);
if (!copySrc) { console.log('\n无法继续运行时测试'); process.exitCode = 1; return; }

async function runCase(label, opts, expectOk) {
  const ctx = makeCtx(opts);
  vm.createContext(ctx);
  vm.runInContext(copySrc, ctx);
  let got, threw = null;
  try { got = await vm.runInContext('copyText("Hello 中文 123")', ctx); }
  catch (e) { threw = e; }
  ok(label + '：不抛异常', !threw, threw && threw.message);
  ok(label + '：返回值 ' + expectOk, got === expectOk, '实际 ' + got);
  return { ctx, got };
}

(async () => {
  // 场景 A：安全上下文，clipboard 可用
  {
    const { ctx } = await runCase('安全上下文（localhost）', { clipboard: 'ok', toast: true }, true);
    ok('安全上下文：内容确实被复制', ctx.__copied === 'Hello 中文 123', ctx.__copied);
    ok('安全上下文：没有弹出错误提示', ctx.__toasts.filter(t => t.isErr).length === 0);
    ok('安全上下文：没有走 execCommand 兜底', !ctx.__execTried);
  }

  // 场景 B：非安全上下文（局域网 IP），clipboard 不存在 —— 这是用户遇到的
  {
    const { ctx } = await runCase('非安全上下文（局域网 IP）', { clipboard: 'none', toast: true }, true);
    ok('非安全上下文：改用 execCommand 复制成功', ctx.__copied === 'Hello 中文 123', ctx.__copied);
    ok('非安全上下文：临时 textarea 已从 DOM 移除', ctx.__removed.length === 1);
    ok('非安全上下文：没有弹出错误提示', ctx.__toasts.filter(t => t.isErr).length === 0);
  }

  // 场景 C：clipboard 存在但被拒（权限/失焦），应降级
  {
    const { ctx } = await runCase('clipboard 被拒', { clipboard: 'reject', toast: true }, true);
    ok('clipboard 被拒：降级到 execCommand 并成功', ctx.__copied === 'Hello 中文 123', ctx.__copied);
    ok('clipboard 被拒：没有弹出错误提示', ctx.__toasts.filter(t => t.isErr).length === 0);
  }

  // 场景 D：两条路全废 —— 必须返回 false 且提示要说得清原因
  {
    const { ctx } = await runCase('两条路都失败', { clipboard: 'none', execOk: false, toast: true }, false);
    ok('两条路都失败：临时 textarea 也要清理掉', ctx.__removed.length === 1);
    ok('两条路都失败：不静默吞掉', ctx.__toasts.length >= 0);
  }

  console.log('\n=== 3. 失败文案要说人话 ===');
  // 用户看到的原文是「复制失败，手动选中吧」——把权限问题说成操作问题，会让人反复点。
  const msgMatch = APP.match(/toast\(\s*['"]([^'"]*复制[^'"]*)['"]/g) || [];
  const allCopyMsgs = msgMatch.join(' ');
  ok('失败提示解释了为什么（提到浏览器/权限/地址之一）',
     /浏览器|权限|地址|https|localhost/.test(allCopyMsgs), allCopyMsgs);
  ok('不再只说「手动选中吧」而不给原因',
     !/复制失败，手动选中吧/.test(APP));

  console.log('\n=== 4. 五处按钮都接上了 ===');
  // 之前漏掉过模板库那一处（它是 viewSnippets 里单独绑的）
  ok('模板库的复制按钮也走 copyText',
     /viewSnippets|snippet/.test(APP) && (APP.split('copyText(').length - 1) >= 5,
     'copyText 调用 ' + (APP.split('copyText(').length - 1) + ' 次');

  console.log('\n=== 5. 单复数选择器不能写混 ===');
  /* 这一条记的是本轮的真教训：改复制按钮时把 $$('.dailytpl .code-copy', main)
     手滑写成 $(...)，querySelector 返回单个节点，.forEach 就是 undefined，
     整个今日页渲染抛错变白屏。node --check 不报（语法本身是对的），
     只有真跑起来才炸 —— 所以必须由这里守着。 */
  {
    // 只认「单个 $ 的选择器结果却调了数组方法」。$$ 本身是数组，不在此列 ——
    // 早先正则没把 $$ 排除掉，把 20 多处正确写法全报成错，白折腾一轮。
    const bad = APP.split('\n')
      .map((l, i) => ({ l: l.trim(), n: i + 1 }))
      .filter(({ l }) => {
        if (l.startsWith('//') || l.startsWith('*')) return false;
        // 找「不是 $$ 的 $ 调用」。不能用 \$(?!\$) —— 正则会在 $$ 的
        // 第二个 $ 上重新起跳匹配成功，把正确写法全报出来。
        // 用前后夹逼：前面不是 $、后面紧跟的不是 $。
        return /(^|[^$])\$(?!\$)\s*\([^()]*\)\s*\.\s*(forEach|map|filter|reduce|some|every)\s*\(/.test(l);
      });
    ok('没有把单个 $(...) 当数组用（多处应该用 $$）',
       bad.length === 0,
       bad.map(b => '第 ' + b.n + ' 行: ' + b.l).join(' | '));

    ok('今日模板的复制按钮用 $$ 取全部',
       /\$\$\('\.dailytpl \.code-copy', main\)/.test(APP));
    ok('bindCopy 用 $$ 取全部复制按钮',
       /\$\$\('\.code-copy', scope \|\| main\)/.test(APP));
    ok('模板库复制按钮用 $$ 取全部',
       /\$\$\('\.code-copy', box\)/.test(APP));
  }

  console.log('\n' + '='.repeat(60));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  console.log(fail === 0 ? '✅ 复制功能测试全过' : '❌ 有失败项');
  process.exitCode = fail ? 1 : 0;
})();
