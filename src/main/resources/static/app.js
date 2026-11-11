/* ============================================================
   LC Coach — 前端主程序（原生 JS，无框架）
   路由：#/today  #/problem/:slug  #/library  #/mistakes
        #/snippets  #/plan  #/account
   ============================================================ */

/* ---------------------------- 工具 ---------------------------- */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* lock.js 兜底：正常情况它已经先加载好了。
   万一被缓存/加载失败导致 Lock 不存在，这里补一个「永远锁着」的实现，
   保证题目页不会因为 ReferenceError 整页白屏 —— 宁可锁死也不能崩。 */
if (typeof window.Lock === 'undefined') {
  window.Lock = {
    isUnlocked: () => false,
    unlock: () => {},
    lockOne: () => {},
    lockAll: () => {},
  };
  window.__lockFallback = true;
}
if (typeof window.lockCard === 'undefined') {
  window.lockCard = function (slug, idx) {
    return '<div class="lock-card" data-lock="' + esc(slug) + '" data-idx="' + idx + '" role="button" tabindex="0">'
      + '<div class="lock-ico">🔒</div>'
      + '<div class="lock-title">解法 ' + (idx + 1) + ' 已锁住</div>'
      + '<div class="lock-hint">lock.js 没加载成功，刷新一下页面（Ctrl+F5）</div>'
      + '<div class="lock-cta">刷新页面</div>'
      + '</div>';
  };
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const escAttr = s => esc(s).replace(/\n/g, '&#10;');

async function api(path, opts = {}) {
  const init = { headers: {}, ...opts };
  if (init.body && typeof init.body !== 'string') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  const res = await fetch('/api' + path, init);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
    const err = new Error(msg);
    err.payload = data;
    throw err;
  }
  return data;
}

let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast' + (isErr ? ' err' : ''); }, 2600);
}

/* 复制。四处按钮（今日模板 / 三解法 / 我的代码 / 模板库）都走这里。

   为什么不能直接调 navigator.clipboard.writeText：那个 API 只在「安全上下文」
   里存在 —— https、localhost、127.0.0.1 才算，从局域网 IP 打开时
   navigator.clipboard 干脆是 undefined，取值那一刻就抛 TypeError。
   服务监听 0.0.0.0:8099 本来就是给别的设备访问的，这条路必须走得通，
   所以降级到 execCommand('copy')：老、丑、但非安全上下文里只有它能用。

   顺序不能反：先 clipboard（现代、无副作用），失败再 execCommand。
   反过来会在安全上下文里也去插临时 textarea，平白闪一下。 */
async function copyText(text) {
  const s = String(text == null ? '' : text);
  if (!s) { toast('这里没有可复制的内容', true); return false; }

  // 第一条路：现代剪贴板 API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(s);
      return true;
    } catch { /* 权限被拒 / 文档失焦，往下走兜底 */ }
  }

  // 第二条路：execCommand 兜底。临时 textarea 要真的选中，
  // 否则复制的是上一次的选择内容 —— 那比失败更糟，用户会粘贴出别的东西。
  let ta = null;
  try {
    ta = document.createElement('textarea');
    ta.value = s;
    // 放到视口外，避免页面跳动；不能用 display:none，那样选不中
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(0, s.length);
    const ok = document.execCommand('copy');
    if (ok) return true;
  } catch { /* 落到最后的报错 */ }
  finally {
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
  }

  // 两条路都没成：说清为什么，别让人以为是按钮坏了反复点
  toast('复制失败：浏览器不允许当前地址写入剪贴板。用 https 或 localhost 打开，或者手动选中复制', true);
  return false;
}

/* Java 语法高亮（单遍扫描，避免嵌套替换） */
const TYPE_WORDS = /^(int|long|double|float|boolean|char|void|byte|short|String|Integer|Long|Double|Boolean|Character|List|Map|Set|ArrayList|LinkedList|HashMap|HashSet|Deque|ArrayDeque|Queue|Stack|PriorityQueue|Character|Math|Objects|Arrays|Collections|StringBuilder|TreeNode|ListNode)$/;

function hlJava(src) {
  if (!src) return '';
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(public|private|protected|static|final|class|interface|extends|implements|new|return|if|else|for|while|do|switch|case|default|break|continue|int|long|double|float|boolean|char|void|byte|short|String|Integer|Long|Double|Boolean|Character|List|Map|Set|ArrayList|LinkedList|HashMap|HashSet|Deque|ArrayDeque|Queue|Stack|PriorityQueue|Math|Objects|Arrays|Collections|StringBuilder|TreeNode|ListNode|true|false|null|this|import|package|try|catch|finally|throw|throws|instanceof|super|abstract|synchronized|volatile|transient|enum)\b|\b(\d+\.?\d*[fLd]?)\b/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += '<span class="cmt">' + esc(m[1]) + '</span>';
    else if (m[2]) out += '<span class="str">' + esc(m[2]) + '</span>';
    else if (m[3]) out += '<span class="' + (TYPE_WORDS.test(m[3]) ? 'typ' : 'kw') + '">' + m[3] + '</span>';
    else if (m[4]) out += '<span class="num">' + m[4] + '</span>';
    last = m.index + m[0].length;
  }
  out += esc(src.slice(last));
  return out;
}

/* ---------------------------- 全局状态 ---------------------------- */

const State = {
  view: 'today',
  today: null,
  // 今日页当前「正在看」的那一天。翻历史时它 != today，
  // 但打卡、侧栏统计、计划页都只认 today。
  todayView: null,
  account: null,
  mistakes: [],
  // 错题本当前页码（从 1 开始）。只存在内存里 —— 错题本没有自己的路由，
  // 刷新回到第 1 页是可接受的；硬塞进 hash 会让 #/mistakes 变成一个带状态的地址，
  // 删除/标记后还得同步 hash，多一处能对不上的东西。
  mistakesPage: 1,
  snippets: [],
  // 最近一次评分结果 + 是哪道题的。
  // 记错题时要拿它和最优解比差距，所以必须带着 slug 存 —— 只看内容分不清是哪一题。
  lastGrade: null,
  lastGradeSlug: null,
  // 当前正在复习的错题 id。删卡片要用它拼路径 —— 卡片自己只带 cardId，
  // 不能靠 DOM 里翻 hash 现解析，那种耦合一改路由就断。
  rcMistakeId: null
};

const TIER_LABEL = { brute: '暴力', better: '较好', optimal: '最优' };
const DIFF_LABEL = { EASY: '简单', MEDIUM: '中等', HARD: '困难' };

/* 难度归一化：题库 JSON 存的是力扣原值 Easy/Medium/Hard，
   力扣搜索接口返回 EASY/MEDIUM/HARD，两处大小写不一致。
   这里统一转大写再查表，否则中文标签和 CSS 配色都会失效。 */
function diffKey(d) {
  return String(d || '').toUpperCase();
}
function diffLabel(d) {
  return DIFF_LABEL[diffKey(d)] || String(d || '');
}
function diffHtml(d) {
  const k = diffKey(d);
  return k ? `<span class="diff ${esc(k)}">${diffLabel(d)}</span>` : '';
}

/* ---------------------------- 侧栏 ---------------------------- */

function setNav(view) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
}

function updateSidebar() {
  const t = State.today;
  if (!t) return;
  $('#streak-num').textContent = t.streak ?? 0;
  const s = t.stats || {};
  $('#side-meta').innerHTML =
    `已完成 ${s.doneProblems ?? 0} 题<br>` +
    `错题 ${s.unmastered ?? 0} 道待攻<br>` +
    `模板 ${s.snippets ?? 0} 段`;
  const badge = $('#badge-mistakes');
  badge.textContent = s.unmastered ? s.unmastered : '';
  refreshNotifyBadge();
}

/** 未读提醒红点：进页面、切视图、操作后都刷一次 */
/* 前端版本戳：显示在侧栏底部，用来一眼确认浏览器加载的到底是哪一版 */
const BUILD_STAMP = '2026-11-02 · 每日翻页版 b';

async function refreshNotifyBadge() {
  try {
    const r = await api('/notify/unread');
    const el = $('#badge-notify');
    if (el) el.textContent = r.unread ? r.unread : '';
  } catch { /* 提醒接口挂了不该影响主流程 */ }
}

async function refreshToday(day) {
  // day 为空 = 真实今天，写进 State.today（侧栏、打卡、计划页都以它为准）。
  // 带数字 = 只是「翻到那天看看」，存到 State.todayView，
  // 绝不能覆盖 State.today —— 否则侧栏统计和计划页会跟着跳成历史快照。
  if (day) {
    State.todayView = await api('/today?day=' + encodeURIComponent(day));
    return State.todayView;
  }
  State.today = await api('/today');
  State.todayView = State.today;
  updateSidebar();
  return State.today;
}

/* ---------------------------- 路由 ---------------------------- */

function parseHash() {
  const h = (location.hash || '#/today').replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (!parts.length) return { view: 'today' };
  return {
    view: parts[0],
    param: parts[1] ? decodeURIComponent(parts[1]) : null,
    // 第三段只在复习模式用到：#/review/:slug/:mistakeId，带上是哪条错题，
    // 「复习 +1」才知道往哪条错题上记数。其他路由用不到这个字段。
    param2: parts[2] ? decodeURIComponent(parts[2]) : null
  };
}

function go(hash) { location.hash = hash; }

async function render() {
  const { view, param, param2 } = parseHash();
  State.view = view;
  // 今日页装的左右键翻页是全局监听，换页必须清掉，
  // 否则在题库里按 ← 会莫名其妙跳去前一天。
  document.onkeydown = null;
  setNav(view);
  const main = $('#main');
  main.innerHTML = '<div class="loading">正在加载…</div>';

  try {
    if (view === 'today')        await viewToday(main, param);
    // 复习模式和看题共用 viewProblem，只多带一个错题 id，界面按 id 是否存在切换
    else if (view === 'problem') await viewProblem(main, param);
    else if (view === 'fill')    await viewFill(main, param);
    else if (view === 'review')  await viewProblem(main, param, param2);
    else if (view === 'library') await viewLibrary(main, param);
    else if (view === 'mistakes')await viewMistakes(main);
    else if (view === 'snippets')await viewSnippets(main);
    else if (view === 'plan')    await viewPlan(main);
    else if (view === 'account') await viewAccount(main);
    else if (view === 'notify')  await viewNotify(main);
    else if (view === 'aihot')   await viewAihot(main);
    else { main.innerHTML = '<div class="empty">页面不存在</div>'; }
    main.firstElementChild?.classList.add('view-enter');
  } catch (e) {
    main.innerHTML = `<div class="notice">加载失败：${esc(e.message)}</div>`;
  }
}

/* ============================ 今日任务 ============================ */

/**
 * 每日一句模板：从模板库里按天固定挑一段代码 + 一句话解释，
 * 插在今日任务列表和底部统计条之间。
 *
 * 为什么按日期做种子、而不是每次刷新随机：
 * 每次刷新都换就等于没有「今日」，看到一半刷新还变了更烦。
 * 用年月日做种子 → 同一天永远同一个模板，跨天才换。
 */
function templateCardHtml() {
  const list = State.snippets;
  if (!list || !list.length) return '';

  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const pick = list[seed % list.length];

  return `
    <div class="dailytpl">
      <div class="dailytpl-head">
        <span class="dailytpl-label">今日模板</span>
        <span class="dailytpl-cat">${esc(pick.category || '')}</span>
      </div>
      <div class="dailytpl-title">${esc(pick.title || '')}</div>
      ${pick.note ? `<div class="dailytpl-note">${esc(pick.note)}</div>` : ''}
      <div class="code-wrap dailytpl-code">
        <button class="code-copy">复制</button>
        <pre><code>${hlJava(pick.code || '')}</code></pre>
      </div>
    </div>`;
}

