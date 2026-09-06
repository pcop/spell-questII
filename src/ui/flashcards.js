// 字卡瀏覽畫面（`#view-flashcards`）。對應一代 `拼字遊戲/app.js` 的
// `openFlashcards()`/`renderFlashcard()`。
//
// 兩個入口（呼叫端在 game-flow.js，尚未寫好，這裡只負責被呼叫）：
//   - 選難度畫面的 📖 按鈕：鎖定主題+難度，`openFlashcards(getWordsForLevel(themeId, levelKey), { origin: 'level-select' })`
//   - 主選單「📖 單字字卡」→ 選主題：整個主題不分難度，
//     `openFlashcards(getAllWordsForTheme(themeId), { origin: 'theme-select' })`
//
// 字卡模式固定同時顯示圖片＋完整拼法＋發音，不受測驗的「提示模式」設定影響
// （一代 renderFlashcard() 的既有行為，照抄）。
//
// 事件綁定：`bindFlashcardEvents()` 只應該被呼叫一次（在整合階段的
// `bindStaticEvents()` 裡），負責 `#view-flashcards` 底下所有按鈕
// （btn-flashcard-back/prev/next/speak/blend、flashcard-speech-rate-buttons）。
// 呼叫端（index.js/game-flow.js）不應該再自己綁這些 id，否則會重複觸發。

import { showView } from './index.js';
import { speakWord, speakPhonics, setSpeechRate, preloadEntryAudio } from '../audio/index.js';
import { loadProgress, saveProgress } from '../progress/store.js';

/** @type {{words: Array, index: number, origin: 'theme-select'|'level-select'}|null} */
let state = null;

let speakTimer = null;

/**
 * 開啟字卡瀏覽畫面。
 * @param {Array} words - `src/game/index.js` 的 `getAllWordsForTheme`/`getWordsForLevel` 回傳的 WordEntry[]
 * @param {{origin?: 'theme-select'|'level-select'}} [opts]
 * @returns {void}
 */
export function openFlashcards(words, opts = {}) {
  if (!words || words.length === 0) return;
  state = { words, index: 0, origin: opts.origin === 'level-select' ? 'level-select' : 'theme-select' };
  renderFlashcard();
  showView('flashcards');
}

function renderFlashcard() {
  if (!state) return;
  const entry = state.words[state.index];

  const visual = document.getElementById('flashcard-visual');
  visual.innerHTML = '';
  if (entry.emoji) {
    visual.textContent = entry.emoji;
  } else if (entry.swatch) {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = entry.swatch;
    visual.appendChild(sw);
  }

  document.getElementById('flashcard-word').textContent = entry.word;

  const syllablesEl = document.getElementById('flashcard-syllables');
  if (entry.syllables && entry.syllables.length > 1) {
    syllablesEl.textContent = entry.syllables.join('-');
    syllablesEl.hidden = false;
  } else {
    syllablesEl.textContent = '';
    syllablesEl.hidden = true;
  }

  const phonicsEl = document.getElementById('flashcard-phonics');
  if (entry.phonics && entry.phonics.chunks && entry.phonics.chunks.length > 1) {
    const htmlParts = entry.phonics.chunks.map((chunk, i) => {
      const isSilent = entry.phonics.silent && entry.phonics.silent.indexOf(i) !== -1;
      return isSilent ? `<span class="silent-chunk">(${chunk})</span>` : chunk;
    });
    phonicsEl.innerHTML = htmlParts.join('-');
    phonicsEl.hidden = false;
  } else {
    phonicsEl.innerHTML = '';
    phonicsEl.hidden = true;
  }

  document.getElementById('flashcard-position').textContent = `${state.index + 1} / ${state.words.length}`;
  document.getElementById('btn-flashcard-prev').disabled = state.index === 0;
  document.getElementById('btn-flashcard-next').disabled = state.index === state.words.length - 1;

  renderFlashcardSpeechRateButtons();

  preloadEntryAudio(entry);
  const nextEntry = state.words[state.index + 1];
  if (nextEntry) preloadEntryAudio(nextEntry);

  // 快速連按上一個/下一個時要 debounce，不然連續呼叫 speakWord 在部分瀏覽器
  // （尤其 iOS Safari）會排隊卡住、唸出一堆斷斷續續的半音節。只在孩子停下來的那張卡唸。
  clearTimeout(speakTimer);
  speakTimer = setTimeout(() => speakWord(entry.word), 250);
}

function renderFlashcardSpeechRateButtons() {
  const progress = loadProgress();
  document.querySelectorAll('#flashcard-speech-rate-buttons .btn-toggle').forEach((b) => {
    b.classList.toggle('active', parseFloat(b.dataset.speechRate) === progress.settings.speechRate);
  });
}

/**
 * 綁定 `#view-flashcards` 底下所有固定按鈕，只應該呼叫一次。
 * @returns {void}
 */
export function bindFlashcardEvents() {
  document.getElementById('btn-flashcard-back').addEventListener('click', () => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    clearTimeout(speakTimer);
    const origin = state ? state.origin : 'theme-select';
    state = null;
    // 字卡瀏覽不寫入任何進度，離開時目標畫面（theme-select/level-select）的
    // 星等/正確率跟進入前完全一樣，不需要重新渲染，直接切換畫面即可。
    showView(origin);
  });

  document.getElementById('btn-flashcard-prev').addEventListener('click', () => {
    if (!state) return;
    if (state.index > 0) {
      state.index--;
      renderFlashcard();
    }
  });

  document.getElementById('btn-flashcard-next').addEventListener('click', () => {
    if (!state) return;
    if (state.index < state.words.length - 1) {
      state.index++;
      renderFlashcard();
    }
  });

  document.getElementById('btn-flashcard-speak').addEventListener('click', () => {
    if (state) speakWord(state.words[state.index].word);
  });

  document.getElementById('btn-flashcard-blend').addEventListener('click', () => {
    if (state) speakPhonics(state.words[state.index]);
  });

  document.getElementById('flashcard-speech-rate-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-toggle');
    if (!btn) return;
    const rate = parseFloat(btn.dataset.speechRate);
    setSpeechRate(rate);
    const progress = loadProgress();
    progress.settings.speechRate = rate;
    saveProgress(progress);
    renderFlashcardSpeechRateButtons();
    if (state) speakWord(state.words[state.index].word); // 立即試聽，讓孩子聽出速度差異
  });
}

/**
 * 唯一的 document-level keydown 分流入口在 `src/ui/index.js` 的 `handleKeydown(e)`，
 * `view-flashcards` 可見時會呼叫這裡。ArrowLeft/ArrowRight 呼叫既有上一張/下一張
 * 按鈕的 `.click()`，disabled 狀態下 `.click()` 不會觸發，自動處理邊界。
 * @param {KeyboardEvent} e
 * @returns {void}
 */
export function handleFlashcardKeydown(e) {
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    document.getElementById('btn-flashcard-prev').click();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    document.getElementById('btn-flashcard-next').click();
  }
}
