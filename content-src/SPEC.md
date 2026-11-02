# 解法内容编写规范（solutions-*.js）

## 文件位置与命名

`E:\moren\lc-coach\content-src\solutions-w<N>.js`

已有：`solutions-w1.js`（6 题）。新文件按批次命名，如 `solutions-w2.js`、`solutions-w3.js`。
`build.js` 和 `fetch-all.js` 会自动扫描所有匹配 `solutions-*.js` 的文件并合并。

## 文件骨架

```js
module.exports = {

  'two-sum': {
    solutions: [
      /* ---- 解法 1：暴力 ---- */
      {
        tier: 'brute',
        title: '暴力双循环 · 枚举所有数对',
        idea: '……',
        pseudocode: '……',
        codeJava: '……',
        timeComplexity: 'O(n²)',
        spaceComplexity: 'O(1)'
      },
      /* ---- 解法 2：较好 ---- */
      { tier: 'better', /* … */ },
      /* ---- 解法 3：最优 ---- */
      { tier: 'optimal', /* … */ }
    ]
  },

  'another-slug': { solutions: [ /* … */ ] }

};
```

**slug 必须与 `E:\moren\lc-coach\content\problems\<slug>.json` 的文件名完全一致。**

## 每题必须恰好 3 个解法

| 顺序 | tier | 要求 |
|---|---|---|
| 1 | `brute` | 最直白的朴素解法，哪怕超时。**必须能跑通题意** |
| 2 | `better` | 与解法 1 **本质不同**的思路改进（换数据结构 / 换遍历方式 / 去掉冗余循环） |
| 3 | `optimal` | 该题公认最优解（时间或空间最优） |

**「本质不同」的判定**：换变量、换循环写法、把两行合成一行——不算。必须是换了思路或换了数据结构。
例如三数之和：`brute` 三重循环 → `better` 排序+固定一数+哈希查 → `optimal` 排序+固定一数+双指针。

## 每个字段的写法要求

### `title`（中文，≤ 20 字）

说清楚「靠什么做到的」，不要写「解法一」「优化解法」。

- ✅ `排序 + 双指针 · 固定第一个数后夹逼`
- ✅ `一次遍历 + 哈希表 · 边扫边查`
- ❌ `方法一`、`优化`、`更好的解法`

### `idea`（中文，150–300 字，核心）

写**为什么**，不是复述代码。至少回答以下之一：

- 为什么这个思路能成立（不变量是什么）
- 为什么换掉某个操作能降复杂度（省掉了什么重复计算）
- 为什么要注意某个顺序/边界（踩了什么坑）
- 解法 2 和 3 必须明确写出**相对上一版改了什么、为什么这样就快了/省了**

可以用 `\n\n` 分段。允许用 `**加粗**` 强调关键点。

反面教材（不要这样写）：
> 首先我们创建一个哈希表，然后遍历数组，对每个元素查表……

正面例子（两数之和的 brute 解）：
> 最直白的想法：把所有两两组合都试一遍。外层 i 从 0 走到末尾，内层 j 从 i+1 走到末尾，一旦和等于 target 就返回。
>
> 为什么内层从 i+1 开始？因为题目要求同一个元素不能重复使用，而且 (i,j) 和 (j,i) 是同一对，从 i+1 起既避免重复用元素，也避免重复枚举组合。

### `pseudocode`（中文伪代码，10–25 行）

**这是本产品最关键的部分**。要求：

1. 用中文写，不用英文关键字
2. 按步骤编号，**缩进体现层级**
3. 每步只做一件事，写清「对什么、做什么、什么条件」
4. 末尾附一行复杂度说明

格式示例：

```
输入：nums 数组，target 目标值
输出：两个下标

1. n = nums 的长度
2. i 从 0 循环到 n-1：
     a. j 从 i+1 循环到 n-1：
          如果 nums[i] + nums[j] 等于 target：
              返回 [i, j]
3. 循环结束还没找到 → 返回空

复杂度：时间 O(n²) 两层循环；空间 O(1) 只用了两个下标
```

**必须能照着这个伪代码直接翻译成 Java**，不需要再猜任何东西。

### `codeJava`（可直接提交的 Java 代码）

规则：

1. **类名必须是 `class Solution`**，方法签名必须与力扣该题一致
   （签名可从 `content/problems/<slug>.json` 的 `javaTemplate` 字段拿到）
2. 用 `\n` 拼接字符串，**不要用模板字符串**（会破坏缩进和转义）
3. 代码要能通过 `javac` 编译
4. 变量命名要有意义，不要 `a`、`b`、`tmp1`
5. 关键行加中文注释（占代码量的 10–20%，不要每行都注）

签名参考：

- `content/problems/<slug>.json` → `javaTemplate` 字段就是力扣给的原始模板
- 例如 `two-sum` 的模板是：
  ```java
  class Solution {
      public int[] twoSum(int[] nums, int target) {
          
      }
  }
  ```

字符串拼接写法（注意转义）：

```js
codeJava:
  'class Solution {\n' +
  '    public int[] twoSum(int[] nums, int target) {\n' +
  '        // 建表：值 → 下标\n' +
  '        Map<Integer, Integer> map = new HashMap<>();\n' +
  '        return new int[0];\n' +
  '    }\n' +
  '}',
```

### `timeComplexity` / `spaceComplexity`

用标准大 O 写法：`O(1)`、`O(n)`、`O(n log n)`、`O(n²)`、`O(m*n)`、`O(2^n)`、`O(n!)`。
如果是均摊/期望复杂度，写 `O(n) 期望`。
空间要算**额外空间**，不算输入输出。

## 质量红线

以下任意一条不满足，该题视为不合格：

1. ❌ 少于或多于 3 个解法
2. ❌ `tier` 不是 `brute` / `better` / `optimal`
3. ❌ `idea` 少于 100 字，或只是复述代码
4. ❌ `pseudocode` 少于 8 行，或照抄 Java 代码
5. ❌ `codeJava` 编译不通过
6. ❌ `codeJava` 里的类名不是 `Solution`
7. ❌ `codeJava` 的方法签名与力扣不一致
8. ❌ 三个解法的思路本质相同（只换了写法）
9. ❌ 伪代码与代码逻辑对不上

## 自检方法

写完后跑：

```bash
cd lc-coach
E:/nodejs/node.exe content-src/verify.js
```

校验器会检查：
- 计划里 120 道题是否都有 3 解法
- 每题 tier 组合是否正确
- `codeJava` 是否能通过 `javac` 编译
- 类名是否为 `Solution`
- 伪代码行数是否达标

失败项会逐条列出，改到全绿为止。

## 快速验证单题

```bash
node content-src/verify.js --slug 3sum
```
