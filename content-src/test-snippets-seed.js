/**
 * 模板库可分发性的回归测试。
 *
 * 这条测试要回答的问题很具体：**别人把仓库 clone 到自己的机器、数据库是空的，
 * 打开网站看到的模板库是不是空的？** 之前就是空的 —— 52 段模板只存在数据库里，
 * 靠「记得先跑一遍 seed 脚本」保证，那不是功能，是运气。
 *
 * 光是「代码里有初始化」不算通过，得拿到真数据。
 */
const path = require('path');
const fs = require('fs');
const API = process.env.LC_API || 'http://127.0.0.1:8099';
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

(async () => {
  const snipPath = path.join(ROOT, 'content', 'snippets.json');

  section('1. 模板数据是内容文件，不是只躺在数据库里');
  ok('content/snippets.json 存在', fs.existsSync(snipPath));
  const raw = JSON.parse(fs.readFileSync(snipPath, 'utf8'));
  ok('是一份非空数组', Array.isArray(raw) && raw.length > 0, '实际 ' + (Array.isArray(raw) ? raw.length : typeof raw));
  ok('至少 52 段', raw.length >= 52, '实际 ' + raw.length);
  ok('分类数至少 29', new Set(raw.map(s => s.category)).size >= 29);
  ok('每段都有 code', raw.every(s => s.code && String(s.code).trim()));
  ok('每段都有 note（一句话说明）', raw.every(s => s.note && String(s.note).trim()),
    raw.filter(s => !s.note || !String(s.note).trim()).map(s => s.title).slice(0, 5).join(', '));
  // id 是各环境自增的，不该进分发包 —— 带过去只会和本地已有的撞车
  ok('不含 id 字段（各环境自增不同）', raw.every(s => !('id' in s)));
  ok('含 sortOrder（保住展示顺序）', raw.every(s => 'sortOrder' in s));

  section('2. 有启动初始化，且只在表为空时灌');
  const seedPath = path.join(ROOT, 'src', 'main', 'java', 'com', 'lc', 'service', 'SnippetStore.java');
  ok('SnippetStore.java 存在', fs.existsSync(seedPath));
  const seed = fs.readFileSync(seedPath, 'utf8');
  ok('有 @PostConstruct（启动时执行）', seed.includes('@PostConstruct'));
  ok('读的是 content/snippets.json', /content["']\s*,\s*["']snippets\.json/.test(seed));
  ok('先查表里有没有数据', seed.includes('countSnippets'));
  ok('表为空才灌（不覆盖用户的编辑）', /if\s*\(\s*have\s*>\s*0\s*\)\s*return/.test(seed));
  ok('灌数据失败不拦启动', /catch\s*\(Exception/.test(seed) && !/throw/.test(seed.split('catch (Exception')[1] || ''));
  ok('日志在源头定死 UTF-8（不指望启动参数）', seed.includes('StandardCharsets.UTF_8'));

  section('3. 真跑起来的服务里模板不是空的');
  const r = await fetch(API + '/api/snippets');
  ok('/api/snippets 返回 200', r.status === 200, 'HTTP ' + r.status);
  const list = await r.json();
  ok('接口返回的模板数 ≥ 52', list.length >= 52, '实际 ' + list.length);
  ok('分类数 ≥ 29', new Set(list.map(s => s.category)).size >= 29);
  ok('接口返回的每段都有 note', list.every(s => s.note && String(s.note).trim()),
    list.filter(s => !s.note || !String(s.note).trim()).map(s => s.title).slice(0, 5).join(', '));

  // 分发包里的和接口返回的要对得上 —— 只对数量不够，得对内容
  const inFile = new Set(raw.map(s => s.category + '||' + s.title));
  const inApi = new Set(list.map(s => s.category + '||' + s.title));
  const onlyInFile = [...inFile].filter(k => !inApi.has(k));
  const onlyInApi = [...inApi].filter(k => !inFile.has(k));
  ok('文件里的模板都在接口里', onlyInFile.length === 0, '缺 ' + onlyInFile.slice(0, 3).join(' / '));
  ok('接口里没有文件之外的多余模板', onlyInApi.length === 0, '多 ' + onlyInApi.slice(0, 3).join(' / '));

  console.log('\n' + '='.repeat(62));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { console.log('❌ 模板库分发测试未通过'); process.exitCode = 1; }
  else { console.log('✅ 模板库分发测试通过'); process.exitCode = 0; }
})().catch(e => { console.error('测试崩了:', e); process.exitCode = 1; });
