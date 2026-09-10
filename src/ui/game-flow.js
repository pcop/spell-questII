// 主選單 → 選主題 → 選難度 → 遊戲畫面 → 結果畫面，對應一代 `拼字遊戲/app.js`
// 「Theme / level / progress rendering」段落的主題/關卡渲染部分 + 「Game
// flow」段落的 DOM 渲染部分 + 「Event bindings」裡跟拼字關卡相關的綁定。
//
// 只搬渲染/事件綁定，判分邏輯呼叫 `src/game/index.js`（已完整實作）、發音/
// 音效呼叫 `src/audio/index.js`（已完整實作）、過關特效呼叫 `src/three-fx`
// （Phase 2 才會補邏輯，目前呼叫了也只是安全的 no-op / 會 reject 的 Promise，
// 不會炸掉這裡的流程）。
//
// 跟 `getCurrentQuestionView()` 契約的搭配方式：這裡完全不維護自己的一份
// 「目前槽位/字母方塊使用狀態」鏡像——每次呼叫 place/remove/hint/
// resetForRetry 之後，一律重新呼叫 `getCurrentQuestionView(session)` 拿最新
// 的 `slots`（含 tileId/letter/hinted）跟 `tiles`（含 used）直接重繪，簡單
// 可靠，不會有本地鏡像跟 session 內部真實狀態兜不起來的風險。
//
// 已知的兩個小契約落差（跟 game 模組的新增 export 無關，這裡自行用 UI 層
// 局部狀態補上，不影響任何既有簽名）：
//   1. `getCurrentQuestionView()` 沒有回傳「目前答對幾題」（一代的
//      `gameState.correctCount`，只拿來顯示 `#game-score`），這裡用一個
//      模組層級的 `uiScore` 計數器自己算（`startLevelAndShow` 時歸零、
//      `checkAnswer` 答對時 +1），純顯示用途，不影響星等計算（星等仍完全
//      由 `finishLevel()` 內部的 `firstTryCorrect`/`totalWrongAttempts` 決定）。
//   2. 沒有辦法拿到「下一題」的單字（`session.words` 是 opaque 欄位），所以
//      這裡只預熱「目前這題」的音檔，沒有像一代一樣額外預熱下一題——影響
//      只有下一題音檔可能慢一點點才播得出來，不影響任何功能正確性。
//
// Agent 5 負責的 `src/ui/flashcards.js`/`blend.js`/`progress-page.js` 現在都
// 已經存在且各自的頂部註解明講「呼叫端在 game-flow.js」，這裡負責接上三個
// 入口：選難度畫面的 📖 預覽按鈕／主選單的「📖 單字字卡」「🎧 拼讀練習」
// 按鈕，以及把 three.js 初始化結果同步給「我的進度」頁（`setThreeFxReady`）。
// 只呼叫它們公開的 export，沒有修改那三支檔案。

import {
  getThemes,
  getLevelDefsForTheme,
  getAllWordsForTheme,
  getWordsForLevel,
  startLevel as gameStartLevel,
  getCurrentQuestionView,
  placeLetterInSlot,
  removeLastLetter,
  checkAnswer,
  useHint,
  advanceToNextQuestion,
  finishLevel,
  resetForRetry,
} from '../game/index.js';

import {
  unlockAudio,
  initVoices,
  speakWord,
  setSoundEnabled,
  setSpeechRate,
  playCorrectSound,
  playWrongSound,
  playStarPopSound,
  playPopSound,
  playRandomCatSound,
  playCatSoundForLetter,
  playTileSound,
  setTileSoundMode,
  preloadCatAudio,
  preloadLettersAudio,
  preloadEntryAudio,
} from '../audio/index.js';

import {
  initThreeFx,
  celebrateCorrect,
  celebrateLevelComplete,
  cancelCelebration,
} from '../three-fx/index.js';

import { loadProgress, saveProgress } from '../progress/store.js';
import { levelKey as progressLevelKey } from '../progress/schema.js';
import { loadGameData } from '../data/loadGameData.js';

import { showView } from './index.js';
import * as mascot from './mascot.js';
// Agent 5 的檔案（字卡瀏覽／拼讀練習／我的進度頁），目前都已存在且各自的
// 頂部註解明講「呼叫端在 game-flow.js」，這裡只是呼叫它們公開的 export，
// 沒有修改這三支檔案。
import { openFlashcards } from './flashcards.js';
import { openBlendGame } from './blend.js';
import { setThreeFxReady } from './progress-page.js';

function $(id) {
  return document.getElementById(id);
}

function pickRandom(arr) {
  return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : '';
}

// ---------- 模組狀態 ----------
let messages = { praise: [], encourage: [], result: {}, mascotIdle: [] };
let currentThemeId = null;
let currentLevelKey = null;
let session = null;
let uiScore = 0;
let pendingRetryTimeoutId = null;

function getSettings() {
  return loadProgress().settings;
}

// ---------- 開場初始化（資料載入 + 語音初始化 + three-fx 硬性門檻） ----------

