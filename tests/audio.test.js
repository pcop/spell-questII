import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { phonicsChunkAudioName } from '../src/audio/index.js';

// ---------------------------------------------------------------------------
// 這支模組大量依賴瀏覽器專屬 API（Audio / SpeechSynthesis / AudioContext），
// vitest 跑在 node 環境下沒有這些全域物件，所以測試重點放在：
//   1. 不依賴瀏覽器 API 的純邏輯（phonicsChunkAudioName）。
//   2. 用最小可行的 mock 替代 Audio/SpeechSynthesis/AudioContext，驗證
//      setSpeechRate/setSoundEnabled 等「狀態切換」確實影響之後的行為，
//      以及 unlockAudio/speakWord/speakPhonics 的控制流程（誰呼叫了誰、
//      chunk 順序、silent chunk 有沒有被跳過、失敗時有沒有退回 TTS）。
//   3. 完全沒有瀏覽器 API 時（真實 vitest node 環境的預設狀態），
//      每個 export 都不能拋例外，必須優雅降級。
// ---------------------------------------------------------------------------

// ---------- 純邏輯：phonicsChunkAudioName ----------

describe('phonicsChunkAudioName', () => {
  // 直接照抄一代 fly 的 phonics 資料（見 CLAUDE.md audioOverrides 說明）
  const flyPhonics = { chunks: ['f', 'l', 'y'], silent: [], audioOverrides: { '2': 'y-long-i' } };

  it('無 override 的 chunk 索引回傳原本的拼字文字', () => {
    expect(phonicsChunkAudioName(flyPhonics, 0)).toBe('f');
    expect(phonicsChunkAudioName(flyPhonics, 1)).toBe('l');
  });

  it('有 override 的索引回傳虛擬 chunk id，而不是 chunks 本身的文字', () => {
    expect(phonicsChunkAudioName(flyPhonics, 2)).toBe('y-long-i');
  });

  it('phonics 完全沒有 audioOverrides 欄位時，一律退回 chunks[index]', () => {
    const catPhonics = { chunks: ['c', 'a', 't'] };
    expect(phonicsChunkAudioName(catPhonics, 0)).toBe('c');
    expect(phonicsChunkAudioName(catPhonics, 1)).toBe('a');
    expect(phonicsChunkAudioName(catPhonics, 2)).toBe('t');
  });
});

// ---------- 有狀態的行為：需要 mock 瀏覽器 API ----------

class MockAudio {
  constructor() {
    this.src = '';
    this.muted = false;
    this.playbackRate = 1;
    this.currentTime = 0;
    this.preload = '';
    this.onended = null;
    this.onerror = null;
    this._listeners = {};
    MockAudio.instances.push(this);
  }
  play() {
    MockAudio.playCalls.push(this.src);
    return Promise.resolve();
  }
  pause() {}
  addEventListener(evt, fn) {
    (this._listeners[evt] ||= []).push(fn);
  }
  removeEventListener(evt, fn) {
    if (!this._listeners[evt]) return;
    this._listeners[evt] = this._listeners[evt].filter((f) => f !== fn);
  }
  // 測試專用：手動觸發事件，模擬「播放完成」或「載入失敗」
  _emit(evt) {
    if (evt === 'ended' && typeof this.onended === 'function') this.onended();
    if (evt === 'error' && typeof this.onerror === 'function') this.onerror();
    (this._listeners[evt] || []).slice().forEach((fn) => fn());
  }
}
MockAudio.instances = [];
MockAudio.playCalls = [];

class MockOscillator {
  constructor() {
    this.frequency = { value: 0 };
    this.type = '';
  }
  connect() {}
  start() {}
  stop() {}
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    MockAudioContext.instances.push(this);
  }
  createOscillator() {
    const osc = new MockOscillator();
    MockAudioContext.oscillators.push(osc);
    return osc;
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
  }
  resume() {}
}
MockAudioContext.instances = [];
MockAudioContext.oscillators = [];

class MockSpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
    this.rate = 1;
    this.voice = null;
    this.lang = '';
    this.onend = null;
    this.onerror = null;
  }
}

function installBrowserMocks() {
  MockAudio.instances.length = 0;
  MockAudio.playCalls.length = 0;
  MockAudioContext.instances.length = 0;
  MockAudioContext.oscillators.length = 0;

  globalThis.Audio = MockAudio;
  globalThis.AudioContext = MockAudioContext;
  globalThis.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
  globalThis.speechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: vi.fn(() => []),
    addEventListener: vi.fn(),
  };
}

function removeBrowserMocks() {
  delete globalThis.Audio;
  delete globalThis.AudioContext;
  delete globalThis.SpeechSynthesisUtterance;
  delete globalThis.speechSynthesis;
}

