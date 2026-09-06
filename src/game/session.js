// 作答 session 狀態機 —— 搬自一代 app.js「Game flow」段落
// （`startLevel`/`loadQuestion`/`placeLetterInSlot`/`removeLetterFromSlot`/
// `useHint`/`checkAnswer`/`handleCorrect`/`handleWrong`/`nextQuestionOrFinish`/
// `calcStars`/`finishLevel`），只留邏輯，DOM 渲染留給 UI 層。
//
// 跟一代的差異（timing）：一代答錯後用 `setTimeout(resetSlotsKeepTiles, 500)`
// 讓玩家看得到「搖晃」動畫再清空槽位；這裡沒有計時器/DOM 概念，改成
// `checkAnswer()` 回傳 `correct:false` 後維持 `locked:true`（跟一代一致，
// input 仍被擋住），由 UI 層自己決定動畫播多久，播完再呼叫新增的
// `resetForRetry()` 才真的清空槽位——把「等多久」這個純 UI 決定權還給 UI 層。
//
// 進度持久化：跟一代 `recordAnswer()` 完全一致的 timing——每答完一題
// （`checkAnswer()` 判定槽位已填滿的那一刻，不論對錯）就 `loadProgress`/
// `saveProgress` 一次，attempts/correctCount/wordProgress 立刻寫回
// `src/progress`，不是等到 `finishLevel()` 才統一 flush。這樣中途重整瀏覽器
// 不會遺失那一關已經答對的題目，跟一代行為對等（見一代 CLAUDE.md
// 「Progress persistence: written after every answered question」）。
// `finishLevel()` 只在最後多做一次 `saveProgress`，把 bestAccuracy/bestStars/
// completed/collectibles 這些「整關結束才知道」的欄位補上——跟一代
// `recordAnswer()`（逐題）+ `finalizeLevelRun()`（整關結束）兩個寫入點對應。
//
// 測試隔離：`loadProgress`/`saveProgress` 沒有暴露 storage 參數給 game 層的
// 契約（`startLevel`/`checkAnswer`/`finishLevel` 簽名是凍結的，不能為了測試
// 加一個 storage 參數），所以額外新增 `setProgressStorage(storage)`——
// 一個模組層級的 storage 覆寫開關，預設不呼叫就完全不影響生產行為（沿用
// `src/progress/store.js` 的預設 real localStorage / 記憶體 fallback），只有
// 測試會呼叫它注入各自獨立的 `createMemoryStorage()`，避免測試之間共用同一份
// process 內的 fallback storage 互相汙染。

import { getWordsForLevel, getLevelDefsForTheme } from './wordbank.js';
import { buildTileSet, shuffleArray } from './helpers.js';
import { getFullWordBank } from './wordbank.js';
import { loadProgress, saveProgress } from '../progress/store.js';
import { levelKey as progressLevelKey } from '../progress/schema.js';

// 模組層級的 storage 覆寫（見檔案開頭「測試隔離」說明）。`undefined` 代表沒有
// 覆寫，`loadProgress`/`saveProgress` 會用它們自己的預設參數（真實
// localStorage，或沒有 localStorage 時的記憶體 fallback）。
let storageOverride;

/**
 * 新增 export（不在原契約裡）：覆寫這個模組內部讀寫進度時使用的 storage。
 * 生產程式碼不需要呼叫這個——不呼叫就是原本的真實 localStorage 行為。
 * 只有測試需要每個案例各自乾淨的 storage 時才呼叫，搭配
 * `src/progress/store.js` 匯出的 `createMemoryStorage()` 使用。
 * @param {{getItem:Function,setItem:Function}|undefined} storage
 * @returns {void}
 */
export function setProgressStorage(storage) {
  storageOverride = storage;
}

function getProgress() {
  return loadProgress(storageOverride);
}

function persistProgress(progress) {
  saveProgress(progress, storageOverride);
}