async function viewToday(main, dayParam) {
  // 路由 #/today 是今天，#/today/3 是「看第 3 天」。翻看历史不写 State.today。
  const wantDay = dayParam && /^\d+$/.test(String(dayParam)) ? parseInt(dayParam, 10) : null;
  const t = await refreshToday(wantDay);
  // State.snippets 只有进过模板库页才被填充，今日页要自己兜底拉一次，
  // 否则首次打开首页「今日模板」永远是空的
  if (!State.snippets || !State.snippets.length) {
    try { State.snippets = await api('/snippets'); } catch { /* 拿不到就只是不显示这张卡 */ }
  }
  const pct = t.totalCount ? Math.round(t.doneCount / t.totalCount * 100) : 0;
  const isReview = t.review && (!t.slugs || !t.slugs.length);

  // 翻历史时不能再写「今天」——不然看第 3 天会说「今天是复盘日」
  const dayWord = t.isToday === false ? `第 ${t.dayNo} 天` : '今天';
  let tasksHtml = '';
  if (isReview || !t.items || !t.items.length) {
    tasksHtml = `
      <div class="notice">
        <b>${dayWord}是复盘日。</b>${esc(t.note || '把这一周做错的题重做一遍，错题本里的优先。')}
      </div>
      <div class="empty"><span class="big">◻</span>${t.isToday === false ? '这天' : '今日'}无新题，去错题本挑 4 道重做</div>`;
  } else {
    tasksHtml = '<div class="task-list">' + t.items.map((it, i) => {
      const done = it.status === 'done';
      const diff = diffHtml(it.difficulty);
      const solChip = it.solutionCount
        ? `<span class="chip sol">${it.solutionCount} 解</span>`
        : `<span class="chip warn">待补内容</span>`;
      const tags = (it.tags || '').split(',').filter(Boolean).slice(0, 3)
        .map(x => `<span class="chip">${esc(x)}</span>`).join('');
      return `
        <div class="task ${done ? 'done' : ''}" data-slug="${escAttr(it.slug)}">
          <div class="task-idx">${String(i + 1).padStart(2, '0')}</div>
          <div class="task-body">
            <div class="task-title">
              ${it.frontendId ? `<span class="fid">#${esc(it.frontendId)}</span>` : ''}
              ${esc(it.title)}
            </div>
            <div class="task-meta">${diff}${tags}</div>
          </div>
          <div class="task-right">
            ${solChip}
            <button class="btn-check" data-check="${escAttr(it.slug)}" title="标记完成">✓</button>
          </div>
        </div>`;
    }).join('') + '</div>';
  }

  main.innerHTML = `
    <div class="page-head${t.isToday === false ? ' page-head-hist' : ''}">
      <div class="eyebrow">${t.isToday === false ? '计划预览' : '今日任务'} · Day ${t.dayNo}${t.preview ? ' · 预览' : ''}</div>
      <h1>${t.review ? '复盘日' : (t.preview ? '开局第一天' : '今天做这些')}</h1>
      <p class="sub">按顺序做，卡住 20 分钟就看解法。看完必须关掉代码默写一遍。</p>
    </div>

    ${t.preview ? `<div class="notice">
      <b>计划还没正式开始。</b>距离 ${esc(t.startDate)} 还有 ${t.daysToStart ?? 0} 天，
      下面是第一天的内容，可以先熟悉一下节奏——今天想做也可以直接开始。
    </div>` : ''}

    ${t.isToday === false ? `<div class="notice notice-view">
      <b>你在看第 ${t.dayNo} 天（${esc(t.date || '')}）的安排，不是今天。</b>
      打卡记的是「这道题做没做过」，不分哪天，所以在任意一天都能勾。
      <button class="btn small ghost" id="back-today">回到今天</button>
    </div>` : ''}

    <div class="day-counter">
      <div class="day-big">${String(t.dayNo).padStart(2, '0')}</div>
      <div class="day-of">/ ${t.totalDays}</div>
      <div class="day-meta">
        <div class="day-phase">${esc(t.phase || '')}</div>
        <div class="day-tag">${esc(t.tag || '')}</div>
      </div>
      <div class="day-nav">
        <button class="day-arrow" id="day-prev" title="上一天"${t.hasPrev ? '' : ' disabled'} aria-label="上一天">←</button>
        <button class="day-arrow" id="day-next" title="下一天"${t.hasNext ? '' : ' disabled'} aria-label="下一天">→</button>
      </div>
    </div>

    <div class="bar-wrap">
      <div class="bar-top">
        <span>今日进度</span>
        <span>${t.doneCount} / ${t.totalCount}</span>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>

    ${tasksHtml}

    ${templateCardHtml()}

    <div class="stat-strip">
      <div class="stat-cell"><div class="stat-v">${t.streak ?? 0}</div><div class="stat-k">连续打卡</div></div>
      <div class="stat-cell"><div class="stat-v">${t.stats?.doneProblems ?? 0}</div><div class="stat-k">累计完成</div></div>
      <div class="stat-cell"><div class="stat-v">${t.stats?.unmastered ?? 0}</div><div class="stat-k">待攻错题</div></div>
      <div class="stat-cell"><div class="stat-v">${t.stats?.contentProblems ?? 0}</div><div class="stat-k">题库内容</div></div>
    </div>
  `;

  $$('.task', main).forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('[data-check]')) return;
      go('#/problem/' + row.dataset.slug);
    });
  });

  // 前一天 / 后一天：只改路由，由路由去拉那一天的数据。
  // 边界靠后端给的 hasPrev/hasNext，前端不自己算 112 —— 天数只有一个来源。
  const realNo = t.realDayNo || 1;
  const goDay = d => go(d === realNo ? '#/today' : '#/today/' + d);
  const btnPrev = $('#day-prev', main);
  const btnNext = $('#day-next', main);
  if (btnPrev) btnPrev.addEventListener('click', () => { if (!btnPrev.disabled) goDay(t.dayNo - 1); });
  if (btnNext) btnNext.addEventListener('click', () => { if (!btnNext.disabled) goDay(t.dayNo + 1); });
  const btnBack = $('#back-today', main);
  if (btnBack) btnBack.addEventListener('click', () => go('#/today'));
  // 键盘左右键也能翻，翻计划时手不用离开键盘
  if (t.isToday === false || t.hasPrev || t.hasNext) {
    document.onkeydown = e => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft' && t.hasPrev) { goDay(t.dayNo - 1); }
      if (e.key === 'ArrowRight' && t.hasNext) { goDay(t.dayNo + 1); }
    };
  }

  // 今日模板那块代码也要能复制。bindCopy 是 viewProblem 里的局部函数，这里单独绑。
  // 注意这里是 $$（复数）：要拿的是全部按钮、对它 forEach。
  $$('.dailytpl .code-copy', main).forEach(b => {
    b.addEventListener('click', async () => {
      const code = b.parentElement.querySelector('code');
      if (await copyText(code ? code.textContent : '')) {
        b.textContent = '已复制';
        setTimeout(() => { b.textContent = '复制'; }, 1400);
      }
    });
  });

  // 打卡就是「把这道题标记成做完了」，和它在计划里排第几天无关。
  // 曾经这里有一道 canCheck = t.isToday !== false 的闸，理由是「在历史页
  // 点勾等于偷偷改今天的进度」—— 那个理由站不住：progress 表的主键是
  // slug，done_date 只记第一次完成的日期，压根没有「哪天做了多少」这种
  // 按日切分的账。给第 3 天的题打卡，就是把那道题标记成做完，天经地义。
  // 结果是昨天/明天的题点了没反应，而按钮看上去是能点的，纯属骗人。
  $$('[data-check]', main).forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const slug = btn.dataset.check;
      const row = btn.closest('.task');
      const nowDone = !row.classList.contains('done');
      // 先锁住按钮，防连点造成两次相反的请求互相覆盖
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        await api('/progress/' + encodeURIComponent(slug), {
          method: 'POST',
          body: { status: nowDone ? 'done' : 'todo' }
        });
        row.classList.toggle('done', nowDone);
        // 只刷新「当前正在看的这一天」，不强行跳回今天：
        // 在后端刷新真实今天会覆盖 State.today，而这里在看的可能是历史，
        // 那会让进度条的数字和页面上的题对不上。
        const fresh = await refreshToday(t.isToday === false ? t.dayNo : null);
        const shown = fresh || t;
        const pct2 = shown.totalCount
          ? Math.round(shown.doneCount / shown.totalCount * 100) : 0;
        const bar = $('.bar > i', main);
        if (bar) bar.style.width = pct2 + '%';
        const cnt = $('.bar-top span:last-child', main);
        if (cnt) cnt.textContent = `${shown.doneCount} / ${shown.totalCount}`;
        toast(nowDone ? '打卡完成' : '已取消');
      } catch (err) {
        // 失败要把界面还原，否则会出现「显示已打卡但服务器没收到」
        row.classList.toggle('done', !nowDone);
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

/* ============================ 题目详情 ============================ */

async function viewProblem(main, slug, reviewMistakeId) {
  if (!slug) { go('#/today'); return; }
  // 复习模式：带错题 id 进来，只给题面 + 我的代码 + 一个「复习 +1」按钮。
  // 不带 id 的看题路径（#/problem/:slug）一个字节都不能变 —— 两条入口同题同数据。

  // 记进全局：卡堆里的「删除这张」要拿它拼路径。离开复习页时要清掉，
  // 否则下次进看题页删卡片会拼到上一题的 id 上。
  State.rcMistakeId = reviewMistakeId || null;

  let p;
  // 复习卡片：只有复习模式才拉。看题模式这里保持 undefined，DOM 里也就没有这块。
  let rcCards = [];
  try {
    // 复习模式带 mistakeId：后端会在题目数据里附上这条例题的复习代码（reviewCode 字段），
    // 看题请求不带这个参数，返回里就没有 reviewCode —— 两条路径各回各的数据。
    p = await api('/problem/' + encodeURIComponent(slug)
      + (reviewMistakeId ? '?mistakeId=' + encodeURIComponent(reviewMistakeId) : ''));
    if (reviewMistakeId) {
      // 卡片拉失败不该把整个复习页打挂 —— 顶多这次看不到历史，草稿照写。
      try {
        const r = await api('/mistakes/' + encodeURIComponent(reviewMistakeId) + '/review-cards');
        rcCards = r.cards || [];
      } catch (e2) { rcCards = []; }
    }
  } catch (e) {
    main.innerHTML = `
      <button class="back-link" onclick="location.hash='#/today'">← 返回</button>
      <div class="page-head">
        <div class="eyebrow">题库缺内容</div>
        <h1>${esc(slug)}</h1>
        <p class="sub">这道题还没有题面和解法内容。</p>
      </div>
      <div class="notice">${esc(e.message)}</div>
      <button class="btn" id="btn-fetch">从力扣拉取题面</button>
    `;
    $('#btn-fetch').addEventListener('click', async () => {
      $('#btn-fetch').disabled = true;
      $('#btn-fetch').textContent = '拉取中…';
      try {
        await api('/problem/' + encodeURIComponent(slug) + '/fetch', { method: 'POST' });
        toast('已拉取，正在重新加载');
        render();
      } catch (err) {
        toast(err.message, true);
        $('#btn-fetch').disabled = false;
        $('#btn-fetch').textContent = '从力扣拉取题面';
      }
    });
    return;
  }

  const sols = (p.solutions || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const tags = (p.tags || '').split(',').filter(Boolean)
    .map(x => `<span class="chip">${esc(x)}</span>`).join('');

  main.innerHTML = `
    <button class="back-link" id="btn-back">${reviewMistakeId ? '← 返回错题本' : '← 返回今日任务'}</button>

    <div class="prob-head">
      <div class="prob-fid">#${esc(p.frontendId || '')} · ${diffLabel(p.difficulty)}</div>
      <div class="prob-title">${esc(p.title || p.titleCn || p.titleEn || slug)}</div>
      ${p.titleEn ? `<div class="prob-en">${esc(p.titleEn)}</div>` : ''}
      <div class="prob-tags">${tags}</div>
      ${reviewMistakeId ? '' : `<div class="prob-act">
        <a class="btn small" href="#/fill/${escAttr(slug)}">填空练习 · 从骨架上把代码补出来</a>
      </div>`}
    </div>

    <div class="prob-body" id="prob-body"></div>

    ${reviewMistakeId ? `
      <h2 class="sec">我的代码 <span class="cnt">复习专用 · 每次复习一张卡，历史各自留痕，互不覆盖</span></h2>
      <div class="rc-deck">
        <div class="rc-card rc-draft">
          <div class="rc-head">
            <span class="rc-seq">新的这次</span>
            <span class="rc-time">写完点「检查」—— 会真跑一遍用例，对错当场知道，同时存成一张卡</span>
          </div>
          <div class="rc-body">
            <textarea id="review-code" class="code-input" spellcheck="false"
              placeholder="复习重写一遍，粘在这里 —— 不会覆盖看题页那份，也不会覆盖你以前复习写过的"></textarea>
            <div class="row" style="margin-top:var(--s3)">
              <div class="fixed"><button class="btn" id="btn-grade-review">检查这次写得对不对</button></div>
              <div class="fixed"><button class="btn ghost" id="btn-save-review-code">只保存不检查</button></div>
              <div class="fixed"><span class="mono-sm" id="review-code-stamp"></span></div>
            </div>
            <div id="review-grade-out" class="rc-grade-out"></div>
          </div>
        </div>
        <div class="rc-hist" id="rc-hist">${renderRcHist(rcCards)}</div>
      </div>
      <div class="row" style="margin-top:var(--s5)">
        <div class="fixed"><button class="btn" id="btn-review-plus">复习 +1</button></div>
      </div>
    ` : `
      <h2 class="sec">三种解法 <span class="cnt">${sols.length} 种 · 从暴力到最优</span></h2>
      ${sols.length ? renderSolTabs(sols, slug, p.refGrades) : '<div class="empty">还没有解法内容</div>'}

      <h2 class="sec">我的代码 <span class="cnt">粘贴上来，给你打分</span></h2>
      ${renderMyCodeArea(p, slug)}

      <h2 class="sec">我的记录</h2>
      <label class="field">
        <span>这道题我卡在哪（一句话）</span>
        <textarea id="my-note" placeholder="例：想到哈希但不会写 containsKey 的返回值判断">${esc(p.myNote || '')}</textarea>
      </label>
      <div class="row" style="margin-bottom:var(--s5)">
        <div class="fixed"><button class="btn" id="btn-save-note">保存笔记</button></div>
        <div class="fixed"><button class="btn ghost" id="btn-done">${p.status === 'done' ? '取消完成' : '标记完成'}</button></div>
        <div class="fixed"><button class="btn ghost" id="btn-mistake">记入错题本</button></div>
        <div class="fixed"><a class="btn ghost" target="_blank" rel="noopener"
           href="https://leetcode.cn/problems/${escAttr(slug)}/">去力扣提交 ↗</a></div>
      </div>
    `}
  `;

  // 题面
  const body = $('#prob-body');
  const html = p.contentCnHtml || p.contentHtml || '';
  body.innerHTML = html || '<p class="mono-sm">（无题面内容）</p>';

  $('#btn-back').addEventListener('click', () => go(reviewMistakeId ? '#/mistakes' : '#/today'));

  // 解法 tab + 上锁解锁（仅看题模式；复习模式没渲染这块 DOM，别去绑）
  if (sols.length && !reviewMistakeId) {
    // 渲染单个 panel 的内容（锁着就画锁屏卡，解锁就画正文）
    function paintPanel(idx) {
      const panel = $('#' + 'sol-' + idx, main);
      if (!panel) return;
      const locked = !Lock.isUnlocked(slug, idx);
      panel.classList.toggle('is-locked', locked);
      panel.innerHTML = locked ? lockCard(slug, idx) : solBody(sols[idx], idx, p.refGrades);
      bindCopy(panel);
    }

    // 刷新所有 tab 与计数
    function paintTabs() {
      $$('.sol-tab', main).forEach(t => {
        const i = Number(t.dataset.idx);
        const locked = !Lock.isUnlocked(slug, i);
        t.classList.toggle('locked', locked);
        const dot = $('.lock-dot', t);
        if (dot) dot.textContent = locked ? '🔒' : '🔓';
      });
      const st = $('.lock-state b', main);
      if (st) st.textContent = String(sols.filter((s, i) => Lock.isUnlocked(slug, i)).length);
    }

    function bindCopy(scope) {
      $$('.code-copy', scope || main).forEach(b => {
        if (b.dataset.bound) return;
        b.dataset.bound = '1';
        b.addEventListener('click', async () => {
          const pre = b.parentElement.querySelector('code');
          if (await copyText(pre ? pre.textContent : '')) {
            b.textContent = '已复制';
            setTimeout(() => { b.textContent = '复制'; }, 1400);
          }
        });
      });
    }

    // 点锁屏卡 → 解锁这一块
    // 注意：#main 是常驻节点，直接 addEventListener 会随着每次进入题目不断累积，
    // 导致点一次触发多次、并且旧题目的 slug 也被解锁。所以先摘掉上一个处理函数。
    if (main._lockHandler) main.removeEventListener('click', main._lockHandler);
    main._lockHandler = (ev) => {
      const card = ev.target.closest('.lock-card');
      if (!card || !main.contains(card)) return;
      const idx = Number(card.dataset.idx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= sols.length) return;
      Lock.unlock(slug, idx);
      paintPanel(idx);
      paintTabs();
      toast('解法 ' + (idx + 1) + ' 已解锁');
    };
    main.addEventListener('click', main._lockHandler);

    // 键盘也能解锁（lock-card 有 tabindex=0，回车/空格应该等于点一下）
    if (main._lockKeyHandler) main.removeEventListener('keydown', main._lockKeyHandler);
    main._lockKeyHandler = (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const card = ev.target.closest && ev.target.closest('.lock-card');
      if (!card || !main.contains(card)) return;
      ev.preventDefault();
      const idx = Number(card.dataset.idx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= sols.length) return;
      Lock.unlock(slug, idx);
      paintPanel(idx);
      paintTabs();
      toast('解法 ' + (idx + 1) + ' 已解锁');
    };
    main.addEventListener('keydown', main._lockKeyHandler);

    // tab 切换 + 点已解锁的 tab 重新锁上
    // 用事件委托挂在 #main 上并先摘掉旧的：panel 里的 tab 是每次渲染重建的，
    // 逐个 addEventListener 一旦哪次没重绑就会点不动；挂在常驻节点上更稳。
    if (main._tabHandler) main.removeEventListener('click', main._tabHandler);
    main._tabHandler = (ev) => {
      const tab = ev.target.closest && ev.target.closest('.sol-tab');
      if (!tab || !main.contains(tab)) return;
      const idx = Number(tab.dataset.idx);

      // 再点一次已解锁的 tab → 重新锁上（不用去点顶部按钮）
      if (Number.isInteger(idx) && Lock.isUnlocked(slug, idx) && tab.classList.contains('active')) {
        Lock.lockOne(slug, idx);
        paintPanel(idx);
        paintTabs();
        toast('解法 ' + (idx + 1) + ' 已重新锁上');
        return;
      }

      $$('.sol-tab', main).forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      $$('.sol-panel', main).forEach(x => { x.style.display = 'none'; });
      const panel = $('#' + tab.dataset.target, main);
      if (panel) {
        panel.style.display = 'block';
        panel.classList.remove('view-enter');
        void panel.offsetWidth; // 强制回流，让入场动画每次都能重放
        panel.classList.add('view-enter');
      }
    };
    main.addEventListener('click', main._tabHandler);

    // 全部重新上锁（同样用委托 + 防重复累积）
    if (main._lockAllHandler) main.removeEventListener('click', main._lockAllHandler);
    main._lockAllHandler = (ev) => {
      const btn = ev.target.closest && ev.target.closest('#btn-lock-all');
      if (!btn || !main.contains(btn)) return;
      Lock.lockAll(slug);
      sols.forEach((s, i) => paintPanel(i));
      paintTabs();
      toast('已全部重新上锁');
    };
    main.addEventListener('click', main._lockAllHandler);

    bindCopy(main);
  }

  // ---- 我的代码：评分 / 复制 ----
  const btnGrade = $('#btn-grade');
  if (btnGrade) {
    btnGrade.addEventListener('click', async () => {
      const code = $('#my-code').value;
      if (!code.trim()) { toast('先粘一段代码', true); return; }
      btnGrade.disabled = true;
      btnGrade.textContent = '评分中…';
      try {
        const g = await api('/problem/' + encodeURIComponent(slug) + '/grade', {
          method: 'POST', body: { code }
        });
        $('#grade-out').innerHTML = renderGradeResult(g);
        $('#grade-stamp').textContent = '刚刚评的 ' + g.total + ' 分';
        // 存下来给「记入错题本」用：错题本要算「和最优解差在哪」，就得有这次的真实评分。
        // 不存的话，用户点错题本时只能靠重新评一遍 —— 那是另一个坑。
        State.lastGrade = g;
        State.lastGradeSlug = slug;
        // 题库列表里的分数会变，下次进来要拿新的
        toast('评分完成：' + g.total + ' 分');
      } catch (e) {
        $('#grade-out').innerHTML = `<div class="grade-err">${esc(e.message)}</div>`;
      } finally {
        btnGrade.disabled = false;
        btnGrade.textContent = '评分';
      }
    });
  }
  const btnCopyMine = $('#btn-copy-mycode');
  if (btnCopyMine) {
    btnCopyMine.addEventListener('click', async () => {
      const box = $('#my-code');
      if (await copyText(box ? box.value : '')) toast('已复制');
    });
  }

  // 复习模式专属按钮（复习 +1 / 保存复习代码）必须在这里绑、绑完就 return ——
  // 上个版本把绑定写在了下面 early-return 之后，函数先 return 了，
  // 两个按钮永远没绑上：保存点了没反应、+1 也点了没反应（两个 bug 的同一根因）。
  if (reviewMistakeId) {
    // 复习 +1：记一次复习计数，然后回错题本（列表重新拉，复习次数自然会刷新）。
    $('#btn-review-plus').addEventListener('click', async () => {
      try {
        await api('/mistakes/' + encodeURIComponent(reviewMistakeId) + '/review', { method: 'POST' });
        toast('已记一次复习');
        go('#/mistakes');
      } catch (e) { toast(e.message, true); }
    });
    // 复习判题：写完真跑一遍，对错当场知道。
    // 判完后端顺手存成一张带分数的卡 —— 复习的价值就在「马上知道对不对」，
    // 再让用户点一次保存，多半就忘了，那条带分数的记录也就没了。
    $('#btn-grade-review').addEventListener('click', async () => {
      const code = $('#review-code').value;
      if (!code.trim()) { toast('先写点代码再检查', true); return; }
      const b = $('#btn-grade-review');
      b.disabled = true; b.textContent = '检查中…';
      try {
        const g = await api('/mistakes/' + encodeURIComponent(reviewMistakeId) + '/review-cards/grade', {
          method: 'POST', body: { code }
        });
        // 和上次比：上一张卡的分数就是「上次复习的成绩」，差值为负说明退步了。
        const prev = rcCards.length ? rcCards[0].totalScore : null;
        $('#review-grade-out').innerHTML = renderReviewGrade(g, prev);
        $('#review-code-stamp').textContent = '已存成第 ' + (g.count || 0) + ' 张';
        $('#review-code').value = '';
        try {
          const fresh = await api('/mistakes/' + encodeURIComponent(reviewMistakeId) + '/review-cards');
          rcCards = fresh.cards || [];
          $('#rc-hist').innerHTML = renderRcHist(rcCards);
          bindRcHist();
        } catch (e2) { /* 拉失败不影响「已判完并保存」这个事实 */ }
      } catch (e) { toast(e.message, true); }
      finally { b.disabled = false; b.textContent = '检查这次写得对不对'; }
    });
    // 保存这次复习 = 新建一张卡片（POST review-cards），不是覆盖上一张。
    // 老的一对一接口 /review-code 保留在服务端，但前端不再走它 —— 覆盖就是那个接口的病根。
    $('#btn-save-review-code').addEventListener('click', async () => {
      const code = $('#review-code').value;
      if (!code.trim()) { toast('先写点代码再保存', true); return; }
      const b = $('#btn-save-review-code');
      b.disabled = true; b.textContent = '保存中…';
      try {
        const r = await api('/mistakes/' + encodeURIComponent(reviewMistakeId) + '/review-cards', {
          method: 'POST', body: { code }
        });
        $('#review-code-stamp').textContent = '已保存 ' + new Date().toLocaleTimeString();
        $('#review-code').value = '';
        // 保存完立刻把新卡压进堆里，不用等刷新 —— 用户要看见「多了一张」。
        try {
          const fresh = await api('/mistakes/' + encodeURIComponent(reviewMistakeId) + '/review-cards');
          rcCards = fresh.cards || [];
          $('#rc-hist').innerHTML = renderRcHist(rcCards);
          bindRcHist();
        } catch (e2) { /* 拉失败就保持旧堆，不影响保存已成功这个事实 */ }
        toast('已存成第 ' + (r.count || 0) + ' 张复习卡');
      } catch (e) { toast(e.message, true); }
      finally { b.disabled = false; b.textContent = '只保存不检查'; }
    });
    bindRcHist();
    // 复习模式到此为止 —— 后面的笔记/完成/错题按钮只存在于看题模式，
    // 复习模式的 DOM 里根本没有这些节点，直接绑会 TypeError。
    return;
  }

  // 笔记
  $('#btn-save-note').addEventListener('click', async () => {
    try {
      await api('/progress/' + encodeURIComponent(slug) + '/note', {
        method: 'POST', body: { note: $('#my-note').value }
      });
      toast('笔记已保存');
    } catch (e) { toast(e.message, true); }
  });

  // 完成
  $('#btn-done').addEventListener('click', async () => {
    const isDone = $('#btn-done').textContent.trim() === '取消完成';
    try {
      await api('/progress/' + encodeURIComponent(slug), {
        method: 'POST', body: { status: isDone ? 'todo' : 'done' }
      });
      $('#btn-done').textContent = isDone ? '标记完成' : '取消完成';
      await refreshToday();
      toast(isDone ? '已取消' : '打卡完成');
    } catch (e) { toast(e.message, true); }
  });

  // 错题
  $('#btn-mistake').addEventListener('click', () => {
    // 只有这道题刚评过分的，才有对比数据可用来自动填写。
    // 换了题目 slug 就不该拿上一题的成绩来套，那是张冠李戴。
    const sameSlug = State.lastGradeSlug === slug;
    openMistakeModal({
      problemSlug: slug,
      problemTitle: p.title || p.titleCn || slug,
      tag: (p.tags || '').split(',')[0] || '',
      gradeResult: sameSlug ? State.lastGrade : null,
      refGrades: p.refGrades
    });
  });

  // ---- 复习模式专属按钮已在前面的复习分支绑定（那里绑完直接 return）----
}

/* ============================ 填空练习 ============================ */

/**
 * 把参考解挖掉几行，让人把那一行填回来。
 *
 * 为什么是「填空」而不是「从零写」：能想出思路但写不出代码的人，缺的不是整体思路，
 * 是「这一行到底该怎么写」。给空白框他下不去手，给完整答案他看完还是不会；
 * 骨架搭好、只补那几行，是这个问题的最小台阶。
 *
 * 对错走真跑（后端 JudgeService），不跟参考解比字面 —— 写法不同但用例全过就是学会了。
 */
async function viewFill(main, slug) {
  const TIERS = [['brute', '暴力解'], ['better', '进阶解'], ['optimal', '最优解']];
  const LEVELS = [['easy', '简单 · 挖 1 行'], ['medium', '中等 · 挖 3-5 行'], ['hard', '困难 · 只留骨架']];

  let p;
  try {
    p = await api('/problem/' + encodeURIComponent(slug));
  } catch (e) {
    main.innerHTML = `<a class="back-link" href="#/library">← 回题库</a>
      <div class="notice">${esc(e.message)}</div>`;
    return;
  }

  const st = { tier: 'brute', level: 'easy', sheet: null, answers: {} };

  main.innerHTML = `
    <a class="back-link" href="#/problem/${escAttr(slug)}">← 回到题目</a>
    <div class="page-head">
      <div class="eyebrow">填空练习 · #${esc(p.frontendId || '')} · ${diffLabel(p.difficulty)}</div>
      <h1>${esc(p.title || slug)}</h1>
      <p class="sub">骨架已经搭好，把挖掉的那几行填回来。交卷会用官方示例真跑一遍 —— <b>写法跟我不同但跑得通，就算你对</b>。</p>
    </div>
    <div class="fill-bar">
      <div class="fill-pick" id="fill-tiers"></div>
      <div class="fill-pick" id="fill-levels"></div>
    </div>
    <div id="fill-body"><div class="loading">正在出题…</div></div>
    <div id="fill-out"></div>
  `;

  const drawPicks = () => {
    $('#fill-tiers').innerHTML = TIERS.map(([k, label]) =>
      `<button class="fbtn${st.tier === k ? ' cur' : ''}" data-tier="${k}">${label}</button>`).join('');
    $('#fill-levels').innerHTML = LEVELS.map(([k, label]) =>
      `<button class="fbtn${st.level === k ? ' cur' : ''}" data-level="${k}">${label}</button>`).join('');
  };

  async function load() {
    $('#fill-body').innerHTML = '<div class="loading">正在出题…</div>';
    $('#fill-out').innerHTML = '';
    st.answers = {};
    try {
      st.sheet = await api('/problem/' + encodeURIComponent(slug) +
        '/fill?tier=' + encodeURIComponent(st.tier) + '&level=' + encodeURIComponent(st.level));
    } catch (e) {
      $('#fill-body').innerHTML = `<div class="notice">${esc(e.message)}</div>`;
      return;
    }
    paint();
  }

  function paint() {
    $('#fill-body').innerHTML = fillSheetHtml(st.sheet, st.answers);
    const inputs = $$('.fl-input', $('#fill-body'));
    inputs.forEach(inp => {
      // 只记答案、不重绘：重绘会把光标和已输入的内容顶掉
      inp.addEventListener('input', () => { st.answers[inp.dataset.hole] = inp.value; });
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const i = inputs.indexOf(inp);
        if (i >= 0 && i < inputs.length - 1) inputs[i + 1].focus();
        else submit();
      });
    });
    if (inputs.length) inputs[0].focus();
    $('#btn-fill-check').addEventListener('click', submit);
    $('#btn-fill-reset').addEventListener('click', () => {
      st.answers = {};
      $('#fill-out').innerHTML = '';
      paint();
    });
  }

  async function submit() {
    const btn = $('#btn-fill-check');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '判题中…';
    try {
      const res = await api('/problem/' + encodeURIComponent(slug) + '/fill/check', {
        method: 'POST',
        body: { tier: st.tier, level: st.level, answers: st.answers },
      });
      $('#fill-out').innerHTML = renderFillResult(res, st.sheet);
      $('#fill-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  drawPicks();
  $('#fill-tiers').addEventListener('click', e => {
    const b = e.target.closest('[data-tier]');
    if (!b || b.dataset.tier === st.tier) return;
    st.tier = b.dataset.tier;
    drawPicks();
    load();
  });
  $('#fill-levels').addEventListener('click', e => {
    const b = e.target.closest('[data-level]');
    if (!b || b.dataset.level === st.level) return;
    st.level = b.dataset.level;
    drawPicks();
    load();
  });

  await load();
}

/**
 * 画出卷面。空位换成输入框，其余行原样等宽显示 ——
 * 这里刻意不做语法高亮：逐行高亮会把跨行的块注释状态切断，反而更容易看错。
 */
function fillSheetHtml(sheet, answers) {
  const lines = String(sheet.template || '').replace(/\r\n/g, '\n').split('\n');
  const byId = {};
  (sheet.blanks || []).forEach(b => { byId[b.id] = b; });

  const rows = lines.map(line => {
    const m = line.match(/@@HOLE:(\d+)@@/);
    if (!m) return `<div class="fl-row"><pre class="fl-txt">${esc(line) || ' '}</pre></div>`;
    const id = m[1];
    const b = byId[id] || {};
    const indent = line.slice(0, line.indexOf('@@HOLE'));
    const val = (answers && answers[id]) || '';
    const tip = [b.shape, b.around].filter(Boolean).join(' · ');
    return `<div class="fl-row fl-hole">
      <pre class="fl-txt">${esc(indent)}</pre>
      <input class="fl-input" data-hole="${escAttr(id)}" value="${escAttr(val)}"
        spellcheck="false" autocomplete="off" placeholder="填这一行" title="${escAttr(tip)}">
      <span class="fl-tag">#${esc(id)}</span>
    </div>`;
  }).join('');

  const hints = (sheet.blanks || []).map(b => `<li><b>#${b.id}</b> 第 ${b.line} 行 · ${esc(b.shape || '')}
      ${b.around ? `<span class="fl-around">${esc(b.around)}</span>` : ''}</li>`).join('');

  return `
    <div class="fill-meta">${esc(sheet.tierName || '')} · 共 ${sheet.totalLines} 行 · 挖了 ${(sheet.blanks || []).length} 个空</div>
    <div class="fill-code">${rows}</div>
    <details class="fill-hints">
      <summary>看不出该填什么？这里有位置提示（不含答案）</summary>
      <ul>${hints}</ul>
    </details>
    <div class="row" style="margin-top:var(--s4)">
      <div class="fixed"><button class="btn" id="btn-fill-check">交卷，检查对不对</button></div>
      <div class="fixed"><button class="btn ghost" id="btn-fill-reset">清空重填</button></div>
      <div class="fixed"><span class="mono-sm">回车跳下一个空</span></div>
    </div>`;
}

/**
 * 交卷结果。刻意不调用 renderGradeResult —— 那张卡带锐评，
 * 而这里的代码八成是参考解，锐评就会说「这题你是真懂了」，那是假的。
 * 只回答三件事：用例过没过、哪个空跟参考写法不一样、这套解法本身值几分。
 */
function renderFillResult(res, sheet) {
  if (!res || res.ok === false) {
    return `<div class="notice">${esc((res && (res.error || res.message)) || '出错了')}</div>`;
  }
  if (!res.rebuilt) {
    const miss = (res.missing || []).map(id => '#' + id).join('、');
    return `<div class="fill-res">
      <div class="fr-head">还差点</div>
      <p>${esc(res.message || '有空没填')}${miss ? `（${esc(miss)}）` : ''}</p>
    </div>`;
  }

  const g = res.grade || {};
  const j = g.judge || null;
  const passed = !!res.passedJudge;

  let judgeLine;
  if (g.compiled === false) {
    judgeLine = `<div class="fr-line bad">编译没过：${esc((g.compileErrors && g.compileErrors[0]) || '看看括号和分号')}</div>`;
  } else if (!j) {
    judgeLine = `<div class="fr-line">这题不支持真跑判题，所以只确认了能编译过。</div>`;
  } else if (j.ran === false) {
    judgeLine = `<div class="fr-line">这题判不了：${esc(j.reason || '')}</div>`;
  } else {
    judgeLine = `<div class="fr-line ${passed ? 'good' : 'bad'}">官方示例用例 ${j.passed} / ${j.total}${passed ? ' 全过' : ' —— 还有没过的'}</div>`;
    const fails = j.failures || [];
    if (fails.length) {
      judgeLine += `<div class="fr-fails">` + fails.slice(0, 3).map(f =>
        `<div class="fr-fail"><span class="frf-k">输入</span><code>${esc(f.input || '')}</code>
          <span class="frf-k">期望</span><code>${esc(f.expected || '')}</code>
          <span class="frf-k">你的</span><code class="bad">${esc(f.got || '')}</code></div>`).join('')
        + (fails.length > 3 ? `<div class="fr-more">还有 ${fails.length - 3} 个没过</div>` : '')
        + `</div>`;
    }
  }

  const bad = (res.blanks || []).filter(b => !b.matches).map(b => '#' + b.id);
  let mismatchLine;
  if (bad.length === 0) {
    mismatchLine = `<div class="fr-line good">每个空都和参考写法一致。</div>`;
  } else if (passed) {
    mismatchLine = `<div class="fr-line good">你填的和参考写法不一样（${esc(bad.join('、'))}），但用例跑通了 —— 那就是对的，不用改成我的写法。</div>`;
  } else {
    mismatchLine = `<div class="fr-line bad">这几个空和参考写法不一致：${esc(bad.join('、'))}。先改这几个试试。</div>`;
  }

  const total = g.total == null ? '-' : g.total;
  return `<div class="fill-res ${passed ? 'good' : 'bad'}">
    <div class="fr-head">${passed ? '过了' : '还没过'}</div>
    ${judgeLine}
    ${mismatchLine}
    <div class="fr-note">下面这个分数是「这套解法本身」的分数，不是你填空的分数（你填的是${esc((sheet && sheet.tierName) || '参考解')}）：<b>${esc(String(total))}</b> / 10</div>
  </div>`;
}

/* ============================ 我的代码 + 评分 ============================ */

/**
 * 渲染「粘贴我的代码」区域。
 *
 * 设计原则：不编分数。评分只有两件事是真的 ——
 *   ① javac 真的编译了（可实测）
 *   ② 静态结构分析推断复杂度/规范（推断，前端必须标出来）
 * 没有测试用例，所以没有「对不对」这一项，页面也不该假装有。
 */
/* ---------------------- 复习卡片堆叠 ---------------------- */

/**
 * 历史复习卡堆：一张卡 = 一次复习写的代码。
 *
 * 收起态只露一条窄条（第几次 + 时间 + 首行预览），点开才铺满整个代码区。
 * 之所以默认收起：复习到第十次时，十份完整代码同时展开会把题面挤到看不见，
 * 而复习时最常做的是「扫一眼当时怎么写的」，不是逐字重读。
 */
/**
 * 复习判题的结果块。
 * 和看题页的评分卡不同：这里不铺开七个维度，只回答一个问题 ——
 * 「我这次写的，比上次好还是差」。复习时人只关心这个。
 */
function renderReviewGrade(g, prevScore) {
  const total = Number(g.total || 0);
  const cls = total >= 8.5 ? 'good' : total >= 6.5 ? 'mid' : 'bad';

  // prevScore 为空 = 第 1 次复习，没有可比对象。不能凭空说「进步了」。
  let deltaHtml;
  if (prevScore == null) {
    deltaHtml = '<span class="rg-delta first">第 1 次复习，先记下这个分数当基准</span>';
  } else {
    const d = total - Number(prevScore);
    const word = d > 0.05 ? `比上次高 ${d.toFixed(1)}`
      : d < -0.05 ? `比上次低 ${Math.abs(d).toFixed(1)}`
      : '和上次持平';
    const arrow = d > 0.05 ? '↑' : d < -0.05 ? '↓' : '=';
    const kind = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'same';
    deltaHtml = `<span class="rg-delta ${kind}">${arrow} ${word}（上次 ${Number(prevScore).toFixed(1)}）</span>`;
  }

  // 判题结果才是这次复习的关键：编译过了但用例错，说明思路有漏洞。
  let judgeHtml = '';
  const j = g.judge;
  if (j && j.ran) {
    const ok = j.passed === j.total;
    const fails = ok ? '' : (j.failures || []).slice(0, 2).map(f => `
      <div class="rg-fail">
        <span class="rgf-k">输入</span> <code>${esc(String(f.input || ''))}</code>
        <span class="rgf-k">期望</span> <code>${esc(String(f.expected || ''))}</code>
        <span class="rgf-k">你的</span> <code class="rgf-got">${esc(String(f.got || ''))}</code>
      </div>`).join('');
    judgeHtml = `
      <div class="rg-judge ${ok ? 'ok' : 'no'}">用例 ${j.passed} / ${j.total} ${ok ? '全过' : '有错的'}</div>
      ${fails ? `<div class="rg-fails">${fails}</div>` : ''}
      ${!ok && (j.failures || []).length > 2 ? `<div class="rg-more">还有 ${j.failures.length - 2} 个用例没过</div>` : ''}`;
  } else if (g.compiled === false) {
    // 编译不过必须排在「判不了」前面：代码没编译时判题器当然也没跑，
    // 但把这个显示成「这题不支持真跑判题」是在骗人 —— 那是题目的事，
    // 这是你自己代码的事，而且下一句就能改。顺序反了会把人指向错的方向。
    judgeHtml = `<div class="rg-judge no">编译没过，先修语法${g.compileErrors && g.compileErrors[0] ? '：' + esc(g.compileErrors[0]) : ''}</div>`;
  } else if (j && j.ran === false) {
    judgeHtml = `<div class="rg-judge skip">这题不支持真跑判题${j.reason ? '：' + esc(j.reason) : ''} —— 分数只按静态分析算</div>`;
  }

  return `
    <div class="rg-box ${cls}">
      <div class="rg-head">
        <span class="rg-score">${total.toFixed(1)}</span><span class="rg-of"> / 10</span>
        ${deltaHtml}
      </div>
      ${judgeHtml}
    </div>`;
}

function renderRcHist(cards) {
  if (!cards || !cards.length) {
    return `
      <div class="rc-empty">
        还没有历史复习卡。上面写完点「检查」，它会成为第 1 张压在这里。
      </div>`;
  }
  return cards.map(c => {
    const firstLine = (c.code || '').split('\n').find(l => l.trim()) || '（空）';
    const preview = firstLine.trim().slice(0, 60);
    const lines = (c.code || '').split('\n').length;
    return `
      <div class="rc-card rc-old" data-card="${c.id}">
        <button class="rc-head rc-toggle" type="button" aria-expanded="false">
          <span class="rc-seq">第 ${c.seq} 次</span>
          ${c.totalScore == null
            ? '<span class="rc-noscore">未判题</span>'
            : `<span class="rc-score ${c.totalScore >= 8.5 ? 'good' : c.totalScore >= 6.5 ? 'mid' : 'bad'}">${Number(c.totalScore).toFixed(1)}</span>`}
          <span class="rc-time">${esc(fmtRcTime(c.createdAt))} · ${lines} 行</span>
          <span class="rc-preview">${esc(preview)}</span>
          <span class="rc-caret">▾</span>
        </button>
        <div class="rc-body" hidden>
          <pre class="rc-code">${esc(c.code || '')}</pre>
          <div class="row" style="margin-top:var(--s3)">
            <div class="fixed"><button class="btn ghost rc-del" type="button" data-card="${c.id}">删除这张</button></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function fmtRcTime(s) {
  if (!s) return '';
  // 后端给的是 java.sql.Timestamp.toString()：2026-11-03 20:52:40.123
  // 只留到分钟，秒和毫秒对复习场景没意义。
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(s);
}

/** 卡堆的事件绑定：展开/收起 + 删除。每次重渲染卡堆后必须重绑。 */
function bindRcHist() {
  const hist = $('#rc-hist');
  if (!hist) return;

  hist.querySelectorAll('.rc-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.rc-card');
      const body = card.querySelector('.rc-body');
      const open = !body.hidden;
      body.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
      card.classList.toggle('rc-open', !open);
    });
  });

  hist.querySelectorAll('.rc-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cardId = btn.dataset.card;
      if (!confirm('删掉这张复习卡？删了就找不回来了。')) return;
      const mid = State.rcMistakeId;
      if (!mid) return;
      btn.disabled = true; btn.textContent = '删除中…';
      try {
        await api('/mistakes/' + encodeURIComponent(mid) + '/review-cards/' + encodeURIComponent(cardId),
          { method: 'DELETE' });
        const fresh = await api('/mistakes/' + encodeURIComponent(mid) + '/review-cards');
        hist.innerHTML = renderRcHist(fresh.cards || []);
        bindRcHist();
        toast('已删掉一张');
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false; btn.textContent = '删除这张';
      }
    });
  });
}

