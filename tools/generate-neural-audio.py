#!/usr/bin/env python3
"""
generate-neural-audio.py

使用微軟 Edge-TTS (en-US-JennyNeural) 產生高品質神經網路真人發音音檔：
1. words-audio/: 包含 data.json 內所有單字的高音質朗讀音檔。
2. phonics-audio/: 包含 53 個自然拼讀音素 (Phonics Chunks) 的清晰真人發音音檔。

需要：python3, pip install edge-tts, ffmpeg
執行：python3 tools/generate-neural-audio.py
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import edge_tts

VOICE = "en-US-JennyNeural"
# phonics 音素統一對齊的峰值 (dBFS)。留 3dB headroom 給 mp3 編碼的 overshoot。
PEAK_TARGET_DB = -3.0
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 二代改成 Vite 專案結構：音檔搬到 public/（Vite 靜態資產目錄），data.json
# 搬到 src/data/ 底下（見 規劃.md B 段、loadGameData.js）。一代這三個路徑是
# 直接掛在專案根目錄，Phase 0 搬遷資產時把檔案內容複製過來了，但這三個路徑
# 常數當時沒有同步更新——如果照舊路徑執行 `main()`，一開就會在讀
# DATA_FILE 時 FileNotFoundError（新專案根目錄沒有 data.json）。
WORDS_DIR = os.path.join(ROOT_DIR, "public", "words-audio")
PHONICS_DIR = os.path.join(ROOT_DIR, "public", "phonics-audio")
LETTERS_DIR = os.path.join(ROOT_DIR, "public", "letters-audio")
DATA_FILE = os.path.join(ROOT_DIR, "src", "data", "data.json")

# 54 個 Phonics 音素的自然發音來源設定
CHUNK_CONFIG = {
    # 單字母短母音（以標準自然發音教學代表詞生成短母音）
    "a": {"word": "at", "start": 0.0, "end": 0.35},
    "e": {"word": "ed", "start": 0.0, "end": 0.32},
    "i": {"word": "it", "start": 0.0, "end": 0.30},
    "o": {"word": "ox", "start": 0.0, "end": 0.35},
    "u": {"word": "up", "start": 0.0, "end": 0.30},
    "y": {"word": "happy", "start": 0.28, "end": 0.50},  # /i/

    # 字尾 y 的另一種讀法：單音節字（fly/sky/cry...）唸長 i /aɪ/，跟上面 "y"（多音節字
    # 字尾唸長 e /i/，例如 cherry/happy）不同音。chunk 文字查找是 by-text 的，"y" 這個
    # 拼法本身已經被 cherry 那組用掉了，所以另外開一個不會撞名的虛擬 chunk id，只透過
    # data.json 裡個別單字的 phonics.audioOverrides 指定使用（見 fly 的資料項）。
    "y-long-i": {"word": "sky", "start": 0.18, "end": 0.55},  # /aɪ/

    # 母音組合
    "ee": {"word": "see", "start": 0.10, "end": 0.50},
    "ea": {"word": "eat", "start": 0.0, "end": 0.40},
    "oo": {"word": "moon", "start": 0.10, "end": 0.50},
    "oo-short": {"word": "book", "start": 0.10, "end": 0.35},
    "ow": {"word": "cow", "start": 0.10, "end": 0.55},
    "ou": {"word": "out", "start": 0.0, "end": 0.42},
    "ay": {"word": "say", "start": 0.10, "end": 0.50},
    "ue": {"word": "blue", "start": 0.15, "end": 0.55},
    "eigh": {"word": "eight", "start": 0.0, "end": 0.40},
    "oa": {"word": "oak", "start": 0.0, "end": 0.40},
    "aw": {"word": "saw", "start": 0.10, "end": 0.50},

    # R-controlled 母音
    "ar": {"word": "art", "start": 0.0, "end": 0.45},
    "er": {"word": "her", "start": 0.10, "end": 0.50},
    "ir": {"word": "bird", "start": 0.10, "end": 0.50},
    "or": {"word": "for", "start": 0.10, "end": 0.50},
    "ur": {"word": "fur", "start": 0.10, "end": 0.50},
    "air": {"word": "air", "start": 0.0, "end": 0.45},
    "ear": {"word": "ear", "start": 0.0, "end": 0.45},
    "ear-pear": {"word": "pear", "start": 0.10, "end": 0.50},
    "ear-heart": {"word": "heart", "start": 0.10, "end": 0.35},
    "our": {"word": "four", "start": 0.10, "end": 0.50},
    "oor": {"word": "door", "start": 0.10, "end": 0.50},

    # 單子音
    "b": {"word": "bat", "start": 0.0, "end": 0.22},
    "c": {"word": "cat", "start": 0.0, "end": 0.22},
    "d": {"word": "dog", "start": 0.0, "end": 0.22},
    "f": {"word": "fox", "start": 0.0, "end": 0.30},
    "g": {"word": "go", "start": 0.0, "end": 0.25},
    "h": {"word": "hat", "start": 0.0, "end": 0.25},
    "j": {"word": "jam", "start": 0.0, "end": 0.28},
    "k": {"word": "kite", "start": 0.0, "end": 0.22},
    "l": {"word": "leg", "start": 0.0, "end": 0.30},
    "m": {"word": "man", "start": 0.0, "end": 0.35},
    "n": {"word": "net", "start": 0.0, "end": 0.35},
    "p": {"word": "pen", "start": 0.0, "end": 0.22},
    "q": {"word": "quick", "start": 0.0, "end": 0.28},
    "r": {"word": "red", "start": 0.0, "end": 0.30},
    "s": {"word": "sun", "start": 0.0, "end": 0.35},
    "t": {"word": "ten", "start": 0.0, "end": 0.22},
    "v": {"word": "van", "start": 0.0, "end": 0.35},
    "w": {"word": "win", "start": 0.0, "end": 0.28},
    "x": {"word": "box", "start": 0.35, "end": 0.57},
    "z": {"word": "zoo", "start": 0.0, "end": 0.35},

    # 雙字母子音 & 疊字
    "ch": {"word": "chair", "start": 0.0, "end": 0.30},
    "sh": {"word": "sheep", "start": 0.0, "end": 0.35},
    "th": {"word": "think", "start": 0.0, "end": 0.30},
    # ck 在自然拼讀教學裡就是教成 /k/，而從 duck 尾端裁出來的 0.1 秒無聲爆破
    # 不管怎麼拉音量都不會「聽起來清楚」（原本峰值 -20.6dB，放大只是放大噪音）。
    # 直接複製 k 的成品，檔名維持 ck.mp3，前端與 data-consistency 測試都不用動。
    "ck": {"alias": "k"},
    "wh": {"word": "white", "start": 0.0, "end": 0.30},
    # nk 是 /ŋk/ 兩個音，不能像 ck 一樣別名到 k（會教錯）。原本的 0.41~0.51 只
    # 取到尾端那一下爆破，整檔在 -50dB 門檻之下（等於沒聲音）。量 pink 的能量
    # 包絡：0.06~0.13 是母音 /ɪ/、0.14~0.32 是鼻音 /ŋ/（能量緩降、ZCR 低）、
    # 0.33~0.42 是閉塞、0.43~0.51 才是 /k/ 爆破，所以取 0.20~0.53 含完整 /ŋk/。
    # 注意**不能**擴成整個 "ink" 韻腳——pink 的 chunks 是 p/i/nk，那樣播放時
    # /ɪ/ 會被唸兩次。
    "nk": {"word": "pink", "start": 0.20, "end": 0.53},
    # 英語疊字只發一個音，ll 沒有理由跟 l 走不同音源（原本取自 ball 尾端，
    # 峰值 -14.8dB 偏小，等於多養一個會出問題的檔）。
    "ll": {"alias": "l"},
    "rr": {"word": "red", "start": 0.0, "end": 0.30},
    "pp": {"word": "pen", "start": 0.0, "end": 0.22},
    "eye": {"word": "eye", "start": 0.0, "end": 0.50},
}


async def generate_tts(text: str, out_path: str, rate: str = "-5%"):
    """使用 Edge-TTS 產生原始語音"""
    comm = edge_tts.Communicate(text, VOICE, rate=rate)
    await comm.save(out_path)


def _run_filters(src: str, dst: str, filters: list, encode_mp3: bool = True):
    """套用一組 ffmpeg 濾鏡；dst 副檔名決定輸出格式"""
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", ",".join(filters)]
    if encode_mp3:
        cmd += ["-codec:a", "libmp3lame", "-qscale:a", "2"]
    cmd.append(dst)
    subprocess.run(cmd, check=True)


def measure_max_volume(path: str) -> float:
    """使用 ffmpeg volumedetect 讀出峰值 (dBFS)；讀不到回傳 0.0"""
    cmd = ["ffmpeg", "-i", path, "-af", "volumedetect", "-f", "null", "-"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    for line in res.stderr.splitlines():
        if "max_volume:" in line:
            try:
                return float(line.split("max_volume:")[1].replace("dB", "").strip())
            except Exception:
                pass
    return 0.0


def process_audio(raw_mp3: str, out_mp3: str, start: float = 0.0, end: float = None):
    """裁切出單一 phonics 音素，去除前後靜音、淡入淡出，並把峰值拉到 PEAK_TARGET_DB

    兩階段處理：先做裁切與淡化輸出成 WAV（無損中間檔），量測峰值後再套固定
    增益並一次編成 mp3。不用兩次 mp3 編碼，0.2 秒等級的短片段經不起兩輪失真。
    """
    filters = [
        "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB"
    ]
    if start > 0:
        filters.append(f"atrim=start={start}")
    if end is not None:
        filters.append(f"atrim=end={end}")
    # atrim 不會重設時間戳，裁切後的片段仍帶著原始（裁切前）的 PTS，後面所有
    # 「用片段自己的時間」在算的濾鏡都會被帶歪，所以這裡一定要 asetpts 歸零。
    filters.append("asetpts=PTS-STARTPTS")
    filters.append("silenceremove=stop_periods=1:stop_duration=0.03:stop_threshold=-45dB")

    # 淡入淡出避免切斷處的爆音 (click sound)。
    #
    # 淡出**不能**用 `afade=t=out:st=<絕對秒數>`：afade 的 st 是片段內的絕對
    # 時間，寫死成 0.2 就代表「所有音檔一律在 0.24 秒處歸零並永遠保持靜音」，
    # 而這批音素有 43 個長度超過 0.24 秒——它們的後半段全部被淡成 -91dB 的
    # 死寂（ee/oo/ar/air/ear 這種長母音被砍掉近半，聽起來就是含糊、被掐斷；
    # 短母音則連載體字的收尾子音都聽不到，例如 "at" 的 /t/）。更早之前還因為
    # 缺 asetpts 讓 ck/ll/nk/x/y 整檔靜音，加上 asetpts 只治好了「全靜音」，
    # 「只剩前 0.24 秒」這個更隱蔽的症狀一直活著——check_mean_volume 只抓
    # ≤ -90dB，混著靜音尾巴的 mean 仍有 -18dB，看起來完全正常。
    #
    # 正確作法是讓淡出相對於**片段結尾**：反轉、淡入、再轉回來。這樣不論裁切
    # 後長度是多少都只影響最後 30ms。
    filters.append("afade=t=in:st=0:d=0.01")
    filters.append("areverse")
    filters.append("afade=t=in:st=0:d=0.03")
    filters.append("areverse")

    with tempfile.TemporaryDirectory() as tmpdir:
        wav_tmp = os.path.join(tmpdir, "trimmed.wav")
        _run_filters(raw_mp3, wav_tmp, filters, encode_mp3=False)

        # 固定增益而不是 loudnorm：loudnorm 是為 >=3 秒的素材設計的，套在
        # 0.1~0.5 秒的音素上打不中 LUFS 目標（實測 ck 仍停在 -24dB、ee 在
        # -15.6dB），而且會改動長度（前後 padding），會干擾播放層的節奏控制。
        # 這批檔真正的毛病是峰值散得太開（ck/nk/x/ll 比其他檔低 10~15dB），
        # 對齊峰值就夠，而且長度完全不動、可預測。
        peak = measure_max_volume(wav_tmp)
        gain = PEAK_TARGET_DB - peak
        _run_filters(wav_tmp, out_mp3, [f"volume={gain:.2f}dB"], encode_mp3=True)


def process_word_audio(raw_mp3: str, out_mp3: str):
    """單字語音前後去除靜音並標準化音量"""
    # stop_duration 一定要明顯大於單字內部塞音（p/b/t/d/k/g、ck 等）的閉塞停頓
    # （實測約 40~100ms），否則 stop_periods=1 會把這種詞中停頓誤判成單字唸完、
    # 直接把後面的音節切掉——例如 chicken/spoon/apple/purple/duck 都曾經因為
    # stop_duration=0.05 被攔腰截斷，只剩前半段。真正的尾端靜音（TTS 唸完一個
    # 單字後的停頓）實測約 1 秒以上，0.3 對兩者都留有充足安全邊界。
    filters = [
        "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB",
        "silenceremove=stop_periods=1:stop_duration=0.3:stop_threshold=-50dB",
        "loudnorm=I=-16:TP=-1.5:LRA=11"
    ]
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", raw_mp3,
        "-af", ",".join(filters),
        "-codec:a", "libmp3lame", "-qscale:a", "2",
        out_mp3
    ]
    subprocess.run(cmd, check=True)


def process_letter_audio(raw_mp3: str, out_mp3: str):
    """字母名稱語音（A-Z）前後去除靜音並標準化音量"""
    filters = [
        "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB",
        "silenceremove=stop_periods=1:stop_duration=0.1:stop_threshold=-45dB",
        "loudnorm=I=-16:TP=-1.5:LRA=11"
    ]
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", raw_mp3,
        "-af", ",".join(filters),
        "-codec:a", "libmp3lame", "-qscale:a", "2",
        out_mp3
    ]
    subprocess.run(cmd, check=True)


def check_mean_volume(mp3_path: str) -> float:
    """使用 ffmpeg volumedetect 檢查 mean_volume (dB)"""
    cmd = ["ffmpeg", "-i", mp3_path, "-af", "volumedetect", "-f", "null", "-"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    for line in res.stderr.splitlines():
        if "mean_volume:" in line:
            try:
                val = float(line.split("mean_volume:")[1].replace("dB", "").strip())
                return val
            except Exception:
                pass
    return 0.0


def probe_duration(mp3_path: str) -> float:
    """讀出音檔總長度（秒）"""
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration",
           "-of", "csv=p=0", mp3_path]
    res = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return float(res.stdout.strip())
    except Exception:
        return 0.0


def check_trailing_silence(mp3_path: str) -> float:
    """回傳尾端靜音長度（秒）。0 代表全程有聲。

    check_mean_volume 只能抓「整檔靜音」，抓不到「後半段被淡成靜音」——正是
    afade 絕對時間那個 bug 能潛伏這麼久的原因（混著靜音尾巴的 mean 看起來很
    正常）。這個檢查直接比對「有聲到哪裡」與「檔案多長」。
    """
    cmd = ["ffmpeg", "-i", mp3_path, "-af", "silencedetect=n=-50dB:d=0.02", "-f", "null", "-"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    starts = [ln.split("silence_start:")[1].strip()
              for ln in res.stderr.splitlines() if "silence_start:" in ln]
    if not starts:
        return 0.0
    try:
        voiced_end = float(starts[0])
    except Exception:
        return 0.0
    return max(0.0, probe_duration(mp3_path) - voiced_end)


async def generate_words_audio():
    os.makedirs(WORDS_DIR, exist_ok=True)
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    words = sorted(list(set(entry["word"].strip().lower() for entry in data["wordBank"])))
    print(f"🎙️ 開始產生 {len(words)} 個單字音檔 (words-audio/)...")

    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, word in enumerate(words, 1):
            raw_tmp = os.path.join(tmpdir, f"word_{word}_raw.mp3")
            out_file = os.path.join(WORDS_DIR, f"{word}.mp3")
            try:
                await generate_tts(word, raw_tmp, rate="-20%")
                process_word_audio(raw_tmp, out_file)
                vol = check_mean_volume(out_file)
                if vol <= -90.0:
                    print(f"  [{idx}/{len(words)}] ⚠️ {word}.mp3 疑似靜音 ({vol} dB)")
                else:
                    print(f"  [{idx}/{len(words)}] ✅ {word}.mp3 ({vol} dB)")
            except Exception as e:
                print(f"  [{idx}/{len(words)}] ❌ {word}.mp3 錯誤: {e}")


async def generate_phonics_audio(target_chunks=None, out_dir=None):
    """生成 phonics 音素音檔

    out_dir 預設寫進 public/phonics-audio/，傳別的目錄就能先生成到暫存區給人
    試聽、確認沒問題再覆蓋正式資產（音檔是二進位，改壞了 diff 看不出來）。
    """
    out_dir = out_dir or PHONICS_DIR
    os.makedirs(out_dir, exist_ok=True)
    chunks_to_gen = {k: v for k, v in CHUNK_CONFIG.items() if (target_chunks is None or k in target_chunks)}
    print(f"\n🎧 開始產生 {len(chunks_to_gen)} 個自然拼讀音素 -> {out_dir}")

    # 別名（ck->k、ll->l）等到本體都生完再處理，才保證來源檔已經存在
    aliases = {k: v["alias"] for k, v in chunks_to_gen.items() if "alias" in v}
    real = {k: v for k, v in chunks_to_gen.items() if "alias" not in v}

    def report(idx, total, chunk, out_file, extra=""):
        vol = check_mean_volume(out_file)
        tail = check_trailing_silence(out_file)
        if vol <= -90.0:
            print(f"  [{idx}/{total}] ⚠️ {chunk}.mp3 疑似靜音 ({vol} dB)")
        elif tail > 0.1:
            print(f"  [{idx}/{total}] ⚠️ {chunk}.mp3 尾端有 {tail:.2f}s 靜音（疑似被截斷）{extra}")
        else:
            print(f"  [{idx}/{total}] ✅ {chunk}.mp3 {extra}({vol} dB, 尾靜音 {tail:.2f}s)")

    total = len(chunks_to_gen)
    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, (chunk, cfg) in enumerate(real.items(), 1):
            raw_tmp = os.path.join(tmpdir, f"chunk_{chunk}_raw.mp3")
            out_file = os.path.join(out_dir, f"{chunk}.mp3")
            try:
                await generate_tts(cfg["word"], raw_tmp, rate="-20%")
                process_audio(raw_tmp, out_file, start=cfg["start"], end=cfg["end"])
                report(idx, total, chunk, out_file, extra=f"(源自: {cfg['word']}) ")
            except Exception as e:
                print(f"  [{idx}/{total}] ❌ {chunk}.mp3 錯誤: {e}")

    for idx, (chunk, src_chunk) in enumerate(aliases.items(), len(real) + 1):
        src_file = os.path.join(out_dir, f"{src_chunk}.mp3")
        out_file = os.path.join(out_dir, f"{chunk}.mp3")
        if not os.path.exists(src_file):
            print(f"  [{idx}/{total}] ❌ {chunk}.mp3 別名來源 {src_chunk}.mp3 不存在")
            continue
        shutil.copyfile(src_file, out_file)
        report(idx, total, chunk, out_file, extra=f"(= {src_chunk}) ")


async def generate_letters_audio():
    os.makedirs(LETTERS_DIR, exist_ok=True)
    letters = [chr(c) for c in range(ord('a'), ord('z') + 1)]
    print(f"\n🔤 開始產生 26 個英文字母發音 (letters-audio/)...")
    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, ch in enumerate(letters, 1):
            raw_tmp = os.path.join(tmpdir, f"letter_{ch}_raw.mp3")
            out_file = os.path.join(LETTERS_DIR, f"{ch}.mp3")
            try:
                # 傳大寫給 Edge-TTS 朗讀標準字母名稱 (Letter Name)
                await generate_tts(ch.upper(), raw_tmp, rate="-5%")
                process_letter_audio(raw_tmp, out_file)
                vol = check_mean_volume(out_file)
                if vol <= -90.0:
                    print(f"  [{idx}/{len(letters)}] ⚠️ {ch}.mp3 疑似靜音 ({vol} dB)")
                else:
                    print(f"  [{idx}/{len(letters)}] ✅ {ch}.mp3 ({vol} dB)")
            except Exception as e:
                print(f"  [{idx}/{len(letters)}] ❌ {ch}.mp3 錯誤: {e}")


async def main():
    args = sys.argv[1:]
    run_all = len(args) == 0 or "--all" in args
    if run_all or "--letters" in args:
        await generate_letters_audio()
    if run_all or "--phonics" in args:
        # 如果只傳 --phonics-missing 或特定 chunk，可彈性生成
        target = None
        for a in args:
            if a.startswith("--chunks="):
                target = a.split("=", 1)[1].split(",")
        out_dir = None
        for a in args:
            if a.startswith("--out-dir="):
                out_dir = a.split("=", 1)[1]
        await generate_phonics_audio(target_chunks=target, out_dir=out_dir)
    if run_all or "--words" in args:
        await generate_words_audio()

    print("\n🎉 音檔處理完成！")


if __name__ == "__main__":
    asyncio.run(main())
