// 吉祥物渲染＋動畫＋待機歪頭，搬自一代 `拼字遊戲/app.js`「DOM helpers」段落裡
// 跟 mascot 相關的函式群（`setMascotCharacter`/`pickRandomMascot`/
// `mascotReact`/`mascotReactCorrect`/`showMascotBubble`/`mascotIdleTilt`/
// `scheduleMascotIdleTilt`）。
//
// Phase 1 只搬「中性表情」行為——一代 `pickRandomMascot()` 本來就是在 45 張
// 表情圖裡隨機挑一張顯示，跟遊戲事件無關。
//
// 這裡（D 段「新玩法」）新增 `pickMascotExpression(pool)`：角色仍隨機輪替，
// 但表情改成依事件（答對/答錯/提示/待機/過關）從對應的表情子集裡隨機挑，
// 而不是全部 9 種都可能挑到。新增的事件感知 export 見下方
// `mascotReactCorrectEmotion`/`mascotReactWrong`/`mascotReactHint`/
// `mascotReactCheer`；既有 export 的簽名與既有呼叫點行為不變。
//
// 圖檔路徑用 `import.meta.env.BASE_URL` 前綴組出 `<BASE_URL>mascot-images/<id>.png`
// （Vite `public/` 目錄的慣例，跟 audio 模組的處理方式一致，支援子路徑部署）。

const MASCOT_EXPRESSIONS = [
  'neutral', 'worried', 'pouting', 'angry', 'shocked',
  'blushing', 'laughing', 'thinking', 'winking',
];

const MASCOT_CONFIGS = [
  { prefix: 'conan', name: '柯南' },
  { prefix: 'haibara', name: '灰原哀' },
  { prefix: 'ran', name: '小蘭' },
  { prefix: 'amuro', name: '零' },
  { prefix: 'gillian', name: '吉莉安' },
];

// 每個角色群組（同一角色的 9 種表情），pickRandomMascot 先挑群組（=挑角色）
// 再從群組內排除目前表情挑一張，維持跟一代相同的「換角色又換表情」隨機感。
const MASCOT_GROUPS = MASCOT_CONFIGS.map((cfg) =>
  MASCOT_EXPRESSIONS.map((expr) => ({ id: `${cfg.prefix}_${expr}`, name: cfg.name }))
);

const MASCOT_CHARACTERS = [].concat(...MASCOT_GROUPS);

// 部署到子路徑（例如 GitHub Pages 的 /repo-name/）時，寫死開頭的 '/' 會
// 404——用 Vite 的部署路徑前綴組出正確的絕對路徑（見 src/audio/index.js
// 同樣的處理方式）。
const BASE_URL = import.meta.env.BASE_URL;

let currentMascotId = null;
let mascotBubbleTimer = null;
let idleMessages = [];
let idleScheduled = false;
let animationEndBound = false;

function $(id) {
  return document.getElementById(id);
}

/**
 * 吉祥物待機時的鼓勵語庫（來自 messages.json 的 `mascotIdle`），資料是非同步
 * 載入的，由呼叫端（game-flow.js）拿到資料後呼叫這個 setter 填進來。
 * @param {string[]} list
 * @returns {void}
 */
export function setMascotIdleMessages(list) {
  idleMessages = Array.isArray(list) ? list : [];
}

/** @param {string} id @returns {void} */
export function setMascotCharacter(id) {
  const character = MASCOT_CHARACTERS.find((c) => c.id === id) || MASCOT_CHARACTERS[0];
  currentMascotId = character.id;
  const mascot = $('mascot');
  if (!mascot) return;
  mascot.innerHTML = `<img src="${BASE_URL}mascot-images/${character.id}.png" alt="${character.name}">`;
  mascot.setAttribute('aria-label', character.name);
}

/** 先隨機挑一個角色群組，再從該角色的表情裡排除目前表情隨機挑一張。 @returns {void} */
export function pickRandomMascot() {
  const group = MASCOT_GROUPS[Math.floor(Math.random() * MASCOT_GROUPS.length)];
  let pool = group.filter((c) => c.id !== currentMascotId);
  if (!pool.length) pool = group;
  setMascotCharacter(pool[Math.floor(Math.random() * pool.length)].id);
}

