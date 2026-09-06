// Phase 1 契約（凍結）—— 這份檔案定義 audio 引擎對外的 API 邊界。
//
// 擁有者：Phase 1「audio 引擎」agent。負責把下面每個 export 的 body 從
// `throw new Error('not implemented')` 換成真正的邏輯，邏輯來源是一代
// `拼字遊戲/app.js` 的三段：「音訊快取與預載入」（約 822 行起）、
// 「真人神經語音與語音合成」（約 853 行起）、「Web Audio synthesized
// sound effects」（約 1050 行起）。
//
// 規則：
// - 音檔路徑改成 `public/words-audio/<word>.mp3`／
//   `public/phonics-audio/<chunk>.mp3`，執行期用 `import.meta.env.BASE_URL`
//   前綴組出絕對路徑存取（Vite `public/` 目錄的慣例，不需要 import；前綴
//   是為了子路徑部署，例如 GitHub Pages 的 `/repo-name/`，不能寫死 `/`）。
// - **`unlockAudio()` 的「行動裝置第一次點擊才能解鎖音訊」機制必須保留**
//   （見 規劃.md A 段約束），不要假設所有裝置都能無條件 autoplay。
// - 音檔載入失敗要降級到瀏覽器原生 `SpeechSynthesis`（一代的既有行為），
//   不要讓音訊播放失敗變成擋住遊戲流程的例外。
// - 不要碰 DOM（不 `document.*`），這支模組只管音訊播放，UI 層負責畫面。

// ---------- 內部狀態 ----------
// （一代用模組層級變數，這裡沿用同樣的作法，只是包在 ES module scope 裡。）

let audioUnlocked = false;
let audioCtx = null;
let cachedEnglishVoice = null;

// 音效開關 / 語速：預設值對齊 `src/progress/schema.js` 的預設 settings
// （soundEnabled:true, speechRate:0.8）。UI 層在讀到使用者存檔後應該呼叫
// setSoundEnabled/setSpeechRate 把這裡的狀態同步成使用者的實際設定。
let soundEnabled = true;
let speechRate = 0.8;

let wordAudioEl = null;
let phonicsAudioEl = null;
let phonicsAudioHandlers = null; // { onEnded, onError } —— 目前掛在 phonicsAudioEl 上的那一組監聽器
let phonicsPlaybackId = 0; // 每次呼叫 speakPhonics() 就 +1，播放序列裡每一步都檢查序號是否還是最新的

const preloadedAudioMap = {};

// ---------- 環境探測小工具 ----------
// 用 `typeof X !== 'undefined'` 而不是直接引用 `window.X`，這樣在沒有
// `window`（例如 vitest 的 node 環境）或測試用 `globalThis.Audio = ...`
// 直接掛全域 mock 時都不會意外炸掉。

function hasAudioCtor() {
  return typeof Audio !== 'undefined';
}

function hasSpeechSynthesis() {
  return typeof speechSynthesis !== 'undefined' && !!speechSynthesis;
}

function hasSpeechUtteranceCtor() {
  return typeof SpeechSynthesisUtterance !== 'undefined';
}

function getWordAudioEl() {
  if (!wordAudioEl && hasAudioCtor()) wordAudioEl = new Audio();
  return wordAudioEl;
}

function getPhonicsAudioEl() {
  if (!phonicsAudioEl && hasAudioCtor()) phonicsAudioEl = new Audio();
  return phonicsAudioEl;
}

// ---------- 音訊快取與預載入 ----------

// `import.meta.env.BASE_URL` 是 Vite 的部署路徑前綴（本機開發是 '/'，部署到
// GitHub Pages 這種子路徑網址時是 vite.config.js 的 `base` 設定值，例如
// '/拼字王二/'，永遠有結尾斜線）。public/ 底下的檔案要用這個前綴組出正確的
// 絕對路徑，不能寫死 '/words-audio/...'——寫死的話子路徑部署會直接 404。
const BASE_URL = import.meta.env.BASE_URL;

function wordAudioUrl(word) {
  return BASE_URL + 'words-audio/' + encodeURIComponent(word) + '.mp3';
}

