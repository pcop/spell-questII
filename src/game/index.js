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
//
// ---------------------------------------------------------------------------
// 實作筆記（本檔案已從「契約 stub」變成真正實作，內部邏輯拆到同資料夾底下）：
//   - `./wordbank.js`   —— 主題/關卡/單字庫查詢（一代「Word bank helpers」）
//   - `./helpers.js`    —— 洗牌／挑干擾字母／組字母方塊等純函式小工具
//   - `./session.js`    —— 作答 session 狀態機（一代「Game flow」）
// 這份 index.js 只負責把契約定義的 export 轉發到上面三個檔案，簽名完全不變。
//
// 跟契約的出入（新增項目，皆為「加法」，未移除/未更改任何既有簽名或欄位）：
//   1. `getCurrentQuestionView()` 回傳物件多了一個 `slots` 欄位——
//      `Array<{tileId:string|null, letter:string|null, hinted:boolean}>`。
//      原契約只給了 `slotCount`（槽位數量），但沒有任何欄位告訴 UI「每個槽位
//      目前填了哪個字母、是不是提示鎖定的槽位」，UI 沒有這個畫不出填字進度
//      跟提示高亮效果，所以額外補上。
//   2. `getCurrentQuestionView()` 回傳的 `tiles` 每個元素多了 `used:boolean`
//      （原本只有 `id`/`letter`），UI 需要知道哪些字母方塊已經被放進槽位裡
//      才能畫成「已使用/停用」樣式。
//   3. 新增 export `resetForRetry(session)`：答錯後一代會等 500ms「搖晃」動畫
//      播完才清空槽位重試（`resetSlotsKeepTiles`），但動畫時長是 UI 層的事，
//      這份純邏輯檔案不擁有計時器。所以 `checkAnswer()` 答錯時維持
//      `locked:true`（跟一代一樣擋住輸入），改由 UI 播完動畫後呼叫這個新
//      export 才真的清空槽位、解鎖讓玩家重試。
//   4. 新增 export `MIN_WORDS_PER_LEVEL`（從 `./wordbank.js` 轉出）：一代的
//      「單字數不足自動停用關卡」門檻常數，`getLevelDefsForTheme()`/
//      `getValidLevelCombos()` 內部已經套用這條規則，這裡額外 export 出來
//      純粹方便 UI 或測試需要顯示/驗證這個數字時不用重新寫死一次。
//   5. 新增 export `getFullWordBank()`（從 `./wordbank.js` 轉出）：干擾字母
//      的來源是整個單字庫（不分主題，見一代 `pickDistractorLetters`），這個
//      小工具函式提供給需要自行組字母方塊的呼叫端使用，非必要但無害。
//   6. `advanceToNextQuestion()` 內部多了一個 guard：只有在 `awaitingNext`
//      （答對、等玩家按下一題/空白鍵）狀態下才會真的把題目游標前進，對應
//      一代 `proceedFromCorrect()` 的 `if (!gameState.awaitingNext) return;`——
//      這是實作細節而非簽名/回傳形狀變動，但明講一下：UI 把空白鍵處理常駐
//      掛在 keydown 上時，題目做到一半誤觸空白鍵不會被當成「跳過這題」。
//   7. 新增 export `setProgressStorage(storage)`（從 `./session.js` 轉出）：
//      進度持久化 timing 跟一代對等——`checkAnswer()` 每答完一題（不論對錯）
//      就立刻 `loadProgress`/`saveProgress` 一次（見一代 `recordAnswer()`），
//      不是等到 `finishLevel()` 才一次性 flush，避免中途重整瀏覽器遺失那一關
//      已經答對的題目。但 `startLevel`/`checkAnswer`/`finishLevel` 的簽名是
//      凍結的，沒辦法為了測試注入一個乾淨的 storage 而加參數，所以額外提供
//      這個模組層級開關：生產程式碼完全不用呼叫（不呼叫＝原本的真實
//      localStorage 行為不變），只有測試需要各自獨立 storage 隔離時才呼叫，
//      搭配 `src/progress/store.js` 既有的 `createMemoryStorage()` 使用。
//      （Phase 3 更新：這個 export 的實作搬到 `./wordbank.js`，因為複習關卡
//      判斷也需要讀 `src/progress`，兩邊要共用同一份 storage override 才不會
//      各自為政讀到不一致的進度；`index.js` 對外的簽名/行為完全不變。）
//   8. Phase 3「錯題本／複習模式」（見 `規劃.md` D 段）：`getLevelDefsForTheme()`
//      回傳陣列最後多一個虛擬關卡（`key:'review'`），沿用既有拼字關卡畫面/
//      判分邏輯，不是新畫面/新流程。`LevelDef` 新增 `kind` 欄位
//      （`'tier'|'custom'|'review'`），方便呼叫端分辨三種來源；`getWordsForLevel`
//      對 `levelKey:'review'` 回傳符合複習條件的單字（依「最需要複習」排序）；
//      `finishLevel()` 對 `kind:'review'` 的關卡永遠回傳 `isNewSticker:false`
//      且不寫 `progress.collectibles`（複習可無限次重打，不能刷貼紙）；
//      `getValidLevelCombos()` 排除複習虛擬關卡（進度總覽/貼紙簿不需要它）。
//      細節見 `./wordbank.js`／`./session.js` 內的註解。
// ---------------------------------------------------------------------------

export {
  getThemes,
  getLevelDefsForTheme,
  getValidLevelCombos,
  getAllWordsForTheme,
  getWordsForLevel,
  MIN_WORDS_PER_LEVEL,
  getFullWordBank,
  setProgressStorage,
} from './wordbank.js';

export {
  startLevel,
  getCurrentQuestionView,
  placeLetterInSlot,
  removeLastLetter,
  checkAnswer,
  useHint,
  advanceToNextQuestion,
  finishLevel,
  resetForRetry,
} from './session.js';

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
 * @property {'tier'|'custom'|'review'} kind - 新增欄位（Phase 3）：這個關卡定義
 *   的來源——`'tier'` 是長度分級關卡、`'custom'` 是主題自訂關卡、`'review'` 是
 *   錯題複習虛擬關卡（`key` 固定是字串 `'review'`）。`getValidLevelCombos()`
 *   排除 `'review'`；`finishLevel()` 對 `'review'` 關卡不給貼紙。
 */

/**
 * @typedef {Object} GameSession
 * 內部狀態，欄位由實作者自訂，UI 層不會直接存取，只透過本檔的函式操作。
 */
