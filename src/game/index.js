// Phase 1 契約（凍結）—— 這份檔案定義 game 引擎對外的 API 邊界。
//
// 擁有者：Phase 1「game 引擎」agent。負責把下面每個 export 的 body 從
// `throw new Error('not implemented')` 換成真正的邏輯，邏輯來源是一代
// `拼字遊戲/app.js` 的「Word bank helpers」（約 319 行起）與「Game flow」
// （約 430 行起）兩段——但一代把 DOM 操作跟判分邏輯混在同一批函式裡
// （例如 `loadQuestion()`/`checkAnswer()` 內部直接呼叫 render 函式），
// 這裡只搬「跟 DOM 無關的邏輯部分」，render 交給 UI 層做。
//
// 規則：
// - 這份檔案 **不能 `document.*`／不能碰 DOM**，純邏輯 + 資料 + 呼叫
//   `src/progress` 模組讀寫進度。
// - 下面每個 export 的函式簽名（參數/回傳形狀）是跟 UI 層（Agent 4/5）
//   談好的契約，**不要更改簽名**；內部要怎麼拆小函式、`GameSession` 內部
//   實際存什麼欄位，都由你自己決定（UI 層不會直接讀 session 的欄位，
//   只透過 `getCurrentQuestionView()` 拿渲染用資料）。
// - 如果你發現契約本身有問題（例如少了某個 UI 一定要的欄位），在完成報告
//   裡明講你「新增」了什麼 export 或欄位並附理由，不要靜默改掉既有簽名。
//
// 資料來源：`src/data/data.json`（透過 `src/data/loadGameData.js` 載入，
// 見 Phase 0 的 `getLevelDefsForTheme()` 邏輯——一代 CLAUDE.md 特別強調
// 這是「唯一解析主題關卡定義」的地方，長度分級 `difficultyTiers` 跟
// `customLevels` 兩種主題都要吃）。

/**
 * @typedef {Object} WordEntry
 * @property {string} id
 * @property {string} word
 * @property {string} theme
 * @property {string|null} emoji
 * @property {string} [swatch]
 * @property {string} zh
 * @property {string[]} [syllables]
 * @property {{chunks:string[], silent:number[], audioOverrides?:Object<string,string>}} phonics
 */

/**
 * @typedef {Object} LevelDef
 * @property {string} key - 關卡的 opaque 識別碼（一代的 tier 數字或 customLevels
 *   的 id，統一轉成 string；跟 progress.levels 的 key 組合方式一致：
 *   `${themeId}_${key}`）
 * @property {string} label - 選難度畫面顯示的名稱（例如「初級（3 字母）」或
 *   「暑假複習1（22 字）」）
 * @property {number} distractorCount
 * @property {number} wordCount
 * @property {boolean} playable - 已套用 `MIN_WORDS_PER_LEVEL`（一代預設 3）規則，
 *   單字數不足時為 false，UI 要把這個關卡卡片渲染成禁用狀態
 */

/**
 * @typedef {Object} GameSession
 * 內部狀態，欄位由實作者自訂，UI 層不會直接存取，只透過本檔的函式操作。
 */

/**
 * @returns {Array<{id:string,name:string,icon:string,color:string}>} 主題清單
 */
export function getThemes() {
  throw new Error('not implemented');
}

/**
 * 一代 `getLevelDefsForTheme()` 的搬遷版本——唯一解析「這個主題有哪些關卡」
 * 的地方，`difficultyTiers`（長度分級）跟 `customLevels`（自訂關卡）都要處理。
 * @param {string} themeId
 * @returns {LevelDef[]}
 */
export function getLevelDefsForTheme(themeId) {
  throw new Error('not implemented');
}

/**
 * @returns {Array<{themeId:string, key:string}>} 所有「已套用 playable 規則」
 *   的 主題×關卡 組合，供「我的進度」頁面畫總覽表格與貼紙簿用
 */