function phonicsAudioUrl(chunkName) {
  return BASE_URL + 'phonics-audio/' + encodeURIComponent(chunkName) + '.mp3';
}

function preloadAudio(url) {
  if (!url || preloadedAudioMap[url] || !hasAudioCtor()) return;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;
  preloadedAudioMap[url] = audio;
}

/**
 * 決定某個 phonics chunk 索引實際要查哪個音檔（處理 `audioOverrides`：
 * 若該索引有 override，回傳對應的虛擬 chunk id，例如 `fly` 的 `y`
 * 索引 2 回傳 `y-long-i`，而不是 `y`）。
 * @param {{chunks:string[], audioOverrides?:Object<string,string>}} phonics
 * @param {number} index
 * @returns {string} 音檔檔名（不含副檔名），對應 `public/phonics-audio/<回傳值>.mp3`
 */
export function phonicsChunkAudioName(phonics, index) {
  const override = phonics && phonics.audioOverrides && phonics.audioOverrides[index];
  return override || (phonics && phonics.chunks && phonics.chunks[index]);
}

/**
 * 預先載入這個單字＋其 phonics chunks 的音檔（出題前預熱，避免點下去才開始
 * 網路請求造成延遲）。
 * @param {{word:string, phonics:{chunks:string[],audioOverrides?:Object<string,string>}}} entry
 * @returns {void}
 */
export function preloadEntryAudio(entry) {
  if (!entry) return;
  if (entry.word) {
    preloadAudio(wordAudioUrl(entry.word.toLowerCase()));
  }
  if (entry.phonics && entry.phonics.chunks) {
    entry.phonics.chunks.forEach((chunk, i) => {
      const audioName = phonicsChunkAudioName(entry.phonics, i);
      preloadAudio(phonicsAudioUrl(audioName));
    });
  }
}

// ---------- 真人神經語音與語音合成 ----------

/**
 * 初始化瀏覽器 `SpeechSynthesis` 可用語音清單（神經語音音檔載入失敗時的備援）。
 * @returns {void}
 */
export function initVoices() {
  if (!hasSpeechSynthesis()) return;
  const pick = () => {
    const voices = speechSynthesis.getVoices() || [];
    cachedEnglishVoice =
      voices.find((v) => v.lang && v.lang.toLowerCase().indexOf('en') === 0) || null;
  };
  pick();
  if (typeof speechSynthesis.addEventListener === 'function') {
    speechSynthesis.addEventListener('voiceschanged', pick);
  }
}

function fallbackWordToTTS(word, rate, onEnded) {
  if (!hasSpeechSynthesis() || !hasSpeechUtteranceCtor()) {
    if (onEnded) onEnded();
    return;
  }
  try {
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    if (cachedEnglishVoice) {
      utter.voice = cachedEnglishVoice;
      utter.lang = cachedEnglishVoice.lang;
    }
    utter.rate = rate;
    if (onEnded) {
      utter.onend = onEnded;
      utter.onerror = onEnded;
    }
    speechSynthesis.speak(utter);
  } catch (err) {
    if (onEnded) onEnded();
  }
}

/**
 * 播放整個單字的發音。優先播放 `public/words-audio/<word>.mp3`
 * （`Audio` 元素 + `playbackRate` 調速），失敗時退回瀏覽器 `SpeechSynthesis`。
 * @param {string} word
 * @param {{rate?:number, onEnded?:()=>void}} [opts] - rate 預設用目前設定的
 *   語速（見 `setSpeechRate`）
 * @returns {void}
 */
export function speakWord(word, opts) {
  const { rate = speechRate, onEnded } = opts || {};
  if (!word) {
    if (onEnded) onEnded();
    return;
  }
  const normalizedWord = word.trim().toLowerCase();
  const fallback = () => fallbackWordToTTS(word, rate, onEnded);

  const el = getWordAudioEl();
  if (!el) {
    fallback();
    return;
  }
  el.playbackRate = rate;
  // 清理舊的監聽器
  el.onended = null;
  el.onerror = null;

  el.src = wordAudioUrl(normalizedWord);
  el.onended = () => {
    if (onEnded) onEnded();
  };
  el.onerror = fallback;

  let playPromise;
  try {
    playPromise = el.play();
  } catch (err) {
    fallback();
    return;
  }
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise.catch(fallback);
  }
}

