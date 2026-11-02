/**
 * 解法内容校验器。
 *
 * 检查项：
 *   1. plan 里每道题是否都有 3 个解法
 *   2. tier 组合是否为 brute / better / optimal
 *   3. codeJava 能否通过 javac 编译
 *   4. 类名是否为 Solution
 *   5. 方法签名是否与力扣模板一致
 *   6. idea / pseudocode 长度是否达标
 *
 * 用法：
 *   node content-src/verify.js                 # 全量
 *   node content-src/verify.js --slug 3sum     # 单题
 *   node content-src/verify.js --no-compile    # 跳过编译（快）
 *   node content-src/verify.js --quiet         # 只输出汇总和失败项
 */

const fs = require('fs');

const path = require('path');


const ROOT = path.join(__dirname, '..');
const PROB_DIR = path.join(ROOT, 'content', 'problems');
const PLAN = path.join(ROOT, 'src', 'main', 'resources', 'plan.json');

const NO_COMPILE = false; // 编译改为外部 compile.sh 批量执行
const QUIET = process.argv.includes('--quiet');
const slugIdx = process.argv.indexOf('--slug');
const ONLY = slugIdx > -1 ? process.argv[slugIdx + 1] : null;



/* ---------------- 规则 ---------------- */

const MIN_IDEA = 100;
const MIN_PSEUDO_LINES = 8;
const TIERS = ['brute', 'better', 'optimal'];
const TIER_CN = { brute: '暴力', better: '较好', optimal: '最优' };

/** 设计类题目要求写的不是 Solution，而是力扣指定的类名 */
const CLASS_NAME = {
  'min-stack': 'MinStack',
  'implement-queue-using-stacks': 'MyQueue',
  'lru-cache': 'LRUCache',
  'find-median-from-data-stream': 'MedianFinder',
  'implement-trie-prefix-tree': 'Trie',
  'design-add-and-search-words-data-structure': 'WordDictionary'
};

function planSlugs() {
  const p = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const out = [];
  for (const w of p.weeks || []) for (const d of w.days || []) for (const s of d.slugs || []) out.push(s);
  return [...new Set(out)];
}

/** 从力扣模板里抠出方法签名，用于比对 */
function signatureOf(template) {
  if (!template) return null;
  const m = template.match(/public\s+[\w<>\[\],\s.]+\s+(\w+)\s*\(([^)]*)\)/);
  if (!m) return null;
  const norm = s => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();
  return norm(m[1] + '(' + m[2] + ')');
}

/* ---------------- 编译 ---------------- */

/**
 * 沙箱里 Node 无法 spawn 子进程（EPERM），所以编译校验分两步：
 *   node verify.js --export out/   → 把所有解法代码导成 .java 文件
 *   bash compile.sh out/           → 批量 javac，产出失败清单
 * Node 只负责静态规则检查。
 */
const EXPORT_IDX = process.argv.indexOf('--export');
const EXPORT_DIR = EXPORT_IDX > -1 ? process.argv[EXPORT_IDX + 1] : null;

function exportForCompile(slug, sols) {
  const dir = path.join(EXPORT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const cls = CLASS_NAME[slug] || 'Solution';
  sols.forEach((s, i) => {
    if (!s.codeJava || !s.codeJava.trim()) return;
    // 每个解法独立目录，避免同名类互相覆盖
    const d = path.join(dir, 's' + (i + 1));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, cls + '.java'), s.codeJava, 'utf8');
  });
}

/* ---------------- 单题校验 ---------------- */

