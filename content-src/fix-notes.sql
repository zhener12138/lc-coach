-- 补齐 12 个模板的一句话解释（用户要求：每天展示模板时要配一句话说明）
-- 只填空的，已有 note 的 4 个（万能开头 / HashMap / 栈和队列 / 动态规划）不动
UPDATE snippet SET note = '数组是力扣最基础的结构，八成题的第一反应都是「能不能一趟扫完」，先想清楚下标范围和越界。' WHERE category = '数组' AND (note IS NULL OR note = '');
UPDATE snippet SET note = 'Java 里字符串不可变，每次拼字符串都在造新对象，循环里拼接一定要换 StringBuilder。' WHERE category = '字符串' AND (note IS NULL OR note = '');
UPDATE snippet SET note = '只要题目出现「重复」「是否存在」就先想 HashSet，代价是额外 O(n) 空间换 O(1) 判断。' WHERE category LIKE 'HashSet%' AND (note IS NULL OR note = '');
UPDATE snippet SET note = 'ArrayList 查得快、中间插入删除慢，知道要频繁头部操作就别用它，换 LinkedList 或 ArrayDeque。' WHERE category LIKE 'ArrayList%' AND (note IS NULL OR note = '');
UPDATE snippet SET note = '双指针把 O(n²) 的两层循环压成 O(n) 的关键前提是数组有序，无序先排序再想。' WHERE category = '双指针' AND (note IS NULL OR note = '');
UPDATE snippet SET note = '滑动窗口解决的是「连续子数组/子串」的最值问题，想清楚什么时候右扩、什么时候左缩。' WHERE category = '滑动窗口' AND (note IS NULL OR note = '');
UPDATE snippet SET note = '二分的边界是全场最容易写错的地方，统一用左闭右开或闭区间中的一个，别两种混着用。' WHERE category = '二分查找' AND (note IS NULL OR note = '');
UPDATE snippet SET note = '链表题九成要虚拟头节点，能省掉「头节点被删」这一整类特判。' WHERE category = '链表' AND (note IS NULL OR note = '');
UPDATE snippet SET note = '二叉树题先确定是「前中后序」还是「层序」，遍历顺序选错就得返工重写。' WHERE category LIKE '二叉树%' AND (note IS NULL OR note = '');
UPDATE snippet SET note = '回溯的模板是「做选择 → 递归 → 撤销」，撤销那一步漏写就会得到脏结果。' WHERE category LIKE '回溯%' AND (note IS NULL OR note = '');
UPDATE snippet SET note = '网格 DFS 递归深度可能到 m×n 会爆栈，数据大时改用 BFS 或并查集。' WHERE category LIKE '图%' AND (note IS NULL OR note = '');
UPDATE snippet SET note = '位运算和小技巧能救场的场景不多，但一旦用上就是 O(1)，常见的就那几个，记住就够。' WHERE category = '常用小技巧' AND (note IS NULL OR note = '');

-- 清理 notify 表的历史重复：同一 (day_date, kind) 只保留 id 最大的一条
DELETE FROM notify WHERE id NOT IN (SELECT MAX(id) FROM notify GROUP BY day_date, kind);
