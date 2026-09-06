// 單字庫 / 主題 / 關卡定義 —— 搬自一代 app.js「Word bank helpers」段落
// （`getWordsForLevel`/`getLevelDefsForTheme`/`getValidLevelCombos`）。
//
// `getLevelDefsForTheme()` 是「唯一解析某主題有哪些關卡」的地方，
// `difficultyTiers`（長度分級）跟 `customLevels`（自訂關卡）都要處理，
// 且統一成同一種 LevelDef 形狀，UI 不需要知道背後是哪一種來源。

import wordBankData from '../data/data.json';
import { loadProgress } from '../progress/store.js';

/** 一代 `MIN_WORDS_PER_LEVEL`：單字數不足這個數字的關卡自動停用。 */
export const MIN_WORDS_PER_LEVEL = 3;

const WORD_BANK = wordBankData.wordBank;
const THEMES = wordBankData.themes;
const DIFFICULTY_TIERS = wordBankData.difficultyTiers;

// ---------------------------------------------------------------------------
// Phase 3「錯題本／複習模式」：storage override 的單一持有者。
//
// `getLevelDefsForTheme()`/`getWordsForLevel()` 現在需要讀 `src/progress` 才能
// 算出「這個主題有哪些字該複習」，但這兩個函式的簽名是凍結的契約（不能加
// storage 參數）。跟 `session.js` 一樣需要一個模組層級的 storage 覆寫開關
// 給測試用（見 `session.js` 開頭「測試隔離」說明）。
//
// 這份狀態放在 wordbank.js（而不是各自維護一份）是因為 `session.js` 已經
// `import` 這個檔案（`getWordsForLevel`/`getLevelDefsForTheme`），單向依賴
// wordbank.js -> （被 session.js 依賴），如果 session.js 也保留自己的一份
// storageOverride，測試呼叫 `setProgressStorage()` 只會覆寫其中一邊，
// 導致複習判斷讀到的進度跟 `checkAnswer()`/`finishLevel()` 寫入的進度是
// 兩個不同的 storage、對不起來。所以改成 wordbank.js 是唯一持有者，
// `session.js` 透過 `getProgressStorageOverride()` 讀同一份。
let storageOverride;

/**
 * 新增 export（原本在 `session.js`，Phase 3 搬來這裡，見上方說明；`index.js`
 * 的 export 來源已同步改成這裡，行為/簽名完全不變）：覆寫 wordbank.js／
 * session.js 共用的進度 storage。生產程式碼不用呼叫，只有測試需要各自獨立
 * storage 隔離時才呼叫，搭配 `src/progress/store.js` 的 `createMemoryStorage()`。
 * @param {{getItem:Function,setItem:Function}|undefined} storage
 * @returns {void}
 */
export function setProgressStorage(storage) {
  storageOverride = storage;
}

/**
 * 供 `session.js` 讀取同一份 storage override（見上方說明），非公開契約，
 * 不透過 `index.js` 轉出。
 * @returns {{getItem:Function,setItem:Function}|undefined}
 */
export function getProgressStorageOverride() {
  return storageOverride;
}

function getProgress() {
  return loadProgress(storageOverride);
}

function findTheme(themeId) {
  return THEMES.find((t) => t.id === themeId);
}

/**
 * 一個字該不該被排進複習關卡：在該主題所有關卡的 wordProgress 加總後，
 * 「錯過至少一次」且「答對次數還沒明顯超過錯誤次數」。用 `correct - wrong`
 * 的淨值而非只看 `correct`，是因為同一個字反覆錯了又對時，只看 correct
 * 次數會低估孩子對這個字仍然不熟的程度；門檻抓 2（要淨勝 2 次「答對」才
 * 算真的學會、可以從複習清單畢業），是一個保守、寧可多複習不要漏掉的起點。
 * @param {{correct:number, wrong:number}} agg
 * @returns {boolean}
 */
function needsReview(agg) {
  return agg.wrong > 0 && agg.correct - agg.wrong < 2;
}

/**
 * 把某主題底下「所有」關卡（不分 tier/custom/review 本身）的 wordProgress
 * 依 wordId 加總——複習關卡本身答對/答錯也會回饋進來（複習關卡的
 * progress.levels key 是 `${themeId}_review`，`lp.themeId` 一樣是 themeId，
 * 所以自然被算進來），這樣複習答對了才會真的讓字「畢業」離開複習清單。
 * @param {string} themeId
 * @param {import('../progress/schema.js').ProgressV2} progress
 * @returns {Object<string, {correct:number, wrong:number}>}
 */
function aggregateWordProgressForTheme(themeId, progress) {
  const agg = {};
  Object.keys(progress.levels).forEach((key) => {
    const lp = progress.levels[key];
    if (lp.themeId !== themeId) return;
    Object.keys(lp.wordProgress || {}).forEach((wordId) => {
      const wp = lp.wordProgress[wordId];
      const entry = agg[wordId] || (agg[wordId] = { correct: 0, wrong: 0 });
      entry.correct += wp.correct;
      entry.wrong += wp.wrong;
    });
  });
  return agg;
}

/**
 * 複習關卡（虛擬關卡，`key:'review'`）符合條件的單字，依「最需要複習」
 * 排序（`wrong - correct` 降冪：淨錯越多排越前面）。
 * @param {string} themeId
 * @returns {import('./index.js').WordEntry[]}
 */
function getReviewWords(themeId) {
  const agg = aggregateWordProgressForTheme(themeId, getProgress());
  const eligibleIds = new Set(Object.keys(agg).filter((wordId) => needsReview(agg[wordId])));
  return getAllWordsForTheme(themeId)
    .filter((w) => eligibleIds.has(w.id))
    .sort((a, b) => (agg[b.id].wrong - agg[b.id].correct) - (agg[a.id].wrong - agg[a.id].correct));
}

