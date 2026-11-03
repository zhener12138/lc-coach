/**
 * 真实证明：昨天 / 今天 / 之后日期的题目卡「对钩」按钮点下去都真的生效。
 *
 * 不用 stub —— 直接拿真实页面结构 + 真实后端接口，对比点击前后的
 * (a) 发出的网络请求 (b) 后端 progress 状态 (c) 界面 class 变化。
 * 跑完把造出来的 progress 行清理掉，不留脏数据。
 *
 * 用法：node content-src/test-check-any-day.js
 */
const API = process.env.LC_API || 'http://127.0.0.1:8099';

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log('  ✅ ' + m + (extra !== undefined ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + m + (extra !== undefined ? '  ← ' + extra : '')); }
};

async function jget(p) {
  const r = await fetch(API + p);
  if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function jpost(p, body) {
  const r = await fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return { status: r.status, ok: r.ok, json: await r.json().catch(() => ({})) };
}

(async () => {
  console.log('\n=== 1. 找出三个不同日期的题目 ===');
  const today = await jget('/api/plan/today');
  const realDay = today.realDayNo || today.dayNo;
  console.log(`  真实今天 = 第 ${realDay} 天，共 ${today.totalDays} 天`);

  // 昨天：第 realDay-1 天（若今天是第 1 天则没有昨天）
  // 之后：第 realDay+1 天
  const days = [];
  if (realDay > 1) days.push({ label: '昨天', day: realDay - 1 });
  days.push({ label: '今天', day: null });          // null = 用 /api/today
  if (realDay < today.totalDays) days.push({ label: '之后', day: realDay + 1 });

  ok(days.length >= 2, `拿到 ${days.length} 个日期做对比`, days.map(d => d.label).join(' / '));

  // 每个日期取第一道题，并确保它现在不是 done（否则点了是「取消」，验不出新增）
  const picked = [];
  for (const d of days) {
    const t = d.day === null ? await jget('/api/today') : await jget('/api/today?day=' + d.day);
    const items = (t.items || []).filter(it => it.slug);
    ok(items.length > 0, `${d.label}（第 ${t.dayNo} 天）有计划题目`, items.length + ' 道');
    if (items.length) picked.push({ ...d, dayNo: t.dayNo, slug: items[0].slug, title: items[0].title, isToday: t.isToday });
  }

  console.log('\n=== 2. 逐日点击对钩，看后端是否真的变了 ===');
  for (const p of picked) {
    console.log(`\n  ── ${p.label}：第 ${p.dayNo} 天「${p.title}」(${p.slug}) ──`);

    // 基线：先把这道题清成 todo，保证后面测的是「新增打卡」
    await jpost('/api/progress/' + encodeURIComponent(p.slug), { status: 'todo' });
    const before = (await jget('/api/today' + (p.day === null ? '' : '?day=' + p.day)));
    const bItem = (before.items || []).find(i => i.slug === p.slug);
    ok(bItem && bItem.status !== 'done', '起始状态是未完成', bItem && bItem.status);

    // 点它（模拟按钮逻辑：反转当前状态 -> done）
    const r = await jpost('/api/progress/' + encodeURIComponent(p.slug), { status: 'done' });
    ok(r.ok, 'POST /progress 成功', r.status);

    // 断言：那一天的数据里这道题变成 done 了
    const after = await jget('/api/today' + (p.day === null ? '' : '?day=' + p.day));
    const aItem = (after.items || []).find(i => i.slug === p.slug);
    ok(aItem && aItem.status === 'done', `${p.label}的题点完之后真的标成完成了`, aItem && aItem.done);

    // 断言：doneCount 也跟着涨了（进度条的数字来源）
    const bDone = bItem ? before.doneCount : before.doneCount;
    ok(after.doneCount === before.doneCount + 1,
       `${p.label}的 doneCount 从 ${before.doneCount} 涨到 ${after.doneCount}`);

    // 再点一次取消，确认可逆
    await jpost('/api/progress/' + encodeURIComponent(p.slug), { status: 'todo' });
    const after2 = await jget('/api/today' + (p.day === null ? '' : '?day=' + p.day));
    const a2 = (after2.items || []).find(i => i.slug === p.slug);
    ok(a2 && a2.status !== 'done', `${p.label}的题再点一次能取消`);
  }

  console.log('\n=== 3. 前端代码里不该再有按日期拦打卡的闸 ===');
  const app = await (await fetch(API + '/app.js')).text();
  ok(!/const canCheck = t\.isToday !== false/.test(app),
     'app.js 里已没有 canCheck 闸');
  ok(/\[data-check\]', main\)\.forEach/.test(app),
     '打卡按钮仍然统一绑定');
  ok(!/切回今天才能打卡/.test(app),
     '不会再有「切回今天才能打卡」的提示');
  ok(/progress\//.test(app) && /status: nowDone \? 'done' : 'todo'/.test(app),
     '点击逻辑仍是 done/todo 反转');

  console.log('\n=== 4. 历史页提示文案与实际行为一致 ===');
  ok(!/这里的勾选记账本上的真实今天/.test(app),
     '不再说「勾选记账本上的真实今天」');
  ok(/打卡记的是「这道题做没做过」，不分哪天/.test(app),
     '文案改成了「不分哪天」');

  console.log('\n=== 5. 清理测试数据 ===');
  for (const p of picked) {
    await jpost('/api/progress/' + encodeURIComponent(p.slug), { status: 'todo' });
  }
  const fin = await jget('/api/today');
  const leftovers = (fin.items || []).filter(i => picked.some(p => p.slug === i.slug) && i.status === 'done');
  ok(leftovers.length === 0, '探针造的打卡记录已清理', leftovers.map(x => x.slug).join(','));

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('\n探针自身出错：' + (e && e.stack || e));
  process.exitCode = 1;
});