function renderMyCodeArea(p, slug) {
  const mine = p.myCode || '';

  // 顶部那条「三个参考解法得分」已经删了：每个解法卡内部现在自带完整评分，
  // 同一份分数画两遍只会让人以为有两套标准。tab 上的小角标也够用来横向比。
  return `
  <div class="mycode-wrap">
    <textarea id="my-code" class="code-input" spellcheck="false" placeholder="把你在力扣写的代码整段粘进来（class Solution 或只贴方法都行）">${esc(mine)}</textarea>

    <div class="row" style="margin-top:var(--s3)">
      <div class="fixed"><button class="btn" id="btn-grade">评分</button></div>
      <div class="fixed"><button class="btn ghost" id="btn-copy-mycode">复制我的代码</button></div>
      <div class="fixed"><span class="mono-sm" id="grade-stamp">${p.myScore != null ? '上次 ' + p.myScore + ' 分' : '还没评过'}</span></div>
    </div>

    <div id="grade-out"></div>
  </div>`;
}

/** 渲染评分结果：六个维度 + 总分 + 哪些是实测哪些是推断 */
function renderGradeResult(g) {
  if (!g || !g.ok) {
    return `<div class="grade-err">${esc((g && g.error) || '评分失败')}</div>`;
  }
  const dims = (g.dimensions || []).map(d => {
    const pct = (d.score / 10 * 100).toFixed(1);
    const tag = d.verifiable
      ? '<span class="vtag real">实测</span>'
      : '<span class="vtag guess">推断</span>';
    const ev = (d.evidence || []).filter(Boolean)
      .map(x => `<li>${esc(x)}</li>`).join('');
    return `
    <div class="grade-dim">
      <div class="grade-dim-head">
        <span class="grade-dim-name">${esc(d.label)} ${tag}</span>
        <span class="grade-dim-score">${d.score}<span class="of">/10</span></span>
      </div>
      <div class="score-bar"><i class="${d.score >= 8 ? 'good' : d.score >= 5 ? 'mid' : 'bad'}" style="width:${pct}%"></i></div>
      <div class="grade-dim-reason">${esc(d.reason)}</div>
      ${ev ? `<ul class="grade-ev">${ev}</ul>` : ''}
    </div>`;
  }).join('');

  const total = g.total;
  const cls = total >= 8 ? 'good' : total >= 5 ? 'mid' : 'bad';
  const notes = [];
  if (g.compiled === false) notes.push('没编译通过 —— 先把语法改对，其他评分意义不大。');
  if (g.compiled && g.signatureOk === false) {
    notes.push('方法名对不上力扣要调用的 ' + esc(g.expectedMethod || '') +
      '(' + esc(g.expectedParams || '') + ')，判题器会调不到你。');
  }

  // 判题结果：这是全卡唯一能回答「我到底做对没有」的部分，放在最前面。
  const j = g.judge;
  let judgeBlock = '';
  if (j && j.ran && j.total > 0) {
    const allPass = j.passed === j.total;
    const jc = allPass ? 'good' : j.passed === 0 ? 'bad' : 'mid';
    const fails = (j.failures || []).slice(0, 3).map(f => `
      <div class="judge-fail">
        <span class="jf-k">输入</span> <code>${esc(String(f.input || ''))}</code>
        <span class="jf-k">期望</span> <code>${esc(String(f.expected || ''))}</code>
        <span class="jf-k">你的</span> <code class="jf-got">${esc(String(f.got || ''))}</code>
      </div>`).join('');
    judgeBlock = `
    <div class="judge-box ${jc}">
      <div class="judge-head">
        <span class="judge-title">真跑官方示例</span>
        <span class="judge-score ${jc}">${j.passed} / ${j.total}</span>
      </div>
      <div class="judge-line">${allPass
        ? '全部通过。这题的答案是对的。'
        : `有 ${j.total - j.passed} 个用例答案是错的 —— 代码能跑，但结果不对。`}</div>
      ${fails ? `<div class="judge-fails">${fails}</div>` : ''}
      ${(j.failures || []).length > 3 ? `<div class="judge-more">还有 ${j.failures.length - 3} 个用例没过</div>` : ''}
    </div>`;
  } else if (j && j.ran === false) {
    judgeBlock = `<div class="judge-box skip"><div class="judge-line">这题没法真跑判题：${esc(j.reason || '')}</div></div>`;
  } else if (!j) {
    judgeBlock = `<div class="judge-box skip"><div class="judge-line">这题不支持真跑判题（没有单函数入口，或者用例缺失），正确性这一项已从总分里剔除，不是按 0 分算。</div></div>`;
  }

  return `
  <div class="grade-card">
    <div class="grade-total ${cls}">
      <div class="grade-total-num">${total}</div>
      <div class="grade-total-of">/ 10</div>
    </div>
    ${notes.length ? `<div class="grade-notes">${notes.map(n => `<div>${n}</div>`).join('')}</div>` : ''}
    ${judgeBlock}
    <div class="grade-dims">${dims}</div>
    ${typeof renderRoast === 'function' ? renderRoast(g) : ''}
    <div class="grade-disclaim">
      正确性是<b>真跑官方示例用例</b>跑出来的（把代码编译后在同一个进程里加载执行，逐用例比对返回值）；
      编译是 javac 真跑的。复杂度、思路、空间、边界、规范这五项是按代码结构静态推断的，
      标了「推断」。判不了题的题（设计类，没有单一函数入口）已经把正确性从加权里剔除并重新归一。
    </div>
  </div>`;
}


