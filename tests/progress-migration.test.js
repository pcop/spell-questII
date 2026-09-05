import { describe, it, expect, beforeEach } from 'vitest';
import { migrateV1ToV2 } from '../src/progress/migrate.js';
import { createDefaultProgress, SCHEMA_VERSION } from '../src/progress/schema.js';
import {
  loadProgress,
  saveProgress,
  exportProgress,
  importProgress,
  createMemoryStorage,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
} from '../src/progress/store.js';

// 一份完整的一代 v1 存檔（含 collectibles），照抄 README/CLAUDE.md 的範例
function fullV1Fixture() {
  return {
    schemaVersion: 1,
    settings: { hintMode: 'both', soundEnabled: true, speechRate: 0.8 },
    levels: {
      animals_1: {
        themeId: 'animals',
        tier: 1,
        attempts: 12,
        correctCount: 10,
        bestAccuracy: 0.92,
        bestStars: 3,
        completed: true,
        wordProgress: { animal_cat: { correct: 3, wrong: 0 } },
      },
    },
    collectibles: { animals_1: true },
  };
}

describe('migrateV1ToV2', () => {
  it('完整 v1 資料（含 collectibles）正確轉成 v2，內容不失真', () => {
    const v1 = fullV1Fixture();
    const v2 = migrateV1ToV2(v1);

    expect(v2.schemaVersion).toBe(2);
    expect(v2.schemaVersion).toBe(SCHEMA_VERSION);
    expect(v2.settings).toEqual({ hintMode: 'both', soundEnabled: true, speechRate: 0.8 });
    expect(v2.collectibles).toEqual({ animals_1: true });

    const lvl = v2.levels.animals_1;
    expect(lvl.themeId).toBe('animals');
    expect(lvl.tier).toBe(1);
    expect(lvl.attempts).toBe(12);
    expect(lvl.correctCount).toBe(10);
    expect(lvl.bestAccuracy).toBe(0.92);
    expect(lvl.bestStars).toBe(3);
    expect(lvl.completed).toBe(true);
    expect(lvl.wordProgress).toEqual({ animal_cat: { correct: 3, wrong: 0 } });

    // 遷移是複製，不應該共用參照（避免之後改動輸出意外改到輸入）
    expect(v2.levels).not.toBe(v1.levels);
    expect(v2.levels.animals_1.wordProgress).not.toBe(v1.levels.animals_1.wordProgress);
  });

  it('缺 collectibles 欄位的舊版 v1 資料補上空物件，不拋錯', () => {
    const v1 = fullV1Fixture();
    delete v1.collectibles;

    expect(() => migrateV1ToV2(v1)).not.toThrow();
    const v2 = migrateV1ToV2(v1);
    expect(v2.collectibles).toEqual({});
    expect(v2.schemaVersion).toBe(2);
    // levels 內容仍然保留
    expect(v2.levels.animals_1.correctCount).toBe(10);
  });

  it('settings 缺欄位時補一代預設值，已存在的欄位保留使用者原本設定', () => {
    const v1 = fullV1Fixture();
    v1.settings = { soundEnabled: false }; // 只有這個欄位，其餘缺漏

    const v2 = migrateV1ToV2(v1);
    expect(v2.settings).toEqual({ hintMode: 'both', soundEnabled: false, speechRate: 0.8 });
  });

  it('settings/levels/collectibles 整個不存在時也不拋錯，補上合理預設', () => {
    const bare = { schemaVersion: 1 };
    expect(() => migrateV1ToV2(bare)).not.toThrow();
    const v2 = migrateV1ToV2(bare);
    expect(v2.schemaVersion).toBe(2);
    expect(v2.levels).toEqual({});
    expect(v2.collectibles).toEqual({});
    expect(v2.settings).toEqual({ hintMode: 'both', soundEnabled: true, speechRate: 0.8 });
  });

  it('保留 README 沒寫但一代 app.js 實際會寫入的根層級欄位（例如 lastPlayedAt），不當成未知欄位丟棄', () => {
    const v1 = fullV1Fixture();
    v1.lastPlayedAt = '2024-01-01T00:00:00.000Z'; // app.js 213-271 行：答題後會寫這個根層級欄位

    const v2 = migrateV1ToV2(v1);
    expect(v2.lastPlayedAt).toBe('2024-01-01T00:00:00.000Z');

    // 而且要在 saveProgress -> loadProgress 的完整流程中也不遺失
    // （loadProgress 每次讀取都會再跑一次 migrateV1ToV2 正規化）
    const storage = createMemoryStorage();
    saveProgress(v2, storage);
    const reloaded = loadProgress(storage);
    expect(reloaded.lastPlayedAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('已經是 v2 的資料丟進去不會被破壞（冪等）', () => {
    const v1 = fullV1Fixture();
    const onceMigrated = migrateV1ToV2(v1);
    const twiceMigrated = migrateV1ToV2(onceMigrated);
    expect(twiceMigrated).toEqual(onceMigrated);
  });
});

describe('store: loadProgress / saveProgress', () => {
  let storage;
  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it('沒有任何存檔時回傳全新的預設 v2 進度', () => {
    const progress = loadProgress(storage);
    expect(progress).toEqual(createDefaultProgress());
  });

  it('只有舊 key（v1）時，讀取後自動遷移並存回新 key（一次性遷移）', () => {
    storage.setItem(STORAGE_KEY_V1, JSON.stringify(fullV1Fixture()));

    const progress = loadProgress(storage);
    expect(progress.schemaVersion).toBe(2);
    expect(progress.levels.animals_1.correctCount).toBe(10);
    expect(progress.collectibles).toEqual({ animals_1: true });

    // 新 key 應該已經被寫入，之後都讀新 key
    const rawV2 = storage.getItem(STORAGE_KEY_V2);
    expect(rawV2).toBeTruthy();
    expect(JSON.parse(rawV2).schemaVersion).toBe(2);
  });

  it('已經有新 key（v2）時直接讀新 key，不去看舊 key', () => {
    const v2Data = { ...createDefaultProgress(), levels: { foo_1: { themeId: 'foo', tier: 1, attempts: 1, correctCount: 1, bestAccuracy: 1, bestStars: 1, completed: true, wordProgress: {} } } };
    storage.setItem(STORAGE_KEY_V2, JSON.stringify(v2Data));
    // 故意放一個不同的舊 key 內容，確認不會被拿來覆蓋
    storage.setItem(STORAGE_KEY_V1, JSON.stringify(fullV1Fixture()));

    const progress = loadProgress(storage);
    expect(progress.levels.foo_1).toBeTruthy();
    expect(progress.levels.animals_1).toBeUndefined();
  });

  it('saveProgress 之後 loadProgress 可以讀回同樣的資料（round-trip）', () => {
    const data = migrateV1ToV2(fullV1Fixture());
    saveProgress(data, storage);
    const loaded = loadProgress(storage);
    expect(loaded).toEqual(data);
  });
});

describe('store: exportProgress / importProgress', () => {
  let storage;
  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it('exportProgress 回傳目前進度的 JSON 字串，能被 JSON.parse 還原', () => {
    const data = migrateV1ToV2(fullV1Fixture());
    saveProgress(data, storage);

    const json = exportProgress(storage);
    expect(typeof json).toBe('string');
    expect(JSON.parse(json)).toEqual(data);
  });

  it('importProgress 接受 v1 格式，遷移後存回新 key', () => {
    const result = importProgress(JSON.stringify(fullV1Fixture()), storage);
    expect(result.ok).toBe(true);
    expect(result.data.schemaVersion).toBe(2);
    expect(loadProgress(storage).levels.animals_1.correctCount).toBe(10);
  });

  it('importProgress 接受 v2 格式', () => {
    const v2 = migrateV1ToV2(fullV1Fixture());
    const result = importProgress(JSON.stringify(v2), storage);
    expect(result.ok).toBe(true);
    expect(result.data.schemaVersion).toBe(2);
  });

  it('importProgress 拒絕不是合法 JSON 的輸入，且不覆蓋現有進度', () => {
    const existing = migrateV1ToV2(fullV1Fixture());
    saveProgress(existing, storage);

    const result = importProgress('{not valid json', storage);
    expect(result.ok).toBe(false);
    expect(loadProgress(storage)).toEqual(existing);
  });

  it('importProgress 拒絕缺必要欄位（沒有 levels）的輸入，且不覆蓋現有進度', () => {
    const existing = migrateV1ToV2(fullV1Fixture());
    saveProgress(existing, storage);

    const malformed = { schemaVersion: 1, settings: {} }; // 缺 levels
    const result = importProgress(JSON.stringify(malformed), storage);
    expect(result.ok).toBe(false);
    expect(loadProgress(storage)).toEqual(existing);
  });

  it('importProgress 拒絕型別錯誤的輸入（levels 是字串而不是物件），且不覆蓋現有進度', () => {
    const existing = migrateV1ToV2(fullV1Fixture());
    saveProgress(existing, storage);

    const malformed = { schemaVersion: 1, levels: 'not-an-object', collectibles: {} };
    const result = importProgress(JSON.stringify(malformed), storage);
    expect(result.ok).toBe(false);
    expect(loadProgress(storage)).toEqual(existing);
  });

  it('importProgress 拒絕不明 schemaVersion 的輸入，且不覆蓋現有進度', () => {
    const existing = migrateV1ToV2(fullV1Fixture());
    saveProgress(existing, storage);

    const malformed = { schemaVersion: 99, levels: {} };
    const result = importProgress(JSON.stringify(malformed), storage);
    expect(result.ok).toBe(false);
    expect(loadProgress(storage)).toEqual(existing);
  });
});
