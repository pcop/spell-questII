// tests/data-consistency.test.js
//
// Phase 0 資料一致性測試——把一代全靠人工檢查的資料規則變成 CI 能擋的自動化測試。
// 規則來源：一代 `拼字遊戲/CLAUDE.md` 的「Content model」段落。
//
// 檢查項目：
// 1. phonics.chunks 串接 === word
// 2. syllables（選填）串接 === word（若存在）
// 3. zh 欄位存在且非空字串
// 4. theme 對應到 themes[].id 之一
// 5. emoji 為 null 時必須有 swatch（十六進位色碼）
// 6. words-audio/<word>.mp3 存在
// 7. phonics-audio/<chunk 或 audioOverrides 指定的虛擬 chunk id>.mp3 存在

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import data from '../src/data/data.json';

const { wordBank, themes } = data;

const themeIds = new Set(themes.map((t) => t.id));

const wordsAudioDir = path.join(__dirname, '../public/words-audio');
const phonicsAudioDir = path.join(__dirname, '../public/phonics-audio');

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

describe('data-consistency: wordBank 基本結構', () => {
  it('wordBank 應為非空陣列', () => {
    expect(Array.isArray(wordBank)).toBe(true);
    expect(wordBank.length).toBeGreaterThan(0);
  });
});

describe('data-consistency: phonics.chunks 串接必須等於 word', () => {
  it('每個項目的 phonics.chunks.join("") 應等於 word', () => {
    const offenders = wordBank
      .filter((entry) => {
        const chunks = entry.phonics && entry.phonics.chunks;
        if (!Array.isArray(chunks)) return true; // 缺少必要欄位也算違規
        return chunks.join('') !== entry.word;
      })
      .map((entry) => ({
        id: entry.id,
        word: entry.word,
        chunks: entry.phonics && entry.phonics.chunks,
      }));

    expect(offenders).toEqual([]);
  });
});

describe('data-consistency: syllables（選填）串接必須等於 word', () => {
  it('有 syllables 欄位的項目，syllables.join("") 應等於 word', () => {
    const offenders = wordBank
      .filter((entry) => Array.isArray(entry.syllables))
      .filter((entry) => entry.syllables.join('') !== entry.word)
      .map((entry) => ({ id: entry.id, word: entry.word, syllables: entry.syllables }));

    expect(offenders).toEqual([]);
  });
});

describe('data-consistency: zh 欄位必須存在且非空字串', () => {
  it('每個項目都應該有非空的 zh 欄位', () => {
    const offenders = wordBank
      .filter((entry) => typeof entry.zh !== 'string' || entry.zh.trim() === '')
      .map((entry) => ({ id: entry.id, word: entry.word, zh: entry.zh }));

    expect(offenders).toEqual([]);
  });
});

describe('data-consistency: theme 必須對應到 themes[].id 之一', () => {
  it('每個項目的 theme 都應該存在於 themes 清單中', () => {
    const offenders = wordBank
      .filter((entry) => !themeIds.has(entry.theme))
      .map((entry) => ({ id: entry.id, word: entry.word, theme: entry.theme }));

    expect(offenders).toEqual([]);
  });
});

describe('data-consistency: emoji 為 null 時必須有合法 swatch', () => {
  it('emoji === null 的項目必須有十六進位色碼的 swatch 欄位', () => {
    const offenders = wordBank
      .filter((entry) => entry.emoji === null)
      .filter((entry) => typeof entry.swatch !== 'string' || !HEX_COLOR_RE.test(entry.swatch))
      .map((entry) => ({ id: entry.id, word: entry.word, swatch: entry.swatch }));

    expect(offenders).toEqual([]);
  });
});

describe('data-consistency: 每個 word 都應該有對應的 words-audio 音檔', () => {
  it('public/words-audio/<word>.mp3 應該存在', () => {
    const offenders = wordBank
      .filter((entry) => !fs.existsSync(path.join(wordsAudioDir, `${entry.word}.mp3`)))
      .map((entry) => ({ id: entry.id, word: entry.word, expectedFile: `${entry.word}.mp3` }));

    expect(offenders).toEqual([]);
  });
});

describe('data-consistency: 每個 phonics chunk 都應該有對應的 phonics-audio 音檔', () => {
  it('public/phonics-audio/<chunk 或 audioOverrides 虛擬 chunk id>.mp3 應該存在', () => {
    const offenders = [];

    for (const entry of wordBank) {
      const chunks = (entry.phonics && entry.phonics.chunks) || [];
      const audioOverrides = (entry.phonics && entry.phonics.audioOverrides) || {};

      chunks.forEach((chunk, index) => {
        const override = audioOverrides[String(index)];
        const audioName = override != null ? override : chunk;
        const audioPath = path.join(phonicsAudioDir, `${audioName}.mp3`);

        if (!fs.existsSync(audioPath)) {
          offenders.push({
            id: entry.id,
            word: entry.word,
            chunkIndex: index,
            chunk,
            override: override ?? null,
            expectedFile: `${audioName}.mp3`,
          });
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe('data-consistency: cat-sfx 音檔必須存在且非空', () => {
  it('public/cat-sfx/ 下的 cat1.mp3 ~ cat5.mp3 均存在且大小大於 0', () => {
    const catSfxDir = path.join(__dirname, '../public/cat-sfx');
    const cats = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'];
    cats.forEach((name) => {
      const p = path.join(catSfxDir, `${name}.mp3`);
      expect(fs.existsSync(p), `缺少 ${name}.mp3`).toBe(true);
      const stat = fs.statSync(p);
      expect(stat.size, `${name}.mp3 檔案大小為 0`).toBeGreaterThan(100);
    });
  });
});