/**
 * 参考解法评分块：贴在每个解法卡内部。
 *
 * 为什么放在卡里而不是只放顶部一条总分：
 * 顶部那条只回答「三个解法谁高谁低」，看完还是不知道该学哪一项。
 * 放进卡里，才能一眼看到「这个解法强在复杂度、弱在边界」这种具体差距。
 *
 * 注意分数不是新算的 —— 直接复用后端 refGrades（跟「我的代码」同一个 grade() 方法、
 * 同一个最优解基准），所以「我的 8.1」和「暴力 7.3」是可比的。
 */
function refGradeBlock(g) {
  if (!g || !g.dimensions) return '';
  const color = v => v >= 8 ? 'good' : v >= 6 ? 'mid' : 'bad';
  const dims = g.dimensions.map(d => `
      <div class="rgd-row">
        <span class="rgd-name">${esc(d.label)}${d.verifiable ? '' : '<span class="vtag guess">推断</span>'}</span>
        <div class="score-bar sm"><i class="${color(d.score)}" style="width:${(d.score / 10 * 100).toFixed(1)}%"></i></div>
        <span class="rgd-num">${d.score}</span>
      </div>`).join('');

  return `
      <div class="ref-grade">
        <div class="rg-total">
          <span class="rg-total-label">这个解法的评分</span>
          <span class="rg-total-num ${color(g.total)}">${g.total}</span>
          <span class="rg-total-of">/ 10</span>
        </div>
        <div class="rg-dims">${dims}</div>
        <div class="rg-foot">
          编译是 javac 真跑的；其余维度按代码结构推断，仅供参考。没有测试用例，所以不判答案对不对。
        </div>
      </div>`;
}

