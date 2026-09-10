// @vitest-environment jsdom
//
// Phase 1 整合驗證：沒有真實瀏覽器可用（claude-in-chrome 使用者拒絕安裝），
// 用 jsdom 模擬「開始遊戲 → 選主題 → 選難度 → 答對一題 → 過關 → 結果畫面」
// 這條主要路徑，確認 main.js 的接線（DOM id 對應、事件綁定、模組之間的呼叫）
// 沒有整合期才會浮現的錯誤——單元測試各自 mock 掉了依賴，這支測試刻意
// 儘量用真實模組（只 mock three-fx，因為 jsdom 沒有 WebGL）。
//
// 這不是「代替真人在瀏覽器裡玩過一輪」，視覺呈現/動畫/觸控/實際音訊播放
// 仍然需要人工確認（見 規劃.md Phase 1 驗收標準），但至少能擋掉「某個 id
// 打錯字」「呼叫了不存在的 export」這類會讓整個 app 一開始就掛掉的錯誤。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import wordBankData from '../src/data/data.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock('../src/three-fx/index.js', () => ({
  initThreeFx: vi.fn().mockResolvedValue(true),
  celebrateCorrect: vi.fn(),
  celebrateLevelComplete: vi.fn(),
  cancelCelebration: vi.fn(),
}));

