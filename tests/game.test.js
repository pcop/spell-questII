import { describe, it, expect, beforeEach } from 'vitest';
import {
  getThemes,
  getLevelDefsForTheme,
  getValidLevelCombos,
  getAllWordsForTheme,
  getWordsForLevel,
  startLevel,
  getCurrentQuestionView,
  placeLetterInSlot,
  removeLastLetter,
  checkAnswer,
  useHint,
  advanceToNextQuestion,
  finishLevel,
  resetForRetry,
  setProgressStorage,
  MIN_WORDS_PER_LEVEL,
} from '../src/game/index.js';
import { createMemoryStorage } from '../src/progress/store.js';

// checkAnswer()/finishLevel() 逐題持久化，每答一題就讀寫一次進度（跟一代
// recordAnswer() 對等，見 src/game/session.js 開頭說明）。為了不讓各個測試案例
// 共用同一份 process 內的 fallback storage 互相汙染彼此的 bestStars/collectibles，
// 每個測試開始前都注入一份全新的記憶體 storage。
beforeEach(() => {
  setProgressStorage(createMemoryStorage());
});

// ---------- 測試小工具 ----------

// 把 word 逐字填進槽位（一律填「目前第一個空槽」，跟一代 placeLetterInSlot 規則
// 一致：重複字母任選一個未用方塊都可以，所以每一步都重新讀 view 找未用的對應字母）。
function fillWord(session, word) {
  for (const ch of word) {
    const view = getCurrentQuestionView(session);
    const tile = view.tiles.find((t) => !t.used && t.letter === ch);
    expect(tile, `找不到字母 "${ch}" 的未用方塊`).toBeTruthy();
    placeLetterInSlot(session, tile.id);
  }
}

// 把一個單字換成「用同一組字母、但一定拼錯」的字串（交換前兩個不同的字母）。
function swapToWrong(word) {
  for (let i = 1; i < word.length; i++) {
    if (word[i] !== word[0]) {
      const arr = word.split('');
      const tmp = arr[0];
      arr[0] = arr[i];
      arr[i] = tmp;
      return arr.join('');
    }
  }
  return null; // 全部字母相同，理論上單字庫不會有這種字
}

function answerCorrectly(session) {
  const view = getCurrentQuestionView(session);
  fillWord(session, view.entry.word);
  const result = checkAnswer(session);
  expect(result.correct).toBe(true);
  return result;
}

// 先答錯一次（會被記成一次 wrong attempt），reset 後再答對，
// 模擬「重試後答對」——一代規則：這種題目不算 first-try-correct。
function answerWithOneMistake(session) {
  const view = getCurrentQuestionView(session);
  const wrong = swapToWrong(view.entry.word);
  fillWord(session, wrong);
  const wrongResult = checkAnswer(session);
  expect(wrongResult.correct).toBe(false);
  resetForRetry(session);
  fillWord(session, view.entry.word);
  const rightResult = checkAnswer(session);
  expect(rightResult.correct).toBe(true);
}

function playAllCorrect(session) {
  for (;;) {
    answerCorrectly(session);
    const { finished } = advanceToNextQuestion(session);
    if (finished) break;
  }
}

// ---------- getThemes / getLevelDefsForTheme ----------

describe('getThemes', () => {
  it('回傳全部主題，形狀正確', () => {
    const themes = getThemes();
    expect(themes.length).toBeGreaterThan(0);
    const animals = themes.find((t) => t.id === 'animals');
    expect(animals).toMatchObject({ id: 'animals', name: '動物', icon: '🐾', color: '#ffb703' });
  });
});

describe('getLevelDefsForTheme', () => {
  it('長度分級主題（animals）：三個關卡，distractorCount/wordCount/playable 對應 data.json', () => {
    const defs = getLevelDefsForTheme('animals');
    expect(defs).toHaveLength(3);

    expect(defs[0]).toMatchObject({ key: '1', distractorCount: 0, wordCount: 6, playable: true });
    expect(defs[0].label).toContain('初級');
    expect(defs[0].label).toContain('3 字母');

    expect(defs[1]).toMatchObject({ key: '2', distractorCount: 1, wordCount: 5, playable: true });
    expect(defs[1].label).toContain('4 字母');

    expect(defs[2]).toMatchObject({ key: '3', distractorCount: 2, wordCount: 5, playable: true });
    expect(defs[2].label).toContain('5+ 字母');
  });

  it('單字數不足 MIN_WORDS_PER_LEVEL 的關卡 playable=false（colors 初級只有 1 個字）', () => {
    expect(MIN_WORDS_PER_LEVEL).toBe(3);
    const defs = getLevelDefsForTheme('colors');
    expect(defs[0].wordCount).toBe(1);
    expect(defs[0].playable).toBe(false);
  });

  it('自訂關卡主題（other）：用 customLevels，不受長度分級限制', () => {
    const defs = getLevelDefsForTheme('other');
    expect(defs.length).toBeGreaterThanOrEqual(2);

    const summer = defs.find((d) => d.key === 'summer_review_1');
    expect(summer).toBeTruthy();
    expect(summer.distractorCount).toBe(2);
    expect(summer.playable).toBe(true);
    expect(summer.label).toContain('暑假複習1');
    expect(summer.label).toContain(`${summer.wordCount} 字`);

    // wordCount 要等於實際能在 wordBank 裡找到的 wordIds 數量
    const words = getWordsForLevel('other', 'summer_review_1');
    expect(words.length).toBe(summer.wordCount);
    // 混合字母長度（自訂關卡的重點：不受長度分級限制）
    const lengths = new Set(words.map((w) => w.word.length));
    expect(lengths.size).toBeGreaterThan(1);
  });
});