function solBody(s, i, refGrades) {
  const g = refGrades && s.tier ? refGrades[s.tier] : null;
  return `
      <div class="sol-head">
        <div class="sol-name">${esc(s.title || ('解法 ' + (i + 1)))}</div>
        <div class="sol-cx">
          ${s.timeComplexity ? `时间 <b>${esc(s.timeComplexity)}</b>` : ''}
          ${s.spaceComplexity ? `空间 <b>${esc(s.spaceComplexity)}</b>` : ''}
        </div>
      </div>

      ${refGradeBlock(g)}

      <div class="sol-block">
        <h4>思路</h4>
        <div class="idea-text">${esc(s.idea || '')}</div>
      </div>

      <div class="sol-block">
        <h4>中文伪代码 · 先照着这个自己写</h4>
        <div class="pseudo">${esc(s.pseudocode || '')}</div>
      </div>

      <div class="prompt-box">
        <h4>动手之前，回答这三个问题</h4>
        <ol>
          <li>这段伪代码里，<b>哪一行是循环的核心</b>？它每轮在维护什么？</li>
          <li>如果输入是空数组 / 只有一个元素 / 全部相同，会发生什么？</li>
          <li>关掉这个页面，你能默写出关键的三行吗？写不出就先别往下看。</li>
        </ol>
      </div>

      <div class="sol-block">
        <h4>Java 代码</h4>
        <div class="code-wrap">
          <button class="code-copy">复制</button>
          <pre><code>${hlJava(s.codeJava || '')}</code></pre>
        </div>
      </div>`;
}

function renderSolTabs(sols, slug, refGrades) {
  const tabs = sols.map((s, i) => {
    const locked = !Lock.isUnlocked(slug, i);
    const g = refGrades && s.tier ? refGrades[s.tier] : null;
    const scoreTag = g ? `<span class="tab-score ${g.total >= 8 ? 'good' : g.total >= 6 ? 'mid' : 'bad'}">${g.total}</span>` : '';
    return `
    <button class="sol-tab ${i === 0 ? 'active' : ''} ${locked ? 'locked' : ''}" data-target="sol-${i}" data-idx="${i}" title="${locked ? '已锁住，点 tab 或锁屏卡解锁' : '再点一次可重新锁上'}">
      <span class="lock-dot">${locked ? '🔒' : '🔓'}</span>
      <span class="tier">${TIER_LABEL[s.tier] || ''}</span>解法 ${i + 1}${scoreTag}
    </button>`;
  }).join('');

  const panels = sols.map((s, i) => {
    const locked = !Lock.isUnlocked(slug, i);
    return `
    <div class="sol-panel ${locked ? 'is-locked' : ''}" id="sol-${i}" style="display:${i === 0 ? 'block' : 'none'}">
      ${locked ? lockCard(slug, i) : solBody(s, i, refGrades)}
    </div>`;
  }).join('');

  const unlockedCount = sols.filter((s, i) => Lock.isUnlocked(slug, i)).length;

  return `
  <div class="lock-bar">
    <span class="lock-state">已解锁 <b>${unlockedCount}</b> / ${sols.length}</span>
    <button class="btn ghost sm" id="btn-lock-all">全部重新上锁</button>
  </div>
  <div class="sol-tabs">${tabs}</div>${panels}`;
}