/**
 * 逐段播放自然發音拆解（phonics chunks），每個 chunk 依序播放
 * `public/phonics-audio/<phonicsChunkAudioName 回傳值>.mp3`，最後播放完整
 * 單字（呼叫 `speakWord`）。
 * @param {{phonics:{chunks:string[],silent:number[],audioOverrides?:Object<string,string>}, word:string}} entry
 * @param {{rate?:number, onEachChunk?:(chunkIndex:number)=>void, onEnded?:()=>void}} [opts]
 * @returns {void}
 */
export function speakPhonics(entry, opts) {
  const { rate = speechRate, onEachChunk, onEnded } = opts || {};
  const phonics = entry && entry.phonics;

  if (!phonics || !phonics.chunks || phonics.chunks.length === 0) {
    speakWord(entry && entry.word, { rate, onEnded });
    return;
  }

  if (hasSpeechSynthesis()) speechSynthesis.cancel();
  const wEl = getWordAudioEl();
  if (wEl) {
    wEl.pause();
    wEl.currentTime = 0;
  }

  const myPlaybackId = ++phonicsPlaybackId;
  const el = getPhonicsAudioEl();
  if (!el) {
    // 這台裝置連 Audio 都沒有 -> 沒辦法逐段播放，退而求其次唸完整單字
    speakWord(entry.word, { rate, onEnded });
    return;
  }

  if (phonicsAudioHandlers) {
    el.removeEventListener('ended', phonicsAudioHandlers.onEnded);
    el.removeEventListener('error', phonicsAudioHandlers.onError);
    phonicsAudioHandlers = null;
  }

  // 保留原始索引（而不是只留文字），這樣才能用索引去查 audioOverrides——
  // 濾掉 silent chunk 後陣列位置會跟原始 phonics.chunks 錯位，純文字陣列做不到這件事。
  const chunkIndices = [];
  phonics.chunks.forEach((chunk, i) => {
    if (!(phonics.silent && phonics.silent.indexOf(i) !== -1)) chunkIndices.push(i);
  });

  let idx = 0;
  el.playbackRate = rate;

  // 該 chunk 的音檔載入失敗時，退回瀏覽器 SpeechSynthesis 唸出這個 chunk 的文字，
  // 讓孩子至少聽到一個聲音，而不是整段靜音跳過（跟 speakWord() 的 fallback 邏輯對稱）。
  function fallbackChunkToTTS(chunkText, next) {
    if (!hasSpeechSynthesis() || !hasSpeechUtteranceCtor()) {
      next();
      return;
    }
    try {
      speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(chunkText);
      if (cachedEnglishVoice) {
        utter.voice = cachedEnglishVoice;
        utter.lang = cachedEnglishVoice.lang;
      }
      utter.rate = rate;
      utter.onend = next;
      utter.onerror = next;
      speechSynthesis.speak(utter);
    } catch (err) {
      next();
    }
  }

  function playNext() {
    if (myPlaybackId !== phonicsPlaybackId) return;
    if (idx >= chunkIndices.length) {
      speakWord(entry.word, { rate, onEnded });
      return;
    }
    const originalIndex = chunkIndices[idx];
    const chunkText = phonics.chunks[originalIndex]; // fallback TTS 要唸的文字，永遠是真正的拼字
    const audioName = phonicsChunkAudioName(phonics, originalIndex); // 音檔查找用的檔名，可能被 override
    idx++;
    if (onEachChunk) onEachChunk(originalIndex);

    let settled = false;
    const cleanup = () => {
      el.removeEventListener('ended', onChunkEnded);
      el.removeEventListener('error', onChunkError);
      if (phonicsAudioHandlers && phonicsAudioHandlers.onEnded === onChunkEnded) {
        phonicsAudioHandlers = null;
      }
    };
    const onChunkEnded = () => {
      if (settled) return;
      settled = true;
      cleanup();
      playNext();
    };
    const onChunkError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      fallbackChunkToTTS(chunkText, () => {
        if (myPlaybackId !== phonicsPlaybackId) return;
        playNext();
      });
    };

    phonicsAudioHandlers = { onEnded: onChunkEnded, onError: onChunkError };
    el.src = phonicsAudioUrl(audioName);
    el.playbackRate = rate;
    el.addEventListener('ended', onChunkEnded);
    el.addEventListener('error', onChunkError);

    let playPromise;
    try {
      playPromise = el.play();
    } catch (err) {
      onChunkError();
      return;
    }
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.catch(onChunkError);
    }
  }

  playNext();
}

