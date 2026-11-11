// 复习判题的测试（P0-3）。
// 这条功能补的是最大的一个洞：复习时重写一遍代码，写完不判对错 —— 等于白写。
// 三类断言：
//   1. 后端真的判了、真的存了，而且没碰 my_code
//   2. 前端只回答「这次比上次好还是差」，不铺开七个维度
//   3. 边界：第一次复习没有对比基准、判不了题的科目、编译不过
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'static', 'app.css'), 'utf8');
const API_CTRL = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com', 'lc', 'api', 'ApiController.java'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com', 'lc', 'service', 'Db.java'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');

const API = process.env.LC_API || 'http://127.0.0.1:8099';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  →  ' + extra : '')); }
}

// ---------- 把 renderReviewGrade 从 app.js 里切出来在 vm 里跑真值 ----------
function sliceFn(name, nextName) {
  const s = APP.indexOf('function ' + name + '(');
  if (s < 0) return '';
  const e = APP.indexOf('\nfunction ' + nextName + '(', s);
  return APP.slice(s, e < 0 ? APP.length : e);
}
const GRADE_SRC = sliceFn('renderReviewGrade', 'renderRcHist');
const escSrc = `
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
`;
function runGrade(g, prev) {
  const ctx = { console, esc: (s) => String(s == null ? '' : s) };
  vm.createContext(ctx);
  vm.runInContext(escSrc + GRADE_SRC + '\nthis.__r = renderReviewGrade;', ctx);
  return ctx.__r(g, prev);
}

console.log('\n【1】后端：真的判了、真的存了，且没碰 my_code');
ok('有复习判题接口', /@PostMapping\("\/mistakes\/\{id\}\/review-cards\/grade"\)/.test(API_CTRL));
ok('接口里真调了评分器', /grader\.gradeUser\(slug, code\)/.test(API_CTRL));
ok('判完立刻存卡（不让用户再点一次保存）', /db\.addReviewCard\(id, slug, code, json, total\)/.test(API_CTRL));
ok('接口只写 review_card，不写 my_code 注释写明红线',
  /绝不碰 my_code/.test(API_CTRL));
// gradeReviewCard 方法体里不该出现 saveMyCode
const gradeBody = API_CTRL.slice(
  API_CTRL.indexOf('public ResponseEntity<?> gradeReviewCard'),
  API_CTRL.indexOf('@DeleteMapping("/mistakes/{id}/review-cards/{cardId}")'));
ok('gradeReviewCard 方法体里没有 saveMyCode', gradeBody.length > 100 && !/saveMyCode/.test(gradeBody),
  '方法体长度 ' + gradeBody.length);
ok('空代码返回「先写点代码再检查」', /先写点代码再检查/.test(API_CTRL));
ok('错题不存在有明确文案', /这条错题已经不在了/.test(API_CTRL));
ok('没关联题库的错题不硬判', /没关联到题库里的题/.test(API_CTRL));
ok('review_card 表有 grade_json 列', /grade_json CLOB/.test(DB));
ok('review_card 表有 total_score 列', /total_score DOUBLE/.test(DB));
ok('补列前先查 INFORMATION_SCHEMA（不依赖 IF NOT EXISTS）',
  /INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_NAME = 'REVIEW_CARD'/.test(DB));
ok('补列失败不拦启动', /复习卡补列跳过/.test(DB));
ok('读卡片时 null 和 0 能区分', /rs\.wasNull\(\) \? null : ts/.test(DB));

console.log('\n【2】前端：只回答「比上次好还是差」');
ok('有 renderReviewGrade', GRADE_SRC.length > 200, '长度 ' + GRADE_SRC.length);
ok('复习页有「检查这次写得对不对」按钮', /id="btn-grade-review"/.test(APP));
ok('按钮真的发请求', /review-cards\/grade/.test(APP));
ok('拿上一次分数做对比', /const prev = rcCards\.length \? rcCards\[0\]\.totalScore : null;/.test(APP));
ok('不铺开七个维度（复习页不该再念一遍六维表）',
  !/grade-dim|dimensions/.test(GRADE_SRC));
ok('第一次复习没有基准时说清楚', /第 1 次复习/.test(GRADE_SRC));
ok('有「比上次高」', /比上次高/.test(GRADE_SRC));
ok('有「比上次低」', /比上次低/.test(GRADE_SRC));
ok('有「持平」', /持平/.test(GRADE_SRC));
ok('判题块读 judge 字段', /g\.judge/.test(GRADE_SRC));
ok('判不了题时给原因，不显示 0 / 0', /ran === false/.test(GRADE_SRC) && !/0 \/ 0/.test(GRADE_SRC));
ok('编译不过优先于分数', /compiled === false/.test(GRADE_SRC));
ok('卡片列表上带分数徽章', /rc-score/.test(APP));
ok('没判过题的卡显示「未判题」而不是 0 分', /未判题/.test(APP));
ok('保存按钮也更新了外层 rcCards（否则下次对比拿旧数据）',
  /rcCards = fresh\.cards \|\| \[\]/.test(APP));

