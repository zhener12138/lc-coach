/* ============================================================
   解法上锁 —— 三种解法默认各自锁住，逐个点击解锁
   状态存 sessionStorage：同一标签页内解锁过的题再进来仍是解锁的；
   关掉标签页就重置，保持「每次都是真练」的体感。
   ============================================================ */

(function () {
  const KEY = 'lc.sol.unlocked';

  function readAll() {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function writeAll(map) {
    try { sessionStorage.setItem(KEY, JSON.stringify(map)); } catch (e) { /* 隐私模式忽略 */ }
  }

  function isUnlocked(slug, idx) {
    const map = readAll();
    const arr = map[slug];
    return Array.isArray(arr) && arr.indexOf(idx) >= 0;
  }

  function unlock(slug, idx) {
    const map = readAll();
    const arr = Array.isArray(map[slug]) ? map[slug] : [];
    if (arr.indexOf(idx) < 0) arr.push(idx);
    map[slug] = arr;
    writeAll(map);
  }

  function lockOne(slug, idx) {
    const map = readAll();
    const arr = Array.isArray(map[slug]) ? map[slug] : [];
    const at = arr.indexOf(idx);
    if (at >= 0) arr.splice(at, 1);
    if (arr.length) map[slug] = arr; else delete map[slug];
    writeAll(map);
  }

  function lockAll(slug) {
    const map = readAll();
    delete map[slug];
    writeAll(map);
  }

  window.Lock = { isUnlocked: isUnlocked, unlock: unlock, lockOne: lockOne, lockAll: lockAll };
})();

/* 锁屏占位卡：点一下解锁这一块 */
function lockCard(slug, idx) {
  const safe = String(slug || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return '<div class="lock-card" data-lock="' + safe + '" data-idx="' + idx + '" role="button" tabindex="0">' +
    '<div class="lock-ico">&#128274;</div>' +
    '<div class="lock-title">解法 ' + (idx + 1) + ' 已锁住</div>' +
    '<div class="lock-hint">先自己在纸上把伪代码写一遍，卡死了再点开对照。<br>直接看答案，等于把这道题提前浪费掉。</div>' +
    '<div class="lock-cta">点此解锁</div>' +
  '</div>';
}