/**
 * 對應一代 `loadGameData()`：載入資料、初始化語音清單/吉祥物、把使用者存檔
 * 的 settings 同步進 audio 模組，最後嘗試初始化 three.js（拼字關卡的硬性
 * 門檻——沒有 3D 特效可用就鎖住「開始遊戲」按鈕）。main.js 整合階段應該在
 * `bindStaticEvents()` 之後呼叫這個函式一次啟動整個 app。
 * @returns {Promise<void>}
 */
export async function initGameFlow() {
  showView('loading');
  try {
    const data = await loadGameData();
    messages = data.messages;
    const settings = getSettings();
    setSoundEnabled(settings.soundEnabled);
    setSpeechRate(settings.speechRate);
    setTileSoundMode(settings.tileSound || 'phonics');
    initVoices();
    preloadCatAudio();
    preloadLettersAudio();
    mascot.setMascotIdleMessages(messages.mascotIdle);
    mascot.initMascot();
    showView('splash');
    setupThreeFx();
  } catch (err) {
    console.error('資料載入失敗', err);
    showView('load-error');
  }
}

async function setupThreeFx() {
  setStartButtonState('pending');
  let ok = false;
  try {
    const container = $('three-fx-layer');
    ok = await initThreeFx(container);
  } catch (err) {
    ok = false;
  }
  setStartButtonState(ok ? 'ready' : 'unavailable');
  // 讓「我的進度」頁的診斷按鈕（progress-page.js）知道結果，避免它自己再呼叫
  // 一次 initThreeFx() 疊出第二個 three.js 場景/canvas。
  setThreeFxReady(ok);
}

// three.js 是拼字關卡的硬性需求（不做 2D 備援，見 規劃.md 決策 3）：「開始
// 遊戲」按鈕要等 three-fx 明確回報成功或失敗才能開放。字卡瀏覽/拼讀練習/
// 進度頁不受這個門檻限制（不是這裡的範圍）。
function setStartButtonState(state) {
  const btn = $('btn-start');
  if (!btn) return;
  if (state === 'ready') {
    btn.disabled = false;
    btn.textContent = '▶️ 開始遊戲';
    btn.title = '';
  } else if (state === 'unavailable') {
    btn.disabled = true;
    btn.textContent = '▶️ 開始遊戲（此裝置不支援）';
    btn.title =
      '這台裝置或瀏覽器不支援拼字遊戲需要的 3D 效果，請換一台裝置或瀏覽器再試。字卡瀏覽與拼讀練習不受影響，仍可正常使用。';
  } else {
    btn.disabled = true;
    btn.textContent = '▶️ 準備中...';
    btn.title = '正在確認裝置支援狀況';
  }
}

/** `#btn-start` 點擊：解鎖音訊、進選主題畫面。 @returns {void} */
export function handleStartButtonClick() {
  unlockAudio();
  showThemeSelect();
}

// ---------- 選主題 / 選難度 ----------

// 選主題畫面是三種入口共用的（跟一代 themeSelectMode 等價）：
//   'quiz'    —— 從「▶️ 開始遊戲」進來，點主題卡片後進選難度畫面
//   'browse'  —— 從「📖 單字字卡」進來，點主題卡片直接開整個主題的字卡瀏覽
//   'blend'   —— 從「🎧 拼讀練習」進來，點主題卡片直接開拼讀練習
let themeSelectMode = 'quiz';

/** @param {'quiz'|'browse'|'blend'} [mode] @returns {void} */
export function showThemeSelect(mode = 'quiz') {
  themeSelectMode = mode;
  renderThemeGrid();
  showView('theme-select');
}

/** `#btn-flashcards`（主選單「📖 單字字卡」）點擊。 @returns {void} */
export function handleFlashcardsMenuClick() {
  unlockAudio();
  showThemeSelect('browse');
}

/** `#btn-blend`（主選單「🎧 拼讀練習」）點擊。 @returns {void} */
export function handleBlendMenuClick() {
  unlockAudio();
  showThemeSelect('blend');
}

function onThemeCardClick(themeId) {
  if (themeSelectMode === 'browse') {
    openFlashcards(getAllWordsForTheme(themeId), { origin: 'theme-select' });
  } else if (themeSelectMode === 'blend') {
    openBlendGame(themeId);
  } else {
    showLevelSelect(themeId);
  }
}

