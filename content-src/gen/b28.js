// 最后一批六题：快速幂 / 整数反转 / 回文数 / 计数质数
const { L, write } = require("./lib");

// --------------------------------------------------- 50 powx-n
write("powx-n", [
  {
    tier: "brute",
    title: "循环乘 n 次（含负数指数处理）",
    idea: "实现 `x` 的 `n` 次幂。最直接的想法：循环乘 n 次。\n\n**但这题有两个必须处理的陷阱，比算法本身更重要：**\n\n**陷阱一：n 可能是负数。** `x^(-n) = 1 / x^n`。所以要先取绝对值，最后取倒数。**但 `n = Integer.MIN_VALUE` 时 `-n` 会溢出**（MIN_VALUE 取负还是 MIN_VALUE，因为补码范围不对称）。**必须先把 n 转成 `long`。** 这是本题最著名的坑。\n\n**陷阱二：n = 0 返回 1。** 包括 `0^0 = 1`（数学上有争议，但编程约定是 1）。\n\n**为什么这算暴力？** O(|n|)，n 可达 2^31，**绝对超时**。力扣本题 n 范围是 `[-2^31, 2^31 - 1]`，线性循环要跑 20 亿次。\n\n**但这一版必须写，因为它把两个边界陷阱暴露出来。** 记住：**写快速幂之前，先把「负数 + MIN_VALUE」处理对，否则后面再快也是错的。**\n\n坑：\n1. **n 转 long 再取负**；\n2. n = 0 返回 1；\n3. `x = 0, n < 0` 数学上无意义（力扣保证不会给）。",
    pseudocode: L(
      "输入：底数 x，指数 n",
      "输出：x 的 n 次幂",
      "",
      "1. 如果 n 小于 0：return 1 除以 (x 的 (负 n) 次幂)",
      "2. res = 1",
      "3. 对 i 从 1 到 n：res = res 乘 x",
      "4. return res",
      "",
      "负数指数要先取倒数，但 n 等于最小整数时取负会溢出，必须用 long",
      "线性循环 O(|n|)，n 可达二十亿会超时",
      "复杂度：时间 O(|n|)；空间 O(1)"
    ),
    codeJava: L(
      "class Solution {",
      "    public double myPow(double x, int n) {",
      "        long N = n;",
      "        if (N < 0) return 1.0 / powLinear(x, -N);",
      "        return powLinear(x, N);",
      "    }",
      "",
      "    private double powLinear(double x, long n) {",
      "        double res = 1.0;",
      "        for (long i = 0; i < n; i++) res *= x;",
      "        return res;",
      "    }",
      "}"
    ),
    timeComplexity: "O(|n|)",
    spaceComplexity: "O(1)"
  },
  {
    tier: "better",
    title: "递归快速幂：每次把指数减半",
    idea: "核心思想：**`x^n = (x^(n/2))^2`。** 每次把指数减半，所以只需要 O(log n) 次乘法。\n\n**递归写法（最简单）：**\n```\nif (n == 0) return 1.0;\ndouble half = pow(x, n / 2);\nif (n % 2 == 0) return half * half;\nreturn half * half * x;   // 奇数多乘一个 x\n```\n\n**为什么只递归一次而不是两次？** 因为 `half = pow(x, n/2)` 只算一次，然后平方。**如果写成 `pow(x, n/2) * pow(x, n/2)` 就是两次递归，退化成 O(n)。** 这是分治里最常见的性能陷阱。\n\n**为什么要单独处理奇数？** 因为 `n/2` 向下取整，`n=5` 时 `5/2=2`，`(x^2)^2 = x^4`，还差一个 `x`。**所以奇数要补乘一次。**\n\n**Java 的 `n % 2` 对负数返回 -1 而不是 1**，所以**要在递归入口就把负数处理掉**（转成正指数）。否则 `n % 2 == 1` 的判断对负奇数失效。\n\n**为什么还只是「较好」？** 因为递归深度是 O(log n)（约 31 层），虽然不爆栈，但**有函数调用开销**，而且用了 O(log n) 的栈空间。**迭代版能做到 O(1) 空间。**\n\n坑：\n1. **n 先转 long 再取负**；\n2. 负数转正后再递归；\n3. `half` 只算一次，**不要写两遍递归**；\n4. 奇数时多乘一次 `x`。",
    pseudocode: L(
      "输入：x，n",
      "输出：x 的 n 次幂",
      "",
      "1. N = n 转成 long",
      "2. 如果 N 小于 0：return 1 除以 fastPow(x, 负 N)",
      "3. return fastPow(x, N)",
      "",
      "fastPow(x, n)：",
      "4. 如果 n 等于 0：return 1.0",
      "5. half = fastPow(x, n 除以 2)            // 只递归一次",
      "6. 如果 n 是偶数：return half 乘 half",
      "7. 否则：return half 乘 half 乘 x",
      "",
      "每次指数减半，只需 O(log n) 次乘法",
      "half 必须只算一次，写两次递归就退化成 O(n)",
      "复杂度：时间 O(log n)；空间 O(log n)"
    ),
    codeJava: L(
      "class Solution {",
      "    public double myPow(double x, int n) {",
      "        long N = n;",
      "        if (N < 0) return 1.0 / fastPow(x, -N);",
      "        return fastPow(x, N);",
      "    }",
      "",
      "    private double fastPow(double x, long n) {",
      "        if (n == 0) return 1.0;",
      "        double half = fastPow(x, n / 2);",
      "        if (n % 2 == 0) return half * half;",
      "        return half * half * x;",
      "    }",
      "}"
    ),
    timeComplexity: "O(log n)",
    spaceComplexity: "O(log n)"
  },
  {
    tier: "optimal",
    title: "迭代快速幂：二进制拆分，O(1) 空间",
    idea: "把指数 `n` 看成二进制，**每一位对应一个「平方」的动作，位为 1 就乘进结果。**\n\n```\nwhile (n > 0) {\n    if ((n & 1) == 1) res *= base;   // 这一位是 1，把当前 base 乘进结果\n    base *= base;                     // base 平方，对应下一位\n    n >>= 1;                          // 指数右移一位\n}\n```\n\n**为什么这等于快速幂？** 因为 `x^n` 可以按二进制展开：\n`x^13 = x^(1101₂) = x^8 · x^4 · x^1`\n\n**循环里 `base` 依次是 `x^1, x^2, x^4, x^8...`**，每次平方。**位为 1 时就把它乘进 `res`。** 这正好把「指数减半」翻译成了「指数右移」。\n\n**为什么这是最优？**\n- 时间 O(log n)：循环次数等于 n 的二进制位数，约 31 次；\n- 空间 O(1)：没有递归栈。\n\n**这个「二进制拆分」的思想覆盖面极广：**\n- 快速幂取模（LeetCode 372 题）；\n- 矩阵快速幂（求斐波那契第 n 项，O(log n)）；\n- 快速乘（防溢出的乘法）；\n- **任何满足结合律的运算，都能用这个套路加速到 O(log n)。**\n\n**面试时如果被追问「为什么不用递归」，就答：** 递归有 O(log n) 栈空间和函数调用开销，迭代版空间 O(1)、常数更小。**同时指出两者时间复杂度相同，选择是工程取舍。**\n\n坑：\n1. **`long n` 而不是 `int`**（防 MIN_VALUE 溢出）；\n2. `res` 初值 1.0（不是 x）；\n3. **`base *= base` 要在 `if` 外面**，每次循环都要平方；\n4. `n >>= 1` 用 long 的移位，安全。",
    pseudocode: L(
      "输入：x，n",
      "输出：x 的 n 次幂",
      "",
      "1. N = n 转成 long；res = 1.0；base = x",
      "2. 如果 N 小于 0：base = 1 除以 x；N = 负 N",
      "3. 当 N 大于 0 循环：",
      "     如果 (N 位与 1) 等于 1：res = res 乘 base",
      "     base = base 乘 base                  // 平方，对应二进制下一位",
      "     N = N 右移 1 位",
      "4. return res",
      "",
      "指数二进制展开，base 依次是 x、x 平方、x 四次方，位为 1 就乘进结果",
      "所有满足结合律的运算都能用这个套路加速到 O(log n)",
      "复杂度：时间 O(log n)；空间 O(1)"
    ),
    codeJava: L(
      "class Solution {",
      "    public double myPow(double x, int n) {",
      "        long N = n;",
      "        double res = 1.0;",
      "        double base = x;",
      "        if (N < 0) {",
      "            base = 1.0 / x;",
      "            N = -N;",
      "        }",
      "",
      "        while (N > 0) {",
      "            if ((N & 1) == 1) res *= base;",
      "            base *= base;",
      "            N >>= 1;",
      "        }",
      "        return res;",
      "    }",
      "}"
    ),
    timeComplexity: "O(log n)",
    spaceComplexity: "O(1)"
  }
]);