function checkProblem(slug) {
  const errs = [];
  const warns = [];
  const file = path.join(PROB_DIR, slug + '.json');

  if (!fs.existsSync(file)) return { slug, errs: ['内容文件不存在'], warns };

  let p;
  try {
    p = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { slug, errs: ['JSON 解析失败: ' + e.message], warns };
  }

  if (!p.contentCnHtml || p.contentCnHtml.length < 50) errs.push('中文题面缺失或过短');

  const sols = p.solutions || [];
  if (sols.length !== 3) {
    errs.push(`解法数量 ${sols.length}，要求 3`);
  }

  const tiers = sols.map(s => s.tier);
  if (sols.length === 3 && TIERS.some((t, i) => tiers[i] !== t)) {
    errs.push(`tier 顺序错误：${tiers.join('/')}，应为 brute/better/optimal`);
  }

  const tplSig = signatureOf(p.javaTemplate);

  sols.forEach((s, i) => {
    const tag = `解法${i + 1}(${s.tier})`;

    if (!TIER_CN[s.tier]) errs.push(`${tag} tier 非法`);
    if (!s.title || s.title.length < 4) errs.push(`${tag} title 缺失或过短`);
    if (/^(方法|解法)[一二三四五1-9]/.test(s.title || '')) warns.push(`${tag} title 太泛（"${s.title}"）`);

    const ideaLen = (s.idea || '').length;
    if (ideaLen < MIN_IDEA) errs.push(`${tag} idea 仅 ${ideaLen} 字，要求 ≥${MIN_IDEA}`);

    const pLines = (s.pseudocode || '').split('\n').filter(l => l.trim()).length;
    if (pLines < MIN_PSEUDO_LINES) errs.push(`${tag} 伪代码仅 ${pLines} 行，要求 ≥${MIN_PSEUDO_LINES}`);

    if (!s.timeComplexity) errs.push(`${tag} 缺 timeComplexity`);
    if (!s.spaceComplexity) errs.push(`${tag} 缺 spaceComplexity`);

    const code = s.codeJava || '';
    if (!code.trim()) {
      errs.push(`${tag} codeJava 为空`);
      return;
    }
    const wantCls = CLASS_NAME[slug] || 'Solution';
    const clsRe = new RegExp('class\\s+' + wantCls + '\\b');
    if (!clsRe.test(code)) errs.push(`${tag} 类名不是 ${wantCls}`);

    if (tplSig) {
      const got = signatureOf(code);
      if (!got) errs.push(`${tag} 找不到方法签名`);
      else if (got !== tplSig) errs.push(`${tag} 签名不符：期望 ${tplSig}，实际 ${got}`);
    }

    if (s.pseudocode && /;\s*$/.test((s.pseudocode || '').trim())) {
      warns.push(`${tag} 伪代码疑似照抄代码（以分号结尾）`);
    }
  });

  if (EXPORT_DIR) exportForCompile(slug, sols);

  // 三个解法思路是否真的不同：粗查 title 是否高度重复
  if (sols.length === 3) {
    const titles = sols.map(s => (s.title || '').replace(/[ ·・]/g, ''));
    if (titles[0] === titles[1] || titles[1] === titles[2]) {
      errs.push('解法 title 重复，疑似思路相同');
    }
  }

  return { slug, errs, warns, title: p.titleCn, count: sols.length };
}

/* ---------------- 主流程 ---------------- */

(async () => {
  const all = planSlugs();
  const targets = ONLY ? [ONLY] : all;

  if (!QUIET) console.log(`校验 ${targets.length} 道题…\n`);

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const r = checkProblem(targets[i]);
    results.push(r);
    if (!QUIET) {
      const bad = r.errs.length > 0;
      const mark = bad ? '✗' : (r.count === 3 ? '✓' : '·');
      const info = bad
        ? `  ${r.errs[0]}${r.errs.length > 1 ? ` (+${r.errs.length - 1})` : ''}`
        : (r.count === 3 ? '' : `  ${r.count} 解法`);
      process.stdout.write(`  ${mark} ${targets[i]}${info}\n`);
    }
  }

  const failed = results.filter(r => r.errs.length > 0);
  const complete = results.filter(r => r.errs.length === 0 && r.count === 3);
  const empty = results.filter(r => r.count === 0);
  const warnTotal = results.reduce((n, r) => n + r.warns.length, 0);

  console.log('\n' + '─'.repeat(56));
  console.log(`总题数      ${results.length}`);
  console.log(`✅ 完全合格 ${complete.length}`);
  console.log(`⚠️  无解法   ${empty.length}`);
  console.log(`❌ 有问题   ${failed.length}`);
  console.log(`💬 警告     ${warnTotal}`);
  console.log('─'.repeat(56));

  if (failed.length) {
    console.log('\n失败明细：');
    for (const r of failed) {
      console.log(`\n${r.slug}${r.title ? '  「' + r.title + '」' : ''}`);
      for (const e of r.errs) console.log(`  - ${e}`);
    }
  }

  if (warnTotal && !QUIET) {
    console.log('\n警告明细：');
    for (const r of results) {
      if (!r.warns.length) continue;
      console.log(`\n${r.slug}`);
      for (const w of r.warns) console.log(`  ~ ${w}`);
    }
  }

  if (empty.length && !ONLY) {
    console.log('\n无解法的题（前 20）：');
    console.log(empty.slice(0, 20).map(r => r.slug).join(', '));
  }

  
  process.exit(failed.length > 0 ? 1 : 0);
})();
