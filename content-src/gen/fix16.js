// 一次性修复 b16.js 的引号问题：把占位常量恢复成真正的字符字面量，
// 并把 Java 代码行改用 JS 双引号包裹，从而可以安全包含单引号。
const fs = require('fs');
const p = require('path').join(__dirname, 'b16.js');
const lines = fs.readFileSync(p, 'utf8').split('\n');

// 各题所在行区间（1-based，从 grep 得到）：n-queens 441-665，islands 666-876，rotting 877-末尾
function inRange(i, lo, hi) {
  const ln = i + 1;
  return ln >= lo && ln <= hi;
}

const out = lines.map((line, i) => {
  let s = line;

  // 1) 先恢复占位常量
  if (inRange(i, 441, 665)) {
    s = s.split('DOT').join("'.'").split('QUEEN').join("'Q'");
  } else if (inRange(i, 666, 876)) {
    s = s.split('ONE').join("'1'").split('ZERO').join("'0'");
  } else if (inRange(i, 877, lines.length)) {
    s = s.replace(/\bONE\b/g, '1').replace(/\bTWO\b/g, '2');
  }

  // 2) 把仍是单引号包裹、且内部含单引号的行改成双引号包裹
  const m = s.match(/^(\s*)'(.*)',$/);
  if (m && m[2].includes("'") && !m[2].includes('"')) {
    const body = m[2].replace(/\\/g, '\\\\').split('"').join('\\"');
    return m[1] + '"' + m[2] + '",';
  }
  return s;
});

fs.writeFileSync(p, out.join('\n'));
console.log('rewritten');