/** @returns {void} */
export function renderThemeGrid() {
  const grid = $('theme-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const progress = loadProgress();
  getThemes().forEach((theme) => {
    let totalStars = 0;
    let maxStars = 0;
    getLevelDefsForTheme(theme.id).forEach((def) => {
      // 錯題複習是虛擬關卡（Phase 3），不算進主題卡片顯示的星等分母，
      // 不然孩子錯得越多、主題卡片顯示的滿星門檻反而變越高。
      if (!def.playable || def.kind === 'review') return;
      maxStars += 3;
      const lp = progress.levels[progressLevelKey(theme.id, def.key)];
      totalStars += lp ? lp.bestStars : 0;
    });
    const btn = document.createElement('button');
    btn.className = 'theme-card';
    btn.style.background = theme.color;
    btn.innerHTML =
      `<span class="theme-icon">${theme.icon}</span>${theme.name}` +
      `<span class="theme-stars">⭐ ${totalStars}/${maxStars}</span>`;
    btn.addEventListener('click', () => onThemeCardClick(theme.id));
    grid.appendChild(btn);
  });
}

/** @param {string} themeId @returns {void} */
export function showLevelSelect(themeId) {
  currentThemeId = themeId;
  const theme = getThemes().find((t) => t.id === themeId);
  const title = $('level-select-title');
  if (title && theme) title.textContent = `${theme.icon} ${theme.name} - 選難度`;
  renderLevelGrid(themeId);
  renderHintModeButtons();
  showView('level-select');
}

function renderLevelGrid(themeId) {
  const grid = $('level-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const progress = loadProgress();
  getLevelDefsForTheme(themeId).forEach((def) => {
    const lp = progress.levels[progressLevelKey(themeId, def.key)];
    const stars = lp ? lp.bestStars : 0;
    const disabled = !def.playable;
    const accuracyText =
      lp && lp.attempts > 0 ? `最佳正確率 ${Math.round(lp.bestAccuracy * 100)}%` : '尚未挑戰';

    const card = document.createElement('div');
    card.className = 'level-card' + (disabled ? ' disabled' : '');

    const info = document.createElement('div');
    info.className = 'level-info';
    info.innerHTML =
      `<span>${def.label}</span>` +
      `<span class="level-stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>` +
      `<span class="level-accuracy">${accuracyText}</span>`;
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'level-actions';

    const previewBtn = document.createElement('button');
    previewBtn.className = 'btn level-preview-btn';
    previewBtn.title = '先看看這些單字';
    previewBtn.textContent = '📖';
    previewBtn.disabled = disabled;
    previewBtn.addEventListener('click', () => {
      openFlashcards(getWordsForLevel(themeId, def.key), { origin: 'level-select' });
    });
    actions.appendChild(previewBtn);

    const startBtn = document.createElement('button');
    startBtn.className = 'btn level-start-btn';
    startBtn.textContent = '開始';
    startBtn.disabled = disabled;
    startBtn.addEventListener('click', () => startLevelAndShow(themeId, def.key));
    actions.appendChild(startBtn);

    card.appendChild(actions);
    grid.appendChild(card);
  });
}

/** @returns {void} */
export function renderHintModeButtons() {
  const settings = getSettings();
  document.querySelectorAll('#hint-mode-buttons .btn-toggle').forEach((b) => {
    b.classList.toggle('active', b.dataset.hintMode === settings.hintMode);
  });
  document.querySelectorAll('#sound-toggle-buttons .btn-toggle').forEach((b) => {
    b.classList.toggle('active', (b.dataset.soundEnabled === 'true') === settings.soundEnabled);
  });
  const currentTileSound = settings.tileSound || 'phonics';
  document.querySelectorAll('#tile-sound-buttons .btn-toggle').forEach((b) => {
    b.classList.toggle('active', b.dataset.tileSound === currentTileSound);
  });
  // 語速按鈕在「選難度」跟「字卡瀏覽」畫面共用同一個設定值，兩邊按鈕都一併
  // 同步高亮狀態（跟一代行為一致），`#flashcard-speech-rate-buttons` 屬於
  // Agent 5 的 view-flashcards，但這裡只是純 DOM class 切換，不依賴那支
  // 檔案是否存在/是否已綁定事件。
  document
    .querySelectorAll('#speech-rate-buttons .btn-toggle, #flashcard-speech-rate-buttons .btn-toggle')
    .forEach((b) => {
      b.classList.toggle('active', parseFloat(b.dataset.speechRate) === settings.speechRate);
    });
}

/** `#hint-mode-buttons` 容器點擊委派。 @param {MouseEvent} e @returns {void} */
export function onHintModeButtonsClick(e) {
  const btn = e.target.closest('.btn-toggle');
  if (!btn) return;
  const progress = loadProgress();
  progress.settings.hintMode = btn.dataset.hintMode;
  saveProgress(progress);
  renderHintModeButtons();
}

/** `#sound-toggle-buttons` 容器點擊委派。 @param {MouseEvent} e @returns {void} */
export function onSoundToggleButtonsClick(e) {
  const btn = e.target.closest('.btn-toggle');
  if (!btn) return;
  const progress = loadProgress();
  progress.settings.soundEnabled = btn.dataset.soundEnabled === 'true';
  saveProgress(progress);
  setSoundEnabled(progress.settings.soundEnabled);
  renderHintModeButtons();
}

/** `#tile-sound-buttons` 容器點擊委派。 @param {MouseEvent} e @returns {void} */
export function onTileSoundButtonsClick(e) {
  const btn = e.target.closest('.btn-toggle');
  if (!btn) return;
  const progress = loadProgress();
  progress.settings.tileSound = btn.dataset.tileSound;
  saveProgress(progress);
  setTileSoundMode(progress.settings.tileSound);
  renderHintModeButtons();
  // 立即試聽示範音（字母 A），讓使用者聽出模式差異
  playTileSound('a', progress.settings.tileSound);
}

/** `#speech-rate-buttons` 容器點擊委派。 @param {MouseEvent} e @returns {void} */
export function onSpeechRateButtonsClick(e) {
  const btn = e.target.closest('.btn-toggle');
  if (!btn) return;
  const progress = loadProgress();
  progress.settings.speechRate = parseFloat(btn.dataset.speechRate);
  saveProgress(progress);
  setSpeechRate(progress.settings.speechRate);
  renderHintModeButtons();
  // 立即試聽，讓孩子聽出速度差異
  const word = session ? getCurrentQuestionView(session).entry.word : 'hello';
  speakWord(word, { rate: progress.settings.speechRate });
}

// ---------- 遊戲畫面 ----------

/**
 * @param {string} themeId
 * @param {string} levelKeyValue
 * @returns {void}
 */
export function startLevelAndShow(themeId, levelKeyValue) {
  clearTimeout(pendingRetryTimeoutId);
  pendingRetryTimeoutId = null;
  cancelResultCelebration();
  mascot.pickRandomMascot();
  currentThemeId = themeId;
  currentLevelKey = levelKeyValue;
  uiScore = 0;
  session = gameStartLevel(themeId, levelKeyValue);
  showView('game');
  loadQuestionView();
}

function loadQuestionView() {
  const view = getCurrentQuestionView(session);
  const msg = $('feedback-message');
  if (msg) {
    msg.textContent = '';
    msg.className = 'feedback-message';
  }
  $('game-progress').textContent = `第 ${view.index + 1} / ${view.total} 題`;
  $('game-score').textContent = '✅ ' + uiScore;
  $('btn-next-question').hidden = true;

  const settings = getSettings();
  preloadEntryAudio(view.entry);
  renderPrompt(view.entry, settings.hintMode);
  renderAnswerSlots(view);
  renderTiles(view);
  updateHintButtonState(view);

  if (settings.hintMode === 'audio' || settings.hintMode === 'both') {
    speakWord(view.entry.word, { rate: settings.speechRate });
  }
}

function renderPrompt(entry, hintMode) {
  const visual = $('prompt-visual');
  visual.innerHTML = '';
  const showImage = hintMode === 'image' || hintMode === 'both';
  if (showImage) {
    if (entry.emoji) {
      visual.textContent = entry.emoji;
    } else if (entry.swatch) {
      const sw = document.createElement('div');
      sw.className = 'swatch';
      sw.style.background = entry.swatch;
      visual.appendChild(sw);
    }
  } else {
    visual.innerHTML = '<span style="font-size:48px;">👂</span>';
  }
  // 中文提示跟著圖片一起顯示/隱藏：純聽音模式（hintMode 'audio'）刻意不給
  // 圖片，中文翻譯一樣算「看得出答案」的視覺提示，這個模式也不顯示。
  const zhEl = $('prompt-zh');
  if (showImage && entry.zh) {
    zhEl.textContent = entry.zh;
    zhEl.hidden = false;
  } else {
    zhEl.textContent = '';
    zhEl.hidden = true;
  }
}

// 多音節單字才有 syllableGroupSizes（例如 "lion" -> [2,2]），把「每組大小」
// 展開成「每個字母屬於第幾組」+「哪些位置是新組的開頭」，供 renderAnswerSlots
// 套用 group-a/group-b/group-start 樣式（跟一代 computeSyllableGrouping 等價）。
function expandGroupSizes(sizes) {
  if (!sizes) return null;
  const groupIndex = [];
  const breaks = new Set();
  let pos = 0;
  sizes.forEach((size, gi) => {
    if (pos > 0) breaks.add(pos);
    for (let i = 0; i < size; i++) groupIndex.push(gi);
    pos += size;
  });
  return { groupIndex, breaks };
}

/**
 * 依字母計算對應的小怪獸造型索引（0–4）。
 * @param {string} letter
 * @returns {number}
 */
export function getMonsterSkinIndex(letter) {
  if (!letter) return 0;
  const code = letter.toLowerCase().charCodeAt(0);
  return (code - 97 >= 0 ? code - 97 : 0) % 5;
}

// 5 款萌怪頭頂裝飾（微探出上緣的耳朵/小角/天線）與表情 SVG（不包含任何 <text>，純幾何圖案確保 textContent 一致）
const MONSTER_DECOR_SVGS = [
  // 0: 粉紅萌兔怪 (雙大圓眼、水汪汪高光、長圓耳朵)
  `<svg viewBox="0 0 54 38" width="54" height="38" class="monster-decor-svg">
    <ellipse cx="14" cy="11" rx="5.5" ry="9" fill="#ff7ba7" stroke="#2a1a55" stroke-width="2.5" transform="rotate(-12 14 11)" />
    <ellipse cx="14" cy="12" rx="2.5" ry="5.5" fill="#ffb3cb" transform="rotate(-12 14 11)" />
    <ellipse cx="40" cy="11" rx="5.5" ry="9" fill="#ff7ba7" stroke="#2a1a55" stroke-width="2.5" transform="rotate(12 40 11)" />
    <ellipse cx="40" cy="12" rx="2.5" ry="5.5" fill="#ffb3cb" transform="rotate(12 40 11)" />
    <circle class="monster-eye" cx="17" cy="24" r="5.2" fill="#ffffff" stroke="#2a1a55" stroke-width="1.8" />
    <circle class="monster-pupil" cx="17" cy="24" r="2.8" fill="#2a1a55" />
    <circle cx="16" cy="22.5" r="1.2" fill="#ffffff" />
    <circle cx="18" cy="25.2" r="0.6" fill="#ffffff" />
    <circle class="monster-eye" cx="37" cy="24" r="5.2" fill="#ffffff" stroke="#2a1a55" stroke-width="1.8" />
    <circle class="monster-pupil" cx="37" cy="24" r="2.8" fill="#2a1a55" />
    <circle cx="36" cy="22.5" r="1.2" fill="#ffffff" />
    <circle cx="38" cy="25.2" r="0.6" fill="#ffffff" />
    <ellipse cx="11" cy="28" rx="2.5" ry="1.4" fill="#ff2e75" opacity="0.65" />
    <ellipse cx="43" cy="28" rx="2.5" ry="1.4" fill="#ff2e75" opacity="0.65" />
  </svg>`,

  // 1: 天藍單眼天線怪 (正中大圓眼珠、頭頂燈泡天線)
  `<svg viewBox="0 0 54 38" width="54" height="38" class="monster-decor-svg">
    <path d="M 27 15 Q 25 8 27 4" stroke="#2a1a55" stroke-width="2.5" fill="none" stroke-linecap="round" />
    <circle cx="27" cy="4" r="4" fill="#fde047" stroke="#2a1a55" stroke-width="2" />
    <circle cx="26" cy="3" r="1" fill="#ffffff" />
    <circle class="monster-eye" cx="27" cy="24" r="7.5" fill="#ffffff" stroke="#2a1a55" stroke-width="2" />
    <circle class="monster-pupil" cx="27" cy="24" r="4.2" fill="#0284c7" />
    <circle cx="27" cy="24" r="2.5" fill="#2a1a55" />
    <circle cx="25.5" cy="22" r="1.6" fill="#ffffff" />
    <circle cx="28.5" cy="25.5" r="0.8" fill="#ffffff" />
    <ellipse cx="14" cy="28" rx="2.5" ry="1.4" fill="#0284c7" opacity="0.4" />
    <ellipse cx="40" cy="28" rx="2.5" ry="1.4" fill="#0284c7" opacity="0.4" />
  </svg>`,

  // 2: 草綠雙角小恐龍怪 (兩側黃色小角、活潑萌眼)
  `<svg viewBox="0 0 54 38" width="54" height="38" class="monster-decor-svg">
    <polygon points="13,15 17,5 21,15" fill="#facc15" stroke="#2a1a55" stroke-width="2" stroke-linejoin="round" />
    <polygon points="33,15 37,5 41,15" fill="#facc15" stroke="#2a1a55" stroke-width="2" stroke-linejoin="round" />
    <circle class="monster-eye" cx="18" cy="24" r="5" fill="#ffffff" stroke="#2a1a55" stroke-width="1.8" />
    <circle class="monster-pupil" cx="18" cy="24" r="2.6" fill="#047857" />
    <circle cx="18" cy="24" r="1.6" fill="#2a1a55" />
    <circle cx="17" cy="22.5" r="1.1" fill="#ffffff" />
    <circle class="monster-eye" cx="36" cy="24" r="5" fill="#ffffff" stroke="#2a1a55" stroke-width="1.8" />
    <circle class="monster-pupil" cx="36" cy="24" r="2.6" fill="#047857" />
    <circle cx="36" cy="24" r="1.6" fill="#2a1a55" />
    <circle cx="35" cy="22.5" r="1.1" fill="#ffffff" />
    <ellipse cx="11" cy="28" rx="2.5" ry="1.4" fill="#059669" opacity="0.5" />
    <ellipse cx="43" cy="28" rx="2.5" ry="1.4" fill="#059669" opacity="0.5" />
  </svg>`,

  // 3: 芒黃笑瞇瞇元氣怪 (頭頂小綠苗葉、歡樂笑瞇瞇彎眼)
  `<svg viewBox="0 0 54 38" width="54" height="38" class="monster-decor-svg">
    <path d="M 27 15 C 24 9 20 7 16 9 C 18 13 22 14 26 15 Z" fill="#4ade80" stroke="#2a1a55" stroke-width="2" />
    <path d="M 27 15 C 30 9 34 7 38 9 C 36 13 32 14 28 15 Z" fill="#22c55e" stroke="#2a1a55" stroke-width="2" />
    <path class="monster-eye" d="M 14 25 Q 18 19 22 25" stroke="#2a1a55" stroke-width="2.6" stroke-linecap="round" fill="none" />
    <path class="monster-eye" d="M 32 25 Q 36 19 40 25" stroke="#2a1a55" stroke-width="2.6" stroke-linecap="round" fill="none" />
    <ellipse cx="12" cy="28" rx="3" ry="1.6" fill="#ea580c" opacity="0.5" />
    <ellipse cx="42" cy="28" rx="3" ry="1.6" fill="#ea580c" opacity="0.5" />
  </svg>`,

  // 4: 葡萄紫小精靈怪 (兩側精靈耳、靈動大眼)
  `<svg viewBox="0 0 54 38" width="54" height="38" class="monster-decor-svg">
    <polygon points="12,16 3,7 15,11" fill="#c084fc" stroke="#2a1a55" stroke-width="2" stroke-linejoin="round" />
    <polygon points="42,16 51,7 39,11" fill="#c084fc" stroke="#2a1a55" stroke-width="2" stroke-linejoin="round" />
    <circle class="monster-eye" cx="18" cy="24" r="5" fill="#ffffff" stroke="#2a1a55" stroke-width="1.8" />
    <circle class="monster-pupil" cx="18" cy="24" r="2.8" fill="#7e22ce" />
    <circle cx="18" cy="24" r="1.6" fill="#2a1a55" />
    <circle cx="17" cy="22.5" r="1.2" fill="#ffffff" />
    <circle cx="19" cy="25" r="0.6" fill="#ffffff" />
    <circle class="monster-eye" cx="36" cy="24" r="5" fill="#ffffff" stroke="#2a1a55" stroke-width="1.8" />
    <circle class="monster-pupil" cx="36" cy="24" r="2.8" fill="#7e22ce" />
    <circle cx="36" cy="24" r="1.6" fill="#2a1a55" />
    <circle cx="35" cy="22.5" r="1.2" fill="#ffffff" />
    <circle cx="37" cy="25" r="0.6" fill="#ffffff" />
    <ellipse cx="11" cy="28" rx="2.5" ry="1.4" fill="#a855f7" opacity="0.6" />
    <ellipse cx="43" cy="28" rx="2.5" ry="1.4" fill="#a855f7" opacity="0.6" />
  </svg>`,
].map((s) => s.replace(/>\s+</g, '><').trim());

function renderAnswerSlots(view) {
  const container = $('answer-slots');
  container.innerHTML = '';
  const grouping = expandGroupSizes(view.syllableGroupSizes);
  view.slots.forEach((slot, idx) => {
    const el = document.createElement('div');
    el.className = 'answer-slot';
    if (grouping) {
      el.classList.add(grouping.groupIndex[idx] % 2 === 0 ? 'group-a' : 'group-b');
      if (grouping.breaks.has(idx)) el.classList.add('group-start');
    }
    if (slot.tileId) {
      el.textContent = slot.letter;
      el.classList.add('filled');
      const skinIndex = getMonsterSkinIndex(slot.letter);
      el.classList.add(`monster-skin-${skinIndex}`);
      if (slot.hinted) el.classList.add('hinted');
    }
    el.addEventListener('click', () => {
      // 已提示鎖定的槽位不能移除（跟一代 `removeLetterFromSlot` 對提示槽位
      // 直接 no-op 一致），不然點下去會往回清光後面所有槽位，直到撞到提示
      // 槽位被 `removeLastLetter` 擋下來才停，等於白白清掉一堆已填字母。
      if (slot.tileId && !slot.hinted) removeBackTo(idx);
    });
    container.appendChild(el);
  });
}

function renderTiles(view) {
  const container = $('tile-area');
  container.innerHTML = '';
  view.tiles.forEach((tile) => {
    const skinIndex = getMonsterSkinIndex(tile.letter);
    const btn = document.createElement('button');
    btn.className = `letter-tile monster-skin-${skinIndex}` + (tile.used ? ' used' : '');
    btn.disabled = tile.used;

    const decor = document.createElement('span');
    decor.className = 'monster-decor';
    decor.setAttribute('aria-hidden', 'true');
    decor.innerHTML = MONSTER_DECOR_SVGS[skinIndex];

    const letterSpan = document.createElement('span');
    letterSpan.className = 'tile-letter';
    letterSpan.textContent = tile.letter;

    btn.appendChild(decor);
    btn.appendChild(letterSpan);

    bindTileInteraction(btn, tile.id);
    container.appendChild(btn);
  });
}

// 主要互動：點擊字母方塊依序填入槽位；輔助互動：Pointer Events 拖曳到指定
// 槽位。兩種路徑最終都呼叫 placeLetter()，避免邏輯分裂成兩套狀態機（跟一代
// bindTileInteraction 等價，刻意不用 HTML5 Drag-and-Drop API，觸控裝置支援
// 度差）。
function bindTileInteraction(btn, tileId) {
  let startX = 0;
  let startY = 0;
  let moved = false;
  let activePointerId = null;

  btn.addEventListener('pointerdown', (e) => {
    if (btn.disabled) return;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    try {
      btn.setPointerCapture(activePointerId);
    } catch (err) {
      // 部分瀏覽器/測試環境不支援 pointer capture，忽略即可
    }
    btn.classList.add('dragging');
  });

  btn.addEventListener('pointermove', (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    if (moved) btn.style.transform = `translate(${dx}px,${dy}px)`;
  });

  btn.addEventListener('pointerup', (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    btn.classList.remove('dragging');
    btn.style.transform = '';
    if (moved) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.closest('.answer-slot')) placeLetter(tileId);
    } else {
      placeLetter(tileId);
    }
    activePointerId = null;
  });

  btn.addEventListener('pointercancel', () => {
    btn.classList.remove('dragging');
    btn.style.transform = '';
    activePointerId = null;
  });
}

