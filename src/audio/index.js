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
//   `public/phonics-audio/<chunk>.mp3`，執行期用絕對路徑 `/words-audio/...`
//   存取（Vite `public/` 目錄的慣例，不需要 import）。
// - **`unlockAudio()` 的「行動裝置第一次點擊才能解鎖音訊」機制必須保留**
//   （見 規劃.md A 段約束），不要假設所有裝置都能無條件 autoplay。
// - 音檔載入失敗要降級到瀏覽器原生 `SpeechSynthesis`（一代的既有行為），
//   不要讓音訊播放失敗變成擋住遊戲流程的例外。
// - 不要碰 DOM（不 `document.*`），這支模組只管音訊播放，UI 層負責畫面。

/**
 * 首次使用者互動（例如按下「開始遊戲」）時呼叫一次，解鎖行動裝置瀏覽器的
 * 音訊/語音自動播放限制。之後才能正常播放 `speakWord`/`speakPhonics`/音效。
 * @returns {void}
 */
export function unlockAudio() {
  throw new Error('not implemented');
}

/**
 * 初始化瀏覽器 `SpeechSynthesis` 可用語音清單（神經語音音檔載入失敗時的備援）。
 * @returns {void}
 */
export function initVoices() {
  throw new Error('not implemented');
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
  throw new Error('not implemented');
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
  throw new Error('not implemented');
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
  throw new Error('not implemented');
}

/**
 * 預先載入這個單字＋其 phonics chunks 的音檔（出題前預熱，避免點下去才開始
 * 網路請求造成延遲）。
 * @param {{word:string, phonics:{chunks:string[],audioOverrides?:Object<string,string>}}} entry
 * @returns {void}
 */
export function preloadEntryAudio(entry) {
  throw new Error('not implemented');
}

/** 答對合成音效（Web Audio）。 @returns {void} */
export function playCorrectSound() {
  throw new Error('not implemented');
}

/** 答錯合成音效（Web Audio）。 @returns {void} */
export function playWrongSound() {
  throw new Error('not implemented');
}

/** 星星逐顆蹦出時的合成音效（Web Audio）。 @returns {void} */
export function playStarPopSound() {
  throw new Error('not implemented');
}

/**
 * 音效開關（不影響語音朗讀，只影響上面三個合成音效函式）。
 * @param {boolean} enabled
 * @returns {void}
 */
export function setSoundEnabled(enabled) {
  throw new Error('not implemented');
}

/**
 * 設定之後 `speakWord`/`speakPhonics` 呼叫預設使用的發音速度。
 * @param {number} rate - 0.5（🐢慢速）/ 0.8（🚶正常）/ 1.0（🐇快速）
 * @returns {void}
 */
export function setSpeechRate(rate) {
  throw new Error('not implemented');
}
