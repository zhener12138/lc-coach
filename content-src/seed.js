/**
 * 把 E:\moren\leetcode\模板.md 和 错题本.md 导入 lc-coach 的 snippet / mistake 表。
 *
 * 用法（服务需在 8099 跑着）：
 *   node content-src/seed.js
 *   node content-src/seed.js --dry     只看解析结果，不写库
 *   node content-src/seed.js --wipe    先清空已有的 snippet/mistake 再导入
 */

const fs = require('fs');
const path = require('path');

const API = process.env.LC_API || 'http://127.0.0.1:8099';
const SRC = 'E:/moren/leetcode';
const DRY = process.argv.includes('--dry');
const WIPE = process.argv.includes('--wipe');

/* ---------------- 解析模板.md ---------------- */

/**
 * 按 "## N. 标题" 切段。
 * 返回 [{ category, title, code, note }]
 *   - 每一段里所有 ```java 代码块拼成一个 code
 *   - 代码块之间的散文合并成 note
 */
function parseTemplates(md) {
  const lines = md.split(/\r?\n/);
  const sections = [];
  let cur = null;

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      const heading = m[1].trim();
      // 跳过非知识类章节
      if (/^(更新日志|模板|统计)$/.test(heading)) {
        cur = null;
        continue;
      }
      // "3. HashMap（哈希表）" → category = "HashMap（哈希表）"
      const stripped = heading.replace(/^\d+\.\s*/, '');
      cur = { category: stripped, title: stripped, raw: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.raw.push(line);
  }

  const out = [];
  for (const s of sections) {
    const codeBlocks = [];
    const prose = [];
    let inFence = false;
    let fenceLang = '';
    let buf = [];

    for (const line of s.raw) {
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence && !inFence) {
        inFence = true;
        fenceLang = fence[1] || '';
        buf = [];
        continue;
      }
      if (inFence && /^```\s*$/.test(line)) {
        inFence = false;
        const code = buf.join('\n').trim();
        if (code) codeBlocks.push({ lang: fenceLang, code });
        continue;
      }
      if (inFence) {
        buf.push(line);
        continue;
      }
      const t = line.trim();
      // 过滤分隔线、空行
      if (!t || /^---+$/.test(t)) continue;
      prose.push(t);
    }

    const code = codeBlocks
      .filter(b => !b.lang || b.lang === 'java')
      .map(b => b.code)
      .join('\n\n');

    if (!code) continue; // 没有 java 代码的段不要

    out.push({
      category: s.category,
      title: s.title,
      code,
      note: prose.join(' ').slice(0, 400),
    });
  }
  return out;
}

/* ---------------- 解析错题本.md ---------------- */

/**
 * 按 "### 题号. 题目名 （日期 · tag）" 切条。
 * 每条抓 "- 卡在：" 和 "- 一句话：" 两行。
 */
function parseMistakes(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let cur = null;
  let curTag = '';

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      const t = h2[1].trim();
      if (!/^(模板|统计)$/.test(t)) curTag = t;
      cur = null;
      continue;
    }

    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      const heading = h3[1].trim();
      // "1. 两数之和  （10/31 · 数组·哈希）"
      const numMatch = heading.match(/^(\d+)\.\s*(.+?)(?:\s*（(.+?)）)?$/);
      if (!numMatch) { cur = null; continue; }
      const frontendId = numMatch[1];
      const title = numMatch[2].trim();
      const meta = numMatch[3] || '';
      // meta 形如 "10/31 · 数组·哈希"：第一段是日期，丢掉，剩下的才是真 tag
      const metaParts = meta.split('·').map(s => s.trim()).filter(Boolean);
      const realTags = metaParts.filter(p => !/^\d{1,2}\/\d{1,2}$/.test(p));
      cur = {
        problemTitle: `${frontendId}. ${title}`,
        problemSlug: '',
        whereStuck: '',
        oneLiner: '',
        tag: realTags.length ? realTags.join(' · ') : curTag,
      };
      out.push(cur);
      continue;
    }

    if (!cur) continue;
    const stuck = line.match(/^-\s*卡在[：:]\s*(.*)$/);
    if (stuck) { cur.whereStuck = stuck[1].trim(); continue; }
    const one = line.match(/^-\s*一句话[：:]\s*(.*)$/);
    if (one) { cur.oneLiner = one[1].trim(); continue; }
  }

  return out.filter(m => m.whereStuck || m.oneLiner);
}

/* ---------------- 写入 ---------------- */

async function post(p, body) {
  const r = await fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

async function del(p) {
  const r = await fetch(API + p, { method: 'DELETE' });
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
  return r.json();
}

(async () => {
  const tplMd = fs.readFileSync(path.join(SRC, '模板.md'), 'utf8');
  const misMd = fs.readFileSync(path.join(SRC, '错题本.md'), 'utf8');

  const templates = parseTemplates(tplMd);
  const mistakes = parseMistakes(misMd);

  console.log(`解析到 ${templates.length} 个模板分类、${mistakes.length} 条错题`);
  for (const t of templates) {
    console.log(`  [模板] ${t.category}  ${t.code.split('\n').length} 行代码`);
  }
  for (const m of mistakes) {
    console.log(`  [错题] ${m.problemTitle}  tag=${m.tag}`);
  }

  if (DRY) { console.log('\n--dry 模式，不写库。'); return; }

  if (WIPE) {
    const old = await (await fetch(API + '/api/snippets')).json();
    for (const s of old) await del('/api/snippets/' + s.id);
    const oldM = await (await fetch(API + '/api/mistakes')).json();
    for (const s of oldM) await del('/api/mistakes/' + s.id);
    console.log(`已清空 ${old.length} 个模板、${oldM.length} 条错题`);
  }

  let i = 0;
  for (const t of templates) {
    await post('/api/snippets', { ...t, sortOrder: i++ });
  }
  console.log(`✅ 写入 ${templates.length} 个模板`);

  let j = 0;
  for (const m of mistakes) {
    // 尝试用标题反查 slug，失败就留空
    await post('/api/mistakes', m);
    j++;
  }
  console.log(`✅ 写入 ${j} 条错题`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
