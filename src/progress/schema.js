// 進度資料 schema v2 定義。
//
// v2 是 v1 的「加法延伸」——目前所有既有欄位的語意完全照抄一代
// （見 /DomainUserHome/rachen/WorkDir/拼字遊戲/README.md「進度資料格式」、
// CLAUDE.md「Progress persistence」），沒有任何欄位被重新定義或移除。
// schemaVersion 從 1 升到 2 純粹是為了讓 migrate.js／store.js 能明確分辨
// 「這份資料有沒有跑過遷移」，不是因為資料形狀有語意上的破壞性改動。
//
// v1 shape（供對照，來自一代）：
// {
//   schemaVersion: 1,
//   settings: { hintMode: 'both'|'letter'|'off', soundEnabled: true, speechRate: 0.8 },
//   levels: {
//     '<themeId>_<tier>': {
//       themeId: string, tier: number | string,   // tier 是 opaque key，可能是數字分級或自訂關卡字串 id
//       attempts: number, correctCount: number,
//       bestAccuracy: number,       // 0~1，只升不降
//       bestStars: number,          // 0~3，只升不降
//       completed: boolean,
//       wordProgress: { '<wordId>': { correct: number, wrong: number } },
//       lastPlayedAt: string | null // ISO timestamp
//     }
//   },
//   collectibles: { '<themeId>_<tier>': true }  // 舊存檔可能整個欄位不存在
// }

/**
 * @typedef {Object} SettingsV2
 * @property {'image'|'audio'|'both'} hintMode - 對應一代 index.html 的三個提示模式按鈕
 * @property {boolean} soundEnabled
 * @property {number} speechRate
 * @property {'phonics'|'letter'|'cat'} [tileSound] - 方塊音效模式：自然發音（預設）、字母名稱、貓咪叫聲
 */

/**
 * @typedef {Object} WordProgressEntryV2
 * @property {number} correct
 * @property {number} wrong
 * // Phase 3 會用到：錯題本／間隔重複只讀這兩個既有欄位算「該不該多考」，
 * // 這裡先不新增欄位，等 Phase 3 真的需要排程資訊（例如 nextReviewAt）時再加，
 * // 避免 Phase 0 就臆測還沒設計好的複習演算法需要什麼資料。
 */

/**
 * @typedef {Object} LevelProgressV2
 * @property {string} themeId
 * @property {number|string} tier - opaque key，不假設是數字
 * @property {number} attempts
 * @property {number} correctCount
 * @property {number} bestAccuracy - 0~1，只升不降
 * @property {number} bestStars - 0~3，只升不降
 * @property {boolean} completed
 * @property {Object<string, WordProgressEntryV2>} wordProgress
 * @property {string|null} lastPlayedAt
 */

/**
 * @typedef {Object} ProgressV2
 * @property {2} schemaVersion
 * @property {SettingsV2} settings
 * @property {Object<string, LevelProgressV2>} levels - key 格式為 `${themeId}_${tier}`
 * @property {Object<string, boolean>} collectibles - key 格式跟 levels 相同
 * @property {string|null} [lastPlayedAt] - 一代 app.js 有寫入的根層級欄位（最後一次答題時間，
 *   跟 README 記載的 shape 不完全一致，但既有存檔可能帶著這個欄位，遷移時要保留，不能因為
 *   README 沒寫就被當成「未知欄位」丟棄）
 */

export const SCHEMA_VERSION = 2;

/** 照抄一代 defaultProgress() 的預設值，擴充 tileSound */
export const DEFAULT_SETTINGS = Object.freeze({
  hintMode: 'both',
  soundEnabled: true,
  speechRate: 0.8,
  tileSound: 'phonics',
});

/**
 * 建立一份全新的空 v2 進度物件（沒有任何存檔時使用）。
 * @returns {ProgressV2}
 */
export function createDefaultProgress() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    levels: {},
    collectibles: {},
  };
}

/**
 * levels/collectibles 的 key 組法，跟一代 levelKey() 相同：`${themeId}_${tier}`。
 * tier 當成 opaque string 處理，不假設是數字。
 * @param {string} themeId
 * @param {number|string} tier
 * @returns {string}
 */
export function levelKey(themeId, tier) {
  return `${themeId}_${tier}`;
}