/**
 * 依事件挑表情：先隨機挑一位角色（排除目前角色，維持跟 pickRandomMascot 一樣
 * 「換角色」的輪替手感），再從呼叫端傳入的表情子集 `pool` 裡隨機挑一種，組成
 * `${prefix}_${expression}` 這個 id 顯示。是 pickRandomMascot 的「限縮表情池」
 * 版本，給答對/答錯/提示/待機等有明確情境的呼叫點使用。
 * @param {string[]} pool 表情子集（MASCOT_EXPRESSIONS 的子集，至少 1 個）
 * @returns {void}
 */
function pickMascotExpression(pool) {
  const currentPrefix = currentMascotId ? currentMascotId.split('_')[0] : null;
  let configs = MASCOT_CONFIGS.filter((cfg) => cfg.prefix !== currentPrefix);
  if (!configs.length) configs = MASCOT_CONFIGS;
  const cfg = configs[Math.floor(Math.random() * configs.length)];
  const expression = pool[Math.floor(Math.random() * pool.length)];
  setMascotCharacter(`${cfg.prefix}_${expression}`);
}

/**
 * 通用反應動畫（例如過關時的 'cheer'）。
 * @param {string} kind
 * @returns {void}
 */
export function mascotReact(kind) {
  const mascot = $('mascot');
  if (!mascot) return;
  // 待機動畫的 tilt-left/tilt-right/pulse 也要一併清掉：待機動畫背景每 6~12
  // 秒觸發一次，若反應動畫剛好疊到（class 特異度相同、後宣告者蓋過先宣告者），
  // 反應動畫會被待機動畫吃掉。
  mascot.classList.remove('celebrate-correct', 'cheer', 'tilt-left', 'tilt-right', 'pulse');
  const mascotWrap = $('mascot-wrap');
  if (mascotWrap) mascotWrap.classList.remove('celebrating');
  void mascot.offsetWidth;
  if (kind) mascot.classList.add(kind);
}

/**
 * 答對時的特寫反應：吉祥物移到畫面正中央、放大特寫＋換一位新角色。
 * @returns {void}
 */
export function mascotReactCorrect() {
  const mascot = $('mascot');
  const mascotWrap = $('mascot-wrap');
  if (!mascot) return;
  pickRandomMascot();
  clearTimeout(mascotBubbleTimer);
  const bubble = $('mascot-bubble');
  if (bubble) bubble.hidden = true;
  mascot.classList.remove('tilt-left', 'tilt-right', 'pulse', 'celebrate-correct');
  if (mascotWrap) mascotWrap.classList.add('celebrating');
  void mascot.offsetWidth;
  const scale = 3 + Math.random() * 2;
  mascot.style.setProperty('--celebrate-scale', scale.toFixed(2));
  mascot.classList.add('celebrate-correct');
}

/**
 * 答對時的特寫反應（事件感知版）：跟 mascotReactCorrect 完全相同的移到正中央
 * ／隨機縮放 3~5 倍／celebrate-correct 動畫邏輯，差別只在换角色那一步改成從
 * 「開心/得意」表情子集（laughing/winking/blushing）裡挑，而不是全部 9 種都
 * 可能挑到（例如 worried/angry 這種不該在答對時出現的表情）。
 * @returns {void}
 */
export function mascotReactCorrectEmotion() {
  const mascot = $('mascot');
  const mascotWrap = $('mascot-wrap');
  if (!mascot) return;
  pickMascotExpression(['laughing', 'winking', 'blushing']);
  clearTimeout(mascotBubbleTimer);
  const bubble = $('mascot-bubble');
  if (bubble) bubble.hidden = true;
  mascot.classList.remove('tilt-left', 'tilt-right', 'pulse', 'celebrate-correct');
  if (mascotWrap) mascotWrap.classList.add('celebrating');
  void mascot.offsetWidth;
  const scale = 3 + Math.random() * 2;
  mascot.style.setProperty('--celebrate-scale', scale.toFixed(2));
  mascot.classList.add('celebrate-correct');
}

/**
 * 答錯時的溫和反應：換成「有點沮喪但不到生氣」的表情（worried/pouting，刻意
 * 不含 angry——是鼓勵孩子而非責備），animation 不新增 CSS class，直接複用既有
 * 的 tilt-left/tilt-right 待機歪頭效果表達小小的挫折感。
 * @returns {void}
 */
export function mascotReactWrong() {
  pickMascotExpression(['worried', 'pouting']);
  // 直接複用 mascotReact：它會一併清掉 celebrate-correct/cheer/tilt/pulse
  // 並把 wrapper 的 celebrating 收回，避免上一題答對的特寫還沒播完就被這裡
  // 硬切斷 class，導致 celebrateCorrect 的 animationend 永遠不會觸發、
  // wrapper 卡在高 z-index 出不來。
  mascotReact(Math.random() < 0.5 ? 'tilt-left' : 'tilt-right');
}

