// 我的進度頁（`#view-progress`）。對應一代 `拼字遊戲/app.js` 的
// `renderProgressTable()`/`renderCollectiblesGrid()`/`checkThreeFxStatus()`，
// 以及匯出/匯入進度的綁定（`btn-export`/`btn-import`）。
//
// 進入畫面的入口（主選單 `btn-progress`、各畫面的 `data-nav="progress"` 返回鍵）
// 是 `src/ui/index.js`（Agent 4）的 `bindStaticEvents()` 負責綁的，但進入前
// 應該呼叫這裡的 `renderProgressPage()` 重新渲染最新資料（星等/正確率/貼紙
// 都可能在使用者玩過關卡後改變），再呼叫 `showView('progress')`。
//
// 事件綁定：`bindProgressEvents()` 只應該被呼叫一次（在整合階段的
// `bindStaticEvents()` 裡），負責 `#view-progress` 底下的固定按鈕
// （btn-export/btn-import/import-file-input/btn-check-threefx）。
// 呼叫端不應該再自己綁這些 id。

import { showToast } from './index.js';
import { getValidLevelCombos, getThemes, getLevelDefsForTheme } from '../game/index.js';
import { loadProgress, exportProgress, importProgress } from '../progress/store.js';
import { levelKey } from '../progress/schema.js';
import { setSpeechRate, setSoundEnabled } from '../audio/index.js';
import { initThreeFx, celebrateLevelComplete } from '../three-fx/index.js';

// 3D 特效可用性快取：
// - null  = 尚未確認過（頁面剛載入、也還沒被整合層告知過結果）
// - true/false = 已知結果
// 整合層（main.js）在啟動時呼叫 initThreeFx() 決定要不要鎖住拼字關卡之後，
// 應該呼叫 `setThreeFxReady(result)` 把結果同步進來，避免這裡的診斷按鈕
// 重複呼叫 initThreeFx() 產生第二個 three.js 場景/canvas。
// 如果一直沒有人呼叫 setThreeFxReady()，診斷按鈕第一次點擊時會自己
// 呼叫一次 initThreeFx() 當作備援判斷方式。
let threeFxReady = null;

/**
 * 讓整合層同步「開始遊戲」門檻用的 three.js 初始化結果，避免診斷按鈕
 * 自己重複呼叫 initThreeFx() 建立第二個場景。
 * @param {boolean} ready
 * @returns {void}
 */
export function setThreeFxReady(ready) {
  threeFxReady = !!ready;
}

/**
 * 重新渲染進度總覽表格＋貼紙簿，畫面顯示前（或匯入進度後）呼叫。
 * @returns {void}
 */
export function renderProgressPage() {
  const progress = loadProgress();
  const themes = getThemes();
  const themeById = new Map(themes.map((t) => [t.id, t]));
  const combos = getValidLevelCombos();
  const levelDefsCache = new Map();

  function levelDefFor(themeId, key) {
    if (!levelDefsCache.has(themeId)) {
      levelDefsCache.set(themeId, getLevelDefsForTheme(themeId));
    }
    return levelDefsCache.get(themeId).find((d) => String(d.key) === String(key));
  }

  const tableContainer = document.getElementById('progress-table');
  const gridContainer = document.getElementById('collectibles-grid');
  tableContainer.innerHTML = '';
  gridContainer.innerHTML = '';

  combos.forEach((combo) => {
    const theme = themeById.get(combo.themeId);
    const def = levelDefFor(combo.themeId, combo.key);
    const comboKey = levelKey(combo.themeId, combo.key);
    const lp = progress.levels[comboKey];
    const stars = lp ? lp.bestStars : 0;
    const accuracyText = lp && lp.attempts > 0 ? `${Math.round(lp.bestAccuracy * 100)}%` : '未挑戰';
    const themeLabel = theme ? `${theme.icon} ${theme.name}` : combo.themeId;
    const tierLabel = def ? def.label : String(combo.key);

    const row = document.createElement('div');
    row.className = 'progress-row';
    row.innerHTML = `<span class="progress-theme-name">${themeLabel}</span>` +
      `<span class="progress-tier">${tierLabel}</span>` +
      `<span>${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>` +
      `<span>${accuracyText}</span>`;
    tableContainer.appendChild(row);

    // 貼紙簿：只列出「實際打得開」的組合，已拿到貼紙的顯示主題 icon，
    // 還沒拿到的用問號佔位。
    const collected = !!progress.collectibles[comboKey];
    const item = document.createElement('div');
    item.className = `sticker-item${collected ? ' collected' : ' locked'}`;
    item.innerHTML = `<span class="sticker-item-icon">${collected && theme ? theme.icon : '❔'}</span>` +
      `<span class="sticker-item-label">${theme ? theme.name : combo.themeId} ${tierLabel}</span>`;
    gridContainer.appendChild(item);
  });
}

async function checkThreeFxStatus() {
  const statusEl = document.getElementById('threefx-status-text');

  if (threeFxReady === null) {
    try {
      threeFxReady = await initThreeFx(document.getElementById('three-fx-layer'));
    } catch (err) {
      threeFxReady = false;
    }
  }

  if (threeFxReady) {
    statusEl.textContent = '✅ 3D 特效目前可以使用';
    statusEl.className = 'threefx-status ok';
    // 順便觸發一次真正的特效播放，讓使用者能立刻親眼確認是不是真的可以動。
    celebrateLevelComplete();
  } else {
    statusEl.textContent = '❌ 3D 特效目前無法使用，拼字遊戲關卡暫時無法進入（字卡瀏覽／拼讀練習不受影響）';
    statusEl.className = 'threefx-status fail';
  }
}

function handleImportedFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const result = importProgress(reader.result);
    if (result.ok) {
      // gen1 的 speakWord 每次都即時讀 progress.settings.speechRate，匯入後自動生效；
      // gen2 的 audio 模組把語速/音效開關存成模組內部狀態（setSpeechRate/setSoundEnabled），
      // 匯入新設定後要主動同步一次，不然要等下次手動切換或重新整理頁面才會套用。
      setSpeechRate(result.data.settings.speechRate);
      setSoundEnabled(result.data.settings.soundEnabled);
      renderProgressPage();
      showToast('進度已匯入！');
    } else {
      showToast(result.error || '匯入失敗：檔案格式不正確');
    }
  };
  reader.onerror = () => showToast('匯入失敗：無法讀取檔案');
  reader.readAsText(file);
}

/**
 * 綁定 `#view-progress` 底下所有固定按鈕，只應該呼叫一次。
 * @returns {void}
 */
export function bindProgressEvents() {
  document.getElementById('btn-export').addEventListener('click', () => {
    const json = exportProgress();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spelling-game-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('進度已匯出！');
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });

  document.getElementById('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleImportedFile(file);
  });

  document.getElementById('btn-check-threefx').addEventListener('click', checkThreeFxStatus);
}
