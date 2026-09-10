// Phase 1 契約（凍結）—— UI 層的檔案切分與擁有者。
//
// DOM 結構跟 CSS 已經凍結（`index.html` 的 10 個 `<section id="view-*">`、
// `src/styles.css`），逐字對照一代 `拼字遊戲/index.html`／`styles.css`
// 搬過來，Phase 1 期間**不能改**這兩個檔案（元素 id/class 都不變）。
// 需要新 DOM 就用 JS 動態建立（例如 `theme-grid`/`level-grid` 底下的卡片）。
//
// 檔案切分（各自獨立 export，`main.js` 整合階段才會串起來）：
//
// - `src/ui/index.js`（本檔，Agent 4 擁有）：
//   - `showView(name)`：切換 `<section id="view-*">` 的 hidden
//   - `bindStaticEvents()`：所有畫面共用、只需綁一次的事件（data-nav 返回鍵、
//     view-progress/view-flashcards 等固定按鈕）
//   - `handleKeydown(e)`：**唯一**的 document-level keydown 監聽器掛在這裡
//     （一代 CLAUDE.md 強調這是「單一監聽器依 view 可見性分流」，不是每個
//     view 各自掛一個）。分流邏輯：`view-game` 可見時呼叫本檔案內處理拼字
//     輸入的函式；`view-flashcards` 可見時呼叫 `flashcards.js` export 的
//     `handleFlashcardKeydown(e)`（Agent 5 負責 export 這個函式，簽名見下）。
//   - `initToast()`／`showToast(msg)`
// - `src/ui/mascot.js`（Agent 4 擁有）：吉祥物渲染＋動畫＋待機歪頭，搬自一代
//   `app.js` 開頭「DOM helpers」段落裡跟 mascot 相關的函式群
//   （`setMascotCharacter`/`pickRandomMascot`/`mascotReact*`/`mascotIdleTilt`
//   等）。**Phase 1 只搬「中性表情」行為**（`<id>.png`，跟一代現況一致）——
//   45 張情緒表情圖檔已經在 `public/mascot-images/` 裡，但接上情緒是
//   Phase 3 的「新玩法」項目，不是 Phase 1 功能對等的範圍，不要在這裡開始用
//   `_angry`/`_laughing` 等檔名。
// - `src/ui/game-flow.js`（Agent 4 擁有）：主選單 → 選主題 → 選難度 → 遊戲
//   畫面 → 結果畫面，呼叫 `src/game/index.js` 拿資料/判分、`src/audio`
//   播音效發音、`src/three-fx` 播特效。對應一代「Theme / level / progress
//   rendering」段落的主題/關卡渲染部分 + 「Game flow」段落的 DOM 渲染部分
//   + 「Event bindings」裡跟拼字關卡相關的綁定。
// - `src/ui/flashcards.js`（Agent 5 擁有）：字卡瀏覽畫面，對應一代
//   `openFlashcards()`/`renderFlashcard()`。需要 export
//   `handleFlashcardKeydown(e)`（ArrowLeft/ArrowRight 呼叫既有上一張/下一張
//   按鈕的 `.click()`，disabled 狀態下 `.click()` 不會觸發，見一代註解）
//   供本檔 `handleKeydown` 分流呼叫。
// - `src/ui/blend.js`（Agent 5 擁有）：拼讀練習畫面，對應一代
//   `openBlendGame()`/`loadBlendQuestion()`/`renderBlendChoices()`/
//   `handleBlendChoice()`。
// - `src/ui/progress-page.js`（Agent 5 擁有）：我的進度頁（總覽表格、貼紙簿、
//   匯出/匯入、3D 特效診斷按鈕），對應一代 `renderProgressTable()`/
//   `renderCollectiblesGrid()`／`checkThreeFxStatus()`。呼叫
//   `src/game/index.js` 的 `getValidLevelCombos()`、`src/progress/store.js`
//   的 `exportProgress`/`importProgress`。
//
// `settings.hintMode` 實際值是 `'image'|'audio'|'both'`（不是字面上像
// 「文字提示」的東西，這是一代實測出來的三選一，見 Phase 0 進度 schema
// agent 的驗證），讀設定時字串要對準這三個值。

// 實作筆記（Agent 4）：`bindStaticEvents()` 綁定的是「凍結 HTML 裡本來就存在
// 的靜態元素」的事件（data-nav 返回鍵、遊戲畫面固定按鈕、選難度畫面的設定
// 按鈕、貼紙彈窗等），每個按鈕實際的業務邏輯轉呼叫 `game-flow.js` 對應的
// export（渲染/狀態都在那邊，這裡只負責「按了這顆按鈕該呼叫誰」的接線）。
//
// `src/ui/flashcards.js`/`blend.js`/`progress-page.js` 是 Agent 5 平行負責
// 的檔案，各自的頂部註解都明講自己 `bindXxxEvents()` 只綁自己畫面底下的固定
// 按鈕、要整合階段呼叫一次——這裡把那三個呼叫收在 `bindStaticEvents()` 裡
// （只呼叫它們的 export，沒有修改那三支檔案），連同 `handleFlashcardKeydown`
// 一起接上，避免同一批按鈕被兩邊重複綁定。
//
// `main.js` 整合階段除了呼叫這裡的 `bindStaticEvents()`/`handleKeydown`，
// 還需要額外呼叫 `game-flow.js` 匯出的 `initGameFlow()`（資料載入 + 語音初
// 始化 + three-fx 硬性門檻檢查，等同一代 `loadGameData()`），這裡沒有自動
// 觸發，因為契約描述 `bindStaticEvents()` 只負責「綁事件」。

