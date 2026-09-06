// 吉祥物渲染＋動畫＋待機歪頭，搬自一代 `拼字遊戲/app.js`「DOM helpers」段落裡
// 跟 mascot 相關的函式群（`setMascotCharacter`/`pickRandomMascot`/
// `mascotReact`/`mascotReactCorrect`/`showMascotBubble`/`mascotIdleTilt`/
// `scheduleMascotIdleTilt`）。
//
// Phase 1 只搬「中性表情」行為——一代 `pickRandomMascot()` 本來就是在 45 張
// 表情圖裡隨機挑一張顯示（跟遊戲事件無關的純隨機待機切換），不是「答對挑開心
// 表情、答錯挑難過表情」那種情緒對應邏輯（那是 Phase 3「表情包接情緒」的範圍）。
// 這裡原封不動搬過來，不新增任何跟 emoji 表情有關的判斷。
//
// 圖檔路徑改成 `/mascot-images/<id>.png`（Vite `public/` 目錄的絕對路徑慣例，
// 跟 audio 模組的 `/words-audio/...`、`/phonics-audio/...` 一致）。

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
  mascot.innerHTML = `<img src="/mascot-images/${character.id}.png" alt="${character.name}">`;
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

/** 待機時的隨機歪頭（或偶爾放大一下）+ 鼓勵泡泡。 @returns {void} */
export function mascotIdleTilt() {
  const mascot = $('mascot');
  if (!mascot) return;
  // 正在播答對/過關動畫時跳過，避免動畫互相打架
  if (mascot.classList.contains('celebrate-correct') || mascot.classList.contains('cheer')) return;
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