/* ============================ 题库 ============================ */

async function viewLibrary(main, prefillQ) {
  const list = await api('/problems');

  main.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">题库 · 已入库 ${list.length} 题</div>
      <h1>题库</h1>
      <p class="sub">这里只显示已经有解法内容的题。想加新题，用下面的搜索框从力扣拉取。</p>
    </div>

    <div class="row" style="margin-bottom:var(--s5)">
      <div><input type="text" id="q" placeholder="搜题号或标题，例如 1 / two sum / 滑动窗口"></div>
      <div class="fixed"><select id="diff" style="width:120px">
        <option value="ALL">全部难度</option>
        <option value="EASY">简单</option>
        <option value="MEDIUM">中等</option>
        <option value="HARD">困难</option>
      </select></div>
      <div class="fixed"><button class="btn" id="btn-search">搜索力扣</button></div>
    </div>

    <div id="search-results"></div>

    <h2 class="sec">已入库 <span class="cnt">${list.length}</span></h2>
    <div id="lib-list"></div>
  `;

  renderLibList(list);

  $('#btn-search').addEventListener('click', doSearch);
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  // 从错题本「去题库找」跳过来时带着题名：填进搜索框并直接搜，省掉一次手打
  if (prefillQ) {
    // 题名常带「1. 」这类题号前缀，搜力扣时反而不如纯标题好命中
    $('#q').value = String(prefillQ).replace(/^\s*[[【(（]?\s*\d+\s*[\]】)）]?\s*[.、:：]?\s*/, '');
    doSearch();
  }

  async function doSearch() {
    const q = $('#q').value.trim();
    const difficulty = $('#diff').value;
    const box = $('#search-results');
    box.innerHTML = '<div class="loading">搜索中…</div>';
    try {
      const res = await api('/leetcode/search?q=' + encodeURIComponent(q) +
                            '&difficulty=' + difficulty + '&limit=25');
      if (!res.length) { box.innerHTML = '<div class="empty">没搜到</div>'; return; }
      box.innerHTML = `
        <h2 class="sec">力扣搜索结果 <span class="cnt">${res.length}</span></h2>
        <div class="task-list">` + res.map(r => `
          <div class="task" style="cursor:default">
            <div class="task-idx">${esc(r.frontendId || '')}</div>
            <div class="task-body">
              <div class="task-title">${esc(r.title || r.titleCn || r.titleEn || r.slug)}</div>
              <div class="task-meta">
                ${diffHtml(r.difficulty)}
                <span>${esc(r.slug)}</span>
              </div>
            </div>
            <div class="task-right">
              ${r.inLibrary
                ? '<span class="chip done">已入库</span>'
                : `<button class="btn small" data-fetch="${escAttr(r.slug)}">拉取</button>`}
            </div>
          </div>`).join('') + '</div>';

      $$('[data-fetch]', box).forEach(b => {
        b.addEventListener('click', async () => {
          b.disabled = true; b.textContent = '拉取中…';
          try {
            await api('/problem/' + encodeURIComponent(b.dataset.fetch) + '/fetch', { method: 'POST' });
            b.className = 'chip done'; b.textContent = '已入库';
            toast('已拉取题面，去题库点进去补解法');
          } catch (e) {
            toast(e.message, true); b.disabled = false; b.textContent = '拉取';
          }
        });
      });
    } catch (e) {
      box.innerHTML = `<div class="notice">${esc(e.message)}</div>`;
    }
  }
}

function renderLibList(list) {
  const box = $('#lib-list');
  if (!list.length) {
    box.innerHTML = '<div class="empty"><span class="big">▤</span>题库还是空的，用上面的搜索框拉几道题进来</div>';
    return;
  }
  box.innerHTML = '<div class="task-list">' + list.map(p => {
    const tags = (p.tags || '').split(',').filter(Boolean).slice(0, 3)
      .map(x => `<span class="chip">${esc(x)}</span>`).join('');
    return `
      <div class="task ${p.status === 'done' ? 'done' : ''}" data-slug="${escAttr(p.slug)}">
        <div class="task-idx">${esc(p.frontendId || '—')}</div>
        <div class="task-body">
          <div class="task-title">${esc(p.title)}</div>
          <div class="task-meta">
            ${diffHtml(p.difficulty)}
            ${tags}
          </div>
        </div>
        <div class="task-right">
          <span class="chip sol">${p.solutionCount} 解</span>
        </div>
      </div>`;
  }).join('') + '</div>';

  $$('.task[data-slug]', box).forEach(row => {
    row.addEventListener('click', () => go('#/problem/' + row.dataset.slug));
  });
}

/* ============================ 错题本 ============================ */

async function viewMistakes(main) {
  const list = await api('/mistakes');
  State.mistakes = list;

  main.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">错题本 · ${list.filter(m => !m.mastered).length} 道待攻</div>
      <h1>错题本</h1>
      <p class="sub">只记三行：题目 / 卡在哪 / 一句话结论。不抄题解——抄了也没用。</p>
    </div>
    <div style="margin-bottom:var(--s5)">
      <button class="btn" id="btn-add-mistake">+ 记一道错题</button>
    </div>
    <div id="mistake-list"></div>
  `;

  renderMistakeList(list);
  $('#btn-add-mistake').addEventListener('click', () => openMistakeModal({}));
}

// 错题本一页几道。写在这里而不是散在 renderMistakeList 里，
// 因为翻页逻辑和它必须一致 —— 两处各写一个数字迟早对不上。
const MISTAKE_PAGE_SIZE = 6;

/**
 * 分页条。只有一页时返回空串 —— 一条错题都没有还画个「1 / 1」是噪音。
 * 页码超过 7 个时用省略号收中间，否则一屏就撑爆了。
 */
function pagerHtml(page, totalPages, totalItems) {
  if (totalPages <= 1) return '';

  const btn = (to, label, opts = {}) =>
    `<button class="pager-btn${opts.cur ? ' cur' : ''}" data-mpage="${to}"${opts.disabled ? ' disabled' : ''}>${label}</button>`;

  // 页码序列：首页、末页必留，当前页前后各留一个，中间用 …
  const nums = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }

  return `
    <div class="pager">
      ${btn('prev', '← 上一页', { disabled: page <= 1 })}
      <div class="pager-nums">
        ${nums.map(n => n === '…'
          ? '<span class="pager-gap">…</span>'
          : btn(n, String(n), { cur: n === page })).join('')}
      </div>
      ${btn('next', '下一页 →', { disabled: page >= totalPages })}
      <span class="pager-info">第 ${page} / ${totalPages} 页 · 共 ${totalItems} 条</span>
    </div>`;
}

function renderMistakeList(list) {
  const box = $('#mistake-list');
  if (!list || !list.length) {
    box.innerHTML = '<div class="empty"><span class="big">✕</span>还没有错题。做错了就记一条，比刷十道新题有用</div>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(list.length / MISTAKE_PAGE_SIZE));
  // 夹住页码：删掉最后一页的最后一条后，原页码就指到空气里了。
  // 这里夹而不是让 render 报错，是因为「删到空页」是正常操作，不是异常。
  const page = Math.min(Math.max(1, State.mistakesPage || 1), totalPages);
  State.mistakesPage = page;

  const from = (page - 1) * MISTAKE_PAGE_SIZE;
  const pageItems = list.slice(from, from + MISTAKE_PAGE_SIZE);

  box.innerHTML = pageItems.map(m => {
    const d = m.createdAt ? String(m.createdAt).slice(0, 10) : '';
    return `
      <div class="mistake-card ${m.mastered ? 'mastered' : ''}">
        <div class="mistake-top">
          <span class="mistake-title">${esc(m.problemTitle || m.problemSlug || '未命名')}</span>
          ${m.tag ? `<span class="chip">${esc(m.tag)}</span>` : ''}
          ${m.mastered ? '<span class="chip done">已掌握</span>'
                       : `<span class="chip warn">复习 ${m.reviewCount || 0} 次</span>`}
          <span class="mistake-date">${esc(d)}</span>
        </div>
        ${m.whereStuck ? `<div class="mistake-row"><b>卡在哪</b>${esc(m.whereStuck)}</div>` : ''}
        ${m.oneLiner ? `<div class="mistake-row"><b>一句话结论</b>${esc(m.oneLiner)}</div>` : ''}
        <div class="mistake-acts">
          ${m.problemSlug
            ? `<button class="btn small ghost" data-open="${escAttr(m.problemSlug)}">看题</button>`
            /* 没关联到题库的，按钮也得在 —— 但点进去要有用。
               直接带着题名跳题库搜索，比一个点了没反应的死按钮强。 */
            : `<button class="btn small ghost" data-find="${escAttr(m.problemTitle || '')}" title="题库里没找到同名的题，去题库搜一下">去题库找</button>`}
          <button class="btn small ghost" data-review="${m.id}" data-review-slug="${escAttr(m.problemSlug || '')}">复习</button>
          <button class="btn small ghost" data-master="${m.id}" data-cur="${m.mastered ? 1 : 0}">
            ${m.mastered ? '标记未掌握' : '标记已掌握'}
          </button>
          <button class="btn small danger" data-del="${m.id}">删除</button>
        </div>
      </div>`;
  }).join('') + pagerHtml(page, totalPages, list.length);

  // 翻页按钮：只换页码重画列表，不重新拉接口。
  // 错题数据在 State.mistakes 里已经是完整的，为了翻页再打一次网络纯属浪费。
  $$('[data-mpage]', box).forEach(b => b.addEventListener('click', () => {
    const to = b.dataset.mpage;
    if (to === 'prev') State.mistakesPage = page - 1;
    else if (to === 'next') State.mistakesPage = page + 1;
    else State.mistakesPage = parseInt(to, 10) || 1;
    renderMistakeList(State.mistakes);
    // 翻完滚回列表顶部 —— 否则在第 3 页点「下一页」，眼睛还停在页面底部。
    const top = $('#mistake-list');
    if (top && top.scrollIntoView) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  $$('[data-open]', box).forEach(b => b.addEventListener('click', () => go('#/problem/' + b.dataset.open)));
  // 没关联题库的错题：带去题库页并把题名填进搜索框，用户自己决定拉哪道
  $$('[data-find]', box).forEach(b => b.addEventListener('click', () => {
    go('#/library/' + encodeURIComponent(b.dataset.find || ''));
  }));

  $$('[data-review]', box).forEach(b => b.addEventListener('click', () => {
    // 「复习」跳进复习界面：题面 + 我的代码 + 复习 +1。
    // 需要两个值：题目 slug（渲染题面）和错题 id（复习 +1 记数用）。
    // 没关联题库的错题没 slug，复习界面没题面可看 —— 这种留在原地 +1 更有用。
    const mid = b.dataset.review;
    const slug = b.dataset.reviewSlug;
    if (!slug) {
      api('/mistakes/' + encodeURIComponent(mid) + '/review', { method: 'POST' })
        .then(() => { toast('复习次数 +1'); viewMistakes($('#main')); })
        .catch(e => toast(e.message, true));
      return;
    }
    go('#/review/' + encodeURIComponent(slug) + '/' + encodeURIComponent(mid));
  }));

  $$('[data-master]', box).forEach(b => b.addEventListener('click', async () => {
    try {
      await api('/mistakes/' + b.dataset.master + '/mastered', {
        method: 'POST', body: { mastered: b.dataset.cur !== '1' }
      });
      await refreshToday();
      viewMistakes($('#main'));
    } catch (e) { toast(e.message, true); }
  }));

  $$('[data-del]', box).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('确定删除这条错题？')) return;
    try { await api('/mistakes/' + b.dataset.del, { method: 'DELETE' }); toast('已删除'); viewMistakes($('#main')); }
    catch (e) { toast(e.message, true); }
  }));
}

