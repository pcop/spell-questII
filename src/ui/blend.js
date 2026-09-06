// 拼讀練習畫面（`#view-blend`）。對應一代 `拼字遊戲/app.js` 的
// `openBlendGame()`/`loadBlendQuestion()`/`renderBlendChoices()`/`handleBlendChoice()`。
//
// 學習練習性質：無限隨機練習、不計分、不記錄進度。播放拼讀拆解音，畫面顯示
// 3 個候選單字（1 對 2 錯，干擾選項來自同主題）。答錯只是排除該選項，
// 孩子可以繼續嘗試，沒有壓力。
//
// 入口（呼叫端在 game-flow.js，尚未寫好，這裡只負責被呼叫）：
//   主選單「🎧 拼讀練習」→ 選主題 → `openBlendGame(themeId)`
//
// 事件綁定：`bindBlendEvents()` 只應該被呼叫一次（在整合階段的
// `bindStaticEvents()` 裡），負責 `#view-blend` 底下的固定按鈕
// （btn-blend-back/btn-blend-replay）。呼叫端不應該再自己綁這些 id。

import { showView, showToast } from './index.js';
import { speakPhonics, preloadEntryAudio, playCorrectSound, playWrongSound } from '../audio/index.js';
import { getAllWordsForTheme } from '../game/index.js';
import { celebrateCorrect } from '../three-fx/index.js';
import messages from '../data/messages.json';

const PRAISE_MESSAGES = messages.praise;
const ENCOURAGE_MESSAGES = messages.encourage;

/**
 * @type {{themeId:string, pool:Array, current:Object|null, choices:Array,
 *   locked:boolean, pendingTimeoutId:ReturnType<typeof setTimeout>|null}|null}
 */
let state = null;

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * 開啟拼讀練習畫面。
 * @param {string} themeId
 * @returns {void}
 */
export function openBlendGame(themeId) {
  const words = getAllWordsForTheme(themeId);
  if (!words || words.length < 3) {
    showToast('這個主題單字不夠，無法進行拼讀練習');
    return;
  }
  state = { themeId, pool: words, current: null, choices: [], locked: false, pendingTimeoutId: null };
  showView('blend');
  loadBlendQuestion();
}

function loadBlendQuestion() {
  if (!state) return;
  const pool = state.pool;
  const target = pickRandom(pool);
  const distractorPool = pool.filter((w) => w.id !== target.id);
  const distractors = shuffleArray(distractorPool).slice(0, Math.min(2, distractorPool.length));

  state.current = target;
  state.choices = shuffleArray([target, ...distractors]);
  state.locked = false;
  state.pendingTimeoutId = null;

  const msg = document.getElementById('blend-feedback');
  msg.textContent = '';
  msg.className = 'feedback-message';

  preloadEntryAudio(target);
  renderBlendChoices();
  speakPhonics(target);
}

function renderBlendChoices() {
  if (!state) return;
  const container = document.getElementById('blend-choices');
  container.innerHTML = '';
  state.choices.forEach((entry) => {
    const btn = document.createElement('button');
    btn.className = 'blend-choice';

    const visual = document.createElement('div');
    visual.className = 'blend-choice-visual';
    if (entry.emoji) {
      visual.textContent = entry.emoji;
    } else if (entry.swatch) {
      const sw = document.createElement('div');
      sw.className = 'swatch';
      sw.style.background = entry.swatch;
      visual.appendChild(sw);
    }
    btn.appendChild(visual);

    const wordEl = document.createElement('div');
    wordEl.className = 'blend-choice-word';
    wordEl.textContent = entry.word;
    btn.appendChild(wordEl);

    btn.addEventListener('click', () => handleBlendChoice(entry, btn));
    container.appendChild(btn);
  });
}

function handleBlendChoice(entry, btnEl) {
  if (!state || state.locked || btnEl.disabled) return;
  const isCorrect = entry.id === state.current.id;
  const msg = document.getElementById('blend-feedback');

  if (isCorrect) {
    state.locked = true;
    btnEl.classList.add('correct-flash');
    msg.textContent = pickRandom(PRAISE_MESSAGES);
    msg.className = 'feedback-message correct';
    playCorrectSound();
    // 拼讀練習不受「開始遊戲」的 three.js 硬性門檻限制（跟字卡瀏覽一樣不依賴 3D 特效），
    // celebrateCorrect() 目前（Phase 1）body 可能還是空的/尚未支援 WebGL，
    // 用 try/catch 包住避免中斷答對後的流程。
    try {
      celebrateCorrect();
    } catch (err) {
      // 3D 特效失敗不該擋住學習流程，忽略即可。
    }
    state.pendingTimeoutId = setTimeout(loadBlendQuestion, 1400);
  } else {
    btnEl.classList.add('shake');
    btnEl.disabled = true; // 排除這個選項，孩子可以繼續嘗試其他選項，不計對錯、沒有壓力
    setTimeout(() => btnEl.classList.remove('shake'), 400);
    msg.textContent = pickRandom(ENCOURAGE_MESSAGES);
    msg.className = 'feedback-message wrong';
    playWrongSound();
  }
}

/**
 * 綁定 `#view-blend` 底下所有固定按鈕，只應該呼叫一次。
 * @returns {void}
 */
export function bindBlendEvents() {
  document.getElementById('btn-blend-back').addEventListener('click', () => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (state && state.pendingTimeoutId) clearTimeout(state.pendingTimeoutId);
    state = null;
    showView('theme-select');
  });

  document.getElementById('btn-blend-replay').addEventListener('click', () => {
    if (state && state.current) speakPhonics(state.current);
  });
}
