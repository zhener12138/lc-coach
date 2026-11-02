/**
 * 错题「自动填写」。
 *
 * 用户的诉求原话：「我大部分时候不会写出比最优解法牛的项目」。
 * 这句话翻译过来就是：**参照系应该是这个题的最优解，不是我自己。**
 *
 * 所以这里的每一句都是拿「你的六维度」和「最优解的同六个维度」比出来的：
 *   - 哪个维度分数差最多 → 那就是你卡住的地方
 *   - 最优解用了我没用上的手法 → 那就是一句话结论该写的东西
 *   - 复杂度比你差几档 → 直接在文案里说明差多少
 *
 * 文案口径（用户 m04329 定的）：
 *   「卡在哪」要写成**自己回头看笔记的口吻**，不是诊断报告。
 *   反例：思路匹配差 6.0 分（你 4，最优解 10）。我的情况：识别到的手法：排序。
 *   正例：我想到的是两层循环硬跑，没往哈希表上想，HashMap 的 put / getOrDefault
 *         那几行我现在还写不出来。
 *   → 分数差、维度名、「识别到的手法：」这类机器判据原文一律不进正文，
 *     改放进 notes，由右侧「依据」那块负责交代。
 *
 * 四条红线：
 *   1. 不编。上面三个数据哪一个没有，就不说那一条，宁可空着让人填，也不硬凑一句。
 *   2. 说人话。第一人称，写「我怎么想的 / 我漏了什么」，不写「维度 X 差 Y 分」。
 *   3. 机器判据只进 notes。正文里不许出现「识别到的手法：」「最大循环嵌套」这类原文。
 *   4. 填完能改。自动填写只是把表单填好，光标停在第一个框里，用户随时可以推翻重写。
 */

/** 维度中文名，用于生成 notes 里的依据说明 */
const DIM_CN = {
  compile: '编译',
  approach: '思路',
  complexity: '时间复杂度',
  space: '空间复杂度',
  edge: '边界处理',
  style: '代码规范'
};

/**
 * 手法 → 人话。三件事分开存：
 *   say    写笔记时怎么称呼它
 *   syntax 真要落笔时卡在哪一行
 *   use    它到底省了什么（一句话结论用）
 * 没登记的手法会原样输出，不会变成 undefined。
 */
const TECH_SAY = {
  '哈希':     { say: '哈希表',   syntax: 'HashMap 的 put / getOrDefault',          use: '把「找某个值」从翻一遍变成查一次' },
  '双指针':   { say: '双指针',   syntax: 'left / right 往中间收的那个循环',       use: '把两层循环压成一层' },
  '排序':     { say: '先排序',   syntax: 'Arrays.sort',                           use: '换来有序性' },
  '二分':     { say: '二分',     syntax: 'while (left <= right) 那个循环',        use: '在有序区间里折半找' },
  '动态规划': { say: '动态规划', syntax: 'int[] dp = new int[n + 1]',             use: '把算过的子问题存下来' },
  'BFS':      { say: '广搜',     syntax: 'ArrayDeque 当队列的 offer / poll',      use: '一层一层往外扩' },
  '栈':       { say: '栈',       syntax: 'ArrayDeque 当栈的 push / pop',          use: '盯着最近进来的那个' },
  '堆':       { say: '优先队列', syntax: 'PriorityQueue',                         use: '随时拿到当前最大或最小' },
  '并查集':   { say: '并查集',   syntax: 'parent 数组 + find / union',            use: '把连通关系合并起来' },
  '回溯':     { say: '回溯',     syntax: '递归里选了再撤销那几步',                use: '把所有可能都试一遍' },
  '辅助数组': { say: '另开数组存', syntax: 'new int[n]',                          use: '换掉重复计算' },
  '原地交换': { say: '原地交换', syntax: 'swap 那两行',                           use: '不额外开空间' }
};

function techSay(t) { return (TECH_SAY[t] && TECH_SAY[t].say) || t; }
function techSyntax(t) { return TECH_SAY[t] ? TECH_SAY[t].syntax : ''; }
function techUse(t) { return TECH_SAY[t] ? TECH_SAY[t].use : ''; }