function openMistakeModal(prefill = {}) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';

  // 有没有评分结果，决定右侧「自动填写」能不能用。
  // 没评分过就不该显示一个点了没反应的按钮 —— 要么给数据，要么说清楚为什么给不了。
  const graded = prefill.gradeResult && prefill.gradeResult.ok;
  const ref = graded ? optimalRefOf(prefill.refGrades) : null;
  const canAutofill = !!(graded && ref);

  const sideHtml = canAutofill ? `
    <aside class="m-side">
      <div class="m-side-title">自动填写</div>
      <p class="m-side-desc">
        拿你这次的评分和这道题的<b>最优解</b>逐维度对比，把差距最大的那项写进「卡在哪」，
        把你没用上的手法写进「一句话结论」。
      </p>
      <button class="btn" id="m-autofill">根据最优解差距自动填写</button>
      <div class="m-side-note">
        填完还可以改。自动填写只是省掉你组织语言的时间，不是替你下结论。
      </div>
    </aside>` : `
    <aside class="m-side m-side-idle">
      <div class="m-side-title">自动填写</div>
      <p class="m-side-desc">
        先在上面点一次<b>评分</b>，我才能算出你和最优解差在哪里。
        没评分就没有对比数据，硬编一段话只是骗你。
      </p>
    </aside>`;

  mask.innerHTML = `
    <div class="modal modal-wide">
      <div class="m-grid">
        <div class="m-main">
          <h3>记一道错题</h3>
          <label class="field"><span>题目</span>
            <input type="text" id="m-title" value="${escAttr(prefill.problemTitle || '')}" placeholder="两数之和">
          </label>
          <label class="field"><span>题目 slug（可留空）</span>
            <input type="text" id="m-slug" value="${escAttr(prefill.problemSlug || '')}" placeholder="two-sum">
          </label>
          <label class="field"><span>卡在哪</span>
            <textarea id="m-stuck" placeholder="例：知道要用哈希表，但不知道 containsKey 该怎么写">${esc(prefill.whereStuck || '')}</textarea>
          </label>
          <label class="field"><span>一句话结论</span>
            <input type="text" id="m-one" value="${escAttr(prefill.oneLiner || '')}" placeholder="例：边扫边查 target-nums[i]，先查后存">
          </label>
          <label class="field"><span>分类 tag</span>
            <input type="text" id="m-tag" value="${escAttr(prefill.tag || '')}" placeholder="哈希表">
          </label>
          <div class="modal-acts">
            <button class="btn ghost" id="m-cancel">取消</button>
            <button class="btn" id="m-save">保存</button>
          </div>
        </div>
        ${sideHtml}
      </div>
    </div>`;
  document.body.appendChild(mask);

  const close = () => mask.remove();
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  $('#m-cancel', mask).addEventListener('click', close);

  // ---- 自动填写 ----
  const btnAuto = $('#m-autofill', mask);
  if (btnAuto) {
    btnAuto.addEventListener('click', () => {
      const f = mistakeAutofill(prefill.gradeResult, ref, prefill.tag || '');
      // 只填有内容的框，没算出来的不覆盖用户已经手写的东西
      if (f.whereStuck) $('#m-stuck', mask).value = f.whereStuck;
      if (f.oneLiner) $('#m-one', mask).value = f.oneLiner;
      if (f.tag) $('#m-tag', mask).value = f.tag;

      btnAuto.textContent = '已填好，可以改';
      btnAuto.disabled = true;

      // 告诉用户这些字是怎么来的，别让人以为我在瞎编
      if (f.notes && f.notes.length) {
        const box = document.createElement('div');
        box.className = 'm-side-why';
        box.innerHTML = '<b>依据</b>' + f.notes.map(n => `<div>· ${esc(n)}</div>`).join('');
        const side = $('.m-side', mask);
        if (side) side.appendChild(box);
      }
      // 光标停在「卡在哪」，让人立刻能改 —— 自动填写不该是终点
      const st = $('#m-stuck', mask);
      if (st) { st.focus(); st.setSelectionRange(st.value.length, st.value.length); }
    });
  }

  $('#m-save', mask).addEventListener('click', async () => {
    const body = {
      problemTitle: $('#m-title', mask).value.trim(),
      problemSlug: $('#m-slug', mask).value.trim(),
      whereStuck: $('#m-stuck', mask).value.trim(),
      oneLiner: $('#m-one', mask).value.trim(),
      tag: $('#m-tag', mask).value.trim()
    };
    if (!body.problemTitle) { toast('题目不能为空', true); return; }
    try {
      await api('/mistakes', { method: 'POST', body });
      close();
      await refreshToday();
      if (State.view === 'mistakes') viewMistakes($('#main'));
      toast('已记入错题本');
    } catch (e) { toast(e.message, true); }
  });
}

/* ============================ 模板库 ============================ */