function ensureLevelProgress(progress, themeId, key) {
  const progressKey = progressLevelKey(themeId, key);
  if (!progress.levels[progressKey]) {
    progress.levels[progressKey] = {
      themeId,
      tier: key,
      attempts: 0,
      correctCount: 0,
      bestAccuracy: 0,
      bestStars: 0,
      completed: false,
      wordProgress: {},
      lastPlayedAt: null,
    };
  }
  return progress.levels[progressKey];
}

function loadQuestion(session) {
  const entry = session.words[session.currentIndex];
  session.slots = new Array(entry.word.length).fill(null);
  session.tiles = buildTileSet(entry.word, session.distractorCount, getFullWordBank());
  session.attemptsThisWord = 0;
  session.hintUsedThisWord = false;
  session.hintSlotIndex = null;
  session.locked = false;
  session.awaitingNext = false;
}

/**
 * @param {string} themeId
 * @param {string} levelKey
 * @returns {import('./index.js').GameSession}
 */
export function startLevel(themeId, levelKey) {
  const key = String(levelKey);
  const def = getLevelDefsForTheme(themeId).find((d) => d.key === key);
  const distractorCount = def ? def.distractorCount : 0;
  const words = shuffleArray(getWordsForLevel(themeId, key));

  const session = {
    themeId,
    levelKey: key,
    distractorCount,
    words,
    currentIndex: 0,
    correctCount: 0,
    firstTryCorrect: 0,
    totalWrongAttempts: 0,
    attemptsThisWord: 0,
    locked: false,
    awaitingNext: false,
    hintUsedThisWord: false,
    hintSlotIndex: null,
    slots: [],
    tiles: [],
  };

  if (words.length > 0) loadQuestion(session);
  return session;
}

/**
 * @param {import('./index.js').GameSession} session
 * @returns {{
 *   index:number, total:number, entry:import('./index.js').WordEntry,
 *   tiles:Array<{id:string,letter:string,used:boolean}>,
 *   slotCount:number,
 *   syllableGroupSizes:number[]|null,
 *   awaitingNext:boolean,
 *   locked:boolean,
 *   slots:Array<{tileId:string|null, letter:string|null, hinted:boolean}>
 * }} `tiles[].used` 跟頂層 `slots` 是新增欄位（不在原契約定義裡）——見本檔開頭
 *   的「跟一代的差異」說明；原契約的 `tiles` 只有 `id`/`letter`，且完全沒有
 *   任何欄位描述「每個槽位目前填了什麼」，UI 需要這兩個才能畫出填字進度與
 *   提示高亮，此處以加法方式補上。
 */
export function getCurrentQuestionView(session) {
  const entry = session.words[session.currentIndex];
  const syllableGroupSizes =
    entry && entry.syllables && entry.syllables.length > 1 ? entry.syllables.map((s) => s.length) : null;

  return {
    index: session.currentIndex,
    total: session.words.length,
    entry,
    tiles: session.tiles.map((t) => ({ id: t.tileId, letter: t.letter, used: t.used })),
    slotCount: session.slots.length,
    syllableGroupSizes,
    awaitingNext: session.awaitingNext,
    locked: session.locked,
    // 新增欄位（不在原契約定義裡）：契約只給了 slotCount（槽位數量），沒有給
    // 「每個槽位目前填了哪個字母/是不是被提示鎖定」，UI 沒有這個就畫不出填字
    // 進度與提示高亮，所以額外補上 `slots`（不影響任何既有欄位）。
    slots: session.slots.map((tileId, idx) => ({
      tileId,
      letter: tileId ? session.tiles.find((t) => t.tileId === tileId).letter : null,
      hinted: idx === session.hintSlotIndex,
    })),
  };
}

/**
 * 把某個字母方塊放進「目前第一個空槽」。
 * @param {import('./index.js').GameSession} session
 * @param {string} tileId
 * @returns {{slotIndex:number}|null} session 為 locked、tileId 不存在/已用過、
 *   或已經沒有空槽時回傳 null 且不做任何事
 */
export function placeLetterInSlot(session, tileId) {
  if (session.locked) return null;
  const tile = session.tiles.find((t) => t.tileId === tileId);
  if (!tile || tile.used) return null;
  const emptyIndex = session.slots.findIndex((s) => s === null);
  if (emptyIndex === -1) return null;
  session.slots[emptyIndex] = tileId;
  tile.used = true;
  return { slotIndex: emptyIndex };
}