describe('getValidLevelCombos / getAllWordsForTheme', () => {
  it('排除單字數不足的組合', () => {
    const combos = getValidLevelCombos();
    expect(combos).toContainEqual({ themeId: 'animals', key: '1' });
    expect(combos).not.toContainEqual({ themeId: 'colors', key: '1' });
  });

  it('getAllWordsForTheme 回傳整個主題的單字，不分關卡', () => {
    const words = getAllWordsForTheme('animals');
    expect(words.length).toBe(6 + 5 + 5);
    expect(words.every((w) => w.theme === 'animals')).toBe(true);
  });
});

// ---------- startLevel / getCurrentQuestionView ----------

describe('startLevel / getCurrentQuestionView', () => {
  it('出題數量等於該關卡單字數，tiles 數量 = 單字長度 + distractorCount', () => {
    const session1 = startLevel('animals', '1'); // distractorCount 0
    const view1 = getCurrentQuestionView(session1);
    expect(view1.total).toBe(6);
    expect(view1.index).toBe(0);
    expect(view1.slotCount).toBe(view1.entry.word.length);
    expect(view1.tiles.length).toBe(view1.entry.word.length);
    expect(view1.locked).toBe(false);
    expect(view1.awaitingNext).toBe(false);

    const session3 = startLevel('animals', '3'); // distractorCount 2
    const view3 = getCurrentQuestionView(session3);
    expect(view3.total).toBe(5);
    expect(view3.tiles.length).toBe(view3.entry.word.length + 2);
  });

  it('placeLetterInSlot / removeLastLetter 依序操作槽位', () => {
    const session = startLevel('animals', '2'); // distractorCount 1
    const view = getCurrentQuestionView(session);
    const word = view.entry.word;

    const firstTile = view.tiles.find((t) => t.letter === word[0]);
    const placeResult = placeLetterInSlot(session, firstTile.id);
    expect(placeResult).toEqual({ slotIndex: 0 });

    const viewAfter = getCurrentQuestionView(session);
    expect(viewAfter.slots[0].tileId).toBe(firstTile.id);
    expect(viewAfter.tiles.find((t) => t.id === firstTile.id).used).toBe(true);

    const removeResult = removeLastLetter(session);
    expect(removeResult).toEqual({ slotIndex: 0 });
    const viewAfterRemove = getCurrentQuestionView(session);
    expect(viewAfterRemove.slots[0].tileId).toBeNull();
    expect(viewAfterRemove.tiles.find((t) => t.id === firstTile.id).used).toBe(false);
  });
});

// ---------- advanceToNextQuestion guard ----------

describe('advanceToNextQuestion', () => {
  it('題目尚未答對（awaitingNext=false）時呼叫是 no-op，不會誤跳題', () => {
    const session = startLevel('numbers', '1');
    const before = getCurrentQuestionView(session);
    expect(before.awaitingNext).toBe(false);

    const { finished } = advanceToNextQuestion(session);
    expect(finished).toBe(false);

    const after = getCurrentQuestionView(session);
    expect(after.index).toBe(before.index);
    expect(after.entry.word).toBe(before.entry.word);
  });
});

// ---------- checkAnswer ----------

describe('checkAnswer', () => {
  it('答對回傳 correct=true；答錯回傳 correct=false 且維持 locked 直到 resetForRetry', () => {
    const session = startLevel('animals', '2');
    const view = getCurrentQuestionView(session);
    const wrong = swapToWrong(view.entry.word);

    fillWord(session, wrong);
    const wrongResult = checkAnswer(session);
    expect(wrongResult.correct).toBe(false);
    expect(wrongResult.entry.word).toBe(view.entry.word);
    expect(getCurrentQuestionView(session).locked).toBe(true);

    resetForRetry(session);
    expect(getCurrentQuestionView(session).locked).toBe(false);

    fillWord(session, view.entry.word);
    const rightResult = checkAnswer(session);
    expect(rightResult.correct).toBe(true);
    expect(getCurrentQuestionView(session).awaitingNext).toBe(true);
  });

  it('槽位未填滿時 checkAnswer 不會誤判正確，也不會鎖住 session', () => {
    const session = startLevel('objects', '1');
    const view = getCurrentQuestionView(session);
    const firstTile = view.tiles.find((t) => t.letter === view.entry.word[0]);
    placeLetterInSlot(session, firstTile.id);
    const result = checkAnswer(session);
    expect(result.correct).toBe(false);
    expect(getCurrentQuestionView(session).locked).toBe(false);
  });
});

