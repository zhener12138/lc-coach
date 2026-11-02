// 位运算与数学收尾
const { L, write } = require("./lib");

// --------------------------------------------------- 136 single-number
write("single-number", [
  {
    tier: "brute",
    title: "HashMap 计数，找出现一次的",
    idea: "数组里只有一个数出现一次，其余都出现两次。找那个只出现一次的。\n\n最直接的想法：**用 HashMap 统计频次，再找频次为 1 的。**\n\n**为什么这是暴力？** 因为它用了 O(n) 额外空间，而这道题有一个 O(1) 空间的绝妙解法（异或）。**力扣本题明确要求「线性时间、常数空间」，所以这版不满足要求。**\n\n**但这版必须先写，因为它建立了「用频次找唯一元素」的基线思路。** 有了这个基线，才能体会到异或版的优雅——**你不需要统计每个数出现几次，只需要一个「能自动抵消」的运算。**\n\n**另一个暴力方向是排序：** 排序后相同的数会相邻，检查 `nums[i] != nums[i+1]` 就能找到落单的。**排序是 O(n log n) 时间、O(log n) 空间（快排递归栈）。** 两个暴力方向各有取舍，**这种「多条暴力路径」的思考习惯比记住答案更重要。**\n\n坑：\n1. 遍历 `entrySet` 找 value 为 1 的；\n2. 题目保证一定有答案；\n3. 用 `merge` 或 `getOrDefault` 计数。",
    pseudocode: L(
      "输入：数组 nums",
      "输出：只出现一次的那个数",
      "",
      "1. map = 空 HashMap",
      "2. 对 nums 里每个 x：map 里 x 的计数加 1",
      "3. 对 map 每个条目 (v, c)：如果 c 等于 1：return v",
      "4. return 负 1（题目保证不会到这里）",
      "",
      "用计数找唯一元素，但这用了 O(n) 额外空间",
      "题目要求常数空间，所以这版不满足要求",
      "复杂度：时间 O(n)；空间 O(n)"
    ),
    codeJava: L(
      "import java.util.*;",
      "",
      "class Solution {",
      "    public int singleNumber(int[] nums) {",
      "        Map<Integer, Integer> map = new HashMap<>();",
      "        for (int x : nums) map.merge(x, 1, Integer::sum);",
      "        for (Map.Entry<Integer, Integer> e : map.entrySet()) {",
      "            if (e.getValue() == 1) return e.getKey();",
      "        }",
      "        return -1;",
      "    }",
      "}"
    ),
    timeComplexity: "O(n)",
    spaceComplexity: "O(n)"
  },
  {
    tier: "better",
    title: "排序后找落单的相邻元素",
    idea: "排序后，相同的数会相邻。所以只要**两两成对检查**：`nums[0]==nums[1]`、`nums[2]==nums[3]`……某一对不相等，答案就是那对的第一个。\n\n**注意循环步长是 2 和边界处理：**\n```\nfor (int i = 0; i + 1 < n; i += 2) {\n    if (nums[i] != nums[i + 1]) return nums[i];\n}\nreturn nums[n - 1];  // 落单的在最后\n```\n\n**为什么这版比 HashMap 好？**\n- 空间从 O(n) 降到 O(log n)（快排递归栈）；\n- **不需要额外的数据结构**，直接在原数组上操作。\n\n**为什么还只是「较好」？**\n- 时间 O(n log n)，不是线性的；\n- 空间不是严格的 O(1)（递归栈）；\n- **而且它修改了入参数组** —— 如果调用方还要用原数组，这就是个副作用。\n\n**这版的教学价值在于「排序把问题变成了相邻比较」这个转化。** 很多题都靠这招：**遇到「找重复/找唯一」的问题，先想排序能不能让答案变成相邻元素的关系。** 比如 217 题（存在重复元素）、220 题（存在重复元素 III）都用到了这个思路。\n\n坑：\n1. 步长是 2；\n2. 循环条件是 `i + 1 < n`；\n3. 循环结束后如果没返回，答案在最后一个位置 `nums[n-1]`。",
    pseudocode: L(
      "输入：nums",
      "输出：只出现一次的数",
      "",
      "1. 对 nums 排序",
      "2. n = nums 长度",
      "3. 对 i 从 0 开始，每次加 2，当 i 加 1 小于 n：",
      "     如果 nums[i] 不等于 nums[i 加 1]：return nums[i]",
      "4. return nums[n 减 1]                      // 落单的在最后",
      "",
      "排序让相同的数相邻，问题变成成对比较",
      "时间 O(n log n) 且修改了入参，不是最优",
      "复杂度：时间 O(n log n)；空间 O(log n)"
    ),
    codeJava: L(
      "import java.util.*;",
      "",
      "class Solution {",
      "    public int singleNumber(int[] nums) {",
      "        Arrays.sort(nums);",
      "        int n = nums.length;",
      "        for (int i = 0; i + 1 < n; i += 2) {",
      "            if (nums[i] != nums[i + 1]) return nums[i];",
      "        }",
      "        return nums[n - 1];",
      "    }",
      "}"
    ),
    timeComplexity: "O(n log n)",
    spaceComplexity: "O(log n)"
  },
  {
    tier: "optimal",
    title: "异或：相同为 0，不损信息，O(1) 空间",
    idea: "**异或（XOR）是这题的完美工具，因为它的三条性质正好对应题目需求：**\n\n1. **`a ^ a = 0`** —— 相同抵消（「其余都出现两次」）；\n2. **`a ^ 0 = a`** —— 0 是单位元（落单的不受影响）；\n3. **满足交换律和结合律** —— 结果与顺序无关。\n\n所以把数组里所有数全部异或起来：\n- 每个出现两次的数都成对抵消成 0；\n- 只剩那个出现一次的数留在结果里。\n\n**代码只有三行，但背后的论证必须讲清楚：**\n```\nint res = 0;\nfor (int x : nums) res ^= x;\nreturn res;\n```\n\n**为什么初值必须是 0？** 因为 0 是异或的单位元，`0 ^ a = a`。**如果初值给别的数，就会把那个数混进答案。**\n\n**这个解法的最妙处在于：它不需要知道元素的范围、不需要额外空间、不修改入参、也不依赖数据有序。** 它唯一依赖的是「异或的自反性」这一条数学性质。\n\n**面试延伸（很可能被追问）：如果「其余数都出现三次」呢？** 那就不能直接用异或（三次异或等于自身）。**要按位统计每个二进制位上 1 的个数，对 3 取模。** 这就是 137 题（只出现一次的数字 II）：\n```\nint[] cnt = new int[32];\nfor (int x : nums) for (int b = 0; b < 32; b++) cnt[b] += (x >> b) & 1;\nint res = 0;\nfor (int b = 0; b < 32; b++) if (cnt[b] % 3 != 0) res |= 1 << b;\n```\n\n**从「两次用异或」到「三次用按位取模」，这条线索说明：位运算解法的本质是「构造一个能抵消 k 次的运算」。** 记住这条思想，整类题都能应对。\n\n坑：\n1. `res` 初值 0；\n2. 异或是 `^`，不是 `|` 或 `&`；\n3. 负数也能正常工作（Java 的 int 是补码，异或按位进行）。",
    pseudocode: L(
      "输入：nums",
      "输出：只出现一次的数",
      "",
      "1. res = 0                                // 0 是异或的单位元",
      "2. 对 nums 里每个 x：res = res 异或 x",
      "3. return res",
      "",
      "a 异或 a 等于 0，成对的全部抵消；a 异或 0 等于 a，落单的留下",
      "异或满足交换律结合律，所以与顺序无关",
      "复杂度：时间 O(n)；空间 O(1)"
    ),
    codeJava: L(
      "class Solution {",
      "    public int singleNumber(int[] nums) {",
      "        int res = 0;",
      "        for (int x : nums) res ^= x;",
      "        return res;",
      "    }",
      "}"
    ),
    timeComplexity: "O(n)",
    spaceComplexity: "O(1)"
  }
]);