function placeLetter(tileId) {
  if (!session) return;
  const tile = session.tiles.find((t) => t.tileId === tileId);
  const letter = tile ? tile.letter : '';
  const res = placeLetterInSlot(session, tileId);
  if (!res) return;
  playTileSound(letter);
  const view = getCurrentQuestionView(session);
  renderAnswerSlots(view);
  renderTiles(view);
  if (view.slots.every((s) => s.tileId !== null)) {
    runCheckAnswer();
  }
}

// 點擊一個已填的答案槽位：因為 game 模組只提供「移除最後一個已填槽位」
// (`removeLastLetter`，一代二代都是槽位固定左到右依序填入，沒有「移除任意
// 中間槽位」這個操作)，這裡改成「從最後一格往回移除到（並包含）使用者點的
// 那一格」，效果等同於連續按了好幾次退格鍵——如果中途碰到提示鎖定的槽位會
// 停下來（`removeLastLetter` 對提示槽位回傳 null），跟鍵盤 Backspace 的
// 「已提示的格子不能刪」規則一致。這是配合新契約的行為調整，跟一代「點擊任
// 一格只刪那一格、可能留下中間空格」的舊行為不完全相同，但更符合「槽位永遠
// 由左到右連續填入」這個既有不變量。
function removeBackTo(slotIndex) {
  if (!session) return;
  let view = getCurrentQuestionView(session);
  let guard = view.slots.length + 1;
  let removedCount = 0;
  while (guard-- > 0 && view.slots[slotIndex] && view.slots[slotIndex].tileId !== null) {
    const res = removeLastLetter(session);
    if (!res) break;
    removedCount++;
    view = getCurrentQuestionView(session);
  }
  if (removedCount > 0) playPopSound();
  renderAnswerSlots(view);
  renderTiles(view);
}