// --------------------------------------------------- 7 reverse-integer
write("reverse-integer", [
  {
    tier: "brute",
    title: "转字符串再反转，用 long 判溢出",
    idea: "把整数反转（`123` → `321`，`-123` → `-321`）。**如果反转后超出 32 位有符号整数范围 `[-2^31, 2^31-1]`，返回 0。**\n\n最直接的想法：**转成字符串，反转，再转回数字。** 用 `long` 接住结果，最后判断是否在 int 范围内。\n\n**为什么这算暴力？**\n- 有多余的字符串转换开销（`String.valueOf` + `StringBuilder.reverse` + `Long.parseLong`）；\n- 空间 O(位数) 而不是 O(1)。\n\n**但它很容易写对，而且把「溢出检测」这个难点简化成了「用 long 装然后比大小」。** 在真实工程里，**这种先保证正确、再考虑优化的顺序是对的。**\n\n**处理负号的小技巧：** 用 `StringBuilder` 反转后，负号的 `-` 会跑到末尾。所以更好的做法是**先判断正负，对绝对值操作，最后补回符号**。\n\n**溢出判定：** `if (val < Integer.MIN_VALUE || val > Integer.MAX_VALUE) return 0;`\n\n坑：\n1. 负号处理（先取绝对值再补回）；\n2. 反转后前导零会自动消失（`120` → `021` → `21`，转数字时自然处理）；\n3. **必须用 long 接住**，否则 `Integer.parseInt` 遇到 `2147483648` 会抛异常。",
    pseudocode: L(
      "输入：整数 x",
      "输出：反转后的整数，溢出则 0",
      "",
      "1. neg = (x 小于 0)",
      "2. s = 把 x 的绝对值转成字符串",
      "3. rev = 把 s 反转",
      "4. val = 把 rev 转成 long",
      "5. 如果 neg：val = 负 val",
      "6. 如果 val 小于 int 最小值 或 大于 int 最大值：return 0",
      "7. return val 转成 int",
      "",
      "用 long 接住反转结果，最后统一判溢出",
      "字符串转换有开销，空间是 O(位数)",
      "复杂度：时间 O(log x)；空间 O(log x)"
    ),
    codeJava: L(
      "class Solution {",
      "    public int reverse(int x) {",
      "        boolean neg = x < 0;",
      "        long abs = Math.abs((long) x);",
      "        String s = Long.toString(abs);",
      "        String rev = new StringBuilder(s).reverse().toString();",
      "        long val = Long.parseLong(rev);",
      "        if (neg) val = -val;",
      "        if (val < Integer.MIN_VALUE || val > Integer.MAX_VALUE) return 0;",
      "        return (int) val;",
      "    }",
      "}"
    ),
    timeComplexity: "O(log x)",
    spaceComplexity: "O(log x)"
  },
  {
    tier: "better",
    title: "数学法：逐位取模拼数，用 long 防溢出",
    idea: "不用字符串，用纯数学：**反复取 `x % 10` 拿到最低位，把它拼到结果末尾，然后 `x /= 10`。**\n\n```\nlong res = 0;\nwhile (x != 0) {\n    res = res * 10 + x % 10;\n    x /= 10;\n}\n```\n\n**注意 `x % 10` 在 Java 里对负数返回负数**（比如 `-123 % 10 = -3`），**但因为整个过程都在负数域里运算，结果自动就是负的，反而省掉了符号处理。** 这是 Java 取模的一个「歪打正着」的便利。**但这个性质依赖语言，面试时说清楚「我用 Java 的负数取模特性，其他语言需要额外处理」。**\n\n**为什么用 long 而不是 int？** 因为 `res * 10` 在接近边界时会溢出，**用 long 可以撑到 `2^63`，远超 int 范围，最后统一比较。** 这是最简单可靠的防溢出方式。\n\n**为什么还只是「较好」？** 因为题目暗示了「不能用 long」的进阶要求（很多面试官会追问「如果环境没有 64 位整数怎么办」）。**正解是在乘之前就预判溢出。**\n\n**但必须说：用 long 是工程上最推荐的做法。** 代码短、易读、不可能出错。**面试时可以先用这版，再主动说明「如果没有 long，我会在乘之前检查边界」——这样展示的是工程判断力 + 对底层约束的理解。**\n\n坑：\n1. 循环条件 `x != 0`（负数也满足）；\n2. `res` 用 long；\n3. 最后判范围再强转 int。",
    pseudocode: L(
      "输入：x",
      "输出：反转值，溢出则 0",
      "",
      "1. res = 0（long 类型）",
      "2. 当 x 不等于 0 循环：",
      "     res = res 乘 10 加 (x 模 10)",
      "     x = x 除以 10",
      "3. 如果 res 小于 int 最小值 或 大于 int 最大值：return 0",
      "4. return res 转成 int",
      "",
      "Java 对负数取模返回负数，整个过程自然保持符号，省掉符号处理",
      "用 long 撑住中间结果，最后统一判范围",
      "复杂度：时间 O(log x)；空间 O(1)"
    ),
    codeJava: L(
      "class Solution {",
      "    public int reverse(int x) {",
      "        long res = 0;",
      "        while (x != 0) {",
      "            res = res * 10 + x % 10;",
      "            x /= 10;",
      "        }",
      "        if (res < Integer.MIN_VALUE || res > Integer.MAX_VALUE) return 0;",
      "        return (int) res;",
      "    }",
      "}"
    ),
    timeComplexity: "O(log x)",
    spaceComplexity: "O(1)"
  },
  {
    tier: "optimal",
    title: "乘之前预判溢出，全程 int",
    idea: "**不用 long，在每次 `res * 10 + digit` 之前就检查会不会溢出。**\n\n溢出条件（以正数为例，`res` 即将变成 `res * 10 + digit`）：\n- 如果 `res > Integer.MAX_VALUE / 10`，**那么 `res * 10` 一定溢出**；\n- 如果 `res == Integer.MAX_VALUE / 10`，**那么还要看 `digit > 7`**（因为 `MAX_VALUE = 2147483647`，末尾是 7）。\n\n负数对称处理（`MIN_VALUE = -2147483648`，末尾是 8）：\n- `res < Integer.MIN_VALUE / 10` → 溢出；\n- `res == Integer.MIN_VALUE / 10` 且 `digit < -8` → 溢出。\n\n**为什么这个细节值得记？** 因为 `MAX_VALUE / 10 = 214748364`，末尾 `7`；`MIN_VALUE / 10 = -214748364`，末尾 `-8`。**这两个数字（7 和 8）不是随便来的，正是 int 边界值的最后一位。**\n\n**更简洁的写法（推荐）：统一用「除法回代」检查**\n```\nint digit = x % 10;\nif (res > Integer.MAX_VALUE / 10 || (res == Integer.MAX_VALUE / 10 && digit > 7)) return 0;\nif (res < Integer.MIN_VALUE / 10 || (res == Integer.MIN_VALUE / 10 && digit < -8)) return 0;\nres = res * 10 + digit;\n```\n\n**为什么这是最优？**\n- 时间 O(log x)（位数），空间 O(1)；\n- **完全不需要 64 位整数**，在任何只有 32 位整数的环境（比如某些嵌入式、某些语言）都能跑。\n\n**这个技巧的通用性强：** 任何「乘法累加可能溢出」的场景，都可以用「先除一下看边界」的方式预判。**比如大数乘法、累加求和、二分里的 `mid = (lo + hi) / 2` 改写成 `lo + (hi - lo) / 2`，都是同一类思想。**\n\n坑：\n1. 两个方向的边界都要检查；\n2. `digit > 7` 和 `digit < -8` 里的 7 和 8 是 int 边界的末位；\n3. 检查必须在 `res * 10 + digit` **之前**；\n4. 只要触发一次就立刻返回 0。",
    pseudocode: L(
      "输入：x",
      "输出：反转值，溢出则 0",
      "",
      "1. res = 0",
      "2. 当 x 不等于 0 循环：",
      "     digit = x 模 10",
      "     如果 res 大于 int 最大值 除以 10：return 0",
      "     如果 res 等于 int 最大值 除以 10 且 digit 大于 7：return 0",
      "     如果 res 小于 int 最小值 除以 10：return 0",
      "     如果 res 等于 int 最小值 除以 10 且 digit 小于 负 8：return 0",
      "     res = res 乘 10 加 digit",
      "     x = x 除以 10",
      "3. return res",
      "",
      "在乘法之前预判溢出，全程不需要 64 位整数",
      "7 和 8 是 int 边界值的最后一位，不是随意取的数字",
      "复杂度：时间 O(log x)；空间 O(1)"
    ),
    codeJava: L(
      "class Solution {",
      "    public int reverse(int x) {",
      "        int res = 0;",
      "        while (x != 0) {",
      "            int digit = x % 10;",
      "            if (res > Integer.MAX_VALUE / 10) return 0;",
      "            if (res == Integer.MAX_VALUE / 10 && digit > 7) return 0;",
      "            if (res < Integer.MIN_VALUE / 10) return 0;",
      "            if (res == Integer.MIN_VALUE / 10 && digit < -8) return 0;",
      "            res = res * 10 + digit;",
      "            x /= 10;",
      "        }",
      "        return res;",
      "    }",
      "}"
    ),
    timeComplexity: "O(log x)",
    spaceComplexity: "O(1)"
  }
]);

console.log("b28 done");
