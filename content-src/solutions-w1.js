/**
 * 解法内容库：只写「解法」，题面从力扣实时拉。
 * 结构：solutions[slug] = { solutions: [ {tier,title,idea,pseudocode,codeJava,timeComplexity,spaceComplexity} ] }
 *
 * 每个解法都必须有：
 *   tier        brute / better / optimal
 *   title       解法名（中文，说清楚"靠什么"）
 *   idea        思路（讲清为什么，不是复述代码）
 *   pseudocode  中文伪代码（先照着这个自己写，写不出再看代码）
 *   codeJava    可直接提交的 Java
 *   timeComplexity / spaceComplexity
 */

module.exports = {

  /* ========================= W1 · Day 1 ========================= */

  'two-sum': {
    solutions: [
      {
        tier: 'brute',
        title: '暴力双循环 · 枚举所有数对',
        idea:
          '最直白的想法：把所有两两组合都试一遍。外层 i 从 0 走到末尾，内层 j 从 i+1 走到末尾，' +
          '一旦 nums[i] + nums[j] == target 就返回。\n\n' +
          '为什么内层从 i+1 开始？因为题目要求同一个元素不能重复使用，而且 (i,j) 和 (j,i) 是同一对，' +
          '从 i+1 起既避免重复用元素，也避免重复枚举组合。\n\n' +
          '这版一定会超时（O(n²)），但它的价值是：**先把题意跑通**，确认你理解"返回下标不是返回值"。' +
          '面试时先说这一版，再说怎么优化，是加分项——说明你有从朴素到优化的完整思路。',
        pseudocode:
          '输入：nums 数组，target 目标值\n' +
          '输出：两个下标\n\n' +
          '1. n = nums 的长度\n' +
          '2. i 从 0 循环到 n-1：\n' +
          '     a. j 从 i+1 循环到 n-1：\n' +
          '          如果 nums[i] + nums[j] 等于 target：\n' +
          '              返回 [i, j]\n' +
          '3. 循环结束还没找到 → 返回空（题目保证有解，实际走不到这）\n\n' +
          '复杂度：时间 O(n²) 两层循环；空间 O(1) 只用了两个下标',
        codeJava:
          'class Solution {\n' +
          '    public int[] twoSum(int[] nums, int target) {\n' +
          '        int n = nums.length;\n' +
          '        for (int i = 0; i < n; i++) {\n' +
          '            for (int j = i + 1; j < n; j++) {\n' +
          '                if (nums[i] + nums[j] == target) {\n' +
          '                    return new int[]{i, j};\n' +
          '                }\n' +
          '            }\n' +
          '        }\n' +
          '        return new int[0];\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n²)',
        spaceComplexity: 'O(1)'
      },
      {
        tier: 'better',
        title: '先全部入 Map 再查 · 两次遍历',
        idea:
          '暴力慢在"每拿到一个数，都要把后面所有数再扫一遍"。\n' +
          '换成：先把所有数一次性放进 HashMap（值 → 下标），之后每拿到一个数 x，' +
          '直接问 Map"target - x 在不在"，一次哈希查找 O(1)。\n\n' +
          '这一步的本质是**用空间换时间**：把"找搭档"从线性扫描变成常数查找。\n\n' +
          '为什么还不是最优？因为它要遍历两次（一次建表、一次查找），而且有个坑：' +
          '如果 target = 2*x 且数组里只有一个 x，Map 会查到 x 自己，返回 [i, i]，错的。' +
          '必须额外判断"找到的下标 != 当前下标"。这个补丁让代码变丑了，也说明这个思路不够干净。',
        pseudocode:
          '1. 建一个 HashMap，键是数值，值是下标\n' +
          '2. 第一遍：i 从 0 到 n-1，把 nums[i] → i 放进 Map\n' +
          '   （注意：如果数组有重复值，后出现的会覆盖前面的，这在本题是隐患）\n' +
          '3. 第二遍：i 从 0 到 n-1：\n' +
          '     a. need = target - nums[i]\n' +
          '     b. 如果 Map 里有 need，且 Map[need] != i：\n' +
          '          返回 [i, Map[need]]\n' +
          '4. 返回空\n\n' +
          '复杂度：时间 O(n) 两次线性遍历；空间 O(n) 存 Map',
        codeJava:
          'import java.util.*;\n\n' +
          'class Solution {\n' +
          '    public int[] twoSum(int[] nums, int target) {\n' +
          '        Map<Integer, Integer> map = new HashMap<>();\n' +
          '        for (int i = 0; i < nums.length; i++) {\n' +
          '            map.put(nums[i], i);\n' +
          '        }\n' +
          '        for (int i = 0; i < nums.length; i++) {\n' +
          '            int need = target - nums[i];\n' +
          '            if (map.containsKey(need) && map.get(need) != i) {\n' +
          '                return new int[]{i, map.get(need)};\n' +
          '            }\n' +
          '        }\n' +
          '        return new int[0];\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)'
      },
      {
        tier: 'optimal',
        title: '边扫边查 · 一次遍历（面试标准答案）',
        idea:
          '上一版的问题：必须先建完整个表才能查，所以两次遍历，还得处理"查到自己"。\n\n' +
          '换个顺序就全解决了：**走到第 i 个数时，表里只有它前面的数**。\n' +
          '这时查 target - nums[i]，如果能查到，那个数一定在前面，下标必然 != i，' +
          '天然不会自己配自己，也天然不会重复使用元素。\n\n' +
          '所以顺序必须是「**先查、后存**」：\n' +
          '  查 → 找不到 → 把自己存进去，给后面的人当搭档。\n' +
          '如果写成「先存、后查」，当前元素刚进表就被自己查到了，直接错。\n\n' +
          '这一个顺序差异，就是这道题唯一的考点。记住它，比记住代码有用。',
        pseudocode:
          '1. 建一个空 HashMap，键是「数值」，值是「下标」\n' +
          '2. i 从 0 循环到 n-1：\n' +
          '     a. need = target - nums[i]        ← 我需要找的搭档\n' +
          '     b. 如果 Map 里有 need：\n' +
          '          返回 [Map[need], i]          ← 搭档在前，当前在后\n' +
          '     c. 把 nums[i] → i 存进 Map        ← 先查后存，关键顺序\n' +
          '3. 循环结束 → 无解\n\n' +
          '为什么 b 在 c 前面？因为这样表里永远只有「已经走过的」元素，\n' +
          '既保证不重复用同一个元素，也保证不会自己配自己。\n\n' +
          '复杂度：时间 O(n) 只扫一遍；空间 O(n)',
        codeJava:
          'import java.util.*;\n\n' +
          'class Solution {\n' +
          '    public int[] twoSum(int[] nums, int target) {\n' +
          '        Map<Integer, Integer> seen = new HashMap<>();\n' +
          '        for (int i = 0; i < nums.length; i++) {\n' +
          '            int need = target - nums[i];\n' +
          '            if (seen.containsKey(need)) {\n' +
          '                return new int[]{seen.get(need), i};\n' +
          '            }\n' +
          '            seen.put(nums[i], i);\n' +
          '        }\n' +
          '        return new int[0];\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)'
      }
    ]
  },

  'group-anagrams': {
    solutions: [
      {
        tier: 'brute',
        title: '两两比较 · 手动判断是否异位词',
        idea:
          '最直白：准备一个"已分组"列表，遍历每个字符串，看它能不能塞进已有的某一组。\n' +
          '判断两个字符串是否互为异位词，最朴素的办法是各自排序后比较——但这里每次都排序太浪费，' +
          '所以先用 26 长度的计数数组比一次。\n\n' +
          '这版的问题是：每个字符串都要和前面所有组比一遍，O(n²) 次比较，每次比较 O(k)。\n' +
          '面试里写出来能证明你理解题意，但一定要接着往下优化。',
        pseudocode:
          '1. groups = 空的列表，每个元素是一组（列表）\n' +
          '2. 对 strs 里每个字符串 s：\n' +
          '     a. 遍历 groups，对每一组 g：\n' +
          '          如果 isAnagram(s, g 的第一个元素) 为真：\n' +
          '              把 s 加进 g，跳出，处理下一个 s\n' +
          '     b. 如果所有组都不匹配：新建一组 [s]，加进 groups\n' +
          '3. 返回 groups\n\n' +
          'isAnagram(a, b) 的做法：\n' +
          '   长度不等 → false\n' +
          '   建 26 长度计数数组，a 里每个字符 +1，b 里每个字符 -1\n' +
          '   最后全为 0 → true\n\n' +
          '复杂度：时间 O(n² · k)；空间 O(n · k)',
        codeJava:
          'import java.util.*;\n\n' +
          'class Solution {\n' +
          '    public List<List<String>> groupAnagrams(String[] strs) {\n' +
          '        List<List<String>> groups = new ArrayList<>();\n' +
          '        for (String s : strs) {\n' +
          '            boolean placed = false;\n' +
          '            for (List<String> g : groups) {\n' +
          '                if (isAnagram(s, g.get(0))) {\n' +
          '                    g.add(s);\n' +
          '                    placed = true;\n' +
          '                    break;\n' +
          '                }\n' +
          '            }\n' +
          '            if (!placed) {\n' +
          '                List<String> g = new ArrayList<>();\n' +
          '                g.add(s);\n' +
          '                groups.add(g);\n' +
          '            }\n' +
          '        }\n' +
          '        return groups;\n' +
          '    }\n\n' +
          '    private boolean isAnagram(String a, String b) {\n' +
          '        if (a.length() != b.length()) return false;\n' +
          '        int[] cnt = new int[26];\n' +
          '        for (int i = 0; i < a.length(); i++) {\n' +
          '            cnt[a.charAt(i) - \'a\']++;\n' +
          '            cnt[b.charAt(i) - \'a\']--;\n' +
          '        }\n' +
          '        for (int c : cnt) if (c != 0) return false;\n' +
          '        return true;\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n² · k)',
        spaceComplexity: 'O(n · k)'
      },
      {
        tier: 'better',
        title: '排序当签名 · 一次分组',
        idea:
          '上面慢的根源是"两两比较"。能不能不算比较，直接让异位词自己落到同一个桶里？\n\n' +
          '关键洞察：**异位词排序后完全相同**。"eat"、"tea"、"ate" 排序后都是 "aet"。\n' +
          '所以把每个字符串排序，排序结果就是它的"身份证"。用 HashMap<身份证, 这一组的成员>，' +
          '一次遍历就能分好组。\n\n' +
          '这是「**用规范化形式做 key**」这个套路的最典型应用。以后遇到"本质相同但形式不同"的分组题，' +
          '第一反应就该是：能不能算出一个规范形式当 key。\n\n' +
          '复杂度 O(n · k log k)，瓶颈在排序。还能更快吗？能——下面用计数代替排序。',
        pseudocode:
          '1. 建 HashMap，键是「排序后的字符串」，值是「这一组的字符串列表」\n' +
          '2. 对 strs 里每个 s：\n' +
          '     a. chars = s 转成字符数组\n' +
          '     b. 对 chars 排序\n' +
          '     c. key = chars 转回字符串\n' +
          '     d. 如果 Map 里没有 key：新建一个空列表放进去\n' +
          '     e. 把 s 加进 Map[key] 那个列表\n' +
          '3. 返回 Map 的所有值（转成 List）\n\n' +
          '复杂度：时间 O(n · k log k)；空间 O(n · k)',
        codeJava:
          'import java.util.*;\n\n' +
          'class Solution {\n' +
          '    public List<List<String>> groupAnagrams(String[] strs) {\n' +
          '        Map<String, List<String>> map = new HashMap<>();\n' +
          '        for (String s : strs) {\n' +
          '            char[] cs = s.toCharArray();\n' +
          '            Arrays.sort(cs);\n' +
          '            String key = new String(cs);\n' +
          '            map.computeIfAbsent(key, k -> new ArrayList<>()).add(s);\n' +
          '        }\n' +
          '        return new ArrayList<>(map.values());\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n · k log k)',
        spaceComplexity: 'O(n · k)'
      },
      {
        tier: 'optimal',
        title: '字符计数当签名 · 免排序',
        idea:
          '排序要 O(k log k)。但字符串只含小写字母，我们完全可以用「每个字母出现几次」这个 26 位数组当身份证，' +
          '统计只要 O(k)。\n\n' +
          '难点在于：数组不能直接当 HashMap 的 key（数组的 hashCode 是地址，不是内容）。' +
          '两个办法：\n' +
          '  1. 把计数数组拼成一个字符串，比如 [1,0,0,...,1,0] → "#1#0#0...#1#0"，用它当 key。\n' +
          '  2. 用 Arrays.toString(cnt) 直接生成 "[1, 0, 0, ...]"。\n\n' +
          '这里有个必须讲清的细节：**分隔符不能省**。如果直接把数字拼成 "100...10"，' +
          '那么 [1,10,...] 和 [11,0,...] 会拼出同一个串，key 撞车。加分隔符才安全。\n\n' +
          '这个"计数当签名"的思路还能推广到：判断两个串是否异位词、找所有异位词、' +
          '甚至字符串的滑动窗口题里判断窗口内容是否匹配。',
        pseudocode:
          '1. 建 HashMap，键是「26 位计数拼成的字符串」，值是「这一组的字符串列表」\n' +
          '2. 对 strs 里每个 s：\n' +
          '     a. cnt = 长度 26 的数组，全 0\n' +
          '     b. 对 s 里每个字符 c：cnt[c - \'a\']++\n' +
          '     c. key = 把 cnt 每个数字用分隔符拼起来（如 1#0#0#...#2）\n' +
          '     d. 把 s 加进 Map[key] 对应的列表（没有就新建）\n' +
          '3. 返回 Map 所有值\n\n' +
          '为什么能省掉排序？因为「每个字母几个」这件事已经完全刻画了异位词，\n' +
          '顺序信息本来就不需要。\n\n' +
          '复杂度：时间 O(n · k)；空间 O(n · k)',
        codeJava:
          'import java.util.*;\n\n' +
          'class Solution {\n' +
          '    public List<List<String>> groupAnagrams(String[] strs) {\n' +
          '        Map<String, List<String>> map = new HashMap<>();\n' +
          '        for (String s : strs) {\n' +
          '            int[] cnt = new int[26];\n' +
          '            for (int i = 0; i < s.length(); i++) {\n' +
          '                cnt[s.charAt(i) - \'a\']++;\n' +
          '            }\n' +
          '            StringBuilder sb = new StringBuilder();\n' +
          '            for (int c : cnt) {\n' +
          '                sb.append(c).append(\'#\');\n' +
          '            }\n' +
          '            map.computeIfAbsent(sb.toString(), k -> new ArrayList<>()).add(s);\n' +
          '        }\n' +
          '        return new ArrayList<>(map.values());\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n · k)',
        spaceComplexity: 'O(n · k)'
      }
    ]
  },

  /* ========================= W1 · Day 2 ========================= */

  'longest-consecutive-sequence': {
    solutions: [
      {
        tier: 'brute',
        title: '排序后扫一遍',
        idea:
          '要找"连续序列"，最自然的想法是先排序，连续的数字就挨在一起了。\n' +
          '排序后从前往后扫，维护当前连续长度，遇到断开就重置。\n\n' +
          '注意两个坑：\n' +
          '  1. **要去重**。排序后可能有 [1,2,2,3]，重复元素不能算长度 +1。\n' +
          '  2. 空数组要单独处理。\n\n' +
          '这版复杂度 O(n log n)，题目要求 O(n)，所以不是最终答案。\n' +
          '但面试时先写它、再说"排序是 O(n log n)，我们能不能不排序"，是很自然的过渡。',
        pseudocode:
          '1. 如果数组为空 → 返回 0\n' +
          '2. 复制一份并排序\n' +
          '3. best = 1，cur = 1\n' +
          '4. i 从 1 循环到 n-1：\n' +
          '     a. 如果 nums[i] == nums[i-1]：跳过（重复不算）\n' +
          '     b. 如果 nums[i] == nums[i-1] + 1：cur++，best = max(best, cur)\n' +
          '     c. 否则（断开）：cur = 1\n' +
          '5. 返回 best\n\n' +
          '复杂度：时间 O(n log n) 排序主导；空间 O(n) 复制数组',
        codeJava:
          'import java.util.*;\n\n' +
          'class Solution {\n' +
          '    public int longestConsecutive(int[] nums) {\n' +
          '        if (nums.length == 0) return 0;\n' +
          '        int[] a = nums.clone();\n' +
          '        Arrays.sort(a);\n' +
          '        int best = 1, cur = 1;\n' +
          '        for (int i = 1; i < a.length; i++) {\n' +
          '            if (a[i] == a[i - 1]) continue;\n' +
          '            if (a[i] == a[i - 1] + 1) {\n' +
          '                cur++;\n' +
          '                best = Math.max(best, cur);\n' +
          '            } else {\n' +
          '                cur = 1;\n' +
          '            }\n' +
          '        }\n' +
          '        return best;\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n log n)',
        spaceComplexity: 'O(n)'
      },
      {
        tier: 'better',
        title: '哈希集合 + 只从起点出发',
        idea:
          '题目要求 O(n)，那就不能排序。用 HashSet 把所有数装进去，实现 O(1) 的"某个数在不在"查询。\n\n' +
          '关键洞察在这里：**一段连续序列 [x, x+1, ..., x+k] 只有 x 是"起点"**，' +
          '因为 x-1 不在集合里。所以：\n' +
          '  只对"起点"往下数（x+1, x+2, ... 一直数到断），\n' +
          '  非起点直接跳过。\n\n' +
          '为什么这样是 O(n) 而不是 O(n²)？因为**每个数最多被数到一次**——' +
          '只有它属于的那段序列从起点出发时，才会被访问。总访问次数 ≤ 2n。\n\n' +
          '这是"只从起点出发"这个剪枝的价值。很多人写成了对每个数都往下数，那就是 O(n²) 了。',
        pseudocode:
          '1. 把所有数放进 HashSet（自动去重）\n' +
          '2. best = 0\n' +
          '3. 对 set 里每个数 x：\n' +
          '     a. 如果 set 里有 x-1：跳过（x 不是起点，它前面还有人）\n' +
          '     b. 否则 x 是起点：\n' +
          '          cur = x，len = 1\n' +
          '          当 set 里有 cur+1：cur++，len++\n' +
          '          best = max(best, len)\n' +
          '4. 返回 best\n\n' +
          '为什么是线性的：每个数只会被"从它所属序列的起点"访问一次，\n' +
          '总共 O(n) 次 while 迭代。\n\n' +
          '复杂度：时间 O(n)；空间 O(n)',
        codeJava:
          'import java.util.*;\n\n' +
          'class Solution {\n' +
          '    public int longestConsecutive(int[] nums) {\n' +
          '        Set<Integer> set = new HashSet<>();\n' +
          '        for (int x : nums) set.add(x);\n\n' +
          '        int best = 0;\n' +
          '        for (int x : set) {\n' +
          '            if (set.contains(x - 1)) continue;\n' +
          '            int cur = x, len = 1;\n' +
          '            while (set.contains(cur + 1)) {\n' +
          '                cur++;\n' +
          '                len++;\n' +
          '            }\n' +
          '            best = Math.max(best, len);\n' +
          '        }\n' +
          '        return best;\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)'
      },
      {
        tier: 'optimal',
        title: '哈希表记录「以 x 结尾的最长长度」· 一遍扫描',
        idea:
          '上一版虽然也是 O(n)，但要先把所有数装进集合，再遍历一遍，两趟。\n' +
          '能不能边扫边算，一趟搞定？\n\n' +
          '用 HashMap 存「**以某个数结尾的连续序列长度**」。扫到 x 时：\n' +
          '  left  = map.getOrDefault(x-1, 0)   ← x 左边接上多长\n' +
          '  right = map.getOrDefault(x+1, 0)   ← x 右边接上多长\n' +
          '  当前这段总长 len = left + 1 + right\n' +
          '然后把 len 写到这段的**两个端点**上：map[x-left] = len，map[x+1+right] = len。\n\n' +
          '为什么只写两个端点？因为以后只有端点会被当成"邻居"查询——' +
          '中间的数不会再被查 x-1 / x+1 了（它们已经连起来了）。这样省空间，也保证正确。\n\n' +
          '这版是 O(n) 一趟，但代码明显比上一版难写、难讲。**面试时更推荐上一版**——' +
          '清晰度比省一趟遍历重要得多。这里列出来是为了让你知道存在这种写法。',
        pseudocode:
          '1. 建 HashMap，键是数值，值是「以它为端点的连续段长度」\n' +
          '2. best = 0\n' +
          '3. 对 nums 里每个 x：\n' +
          '     a. 如果 map 里已经有 x：跳过（重复元素）\n' +
          '     b. left = map 里 x-1 的长度（没有就 0）\n' +
          '     c. right = map 里 x+1 的长度（没有就 0）\n' +
          '     d. len = left + 1 + right\n' +
          '     e. map[x] = len\n' +
          '     f. map[x - left] = len      ← 更新左端点\n' +
          '     g. map[x + 1 + right] = len ← 更新右端点\n' +
          '     h. best = max(best, len)\n' +
          '4. 返回 best\n\n' +
          '复杂度：时间 O(n)；空间 O(n)',
        codeJava:
          'import java.util.*;\n\n' +
          'class Solution {\n' +
          '    public int longestConsecutive(int[] nums) {\n' +
          '        Map<Integer, Integer> map = new HashMap<>();\n' +
          '        int best = 0;\n' +
          '        for (int x : nums) {\n' +
          '            if (map.containsKey(x)) continue;\n' +
          '            int left = map.getOrDefault(x - 1, 0);\n' +
          '            int right = map.getOrDefault(x + 1, 0);\n' +
          '            int len = left + 1 + right;\n' +
          '            map.put(x, len);\n' +
          '            map.put(x - left, len);\n' +
          '            map.put(x + 1 + right, len);\n' +
          '            best = Math.max(best, len);\n' +
          '        }\n' +
          '        return best;\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)'
      }
    ]
  },

  'move-zeroes': {
    solutions: [
      {
        tier: 'brute',
        title: '遇到 0 就整体左移 · 逐位搬',
        idea:
          '最直白的想法：从左往右扫，一旦遇到 0，就把后面所有元素整体往前挪一位，末尾补 0，' +
          '然后 i 不动（因为挪过来的新元素还没检查）。\n\n' +
          '这是最符合"人的直觉"的写法，但每次遇到 0 都要搬 O(n) 个元素，' +
          '如果数组里 0 很多，就是 O(n²)。\n\n' +
          '写它的价值：确认你理解"必须原地修改、不能新建数组"。',
        pseudocode:
          '1. i = 0\n' +
          '2. 当 i < n：\n' +
          '     a. 如果 nums[i] == 0：\n' +
          '          j 从 i 循环到 n-2：nums[j] = nums[j+1]   ← 整体左移\n' +
          '          nums[n-1] = 0                          ← 末尾补 0\n' +
          '          （i 不前进，因为新来的数还没看）\n' +
          '     b. 否则 i++\n\n' +
          '复杂度：时间 O(n²)；空间 O(1)',
        codeJava:
          'class Solution {\n' +
          '    public void moveZeroes(int[] nums) {\n' +
          '        int n = nums.length;\n' +
          '        int i = 0;\n' +
          '        while (i < n) {\n' +
          '            if (nums[i] == 0) {\n' +
          '                for (int j = i; j < n - 1; j++) {\n' +
          '                    nums[j] = nums[j + 1];\n' +
          '                }\n' +
          '                nums[n - 1] = 0;\n' +
          '            } else {\n' +
          '                i++;\n' +
          '            }\n' +
          '        }\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n²)',
        spaceComplexity: 'O(1)'
      },
      {
        tier: 'better',
        title: '非零元素前移 + 末尾补零',
        idea:
          '换个角度看：题目要的是「所有非零元素保持相对顺序挤到前面，0 全丢后面」。\n' +
          '那就别管 0 了，只做一件事：**把非零元素一个个往前放**。\n\n' +
          '用一个写指针 write，遍历读指针 read：遇到非零就写到 nums[write]，write++。\n' +
          '遍历完后，从 write 到末尾全部填 0。\n\n' +
          '这就是「**双指针：读指针探路，写指针落位**」的标准模板。\n' +
          '这个模板后面在「删除重复项」「移除元素」等题里会反复出现，值得记住。\n\n' +
          'O(n) 时间，两趟（一趟搬非零，一趟补零）。还能一趟吗？能。',
        pseudocode:
          '1. write = 0\n' +
          '2. read 从 0 循环到 n-1：\n' +
          '     如果 nums[read] != 0：\n' +
          '         nums[write] = nums[read]\n' +
          '         write++\n' +
          '3. 从 write 循环到 n-1：nums[i] = 0\n\n' +
          '注意：write 一定 ≤ read，所以不会覆盖还没读的数据。\n\n' +
          '复杂度：时间 O(n)；空间 O(1)',
        codeJava:
          'class Solution {\n' +
          '    public void moveZeroes(int[] nums) {\n' +
          '        int write = 0;\n' +
          '        for (int read = 0; read < nums.length; read++) {\n' +
          '            if (nums[read] != 0) {\n' +
          '                nums[write++] = nums[read];\n' +
          '            }\n' +
          '        }\n' +
          '        for (int i = write; i < nums.length; i++) {\n' +
          '            nums[i] = 0;\n' +
          '        }\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)'
      },
      {
        tier: 'optimal',
        title: '交换法 · 一趟扫描',
        idea:
          '上一版要两趟。能不能一趟？\n\n' +
          '可以：读指针遇到非零元素时，**直接和写指针位置交换**，而不是覆盖。\n' +
          '因为写指针指向的位置，要么就是读指针自己（前面没有 0），要么是前面遇到的 0 的位置。\n' +
          '交换之后，那个 0 就被换到后面去了，天然完成了"补零"。\n\n' +
          '关键细节：如果 write == read（前面没遇到过 0），交换是自己和自己换，' +
          '虽然无害但多做了一次赋值，所以加 `if (write != read)` 判断更干净。\n\n' +
          '这版一趟 O(n)，代码只多两行。是这道题的最优写法。',
        pseudocode:
          '1. write = 0\n' +
          '2. read 从 0 循环到 n-1：\n' +
          '     如果 nums[read] != 0：\n' +
          '         如果 write != read：交换 nums[write] 和 nums[read]\n' +
          '         write++\n\n' +
          '为什么交换就够了：write 位置要么是 read 自己，要么是之前跳过的 0，\n' +
          '把非零换到前面、0 换到后面，正好是题目要的。\n\n' +
          '复杂度：时间 O(n) 一趟；空间 O(1)',
        codeJava:
          'class Solution {\n' +
          '    public void moveZeroes(int[] nums) {\n' +
          '        int write = 0;\n' +
          '        for (int read = 0; read < nums.length; read++) {\n' +
          '            if (nums[read] != 0) {\n' +
          '                if (write != read) {\n' +
          '                    int tmp = nums[write];\n' +
          '                    nums[write] = nums[read];\n' +
          '                    nums[read] = tmp;\n' +
          '                }\n' +
          '                write++;\n' +
          '            }\n' +
          '        }\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)'
      }
    ]
  },

  /* ========================= W1 · Day 3 ========================= */

  'maximum-subarray': {
    solutions: [
      {
        tier: 'brute',
        title: '枚举所有子数组 · 三重循环（可优化成两重）',
        idea:
          '最直白：把所有子数组都列出来，求和，取最大。\n' +
          'i 是起点，j 是终点，中间 k 累加。三重循环 O(n³)。\n\n' +
          '但注意一个优化：当 i 固定、j 往后走时，sum 是累加的，不用每次重新算。\n' +
          '所以只写两重循环就够了，O(n²)。这个"边扩展边累加"的观察，\n' +
          '其实就是后面 DP 的雏形。\n\n' +
          '面试里写 O(n²) 会被要求优化，但它是理解 DP 的必经台阶。',
        pseudocode:
          '1. best = 负无穷\n' +
          '2. i 从 0 循环到 n-1：        ← 枚举起点\n' +
          '     sum = 0\n' +
          '     j 从 i 循环到 n-1：       ← 枚举终点，边扩展边累加\n' +
          '          sum += nums[j]\n' +
          '          best = max(best, sum)\n' +
          '3. 返回 best\n\n' +
          '复杂度：时间 O(n²)；空间 O(1)',
        codeJava:
          'class Solution {\n' +
          '    public int maxSubArray(int[] nums) {\n' +
          '        int best = Integer.MIN_VALUE;\n' +
          '        for (int i = 0; i < nums.length; i++) {\n' +
          '            int sum = 0;\n' +
          '            for (int j = i; j < nums.length; j++) {\n' +
          '                sum += nums[j];\n' +
          '                best = Math.max(best, sum);\n' +
          '            }\n' +
          '        }\n' +
          '        return best;\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n²)',
        spaceComplexity: 'O(1)'
      },
      {
        tier: 'better',
        title: '分治 · 跨中点最大和',
        idea:
          '把数组从中间劈开，最大子数组只有三种可能：\n' +
          '  1. 完全在左半边 → 递归求左边\n' +
          '  2. 完全在右半边 → 递归求右边\n' +
          '  3. **跨越中点** → 从中点往左找最大后缀和，往右找最大前缀和，加起来\n\n' +
          '第三种情况是关键：从中点开始向两侧扩展，各自取最大，拼起来就是以中点为中心的跨段最大和。\n\n' +
          '复杂度 O(n log n)，比 O(n²) 好，但不是最优。\n' +
          '这版的价值在于训练"分治"思维——很多题（归并排序、逆序对、最近点对）都是这个套路。\n\n' +
          '面试时提一嘴分治是加分，但别把它当最终答案。',
        pseudocode:
          'solve(lo, hi):\n' +
          '  1. 如果 lo == hi → 返回 nums[lo]        ← 只有一个元素\n' +
          '  2. mid = (lo + hi) / 2\n' +
          '  3. leftMax  = solve(lo, mid)            ← 情况 1\n' +
          '  4. rightMax = solve(mid+1, hi)          ← 情况 2\n' +
          '  5. 算跨中点：\n' +
          '       sum = 0，lBest = 负无穷\n' +
          '       i 从 mid 往 lo 倒着走：sum += nums[i]，lBest = max(lBest, sum)\n' +
          '       sum = 0，rBest = 负无穷\n' +
          '       i 从 mid+1 往 hi 正着走：sum += nums[i]，rBest = max(rBest, sum)\n' +
          '       crossMax = lBest + rBest           ← 情况 3\n' +
          '  6. 返回 max(leftMax, rightMax, crossMax)\n\n' +
          '复杂度：时间 O(n log n)；空间 O(log n) 递归栈',
        codeJava:
          'class Solution {\n' +
          '    public int maxSubArray(int[] nums) {\n' +
          '        return solve(nums, 0, nums.length - 1);\n' +
          '    }\n\n' +
          '    private int solve(int[] a, int lo, int hi) {\n' +
          '        if (lo == hi) return a[lo];\n' +
          '        int mid = lo + (hi - lo) / 2;\n' +
          '        int leftMax  = solve(a, lo, mid);\n' +
          '        int rightMax = solve(a, mid + 1, hi);\n\n' +
          '        int sum = 0, lBest = Integer.MIN_VALUE;\n' +
          '        for (int i = mid; i >= lo; i--) {\n' +
          '            sum += a[i];\n' +
          '            lBest = Math.max(lBest, sum);\n' +
          '        }\n' +
          '        sum = 0;\n' +
          '        int rBest = Integer.MIN_VALUE;\n' +
          '        for (int i = mid + 1; i <= hi; i++) {\n' +
          '            sum += a[i];\n' +
          '            rBest = Math.max(rBest, sum);\n' +
          '        }\n' +
          '        return Math.max(Math.max(leftMax, rightMax), lBest + rBest);\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n log n)',
        spaceComplexity: 'O(log n)'
      },
      {
        tier: 'optimal',
        title: 'Kadane 算法 · 一趟扫描的 DP',
        idea:
          '这是本题标准答案，也是「线性 DP」最经典的入门题。\n\n' +
          '定义 f[i] = **以 nums[i] 结尾**的最大子数组和。注意是"以 i 结尾"，不是"前 i 个里最大的"。\n' +
          '这个定义是关键——只有固定结尾，才能写出转移方程。\n\n' +
          '转移：f[i] = max(nums[i], f[i-1] + nums[i])\n' +
          '含义：要么自己单开一段，要么接上前面的。**哪个大选哪个**。\n\n' +
          '为什么可以这样？因为如果 f[i-1] 是负数，接上它只会拖累，不如从 nums[i] 重新开始。\n' +
          '所以 `f[i-1] > 0` 就接，否则不接。这就是"**前缀和为负就丢弃**"的直觉。\n\n' +
          '答案 = 所有 f[i] 里的最大值。\n\n' +
          '因为 f[i] 只依赖 f[i-1]，可以用一个变量滚动，空间降到 O(1)。',
        pseudocode:
          '1. cur = nums[0]      ← 以当前位置结尾的最大和\n' +
          '2. best = nums[0]     ← 全局最大\n' +
          '3. i 从 1 循环到 n-1：\n' +
          '     a. cur = max(nums[i], cur + nums[i])\n' +
          '        （cur > 0 就接上，否则从 nums[i] 重新开始）\n' +
          '     b. best = max(best, cur)\n' +
          '4. 返回 best\n\n' +
          '为什么 cur 用 max 而不是 if：等价写法，max 更短。\n' +
          '为什么初始值是 nums[0] 不是 0：因为数组可能全是负数，\n' +
          '   如果初始化成 0，答案会错成 0。\n\n' +
          '复杂度：时间 O(n)；空间 O(1)',
        codeJava:
          'class Solution {\n' +
          '    public int maxSubArray(int[] nums) {\n' +
          '        int cur = nums[0];\n' +
          '        int best = nums[0];\n' +
          '        for (int i = 1; i < nums.length; i++) {\n' +
          '            cur = Math.max(nums[i], cur + nums[i]);\n' +
          '            best = Math.max(best, cur);\n' +
          '        }\n' +
          '        return best;\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)'
      }
    ]
  },

  'product-of-array-except-self': {
    solutions: [
      {
        tier: 'brute',
        title: '对每个位置都重新乘一遍',
        idea:
          '最直白：对每个 i，遍历整个数组，跳过 i，把其他数乘起来。\n\n' +
          'O(n²)，而且题目明确要求「不能用除法、O(n)」，所以这版会被拒。\n' +
          '但它是理解题意的起点：**答案里第 i 位 = 左边所有数的积 × 右边所有数的积**。\n' +
          '这句话就是后面所有优化的根。',
        pseudocode:
          '1. 建结果数组 ans，长度 n\n' +
          '2. i 从 0 循环到 n-1：\n' +
          '     p = 1\n' +
          '     j 从 0 循环到 n-1：\n' +
          '         如果 j != i：p *= nums[j]\n' +
          '     ans[i] = p\n' +
          '3. 返回 ans\n\n' +
          '复杂度：时间 O(n²)；空间 O(1) 不算输出',
        codeJava:
          'class Solution {\n' +
          '    public int[] productExceptSelf(int[] nums) {\n' +
          '        int n = nums.length;\n' +
          '        int[] ans = new int[n];\n' +
          '        for (int i = 0; i < n; i++) {\n' +
          '            long p = 1;\n' +
          '            for (int j = 0; j < n; j++) {\n' +
          '                if (j != i) p *= nums[j];\n' +
          '            }\n' +
          '            ans[i] = (int) p;\n' +
          '        }\n' +
          '        return ans;\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n²)',
        spaceComplexity: 'O(1)'
      },
      {
        tier: 'better',
        title: '左右乘积数组 · 前缀积 + 后缀积',
        idea:
          '既然 ans[i] = 左边积 × 右边积，那就**分别把左边积和右边积算出来存好**。\n\n' +
          '  left[i]  = nums[0] * nums[1] * ... * nums[i-1]   （不含 i）\n' +
          '  right[i] = nums[i+1] * ... * nums[n-1]           （不含 i）\n' +
          '  ans[i]   = left[i] * right[i]\n\n' +
          'left 从左往右扫一遍就能填好，right 从右往左扫一遍。各 O(n)。\n\n' +
          '这版时间已经 O(n) 了，但用了两个额外数组 O(n) 空间。\n' +
          '题目进阶要求「O(1) 额外空间」，所以还能再压。',
        pseudocode:
          '1. n = nums 长度\n' +
          '2. left = 长度 n 的数组，right = 长度 n 的数组\n' +
          '3. left[0] = 1\n' +
          '   i 从 1 到 n-1：left[i] = left[i-1] * nums[i-1]\n' +
          '4. right[n-1] = 1\n' +
          '   i 从 n-2 倒到 0：right[i] = right[i+1] * nums[i+1]\n' +
          '5. ans[i] = left[i] * right[i]，对每个 i\n' +
          '6. 返回 ans\n\n' +
          '复杂度：时间 O(n)；空间 O(n)',
        codeJava:
          'class Solution {\n' +
          '    public int[] productExceptSelf(int[] nums) {\n' +
          '        int n = nums.length;\n' +
          '        int[] left  = new int[n];\n' +
          '        int[] right = new int[n];\n' +
          '        left[0] = 1;\n' +
          '        for (int i = 1; i < n; i++) left[i] = left[i - 1] * nums[i - 1];\n' +
          '        right[n - 1] = 1;\n' +
          '        for (int i = n - 2; i >= 0; i--) right[i] = right[i + 1] * nums[i + 1];\n' +
          '        int[] ans = new int[n];\n' +
          '        for (int i = 0; i < n; i++) ans[i] = left[i] * right[i];\n' +
          '        return ans;\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)'
      },
      {
        tier: 'optimal',
        title: '输出数组复用 · O(1) 额外空间',
        idea:
          '上一版用了 left 和 right 两个数组。但注意：**ans 数组本身是必须的**（要返回它）。\n' +
          '所以我们可以把 left 直接算进 ans 里，right 用一个变量滚动。\n\n' +
          '两步走：\n' +
          '  第一趟（从左往右）：ans[i] 先存 left[i]（即 i 左边所有数的积）。\n' +
          '  第二趟（从右往左）：用一个变量 r 维护"i 右边所有数的积"，\n' +
          '                      边走边把 ans[i] *= r，然后 r *= nums[i]。\n\n' +
          '这样只多了一个变量 r，额外空间 O(1)。这就是题目的进阶要求。\n\n' +
          '注意用 long 还是 int：题目保证结果在 int 范围内，所以 int 够用。\n' +
          '但如果自己写测试数据，用 long 中转更稳。',
        pseudocode:
          '1. n = nums 长度，ans = 长度 n 的数组\n' +
          '2. ans[0] = 1\n' +
          '   i 从 1 到 n-1：ans[i] = ans[i-1] * nums[i-1]     ← 先把左边积存进 ans\n' +
          '3. r = 1                                            ← r 表示右边积\n' +
          '   i 从 n-1 倒到 0：\n' +
          '     a. ans[i] = ans[i] * r                         ← 左边积 × 右边积\n' +
          '     b. r = r * nums[i]                             ← 把 nums[i] 并入右边积，给下一位用\n' +
          '4. 返回 ans\n\n' +
          '为什么 b 在 a 后面：算 ans[i] 时 r 必须只含 i 右边的数，不能含 nums[i]。\n\n' +
          '复杂度：时间 O(n)；空间 O(1) 额外（输出数组不算）',
        codeJava:
          'class Solution {\n' +
          '    public int[] productExceptSelf(int[] nums) {\n' +
          '        int n = nums.length;\n' +
          '        int[] ans = new int[n];\n\n' +
          '        ans[0] = 1;\n' +
          '        for (int i = 1; i < n; i++) {\n' +
          '            ans[i] = ans[i - 1] * nums[i - 1];\n' +
          '        }\n\n' +
          '        int r = 1;\n' +
          '        for (int i = n - 1; i >= 0; i--) {\n' +
          '            ans[i] = ans[i] * r;\n' +
          '            r = r * nums[i];\n' +
          '        }\n' +
          '        return ans;\n' +
          '    }\n' +
          '}',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)'
      }
    ]
  }

};
