#!/bin/bash
# 全量回归跑批。
#
# 三个坑记在这里别再犯：
# 1. 沙箱禁止 Node spawn 子进程（EPERM），所以不能用 node 脚本去 spawn 各个 test —— 只能用 shell 循环。
# 2. 判定必须看**退出码**，不能 grep 汇总行：各脚本的历史格式不统一
#    （"通过 39 / 失败 0"、"13 passed, 0 failed"、"41 / 41"），
#    按格式 grep 会把跑通过的脚本误判成没跑。
# 3. 数断言的标记也不统一：早先的脚本用 ✔/✘，后来的用 ✅/❌。
#    只数一种会让另一批显示「0 条断言」还打勾 —— 看起来通过、其实没统计到，
#    比测试失败更糟（失败至少会红）。所以两种都数。
cd "$(dirname "$0")" || exit 1

# node 的位置因机器而异，先按 PATH 找，找不到再退回本机那个绝对路径。
# 写死 E:/nodejs/node.exe 会让别人 clone 下来直接跑不起来。
NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ] && [ -x "E:/nodejs/node.exe" ]; then NODE="E:/nodejs/node.exe"; fi
if [ -z "$NODE" ]; then
  echo "找不到 node。装一个，或把 node 加到 PATH 里。"
  exit 1
fi
pass=0
fail=0
total=0
failed_list=""

for t in $(ls test-*.js | sort); do
  out=$("$NODE" "$t" 2>&1)
  code=$?
  n=$(printf '%s' "$out" | grep -o '✅\|✔' | wc -l)
  total=$((total + n))

  # 退出码非 0，或输出里有 ❌/✘，都算失败
  if [ $code -ne 0 ] || printf '%s' "$out" | grep -q '❌\|✘'; then
    fail=$((fail + 1))
    failed_list="$failed_list $t"
    printf '  ❌ %-30s exit=%-3s %s 条断言\n' "$t" "$code" "$n"
    printf '%s\n' "$out" | grep '❌\|✘' | head -5 | sed 's/^/       /'
  else
    pass=$((pass + 1))
    printf '  ✅ %-30s %s 条断言\n' "$t" "$n"
  fi
done

echo ""
echo "=================================================================="
echo "脚本 $pass 通过 / $fail 失败 · 断言合计 $total 条"
if [ $fail -ne 0 ]; then
  echo "❌ 失败脚本：$failed_list"
  exit 1
fi

# 断言数为 0 说明统计没抓到，不是真的通过 —— 单独警告，别让它混在全绿里。
if [ $total -eq 0 ]; then
  echo "⚠️ 断言数为 0：所有脚本都没被统计到，检查标记符号是否又换了"
  exit 1
fi
echo "✅ 全量回归通过"
