// 純函式小工具，搬自一代 app.js「Word bank helpers」段落
// （洗牌 / 挑干擾字母 / 組字母方塊）。跟 DOM、進度、資料查找完全無關，
// 純粹操作傳進來的參數，方便各自單元測試。

/**
 * Fisher-Yates 洗牌，回傳新陣列（不修改原陣列）。
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/**
 * 從整個單字庫（不限主題）挑出跟目標單字沒有重疊的干擾字母。
 * @param {string} word
 * @param {number} count
 * @param {Array<{word:string}>} wordBank - 全部單字（一代邏輯：干擾字母來源是全站單字庫，不分主題）
 * @returns {string[]}
 */
export function pickDistractorLetters(word, count, wordBank) {
  if (count <= 0) return [];
  const wordLetters = new Set(word.toLowerCase().split(''));
  const pool = new Set();
  wordBank.forEach((w) => {
    if (w.word === word) return;
    w.word
      .toLowerCase()
      .split('')
      .forEach((ch) => {
        if (!wordLetters.has(ch)) pool.add(ch);
      });
  });
  return shuffleArray(Array.from(pool)).slice(0, count);
}

/**
 * 組出這一題的字母方塊（正確字母 + 干擾字母，洗牌過），並確保洗出來的順序
 * 不會剛好就是正確答案本身（一代的 guard 迴圈，最多重洗 10 次）。
 * @param {string} word
 * @param {number} distractorCount
 * @param {Array<{word:string}>} wordBank
 * @returns {Array<{tileId:string, letter:string, used:boolean}>}
 */
export function buildTileSet(word, distractorCount, wordBank) {
  const letters = word.toLowerCase().split('');
  const distractors = pickDistractorLetters(word, distractorCount, wordBank);
  let all = shuffleArray(letters.concat(distractors));
  let guard = 0;
  while (letters.length > 1 && all.join('') === word && guard < 10) {
    all = shuffleArray(all);
    guard++;
  }
  return all.map((ch, i) => ({
    tileId: `${ch}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    letter: ch,
    used: false,
  }));
}