function removeLastLetterAndRender() {
  if (!session) return;
  const res = removeLastLetter(session);
  if (!res) return;
  playPopSound();
  const view = getCurrentQuestionView(session);
  renderAnswerSlots(view);
  renderTiles(view);
}

function updateHintButtonState(view) {
  const btn = $('btn-hint');
  if (!btn) return;
  const used = view.slots.some((s) => s.hinted);
  btn.disabled = used;
  btn.classList.toggle('used', used);
}

/** `#btn-hint` 點擊。 @returns {void} */
export function handleHintClick() {
  if (!session) return;
  const res = useHint(session);
  if (!res) return;
  mascot.mascotReactHint();
  const view = getCurrentQuestionView(session);
  renderAnswerSlots(view);
  renderTiles(view);
  updateHintButtonState(view);
  if (view.slots.every((s) => s.tileId !== null)) {
    runCheckAnswer();
  }
}

/** `#btn-speak` 點擊。 @returns {void} */
export function handleSpeakClick() {
  if (!session) return;
  const view = getCurrentQuestionView(session);
  speakWord(view.entry.word, { rate: getSettings().speechRate });
}

function runCheckAnswer() {
  const result = checkAnswer(session);
  if (result.correct) {
    handleCorrect(result.entry);
  } else {
    handleWrong(result.entry);
  }
}