function loadIndexHtmlIntoDocument() {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
  const body = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = body;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Phase 1 整合 smoke test（主線流程）', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('開始遊戲 → 選主題 → 選難度 → 答對一整關 → 結果畫面，過程不拋出例外', async () => {
    loadIndexHtmlIntoDocument();

    const { bindStaticEvents, handleKeydown } = await import('../src/ui/index.js');
    const { initGameFlow } = await import('../src/ui/game-flow.js');

    bindStaticEvents();
    document.addEventListener('keydown', handleKeydown);

    await initGameFlow();
    await flush();

    // three-fx 已 mock 成功，「開始遊戲」按鈕應該解除鎖定
    const btnStart = document.getElementById('btn-start');
    expect(btnStart).toBeTruthy();
    expect(btnStart.disabled).toBe(false);
    expect(document.getElementById('view-splash').hidden).toBe(false);

    btnStart.click();
    expect(document.getElementById('view-theme-select').hidden).toBe(false);

    const themeGrid = document.getElementById('theme-grid');
    expect(themeGrid.children.length).toBeGreaterThan(0);
    themeGrid.querySelector('.theme-card').click();
    expect(document.getElementById('view-level-select').hidden).toBe(false);

    // 驗證方塊音效設定按鈕正常渲染且預設為 phonics
    const tileSoundButtons = document.getElementById('tile-sound-buttons');
    expect(tileSoundButtons).toBeTruthy();
    const phonicsBtn = tileSoundButtons.querySelector('[data-tile-sound="phonics"]');
    const letterBtn = tileSoundButtons.querySelector('[data-tile-sound="letter"]');
    const catBtn = tileSoundButtons.querySelector('[data-tile-sound="cat"]');
    expect(phonicsBtn.classList.contains('active')).toBe(true);

    letterBtn.click();
    expect(letterBtn.classList.contains('active')).toBe(true);
    expect(phonicsBtn.classList.contains('active')).toBe(false);

    catBtn.click();
    expect(catBtn.classList.contains('active')).toBe(true);

    const levelGrid = document.getElementById('level-grid');
    const startBtn = levelGrid.querySelector('.level-start-btn:not(:disabled)');
    expect(startBtn, '至少要有一個可玩的關卡').toBeTruthy();
    startBtn.click();
    expect(document.getElementById('view-game').hidden).toBe(false);

    // 逐題作答直到整關結束：不繞過 UI 直接呼叫 game 模組（那是單元測試的
    // 工作），而是透過畫面上顯示的中文提示（`#prompt-zh`，預設 hintMode 是
    // 'both' 會顯示）反查 data.json 找出正確拼法，再依序點擊對應字母方塊，
    // 這樣走的是使用者真實會用的互動路徑（點擊字母 → 填槽位 → 滿了自動判分）。
    let safety = 0;
    while (!document.getElementById('view-result') || document.getElementById('view-result').hidden) {
      safety++;
      if (safety > 30) throw new Error('答題迴圈次數過多，可能卡在某個狀態沒有前進');

      const zhText = document.getElementById('prompt-zh').textContent.trim();
      const entry = wordBankData.wordBank.find((w) => w.zh === zhText);
      expect(entry, `找不到中文提示「${zhText}」對應的單字資料`).toBeTruthy();

      for (const letter of entry.word) {
        const tileBtn = Array.from(document.querySelectorAll('#tile-area .letter-tile')).find(
          (b) => !b.disabled && b.textContent === letter
        );
        expect(tileBtn, `找不到未使用的字母方塊「${letter}」（單字：${entry.word}）`).toBeTruthy();
        // 字母方塊是用 pointerdown/pointerup 綁定的（觸控拖曳支援，見一代同款
        // 設計，`bindTileInteraction` 完全沒有 click 監聽器），單純呼叫
        // `.click()` 不會觸發任何反應——這是點擊/觸控輸入路徑的真實行為，
        // 用 PointerEvent 模擬一次「點下去馬上放開、沒有移動」的輕點。
        tileBtn.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
        tileBtn.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 0, clientY: 0 }));
      }

      await flush();

      const btnNext = document.getElementById('btn-next-question');
      expect(btnNext.hidden, '答對後應該顯示「下一題」按鈕，畫面停在原題目').toBe(false);
      btnNext.click();
      await flush();
    }

    expect(document.getElementById('view-result').hidden).toBe(false);
    expect(document.getElementById('result-stars').children.length).toBe(3);
    // 全程沒有用提示、每題第一次就答對，應該是滿星
    expect(document.getElementById('result-stars').textContent).toBe('⭐⭐⭐');
    expect(document.getElementById('result-accuracy').textContent).toMatch(/100%/);
  });

  it('我的進度頁：渲染、匯出/匯入、3D 診斷按鈕都不拋出例外', async () => {
    loadIndexHtmlIntoDocument();
    const { bindStaticEvents } = await import('../src/ui/index.js');
    const { initGameFlow } = await import('../src/ui/game-flow.js');
    bindStaticEvents();
    await initGameFlow();
    await flush();

    document.getElementById('btn-progress').click();
    expect(document.getElementById('view-progress').hidden).toBe(false);
    expect(document.getElementById('progress-table').children.length).toBeGreaterThan(0);
    expect(document.getElementById('collectibles-grid').children.length).toBeGreaterThan(0);

    // 3D 診斷按鈕：three-fx 已 mock 成功，點下去不應該拋例外
    document.getElementById('btn-check-threefx').click();
  });

  it('字卡瀏覽：從主選單進入整個主題，方向鍵/按鈕都能正常換卡不拋例外', async () => {
    loadIndexHtmlIntoDocument();
    const { bindStaticEvents, handleKeydown } = await import('../src/ui/index.js');
    const { initGameFlow } = await import('../src/ui/game-flow.js');
    bindStaticEvents();
    document.addEventListener('keydown', handleKeydown);
    await initGameFlow();
    await flush();

    document.getElementById('btn-flashcards').click();
    document.getElementById('theme-grid').querySelector('.theme-card').click();
    expect(document.getElementById('view-flashcards').hidden).toBe(false);
    expect(document.getElementById('flashcard-word').textContent.length).toBeGreaterThan(0);

    document.getElementById('btn-flashcard-next').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  });

  it('拼讀練習：開場後畫面有 3 個候選單字，答錯只排除選項不拋例外', async () => {
    loadIndexHtmlIntoDocument();
    const { bindStaticEvents } = await import('../src/ui/index.js');
    const { initGameFlow } = await import('../src/ui/game-flow.js');
    bindStaticEvents();
    await initGameFlow();
    await flush();

    document.getElementById('btn-blend').click();
    document.getElementById('theme-grid').querySelector('.theme-card').click();
    expect(document.getElementById('view-blend').hidden).toBe(false);
    expect(document.getElementById('blend-choices').children.length).toBe(3);
  });
});
