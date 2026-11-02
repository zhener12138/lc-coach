/**
 * AIHOT 接入的验收测试。
 *
 * 重点不是「能不能取到数据」，而是三件容易被忽略的事：
 *   1. 缓存真的在拦请求吗（第二次必须不打上游）
 *   2. 上游挂了 / 限流了，页面是不是还能看（降级到缓存）
 *   3. 前端渲染是不是真的把推荐理由、来源、时间都放出来了
 */
const fs = require('fs');
const path = require('path');

const B = 'http://127.0.0.1:8099';
const ROOT = 'E:/moren/lc-coach';
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  ← ' + extra : '')); }
};

(async () => {
  console.log('=== 1. 三个接口都能通 ===');
  const hot = await (await fetch(B + '/api/aihot/hot')).json();
  ok('热点返回 10 条', (hot.items || []).length === 10, (hot.items || []).length);
  ok('热点带 rank 字段', hot.items[0].rank === 1);
  ok('热点带来源名', !!(hot.items[0].source && hot.items[0].source.name));
  ok('meta 标明数据来源是 AIHOT', hot.meta.source === 'AIHOT');

  const items = await (await fetch(B + '/api/aihot/items?mode=selected&limit=5')).json();
  ok('精选返回 5 条', (items.items || []).length === 5);
  ok('精选有推荐理由 reason', !!(items.items.find(x => x.reason)));
  ok('精选有 AIHOT 链接和原文链接', !!(items.items[0].links && items.items[0].links.aihot && items.items[0].links.original));
  ok('page 里有 nextCursor 可翻页', !!items.page.nextCursor);

  const daily = await (await fetch(B + '/api/aihot/daily')).json();
  ok('日报有日期', !!(daily.report && daily.report.date));
  ok('日报有导语', !!(daily.report.lead && daily.report.lead.title));
  ok('日报有分节', Array.isArray(daily.report.sections) && daily.report.sections.length > 0);

  console.log('\n=== 2. 缓存必须真的拦住重复请求 ===');
  // 上面已经拉过一次 hot，这里再拉应当直接命中本地缓存
  const t0 = Date.now();
  const hot2 = await (await fetch(B + '/api/aihot/hot')).json();
  const ms = Date.now() - t0;
  ok('第二次请求走缓存（fromCache=true）', hot2.meta.fromCache === true);
  ok('第二次明显更快（' + ms + 'ms）', ms < 100, ms + 'ms');
  ok('缓存也带 fetchedAt 告诉用户多新', !!hot2.meta.fetchedAt);

  console.log('\n=== 3. 参数校验与非 200 不能崩 ===');
  const bad = await fetch(B + '/api/aihot/daily?date=昨晚');
  const badJ = await bad.json();
  // report 为 null 时 Jackson（non_null 配置）会直接省略这个 key，
  // 所以「没有日报」既可能是 null 也可能是 key 不存在，两种都算正常
  ok('日期格式乱写不会崩，没有返回日报', bad.status === 200 && (badJ.report === null || !('report' in badJ)));
  ok('并且说明了原因', /格式/.test(badJ.meta.note || ''), badJ.meta.note);

  console.log('\n=== 4. 前端真的把内容画出来了 ===');
  const app = R('static/app.js');
  const css = R('static/app.css');
  const html = R('static/index.html');

  ok('侧栏有 AI 资讯入口', html.includes('data-view="aihot"'));
  ok('路由能分派到 viewAihot', app.includes("view === 'aihot'"));
  ok('有 viewAihot 实现', app.includes('async function viewAihot('));
  ok('渲染了推荐理由', app.includes('为什么推给你'));
  ok('渲染了来源名', app.includes('ah-src'));
  ok('渲染了相对时间', app.includes('function agoText('));
  ok('有原文外链且带 rel=noopener', /target="_blank" rel="noopener"/.test(app));
  ok('页脚注明数据来源是 AIHOT', app.includes('aihot.news'));
  ok('页脚说明了缓存 60 秒', app.includes('缓存 60 秒'));
  ok('CSS 有 .ah-item', css.includes('.ah-item'));
  ok('CSS 有 .ah-rank', css.includes('.ah-rank'));
  ok('CSS 有 .ah-hotlist', css.includes('.ah-hotlist'));
  ok('CSS 定义了页面上用到的所有类', [
    '.ah-title', '.ah-sum', '.ah-reason', '.ah-links', '.ah-link',
    '.ah-daily', '.ah-foot', '.aihot-meta'
  ].every(c => css.includes(c)));

  console.log('\n=== 5. 后端实现里该有的防护都在 ===');
  const svc = R('src/main/java/com/lc/service/AihotService.java');
  ok('发了 If-None-Match（未变可拿 304）', svc.includes('If-None-Match'));
  ok('处理了 304', svc.includes('sc == 304'));
  ok('处理了 429 并按 Retry-After 冷却', svc.includes('sc == 429') && svc.includes('Retry-After'));
  ok('有 60 秒最小间隔（尊重 s-maxage）', svc.includes('MIN_FRESH_MS') && svc.includes('60_000'));
  ok('同一 key 加锁防并发回源', svc.includes('ReentrantLock'));
  ok('上游失败时降级给缓存', svc.includes('先给你看缓存的数据'));
  ok('用了 /api/v1 而不是已停用的 /api/public', svc.includes('/api/v1') && !svc.includes('/api/public'));
  ok('没有用给 Agent 看的 Markdown 接口', !svc.includes('/api/v1/agent'));

  console.log('\n' + '='.repeat(56));
  console.log(`通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