/**
 * 移除「最後一個已填槽位」（槽位固定左到右依序填入，最後一個已填槽位＝最後
 * 輸入的字母）；已被提示鎖定的槽位不能移除。
 * @param {import('./index.js').GameSession} session
 * @returns {{slotIndex:number}|null}
 */
export function removeLastLetter(session) {
  if (session.locked) return null;
  for (let i = session.slots.length - 1; i >= 0; i--) {
    if (session.slots[i] !== null) {
      if (i === session.hintSlotIndex) return null;
      const tileId = session.slots[i];
      const tile = session.tiles.find((t) => t.tileId === tileId);
      tile.used = false;
      session.slots[i] = null;
      return { slotIndex: i };
    }
  }
  return null;
}

/**
 * 檢查目前答案槽位是否已全部填滿且拼對。槽位還沒填滿時回傳
 * `{correct:false, entry}` 且不產生任何副作用（不鎖 session、不計入嘗試次數、
 * 不寫入進度）——由呼叫端（UI）自己決定「填滿才呼叫這個」的時機。
 *
 * 槽位填滿、真正判定這一次嘗試時，會立刻把這次嘗試寫進 `src/progress`
 * （跟一代 `recordAnswer()` 同樣的 timing，逐題持久化，見檔案開頭說明）。
 * @param {import('./index.js').GameSession} session
 * @returns {{correct:boolean, entry:import('./index.js').WordEntry}}
 */
export function checkAnswer(session) {
  const entry = session.words[session.currentIndex];
  const allFilled = session.slots.every((s) => s !== null);
  if (!allFilled) return { correct: false, entry };

  session.locked = true;
  session.attemptsThisWord++;
  const filled = session.slots
    .map((tileId) => session.tiles.find((t) => t.tileId === tileId).letter)
    .join('');
  const isCorrect = filled === entry.word;

  if (isCorrect) {
    if (session.attemptsThisWord === 1 && !session.hintUsedThisWord) session.firstTryCorrect++;
    session.correctCount++;
    session.awaitingNext = true;
  } else {
    session.totalWrongAttempts++;
  }

  // 逐題持久化：立刻讀出目前進度、更新這一題的 attempts/correctCount/
  // wordProgress、馬上寫回去——跟一代 `recordAnswer()` 一樣的 timing，
  // 不等到 `finishLevel()` 才一次性 flush。
  const progress = getProgress();
  const lp = ensureLevelProgress(progress, session.themeId, session.levelKey);
  lp.attempts++;
  if (isCorrect) lp.correctCount++;
  const wp = lp.wordProgress[entry.id] || (lp.wordProgress[entry.id] = { correct: 0, wrong: 0 });
  wp[isCorrect ? 'correct' : 'wrong']++;
  lp.lastPlayedAt = new Date().toISOString();
  progress.lastPlayedAt = lp.lastPlayedAt;
  persistProgress(progress);

  return { correct: isCorrect, entry };
}

/**
 * 新增 export（不在原契約裡）：答錯後，UI 播完「搖晃」動畫要呼叫這個才真的清空
 * 槽位、解鎖讓玩家重試——對應一代 `resetSlotsKeepTiles()`（已提示的槽位在重試時
 * 保留，不然等於白花了唯一一次提示機會）。
 * @param {import('./index.js').GameSession} session
 * @returns {void}
 */
export function resetForRetry(session) {
  session.locked = false;
  session.slots = session.slots.map((tileId, idx) => (idx === session.hintSlotIndex ? tileId : null));
  const hintedTileId = session.hintSlotIndex !== null ? session.slots[session.hintSlotIndex] : null;
  session.tiles.forEach((t) => {
    t.used = t.tileId === hintedTileId;
  });
}

/**
 * 提示安全閥：自動填入下一個空槽的正確字母，每題限用一次，用過會讓這題的
 * 星等被封頂(見 `finishLevel` 的 stars 計算:不算 first-try-correct,且視同
 * 一次錯誤嘗試)。
 * @param {import('./index.js').GameSession} session
 * @returns {{tileId:string, slotIndex:number}|null} null 代表這題已經用過提示、
 *   session 為 locked、或槽位已滿
 */