import {
  cancelResultCelebration,
  handleStartButtonClick,
  handleFlashcardsMenuClick,
  handleBlendMenuClick,
  handleGameKeydown,
  handleHintClick,
  handleSpeakClick,
  hideStickerModal,
  initGameFlow,
  leaveGame,
  onHintModeButtonsClick,
  onSoundToggleButtonsClick,
  onTileSoundButtonsClick,
  onSpeechRateButtonsClick,
  onStickerModalBackdropClick,
  proceedFromCorrect,
  renderThemeGrid,
  backToLevels,
  replayLevel,
} from './game-flow.js';

import { bindFlashcardEvents, handleFlashcardKeydown } from './flashcards.js';
import { bindBlendEvents } from './blend.js';
import { bindProgressEvents, renderProgressPage } from './progress-page.js';

const VIEWS = [
  'loading', 'load-error', 'splash', 'theme-select', 'level-select',
  'game', 'result', 'progress', 'flashcards', 'blend',
];

function $(id) {
  return document.getElementById(id);
}

/**
 * @param {'loading'|'load-error'|'splash'|'theme-select'|'level-select'|'game'|'result'|'progress'|'flashcards'|'blend'} name
 * @returns {void}
 */
export function showView(name) {
  VIEWS.forEach((v) => {
    const el = $('view-' + v);
    if (el) el.hidden = v !== name;
  });
}

let toastTimer = null;

/** @param {string} msg @returns {void} */
export function showToast(msg) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}

/** @returns {void} */
export function bindStaticEvents() {
  // 通用返回鍵：所有畫面共用同一套 data-nav 機制。離開任何畫面前都先取消
  // 可能還在播的過關特效/貼紙彈窗（一代 `cancelResultCelebration()` 在每個
  // data-nav 點擊都無條件呼叫一次，避免貼紙彈窗晚半拍蓋在下個畫面上）。
  // 回到選主題畫面時要重新渲染（星等可能剛更新過）。
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.nav;
      cancelResultCelebration();
      if (target === 'theme-select') renderThemeGrid();
      showView(target);
    });
  });

  const btnStart = $('btn-start');
  if (btnStart) btnStart.addEventListener('click', handleStartButtonClick);

  const btnFlashcardsMenu = $('btn-flashcards');
  if (btnFlashcardsMenu) btnFlashcardsMenu.addEventListener('click', handleFlashcardsMenuClick);

  const btnBlendMenu = $('btn-blend');
  if (btnBlendMenu) btnBlendMenu.addEventListener('click', handleBlendMenuClick);

  const btnProgressMenu = $('btn-progress');
  if (btnProgressMenu) {
    btnProgressMenu.addEventListener('click', () => {
      renderProgressPage();
      showView('progress');
    });
  }

  const btnRetryLoad = $('btn-retry-load');
  if (btnRetryLoad) btnRetryLoad.addEventListener('click', initGameFlow);

  const btnLeaveGame = $('btn-leave-game');
  if (btnLeaveGame) btnLeaveGame.addEventListener('click', leaveGame);

  const btnSpeak = $('btn-speak');
  if (btnSpeak) btnSpeak.addEventListener('click', handleSpeakClick);

  const btnHint = $('btn-hint');
  if (btnHint) btnHint.addEventListener('click', handleHintClick);

  const btnNextQuestion = $('btn-next-question');
  if (btnNextQuestion) btnNextQuestion.addEventListener('click', proceedFromCorrect);

  const hintModeButtons = $('hint-mode-buttons');
  if (hintModeButtons) hintModeButtons.addEventListener('click', onHintModeButtonsClick);

  const soundToggleButtons = $('sound-toggle-buttons');
  if (soundToggleButtons) soundToggleButtons.addEventListener('click', onSoundToggleButtonsClick);

  const tileSoundButtons = $('tile-sound-buttons');
  if (tileSoundButtons) tileSoundButtons.addEventListener('click', onTileSoundButtonsClick);

  const speechRateButtons = $('speech-rate-buttons');
  if (speechRateButtons) speechRateButtons.addEventListener('click', onSpeechRateButtonsClick);

  const btnReplay = $('btn-replay');
  if (btnReplay) btnReplay.addEventListener('click', replayLevel);

  const btnBackLevels = $('btn-back-levels');
  if (btnBackLevels) btnBackLevels.addEventListener('click', backToLevels);

  const stickerModalClose = $('sticker-modal-close');
  if (stickerModalClose) stickerModalClose.addEventListener('click', hideStickerModal);

  const stickerModal = $('sticker-modal');
  if (stickerModal) stickerModal.addEventListener('click', onStickerModalBackdropClick);

  // Agent 5 的三個畫面各自的固定按鈕綁定，只應該呼叫一次。
  bindFlashcardEvents();
  bindBlendEvents();
  bindProgressEvents();
}

/**
 * 唯一的 document-level keydown 分流入口。
 * @param {KeyboardEvent} e
 * @returns {void}
 */
export function handleKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const viewGame = $('view-game');
  const viewFlashcards = $('view-flashcards');
  if (viewGame && !viewGame.hidden) {
    handleGameKeydown(e);
  } else if (viewFlashcards && !viewFlashcards.hidden) {
    handleFlashcardKeydown(e);
  }
}