// 每個測試都要一份「乾淨」的 audio 模組實例，因為模組內部用了 module-level
// 單例變數（wordAudioEl/phonicsAudioEl/audioCtx/...），不重置模組的話測試會
// 互相汙染、變成執行順序相依。
async function freshAudioModule() {
  vi.resetModules();
  return import('../src/audio/index.js');
}

afterEach(() => {
  removeBrowserMocks();
});

describe('setSoundEnabled 影響合成音效', () => {
  it('關閉音效後 playCorrectSound 不會建立/使用 oscillator，重新開啟後才會', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    audio.unlockAudio(); // 建立 audioCtx（合成音效需要先解鎖）
    MockAudioContext.oscillators.length = 0;

    audio.setSoundEnabled(false);
    audio.playCorrectSound();
    expect(MockAudioContext.oscillators.length).toBe(0);

    audio.setSoundEnabled(true);
    audio.playCorrectSound();
    expect(MockAudioContext.oscillators.length).toBeGreaterThan(0);
  });

  it('playWrongSound / playStarPopSound 也遵守 setSoundEnabled(false)', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();
    audio.unlockAudio();
    MockAudioContext.oscillators.length = 0;

    audio.setSoundEnabled(false);
    audio.playWrongSound();
    audio.playStarPopSound();
    expect(MockAudioContext.oscillators.length).toBe(0);
  });
});

describe('setSpeechRate 影響之後的播放速度', () => {
  it('speakWord 使用 setSpeechRate 設定過的語速當作預設 playbackRate', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    audio.setSpeechRate(0.5);
    audio.speakWord('cat');

    const el = MockAudio.instances.find((a) => a.src === '/words-audio/cat.mp3');
    expect(el).toBeTruthy();
    expect(el.playbackRate).toBe(0.5);
  });

  it('明確傳入的 opts.rate 覆蓋 setSpeechRate 設定的預設值', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    audio.setSpeechRate(0.5);
    audio.speakWord('dog', { rate: 1.0 });

    const el = MockAudio.instances.find((a) => a.src === '/words-audio/dog.mp3');
    expect(el.playbackRate).toBe(1.0);
  });
});