// --------------------------------------------------- 137 single-number-ii
write("single-number-ii", [
  {
    tier: "brute",
    title: "HashMap 计数找频次为 1 的",
    idea: "这题是 136 的升级版：**其余数都出现三次**，只有一个出现一次。\n\n最直接的想法还是哈希表计数，找频次为 1 的。**O(n) 空间，O(n) 时间。**\n\n**为什么异或在这里失效了？** 因为 `a ^ a ^ a = a`（三次异或等于自身），**抵消不掉**。这正是本题的教学价值：**让你意识到「异或只能抵消偶数次」，遇到奇数次得换工具。**\n\n**这版的必要性在于确立基线，同时暴露「异或不够用」这个事实。** 很多人在 136 题学会了异或，然后在 137 题直接套用，结果错了——**这个坑必须通过亲手写出错误直觉才能建立警惕。**\n\n坑：\n1. 与 136 的哈希版几乎一致；\n2. 题目保证只有一个数出现一次；\n3. 如果题目改成「其余出现 k 次」，哈希版不用改，但正解要改。",
    pseudocode: L(
      "输入：nums",
      "输出：只出现一次的数",
      "",
      "1. map = 空 HashMap",
      "2. 对 nums 里每个 x：map 里 x 的计数加 1",
      "3. 对 map 每个条目 (v, c)：如果 c 等于 1：return v",
      "4. return 负 1",
      "",
      "异或无法处理三次，因为 a 异或 a 异或 a 仍等于 a",
      "复杂度：时间 O(n)；空间 O(n)"
    ),
    codeJava: L(
      "import java.util.*;",
      "",
      "class Solution {",
      "    public int singleNumber(int[] nums) {",
      "        Map<Integer, Integer> map = new HashMap<>();",
      "        for (int x : nums) map.merge(x, 1, Integer::sum);",
      "        for (Map.Entry<Integer, Integer> e : map.entrySet()) {",
      "            if (e.getValue() == 1) return e.getKey();",
      "        }",
      "        return -1;",
      "    }",
      "}"
    ),
    timeComplexity: "O(n)",
    spaceComplexity: "O(n)"
  },
  {
    tier: "better",
    title: "32 位数组统计每位的 1 的个数，对 3 取模",
    idea: "**核心思想：把所有数拆成 32 个二进制位，分别统计每一位上 1 出现的次数，然后对 3 取模。**\n\n为什么这有效？因为出现三次的数，它在某一位上的贡献是「3 的倍数」（要么 3 个 1，要么 0 个 1）。**只有那个落单的数，会让某一位的计数模 3 余 1。** 把余数为 1 的位拼起来，就是答案。\n\n**这个方法的通用性是它最大的价值：** 如果题目改成「其余出现 k 次」，只需要把 `% 3` 改成 `% k`。**这是「按位统计 + 模运算」这个范式能解决一整类问题，而不是一道题。**\n\n**取第 b 位的写法：`(x >> b) & 1`。** 注意 `>>` 是算术右移，负数会补 1 到高位——**但因为 `& 1` 只取最低位，所以不受影响。** 这个细节面试常问。\n\n**拼答案用 `res |= 1 << b`。** 用 `|=` 而不是 `+=`，因为每一位只会被设置一次，语义上更准确。\n\n**复杂度 O(32n) = O(n)，空间 O(32) = O(1)。** 严格来说已经满足「常数空间」要求了。\n\n**为什么还只是「较好」？** 因为还有个更精巧的解法（下一版），**用两个状态变量代替 32 个计数器**，把常数从 32 降到 1。**这在理论复杂度上没差别，但体现了对位运算更深的理解。**\n\n坑：\n1. `cnt` 数组长度 32（int 是 32 位）；\n2. 取位用 `(x >> b) & 1`；\n3. 拼接用 `res |= 1 << b`；\n4. 负数也能正确工作。",
    pseudocode: L(
      "输入：nums",
      "输出：只出现一次的数",
      "",
      "1. cnt = 长度 32 的数组",
      "2. 对 nums 里每个 x：",
      "     对 b 从 0 到 31：cnt[b] 加 ((x 右移 b) 位与 1)",
      "3. res = 0",
      "4. 对 b 从 0 到 31：",
      "     如果 cnt[b] 模 3 不等于 0：res 位或 (1 左移 b)",
      "5. return res",
      "",
      "出现三次的数对每一位的贡献是 3 的倍数，模 3 后消失",
      "把模 3 余 1 的位拼起来就是答案，改 k 次只需改成模 k",
      "复杂度：时间 O(32 乘 n) 即 O(n)；空间 O(32) 即 O(1)"
    ),
    codeJava: L(
      "class Solution {",
      "    public int singleNumber(int[] nums) {",
      "        int[] cnt = new int[32];",
      "        for (int x : nums) {",
      "            for (int b = 0; b < 32; b++) {",
      "                cnt[b] += (x >> b) & 1;",
      "            }",
      "        }",
      "",
      "        int res = 0;",
      "        for (int b = 0; b < 32; b++) {",
      "            if (cnt[b] % 3 != 0) res |= 1 << b;",
      "        }",
      "        return res;",
      "    }",
      "}"
    ),
    timeComplexity: "O(n)",
    spaceComplexity: "O(1)"
  },
  {
    tier: "optimal",
    title: "两个状态变量模拟三进制计数",
    idea: "上一版用了 32 个计数器（每个位置一个计数器）。**这一版把「32 个独立的三进制计数器」压缩成 2 个整数，用位并行模拟。**\n\n**思想：每个位的计数状态只需要 3 种（0、1、2），而 2 位二进制就能表示 3 个状态。** 所以用两个整数 `ones` 和 `twos`：\n- `ones` 的第 b 位为 1 表示「第 b 位当前计数 mod 3 == 1」；\n- `twos` 的第 b 位为 1 表示「第 b 位当前计数 mod 3 == 2」。\n\n**转移（每读入一个数 x）：**\n```\ntwos  |= ones & x;      // 计数 1 遇到 1 变成 2\ntwos  &= ~x;            // 但如果又是 0，就不该变（修正误升）\n// 更标准的写法是：\ntwos = twos ^ (ones & x);   // 不对，这样写有误\n```\n\n**这里是本题最难的地方，我用最清晰的经典写法：**\n```\nones = (ones ^ x) & ~twos;\ntwos = (twos ^ x) & ~ones;\n```\n\n**逐步理解：**\n\n**第一步 `ones = (ones ^ x) & ~twos`：**\n- `ones ^ x`：如果 x 的某位是 1，就翻转 ones 的对应位（计数 +1）；\n- `& ~twos`：如果 twos 的某位是 1（计数已经是 2），那么再加 1 应该变成 0 而不是回到 1，所以**用 `~twos` 把这些位清零**。\n\n**第二步 `twos = (twos ^ x) & ~ones`：**\n- 同样的逻辑，但要**用更新后的 `ones`**，因为「计数 2 再加 1 变成 0」这个判断依赖 ones 的新值。\n- **如果 ones 的某位现在是 1（计数回到 1），那 twos 对应位必须清零。**\n\n**最终答案就是 `ones`**（所有出现三次的位都归零了，只剩落单数的位）。\n\n**为什么这是最优？** 时间 O(n)，空间 O(1)，**并且常数从 32 降到 2 个寄存器操作**。理论上复杂度相同，实际上快一个数量级。\n\n**这个解法的真正难度在于「想到」。** 面试时如果 20 分钟内推不出来，**写 32 位数组版也完全可接受**（它同样满足 O(n) 时间和 O(1) 空间），**关键是把「按位统计 + 模 3」的思想讲清楚。** 硬憋不出最优解反而扣分。\n\n坑：\n1. **两步的顺序不能换**，第二步必须用更新后的 `ones`；\n2. 返回 `ones` 不是 `twos`；\n3. 这个写法对负数也正确（位运算按补码进行）。",
    pseudocode: L(
      "输入：nums",
      "输出：只出现一次的数",
      "",
      "1. ones = 0；twos = 0",
      "2. 对 nums 里每个 x：",
      "     ones = (ones 异或 x) 位与 (位取反 twos)",
      "     twos = (twos 异或 x) 位与 (位取反 ones)      // 必须用更新后的 ones",
      "3. return ones",
      "",
      "每个位的计数只可能是 0、1、2，用两个整数并行模拟 32 个三进制计数器",
      "ones 记录计数模 3 等于 1 的位，twos 记录等于 2 的位",
      "复杂度：时间 O(n)；空间 O(1)，常数从 32 降到 2"
    ),
    codeJava: L(
      "class Solution {",
      "    public int singleNumber(int[] nums) {",
      "        int ones = 0;",
      "        int twos = 0;",
      "        for (int x : nums) {",
      "            ones = (ones ^ x) & ~twos;",
      "            twos = (twos ^ x) & ~ones;",
      "        }",
      "        return ones;",
      "    }",
      "}"
    ),
    timeComplexity: "O(n)",
    spaceComplexity: "O(1)"
  }
]);

console.log("b26 done");
