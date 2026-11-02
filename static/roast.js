/**
 * 「锐评」生成器。
 *
 * 设计原则（这几条比文案本身重要）：
 *
 *   1. 每句话都必须能追到真实数据 —— 编译结果、某个维度的分数、evidence 里那一行。
 *      说不出原因的毒舌，和说不出原因的夸奖一样没有价值，只是噪音。
 *   2. 骂的是代码，不是你。所以永远带上「下一步该干什么」，光骂不给方向就是耍流氓。
 *   3. 分数不同，骂法不同。编译不过还夸「思路不错」是虚伪；
 *      满分还硬找茬是装。每种情况都有对应的说法。
 *   4. 用分数做种子选文案，同一份代码重复评分说同一句话（不会每次刷新都换一张嘴）。
 */

/**
 * 自己的转义函数，不依赖 app.js 里的 esc。
 *
 * 为什么不用现成的：roast.js 比 app.js 先加载，虽然 roastFor() 是评分后才调用的、
 * 那时 esc 早就有了，但「能跑」和「该这么写」是两回事 ——
 * 一旦 app.js 加载失败或者将来调整顺序，这里就会崩在转义上。
 * 转义这种事必须自己兜住，不能赌加载顺序。
 */
function escRoast(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 稳定哈希：同一份代码永远得到同一句锐评 */
function roastSeed(g) {
  const s = [
    g.total, g.compiled, g.signatureOk,
    (g.dimensions || []).map(d => d.key + ':' + d.score).join(',')
  ].join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const pick = (arr, seed) => arr[seed % arr.length];

/** 六个维度里最弱和最强的那两个 —— 锐评的靶子 */
function weakestDim(g) {
  const ds = (g.dimensions || []).filter(d => d && typeof d.score === 'number');
  if (!ds.length) return null;
  return ds.reduce((a, b) => (b.score < a.score ? b : a));
}
function strongestDim(g) {
  const ds = (g.dimensions || []).filter(d => d && typeof d.score === 'number');
  if (!ds.length) return null;
  return ds.reduce((a, b) => (b.score > a.score ? b : a));
}

/** 把某个维度的第一条证据拿出来当靶子，没有就退回 reason */
function dimStab(d) {
  if (!d) return '';
  const ev = (d.evidence || []).filter(Boolean);
  return ev.length ? ev[0] : (d.reason || '');
}

/**
 * 生成锐评。返回 { head, body, advice } 三段：
 *   head    —— 一句话定性（最冲的那句）
 *   body    —— 具体指名道姓地骂，带证据
 *   advice  —— 下一步该改什么（这条是必须的，骂完得给路）
 */
function roastFor(g) {
  if (!g || !g.ok) {
    return {
      head: '连评分都没跑起来，这已经是另一层面的问题了。',
      body: '',
      advice: '先确认后端还在跑，再点一次评分。'
    };
  }

  const seed = roastSeed(g);
  const total = g.total;
  const dims = g.dimensions || [];
  const worst = weakestDim(g);
  const best = strongestDim(g);
  const stab = dimStab(worst);

  // ---- 第一档：编译不过。这时候谈思路、谈复杂度都是耍流氓 ----
  if (g.compiled === false) {
    const heads = [
      'javac 都没让你过。这不是「差一点」，这是代码还站不起来。',
      '编译这一关直接把你拦在门外了。',
      '连编译都过不了，后面五项评分其实是在给一具尸体量体温。'
    ];
    return {
      head: pick(heads, seed),
      body: '编译器原话：' + escRoast((g.compileErrors && g.compileErrors[0]) || '没给出具体行号') +
        '。这一行不解决，其他四个维度（思路 4 分、复杂度 3 分这些）全是空谈 —— ' +
        '它们描述的是一段不存在的程序。',
      advice: '先把报错那一行改到能过编译，再回来评分。别急着看分数，分数现在没有意义。'
    };
  }

  // ---- 第二档：编译过但方法名对不上 ----
  if (g.signatureOk === false) {
    return {
      head: '代码能跑，但力扣调不到你 —— 你写的是一段自娱自乐的代码。',
      body: '判题器靠反射调用 <code>' + escRoast(g.expectedMethod || '?') +
        '(' + escRoast(g.expectedParams || '') + ')</code>，你交上去的方法名和它要的对不上。' +
        '这跟算法能力无关，是「没读清楚题目要求」，最不该丢的分。',
      advice: '把方法签名改成题目要求的那一个，再交一次。这种错在笔试里最亏 —— 思路全对，零分。'
    };
  }

  // ---- 第三档：真的过了，按水平分档骂 ----
  let head, body, advice;

  if (total < 5) {
    head = pick([
      '写出来了，但离「能过」还隔着一段距离。',
      '代码收尾了，脑子好像没收尾。',
      '这段代码的努力程度值得肯定，方向值得怀疑。'
    ], seed);
    body = worst
      ? `最扎眼的是「${escRoast(worst.label)}」只有 ${worst.score} 分：${escRoast(stab)}。`
      : '各项分数都不高。';
    advice = '别急着换新题。把这一题重写一遍，只盯住上面那一项去改，改完再评。';
  } else if (total < 7) {
    head = pick([
      '能跑，但只是「能跑」。这种代码交上去，面试官会往下问三轮。',
      '及格线上下。你自己心里应该也清楚哪里在将就。',
      '像是知道答案但没嚼透，抄了个形状。'
    ], seed);
    body = worst
      ? `「${escRoast(worst.label)}」${worst.score} 分${best && best.score >= 9 ? `，而「${escRoast(best.label)}」拿了 ${best.score} 分 —— 你的强项和弱项割裂得很明显` : ''}。具体说：${escRoast(stab)}。`
      : '各项都在中游，没有一项站得住。';
    advice = worst
      ? `针对「${escRoast(worst.label)}」补一次。这类短板有个特点：不改就是每次都扣，改了就是一次性的。`
      : '找一道同 tag 的题，用同一套思路再做一遍，确认不是运气。';
  } else if (total < 8.5) {
    head = pick([
      '不错。但「不错」在面试里是最容易被刷掉的那一档。',
      '这份代码能过，只是过得不漂亮。',
      '及格偏上。看得出你在写代码，不是在对答案。'
    ], seed);
    body = worst && worst.score < 9
      ? `唯一被扣住的是「${escRoast(worst.label)}」${worst.score} 分：${escRoast(stab)}。`
      : '没有明显塌陷的维度，但也没有哪一项到顶。';
    advice = '这个分数段想往上走，靠的不是再刷题，是把「知道怎么写」变成「闭着眼睛也不会写错」。同一题第二天默写一遍。';
  } else {
    head = pick([
      '这题你是真懂了。没什么可挑的。',
      '干净。这种代码贴出去不用解释。',
      '该有的都有，不该有的都没有。'
    ], seed);
    body = worst && worst.score < 10
      ? `硬要找的话，「${escRoast(worst.label)}」${worst.score} 分，${escRoast(stab)}。`
      : '六个维度没有短板。';
    advice = '别再磨这一题了。往前走，或者去写它的进阶版 —— 把会的东西重复练，是最贵的浪费时间。';
  }

  return { head, body, advice };
}

/** 渲染成块 */
function renderRoast(g) {
  const r = roastFor(g);
  if (!r || !r.head) return '';
  return `
  <div class="roast">
    <div class="roast-tag">锐评</div>
    <div class="roast-head">${r.head}</div>
    ${r.body ? `<div class="roast-body">${r.body}</div>` : ''}
    ${r.advice ? `<div class="roast-advice"><b>然后呢</b>${r.advice}</div>` : ''}
  </div>`;
}
