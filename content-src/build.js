/**
 * 内容构建脚本：把「手写解法」+「力扣实时题面」合并成 content/problems/<slug>.json
 *
 * 用法：
 *   node content-src/build.js              # 构建 solutions-w1.js 里所有题
 *   node content-src/build.js two-sum      # 只构建指定 slug
 *   node content-src/build.js --all        # 构建 content-src 下所有 solutions-*.js
 *
 * 注意：本机 curl 全部返回 000，所以必须用 Node 的 fetch（已验证可用）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'content', 'problems');

const LC_GQL = 'https://leetcode.cn/graphql/';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Referer': 'https://leetcode.cn/problemset/',
  'Origin': 'https://leetcode.cn'
};

const QUESTION_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    translatedTitle
    titleSlug
    difficulty
    content
    translatedContent
    topicTags { name slug translatedName }
    codeSnippets { lang langSlug code }
  }
}`;

async function gql(query, variables) {
  const res = await fetch(LC_GQL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
  return json.data;
}

async function fetchQuestion(slug) {
  const data = await gql(QUESTION_QUERY, { titleSlug: slug });
  const q = data && data.question;
  if (!q) return null;

  const tags = (q.topicTags || [])
    .map(t => t.translatedName || t.name)
    .filter(Boolean)
    .join(',');

  const javaSnip = (q.codeSnippets || []).find(s => s.langSlug === 'java');

  return {
    frontendId: String(q.questionFrontendId || q.questionId || ''),
    titleEn: q.title || '',
    titleCn: q.translatedTitle || q.title || '',
    difficulty: q.difficulty || '',
    tags,
    contentHtml: q.content || '',
    contentCnHtml: q.translatedContent || q.content || '',
    javaTemplate: javaSnip ? javaSnip.code : ''
  };
}

/* 轻量 HTML 清洗：去掉力扣题面里用不到的样式属性，保留结构 */
function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s(style|class|data-[a-z-]+)="[^"]*"/gi, '')
    .replace(/<p>\s*&nbsp;\s*<\/p>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function loadSolutionModules(onlyAll) {
  const files = fs.readdirSync(__dirname)
    .filter(f => /^solutions-.*\.js$/.test(f))
    .sort();
  const merged = {};
  for (const f of files) {
    const mod = require(path.join(__dirname, f));
    Object.assign(merged, mod);
  }
  return merged;
}

async function buildOne(slug, solDef) {
  process.stdout.write(`  ${slug} … `);

  let meta = null;
  try {
    meta = await fetchQuestion(slug);
  } catch (e) {
    console.log(`题面拉取失败（${e.message}），用空题面继续`);
  }

  if (!meta) {
    meta = {
      frontendId: '', titleEn: slug, titleCn: slug, difficulty: '',
      tags: '', contentHtml: '', contentCnHtml: '', javaTemplate: ''
    };
    console.log(`  ⚠ ${slug} 没拿到题面，只写解法`);
  }

  const solutions = (solDef.solutions || []).map((s, i) => ({
    id: 0,
    problemSlug: slug,
    tier: s.tier,
    title: s.title,
    idea: s.idea,
    pseudocode: s.pseudocode,
    codeJava: s.codeJava,
    timeComplexity: s.timeComplexity,
    spaceComplexity: s.spaceComplexity,
    sortOrder: i + 1
  }));

  const problem = {
    slug,
    frontendId: meta.frontendId,
    titleEn: meta.titleEn,
    titleCn: meta.titleCn,
    difficulty: meta.difficulty,
    tags: meta.tags,
    contentHtml: cleanHtml(meta.contentHtml),
    contentCnHtml: cleanHtml(meta.contentCnHtml),
    solutions
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, slug + '.json'),
    JSON.stringify(problem, null, 2),
    'utf8'
  );

  const cnLen = (problem.contentCnHtml || '').length;
  console.log(`✓ ${solutions.length} 解法，中文题面 ${cnLen} 字符`);
  return problem;
}

(async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const all = loadSolutionModules();

  let targets;
  if (args.length) {
    targets = args.filter(s => all[s]);
    const missing = args.filter(s => !all[s]);
    if (missing.length) console.log('⚠ 这些 slug 没有手写解法，跳过：' + missing.join(', '));
  } else {
    targets = Object.keys(all);
  }

  if (!targets.length) {
    console.log('没有要构建的题。在 content-src/solutions-*.js 里加内容，或在命令行传 slug。');
    return;
  }

  console.log(`开始构建 ${targets.length} 道题…\n`);
  let ok = 0, fail = 0;

  for (const slug of targets) {
    try {
      await buildOne(slug, all[slug]);
      ok++;
    } catch (e) {
      fail++;
      console.log(`✗ ${slug} 失败：${e.message}`);
    }
    // 轻微间隔，避免被限流
    await new Promise(r => setTimeout(r, 260));
  }

  console.log(`\n完成：成功 ${ok}，失败 ${fail}`);
  console.log(`输出目录：${OUT_DIR}`);
})();