function handleCorrect(entry) {
  uiScore++;
  $('game-score').textContent = '✅ ' + uiScore;
  document.querySelectorAll('.answer-slot').forEach((s) => s.classList.add('correct-flash'));
  const msg = $('feedback-message');
  msg.textContent = pickRandom(messages.praise);
  msg.className = 'feedback-message correct';
  playCorrectSound();
  mascot.mascotReactCorrectEmotion();
  // 進得了拼字關卡就代表 three.js 已經確認可用（見「開始遊戲」的硬性門檻
  // 檢查），呼叫這裡純粹沿用一代寫法，不特別防禦。
  celebrateCorrect();
  // 答對後不自動倒數切題，停在原題目讓孩子看清楚正確拼法，改成等孩子自己按
  // 「下一題」按鈕或空白鍵才前進（見 handleGameKeydown）。
  $('btn-next-question').hidden = false;
}

function handleWrong(entry) {
  document.querySelectorAll('.answer-slot').forEach((s) => s.classList.add('shake'));
  const msg = $('feedback-message');
  msg.textContent = pickRandom(messages.encourage);
  msg.className = 'feedback-message wrong';
  playWrongSound();
  mascot.mascotReactWrong();
  clearTimeout(pendingRetryTimeoutId);
  // 動畫時長是 UI 層的事：先讓孩子看清楚搖晃動畫跟錯誤提示 0.5 秒，再呼叫
  // `resetForRetry()` 真的清空槽位、解鎖讓玩家重試（已提示的槽位會保留）。
  pendingRetryTimeoutId = setTimeout(() => {
    pendingRetryTimeoutId = null;
    resetForRetry(session);
    const view = getCurrentQuestionView(session);
    renderAnswerSlots(view);
    renderTiles(view);
    const m = $('feedback-message');
    m.textContent = '';
    m.className = 'feedback-message';
  }, 500);
}

