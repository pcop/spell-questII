// v1 -> v2 進度資料遷移。
//
// 這一版遷移本質上就是「schemaVersion 改成 2 + 補齊缺欄位」，
// 沒有任何跟遷移無關的資料轉換邏輯——v2 目前是 v1 的加法延伸（見 schema.js）。
//
// 設計上刻意讓這個函式對「已經是 v2 形狀」的輸入也安全（冪等）：
// 呼叫端（store.js）只會在讀到舊 key 時呼叫它，但測試/未來呼叫端如果不小心
// 對已經遷移過的資料重複呼叫，也不應該遺失或竄改資料。

import { SCHEMA_VERSION, DEFAULT_SETTINGS } from './schema.js';

/**
 * 深複製一份純資料物件（progress 裡不會有 function/Date 等非 JSON 型別）。
 * @param {any} value
 */
function cloneData(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * 把一代（v1，或缺欄位的更早期存檔）的進度資料轉成 v2 shape。
 *
 * 處理的邊界情況：
 * - `collectibles` 整個欄位不存在（貼紙功能加入前的存檔）-> 補一個空物件。
 * - `settings` 缺欄位或整個不存在 -> 用一代預設值 `{hintMode:'both', soundEnabled:true, speechRate:0.8}` 補齊，
 *   已存在的欄位保留使用者原本的設定，不覆蓋。
 * - `levels` 不存在 -> 補一個空物件（正常 v1 資料不會發生，但避免對更早期/損毀資料丟出例外）。
 * - `levels[key].wordProgress` 不存在 -> 補一個空物件，內容保留原有的 correct/wrong 計數，不重算。
 * - 輸入已經是 v2 形狀（schemaVersion === 2）-> 原樣正規化後回傳，不會被破壞（冪等）。
 *
 * @param {object} v1Data - v1（或缺欄位的更早期）進度資料，假設已經是一個物件（呼叫端負責基本型別檢查）。
 * @returns {import('./schema.js').ProgressV2}
 */
export function migrateV1ToV2(v1Data) {
  const source = v1Data && typeof v1Data === 'object' ? v1Data : {};

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(source.settings && typeof source.settings === 'object' ? cloneData(source.settings) : {}),
  };

  const sourceLevels = source.levels && typeof source.levels === 'object' ? source.levels : {};
  const levels = {};
  for (const key of Object.keys(sourceLevels)) {
    const lvl = sourceLevels[key] || {};
    levels[key] = {
      ...cloneData(lvl),
      wordProgress:
        lvl.wordProgress && typeof lvl.wordProgress === 'object' ? cloneData(lvl.wordProgress) : {},
    };
  }

  const collectibles =
    source.collectibles && typeof source.collectibles === 'object' ? cloneData(source.collectibles) : {};

  // 先展開整份來源資料（保留像 app.js 會寫入的根層級 lastPlayedAt 這類「README 沒寫
  // 但實際存檔會有」的欄位，或任何未來欄位），再蓋掉四個需要正規化的欄位。
  // 這樣遷移/正規化不會意外把不在這份 schema 明確列出的資料弄丟。
  return {
    ...cloneData(source),
    schemaVersion: SCHEMA_VERSION,
    settings,
    levels,
    collectibles,
  };
}