console.log('\n【3】renderReviewGrade 的真实输出');
const good = { ok: true, total: 8.7, compiled: true, judge: { ran: true, total: 3, passed: 3, failures: [] } };
let h = runGrade(good, null);
ok('第一次复习：显示基准', h.includes('第 1 次复习'), h.slice(0, 200));
ok('第一次复习：不出「比上次」', !h.includes('比上次'));

h = runGrade(good, 7.0);
ok('涨分：比上次高', h.includes('比上次高'), h.slice(0, 200));
ok('涨分：给出涨幅 1.7', h.includes('1.7'), h.slice(0, 260));
ok('涨分：带上上次的分数', h.includes('7.0'), h.slice(0, 260));

h = runGrade({ ok: true, total: 6.0, compiled: true, judge: { ran: true, total: 3, passed: 2, failures: [] } }, 8.0);
ok('跌分：比上次低', h.includes('比上次低'));
ok('跌分：给出跌幅 2.0', h.includes('2.0'), h.slice(0, 260));

h = runGrade({ ok: true, total: 8.0, compiled: true, judge: { ran: true, total: 3, passed: 3, failures: [] } }, 8.0);
ok('同分：持平', h.includes('持平'));

h = runGrade({ ok: true, total: 9.0, compiled: true,
  judge: { ran: true, total: 3, passed: 2, failures: [
    { index: 2, input: '[3,2,4], 6', expected: '[1,2]', got: '[0,1]' }] } }, null);
ok('有用例没过：显示 passed / total', h.includes('2') && h.includes('3'));
ok('有用例没过：列出输入', h.includes('[3,2,4], 6'), h.slice(0, 400));
ok('有用例没过：列出期望和实际', h.includes('[1,2]') && h.includes('[0,1]'));

h = runGrade({ ok: true, total: 10, compiled: true,
  judge: { ran: false, reason: '这题答案不唯一，机器没法判' } }, null);
ok('判不了：说明原因', h.includes('机器没法判'), h.slice(0, 300));
ok('判不了：不出「0 / 0」', !h.includes('0 / 0'));

h = runGrade({ ok: true, total: 3.9, compiled: false, compileErrors: ['第 6 行：非法的表达式开始'],
  judge: { ran: false } }, null);
ok('编译不过：先修语法', h.includes('语法') || h.includes('编译'), h.slice(0, 300));
ok('编译不过：带上具体报错', h.includes('非法的表达式开始'));

console.log('\n【4】CSS 与版本参数');
ok('有 .rc-score', /\.rc-score\s*\{/.test(CSS));
ok('有 .rc-noscore', /\.rc-noscore\s*\{/.test(CSS));
ok('有 .rg-box', /\.rg-box\s*\{/.test(CSS));
ok('有 .rg-delta', /\.rg-delta\s*\{/.test(CSS));
ok('有 .rg-judge', /\.rg-judge\s*\{/.test(CSS));
ok('版本参数已提到 20261111a', /\?v=20261111a/.test(HTML));

console.log('\n【5】真服务端到端（这条最能说明问题）');
(async () => {
  let online = false;
  try { const r = await fetch(API + '/api/plan/today'); online = r.ok; } catch { }
  ok('服务在跑（端到端需要它）', online, '连不上 ' + API);
  if (online) {
    const ms = await (await fetch(API + '/api/mistakes')).json();
    const m = ms.find(x => x.problemSlug && x.problemSlug !== 'null') || null;
    ok('错题本里有可判的题', !!m, '共 ' + ms.length + ' 条');
    if (m) {
      const before = (await (await fetch(API + '/api/mistakes/' + m.id + '/review-cards')).json());
      const nBefore = (before.cards || before).length;

      const r = await fetch(API + '/api/mistakes/' + m.id + '/review-cards/grade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'class Solution { public int f() { return 0; } }' })
      });
      ok('写得不对也能拿到结果（不 500）', r.status === 200 || r.status === 400,
        'HTTP ' + r.status);

      if (r.status === 200) {
        const j = await r.json();
        ok('返回里有 cardId', typeof j.cardId === 'number', JSON.stringify(j).slice(0, 160));
        ok('返回里有 count', typeof j.count === 'number');
        // 提交的是随便写的错方法，判题器可能根本认不出方法名，所以 judge 可以为空。
        // 要断言的是「不崩、有总分」，而不是「一定有判题结果」—— 后者取决于提交内容。
        ok('评分有总分', typeof j.total === 'number', 'total=' + j.total);
        ok('judge 字段要么没有、要么说实话（不出现 ran 不是布尔）',
          j.judge === undefined || typeof j.judge.ran === 'boolean', JSON.stringify(j.judge));

        const after = await (await fetch(API + '/api/mistakes/' + m.id + '/review-cards')).json();
        const list = after.cards || after;
        ok('卡片数 +1', list.length === nBefore + 1, nBefore + ' → ' + list.length);
        ok('新卡片存了分数', list[0].totalScore != null, 'totalScore=' + list[0].totalScore);
        ok('新卡片存了完整评分 JSON', !!list[0].gradeJson && list[0].gradeJson.length > 100);

        // 清掉这条测试卡，别污染用户数据
        const del = await fetch(API + '/api/mistakes/' + m.id + '/review-cards/' + list[0].id, { method: 'DELETE' });
        ok('测试卡已清理', del.status === 200 || del.status === 204, 'HTTP ' + del.status);
      }
    }
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
