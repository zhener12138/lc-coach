/**
 * 只拉题面，不写解法。用于把 plan.json 里全部 120 道题的题面先落地，
 * 保证用户每一天打开都有题面可读，解法可以后续慢慢补。
 *
 * 已有解法的手写题（solutions-*.js 里有的）会被跳过，避免覆盖。
 *
 * 用法：
 *   node content-src/fetch-all.js              # 拉全部缺题面的
 *   node content-src/fetch-all.js --force      # 全部重拉（保留已有解法）
 *   node content-src/fetch-all.js two-sum 3sum # 只拉指定题
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'content', 'problems');
const PLAN = path.join(__dirname, '..', 'src', 'main', 'resources', 'plan.json');
const GQL = 'https://leetcode.cn/graphql/';

const FORCE = process.argv.includes('--force');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));

/* ---------- 力扣查询 ---------- */

const QUERY = `
query q($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
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

async function fetchQuestion(slug) {
  const r = await fetch(GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      Referer: 'https://leetcode.cn/',
      Origin: 'https://leetcode.cn',
    },
    body: JSON.stringify({ query: QUERY, variables: { titleSlug: slug } }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
  const q = j.data && j.data.question;
  if (!q) throw new Error('question 为 null（slug 可能不对）');

  const tags = (q.topicTags || [])
    .map(t => t.translatedName || t.name)
    .filter(Boolean)
    .join(',');
  const javaSnip = (q.codeSnippets || []).find(s => s.langSlug === 'java');

  return {
    frontendId: q.questionFrontendId || '',
    titleEn: q.title || slug,
    titleCn: q.translatedTitle || q.title || slug,
    difficulty: q.difficulty || '',
    tags,
    contentHtml: cleanHtml(q.content || ''),
    contentCnHtml: cleanHtml(q.translatedContent || ''),
    javaTemplate: javaSnip ? javaSnip.code : '',
  };
}

/** 去 style/class/data-* 等无意义属性，保留结构 */
function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/\s(class|style|data-[\w-]+|id|width|height)="[^"]*"/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- 主流程 ---------- */

function planSlugs() {
  const p = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const out = [];
  for (const w of p.weeks || []) {
    for (const d of w.days || []) {
      for (const s of d.slugs || []) out.push(s);
    }
  }
  return [...new Set(out)];
}

function loadSolutions() {
  const merged = {};
  for (const f of fs.readdirSync(__dirname).filter(f => /^solutions-.*\.js$/.test(f)).sort()) {
    Object.assign(merged, require(path.join(__dirname, f)));
  }
  return merged;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const handWritten = loadSolutions();
  const targets = args.length ? args : planSlugs();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let ok = 0, skip = 0, fail = 0;
  const failed = [];

  for (const slug of targets) {
    const file = path.join(OUT_DIR, slug + '.json');

    if (fs.existsSync(file) && !FORCE && !args.length) {
      skip++;
      continue;
    }

    process.stdout.write(`  ${slug} … `);
    let meta;
    try {
      meta = await fetchQuestion(slug);
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed.push({ slug, err: e.message });
      fail++;
      await sleep(400);
      continue;
    }

    // 已有文件就复用里面的解法，只换题面
    let solutions = [];
    if (fs.existsSync(file)) {
      try {
        const old = JSON.parse(fs.readFileSync(file, 'utf8'));
        solutions = old.solutions || [];
      } catch { /* 坏文件直接重建 */ }
    }
    if (handWritten[slug] && handWritten[slug].solutions) {
      solutions = handWritten[slug].solutions.map((s, i) => ({
        id: 0, problemSlug: slug,
        tier: s.tier, title: s.title, idea: s.idea,
        pseudocode: s.pseudocode, codeJava: s.codeJava,
        timeComplexity: s.timeComplexity, spaceComplexity: s.spaceComplexity,
        sortOrder: i + 1,
      }));
    }

    const problem = { slug, ...meta, solutions };
    fs.writeFileSync(file, JSON.stringify(problem, null, 2), 'utf8');
    console.log(`✓ 中文题面 ${meta.contentCnHtml.length} 字符，${solutions.length} 解法`);
    ok++;
    await sleep(300); // 防限流
  }

  console.log(`\n完成：成功 ${ok}，跳过 ${skip}，失败 ${fail}`);
  if (failed.length) {
    console.log('失败列表：');
    for (const f of failed) console.log(`  ${f.slug} → ${f.err}`);
    fs.writeFileSync(path.join(__dirname, 'fetch-failed.json'), JSON.stringify(failed, null, 2));
  }
})();
