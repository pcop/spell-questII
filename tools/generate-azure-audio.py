#!/usr/bin/env python3
"""用 Azure Speech 官方 API 產生音檔，取代 Edge-TTS 的「合成單字再裁切」流程。

為什麼換：
1. phonics 音素可以用 SSML <phoneme alphabet="ipa"> **直接合成**，不必從載體
   單字裡切。裁切點只能靠能量/過零率反推，濁子音那批（moon/blue/bird/door/
   book）正是啟發式失效的地方——邊界問題從源頭消失，CHUNK_CONFIG 整套退休。
2. 音色跟既有的 words-audio 完全一致：edge-tts 走的是 Edge 瀏覽器的免費端點，
   底層就是 Azure 的 en-US-JennyNeural，同一個語音。
3. edge-tts 用的是非官方端點，微軟隨時可以關掉；官方 API 不會。

走 REST API 而不是 SDK：零安裝相依（只要 requests），而且直接回 mp3。

需要環境變數：
    AZURE_SPEECH_KEY     Speech resource 的 KEY 1
    AZURE_SPEECH_REGION  例如 eastasia

用法：
    python3 tools/generate-azure-audio.py --phonics --chunks=ee,oo,ir,ck,nk \\
        --out-dir=/tmp/試聽          # 小樣本驗證，不碰 public/
    python3 tools/generate-azure-audio.py --all        # 增量：只產生缺的或參數變了的
    python3 tools/generate-azure-audio.py --all --force # 全量重生
    python3 tools/generate-azure-audio.py --reindex     # 只重建 manifest，不呼叫 API
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

WORDS_DIR = os.path.join(ROOT, "public", "words-audio")
PHONICS_DIR = os.path.join(ROOT, "public", "phonics-audio")
LETTERS_DIR = os.path.join(ROOT, "public", "letters-audio")
DATA_FILE = os.path.join(ROOT, "src", "data", "data.json")
MANIFEST = os.path.join(HERE, "audio-manifest.json")

VOICE = "en-US-JennyNeural"
# Azure 的輸出格式代號。48kbps 單聲道 24kHz 對這種短音檔綽綽有餘，
# 跟既有音檔（libmp3lame -qscale:a 2）的位元率同一個量級。
OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

WORD_RATE = "-20%"    # 單字朗讀放慢，給 4~8 歲的孩子聽
LETTER_RATE = "-5%"
PHONEME_RATE = "-10%"

PEAK_TARGET_DB = -3.0  # phonics 音素對齊的峰值


# --------------------------------------------------------------------------
# IPA 對照表
# --------------------------------------------------------------------------
def load_chunk_ipa():
    import importlib.util
    spec = importlib.util.spec_from_file_location("phonics_ipa", os.path.join(HERE, "phonics-ipa.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.CHUNK_IPA


# --------------------------------------------------------------------------
# Azure REST
# --------------------------------------------------------------------------
def azure_credentials():
    key = os.environ.get("AZURE_SPEECH_KEY")
    region = os.environ.get("AZURE_SPEECH_REGION")
    if not key or not region:
        sys.exit("✗ 請先設定環境變數 AZURE_SPEECH_KEY 與 AZURE_SPEECH_REGION")
    return key, region


def synth(ssml: str, out_path: str):
    """把 SSML 送去合成，直接存成 mp3。失敗時把 Azure 的錯誤訊息原樣拋出——
    <phoneme> 裡有它不認得的 phone 會回 400，訊息會指出是哪個。"""
    key, region = azure_credentials()
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    r = requests.post(
        url,
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
            "User-Agent": "spell-quest-audio",
        },
        data=ssml.encode("utf-8"),
        timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
    with open(out_path, "wb") as f:
        f.write(r.content)


def ssml_text(text: str, rate: str) -> str:
    """一般文字（單字、字母）"""
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">'
        f'<voice name="{VOICE}"><prosody rate="{rate}">{text}</prosody></voice></speak>'
    )


def ssml_phoneme(ipa: str, fallback: str, rate: str) -> str:
    """音素：直接給 IPA，不必裁切"""
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">'
        f'<voice name="{VOICE}"><prosody rate="{rate}">'
        f'<phoneme alphabet="ipa" ph="{ipa}">{fallback}</phoneme>'
        "</prosody></voice></speak>"
    )


# --------------------------------------------------------------------------
# 後處理
# --------------------------------------------------------------------------
def _ffmpeg(src, dst, filters, mp3=True):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", ",".join(filters)]
    if mp3:
        cmd += ["-codec:a", "libmp3lame", "-qscale:a", "2"]
    cmd.append(dst)
    subprocess.run(cmd, check=True)


def measure(path, what="max_volume"):
    res = subprocess.run(["ffmpeg", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True)
    for line in res.stderr.splitlines():
        if what + ":" in line:
            try:
                return float(line.split(what + ":")[1].replace("dB", "").strip())
            except Exception:
                pass
    return 0.0


def trailing_silence(path):
    """尾端靜音長度。抓「後半段被淡成靜音」這類 mean_volume 看不出來的毛病。

    要配對 silence_start / silence_end，只有「最後一段靜音一直延續到檔尾」才算數。
    直接取第一個 silence_start 會把音素**內部**的閉塞誤判成截斷——ŋk 的 /ŋ/→/k/、
    ks 的 /k/→/s/ 中間本來就有 90ms 左右的無聲段，那是音素的一部分，不是毛病。
    """
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
    res = subprocess.run(["ffmpeg", "-i", path, "-af", "silencedetect=n=-50dB:d=0.02",
                          "-f", "null", "-"], capture_output=True, text=True)
    starts, ends = [], []
    for line in res.stderr.splitlines():
        if "silence_start:" in line:
            starts.append(line.split("silence_start:")[1].strip())
        elif "silence_end:" in line:
            ends.append(line.split("silence_end:")[1].split("|")[0].strip())
    # 每個 silence_start 都有對應的 silence_end ⇒ 每一段靜音都在檔案中間結束了
    if len(starts) <= len(ends):
        return 0.0
    try:
        return max(0.0, float(dur) - float(starts[-1]))
    except Exception:
        return 0.0


def post_word(raw, out):
    """單字／字母：去前後靜音 + 響度標準化

    stop_duration 一定要明顯大於單字內部塞音的閉塞停頓（實測 40~100ms），否則
    會把詞中停頓誤判成唸完、把後面的音節切掉（chicken/spoon/apple/purple/duck
    都曾經這樣被攔腰截斷）。真正的尾端靜音實測 1 秒以上，0.3 對兩者都安全。
    """
    _ffmpeg(raw, out, [
        "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB",
        "silenceremove=stop_periods=1:stop_duration=0.3:stop_threshold=-50dB",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
    ])


def post_phoneme(raw, out):
    """音素：去前後靜音 + 淡入淡出 + 峰值對齊

    沒有 atrim——這正是改用 Azure 的重點，音素是直接合成的，沒有裁切點。
    淡出用 areverse 走相對片段結尾，**不能**用 afade=t=out:st=<絕對秒數>：
    那樣等於「所有音檔一律在某個時間點歸零」，長一點的音素後半段會被淡成死寂
    （Edge-TTS 那條路上 43 個音素就是這樣只剩前 0.24 秒）。

    音量用固定增益而不是 loudnorm：loudnorm 是為 >=3 秒素材設計的，套在 0.1~
    0.5 秒的音素上打不中 LUFS 目標而且會改動長度。
    """
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "t.wav")
        # 尾端的殘響與淡出都在「反轉之後」處理，理由是 stop_periods 這條路走不通：
        # 它要求連續 stop_duration 秒都低於門檻才切，而 stop_duration 必須大於音素
        # **內部**的閉塞停頓（ŋk 的 /ŋ/→/k/、ks 的 /k/→/s/ 實測約 90ms），否則會把
        # 音素攔腰切斷；可是門檻拉到 0.1 秒就切不掉 0.12~0.16 秒的尾端殘響了。
        # 反轉後尾端變成開頭，用 start_periods 處理就只看開頭那一段，中間的閉塞
        # 完全不受影響，兩個需求同時滿足。
        #
        # 淡出同理跟著走反轉版的淡入，**不能**用 afade=t=out:st=<絕對秒數>——那等於
        # 「所有音檔一律在某個時間點歸零」，長一點的音素後半段會被淡成死寂
        # （Edge-TTS 那條路上 43 個音素就是這樣只剩前 0.24 秒）。
        _ffmpeg(raw, wav, [
            "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB",
            "areverse",
            "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB",
            "afade=t=in:st=0:d=0.03",
            "areverse",
            "afade=t=in:st=0:d=0.01",
        ], mp3=False)
        gain = PEAK_TARGET_DB - measure(wav)
        _ffmpeg(wav, out, [f"volume={gain:.2f}dB"])


# --------------------------------------------------------------------------
# manifest：增量生成
# --------------------------------------------------------------------------
def load_manifest():
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_manifest(m):
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1, sort_keys=True)


def sig(*parts):
    """生成參數的指紋。文字、IPA、語音、語速任何一項變了，指紋就變，
    下次跑就會重生那個檔——不必手動刪檔。"""
    return hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:16]


# --------------------------------------------------------------------------
# 三類音檔
# --------------------------------------------------------------------------
def gen_one(name, ssml, out_file, post, idx, total):
    """合成 + 後處理 + 兩項驗收（整檔靜音、尾端被截斷）"""
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "raw.mp3")
        synth(ssml, raw)
        post(raw, out_file)
    vol = measure(out_file, "mean_volume")
    tail = trailing_silence(out_file)
    if vol <= -90.0:
        print(f"  [{idx}/{total}] ⚠️ {name} 疑似靜音 ({vol} dB)")
    elif tail > 0.1:
        print(f"  [{idx}/{total}] ⚠️ {name} 尾端 {tail:.2f}s 靜音（疑似被截斷）")
    else:
        print(f"  [{idx}/{total}] ✅ {name} ({vol} dB, 尾靜音 {tail:.2f}s)")


def run(kind, items, out_dir, post, manifest, force, label, reindex=False):
    """items: [(檔名, ssml, 指紋來源 tuple)]

    manifest 的 key 一定要帶 kind 前綴。三個目錄的檔名是會撞的——`a.mp3` 同時是
    字母 A 與音素 /æ/，`ear.mp3`/`eye.mp3` 又同時是單字，共 28 個重名。只用檔名
    當 key 的話它們會互相覆蓋，指紋永遠對不上，每次都被判定成「要重生」。
    """
    os.makedirs(out_dir, exist_ok=True)
    todo = []
    for name, ssml, parts in items:
        out_file = os.path.join(out_dir, name)
        s = sig(*parts)
        key = f"{kind}/{name}"
        if reindex:
            # 只重算指紋，不呼叫 API：檔案已經在了，補回它在 manifest 裡的記錄
            if os.path.exists(out_file):
                manifest[key] = {"sig": s}
            continue
        if not force and manifest.get(key, {}).get("sig") == s and os.path.exists(out_file):
            continue
        todo.append((key, name, ssml, s, out_file))

    if reindex:
        print(f"{label}：已重建 {len(items)} 筆索引")
        return

    skipped = len(items) - len(todo)
    print(f"\n{label}：{len(todo)} 個要生成"
          + (f"，{skipped} 個沒變動（略過）" if skipped else ""))
    for i, (key, name, ssml, s, out_file) in enumerate(todo, 1):
        try:
            gen_one(name, ssml, out_file, post, i, len(todo))
            manifest[key] = {"sig": s}
        except Exception as e:
            print(f"  [{i}/{len(todo)}] ❌ {name}: {e}")


def main():
    args = sys.argv[1:]
    force = "--force" in args
    # --reindex：不呼叫 API，只用現有檔案重建 manifest。修了指紋規則或手動補過
    # 檔案之後用這個對齊，不必重新花一次合成。
    reindex = "--reindex" in args
    run_all = not args or "--all" in args or (reindex and not any(
        a.startswith(("--phonics", "--words", "--letters", "--chunks=")) for a in args))
    out_dir = next((a.split("=", 1)[1] for a in args if a.startswith("--out-dir=")), None)
    only = next((a.split("=", 1)[1].split(",") for a in args if a.startswith("--chunks=")), None)
    only_words = next((a.split("=", 1)[1].split(",") for a in args if a.startswith("--words=")), None)

    manifest = {} if out_dir else load_manifest()  # 寫到別處時不要污染正式 manifest

    if run_all or "--phonics" in args or only:
        ipa_map = load_chunk_ipa()
        items = []
        for chunk, (ipa, _note) in ipa_map.items():
            if only and chunk not in only:
                continue
            fallback = chunk.split("-")[0]
            items.append((f"{chunk}.mp3",
                          ssml_phoneme(ipa, fallback, PHONEME_RATE),
                          (ipa, VOICE, PHONEME_RATE, OUTPUT_FORMAT)))
        run("phonics", items, out_dir or PHONICS_DIR, post_phoneme, manifest, force,
            "🎧 phonics 音素", reindex)

    if run_all or "--words" in args or only_words:
        with open(DATA_FILE, encoding="utf-8") as f:
            data = json.load(f)
        words = sorted({e["word"].strip().lower() for e in data["wordBank"]})
        items = [(f"{w}.mp3", ssml_text(w, WORD_RATE), (w, VOICE, WORD_RATE, OUTPUT_FORMAT))
                 for w in words if not only_words or w in only_words]
        run("words", items, out_dir or WORDS_DIR, post_word, manifest, force,
            "🎙️ 單字", reindex)

    if run_all or "--letters" in args:
        items = [(f"{c}.mp3", ssml_text(c.upper(), LETTER_RATE),
                  (c.upper(), VOICE, LETTER_RATE, OUTPUT_FORMAT))
                 for c in "abcdefghijklmnopqrstuvwxyz"]
        run("letters", items, out_dir or LETTERS_DIR, post_word, manifest, force,
            "🔤 字母", reindex)

    if not out_dir:
        save_manifest(manifest)
        print(f"\nmanifest 已更新：{os.path.relpath(MANIFEST, ROOT)}")
    print("\n🎉 完成")


if __name__ == "__main__":
    main()