export function useHint(session) {
  if (session.locked || session.hintUsedThisWord) return null;
  const emptyIndex = session.slots.findIndex((s) => s === null);
  if (emptyIndex === -1) return null;
  const entry = session.words[session.currentIndex];
  const neededLetter = entry.word[emptyIndex];
  const tile = session.tiles.find((t) => !t.used && t.letter === neededLetter);
  if (!tile) return null;

  session.hintUsedThisWord = true;
  session.hintSlotIndex = emptyIndex;
  session.totalWrongAttempts++;
  session.slots[emptyIndex] = tile.tileId;
  tile.used = true;

  return { tileId: tile.tileId, slotIndex: emptyIndex };
}

/**
 * 只有在 `awaitingNext`（答對、等玩家按下一題/空白鍵）狀態下才會真的前進，
 * 對應一代 `proceedFromCorrect()` 的 `if (!gameState.awaitingNext) return;` guard——
 * 沒有這個 guard 的話，UI 把空白鍵處理常駐掛在 keydown 上時，題目做到一半按到
 * 空白鍵會被誤判成「跳過這題」。
 * @param {import('./index.js').GameSession} session
 * @returns {{finished:boolean}}
 */
export function advanceToNextQuestion(session) {
  if (!session.awaitingNext) return { finished: false };
  session.currentIndex++;
  if (session.currentIndex >= session.words.length) {
    return { finished: true };
  }
  loadQuestion(session);
  return { finished: false };
}

/** 一代 `calcStars()`：提示視同 non-first-try，所以 firstTryCorrect 已經把用過
 * 提示的題目排除在外，這裡只需要再檢查 wrongAttempts（含提示計入的那一次）
 * 是否為 0，用來區分「全對」跟「3 星」。 */
function calcStars(firstTryCorrect, total, wrongAttempts) {
  if (total === 0) return 0;
  const accuracy = firstTryCorrect / total;
  if (accuracy === 1 && wrongAttempts === 0) return 3;
  if (accuracy >= 0.8) return 2;
  if (accuracy >= 0.5) return 1;
  return 0;
}

/**
 * 關卡結束時呼叫：計算星等（使用過提示的題目視同 non-first-try）、把
 * bestAccuracy/bestStars/completed（這些「整關結束才知道」的欄位——逐題的
 * attempts/correctCount/wordProgress 在 `checkAnswer()` 時就已經寫入了，見
 * 檔案開頭「進度持久化」說明）寫進 `src/progress`（`saveProgress`，星等/正確率
 * 只升不降），並回傳這關是不是第一次拿到 3 星。
 * @param {import('./index.js').GameSession} session
 * @returns {{stars:number, accuracy:number, isNewSticker:boolean}}
 */
export function finishLevel(session) {
  const total = session.words.length;
  const accuracy = total > 0 ? session.firstTryCorrect / total : 0;
  const stars = calcStars(session.firstTryCorrect, total, session.totalWrongAttempts);
  const key = progressLevelKey(session.themeId, session.levelKey);

  const progress = getProgress();
  const lp = ensureLevelProgress(progress, session.themeId, session.levelKey);

  // 一定要在覆寫 bestStars 之前先讀出舊值，不然下面判斷「是不是第一次三星」
  // 會讀到這次剛寫入的新分數，永遠判斷成 true。
  const prevBestStars = lp.bestStars;

  lp.bestAccuracy = Math.max(lp.bestAccuracy, accuracy);
  lp.bestStars = Math.max(lp.bestStars, stars);
  lp.completed = true;
  lp.lastPlayedAt = new Date().toISOString();

  progress.lastPlayedAt = lp.lastPlayedAt;

  const isNewSticker = stars === 3 && prevBestStars < 3 && !progress.collectibles[key];
  if (isNewSticker) progress.collectibles[key] = true;

  persistProgress(progress);

  return { stars, accuracy, isNewSticker };
}
