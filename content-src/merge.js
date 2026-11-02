/**
 * 把 content/solutions/<slug>.json 合并进 content/problems/<slug>.json。
 *
 * 为什么用 JSON 而不是 JS：解法里含大量 Java 代码（引号、反斜杠、中文），
 * 写进 JS 字符串要层层转义，极易出错。纯 JSON 由解析器保证合法性。
 *
 * 用法：
 *   node content-src/merge.js              # 合并全部
 *   node content-src/merge.js --check      # 只检查不写入
 *   node content-src/merge.js 3sum         # 只合并指定题
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOL_DIR = path.join(ROOT, 'content', 'solutions');
const PROB_DIR = path.join(ROOT, 'content', 'problems');

const CHECK = process.argv.includes('--check');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));

if (!fs.existsSync(SOL_DIR)) {
  console.log('content/solutions 目录不存在，无需合并。');
  process.exit(0);
}

const files = args.length
  ? args.map(s => s + '.json')
  : fs.readdirSync(SOL_DIR).filter(f => f.endsWith('.json'));

let ok = 0, skip = 0, bad = 0;

for (const f of files) {
  const src = path.join(SOL_DIR, f);
  const slug = f.replace(/\.json$/, '');

  if (!fs.existsSync(src)) { bad++; console.log(`✗ ${f} 不存在`); continue; }

  let sols;
  try {
    const j = JSON.parse(fs.readFileSync(src, 'utf8'));
    sols = j.solutions || j;
    if (!Array.isArray(sols)) throw new Error('solutions 不是数组');
  } catch (e) {
    bad++;
    console.log(`✗ ${slug} JSON 解析失败：${e.message}`);
    continue;
  }

  const target = path.join(PROB_DIR, slug + '.json');
  if (!fs.existsSync(target)) { bad++; console.log(`✗ ${slug} 题目文件不存在`); continue; }

  const prob = JSON.parse(fs.readFileSync(target, 'utf8'));
  prob.solutions = sols.map((s, i) => ({
    id: 0,
    problemSlug: slug,
    tier: s.tier,
    title: s.title,
    idea: s.idea,
    pseudocode: s.pseudocode,
    codeJava: s.codeJava,
    timeComplexity: s.timeComplexity,
    spaceComplexity: s.spaceComplexity,
    sortOrder: i + 1,
  }));

  if (CHECK) {
    console.log(`· ${slug} 可合并（${sols.length} 解法）`);
    ok++;
    continue;
  }

  fs.writeFileSync(target, JSON.stringify(prob, null, 2), 'utf8');
  console.log(`✓ ${slug} 合并 ${sols.length} 解法`);
  ok++;
}

console.log(`\n合并 ${ok}，异常 ${bad}`);
process.exit(bad > 0 ? 1 : 0);