/** 「下一題」按鈕與空白鍵共用這個入口。 @returns {void} */
export function proceedFromCorrect() {
  if (!session) return;
  const view = getCurrentQuestionView(session);
  if (!view.awaitingNext) return;
  $('btn-next-question').hidden = true;
  const res = advanceToNextQuestion(session);
  if (res.finished) {
    finishLevelAndShowResult();
  } else {
    loadQuestionView();
  }
}

function finishLevelAndShowResult() {
  const result = finishLevel(session);
  // 這關已經結束，`session.currentIndex` 現在指向陣列外——把 session 清掉，
  // 避免結果/選難度畫面上任何還讀得到 `session` 的程式碼（例如語速試聽按鈕）
  // 呼叫 `getCurrentQuestionView(session).entry` 讀到 undefined 而炸掉。
  session = null;
  showView('result');
  renderResult(result.stars, result.accuracy, result.isNewSticker);
}

function renderResult(stars, accuracy, isNewSticker) {
  renderStarReveal(stars);
  $('result-accuracy').textContent = '第一次答對率：' + Math.round(accuracy * 100) + '%';
  const pool = messages.result ? messages.result[stars] : null;
  $('result-message').textContent = pool && pool.length ? pickRandom(pool) : '';
  mascot.mascotReactCheer();
  const themeId = currentThemeId;
  const levelKeyValue = currentLevelKey;
  if (isNewSticker) {
    celebrateLevelComplete('chest', { onLidOpen: () => showStickerPopup(themeId, levelKeyValue) });
  } else {
    celebrateLevelComplete('showcase');
  }
}

