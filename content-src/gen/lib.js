// 内容生成辅助：把「按行写的代码数组」拼成字符串，避免手写 \n 转义出错
// 用法：在 content-src/gen/<batch>.js 里 require 本文件
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'content', 'solutions');

/** 按行拼成代码字符串 */
function L(...lines) {
  return lines.join('\n');
}

/** 写一个题目的解法 JSON */
function write(slug, solutions) {
  if (!solutions || solutions.length !== 3) {
    throw new Error(slug + ' 必须恰好 3 个解法，实际 ' + (solutions || []).length);
  }
  const tiers = solutions.map((s) => s.tier);
  if (tiers.join(',') !== 'brute,better,optimal') {
    throw new Error(slug + ' tier 顺序必须是 brute,better,optimal，实际 ' + tiers.join(','));
  }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, slug + '.json');
  fs.writeFileSync(file, JSON.stringify({ solutions }, null, 2), 'utf8');
  console.log('written ' + slug);
}

module.exports = { L, write };