/**
 * 按下提示按鈕時的反應：固定顯示 thinking 表情（情境明確，不需要隨機挑），
 * 角色本身仍照 pickMascotExpression 的規則輪替，只是表情池只有一種可能。
 * 不換動畫 class，只換角色＋表情圖，暗示「讓我幫你想一下」。
 * @returns {void}
 */
export function mascotReactHint() {
  pickMascotExpression(['thinking']);
}

/**
 * 過關結果畫面的反應（事件感知版）：換成「開心/得意」表情子集
 * （laughing/winking）後，套用跟既有 mascotReact('cheer') 完全相同的
 * cheer 動畫處理邏輯（直接複用 mascotReact，避免重複清 class／reflow 的程式碼）。
 * @returns {void}
 */
export function mascotReactCheer() {
  pickMascotExpression(['laughing', 'winking']);
  mascotReact('cheer');
}

/** @param {string} text @returns {void} */
export function showMascotBubble(text) {
  const bubble = $('mascot-bubble');
  if (!bubble) return;
  bubble.textContent = text;
  bubble.hidden = false;
  clearTimeout(mascotBubbleTimer);
  mascotBubbleTimer = setTimeout(() => {
    bubble.hidden = true;
  }, 2600);
}

/**
 * 待機時的隨機歪頭（或偶爾放大一下）+ 鼓勵泡泡。表情改成從中性子集
 * （neutral/thinking）挑，避免孩子沒做任何事時，待機動畫突然跳出
 * shocked/angry 這種太戲劇化的表情。
 * @returns {void}
 */
export function mascotIdleTilt() {
  const mascot = $('mascot');
  if (!mascot) return;
  // 正在播答對/過關動畫時跳過，避免動畫互相打架
  if (mascot.classList.contains('celebrate-correct') || mascot.classList.contains('cheer')) return;
  pickMascotExpression(['neutral', 'thinking']);
  mascot.classList.remove('tilt-left', 'tilt-right', 'pulse');
  void mascot.offsetWidth;
  const roll = Math.random();
  if (roll < 0.2) {
    mascot.classList.add('pulse');
  } else {
    mascot.classList.add(roll < 0.6 ? 'tilt-left' : 'tilt-right');
  }
  if (idleMessages.length) {
    showMascotBubble(idleMessages[Math.floor(Math.random() * idleMessages.length)]);
  }
}

/** 用遞迴 setTimeout（而非 setInterval）做出每次間隔都不同的「隨機」待機節奏。 @returns {void} */
export function scheduleMascotIdleTilt() {
  const delay = 6000 + Math.random() * 6000;
  setTimeout(() => {
    mascotIdleTilt();
    scheduleMascotIdleTilt();
  }, delay);
}

function bindMascotAnimationEnd() {
  if (animationEndBound) return;
  const mascot = $('mascot');
  if (!mascot) return;
  animationEndBound = true;
  // 動畫結束後移回待機狀態，避免 mascot 卡在 celebrate-correct/cheer/tilt
  // 姿勢不再回到待機；celebrate-correct 結束時另外要把 wrapper 借來的高
  // z-index 收回，不然吉祥物待機時也會一直蓋在最上層。
  mascot.addEventListener('animationend', (e) => {
    if (e.animationName === 'celebrateCorrect') {
      e.target.classList.remove('celebrate-correct');
      const mascotWrap = $('mascot-wrap');
      if (mascotWrap) mascotWrap.classList.remove('celebrating');
    } else if (e.animationName === 'cheer') {
      e.target.classList.remove('cheer');
    } else if (e.animationName === 'tiltLeft' || e.animationName === 'tiltRight' || e.animationName === 'idlePulse') {
      e.target.classList.remove('tilt-left', 'tilt-right', 'pulse');
    }
  });
}

/**
 * 一次性初始化：綁定 animationend、挑一位起始角色、啟動待機歪頭排程。
 * 呼叫一次即可（內部有重入防護），由 game-flow.js 在資料載入完成後呼叫一次。
 * @returns {void}
 */
export function initMascot() {
  bindMascotAnimationEnd();
  pickRandomMascot();
  if (!idleScheduled) {
    idleScheduled = true;
    scheduleMascotIdleTilt();
  }
}
