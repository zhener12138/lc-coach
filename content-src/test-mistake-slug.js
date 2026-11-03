/**
 * 错题「看题」按钮的验收测试。
 *
 * 起因（用户 m04437）：错题本里「字母异位词分组」有「看题」按钮，「两数之和」没有。
 * 根因不是按钮忘加，是数据没关联 —— 那条错题是手记的，slug 选填、用户只写了题名，
 * 库里 problem_slug 是空串，前端 `m.problemSlug ? ... : ''` 就画不出按钮。
 *
 * 所以这里测三件事，缺一条就还会复发：
 *   1. 老数据自愈：slug 空的错题，后端按题名反查题库补上并写回数据库
 *   2. 新数据入库即关联：POST 时不传 slug 也能关联上
 *   3. 兜底：万一题库真没这道题，前端也得给一个「点了有用」的按钮，不是少一个
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const API = 'http://127.0.0.1:8099/api';

let pass = 0, fail = 0;
const ok = (n, c, e) => c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (e !== undefined ? '  ← ' + e : '')));

(async () => {
  const app = R('static/app.js');
  const store = R('src/main/java/com/lc/service/ProblemStore.java');
  const ctrl = R('src/main/java/com/lc/api/ApiController.java');

  console.log('\n── 1. 后端：题名反查 slug 的能力存在 ──');
  ok('ProblemStore 有 resolveSlugByTitle', /public String resolveSlugByTitle\(String rawTitle\)/.test(store));
  ok('归一化会剥掉题号前缀（1. / [1] / 1、）', /replaceFirst\("\^[^"]*\\d\+/.test(store));
  ok('比对时忽略大小写', /toLowerCase\(/.test(store));
  ok('get 也按三个字段比（中文名 / 英文名 / slug）',
     /titleCn/.test(store) && /titleEn/.test(store) && /p\.slug/.test(store));

  console.log('\n── 2. 后端：列表与入库两个入口都接上了 ──');
  ok('GET /mistakes 会补 slug', /store\.resolveSlugByTitle/.test(ctrl) && /@GetMapping\("\/mistakes"\)/.test(ctrl));
  ok('补完写回数据库（只补一次，不是每次白算）',
     /UPDATE mistake SET problem_slug = \? WHERE id = \?/.test(ctrl));
  ok('POST /mistakes 入库时就反查', /String guess = store\.resolveSlugByTitle\(title\)/.test(ctrl));
  ok('自动关联的会打标记给前端，不冒充用户填的', /slugGuessed/.test(ctrl));

  console.log('\n── 3. 前端：兜底按钮不会消失 ──');
  ok('有 slug 时是「看题」', /data-open="\$\{escAttr\(m\.problemSlug\)\}">看题/.test(app) || /data-open[\s\S]{0,40}看题/.test(app));
  ok('没 slug 时是「去题库找」，不是空串', /data-find=/.test(app) && /去题库找/.test(app));
  ok('「去题库找」绑了点击，不是死按钮', /\$\$\('\[data-find\]', box\)\.forEach/.test(app));
  ok('跳过去会带题名', /go\('#\/library\/' \+ encodeURIComponent/.test(app));
  ok('题库页接收这个参数', /async function viewLibrary\(main, prefillQ\)/.test(app));
  ok('路由把 param 传给 viewLibrary', /viewLibrary\(main, param\)/.test(app));
  ok('带题名进题库会直接搜', /if \(prefillQ\)/.test(app) && /doSearch\(\);/.test(app));
  ok('搜之前剥掉题号前缀（搜力扣时反而不好命中）',
     /\$\('#q'\)\.value = String\(prefillQ\)\.replace/.test(app));

  console.log('\n── 4. 真数据：每条错题都拿得到 slug ──');
  let list = null;
  try {
    const r = await fetch(API + '/mistakes');
    ok('GET /api/mistakes 200', r.ok, r.status);
    list = await r.json();
  } catch (e) {
    ok('GET /api/mistakes 可达', false, e.message);
  }

  // 错题本为空是合法状态（新装环境、或用户全清了）。不能因此判失败 ——
  // 那会把「没数据」误报成「功能坏了」，真出问题反倒没人信这条测试。
  // 空的时候自己造一条来验链路，跑完删掉。
  let seededMistake = null;
  if (Array.isArray(list) && list.length === 0) {
    console.log('  · 错题本是空的，临时造一条来验链路（跑完会删掉）');
    try {
      const r = await fetch(API + '/mistakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemTitle: '1. 两数之和',
          problemSlug: '',            // 故意留空，看后端能不能反查出来
          whereStuck: '__empty_seed_probe__', oneLiner: 'probe', tag: '探针'
        })
      });
      ok('空库时能造出一条测试错题', r.ok, r.status);
      const r2 = await fetch(API + '/mistakes');
      list = await r2.json();
      seededMistake = list.find(m => m.whereStuck === '__empty_seed_probe__') || null;
    } catch (e) {
      ok('空库时造测试错题', false, e.message);
    }
  }
  ok('错题本有数据可查（真实数据或临时造的）', Array.isArray(list) && list.length > 0,
     list && list.length);

  if (Array.isArray(list)) {
    const noSlug = list.filter(m => !m.problemSlug || !String(m.problemSlug).trim());
    ok('没有 slug 为空的错题了', noSlug.length === 0,
       noSlug.map(m => `id=${m.id} 标题=${m.problemTitle}`).join(' / '));

    // 每条 slug 都得能在题库里真查到题，否则「看题」点进去是空页
    for (const m of list) {
      if (!m.problemSlug) continue;
      try {
        const r = await fetch(API + '/problem/' + encodeURIComponent(m.problemSlug));
        ok(`「${m.problemTitle}」的 slug「${m.problemSlug}」在题库里查得到`, r.ok, r.status);
      } catch (e) {
        ok(`「${m.problemTitle}」的 slug 可访问`, false, e.message);
      }
    }
  }

  console.log('\n── 5. 新入库的错题也自动关联（回归）──');
  let newId = null;
  try {
    // 故意不传 slug，只给题名，模拟用户手记
    const r = await fetch(API + '/mistakes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problemTitle: '1. 两数之和',   // 带题号前缀，故意刁难
        problemSlug: '',
        whereStuck: '__slug_link_probe__',
        oneLiner: 'probe',
        tag: '探针'
      })
    });
    const j = await r.json();
    newId = j.id;
    ok('POST 不传 slug 也能创建', r.ok && !!newId, JSON.stringify(j));
  } catch (e) {
    ok('POST /api/mistakes 可达', false, e.message);
  }

  if (newId) {
    const r2 = await fetch(API + '/mistakes');
    const l2 = await r2.json();
    const created = l2.find(m => m.id === newId);
    ok('新错题自动关联到了 two-sum', created && created.problemSlug === 'two-sum',
       created && created.problemSlug);
    // 清理探针，别把用户错题本弄脏
    await fetch(API + '/mistakes/' + newId, { method: 'DELETE' });
    const r3 = await fetch(API + '/mistakes');
    const l3 = await r3.json();
    ok('探针已清理干净', !l3.some(m => m.id === newId));
  }

  // 临时造的那条也要清理，否则空库跑一次就多一条假错题
  if (seededMistake && seededMistake.id) {
    await fetch(API + '/mistakes/' + seededMistake.id, { method: 'DELETE' });
    const r4 = await fetch(API + '/mistakes');
    const l4 = await r4.json();
    ok('临时造的错题已清理干净', !l4.some(m => m.id === seededMistake.id));
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