/**
 * 首次使用者互動（例如按下「開始遊戲」）時呼叫一次，解鎖行動裝置瀏覽器的
 * 音訊/語音自動播放限制。之後才能正常播放 `speakWord`/`speakPhonics`/音效。
 * @returns {void}
 */
export function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  if (hasSpeechSynthesis() && hasSpeechUtteranceCtor()) {
    try {
      speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    } catch (err) {
      // 忽略——這只是為了在使用者手勢內「碰」一下語音合成引擎，失敗不影響遊戲
    }
  }

  initAudioContext();

  const wEl = getWordAudioEl();
  if (wEl) {
    wEl.muted = true;
    wEl.src = wordAudioUrl('cat');
    let p1;
    try {
      p1 = wEl.play();
    } catch (err) {
      p1 = undefined;
    }
    if (p1 && typeof p1.then === 'function') {
      p1.then(() => {
        wEl.pause();
        wEl.currentTime = 0;
        wEl.muted = false;
      }).catch(() => {
        wEl.muted = false;
      });
    } else {
      wEl.muted = false;
    }
  }

  const pEl = getPhonicsAudioEl();
  if (pEl) {
    pEl.muted = true;
    pEl.src = phonicsAudioUrl('a');
    let p2;
    try {
      p2 = pEl.play();
    } catch (err) {
      p2 = undefined;
    }
    if (p2 && typeof p2.then === 'function') {
      p2.then(() => {
        pEl.pause();
        pEl.currentTime = 0;
        pEl.muted = false;
      }).catch(() => {
        pEl.muted = false;
      });
    } else {
      pEl.muted = false;
    }
  }
}

// ---------- Web Audio synthesized sound effects ----------

function initAudioContext() {
  if (audioCtx) return;
  const Ctx =
    (typeof AudioContext !== 'undefined' && AudioContext) ||
    (typeof webkitAudioContext !== 'undefined' && webkitAudioContext);
  if (!Ctx) return;
  audioCtx = new Ctx();
  if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
    audioCtx.resume();
  }
}

function playTone(freq, duration, delay) {
  if (!soundEnabled || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  const t0 = audioCtx.currentTime + delay;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** 答對合成音效（Web Audio）。 @returns {void} */
export function playCorrectSound() {
  playTone(523.25, 0.12, 0);
  playTone(659.25, 0.12, 0.1);
  playTone(783.99, 0.16, 0.2);
}

/** 答錯合成音效（Web Audio）。 @returns {void} */
export function playWrongSound() {
  playTone(196, 0.25, 0);
}

/** 星星逐顆蹦出時的合成音效（Web Audio）。 @returns {void} */
export function playStarPopSound() {
  playTone(1046.5, 0.14, 0);
}

/**
 * 音效開關（不影響語音朗讀，只影響上面三個合成音效函式）。
 * @param {boolean} enabled
 * @returns {void}
 */
export function setSoundEnabled(enabled) {
  soundEnabled = !!enabled;
}

/**
 * 設定之後 `speakWord`/`speakPhonics` 呼叫預設使用的發音速度。
 * @param {number} rate - 0.5（🐢慢速）/ 0.8（🚶正常）/ 1.0（🐇快速）
 * @returns {void}
 */
export function setSpeechRate(rate) {
  if (typeof rate === 'number' && !Number.isNaN(rate)) speechRate = rate;
}
