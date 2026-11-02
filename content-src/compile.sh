#!/usr/bin/env bash
# 批量编译校验 content-src 导出的解法代码。
#
# 用法：
#   bash content-src/compile.sh            # 导出 + 编译 + 报告
#   bash content-src/compile.sh out        # 用指定导出目录
#
# 为什么单独用 bash：沙箱里 Node 无法 spawn 子进程（EPERM），
# 只能由 Node 导出 .java 文件，再由 bash 调用 javac。

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/.verify-out}"
NODE="/e/nodejs/node.exe"
JAVAC="/e/Program Files/Java/jdk-21/bin/javac.exe"
SUPPORT="$ROOT/content-src/support"

rm -rf "$OUT"
mkdir -p "$OUT"

echo "== 导出解法代码 =="
"$NODE" "$ROOT/content-src/verify.js" --export "$OUT" --quiet >/dev/null 2>&1
EXPORTED=$(find "$OUT" -name '*.java' 2>/dev/null | wc -l | tr -d ' ')
echo "导出 $EXPORTED 个 .java"

echo
echo "== 编译 =="
OK=0
FAIL=0
FAILED_LIST=()

while IFS= read -r f; do
  d=$(dirname "$f")
  # 力扣预置的 TreeNode / ListNode 本地缺失，复制到同目录一起编译
  cp "$SUPPORT"/*.java "$d/" 2>/dev/null
  if "$JAVAC" -encoding UTF-8 -nowarn -d "$d/out" "$f" "$d"/*.java 2>"$d/err.txt"; then
    OK=$((OK+1))
    rm -f "$d/err.txt"
  else
    FAIL=$((FAIL+1))
    rel="${d#$OUT/}"
    msg=$(head -3 "$d/err.txt" | tr '\n' ' ' | sed 's/  */ /g')
    FAILED_LIST+=("$rel :: $msg")
  fi
done < <(find "$OUT" -mindepth 3 -maxdepth 3 -name '*.java' 2>/dev/null | grep -v '/support/')

echo
echo "────────────────────────────────────────"
echo "✅ 编译通过 $OK"
echo "❌ 编译失败 $FAIL"
echo "────────────────────────────────────────"

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "失败明细："
  for x in "${FAILED_LIST[@]}"; do
    echo "  - $x"
  done
  exit 1
fi