/** 把两次评分的同维度对起来，算差距 */
function diffDims(mine, ref) {
  const refMap = {};
  (ref.dimensions || []).forEach(d => { refMap[d.key] = d; });
  return (mine.dimensions || []).map(d => ({
    key: d.key,
    label: d.label || DIM_CN[d.key] || d.key,
    mine: d.score,
    ref: refMap[d.key] ? refMap[d.key].score : null,
    gap: refMap[d.key] ? (refMap[d.key].score - d.score) : 0,
    mineReason: d.reason || '',
    mineEvidence: (d.evidence || []).filter(Boolean),
    refEvidence: refMap[d.key] ? (refMap[d.key].evidence || []).filter(Boolean) : []
  }));
}

/**
 * 我当时大致是怎么写的 —— 只陈述能看见的事实（嵌套层数 + 用上的手法），不猜动机。
 * 「辅助数组」不算思路，它是手段，所以从描述里剔掉。
 */
function myApproachSay(mine) {
  const inf = mine.inferred || {};
  const named = (inf.techs || [])
    .filter(t => t !== '辅助数组')
    .map(techSay)
    .join(' + ');
  const nest = inf.nesting || 0;
  if (nest >= 3) return named ? `${named}再套三层循环` : '三层循环硬跑';
  if (nest >= 2) return named ? `${named}再套两层循环` : '两层循环硬跑';
  return named || '顺着题面直接写一遍';
}

/** 思路：我想到的是 X，没往 Y 上想，(Y 的语法) 那几行我还写不出来 */
function approachStuck(ctx) {
  const my = myApproachSay(ctx.mine);
  if (!ctx.missed.length) {
    return `我想到的是${my}，思路和最优解差不多，差在实现细节。`;
  }
  const names = ctx.missed.map(techSay).join('、');
  let s = `我想到的是${my}，没往${names}上想`;
  const syn = techSyntax(ctx.missed[0]);
  if (syn) s += `，${syn} 那几行我现在还写不出来`;
  return s + '。';
}

/** 复杂度：我写成 X，最优解 Y，差在哪一层 */
function complexityStuck(ctx) {
  const mt = (ctx.mine.inferred || {}).time || '';
  const rt = (ctx.ref.reference || {}).optimalTime || '';
  if (!mt || !rt) return '';
  const nest = (ctx.mine.inferred || {}).nesting || 0;
  let s = `我写成的是 ${mt}，最优解是 ${rt}`;
  if (nest >= 2) s += '，差的就是那层循环套循环';
  return s + '。';
}

/** 空间：额外开了什么，最优解只用多少 */
function spaceStuck(ctx) {
  const opt = (ctx.ref.reference || {}).optimalSpace || '';
  const ev = ctx.w.mineEvidence[0] || '';
  if (!opt) return '';
  if (!ev) return `空间上我比最优解多开了一些，最优解只用 ${opt}。`;
  // evidence 有的写成「开了辅助数组，额外 O(n) 空间」，有的直接是「new int[n][n]」
  // 前一种要去掉开头那个「开了」，否则会读出「我另外开了「开了辅助数组」」
  const what = ev.replace(/^(额外|多|另外)?开了?/, '').trim() || ev;
  return `空间上我另外开了「${what}」，最优解只用 ${opt}。`;
}

/** 边界：漏了哪种输入 */
function edgeStuck(ctx) {
  const ev = ctx.w.mineEvidence[0] || '';
  if (!ev) return '';
  return `边界上我漏了：${ev}。这种输入测试用例一定会塞。`;
}

/** 规范：写得让人读不下去的地方 */
function styleStuck(ctx) {
  const ev = ctx.w.mineEvidence[0] || '';
  if (!ev) return '';
  return `代码里${ev}，面试官会当场问你这几行想干什么。`;
}

/** 一个维度 → 一句人话。返回空串表示这个维度我编不出人话，别硬凑 */
function whereStuckFor(w, ctx) {
  switch (w.key) {
    case 'approach':   return approachStuck(ctx);
    case 'complexity': return complexityStuck(ctx);
    case 'space':      return spaceStuck(ctx);
    case 'edge':       return edgeStuck(ctx);
    case 'style':      return styleStuck(ctx);
    default:           return '';
  }
}

/**
 * 从两次评分生成错题三件套。
 * 返回 {whereStuck, oneLiner, tag, notes}，notes 是「为什么这么填」的说明，给用户判断用。
 */
