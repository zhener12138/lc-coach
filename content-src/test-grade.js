/* 「我的代码 + 评分」的点击链路测试。
 *
 * 验证的是真正跑起来的 app.js（Node vm + DOM stub），不是另写一份逻辑：
 *   ① 题目页真的渲染出代码输入区和参考分数条
 *   ② 点「评分」真的打到后端 /grade，并把六维度结果渲染出来
 *   ③ 实测/推断标签正确（编译必须标「实测」，其余标「推断」）
 *   ④ 空代码点评分会拦住，不发请求
 *   ⑤ 评分结果落库，重新进题目页能看到 myCode / myScore
 *   ⑥ 后端给的三解法评分有区分度（brute < optimal），不是三份同分
 *
 * 浏览器在本沙箱起不来（Chromium crashpad OpenProcess 拒绝访问），只能这么做。
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'static');
const LOCK_SRC = fs.readFileSync(path.join(ROOT, 'lock.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const BASE = 'http://127.0.0.1:8099';

const store = new Map();
const sessionStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

function mkEl(tag, id) {
  const box = { html: '' };
  const el = {
    tagName: tag, id: id || '', textContent: '', value: '', disabled: false,
    dataset: {}, _l: {}, _c: new Set(), style: {},
    classList: {
      add: c => el._c.add(c), remove: c => el._c.delete(c), contains: c => el._c.has(c),
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
    closest() { return null; },
    appendChild() {},
    contains() { return true; },
    offsetWidth: 1,
    get firstElementChild() { return null; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return box.html; },
    set(v) { box.html = String(v); }
  });
  return el;
}

const byIdCache = new Map();
function byId(id) {
  if (!byIdCache.has(id)) byIdCache.set(id, mkEl('div', id));
  return byIdCache.get(id);
}

const VIEWS = ['today', 'library', 'mistakes', 'snippets', 'plan', 'account', 'notify'];
const navItems = VIEWS.map(v => { const e = mkEl('button'); e.dataset.view = v; return e; });

const mainEl = byId('main');
mainEl.querySelector = (sel) => (sel && sel[0] === '#' ? byId(sel.slice(1)) : null);
mainEl.contains = () => true;

const document = {
  querySelector(sel) { return sel && sel[0] === '#' ? byId(sel.slice(1)) : null; },
  querySelectorAll(sel) { return sel === '.nav-item' ? navItems : []; }
};

let hash = '#/today';
const winL = {};
const location = {
  get hash() { return hash; },
  set hash(v) {
    const ch = hash !== v; hash = v;
    if (ch) (winL['hashchange'] || []).forEach(f => f());
  }
};

const toasts = [];
const ctx = vm.createContext({
  setTimeout, clearTimeout, console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, Promise,
  navigator: { clipboard: { writeText: async () => { } } },
  confirm: () => true, alert: () => { },
  fetch: (input, init) => fetch(String(input).startsWith('http') ? input : BASE + input, init)
});
ctx.document = document;
ctx.sessionStorage = sessionStorage;
ctx.localStorage = sessionStorage;
ctx.location = location;
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;
ctx.addEventListener = (t, f) => { (winL[t] = winL[t] || []).push(f); };
ctx.removeEventListener = () => { };

vm.runInContext(LOCK_SRC, ctx, { filename: 'lock.js' });
vm.runInContext(APP_SRC, ctx, { filename: 'app.js' });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  \u2705 ' + m)) : (fail++, console.log('  \u274C ' + m)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const GOOD_CODE = `class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int need = target - nums[i];
            if (map.containsKey(need)) {
                return new int[]{map.get(need), i};
            }
            map.put(nums[i], i);
        }
        return new int[]{};
    }
}`;

(async () => {
  await sleep(900);

  console.log('\n=== 1. 题目页是否渲染出「我的代码」区 ===');
  sessionStorage.clear();
  location.hash = '#/problem/two-sum';
  await sleep(900);

  const page = mainEl.innerHTML;
  ok(page.includes('我的代码'), '有「我的代码」标题');
  ok(page.includes('id="my-code"'), '有代码输入框 #my-code');
  ok(page.includes('id="btn-grade"'), '有评分按钮 #btn-grade');
  // 顶部那条汇总分数条已按用户要求删掉，分数只在每个解法卡内部出现
  ok(!page.includes('参考解法得分'), '顶部参考分数条已移除');
  ok(!page.includes('class="ref-score-row"'), '分数条 DOM 已彻底不渲染');
  ok(page.includes('class="lock-card"'), '解法默认仍锁着（渲染锁屏卡）');
  ok(!page.includes('class="ref-grade"'), '锁着时不渲染评分（分数也不该泄出来）');

  // 解锁第一个解法，卡内评分块必须出现
  sessionStorage.setItem('lc.sol.unlocked', JSON.stringify({ 'two-sum': [0] }));
  location.hash = '#/today';
  await sleep(500);
  location.hash = '#/problem/two-sum';
  await sleep(900);
  const unlockedPage = mainEl.innerHTML;
  ok(unlockedPage.includes('class="ref-grade"'), '解锁后解法卡内出现评分块');
  ok(unlockedPage.includes('这个解法的评分'), '卡内评分有标题');
  // 2026-11-03 接了真跑判题后从 6 项变 7 项（新增 correctness）。
  // 但设计类题目（LRU、最小栈等）判不了，correctness 会被剔除，那时仍是 6 项。
  // 所以断言「6 或 7」而不是写死数字 —— 写死数字的测试会给未来的自己埋雷。
  const rgdCount = (unlockedPage.match(/class="rgd-row"/g) || []).length;
  ok(rgdCount === 6 || rgdCount === 7,
    '卡内评分维度数 6 或 7（能判题=7，判不了=6，实际 ' + rgdCount + '）');
  ok(unlockedPage.includes('class="tab-score'), 'tab 上有分数角标');

  console.log('\n=== 2. 空代码点评分应被拦住 ===');
  const gradeOut = byId('grade-out');
  byId('my-code').value = '   ';
  const btnGrade = byId('btn-grade');
  ok(Array.isArray(btnGrade._l.click) && btnGrade._l.click.length >= 1,
     '评分按钮绑定了 click（实际 ' + (btnGrade._l.click || []).length + ' 个）');
  // 注：这里断言 >=1 而不是 ==1。测试 stub 的 byId 是单例缓存，给 innerHTML 重新赋值
  // 不会像真浏览器那样销毁旧节点，所以本段前面反复进出题目页会让计数累加。
  // 真实浏览器每次 innerHTML 都重建节点，永远是 1 个。

  // 记录此刻 grade-out 的内容，点完应该没变（被拦在发请求前）
  const beforeEmpty = gradeOut.innerHTML;
  await btnGrade._l.click[0]();
  await sleep(200);
  ok(gradeOut.innerHTML === beforeEmpty, '空代码不发请求、不渲染评分（被拦住）');

  console.log('\n=== 3. 真实评分一次 ===');
  byId('my-code').value = GOOD_CODE;
  await btnGrade._l.click[0]();
  await sleep(1200);

  const out = gradeOut.innerHTML;
  ok(out.includes('grade-card'), '渲染出评分卡');
  ok(out.includes('grade-total-num'), '有总分数字');
  ok(out.includes('编译通过'), '有「编译通过」维度');
  ok(out.includes('时间复杂度'), '有「时间复杂度」维度');
  ok(out.includes('空间复杂度'), '有「空间复杂度」维度');
  ok(out.includes('边界处理'), '有「边界处理」维度');
  ok(out.includes('代码规范'), '有「代码规范」维度');
  ok(out.includes('思路匹配'), '有「思路匹配」维度');
  // 同上：6 或 7 项，判题成功时多一项「正确性（真跑）」。
  const dimCount = (out.match(/class="grade-dim"/g) || []).length;
  ok(dimCount === 6 || dimCount === 7, '维度全部渲染（6 或 7 项，实际 ' + dimCount + '）');
  ok(out.includes('正确性（真跑）') || out.includes('判不了'), '正确性维度在，或明确说明了判不了');

  console.log('\n=== 4. 实测 / 推断 必须分清 ===');
  // 2026-11-03 起接入了真跑判题：正确性不再靠猜，是 javac + 真执行官方示例用例比出来的。
  // 原来这条断言查的是「没有测试用例，所以不判答案对不对」那句免责声明 —— 那句话现在不成立了，
  // 断言跟着改：必须说清哪些是实测、哪些是推断，这才是免责声明该干的事。
  // 维度数量也变了：能判题的题是 7 项（compile + correctness + 5 项推断），
  // 判不了的题是 6 项（correctness 被剔除）。这里断言「推断的那些仍然是 5 个」。
  ok(out.includes('vtag real') && out.includes('实测'), '有「实测」标签');
  ok((out.match(/vtag guess/g) || []).length === 5, '推断维度恰好 5 个（正确性已升为实测）');
  ok(out.includes('真跑官方示例用例') || out.includes('真跑'), '声明了正确性是真跑的');
  ok(!out.includes('没有测试用例'), '不再声称「没有测试用例」');

  console.log('\n=== 5. 分数落库，重进能看到 ===');
  byId('my-code').value = '';   // 清空本地输入，必须要从后端拿回来
  location.hash = '#/today';
  await sleep(400);
  location.hash = '#/problem/two-sum';
  await sleep(1000);
  const page2 = mainEl.innerHTML;
  ok(page2.includes('twoSum'), '重进后输入框里恢复了上次的代码');
  ok(/上次\s*[\d.]+\s*分/.test(page2), '显示了上次的分数');

  console.log('\n=== 6. 后端三解法评分要有区分度 ===');
  const detail = await (await fetch(BASE + '/api/problem/two-sum')).json();
  const rg = detail.refGrades || {};
  ok(rg.brute && rg.better && rg.optimal, '三解法都有评分');
  ok(rg.brute.total < rg.optimal.total,
    '暴力分低于最优分（' + rg.brute.total + ' < ' + rg.optimal.total + '）');
  const bC = rg.brute.dimensions.find(d => d.key === 'complexity');
  const oC = rg.optimal.dimensions.find(d => d.key === 'complexity');
  ok(bC.score < oC.score, '暴力时间复杂度分低于最优（' + bC.score + ' < ' + oC.score + '）');
  ok(bC.evidence.some(e => /循环嵌套|递归/.test(e)), '复杂度维度给出了判断依据');

  console.log('\n=== 7. 编译失败必须压到 4 分以下 ===');
  const bad = await (await fetch(BASE + '/api/problem/two-sum/grade', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'class Solution { public int[] twoSum(int[] a, int t) { return a } }' })
  })).json();
  ok(bad.ok === true, '坏代码也返回了评分（不报错）');
  ok(bad.compiled === false, 'compiled=false');
  ok(bad.total < 4, '总分被压到 4 分以下（' + bad.total + '）');
  ok((bad.compileErrors || []).length > 0, '给出了真实编译报错');

  console.log('\n=== 8. 方法名不对必须封顶 5.5 ===');
  const wrong = await (await fetch(BASE + '/api/problem/two-sum/grade', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'class Solution { public int solve(int[] a) { return 0; } }' })
  })).json();
  ok(wrong.compiled === true, '能编译');
  ok(wrong.signatureOk === false, '签名对不上');
  ok(wrong.total <= 5.5, '总分封顶 5.5（' + wrong.total + '）');
  ok(wrong.dimensions[0].reason.includes('twoSum'), '报错里点名了期望的方法名');

  console.log('\n=== 9. 不变量：参考最优解必须满分（这是尺子的零点） ===');
  // 为什么这条必须钉死：标着「最优解」的代码自己拿 9.1 分，用户写出 9.5 分就意味着
  // 「我比最优解还强」—— 评分器在撒谎。这个不变量一旦退化，前面所有分数的意义都没了。
  const all = await (await fetch(BASE + '/api/problems')).json();
  const bad0 = [];
  let checked = 0;
  for (const it of all) {
    const d = await (await fetch(BASE + '/api/problem/' + encodeURIComponent(it.slug))).json();
    const o = d.refGrades && d.refGrades.optimal;
    if (!o || typeof o.total !== 'number') { bad0.push(it.slug + '(无评分)'); continue; }
    checked++;
    // 允许 1e-9 的浮点误差，不允许任何实质扣分
    if (o.total < 9.95) bad0.push(it.slug + '=' + o.total);
  }
  ok(checked >= 100, '检查了足够多的题（' + checked + ' / ' + all.length + '）');
  ok(bad0.length === 0,
    '全部 ' + checked + ' 题的参考最优解都是 10 分'
    + (bad0.length ? '；未满分：' + bad0.slice(0, 8).join('、') + (bad0.length > 8 ? ' 等 ' + bad0.length + ' 题' : '') : ''));

  // 慢写法不能反超最优解 —— 这是用户最容易一眼看穿的地方
  const zero = await (await fetch(BASE + '/api/problem/move-zeroes/grade', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'class Solution {\n'
        + '    public void moveZeroes(int[] nums) {\n'
        + '        int[] res = new int[nums.length];\n'
        + '        int j = 0;\n'
        + '        for (int i = 0; i < nums.length; i++) { if (nums[i] != 0) res[j++] = nums[i]; }\n'
        + '        for (int i = 0; i < nums.length; i++) { nums[i] = res[i]; }\n'
        + '    }\n'
        + '}'
    })
  })).json();
  const mz = await (await fetch(BASE + '/api/problem/move-zeroes')).json();
  ok(zero.compiled === true, '移动零的「另开数组」写法能编译');
  ok(zero.total < mz.refGrades.optimal.total,
    '另开数组写法低于最优解（' + zero.total + ' < ' + mz.refGrades.optimal.total + '）');
  ok(zero.total < mz.refGrades.better.total,
    '也低于中间解法（' + zero.total + ' < ' + mz.refGrades.better.total + '）');

  console.log('\n=== 10. 不变量：三解法分数必须单调（尺子不能把已核实的顺序量反） ===');
  // 复述一遍为什么要有这条：复杂度声明顺序已独立核过，所以「brute 慢于 better」是
  // 被验证为真的偏序。分数必须服从它，否则就是尺子的问题。
  const notMono = [];
  const noGrade = [];
  let monoChecked = 0;
  for (const it of all) {
    const d = await (await fetch(BASE + '/api/problem/' + encodeURIComponent(it.slug))).json();
    const g = d.refGrades || {};
    const r = g.brute, b = g.better, o = g.optimal;
    if (!r || !b || !o) { noGrade.push(it.slug); continue; }
    monoChecked++;
    if (!(r.total <= b.total + 1e-9 && b.total <= o.total + 1e-9)) {
      notMono.push(it.slug + ' ' + r.total + '/' + b.total + '/' + o.total);
    }
  }
  ok(monoChecked >= 100, '检查了足够多的三解法组合（' + monoChecked + ' / ' + all.length + '）');
  ok(notMono.length === 0,
    '三解法分数单调，没有「更慢的解法分数更高」'
    + (notMono.length ? '；倒挂：' + notMono.slice(0, 6).join('、') + (notMono.length > 6 ? ' 等 ' + notMono.length + ' 题' : '') : ''));

  // 语义层：声明复杂度不能倒挂（分数单调可能是凑的，声明单调是内容层的事实）
  // 只抽「恰好一个 O(...)」的声明 —— 多段声明（设计类题）本来就没有单一复杂度，
  // 强行比大小只会制造假阳性。这不是放过问题，是承认这一类比不了。
  const singleRank = txt => {
    if (!txt) return -1;
    const raw = String(txt);
    if (raw.indexOf('指数') >= 0 || raw.indexOf('阶乘') >= 0) return 12;
    const all = raw.match(/O\([^)]*\)/gi) || [];
    if (all.length !== 1) return -1;                    // 多段 / 没有 → 不比
    const inner = all[0].slice(2, -1);
    if (!/[0-9a-z√]/i.test(inner)) return -1;           // O(总字符数) 这类中文叙述 → 不比
    let t = inner.toLowerCase().replace(/\s/g, '');
    t = t.replace(/sqrt/g, '\u0002').replace(/log/g, '\u0001');
    t = t.replace(/[a-z]/g, 'n').replace(/\u0002/g, 'sqrt').replace(/\u0001/g, 'log');
    if (/n!/.test(t) || /\d\^/.test(t)) return 12;
    // O(1) 是常数阶；O(32) 这种是「有界循环次数」，不是增长阶，与 O(log n) 不可比
    if (/^1$/.test(t)) return 0;
    if (/^\d+$/.test(t)) return -1;
    let deg = 0, log = 0;
    t = t.replace(/nloglogn/g, 'n·loglogn').replace(/n\^2logn/g, 'n^2·logn')
         .replace(/nlogn/g, 'n·logn').replace(/n√n/g, 'n·√n')
         .replace(/[()]/g, '');
    let worst = -1;
    for (const one of t.split('+')) {
      deg = 0; log = 0;
      for (const piece of one.split(/[·*×]/)) {
        const p = piece.trim();
        if (!p || p === '1') continue;
        if (p === 'logn') log = Math.max(log, 2);
        else if (p === 'loglogn') log = Math.max(log, 1);
        else if (p === '√n' || p === 'sqrtn') deg += 0.5;
        else if (p === 'n') deg += 1;
        else if (p === 'n^2' || p === 'n²') deg += 2;
        else if (p === 'n^3' || p === 'n³') deg += 3;
        else return -1;                                  // 不认识 → 不比，不猜
      }
      let r;
      if (deg === 0) r = log >= 2 ? 3 : (log === 1 ? 2 : 0);
      else if (deg === 0.5) r = 5;
      else if (deg === 1) r = log >= 2 ? 9 : (log === 1 ? 8 : 7);
      else if (deg === 1.5) r = 8;
      else if (deg === 2) r = log >= 2 ? 11 : 10;
      else r = log >= 2 ? 12 : 11;
      worst = Math.max(worst, r);
    }
    return worst;
  };
  const declBad = [];
  let declChecked = 0;
  for (const it of all) {
    const d = await (await fetch(BASE + '/api/problem/' + encodeURIComponent(it.slug))).json();
    const by = {};
    (d.solutions || []).forEach(sv => { by[sv.tier] = sv; });
    if (!by.brute || !by.better) continue;
    const rb = singleRank(by.brute.timeComplexity), rB = singleRank(by.better.timeComplexity);
    if (rb < 0 || rB < 0) continue;          // 多段 / 叙述型声明：这一题不比
    declChecked++;
    if (rb < rB) declBad.push(it.slug + ' brute=' + by.brute.timeComplexity + ' better=' + by.better.timeComplexity);
  }
  ok(declChecked >= 80, '声明复杂度可比的题数足够（' + declChecked + ' 题）');
  ok(declBad.length === 0,
    '声明复杂度没有倒挂（brute 不优于 better）'
    + (declBad.length ? '；倒挂：' + declBad.slice(0, 6).join('、') : ''));

  // 慢写法不能反超的样例（用户第一眼就看这个）
  ok(mz.refGrades.optimal.total >= mz.refGrades.better.total,
    '移动零：optimal 不低于 better（' + mz.refGrades.optimal.total + ' >= ' + mz.refGrades.better.total + '）');

  console.log('\n' + '='.repeat(50));
  console.log(fail === 0 ? '全部通过  ' + pass + ' / ' + pass : pass + ' 过 / ' + fail + ' 挂');
  process.exit(fail === 0 ? 0 : 1);
})();