// 星星逐顆蹦出，搭配音效，比一次性顯示文字更有「過關」的戲劇性堆疊感
function renderStarReveal(stars) {
  const container = $('result-stars');
  container.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const span = document.createElement('span');
    span.className = 'result-star-item';
    span.textContent = i < stars ? '⭐' : '☆';
    span.style.animationDelay = `${i * 0.35}s`;
    container.appendChild(span);
    if (i < stars) {
      setTimeout(() => playStarPopSound(), i * 350 + 250);
    }
  }
}

// 首次三星過關的貼紙揭曉彈窗；時機由 three-fx 的開寶箱動畫透過 onLidOpen
// 回呼決定，不用自己猜一個 setTimeout 延遲。
function showStickerPopup(themeId, levelKeyValue) {
  const theme = getThemes().find((t) => t.id === themeId);
  const def = getLevelDefsForTheme(themeId).find((d) => d.key === String(levelKeyValue));
  if (!theme || !def) return;
  $('sticker-icon').textContent = theme.icon;
  $('sticker-name').textContent = theme.name + ' · ' + def.label;
  $('sticker-modal').hidden = false;
}

/** `#sticker-modal-close` 點擊。 @returns {void} */
export function hideStickerModal() {
  const modal = $('sticker-modal');
  if (modal) modal.hidden = true;
}

/** `#sticker-modal` 背景點擊（點在遮罩本身，不是卡片內容）。 @param {MouseEvent} e @returns {void} */
export function onStickerModalBackdropClick(e) {
  if (e.target && e.target.id === 'sticker-modal') hideStickerModal();
}

/**
 * 離開結果畫面（再玩一次／選其他難度／回主選單／中途離開拼字關卡）一定要
 * 呼叫這個：如果孩子在開寶箱動畫播完、onLidOpen 回呼觸發之前就點走，沒取消
 * 的話貼紙彈窗會晚半拍憑空跳到下一個畫面上面。同時把可能還開著的貼紙彈窗
 * 關掉，雙重保險。
 * @returns {void}
 */
export function cancelResultCelebration() {
  cancelCelebration();
  const modal = $('sticker-modal');
  if (modal) modal.hidden = true;
}

/** `#btn-leave-game` 點擊。 @returns {void} */
export function leaveGame() {
  clearTimeout(pendingRetryTimeoutId);
  pendingRetryTimeoutId = null;
  cancelResultCelebration();
  // 中途離開沒打完這關，清掉 session：回到選難度畫面後，語速試聽按鈕之類
  // 的程式碼不應該還讀到一個已經離開、卡在某一題的 session。
  session = null;
  showView('level-select');
}

/** `#btn-replay` 點擊。 @returns {void} */
export function replayLevel() {
  if (!currentThemeId || currentLevelKey == null) return;
  startLevelAndShow(currentThemeId, currentLevelKey);
}

/** `#btn-back-levels` 點擊。 @returns {void} */
export function backToLevels() {
  cancelResultCelebration();
  showLevelSelect(currentThemeId);
}

// ---------- 鍵盤輸入（view-game 可見時） ----------

function handleKeyboardLetterInput(letter) {
  const view = getCurrentQuestionView(session);
  if (view.locked) return;
  const tile = view.tiles.find((t) => !t.used && t.letter === letter);
  if (!tile) return;
  placeLetter(tile.id);
}

/**
 * `view-game` 可見時的鍵盤輸入處理，由 `ui/index.js` 的 `handleKeydown` 分流
 * 呼叫過來。
 * @param {KeyboardEvent} e
 * @returns {void}
 */
export function handleGameKeydown(e) {
  if (!session) return;
  // 答對後停在原題目等使用者操作，空白鍵是「下一題」按鈕的鍵盤捷徑；其餘
  // 時候（還在拼這一題）空白鍵不處理，避免不小心觸發瀏覽器的捲動。
  if (e.key === ' ' || e.code === 'Space') {
    const view = getCurrentQuestionView(session);
    if (view.awaitingNext) {
      e.preventDefault();
      proceedFromCorrect();
    }
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    removeLastLetterAndRender();
  } else if (/^[a-zA-Z]$/.test(e.key)) {
    handleKeyboardLetterInput(e.key.toLowerCase());
  }
}