/**
 * 複習關卡的 distractorCount：沒有專屬設計數字可用，取該主題其他關卡
 * distractorCount 的平均（四捨五入），沒有其他關卡可參考時退回 2。
 * @param {import('./index.js').LevelDef[]} baseDefs
 * @returns {number}
 */
function averageDistractorCount(baseDefs) {
  if (!baseDefs.length) return 2;
  const total = baseDefs.reduce((sum, d) => sum + d.distractorCount, 0);
  return Math.round(total / baseDefs.length);
}

function wordsForTier(themeId, tierDef) {
  return WORD_BANK.filter(
    (w) => w.theme === themeId && w.word.length >= tierDef.minLen && w.word.length <= tierDef.maxLen
  );
}

function wordsForCustomLevel(lvl) {
  return lvl.wordIds.map((id) => WORD_BANK.find((w) => w.id === id)).filter(Boolean);
}

/**
 * @returns {Array<{id:string,name:string,icon:string,color:string}>}
 */
export function getThemes() {
  return THEMES.map((t) => ({ id: t.id, name: t.name, icon: t.icon, color: t.color }));
}

/**
 * @param {string} themeId
 * @returns {import('./index.js').LevelDef[]}
 */
export function getLevelDefsForTheme(themeId) {
  const theme = findTheme(themeId);
  let defs;

  if (theme && theme.customLevels && theme.customLevels.length) {
    defs = theme.customLevels.map((lvl) => {
      const words = wordsForCustomLevel(lvl);
      const wordCount = words.length;
      return {
        key: String(lvl.id),
        // 新增欄位（原本沒有）：讓呼叫端能用同一個欄位分辨 tier/custom/review
        // 三種關卡來源，見下方 review 虛擬關卡的說明。
        kind: 'custom',
        label: `${lvl.label}（${wordCount} 字）`,
        distractorCount: lvl.distractorCount != null ? lvl.distractorCount : 2,
        wordCount,
        playable: wordCount >= MIN_WORDS_PER_LEVEL,
      };
    });
  } else {
    defs = DIFFICULTY_TIERS.map((tierDef) => {
      const words = wordsForTier(themeId, tierDef);
      const lenLabel = tierDef.minLen === tierDef.maxLen ? `${tierDef.minLen} 字母` : `${tierDef.minLen}+ 字母`;
      return {
        key: String(tierDef.tier),
        kind: 'tier',
        label: `${tierDef.label}（${lenLabel}）`,
        distractorCount: tierDef.distractorCount,
        wordCount: words.length,
        playable: words.length >= MIN_WORDS_PER_LEVEL,
      };
    });
  }

  // Phase 3「錯題本／複習模式」：每個主題最後多加一個虛擬關卡（`key:'review'`，
  // `kind:'review'`），沿用既有的拼字關卡畫面/判分邏輯，不是新畫面。沒有任何
  // 符合條件的錯題時（n===0）完全不 push 這個項目——不是 playable:false 顯示
  // 一個空的複習關卡，是根本不讓這個選項出現，避免孩子點進去看到空白關卡。
  const reviewWords = getReviewWords(themeId);
  if (reviewWords.length > 0) {
    defs.push({
      key: 'review',
      kind: 'review',
      label: `錯題複習（${reviewWords.length} 字）`,
      distractorCount: averageDistractorCount(defs),
      wordCount: reviewWords.length,
      playable: reviewWords.length >= MIN_WORDS_PER_LEVEL,
    });
  }

  return defs;
}

/**
 * @returns {Array<{themeId:string, key:string}>}
 */
export function getValidLevelCombos() {
  const combos = [];
  THEMES.forEach((theme) => {
    getLevelDefsForTheme(theme.id).forEach((def) => {
      // 複習虛擬關卡不算進「我的進度」總覽表格/貼紙簿——那份清單假設每個
      // combo 都是「主題+一般關卡」的固定組合，複習關卡不需要（也不應該）
      // 在那裡佔一個位置，見 index.js 契約說明與整合筆記。
      if (def.playable && def.kind !== 'review') combos.push({ themeId: theme.id, key: def.key });
    });
  });
  return combos;
}

/**
 * @param {string} themeId
 * @returns {import('./index.js').WordEntry[]}
 */
export function getAllWordsForTheme(themeId) {
  return WORD_BANK.filter((w) => w.theme === themeId);
}

/**
 * 該主題+關卡的實際單字清單（未洗牌），tiered/custom 兩種來源都吃。
 * @param {string} themeId
 * @param {string} levelKey
 * @returns {import('./index.js').WordEntry[]}
 */
export function getWordsForLevel(themeId, levelKey) {
  const theme = findTheme(themeId);
  const key = String(levelKey);

  // Phase 3 複習虛擬關卡：跟 tier/custom 用同一個函式取單字清單，呼叫端
  // （session.js 的 `startLevel`）完全不用知道這批字是怎麼被選出來的。
  if (key === 'review') return getReviewWords(themeId);

  if (theme && theme.customLevels && theme.customLevels.length) {
    const lvl = theme.customLevels.find((l) => String(l.id) === key);
    return lvl ? wordsForCustomLevel(lvl) : [];
  }

  const tierDef = DIFFICULTY_TIERS.find((t) => String(t.tier) === key);
  return tierDef ? wordsForTier(themeId, tierDef) : [];
}

/**
 * 供 session.js 組字母方塊用：全站單字庫（干擾字母來源不限主題，跟一代一致）。
 * @returns {import('./index.js').WordEntry[]}
 */
export function getFullWordBank() {
  return WORD_BANK;
}
