// ---------- Data loading ----------
//
// 一代（拼字遊戲/app.js `loadGameData()`）用 runtime `fetch('data.json')` /
// `fetch('messages.json')` 載入資料，失敗時（例如直接雙擊 index.html、沒有
// HTTP server）會顯示 load-error 畫面。
//
// 二代改用 Vite 的靜態 import：data.json / messages.json 在 build 時就被
// 打包進 bundle，不再是「執行期才去抓的外部檔案」。這樣：
//   - 拿掉「不能雙擊開啟，一定要跑 HTTP server」這個一代限制的根因
//     （Vite dev/build 本身仍然要跑，但那是 Vite 專案通用的前提，不是
//     資料載入額外加上去的限制）。
//   - 資料在 build 時就會被解析成 JS 物件；JSON 語法錯了會在 build 階段
//     直接失敗，比一代「執行期 fetch 失敗才在瀏覽器裡發現」更早抓到問題。
//   - 不需要 Promise.all + fetch 的非同步流程，也不需要處理網路層
//     HTTP status 檢查（import 失敗就是 build 失敗，不會有 res.ok === false
//     這種執行期狀態）。
//
// 保留一代的精神：
//   - 回傳同樣形狀的資料（wordBank / themes / difficultyTiers / praise /
//     encourage / result / mascotIdle），呼叫端不需要知道底層是 fetch 還是 import。
//   - 保留「資料形狀不對就視為載入失敗」的防呆檢查，讓呼叫端能比照一代
//     `showView('load-error')` 的方式處理，而不是讓 undefined 一路傳到
//     UI 層才爆炸。
import data from './data.json';
import messages from './messages.json';

/**
 * 載入遊戲資料（單字庫、主題、難度分級）與訊息庫（稱讚語、鼓勵語、結果語、
 * 吉祥物閒置語）。因為資料已經是 build-time import，這個函式本身不是
 * async 的必要條件，但維持回傳 Promise 讓呼叫端的程式碼（沿用一代
 * `loadGameData().then(...).catch(...)` 的寫法）不用改動。
 *
 * @returns {Promise<{wordBank: object[], themes: object[], difficultyTiers: object[], messages: {praise: string[], encourage: string[], result: object, mascotIdle: string[]}}>}
 */
export function loadGameData() {
  return new Promise((resolve, reject) => {
    try {
      assertShape(data, messages);
      resolve({
        wordBank: data.wordBank,
        themes: data.themes,
        difficultyTiers: data.difficultyTiers,
        messages: {
          praise: messages.praise,
          encourage: messages.encourage,
          result: messages.result,
          mascotIdle: messages.mascotIdle
        }
      });
    } catch (err) {
      console.error('資料載入失敗', err);
      reject(err);
    }
  });
}

// 資料形狀防呆：對應一代「fetch 失敗／HTTP status 不對就丟到 catch」的精神，
// 差別在一代檢查的是「網路請求有沒有成功」，這裡檢查的是「打包進來的
// JSON 內容形狀對不對」——兩者都是「資料不可信就別讓後面的程式碼裸跑」。
function assertShape(data, messages) {
  if (!data || !Array.isArray(data.wordBank) || data.wordBank.length === 0) {
    throw new Error('data.json 缺少有效的 wordBank');
  }
  if (!Array.isArray(data.themes) || data.themes.length === 0) {
    throw new Error('data.json 缺少有效的 themes');
  }
  if (!Array.isArray(data.difficultyTiers) || data.difficultyTiers.length === 0) {
    throw new Error('data.json 缺少有效的 difficultyTiers');
  }
  if (!messages || !Array.isArray(messages.praise) || !Array.isArray(messages.encourage)) {
    throw new Error('messages.json 缺少有效的 praise/encourage');
  }
}
