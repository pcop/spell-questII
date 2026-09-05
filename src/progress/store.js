// 進度資料的讀寫層：負責 localStorage 存取、v1->v2 一次性遷移、匯出/匯入。
//
// 設計成純函式風格（不持有模組層級的「目前進度」單例）：呼叫端（之後的
// game/ui 模組）自己持有一份進度物件在記憶體裡，答題時呼叫 saveProgress(data)
// 寫回去，這樣單元測試不需要真的模擬一份「全域遊戲狀態」。
//
// 每個函式都接受一個可選的 `storage` 參數（預設用真正的 localStorage，
// 環境沒有 localStorage 時退回一個記憶體實作），方便測試注入乾淨的假 storage，
// 不會互相污染。

import { createDefaultProgress } from './schema.js';
import { migrateV1ToV2 } from './migrate.js';

export const STORAGE_KEY_V2 = 'spelling_game_progress_v2';
export const STORAGE_KEY_V1 = 'spelling_game_progress_v1';

/**
 * 建立一份記憶體版的 storage（跟 localStorage 同樣的 getItem/setItem 介面）。
 * 給測試、或執行環境沒有 localStorage 時使用。
 */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

// 真實環境找不到 localStorage 時（例如目前的 vitest node 環境）的最後備援，
// 只在同一個 process 內存在，僅供沒有特別注入 storage 的呼叫使用。
let fallbackStorage = null;

function getDefaultStorage() {
  if (typeof localStorage !== 'undefined' && localStorage) {
    return localStorage;
  }
  if (!fallbackStorage) fallbackStorage = createMemoryStorage();
  return fallbackStorage;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 跟一代 loadProgress()/importProgressFile() 同等的格式驗證：
 * 拒絕格式不符的資料，而不是把它硬塞進去清掉既有進度。
 * 接受 v1（schemaVersion 1）或 v2（schemaVersion 2）形狀。
 */
function isValidProgressShape(parsed) {
  if (!isPlainObject(parsed)) return false;
  if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) return false;
  if (!isPlainObject(parsed.levels)) return false;
  if (parsed.settings !== undefined && !isPlainObject(parsed.settings)) return false;
  if (parsed.collectibles !== undefined && !isPlainObject(parsed.collectibles)) return false;
  return true;
}

/**
 * 讀取目前的進度。順序：
 * 1. 讀新 key（v2）。
 * 2. 讀不到才讀舊 key（v1），讀到的話遷移成 v2 並存回新 key（一次性遷移，之後都讀新 key）。
 * 3. 都讀不到（或內容損毀/格式不符）回傳一份全新的預設 v2 進度。
 *
 * @param {{getItem: Function, setItem: Function}} [storage]
 * @returns {import('./schema.js').ProgressV2}
 */
export function loadProgress(storage = getDefaultStorage()) {
  try {
    const rawV2 = storage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (isValidProgressShape(parsed)) {
        // 用 migrateV1ToV2 正規化一次（對 v2 資料是安全的冪等操作），
        // 防禦性地補齊萬一手動編輯造成的缺欄位。
        return migrateV1ToV2(parsed);
      }
    }
  } catch (err) {
    // 新 key 內容損毀（例如手動編輯壞掉的 JSON），當作沒有新版存檔，繼續往下試舊 key。
  }

  try {
    const rawV1 = storage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const parsedV1 = JSON.parse(rawV1);
      if (isValidProgressShape(parsedV1)) {
        const migrated = migrateV1ToV2(parsedV1);
        saveProgress(migrated, storage);
        return migrated;
      }
    }
  } catch (err) {
    // 舊 key 內容損毀，視同沒有可遷移的資料。
  }

  return createDefaultProgress();
}

/**
 * 把進度資料存回新 key（v2）。
 * @param {import('./schema.js').ProgressV2} data
 * @param {{getItem: Function, setItem: Function}} [storage]
 * @returns {boolean} 是否成功寫入
 */
export function saveProgress(data, storage = getDefaultStorage()) {
  try {
    storage.setItem(STORAGE_KEY_V2, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('無法儲存進度', err);
    return false;
  }
}

/**
 * 匯出目前的進度為 JSON 字串（「我的進度」頁面下載檔案時用這份字串產生 Blob，
 * 觸發下載的 DOM 操作留給之後的 UI 層，這裡只負責純資料序列化）。
 * @param {{getItem: Function, setItem: Function}} [storage]
 * @returns {string}
 */
export function exportProgress(storage = getDefaultStorage()) {
  const data = loadProgress(storage);
  return JSON.stringify(data, null, 2);
}

/**
 * 匯入一份進度 JSON（字串或已解析的物件），跟一代同等的格式防呆：
 * 格式不符（不是合法 JSON、缺必要欄位、型別錯誤）一律拒絕匯入，
 * 不會動到目前已存在的進度。同時接受匯入 v1 格式（會先跑一次遷移）或 v2 格式。
 *
 * @param {string|object} json
 * @param {{getItem: Function, setItem: Function}} [storage]
 * @returns {{ok: true, data: import('./schema.js').ProgressV2} | {ok: false, error: string}}
 */
export function importProgress(json, storage = getDefaultStorage()) {
  let parsed;
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (err) {
    return { ok: false, error: '匯入失敗：檔案格式不正確（不是合法的 JSON）' };
  }

  if (!isValidProgressShape(parsed)) {
    return { ok: false, error: '匯入失敗：檔案格式不正確' };
  }

  // migrateV1ToV2 對 v1、v2 兩種輸入都安全（v2 輸入等同一次正規化，冪等）。
  const migrated = migrateV1ToV2(parsed);
  saveProgress(migrated, storage);
  return { ok: true, data: migrated };
}