export function getValidLevelCombos() {
  throw new Error('not implemented');
}

/**
 * @param {string} themeId
 * @returns {WordEntry[]} 該主題全部單字（不分關卡），供字卡瀏覽「整個主題」模式
 */
export function getAllWordsForTheme(themeId) {
  throw new Error('not implemented');
}

/**
 * @param {string} themeId
 * @param {string} levelKey
 * @returns {WordEntry[]} 該關卡包含的單字（未洗牌），供字卡瀏覽「鎖定主題+難度」模式
 */
export function getWordsForLevel(themeId, levelKey) {
  throw new Error('not implemented');
}

/**
 * 開始一個新關卡的作答 session（單字會被洗牌）。
 * @param {string} themeId
 * @param {string} levelKey
 * @returns {GameSession}
 */
export function startLevel(themeId, levelKey) {
  throw new Error('not implemented');
}

/**
 * 目前題目的渲染用資料，UI 只要照這個畫面就好，不用自己重算 tile/slot。
 * @param {GameSession} session
 * @returns {{
 *   index:number, total:number, entry:WordEntry,
 *   tiles:Array<{id:string,letter:string}>,
 *   slotCount:number,
 *   syllableGroupSizes:number[]|null,
 *   awaitingNext:boolean,
 *   locked:boolean
 * }}
 */
export function getCurrentQuestionView(session) {
  throw new Error('not implemented');
}

/**
 * 把某個字母方塊放進「目前第一個空槽」（一代規則：方塊除了字母外互相無差異，
 * 重複字母任選一個未用方塊都可以）。
 * @param {GameSession} session
 * @param {string} tileId
 * @returns {{slotIndex:number}|null} session 為 locked 狀態時回傳 null 且不做任何事
 */
export function placeLetterInSlot(session, tileId) {
  throw new Error('not implemented');
}

/**
 * 移除「最後一個已填槽位」（一代規則：槽位固定左到右依序填入，最後一個已填
 * 槽位＝最後輸入的字母；已被提示鎖定的槽位不能移除）。
 * @param {GameSession} session
 * @returns {{slotIndex:number}|null}
 */
export function removeLastLetter(session) {
  throw new Error('not implemented');
}

/**
 * 檢查目前答案槽位是否已全部填滿且拼對。
 * @param {GameSession} session
 * @returns {{correct:boolean, entry:WordEntry}}
 */
export function checkAnswer(session) {
  throw new Error('not implemented');
}

/**
 * 提示安全閥：自動填入下一個空槽的正確字母，每題限用一次，用過會讓這題的
 * 星等被封頂（見 `finishLevel` 的 `starsCapped` 邏輯）。
 * @param {GameSession} session
 * @returns {{tileId:string, slotIndex:number}|null} null 代表這題已經用過提示
 */
export function useHint(session) {
  throw new Error('not implemented');
}

/**
 * 答對後、玩家按下「下一題」或空白鍵時呼叫，把題目游標推進到下一題。
 * @param {GameSession} session
 * @returns {{finished:boolean}} finished=true 代表這關已經是最後一題，UI 該去呼叫
 *   `finishLevel()` 並切到結果畫面
 */
export function advanceToNextQuestion(session) {
  throw new Error('not implemented');
}

/**
 * 關卡結束時呼叫：計算星等（一代 `calcStars()` 邏輯：使用過提示的題目視同
 * non-first-try）、寫入 `src/progress` 模組（`saveProgress`，星等只升不降），
 * 並回傳這關是不是第一次拿到 3 星（供 UI 決定要不要觸發開寶箱動畫＋貼紙彈窗，
 * 見 `src/three-fx` 的 `celebrateLevelComplete(kind, { onLidOpen })`）。
 * @param {GameSession} session
 * @returns {{stars:number, accuracy:number, isNewSticker:boolean}}
 */
export function finishLevel(session) {
  throw new Error('not implemented');
}
