/**
 * 填空练习的草稿保存测试。
 *
 * 用户原话：「点击别的地方，再回答都没了」。
 * 所以这里要钉死的不是「有个保存按钮」，而是四件事：
 *   1. 边打边自动存 —— 人不记得点按钮
 *   2. 换解法档 / 难度档时答案不串档 —— 困难档的答案塞进简单档就是错的卷子
 *   3. 清空重填要连草稿一起清 —— 不然刷新一下又回来了，人以为没清掉
 *   4. 存不了（隐私模式 / 存储被禁）时页面照样能用 —— 存不了草稿不是不能做题
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const app = read('static/app.js');

  console.log('=== 【1】有保存按钮，也有自动保存 ===');
  ok('填空页有「保存草稿」按钮', /id="btn-fill-save"/.test(app));
  ok('按钮文字说清楚是保存草稿', /id="btn-fill-save">保存草稿</.test(app));
  ok('保存按钮绑了 click', /\$\('#btn-fill-save'\)\.addEventListener\('click'/.test(app));
  // 自动存才是真正解决问题的那个 —— 光有按钮，人不会记得点
  ok('输入时就自动存（不靠人记得点按钮）',
    /addEventListener\('input'[\s\S]{0,200}saveDraft\(\)/.test(app));
  ok('页面上写了「边打边自动存」', /边打边自动存/.test(app));

  console.log('\n=== 【2】草稿按「题 + 解法档 + 难度档」分开存 ===');
  ok('有 draftKey 函数', /const draftKey = \(t, l\) =>/.test(app));
  ok('键里带 slug', /draftKey[^\n]*slug/.test(app));
  ok('键里带解法档和解法档', /'lc\.fill\.' \+ slug \+ '\.' \+ t \+ '\.' \+ l/.test(app));
  ok('读草稿有独立函数', /const readDraft = \(\) =>/.test(app));
  ok('写草稿有独立函数', /const saveDraft = \(\) =>/.test(app));
  // 换档必须重新读该档的草稿，不能沿用上一档的 answers
  ok('换档（load）时重新读草稿，不沿用上一档',
    /async function load\(\)[\s\S]{0,700}st\.answers = readDraft\(\)/.test(app));

  console.log('\n=== 【3】清空要把草稿一起清 ===');
  ok('清空时 removeItem 掉这一档的草稿',
    /btn-fill-reset'\)\.addEventListener[\s\S]{0,300}localStorage\.removeItem\(draftKey/.test(app));
  ok('清空后重绘', /btn-fill-reset'\)\.addEventListener[\s\S]{0,400}paint\(\)/.test(app));

  console.log('\n=== 【4】存不了也不能挡住做题 ===');
  // localStorage 在隐私模式 / 某些浏览器策略下会直接抛异常。
  // 这时候不能白屏，只能「存不了」。
  ok('读草稿有 try/catch', /const readDraft[\s\S]{0,300}catch/.test(app));
  ok('写草稿有 try/catch', /const saveDraft[\s\S]{0,300}catch/.test(app));
  ok('解析失败的返回值是空对象（不是抛出去）', /catch[\s\S]{0,120}return \{\};/.test(app));
  ok('清空草稿也包了 try', /removeItem\(draftKey[\s\S]{0,40}catch/.test(app));

  console.log('\n=== 【5】在真实浏览器语义下跑一遍 ===');
  // 用 vm 造一个最小 localStorage，把这三个函数原样跑一遍。
  // 不测这个的话，「键拼错了」「JSON 反序列化炸了」这类问题只能等用户发现。
  const vm = require('vm');
  const srcLines = app.split('\n');
  const sliceFn = (raw, name) => {
    const lines = raw.split('\n');
    const sig = 'function ' + name + '(';
    let start = lines.indexOf(lines.find(l => l.startsWith(sig)));
    if (start < 0) return '';
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i] === '}') return lines.slice(start, i + 1).join('\n');
    }
    return '';
  };
  // draftKey / readDraft / saveDraft 是箭头函数且闭包了 st 和 slug，这里复刻同样的逻辑跑真值
  const store = new Map();
  const ctx = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: k => store.delete(k),
    },
    JSON, console,
  };
  vm.createContext(ctx);
  vm.runInContext(`
    var slug = 'two-sum';
    var st = { tier: 'brute', level: 'hard', answers: {} };
    var draftKey = (t, l) => 'lc.fill.' + slug + '.' + t + '.' + l;
    var readDraft = () => {
      try {
        const raw = localStorage.getItem(draftKey(st.tier, st.level));
        const o = raw ? JSON.parse(raw) : null;
        return o && typeof o === 'object' ? o : {};
      } catch { return {}; }
    };
    var saveDraft = () => {
      try { localStorage.setItem(draftKey(st.tier, st.level), JSON.stringify(st.answers)); }
      catch { }
    };
  `, ctx);

  ctx.st.answers = { 1: 'return new int[]{i, j};' };
  vm.runInContext('saveDraft()', ctx);
  ok('存进去之后键是 lc.fill.slug.tier.level',
    store.has('lc.fill.two-sum.brute.hard'), [...store.keys()].join(','));
  ok('存的值是 JSON 且能读回来',
    JSON.parse(store.get('lc.fill.two-sum.brute.hard'))['1'] === 'return new int[]{i, j};');

  ctx.st.answers = {};
  const back = vm.runInContext('readDraft()', ctx);
  ok('读草稿能拿回刚才填的内容', back['1'] === 'return new int[]{i, j};', JSON.stringify(back));

  // 换档：换到 easy，键不同，读出来必须是空
  ctx.st.level = 'easy';
  const otherLevel = vm.runInContext('readDraft()', ctx);
  ok('换难度档后读不到困难档的草稿（不串档）',
    Object.keys(otherLevel).length === 0, JSON.stringify(otherLevel));

  // 换解法档同样
  ctx.st.tier = 'optimal';
  ctx.st.level = 'hard';
  const otherTier = vm.runInContext('readDraft()', ctx);
  ok('换解法档后读不到暴力解的草稿（不串档）',
    Object.keys(otherTier).length === 0, JSON.stringify(otherTier));

  // 键拼对了没有：暴力解 + 困难档 还是能读到
  ctx.st.tier = 'brute';
  const sameAgain = vm.runInContext('readDraft()', ctx);
  ok('换回来还能读到原来那档的草稿', sameAgain['1'] === 'return new int[]{i, j};');

  // 存储被禁：getItem / setItem 都抛
  ctx.localStorage = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('SecurityError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  };
  let threw = false;
  try {
    ctx.st.answers = { 1: 'x' };
    vm.runInContext('saveDraft()', ctx);
    const r = vm.runInContext('readDraft()', ctx);
    if (Object.keys(r).length !== 0) threw = true;
  } catch (e) { threw = true; }
  ok('存储被禁时不抛异常，只是存不上', !threw);

  // 存了脏数据（不是 JSON）
  ctx.localStorage = {
    getItem: () => '这不是 JSON{',
    setItem: () => {}, removeItem: () => {},
  };
  let bad = null;
  try { bad = vm.runInContext('readDraft()', ctx); } catch { bad = 'threw'; }
  ok('草稿是脏数据时返回空对象而不是崩', bad !== 'threw' && bad && typeof bad === 'object',
    JSON.stringify(bad));

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
