// 單字庫 / 主題 / 關卡定義 —— 搬自一代 app.js「Word bank helpers」段落
// （`getWordsForLevel`/`getLevelDefsForTheme`/`getValidLevelCombos`）。
//
// `getLevelDefsForTheme()` 是「唯一解析某主題有哪些關卡」的地方，
// `difficultyTiers`（長度分級）跟 `customLevels`（自訂關卡）都要處理，
// 且統一成同一種 LevelDef 形狀，UI 不需要知道背後是哪一種來源。

import wordBankData from '../data/data.json';

/** 一代 `MIN_WORDS_PER_LEVEL`：單字數不足這個數字的關卡自動停用。 */
export const MIN_WORDS_PER_LEVEL = 3;

const WORD_BANK = wordBankData.wordBank;
const THEMES = wordBankData.themes;
const DIFFICULTY_TIERS = wordBankData.difficultyTiers;

function findTheme(themeId) {
  return THEMES.find((t) => t.id === themeId);
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

  if (theme && theme.customLevels && theme.customLevels.length) {
    return theme.customLevels.map((lvl) => {
      const words = wordsForCustomLevel(lvl);
      const wordCount = words.length;
      return {
        key: String(lvl.id),
        label: `${lvl.label}（${wordCount} 字）`,
        distractorCount: lvl.distractorCount != null ? lvl.distractorCount : 2,
        wordCount,
        playable: wordCount >= MIN_WORDS_PER_LEVEL,
      };
    });
  }

  return DIFFICULTY_TIERS.map((tierDef) => {
    const words = wordsForTier(themeId, tierDef);
    const lenLabel = tierDef.minLen === tierDef.maxLen ? `${tierDef.minLen} 字母` : `${tierDef.minLen}+ 字母`;
    return {
      key: String(tierDef.tier),
      label: `${tierDef.label}（${lenLabel}）`,
      distractorCount: tierDef.distractorCount,
      wordCount: words.length,
      playable: words.length >= MIN_WORDS_PER_LEVEL,
    };
  });
}

/**
 * @returns {Array<{themeId:string, key:string}>}
 */
export function getValidLevelCombos() {
  const combos = [];
  THEMES.forEach((theme) => {
    getLevelDefsForTheme(theme.id).forEach((def) => {
      if (def.playable) combos.push({ themeId: theme.id, key: def.key });
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
