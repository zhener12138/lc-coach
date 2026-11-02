/**
 * 把一批新模板写进模板库。
 *
 * 为什么用脚本而不是手点页面：一次要加几十条，手点会漏、会重复，
 * 而且脚本能保证「同一 category+title 已存在就跳过」，可以反复跑。
 *
 * 用法：node content-src/seed-snippets.js
 */
const B = 'http://127.0.0.1:8099';

// 每条：分类 / 标题 / 一句话说明（什么时候用）/ Java 代码
// 说明写「什么时候用」而不是「这是什么」——查模板的人已经知道它是什么了
const SNIPPETS = [
  // ========== 单调栈 ==========
  {
    category: '单调栈',
    title: '下一个更大元素（模板本体）',
    note: '题目出现「下一个更大/更小」「右边第一个比它大的」就往单调栈上想，每个元素只进出栈一次所以是 O(n)。',
    code: `// 求每个位置右边第一个比它大的元素下标，没有则 -1
int[] nextGreater(int[] nums) {
    int n = nums.length;
    int[] res = new int[n];
    Arrays.fill(res, -1);

    // 栈里存「下标」，且从栈底到栈顶是递减的（栈顶最小）
    Deque<Integer> stack = new ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        // 当前元素比栈顶大 → 栈顶那个位置的答案就是 i
        while (!stack.isEmpty() && nums[stack.peek()] < nums[i]) {
            res[stack.pop()] = i;
        }
        stack.push(i);
    }
    return res;
}`,
  },
  {
    category: '单调栈',
    title: '每日温度 / 下一个更大元素的距离',
    note: '和上一个同源，只是要的是「隔了几天」，把答案从下标换成下标之差。',
    code: `int[] dailyTemperatures(int[] t) {
    int n = t.length;
    int[] res = new int[n];          // 默认 0 = 后面没有更暖的
    Deque<Integer> stack = new ArrayDeque<>();   // 存下标，栈内温度递减

    for (int i = 0; i < n; i++) {
        while (!stack.isEmpty() && t[stack.peek()] < t[i]) {
            int prev = stack.pop();
            res[prev] = i - prev;    // 天数差
        }
        stack.push(i);
    }
    return res;
}`,
  },
  {
    category: '单调栈',
    title: '柱状图中最大的矩形（两侧第一个更矮）',
    note: '想求「以某根柱子为高的最大矩形」，就要知道它左右两边第一个比它矮的位置，这是单调栈最经典的变形。',
    code: `int largestRectangleArea(int[] h) {
    int n = h.length;
    // 左右各加一个 0 当哨兵：省掉「栈空了怎么办」和「扫完栈里还剩」两种特判
    int[] a = new int[n + 2];
    for (int i = 0; i < n; i++) a[i + 1] = h[i];

    Deque<Integer> stack = new ArrayDeque<>();
    int best = 0;
    for (int i = 0; i < a.length; i++) {
        while (!stack.isEmpty() && a[stack.peek()] > a[i]) {
            int height = a[stack.pop()];
            int width = i - stack.peek() - 1;   // 弹掉后栈顶就是左边界
            best = Math.max(best, height * width);
        }
        stack.push(i);
    }
    return best;
}`,
  },

  // ========== 堆 / 优先队列 ==========
  {
    category: '堆 / 优先队列',
    title: '大顶堆与小顶堆（Java 写法）',
    note: 'Java 的 PriorityQueue 默认是小顶堆，要大顶堆必须传 Collections.reverseOrder() 或自己写比较器，这一点第一次用必踩坑。',
    code: `// 小顶堆（默认）
PriorityQueue<Integer> minHeap = new PriorityQueue<>();

// 大顶堆：两种等价写法
PriorityQueue<Integer> maxHeap = new PriorityQueue<>(Collections.reverseOrder());
PriorityQueue<Integer> maxHeap2 = new PriorityQueue<>((a, b) -> b - a);

// 存数组时按第 0 位排序（Dijkstra 常用）
PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);

// 注意：b - a 有溢出风险，数值可能接近 int 边界时用 Integer.compare(b, a)`,
  },
  {
    category: '堆 / 优先队列',
    title: '求第 K 大 / TopK 元素',
    note: '求第 K 大要用「小顶堆」而不是大顶堆，堆顶是当前 k 个里最小的那个，正是被淘汰的分界线——这是最容易记反的一处。',
    code: `int findKthLargest(int[] nums, int k) {
    // 求第 K 大 → 小顶堆；求第 K 小 → 大顶堆
    PriorityQueue<Integer> heap = new PriorityQueue<>();
    for (int x : nums) {
        heap.offer(x);
        if (heap.size() > k) heap.poll();   // 超过 k 个就把最小的踢掉
    }
    return heap.peek();
}

// TopK 的 k 个元素（不要求顺序）
int[] topK(int[] nums, int k) {
    PriorityQueue<Integer> heap = new PriorityQueue<>();
    for (int x : nums) {
        heap.offer(x);
        if (heap.size() > k) heap.poll();
    }
    int[] res = new int[k];
    for (int i = k - 1; i >= 0; i--) res[i] = heap.poll();   // 弹出是升序，倒着填
    return res;
}`,
  },
  {
    category: '堆 / 优先队列',
    title: '数据流中位数（双堆）',
    note: '「不断插入、随时问中位数」就双堆：左边大顶堆存小的一半，右边小顶堆存大的一半，保证左边不比右边少也不多超过 1 个。',
    code: `class MedianFinder {
    PriorityQueue<Integer> left  = new PriorityQueue<>(Collections.reverseOrder()); // 小的一半，堆顶是最大值
    PriorityQueue<Integer> right = new PriorityQueue<>();                           // 大的一半，堆顶是最小值

    public void addNum(int num) {
        left.offer(num);
        right.offer(left.poll());            // 先丢给右边，保证有序
        if (right.size() > left.size()) {    // 再平衡，让左边不少于右边
            left.offer(right.poll());
        }
    }

    public double findMedian() {
        if (left.size() > right.size()) return left.peek();
        return (left.peek() + right.peek()) / 2.0;   // 注意 2.0，否则整数除法
    }
}`,
  },

  // ========== 并查集 ==========
  {
    category: '并查集（Union-Find）',
    title: '并查集完整模板（路径压缩 + 按秩合并）',
    note: '题目问「连不连通」「有几个连通块」「加这条边会不会成环」，都优先想并查集，比 DFS 泛洪好写且能在线加边。',
    code: `class UnionFind {
    private final int[] parent;
    private final int[] rank;
    private int count;                 // 连通块个数

    public UnionFind(int n) {
        parent = new int[n];
        rank = new int[n];
        count = n;
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    public int find(int x) {
        // 路径压缩：顺手把沿途节点都挂到根上，之后查就是 O(1)
        if (parent[x] != x) parent[x] = find(parent[x]);
        return parent[x];
    }

    public boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;    // 已经连通 —— 再加这条边就会成环
        // 按秩合并：把矮的树挂到高的树下，防止退化成链表
        if (rank[ra] < rank[rb])      parent[ra] = rb;
        else if (rank[ra] > rank[rb]) parent[rb] = ra;
        else { parent[rb] = ra; rank[ra]++; }
        count--;
        return true;
    }

    public boolean connected(int a, int b) { return find(a) == find(b); }
    public int count() { return count; }
}`,
  },
  {
    category: '并查集（Union-Find）',
    title: '二维网格转并查集（岛屿 / 连通区域）',
    note: '网格题用并查集的关键是把 (r,c) 压成一维下标 r * cols + c，「只往右和往下合并」就够，不用四个方向都做。',
    code: `int countIslands(char[][] grid) {
    int m = grid.length, n = grid[0].length;
    UnionFind uf = new UnionFind(m * n);
    int water = 0;

    for (int r = 0; r < m; r++) {
        for (int c = 0; c < n; c++) {
            if (grid[r][c] == '0') { water++; continue; }

            // 只往右和往下看，避免同一条边被合并两次
            if (c + 1 < n && grid[r][c + 1] == '1') uf.union(r * n + c, r * n + c + 1);
            if (r + 1 < m && grid[r + 1][c] == '1') uf.union(r * n + c, (r + 1) * n + c);
        }
    }
    // 连通块数要减掉所有水格（每格水单独算了一个块）
    return uf.count() - water;
}`,
  },

  // ========== 字典树 Trie ==========
  {
    category: '字典树 Trie',
    title: 'Trie 模板（数组版，26 字母）',
    note: '任务是「前缀」「自动补全」「单词是否在集合里且支持前缀查询」，就用 Trie，查一个词是 O(长度) 跟词库大小无关。',
    code: `class Trie {
    private final Trie[] children = new Trie[26];
    private boolean isEnd;                    // 必须是独立字段，不能用「有孩子」代替

    public void insert(String word) {
        Trie node = this;
        for (char ch : word.toCharArray()) {
            int i = ch - 'a';
            if (node.children[i] == null) node.children[i] = new Trie();
            node = node.children[i];
        }
        node.isEnd = true;
    }

    private Trie walk(String prefix) {
        Trie node = this;
        for (char ch : prefix.toCharArray()) {
            int i = ch - 'a';
            if (node.children[i] == null) return null;
            node = node.children[i];
        }
        return node;
    }

    public boolean search(String word) {
        Trie n = walk(word);
        return n != null && n.isEnd;          // 必须整词结束，不能只是前缀
    }

    public boolean startsWith(String prefix) {
        return walk(prefix) != null;          // 是前缀就行
    }
}`,
  },
  {
    category: '字典树 Trie',
    title: 'Trie 模板（Map 版，字符集不确定时用）',
    note: '字符不只有 a-z（大小写、数字、汉字）时，用 Map 存孩子比开 26 或 128 的数组省内存也通用。',
    code: `class TrieNode {
    Map<Character, TrieNode> children = new HashMap<>();
    boolean isEnd;
}

class Trie {
    private final TrieNode root = new TrieNode();

    public void insert(String word) {
        TrieNode node = root;
        for (char ch : word.toCharArray()) {
            node = node.children.computeIfAbsent(ch, k -> new TrieNode());
        }
        node.isEnd = true;
    }

    public boolean search(String word) {
        TrieNode n = walk(word);
        return n != null && n.isEnd;
    }

    public boolean startsWith(String prefix) { return walk(prefix) != null; }

    private TrieNode walk(String s) {
        TrieNode node = root;
        for (char ch : s.toCharArray()) {
            node = node.children.get(ch);
            if (node == null) return null;
        }
        return node;
    }
}`,
  },

  // ========== 拓扑排序 ==========
  {
    category: '拓扑排序',
    title: 'Kahn 算法（BFS 剥入度为 0）',
    note: '题目出现「先修课程」「有向依赖」「能不能排出一个合法顺序」，就是拓扑排序。输出节点数 < 总数就说明有环。',
    code: `// 返回 true 表示能学完全部课程（无环）
boolean canFinish(int numCourses, int[][] prerequisites) {
    List<List<Integer>> g = new ArrayList<>();
    for (int i = 0; i < numCourses; i++) g.add(new ArrayList<>());
    int[] indeg = new int[numCourses];

    for (int[] p : prerequisites) {
        g.get(p[1]).add(p[0]);   // p[1] 是 p[0] 的先修课
        indeg[p[0]]++;
    }

    Deque<Integer> q = new ArrayDeque<>();
    for (int i = 0; i < numCourses; i++) if (indeg[i] == 0) q.offer(i);

    int seen = 0;
    while (!q.isEmpty()) {
        int cur = q.poll();
        seen++;
        for (int next : g.get(cur)) {
            if (--indeg[next] == 0) q.offer(next);   // 入度归零才可以进队
        }
    }
    return seen == numCourses;
}`,
  },
  {
    category: '拓扑排序',
    title: '拓扑排序求输出顺序（课程表 II）',
    note: '和上面同一套代码，只是顺手把出队顺序记下来就是答案；如果要求字典序最小，把队列换成 PriorityQueue。',
    code: `int[] findOrder(int numCourses, int[][] prerequisites) {
    List<List<Integer>> g = new ArrayList<>();
    for (int i = 0; i < numCourses; i++) g.add(new ArrayList<>());
    int[] indeg = new int[numCourses];

    for (int[] p : prerequisites) {
        g.get(p[1]).add(p[0]);
        indeg[p[0]]++;
    }

    Deque<Integer> q = new ArrayDeque<>();
    for (int i = 0; i < numCourses; i++) if (indeg[i] == 0) q.offer(i);

    int[] res = new int[numCourses];
    int k = 0;
    while (!q.isEmpty()) {
        int cur = q.poll();
        res[k++] = cur;                          // 出队即入答案，天然正序
        for (int next : g.get(cur)) {
            if (--indeg[next] == 0) q.offer(next);
        }
    }
    return k == numCourses ? res : new int[0];   // 没排完 = 有环 = 无解
}`,
  },

  // ========== 前缀和 ==========
  {
    category: '前缀和 / 差分',
    title: '一维前缀和（区间和 O(1)）',
    note: '题目要反复问「某个区间之和」时先建前缀和，一次 O(n) 预处理换每次 O(1)，比每次重新累加快得多。',
    code: `// pre[i] = nums[0..i-1] 的和，pre[0] = 0
// 多留一个 0 是为了让「从下标 0 开始的区间」不用特判
int[] buildPrefix(int[] nums) {
    int n = nums.length;
    int[] pre = new int[n + 1];
    for (int i = 0; i < n; i++) pre[i + 1] = pre[i] + nums[i];
    return pre;
}

// 闭区间 [l, r] 的和
int rangeSum(int[] pre, int l, int r) {
    return pre[r + 1] - pre[l];
}`,
  },
  {
    category: '前缀和 / 差分',
    title: '前缀和 + HashMap 数子数组（和为 K）',
    note: '「有多少个子数组和正好是 K」这类题，前缀和一身两用：既算区间和，又当哈希表的 key 去找前面有没有需要的差值。',
    code: `int subarraySum(int[] nums, int k) {
    // key = 前缀和, value = 这个和出现过几次
    Map<Integer, Integer> pre = new HashMap<>();
    pre.put(0, 1);          // 关键：空前缀算一次，否则漏掉「从下标 0 开始」的答案

    int sum = 0, cnt = 0;
    for (int x : nums) {
        sum += x;
        // 找 sum - k 出现过几次：说明中间那段的和正好是 k
        cnt += pre.getOrDefault(sum - k, 0);
        pre.merge(sum, 1, Integer::sum);
    }
    return cnt;
}`,
  },
  {
    category: '前缀和 / 差分',
    title: '差分数组（区间批量加减）',
    note: '要对区间做很多次「整体加 c」最后再问结果，用差分：改两个端点 O(1)，最后一次前缀和还原，比每次循环改区间快一个量级。',
    code: `// 对 nums 的 [l, r] 闭区间整体加 c，做 m 次后还原
int[] diff = new int[n + 1];

void add(int l, int r, int c) {
    diff[l] += c;
    diff[r + 1] -= c;      // 出区间时抵消，保证只影响 [l, r]
}

int[] restore(int[] nums) {
    int cur = 0;
    int[] res = nums.clone();
    for (int i = 0; i < nums.length; i++) {
        cur += diff[i];    // 前缀和累加回来
        res[i] += cur;
    }
    return res;
}`,
  },
  {
    category: '前缀和 / 差分',
    title: '二维前缀和（子矩阵和）',
    note: '矩阵题问「某个子矩形的和」就上二维前缀和，公式靠容斥，写错了会重复减，最好背下来。',
    code: `int[][] pre;   // pre[i][j] = 左上角 (0,0) 到 (i-1,j-1) 的矩形和

void build(int[][] matrix) {
    int m = matrix.length, n = matrix[0].length;
    pre = new int[m + 1][n + 1];
    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            // 容斥：加本格，加上方，加左方，减去左上被算两次的
            pre[i][j] = matrix[i - 1][j - 1]
                      + pre[i - 1][j] + pre[i][j - 1] - pre[i - 1][j - 1];
        }
    }
}

// 左上 (r1,c1) 到右下 (r2,c2) 的子矩阵和
int sumRegion(int r1, int c1, int r2, int c2) {
    return pre[r2 + 1][c2 + 1] - pre[r1][c2 + 1] - pre[r2 + 1][c1] + pre[r1][c1];
}`,
  },

  // ========== 排序 ==========
  {
    category: '排序',
    title: '归并排序（顺便求逆序对）',
    note: '要 O(nlogn) 且稳定就用归并；「逆序对」几乎是归并排序的专属题型，合并时右边先出队就说明左边剩下的都比它大。',
    code: `int mergeSort(int[] a, int lo, int hi, int[] tmp) {
    if (lo >= hi) return 0;

    int mid = lo + (hi - lo) / 2;
    int cnt = mergeSort(a, lo, mid, tmp) + mergeSort(a, mid + 1, hi, tmp);

    int i = lo, j = mid + 1, k = lo;
    while (i <= mid && j <= hi) {
        if (a[i] <= a[j]) {
            tmp[k++] = a[i++];
        } else {
            tmp[k++] = a[j++];
            cnt += mid - i + 1;    // 左边从 i 到 mid 都比 a[j] 大
        }
    }
    while (i <= mid) tmp[k++] = a[i++];
    while (j <= hi)  tmp[k++] = a[j++];
    System.arraycopy(tmp, lo, a, lo, hi - lo + 1);
    return cnt;
}`,
  },
  {
    category: '排序',
    title: '快速选择（O(n) 求第 K 大）',
    note: '只需要第 K 个而不需要整个有序数组时，快速选择比全排序快，因为只递归一侧，平均 2n 次比较。',
    code: `int findKthLargest(int[] nums, int k) {
    int target = nums.length - k;   // 第 k 大 = 升序里的第 n-k 位
    int lo = 0, hi = nums.length - 1;
    Random rand = new Random();

    while (lo < hi) {
        // 随机 pivot：防止面对已排序数组时退化成 O(n^2)
        int p = lo + rand.nextInt(hi - lo + 1);
        swap(nums, p, hi);
        int pivot = nums[hi];

        int store = lo;
        for (int i = lo; i < hi; i++) {
            if (nums[i] < pivot) swap(nums, store++, i);
        }
        swap(nums, store, hi);

        if (store == target) return nums[store];
        else if (store < target) lo = store + 1;   // 只走一侧
        else hi = store - 1;
    }
    return nums[lo];
}`,
  },
  {
    category: '排序',
    title: '自定义比较器（按多个字段排序）',
    note: 'Java 写比较器最容易踩的是「b - a 溢出」和「字符串别用 == 」，数组和集合的写法还不一样。',
    code: `// 数组：按区间左端点升序，左端点相同则按右端点升序
int[][] intervals = {{1, 3}, {2, 6}, {8, 10}};
Arrays.sort(intervals, (a, b) -> {
    if (a[0] != b[0]) return Integer.compare(a[0], b[0]);
    return Integer.compare(a[1], b[1]);
});

// 字符串按长度，再按字典序
String[] words = {"abc", "ab", "abcd"};
Arrays.sort(words, (a, b) -> {
    if (a.length() != b.length()) return a.length() - b.length();
    return a.compareTo(b);           // 字符串比较必须用 compareTo，不能用 ==
});

// List 用 Collections.sort 或 list.sort
List<String> list = new ArrayList<>(Arrays.asList("a", "bb"));
list.sort(Comparator.comparingInt(String::length).thenComparing(Comparator.naturalOrder()));`,
  },

  // ========== 位运算 ==========
  {
    category: '位运算',
    title: '位运算常用式子',
    note: '位运算能用的场景不多，但真用上就是 O(1)，下面这几条几乎覆盖了面试会考的全部。',
    code: `// 取最低位的 1（lowbit）
x & (-x)          // 例：x=12(1100) → 4(0100)

// 抹掉最低位的 1 —— 用来数 1 的个数，循环次数 = 1 的个数
x & (x - 1)

// 判断奇偶
(x & 1) == 1

// 第 k 位是 0 还是 1（k 从 0 开始）
(x >> k) & 1

// 把第 k 位置 1 / 清 0 / 取反
x |  (1 << k)
x & ~(1 << k)
x ^  (1 << k)

// 异或的三条性质，a^a=0 是「消消乐」题的根本
a ^ a == 0
a ^ 0 == a
a ^ b ^ a == b

// 遍历所有子集（n 个元素，状压 DP 起手）
for (int mask = 0; mask < (1 << n); mask++) { }`,
  },
  {
    category: '位运算',
    title: '统计二进制里 1 的个数（Brian Kernighan）',
    note: '「x & (x-1) 能抹掉最低位的 1」这一条推出来的写法，循环次数就是一个数里 1 的个数，比逐位判断更省。',
    code: `int countOnes(int x) {
    int cnt = 0;
    while (x != 0) {
        x &= x - 1;    // 每次抹掉最低位的 1
        cnt++;
    }
    return cnt;
}

// 应用：汉明距离 = 两个数异或之后 1 的个数
int hammingDistance(int x, int y) {
    int d = x ^ y;
    int cnt = 0;
    while (d != 0) { d &= d - 1; cnt++; }
    return cnt;
}`,
  },
  {
    category: '位运算',
    title: '只出现一次的数字（异或消消乐）',
    note: '题目说「其他元素都出现两次，只有一个出现一次」，答案就是全部异或——成对的自己抵消成 0，剩下的就是它。',
    code: `int singleNumber(int[] nums) {
    int res = 0;
    for (int x : nums) res ^= x;   // a^a=0, a^0=a
    return res;
}

// 进阶：其他都出现三次 → 按位统计，每一位 1 的个数 % 3 就是答案这一位
int singleNumberII(int[] nums) {
    int res = 0;
    for (int b = 0; b < 32; b++) {
        int cnt = 0;
        for (int x : nums) cnt += (x >> b) & 1;
        if (cnt % 3 != 0) res |= (1 << b);
    }
    return res;
}`,
  },

  // ========== 图论进阶 ==========
  {
    category: '图论 · 最短路',
    title: 'Dijkstra（单源最短路，边权非负）',
    note: '边权非负求最短路就用 Dijkstra；边权有负数必须换 Bellman-Ford，用 Dijkstra 会得到错答案。',
    code: `int[] dijkstra(int n, List<int[]>[] g, int src) {   // g[u] = {v, w}
    int[] dist = new int[n];
    Arrays.fill(dist, Integer.MAX_VALUE);
    dist[src] = 0;

    // 小顶堆存 {距离, 节点}，按距离排序
    PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
    pq.offer(new int[]{0, src});

    while (!pq.isEmpty()) {
        int[] cur = pq.poll();
        int d = cur[0], u = cur[1];
        if (d > dist[u]) continue;      // 懒删除：这是过期的旧记录，直接跳过

        for (int[] e : g[u]) {
            int v = e[0], w = e[1];
            if (dist[u] + w < dist[v]) {
                dist[v] = dist[u] + w;
                pq.offer(new int[]{dist[v], v});
            }
        }
    }
    return dist;   // 仍是 MAX_VALUE 表示不可达
}`,
  },
  {
    category: '图论 · 最短路',
    title: 'Floyd（多源最短路，n 很小才用）',
    note: '要求「任意两点之间」的最短路、且节点数只有几百，就用 Floyd，三层循环写起来最短；中转点 k 必须在最外层。',
    code: `void floyd(int[][] dist) {   // dist 初始为邻接矩阵，无边填 INF，自己到自己填 0
    int n = dist.length;
    for (int k = 0; k < n; k++) {          // 中转点必须在最外层！
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (dist[i][k] == INF || dist[k][j] == INF) continue;  // 防溢出
                dist[i][j] = Math.min(dist[i][j], dist[i][k] + dist[k][j]);
            }
        }
    }
}`,
  },
  {
    category: '图论 · 最短路',
    title: 'Bellman-Ford（允许负权边）',
    note: '有负权边时必须用 Bellman-Ford；「最多经过 k 条边」这种限制也是它独有的能力。',
    code: `int[] bellmanFord(int n, int[][] edges, int src) {   // edges = {u, v, w}
    int INF = Integer.MAX_VALUE / 2;     // 别用 MAX_VALUE，加 w 会溢出
    int[] dist = new int[n];
    Arrays.fill(dist, INF);
    dist[src] = 0;

    for (int i = 0; i < n - 1; i++) {    // 最多松弛 n-1 轮
        boolean changed = false;
        for (int[] e : edges) {
            if (dist[e[0]] == INF) continue;
            if (dist[e[0]] + e[2] < dist[e[1]]) {
                dist[e[1]] = dist[e[0]] + e[2];
                changed = true;
            }
        }
        if (!changed) break;             // 提前收敛
    }
    return dist;
}`,
  },
  {
    category: '图论 · 遍历',
    title: '建图（邻接表）+ 通用 BFS',
    note: '拿到边列表第一件事是建图，「无向图要正反各加一条」是最常写漏的一行。',
    code: `// 无边权的无向图
List<List<Integer>> g = new ArrayList<>();
for (int i = 0; i < n; i++) g.add(new ArrayList<>());
for (int[] e : edges) {
    g.get(e[0]).add(e[1]);
    g.get(e[1]).add(e[0]);      // 无向图必须反向也加，漏了就只有单向可达
}

// 通用 BFS：层数就是最短距离（边权都为 1 时）
int[] bfs(List<List<Integer>> g, int src) {
    int n = g.size();
    int[] dist = new int[n];
    Arrays.fill(dist, -1);
    dist[src] = 0;

    Deque<Integer> q = new ArrayDeque<>();
    q.offer(src);
    while (!q.isEmpty()) {
        int u = q.poll();
        for (int v : g.get(u)) {
            if (dist[v] != -1) continue;   // 入队时就标记，别等出队，否则会重复入队
            dist[v] = dist[u] + 1;
            q.offer(v);
        }
    }
    return dist;
}`,
  },
  {
    category: '图论 · 遍历',
    title: '二分图判定（染色法）',
    note: '题目出现「分成两组、组内不能有边」就是二分图判定，DFS 染色，遇到已染且颜色相同的邻居就说明不是二分图。',
    code: `boolean isBipartite(int[][] graph) {
    int n = graph.length;
    int[] color = new int[n];     // 0 = 未染色, 1 / -1 = 两种颜色

    for (int i = 0; i < n; i++) {
        if (color[i] != 0) continue;

        Deque<Integer> q = new ArrayDeque<>();
        q.offer(i);
        color[i] = 1;

        while (!q.isEmpty()) {
            int u = q.poll();
            for (int v : graph[u]) {
                if (color[v] == 0) {
                    color[v] = -color[u];        // 染成相反颜色
                    q.offer(v);
                } else if (color[v] == color[u]) {
                    return false;                // 相邻同色 → 不是二分图
                }
            }
        }
    }
    return true;
}`,
  },

  // ========== 字符串进阶 ==========
  {
    category: '字符串 · 进阶',
    title: 'KMP（字符串匹配 O(n+m)）',
    note: '只有「在长串里找短串」且要求线性时间时才用 KMP，多数面试写 indexOf 就够；但 next 数组的原理常被追问。',
    code: `// next[i] = pattern[0..i] 的最长「相等前后缀」长度
int[] buildNext(String p) {
    int[] next = new int[p.length()];
    int j = 0;
    for (int i = 1; i < p.length(); i++) {
        while (j > 0 && p.charAt(i) != p.charAt(j)) j = next[j - 1];  // 失配就往前跳
        if (p.charAt(i) == p.charAt(j)) j++;
        next[i] = j;
    }
    return next;
}

int kmp(String s, String p) {
    if (p.isEmpty()) return 0;
    int[] next = buildNext(p);
    int j = 0;
    for (int i = 0; i < s.length(); i++) {
        while (j > 0 && s.charAt(i) != p.charAt(j)) j = next[j - 1];
        if (s.charAt(i) == p.charAt(j)) j++;
        if (j == p.length()) return i - p.length() + 1;   // 找到，返回起始下标
    }
    return -1;
}`,
  },
  {
    category: '字符串 · 进阶',
    title: '字符串常用操作（Java 易错点）',
    note: 'Java 字符串不可变、== 比的是引用、substring 在旧版本会内存泄漏——这几条是写题时最常翻车的地方。',
    code: `String s = "hello";

// 长度是方法不是属性（数组才是 s.length）
s.length()

// 取字符 / 取子串（左闭右开）
s.charAt(0)
s.substring(1, 3)          // "el"

// 字符串比较必须用 equals，== 比的是对象引用！
s.equals("hello")          // true
s == "hello"               // 可能 false，别用

// 大小写 / 去空格 / 替换 / 分割
s.toUpperCase()
s.trim()
s.replace('l', 'L')
s.split(",")               // 参数是正则，切 "." 要写成 "\\\\."

// 字符与数字互转
char c = '7';
int d = c - '0';           // 数字字符转数值
char back = (char) ('0' + d);

// 循环里拼字符串必须用 StringBuilder，否则每次都新建对象
StringBuilder sb = new StringBuilder();
sb.append('a').append(1);
sb.reverse().toString();
sb.deleteCharAt(sb.length() - 1);   // 回溯时撤销最后一个字符`,
  },

  // ========== 数学 ==========
  {
    category: '数学',
    title: '最大公约数与最小公倍数',
    note: '辗转相除求 gcd 是数学题地基，lcm 要用 a / gcd * b 的顺序算，先乘会溢出。',
    code: `int gcd(int a, int b) {
    return b == 0 ? a : gcd(b, a % b);
}

// 先除后乘：a * b 可能溢出 int
int lcm(int a, int b) {
    return a / gcd(a, b) * b;
}

// 迭代写法（防止递归层数太深）
int gcdIter(int a, int b) {
    while (b != 0) {
        int t = a % b;
        a = b;
        b = t;
    }
    return a;
}`,
  },
  {
    category: '数学',
    title: '快速幂（含取模）',
    note: '求 a^n 时把指数二进制拆分，O(logn)；带取模的版本在计数类题目里到处都是。',
    code: `// 不带取模
double myPow(double x, long n) {
    if (n < 0) { x = 1 / x; n = -n; }     // 注意 n 用 long，防 Integer.MIN_VALUE 取负溢出
    double res = 1, base = x;
    while (n > 0) {
        if ((n & 1) == 1) res *= base;    // 这一位是 1 就乘进来
        base *= base;                     // 底数平方
        n >>= 1;
    }
    return res;
}

// 带取模（结果对 mod 取余，防溢出用 long 中转）
long powMod(long a, long n, long mod) {
    long res = 1;
    a %= mod;
    while (n > 0) {
        if ((n & 1) == 1) res = res * a % mod;
        a = a * a % mod;
        n >>= 1;
    }
    return res;
}`,
  },
  {
    category: '数学',
    title: '质数筛（埃氏筛 / 线性筛）',
    note: '要「n 以内所有质数」就用筛法，逐个试除是 O(n√n) 会超时；线性筛每个合数只被标记一次。',
    code: `// 埃氏筛：O(n log log n)，够用且好写
int countPrimes(int n) {
    boolean[] notPrime = new boolean[n];
    int cnt = 0;
    for (int i = 2; i < n; i++) {
        if (notPrime[i]) continue;
        cnt++;
        // 从 i*i 开始标记，步长 i；i*i 可能溢出，用 i < n / i 判断
        if ((long) i * i < n) {
            for (int j = i * i; j < n; j += i) notPrime[j] = true;
        }
    }
    return cnt;
}

// 线性筛：每个合数只被它的最小质因数标记一次，O(n)
List<Integer> linearSieve(int n) {
    boolean[] comp = new boolean[n];
    List<Integer> primes = new ArrayList<>();
    for (int i = 2; i < n; i++) {
        if (!comp[i]) primes.add(i);
        for (int p : primes) {
            if ((long) i * p >= n) break;
            comp[i * p] = true;
            if (i % p == 0) break;       // 灵魂：保证只被最小质因数标记
        }
    }
    return primes;
}`,
  },
  {
    category: '数学',
    title: '整数溢出与取模套路',
    note: 'Java 的 int 溢出不会报错、只会静默变成负数，这是最难查的一类 WA；涉及累加相乘就先想 long。',
    code: `// 1) 相加/相乘前转 long
long sum = (long) a + b;
long prod = (long) a * b;

// 2) 判断乘 10 之后会不会溢出（反转整数题必用）
if (res > Integer.MAX_VALUE / 10) return 0;

// 3) 取模：(a + b) % m 要写成 ((a % m) + (b % m)) % m，避免提前溢出
int MOD = 1_000_000_007;
long ans = 0;
ans = (ans + x) % MOD;

// 4) 负数的取模在 Java 里返回负数！
(-7) % 3 == -1        // 想要正数结果就 ((-7) % 3 + 3) % 3

// 5) 比较中间值大小别直接相减
// a - b 可能溢出 → 用 Integer.compare(a, b)`,
  },

  // ========== 设计类题目 ==========
  {
    category: '设计类题目',
    title: 'LRU 缓存（HashMap + 双向链表）',
    note: '「最近最少使用先淘汰」就 LRU：哈希表负责 O(1) 查，双向链表负责 O(1) 挪位置和删尾部，缺一个都到不了 O(1)。',
    code: `class LRUCache {
    class Node {
        int key, val;
        Node prev, next;
        Node(int k, int v) { key = k; val = v; }
    }

    private final Map<Integer, Node> map = new HashMap<>();
    private final int capacity;
    // 虚拟头尾：省掉「链表为空 / 只有一个节点」的特判
    private final Node head = new Node(0, 0);
    private final Node tail = new Node(0, 0);

    public LRUCache(int capacity) {
        this.capacity = capacity;
        head.next = tail;
        tail.prev = head;
    }

    public int get(int key) {
        Node n = map.get(key);
        if (n == null) return -1;
        moveToHead(n);          // 用过就提到最前
        return n.val;
    }

    public void put(int key, int value) {
        Node n = map.get(key);
        if (n != null) {
            n.val = value;
            moveToHead(n);
            return;
        }
        if (map.size() == capacity) {
            Node last = tail.prev;   // 最久没用的
            remove(last);
            map.remove(last.key);    // 别忘了从 map 里删，否则内存泄漏
        }
        Node node = new Node(key, value);
        map.put(key, node);
        addToHead(node);
    }

    private void addToHead(Node n) {
        n.next = head.next; n.prev = head;
        head.next.prev = n; head.next = n;
    }
    private void remove(Node n) {
        n.prev.next = n.next;
        n.next.prev = n.prev;
    }
    private void moveToHead(Node n) { remove(n); addToHead(n); }
}`,
  },
  {
    category: '设计类题目',
    title: '最小栈（辅助栈存最小值）',
    note: '要求 getMin 是 O(1)，就不能每次遍历找最小；开一个辅助栈同步记录「到当前为止的最小值」。',
    code: `class MinStack {
    private final Deque<Integer> stack = new ArrayDeque<>();
    private final Deque<Integer> minStack = new ArrayDeque<>();   // 栈顶 = 当前最小值

    public void push(int value) {
        stack.push(value);
        // 辅助栈要同步压：新值更小就压新值，否则重复压当前最小值
        minStack.push(minStack.isEmpty() ? value : Math.min(value, minStack.peek()));
    }

    public void pop() {
        stack.pop();
        minStack.pop();     // 两边必须一起弹，否则最小值就对不上了
    }

    public int top()   { return stack.peek(); }
    public int getMin(){ return minStack.peek(); }
}`,
  },
  {
    category: '设计类题目',
    title: '用栈实现队列 / 用队列实现栈',
    note: '两个栈倒一次就是队列；一个队列也能实现栈，靠「把前面 n-1 个挪到队尾」把新元素顶到队头。',
    code: `// 两个栈实现队列：in 负责进，out 负责出
class MyQueue {
    private final Deque<Integer> in = new ArrayDeque<>();
    private final Deque<Integer> out = new ArrayDeque<>();

    public void push(int x) { in.push(x); }

    public int pop() {
        move();
        return out.pop();
    }

    public int peek() {
        move();
        return out.peek();
    }

    public boolean empty() { return in.isEmpty() && out.isEmpty(); }

    private void move() {
        // 只有 out 空了才倒，否则顺序会乱
        if (out.isEmpty()) {
            while (!in.isEmpty()) out.push(in.pop());
        }
    }
}`,
  },
];

(async () => {
  const existing = await (await fetch(B + '/api/snippets')).json();
  const key = (c, t) => (c || '') + '||' + (t || '');
  const have = new Set(existing.map((s) => key(s.category, s.title)));

  let added = 0, skipped = 0;
  // sortOrder 从 100 起，保证新模板排在原有 16 条之后（老的已手工排过序）
  let order = 100;
  for (const s of SNIPPETS) {
    if (have.has(key(s.category, s.title))) {
      skipped++;
      console.log('  跳过（已存在）: ' + s.category + ' / ' + s.title);
      continue;
    }
    const r = await fetch(B + '/api/snippets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, sortOrder: order++ }),
    });
    const j = await r.json();
    if (!j.ok) {
      console.log('  ❌ 失败: ' + s.title + ' → ' + JSON.stringify(j));
      continue;
    }
    added++;
    console.log('  ✅ 新增: [' + s.category + '] ' + s.title);
  }

  console.log('\n新增 ' + added + ' 条，跳过 ' + skipped + ' 条');
  const after = await (await fetch(B + '/api/snippets')).json();
  console.log('模板库现有 ' + after.length + ' 条，' +
    new Set(after.map((x) => x.category)).size + ' 个分类');
})();
