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

/**
 * @param {'loading'|'load-error'|'splash'|'theme-select'|'level-select'|'game'|'result'|'progress'|'flashcards'|'blend'} name
 * @returns {void}
 */
export function showView(name) {
  throw new Error('not implemented');
}

/** @returns {void} */
export function bindStaticEvents() {
  throw new Error('not implemented');
}

/**
 * 唯一的 document-level keydown 分流入口。
 * @param {KeyboardEvent} e
 * @returns {void}
 */
export function handleKeydown(e) {
  throw new Error('not implemented');
}

/** @param {string} msg @returns {void} */
export function showToast(msg) {
  throw new Error('not implemented');
}