// ---------- useHint 安全閥 + calcStars 邊界 ----------

describe('useHint 安全閥（用過提示這題的星等被封頂）', () => {
  it('5 題全對但其中 1 題用了提示 -> 視同 non-first-try，accuracy=0.8，被封頂在 2 星', () => {
    const session = startLevel('animals', '3'); // animals 高級：5 個字，distractorCount 2
    let hinted = false;

    for (;;) {
      const view = getCurrentQuestionView(session);
      if (!hinted) {
        hinted = true;
        // 對第一題用一次提示，之後補完剩下的字母
        let hint = useHint(session);
        expect(hint).toBeTruthy();
        // 再用一次應該回傳 null（每題限用一次）
        expect(useHint(session)).toBeNull();
        const afterHintView = getCurrentQuestionView(session);
        const remaining = afterHintView.entry.word
          .split('')
          .filter((_, idx) => afterHintView.slots[idx].tileId === null);
        // 依序填完剩下的空槽
        for (const ch of remaining) {
          const v = getCurrentQuestionView(session);
          const tile = v.tiles.find((t) => !t.used && t.letter === ch);
          placeLetterInSlot(session, tile.id);
        }
        const result = checkAnswer(session);
        expect(result.correct).toBe(true);
      } else {
        answerCorrectly(session);
      }
      const { finished } = advanceToNextQuestion(session);
      if (finished) break;
    }

    const { stars, accuracy, isNewSticker } = finishLevel(session);
    expect(accuracy).toBeCloseTo(0.8, 5);
    expect(stars).toBe(2); // 若沒有用提示應該是 3 星，這裡驗證安全閥確實封頂
    expect(isNewSticker).toBe(false);
  });
});

describe('finishLevel 星等（calcStars）邊界條件', () => {
  it('全對且無任何錯誤嘗試 -> 3 星，accuracy=1，且是第一次三星（isNewSticker=true）', () => {
    const session = startLevel('animals', '1'); // 6 個字，全新的 key，避免跟其他測試互相汙染
    playAllCorrect(session);
    const { stars, accuracy, isNewSticker } = finishLevel(session);
    expect(accuracy).toBe(1);
    expect(stars).toBe(3);
    expect(isNewSticker).toBe(true);
  });

  it('5 題中 1 題重試後才答對 -> accuracy=0.8，未滿分不算 3 星，落在 2 星', () => {
    const session = startLevel('objects', '1'); // 5 個字，distractorCount 0
    let mistakeMade = false;
    for (;;) {
      if (!mistakeMade) {
        mistakeMade = true;
        answerWithOneMistake(session);
      } else {
        answerCorrectly(session);
      }
      const { finished } = advanceToNextQuestion(session);
      if (finished) break;
    }
    const { stars, accuracy } = finishLevel(session);
    expect(accuracy).toBeCloseTo(0.8, 5);
    expect(stars).toBe(2);
  });

  it('5 題中 2 題重試後才答對 -> accuracy=0.6，落在 1 星', () => {
    const session = startLevel('objects', '2'); // 5 個字，distractorCount 1
    let mistakes = 0;
    for (;;) {
      if (mistakes < 2) {
        mistakes++;
        answerWithOneMistake(session);
      } else {
        answerCorrectly(session);
      }
      const { finished } = advanceToNextQuestion(session);
      if (finished) break;
    }
    const { stars, accuracy } = finishLevel(session);
    expect(accuracy).toBeCloseTo(0.6, 5);
    expect(stars).toBe(1);
  });

  it('5 題中 3 題重試後才答對 -> accuracy=0.4，掉到 0 星', () => {
    const session = startLevel('objects', '3'); // objects 高級：5 個字，distractorCount 2（獨立 key）
    let mistakes = 0;
    for (;;) {
      if (mistakes < 3) {
        mistakes++;
        answerWithOneMistake(session);
      } else {
        answerCorrectly(session);
      }
      const { finished } = advanceToNextQuestion(session);
      if (finished) break;
    }
    const { stars, accuracy } = finishLevel(session);
    expect(accuracy).toBeCloseTo(0.4, 5);
    expect(stars).toBe(0);
  });

  it('同一關卡第二次拿三星，isNewSticker 不再是 true（貼紙只在第一次三星給）', () => {
    const first = startLevel('body', '1'); // 4 個字，distractorCount 0，獨立 key 避免汙染其他測試
    playAllCorrect(first);
    const firstResult = finishLevel(first);
    expect(firstResult.stars).toBe(3);
    expect(firstResult.isNewSticker).toBe(true);

    const second = startLevel('body', '1');
    playAllCorrect(second);
    const secondResult = finishLevel(second);
    expect(secondResult.stars).toBe(3);
    expect(secondResult.isNewSticker).toBe(false);
  });
});