function mistakeAutofill(mine, ref, problemTag) {
  const out = { whereStuck: '', oneLiner: '', tag: problemTag || '', notes: [] };
  if (!mine || !mine.ok || !ref) return out;

  const diffs = diffDims(mine, ref);

  const refTechs = (ref.reference && ref.reference.optimalTechs) || [];
  const myTechs = (mine.inferred && mine.inferred.techs) || [];
  const missed = refTechs.filter(t => !myTechs.includes(t));
  const extra = myTechs.filter(t => !refTechs.includes(t));
  const ctx = { mine, ref, missed, extra, refTechs, myTechs, w: null };

  // ---- 1. 卡在哪：从差距最大的维度往下试，第一个能说出人话的就是它 ----
  // 只算「最优解确实比你高」的维度，持平或你更强的都不算卡点
  const gaps = diffs
    .filter(d => d.ref != null && d.gap > 0)
    .sort((a, b) => b.gap - a.gap);

  for (const w of gaps) {
    ctx.w = w;
    const said = whereStuckFor(w, ctx);
    if (said) {
      out.whereStuck = said;
      out.notes.push(`卡点：${w.label}（差 ${w.gap.toFixed(1)} 分，六项里差距最大）`);
      break;
    }
  }

  if (!out.whereStuck) {
    if (mine.total < (ref.total || 0)) {
      out.whereStuck = '总分比最优解低，但没有任何一项明显落后 —— 大概是整体细节都没到位。';
      out.notes.push('没有单项差距，只有总分差');
    }
    ctx.w = gaps[0] || null;
  }

  // ---- 2. 一句话结论：下次该先抓什么 ----
  const mt = (mine.inferred || {}).time || '';
  const rt = (ref.reference || {}).optimalTime || '';
  if (missed.length) {
    const names = missed.map(techSay).join('、');
    let s = `下次先想「${names}」这条路`;
    const use = techUse(missed[0]);
    if (mt && rt && mt !== rt) s += ` —— 它能把 ${mt} 压到 ${rt}`;
    else if (use) s += ` —— ${use}`;
    out.oneLiner = s + '。';
    out.notes.push(`最优解有、我没有的手法：${names}`);
  } else if (extra.length) {
    out.oneLiner = `最优解没用「${extra.map(techSay).join('、')}」，我多绕了一步。`;
    out.notes.push(`我用了但最优解没用的手法：${extra.map(techSay).join('、')}`);
  } else if (refTechs.length && myTechs.length) {
    out.oneLiner = `手法和最优解一样（都用「${refTechs.map(techSay).join('、')}」），差在实现的细节上。`;
    out.notes.push('手法一致，差距不在思路上');
  }

  if (myTechs.length) out.notes.push(`我用到的手法：${myTechs.join('、')}`);
  if (refTechs.length) out.notes.push(`最优解用到的：${refTechs.join('、')}`);

  // ---- 3. tag：题目自己的 tag 优先，没有就用最优解的手法 ----
  if (!out.tag && refTechs.length) {
    out.tag = refTechs[0];
    out.notes.push(`tag 用了最优解的手法：${refTechs[0]}`);
  }

  // 编译不过 / 方法名错是压倒性的卡点，比任何维度差距都优先
  if (mine.compiled === false) {
    const err = (mine.compileErrors && mine.compileErrors[0]) || '';
    out.whereStuck = '代码没编译通过' + (err ? `：${err}` : '') + '。先把语法改对，其他问题都排在它后面。';
    out.oneLiner = '这段代码根本没跑起来，谈不上算法差距。';
    out.notes.push('编译不过是最高优先级卡点，覆盖了维度差距');
  } else if (mine.signatureOk === false) {
    out.whereStuck = `方法名写成了自己的，力扣要调用的是 ${mine.expectedMethod}(${mine.expectedParams})。`;
    out.oneLiner = '思路可能对，但签名不对，判题器调不到我。';
    out.notes.push('签名错优先于维度差距');
  }

  return out;
}

/** 取某道题的最优解评分 */
function optimalRefOf(refGrades) {
  if (!refGrades) return null;
  return refGrades.optimal || refGrades.better || refGrades.brute || null;
}