async function viewSnippets(main) {
  const list = await api('/snippets');
  State.snippets = list;

  // 模板可用性判定由 CompileCheck.java 真编译产出，前端只读结果，不自己再判一遍。
  // 两套规则并存迟早漂移：界面标「可用」而实际编译不过，比不标更害人。
  let kinds = {};
  try {
    const r = await fetch('snippet-kinds.json?t=' + Date.now());
    if (r.ok) kinds = (await r.json()).kinds || {};
  } catch { /* 拿不到就全部按未质检处理 */ }
  State.snippetKinds = kinds;

  const groups = {};
  for (const s of list) {
    const c = s.category || '其他';
    (groups[c] = groups[c] || []).push(s);
  }

  const cnt = list.reduce((a, s) => {
    const k = kinds[s.category + ' / ' + s.title];
    if (k) a[k.kind] = (a[k.kind] || 0) + 1;
    return a;
  }, {});

  main.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">模板库 · ${list.length} 段 · 可直接用 ${cnt.runnable || 0} · 片段 ${cnt.fragment || 0}</div>
      <h1>代码模板</h1>
      <p class="sub">背模板不是背代码，是背「这一类题怎么起手」。写到条件反射就不用背了。</p>
    </div>
    <div style="margin-bottom:var(--s5)">
      <button class="btn" id="btn-add-snippet">+ 新增模板</button>
      <span class="mono-sm" style="margin-left:var(--s3);color:var(--ink-3)">
        「可直接用」= javac 真的编译通过了；「片段」= 教学示意，贴进力扣前要自己补上下文。
      </span>
    </div>
    <div id="snippet-list"></div>
  `;

  const box = $('#snippet-list');
  if (!list.length) {
    box.innerHTML = '<div class="empty"><span class="big">▦</span>还没有模板，点上面的按钮加一段</div>';
  } else {
    box.innerHTML = Object.keys(groups).map(cat => `
      <div class="snippet-group">
        <h2 class="sec">${esc(cat)} <span class="cnt">${groups[cat].length}</span></h2>
        ${groups[cat].map(s => {
          const k = kinds[s.category + ' / ' + s.title];
          const badge = k
            ? (k.kind === 'runnable'
                ? '<span class="skind ok" title="javac 编译通过，可以直接粘进力扣">可直接用</span>'
                : k.kind === 'broken'
                  ? `<span class="skind bad" title="${escAttr(k.reason || '')}">有问题</span>`
                  : `<span class="skind frag" title="${escAttr(k.reason || '')}">片段</span>`)
            : '';
          return `
          <div class="snippet-item">
            <div class="snippet-head">
              <span class="snippet-title">${esc(s.title || '未命名')}</span>
              ${badge}
              <span class="snippet-note">${esc(s.note || '')}</span>
            </div>
            <div class="snippet-body">
              <div class="code-wrap">
                <button class="code-copy">复制</button>
                <pre><code>${hlJava(s.code || '')}</code></pre>
              </div>
              ${k && k.kind === 'fragment' ? `<div class="skind-why">这段是教学示意：${esc(k.reason || '需要自己补上下文')}。它示范的是写法，不是能直接跑的完整程序。</div>` : ''}
              <div style="padding:var(--s3) var(--s4)">
                <button class="btn small danger" data-del-snip="${s.id}">删除</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('');

    $$('.snippet-head', box).forEach(h => h.addEventListener('click', () => {
      h.parentElement.classList.toggle('open');
    }));
    $$('.code-copy', box).forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const c = b.parentElement.querySelector('code');
      if (await copyText(c ? c.textContent : '')) {
        b.textContent = '已复制'; setTimeout(() => { b.textContent = '复制'; }, 1400);
      }
    }));
    $$('[data-del-snip]', box).forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('删除这段模板？')) return;
      try { await api('/snippets/' + b.dataset.delSnip, { method: 'DELETE' }); toast('已删除'); viewSnippets($('#main')); }
      catch (err) { toast(err.message, true); }
    }));
  }

  $('#btn-add-snippet').addEventListener('click', openSnippetModal);
}

function openSnippetModal() {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <h3>新增模板</h3>
      <label class="field"><span>分类</span>
        <input type="text" id="s-cat" placeholder="哈希表 / 双指针 / 二分 / 二叉树 …">
      </label>
      <label class="field"><span>标题</span>
        <input type="text" id="s-title" placeholder="例：边扫边查的两数之和">
      </label>
      <label class="field"><span>Java 代码</span>
        <textarea id="s-code" style="min-height:200px;font-family:var(--f-mono);font-size:12.5px"
          placeholder="for (int i = 0; i &lt; n; i++) {&#10;    ...&#10;}"></textarea>
      </label>
      <label class="field"><span>一句话备注</span>
        <input type="text" id="s-note" placeholder="什么时候用这个模板">
      </label>
      <div class="modal-acts">
        <button class="btn ghost" id="s-cancel">取消</button>
        <button class="btn" id="s-save">保存</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  $('#s-cancel', mask).addEventListener('click', close);
  $('#s-save', mask).addEventListener('click', async () => {
    const body = {
      category: $('#s-cat', mask).value.trim() || '其他',
      title: $('#s-title', mask).value.trim(),
      code: $('#s-code', mask).value,
      note: $('#s-note', mask).value.trim()
    };
    if (!body.title || !body.code.trim()) { toast('标题和代码不能为空', true); return; }
    try {
      await api('/snippets', { method: 'POST', body });
      close(); toast('已保存'); viewSnippets($('#main'));
    } catch (e) { toast(e.message, true); }
  });
}

/* ============================ 16 周计划 ============================ */

async function viewPlan(main) {
  const weeks = await api('/plan');
  const t = State.today || await refreshToday();

  const startDate = t.startDate ? new Date(t.startDate) : null;
  const dayToDate = d => {
    if (!startDate || !d) return '';
    const x = new Date(startDate.getTime() + (d - 1) * 86400000);
    return `${x.getMonth() + 1}/${x.getDate()}`;
  };

  main.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">16 周计划 · 第 ${t.dayNo} / ${t.totalDays} 天</div>
      <h1>路线图</h1>
      <p class="sub">W1–W11 按 tag 推进，W12–W16 二刷错题 + 高频题 + 模拟面试。每周第 7 天固定复盘。</p>
    </div>
    ${weeks.map(w => `
      <div class="week-row">
        <div class="week-head">
          <span class="week-no">W${w.week}</span>
          <span class="week-phase">${esc(w.phase || '')}</span>
          <span class="week-tag">${esc(w.tag || '')}</span>
        </div>
        <div class="day-grid">
          ${(w.days || []).map(d => {
            const isToday = d.day === t.dayNo;
            const isPast = d.day < t.dayNo;
            const isReview = d.review;
            const slugs = d.slugs || [];
            return `
              <div class="day-cell ${isToday ? 'today' : ''} ${isPast ? 'past' : ''} ${isReview ? 'review' : ''}">
                <div class="dn"><span>D${d.day}</span><span class="dt">${dayToDate(d.day)}</span></div>
                ${isReview
                  ? `<div class="rv">复盘</div>`
                  : slugs.map(s => `<div class="sl"><a data-plan-slug="${escAttr(s)}">${esc(s)}</a></div>`).join('')}
                ${d.note ? `<div class="rv" style="font-size:9px;margin-top:3px">${esc(d.note)}</div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`).join('')}
  `;

  $$('[data-plan-slug]', main).forEach(a => a.addEventListener('click', () => {
    go('#/problem/' + a.dataset.planSlug);
  }));
}

/* ============================ 提醒 ============================ */

async function viewNotify(main) {
  const n = await api('/notify');
  const items = n.items || [];

  main.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">提醒 · ${n.enabled ? '已开启' : '已关闭'}</div>
      <h1>每天的推送</h1>
      <p class="sub">
        到点后服务自动生成一条提醒，写清今天该做哪几道题。打开页面就能看到，不需要任何外部推送服务。
      </p>
    </div>

    <div class="row" style="margin-bottom:var(--s5);align-items:flex-end">
      <div class="fixed">
        <label class="mono-sm">每日提醒时间</label>
        <input id="rt-time" class="inp" style="width:110px" value="${escAttr(n.time || '08:00')}" placeholder="08:00">
      </div>
      <div class="fixed">
        <label class="mono-sm">状态</label>
        <select id="rt-enabled" class="inp" style="width:120px">
          <option value="true"  ${n.enabled ? 'selected' : ''}>开启</option>
          <option value="false" ${!n.enabled ? 'selected' : ''}>关闭</option>
        </select>
      </div>
      <div class="fixed"><button class="btn" id="rt-save">保存设置</button></div>
      <div class="fixed"><button class="btn ghost" id="rt-test">立即试一下</button></div>
      ${n.unread ? `<div class="fixed"><button class="btn ghost" id="rt-readall">全部标记已读（${n.unread}）</button></div>` : ''}
    </div>

    <h2 class="sec">提醒记录 <span class="cnt">${items.length}</span></h2>
    <div class="task-list">
      ${items.map(it => `
        <div class="task ${it.read ? '' : 'unread'}" style="cursor:default">
          <div class="task-idx" style="font-size:var(--t-sm)">${it.read ? '·' : '●'}</div>
          <div class="task-body">
            <div class="task-title">${esc(it.title || '')}</div>
            <div class="task-meta">
              <span>${esc(String(it.date || ''))}</span>
              <span class="mono-sm">${esc(String(it.createdAt || '').slice(11, 16))}</span>
            </div>
            <div class="pseudo-sm" style="white-space:pre-wrap;margin-top:8px">${esc(it.body || '')}</div>
          </div>
          <div class="task-right">
            ${it.slug ? `<button class="btn ghost sm" data-n-go="${escAttr(it.slug)}">去做题</button>` : ''}
            ${it.read ? '' : `<button class="btn ghost sm" data-n-read="${it.id}">标已读</button>`}
          </div>
        </div>`).join('') || '<div class="empty">还没有提醒。点上面的「立即试一下」，或者等到设定时间。</div>'}
    </div>
  `;

  $('#rt-save')?.addEventListener('click', async () => {
    const time = $('#rt-time').value.trim() || '08:00';
    const enabled = $('#rt-enabled').value === 'true';
    try {
      await api('/notify/setting', { method: 'POST', body: { time, enabled: String(enabled) } });
      toast('已保存 · ' + time + (enabled ? ' 提醒开启' : ' 提醒关闭'));
      await render();
    } catch (e) { toast('保存失败：' + e.message); }
  });

  $('#rt-test')?.addEventListener('click', async () => {
    try {
      await api('/notify/push', { method: 'POST' });
      toast('已生成今日提醒');
      await refreshNotifyBadge();
      await render();
    } catch (e) { toast('生成失败：' + e.message); }
  });

  $('#rt-readall')?.addEventListener('click', async () => {
    try {
      await api('/notify/read-all', { method: 'POST' });
      await refreshNotifyBadge();
      await render();
    } catch (e) { toast('操作失败：' + e.message); }
  });

  $$('[data-n-read]', main).forEach(b => b.addEventListener('click', async () => {
    // data-n-read 对应的 JS 属性是 dataset.nRead（连字符后的字母必须大写）。
    // 写成 dataset.nread 会得到 undefined，拼出 /notify/undefined/read，后端转 long 失败直接 400。
    const id = b.dataset.nRead;
    if (!id || id === 'undefined') { toast('这条提醒的编号丢了，刷新一下页面', true); return; }
    try {
      await api('/notify/' + encodeURIComponent(id) + '/read', { method: 'POST' });
      await refreshNotifyBadge();
      await render();
    } catch (e) { toast('操作失败：' + e.message); }
  }));

  $$('[data-n-go]', main).forEach(b => b.addEventListener('click', () => {
    go('#/problem/' + b.dataset.nGo);
  }));
}

/* ============================ AI 资讯（AIHOT） ============================ */

/** 相对时间：放「3 小时前」比放 ISO 时间戳有用得多 */
function agoText(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const d = Math.floor((Date.now() - t) / 1000);
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
  if (d < 86400 * 30) return Math.floor(d / 86400) + ' 天前';
  return new Date(t).toLocaleDateString('zh-CN');
}

/** 数据从哪来、新不新鲜，摊开写在页面上，不藏 */
function aihotMetaLine(meta) {
  if (!meta) return '';
  const bits = [];
  bits.push(meta.fromCache ? '缓存' : '刚拉的');
  if (meta.fetchedAt) bits.push(meta.fetchedAt);
  if (meta.note) bits.push(meta.note);
  return `<div class="aihot-meta">${bits.map(esc).join(' · ')}</div>`;
}

function aihotItemHtml(it) {
  const cat = it.category ? `<span class="ah-cat">${esc(it.category)}</span>` : '';
  const src = it.source && it.source.name ? `<span class="ah-src">${esc(it.source.name)}</span>` : '';
  const when = it.publishedAt ? `<span class="ah-when">${agoText(it.publishedAt)}</span>` : '';
  const reason = it.reason
    ? `<div class="ah-reason"><b>为什么推给你</b>${esc(it.reason)}</div>` : '';
  const orig = it.links && it.links.original
    ? `<a class="ah-link" href="${escAttr(it.links.original)}" target="_blank" rel="noopener">原文</a>` : '';
  const onAihot = it.links && it.links.aihot
    ? `<a class="ah-link" href="${escAttr(it.links.aihot)}" target="_blank" rel="noopener">AIHOT 讨论</a>` : '';
  return `<article class="ah-item">
    <h3 class="ah-title">${esc(it.title || '')}</h3>
    <div class="ah-meta">${cat}${src}${when}</div>
    ${it.summary ? `<p class="ah-sum">${esc(it.summary)}</p>` : ''}
    ${reason}
    <div class="ah-links">${orig}${onAihot}</div>
  </article>`;
}

async function viewAihot(main) {
  main.innerHTML = `<div class="empty">正在取 AIHOT 的资讯…</div>`;

  const [hot, items, daily] = await Promise.all([
    api('/aihot/hot').catch(e => ({ error: e.message })),
    api('/aihot/items?mode=selected&limit=20').catch(e => ({ error: e.message })),
    api('/aihot/daily').catch(e => ({ error: e.message }))
  ]);

  const err = hot.error || items.error || daily.error;
  if (err && !(items.items || []).length) {
    main.innerHTML = `<div class="empty">取 AIHOT 失败：${esc(err)}</div>`;
    return;
  }

  const hotHtml = (hot.items || []).map(h => `
    <li class="ah-hot">
      <span class="ah-rank">${h.rank}</span>
      <div class="ah-hot-body">
        <a class="ah-hot-title" href="${escAttr((h.links && (h.links.original || h.links.aihot)) || '#')}"
           target="_blank" rel="noopener">${esc(h.title || '')}</a>
        <div class="ah-meta">
          <span class="ah-src">${esc((h.source && h.source.name) || '')}</span>
          ${h.sourceCount > 1 ? `<span class="ah-when">${h.sourceCount} 家跟进</span>` : ''}
          ${h.latestAt ? `<span class="ah-when">${agoText(h.latestAt)}</span>` : ''}
        </div>
      </div>
    </li>`).join('');

  const rep = daily.report;
  const dailyHtml = rep ? `
    <div class="ah-daily">
      <div class="ah-daily-head">
        <span class="ah-daily-date">${esc(rep.date || '')}</span>
        <span class="ah-daily-lead">${esc((rep.lead && rep.lead.title) || '今日日报')}</span>
      </div>
      ${rep.lead && rep.lead.leadParagraph
        ? `<p class="ah-daily-p">${esc(rep.lead.leadParagraph)}</p>` : ''}
      ${(rep.sections || []).slice(0, 3).map(s => `
        <div class="ah-daily-sec">
          <div class="ah-sec-label">${esc(s.label || '')}</div>
          ${(s.items || []).slice(0, 3).map(x => `
            <div class="ah-daily-item">
              <a href="${escAttr((x.links && (x.links.original || x.links.aihot)) || '#')}"
                 target="_blank" rel="noopener">${esc(x.title || '')}</a>
            </div>`).join('')}
        </div>`).join('')}
    </div>` : '';

  const listHtml = (items.items || []).map(aihotItemHtml).join('');

  main.innerHTML = `
    <div class="view-head">
      <div class="eyebrow">AI 资讯 · 来自 AIHOT · 个人自用</div>
      <h1 class="view-title">AI 圈今天在聊什么</h1>
    </div>

    ${aihotMetaLine(items.meta)}

    ${hotHtml ? `<h2 class="sec">此刻最热 <span class="cnt">Top ${(hot.items || []).length}</span></h2>
      <ol class="ah-hotlist">${hotHtml}</ol>` : ''}

    ${dailyHtml ? `<h2 class="sec">最新日报</h2>${dailyHtml}` : ''}

    <h2 class="sec">编辑精选 <span class="cnt">最近 7 天</span></h2>
    <div class="ah-list">${listHtml || '<div class="empty">这 7 天没有精选内容</div>'}</div>

    <div class="ah-foot">
      数据来源 <a href="https://aihot.news" target="_blank" rel="noopener">AIHOT</a>（aihot.news）。
      匿名只读接口，个人非商业使用；内容版权归原作者与 AIHOT。
      本地缓存 60 秒，避免重复打上游。
    </div>`;
}

/* ============================ 力扣账号 ============================ */

async function viewAccount(main) {
  const acc = await api('/account');
  State.account = acc;
  const solved = acc.bound ? await api('/account/solved') : [];

  main.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">力扣账号 · ${acc.bound ? '已绑定' : '未绑定'}</div>
      <h1>${acc.bound ? '@' + esc(acc.username || '') : '绑定你的力扣'}</h1>
      <p class="sub">
        绑定后可以同步你的历史通过记录，已经在力扣做过的题会自动标记完成，不用重复打卡。
      </p>
    </div>

    ${acc.bound ? `
      <div class="stat-strip">
        <div class="stat-cell"><div class="stat-v">${acc.solvedCount || 0}</div><div class="stat-k">同步到的通过题数</div></div>
        <div class="stat-cell"><div class="stat-v" style="font-size:15px">${esc(acc.lastSync ? String(acc.lastSync).slice(0, 16).replace('T', ' ') : '从未')}</div><div class="stat-k">上次同步</div></div>
      </div>
      <div class="row" style="margin-bottom:var(--s5)">
        <div class="fixed"><button class="btn" id="btn-sync">同步通过记录</button></div>
        <div class="fixed"><button class="btn ghost" id="btn-unbind">解绑</button></div>
      </div>
      <h2 class="sec">已通过的题 <span class="cnt">${solved.length}</span></h2>
      <div class="task-list">
        ${solved.slice(0, 200).map(s => `
          <div class="task" style="cursor:default">
            <div class="task-idx" style="font-size:var(--t-sm)">${esc(s.slug ? '' : '')}</div>
            <div class="task-body">
              <div class="task-title">${esc(s.title || s.slug)}</div>
              <div class="task-meta">
                ${diffHtml(s.difficulty)}
                <span>${esc(s.slug || '')}</span>
              </div>
            </div>
            <div class="task-right"><span class="chip done">AC</span></div>
          </div>`).join('') || '<div class="empty">还没有同步记录</div>'}
      </div>
    ` : `
      <div class="notice">
        <b>怎么拿 Cookie：</b>浏览器登录 leetcode.cn → F12 → Network → 随便点一个请求 →
        Request Headers 里的 <span class="mono">Cookie</span> 整行复制。
        必须包含 <span class="mono">LEETCODE_SESSION</span> 和 <span class="mono">csrftoken</span>。
        <br><br>
        <b>Cookie 只存在你本机的 H2 数据库里，不上传任何服务器。</b>
      </div>
      <label class="field"><span>粘贴 Cookie</span>
        <textarea id="cookie-input" style="min-height:110px;font-family:var(--f-mono);font-size:12px"
          placeholder="LEETCODE_SESSION=xxx; csrftoken=yyy; ..."></textarea>
      </label>
      <button class="btn" id="btn-bind">验证并绑定</button>
    `}
  `;

  if (acc.bound) {
    $('#btn-sync').addEventListener('click', async () => {
      const b = $('#btn-sync');
      b.disabled = true; b.textContent = '同步中…';
      try {
        const r = await api('/account/sync', { method: 'POST' });
        toast(`同步完成，${r.count} 道通过`);
        await refreshToday();
        viewAccount($('#main'));
      } catch (e) {
        toast(e.message, true);
        b.disabled = false; b.textContent = '同步通过记录';
      }
    });
    $('#btn-unbind').addEventListener('click', async () => {
      if (!confirm('解绑后本地保存的 Cookie 会被删除，确定？')) return;
      try { await api('/account/unbind', { method: 'POST' }); toast('已解绑'); viewAccount($('#main')); }
      catch (e) { toast(e.message, true); }
    });
  } else {
    $('#btn-bind').addEventListener('click', async () => {
      const cookie = $('#cookie-input').value.trim();
      if (!cookie) { toast('先粘贴 Cookie', true); return; }
      const b = $('#btn-bind');
      b.disabled = true; b.textContent = '验证中…';
      try {
        const r = await api('/account/bind', { method: 'POST', body: { cookie } });
        toast('绑定成功：' + r.username);
        viewAccount($('#main'));
      } catch (e) {
        toast(e.message, true);
        b.disabled = false; b.textContent = '验证并绑定';
      }
    });
  }
}

/* ---------------------------- 启动 ---------------------------- */

/* 侧栏导航：把 6 个 .nav-item 的点击接到 hash 路由上。
   之前这里缺失，导致 sidebar 点击完全没反应（只能手改地址栏）。 */
function bindNav() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (!v) return;
      // hash 相同不会触发 hashchange，此时手动重渲染（否则点了像没反应）
      if (location.hash === '#/' + v) render();
      else go('#/' + v);
    });
  });
}

window.addEventListener('hashchange', render);

(async function boot() {
  // 版本戳先写，哪怕后面接口挂了也能看出加载的是哪一版前端
  const stampEl = $('#build-stamp');
  if (stampEl) stampEl.textContent = BUILD_STAMP;
  bindNav();
  try { await refreshToday(); } catch { /* 忽略，render 里会再报 */ }
  await render();
})();