describe('speakWord', () => {
  it('播放成功時只用 Audio，不會呼叫 speechSynthesis.speak', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();
    const onEnded = vi.fn();

    audio.speakWord('cat', { onEnded });
    const el = MockAudio.instances.find((a) => a.src === '/words-audio/cat.mp3');
    el._emit('ended');

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(globalThis.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it('音檔載入失敗時退回瀏覽器 SpeechSynthesis', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    audio.speakWord('unknown-word');
    const el = MockAudio.instances.find((a) => a.src === '/words-audio/unknown-word.mp3');
    el.onerror(); // 模擬音檔 404 / 載入失敗

    expect(globalThis.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    const utter = globalThis.speechSynthesis.speak.mock.calls[0][0];
    expect(utter.text).toBe('unknown-word');
  });

  it('空字串/undefined 不會嘗試播放，直接呼叫 onEnded', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();
    const onEnded = vi.fn();

    audio.speakWord('', { onEnded });
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(MockAudio.instances.length).toBe(0);
  });
});

describe('speakPhonics', () => {
  it('依序播放非 silent 的 chunk（可能經過 audioOverrides），最後播放整個單字', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    const entry = {
      word: 'fly',
      phonics: { chunks: ['f', 'l', 'y'], silent: [], audioOverrides: { '2': 'y-long-i' } },
    };
    const seenChunks = [];
    const onEnded = vi.fn();

    audio.speakPhonics(entry, { onEachChunk: (i) => seenChunks.push(i), onEnded });

    // 目前呼叫順序：先摸一下 wordAudioEl（pause/reset），再建立/使用 phonicsAudioEl 播第一個 chunk
    const wEl = MockAudio.instances[0];
    const pEl = MockAudio.instances[1];

    expect(pEl.src).toBe('/phonics-audio/f.mp3');
    pEl._emit('ended');

    expect(pEl.src).toBe('/phonics-audio/l.mp3');
    pEl._emit('ended');

    // index 2 的 'y' 有 override，音檔查找用 y-long-i，不是 'y'
    expect(pEl.src).toBe('/phonics-audio/y-long-i.mp3');
    pEl._emit('ended');

    // 三個 chunk 播完後，播放整個單字
    expect(wEl.src).toBe('/words-audio/fly.mp3');
    wEl._emit('ended');

    expect(seenChunks).toEqual([0, 1, 2]);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('跳過 silent chunk 索引，onEachChunk 不會收到 silent 的索引', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    const entry = {
      word: 'cake',
      phonics: { chunks: ['c', 'a', 'k', 'e'], silent: [3] }, // 字尾 e 不發音
    };
    const seenChunks = [];
    const onEnded = vi.fn();

    audio.speakPhonics(entry, { onEachChunk: (i) => seenChunks.push(i), onEnded });

    const wEl = MockAudio.instances[0];
    const pEl = MockAudio.instances[1];

    expect(pEl.src).toBe('/phonics-audio/c.mp3');
    pEl._emit('ended');
    expect(pEl.src).toBe('/phonics-audio/a.mp3');
    pEl._emit('ended');
    expect(pEl.src).toBe('/phonics-audio/k.mp3');
    pEl._emit('ended');

    // silent 的索引 3（'e'）被跳過，直接播整個單字
    expect(wEl.src).toBe('/words-audio/cake.mp3');
    wEl._emit('ended');

    expect(seenChunks).toEqual([0, 1, 2]);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('某個 chunk 音檔載入失敗時，該 chunk 退回 TTS 唸出文字，接著繼續播下一個 chunk', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    const entry = {
      word: 'cat',
      phonics: { chunks: ['c', 'a', 't'], silent: [] },
    };
    const seenChunks = [];
    audio.speakPhonics(entry, { onEachChunk: (i) => seenChunks.push(i) });

    const pEl = MockAudio.instances[1];
    expect(pEl.src).toBe('/phonics-audio/c.mp3');
    pEl._emit('error'); // 第一個 chunk 音檔失敗

    expect(globalThis.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    const utter = globalThis.speechSynthesis.speak.mock.calls[0][0];
    expect(utter.text).toBe('c');

    // TTS 的 utterance 播完（onend）後才繼續下一個 chunk
    utter.onend();
    expect(pEl.src).toBe('/phonics-audio/a.mp3');
    expect(seenChunks).toEqual([0, 1]);
  });

  it('phonics 缺失或空 chunks 時直接退回 speakWord', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    audio.speakPhonics({ word: 'cat', phonics: { chunks: [] } });
    expect(MockAudio.instances.some((a) => a.src === '/words-audio/cat.mp3')).toBe(true);
  });
});

describe('unlockAudio', () => {
  it('第一次呼叫會建立 AudioContext，之後重複呼叫不會重複建立', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    audio.unlockAudio();
    audio.unlockAudio();
    audio.unlockAudio();

    expect(MockAudioContext.instances.length).toBe(1);
  });

  it('會碰一下 speechSynthesis，且會靜音播放一次 words-audio/cat.mp3 跟 phonics-audio/a.mp3 來解鎖', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    audio.unlockAudio();

    expect(globalThis.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    const srcs = MockAudio.instances.map((a) => a.src);
    expect(srcs).toContain('/words-audio/cat.mp3');
    expect(srcs).toContain('/phonics-audio/a.mp3');
  });
});

describe('preloadEntryAudio', () => {
  it('用 phonicsChunkAudioName 決定的檔名（含 override）建立預載音檔', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    const entry = {
      word: 'Fly',
      phonics: { chunks: ['f', 'l', 'y'], audioOverrides: { '2': 'y-long-i' } },
    };
    audio.preloadEntryAudio(entry);

    const srcs = MockAudio.instances.map((a) => a.src);
    expect(srcs).toContain('/words-audio/fly.mp3'); // 單字轉小寫
    expect(srcs).toContain('/phonics-audio/f.mp3');
    expect(srcs).toContain('/phonics-audio/l.mp3');
    expect(srcs).toContain('/phonics-audio/y-long-i.mp3');
    expect(srcs).not.toContain('/phonics-audio/y.mp3');
  });

  it('同一個 url 不會重複建立 Audio 物件（快取）', async () => {
    installBrowserMocks();
    const audio = await freshAudioModule();

    const entry = { word: 'cat', phonics: { chunks: [] } };
    audio.preloadEntryAudio(entry);
    audio.preloadEntryAudio(entry);

    const count = MockAudio.instances.filter((a) => a.src === '/words-audio/cat.mp3').length;
    expect(count).toBe(1);
  });
});

describe('沒有任何瀏覽器 API 時（真實 vitest node 環境的預設狀態）優雅降級', () => {
  it('每個 export 呼叫都不拋例外', async () => {
    removeBrowserMocks();
    const audio = await freshAudioModule();

    expect(() => audio.initVoices()).not.toThrow();
    expect(() => audio.unlockAudio()).not.toThrow();
    expect(() => audio.speakWord('cat')).not.toThrow();
    expect(() =>
      audio.speakPhonics({ word: 'cat', phonics: { chunks: ['c', 'a', 't'], silent: [] } })
    ).not.toThrow();
    expect(() => audio.preloadEntryAudio({ word: 'cat', phonics: { chunks: ['c', 'a', 't'] } })).not.toThrow();
    expect(() => audio.playCorrectSound()).not.toThrow();
    expect(() => audio.playWrongSound()).not.toThrow();
    expect(() => audio.playStarPopSound()).not.toThrow();
    expect(() => audio.setSoundEnabled(false)).not.toThrow();
    expect(() => audio.setSpeechRate(0.5)).not.toThrow();
  });
});
