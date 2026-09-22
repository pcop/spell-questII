#!/usr/bin/env python3
"""為每個 phonics chunk 生成 3 個候選裁切，外加波形圖與 A/B 試聽頁。

CLAUDE.md 規定改 CHUNK_CONFIG 的裁切視窗一定要用耳朵驗過——量測只能告訴
你「有沒有被截斷」，不能告訴你「切到的是不是正確的音」。這支腳本就是做這件
事的工具：把每個音素切成三個候選（基準 / 短一點 / 長一點），生成到 out/，
起一個本地 http server 讓人逐個試聽並選定，最後匯出 JSON 回填
tools/generate-neural-audio.py 的 CHUNK_CONFIG。

全程不寫進 public/。

用法：
    python3 tools/phonics-preview/make-variants.py
    cd tools/phonics-preview/out && python3 -m http.server 8931
"""
import asyncio, json, os, shutil, subprocess, sys
import numpy as np
import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RAW_DIR = os.path.join(HERE, "raws")
OUT = os.path.join(HERE, "out")
os.makedirs(RAW_DIR, exist_ok=True)
os.makedirs(os.path.join(OUT, "new"), exist_ok=True)
os.makedirs(os.path.join(OUT, "old"), exist_ok=True)
os.makedirs(os.path.join(OUT, "wave"), exist_ok=True)

# 載入生成腳本的模組內容（去掉頂層 asyncio.run）
ns = {"__file__": os.path.join(ROOT, "tools", "generate-neural-audio.py")}
src = open(ns["__file__"], encoding="utf-8").read().replace("asyncio.run(main())", "pass")
exec(compile(src, ns["__file__"], "exec"), ns)
CFG = ns["CHUNK_CONFIG"]
process_audio = ns["process_audio"]

SR = 16000; F = 0.010
# 目標音素是字首母音的（載體字以母音開頭）—— 邊界靠演算法找母音後的能量塌陷
VOWEL_FIRST = {"a", "e", "i", "o", "u", "ea", "ou", "eigh", "oa", "ar", "air", "ear", "eye"}


async def ensure_raw(word):
    p = os.path.join(RAW_DIR, f"{word}.mp3")
    if not os.path.exists(p):
        await edge_tts.Communicate(word, "en-US-JennyNeural", rate="-20%").save(p)
    return p


def envelope(mp3):
    cmd = ["ffmpeg", "-v", "error", "-i", mp3,
           "-af", "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB",
           "-ar", str(SR), "-ac", "1", "-f", "s16le", "-"]
    x = np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, dtype=np.int16).astype(np.float32) / 32768
    n = int(SR * F); nf = len(x) // n
    fr = x[:nf * n].reshape(nf, n)
    db = 20 * np.log10(np.sqrt((fr ** 2).mean(1) + 1e-12))
    zcr = (np.diff(np.sign(fr), axis=1) != 0).sum(1) / n
    return db, zcr


def base_end(chunk, cfg, db):
    """基準 end：母音類用能量塌陷點，其餘沿用現值"""
    if chunk in VOWEL_FIRST:
        peak = db.max(); thr = peak - 25
        for i in range(int(np.argmax(db)), len(db)):
            if db[i] < thr:
                e = round(i * F, 3)
                if e > cfg["start"] + 0.08:
                    return e, "母音後能量塌陷"
    return cfg["end"], "沿用現值"


# 清音開頭的載體字：/s/ /f/ /h/ /k/ /p/ /t/ /ʃ/ /θ/ 跟後面的母音在能量與 ZCR
# 上界線分明，程式抓得準。濁子音開頭（m/b/d/l/r/n/v/z/g/w）本身就是濁音、
# 低 ZCR、能量不低，跟母音在這兩個指標上分不開，只能沿用現值靠耳朵校。
VOICELESS_ONSET = ("s", "f", "h", "k", "c", "p", "t", "sh", "th")


# 目標音素**不是**載體字的第一個母音——「抓第一個母音起點」對這些是錯的：
#   y   = happy 第二音節的 /i/（第一個母音是 /æ/）
#   x   = box 字尾的 /ks/
#   nk  = pink 字尾的 /ŋk/（第一個母音是 /ɪ/，抓到它等於把母音也切進來）
TAIL_CHUNKS = {"y", "x", "nk"}


def base_start(chunk, cfg, db, zcr):
    """基準 start：載體字是清音開頭、且目標就是第一個母音時抓母音起點，否則沿用現值"""
    if cfg["start"] <= 0:
        return 0.0, ""
    word = cfg["word"]
    if chunk in TAIL_CHUNKS:
        return cfg["start"], f"沿用現值（目標在 {word} 的字尾，不是第一個母音）"
    if not word.startswith(VOICELESS_ONSET):
        return cfg["start"], "沿用現值（濁子音開頭，程式分不出邊界）"
    peak = db.max()
    voiced = [(db[i] > peak - 10 and zcr[i] < 0.12) for i in range(len(db))]
    for i in range(len(voiced) - 2):
        if voiced[i] and voiced[i + 1] and voiced[i + 2]:
            return round(i * F, 3), f"母音起點（{word} 的子音到 {i * F:.2f}s）"
    return cfg["start"], "沿用現值（抓不到母音起點）"


def variants_for(chunk, cfg, bstart, bend):
    """三個候選 (start, end)。

    調的維度看 chunk 的性質：
    - start > 0（從載體字中段取母音）：問題在**開頭**——start 切太早會把載體字
      的子音一起帶進來（ee 聽起來像 see）。所以左右各探 40ms，end 固定。
    - start = 0（從字首取子音，或載體字本身就是母音開頭）：問題在**結尾**——
      修好 fade 截斷後會第一次帶出載體字後面的音。子音往短的方向探，母音
      左右各探。
    """
    out = []
    if cfg["start"] > 0:
        for o in (0.0, +0.04, -0.04):
            st = round(bstart + o, 3)
            if 0 <= st < bend - 0.05:
                out.append({"dim": "start", "off": round(o, 3), "start": st, "end": bend})
    else:
        offs = [0.0, -0.04, +0.04] if chunk in VOWEL_FIRST else [0.0, -0.06, -0.12]
        for o in offs:
            e = round(bend + o, 3)
            if e > 0.05:
                out.append({"dim": "end", "off": round(o, 3), "start": 0.0, "end": e})
    return out


def wave_png(mp3, png):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", mp3,
                    "-filter_complex", "showwavespic=s=420x60:colors=#4a7fd4",
                    "-frames:v", "1", png], check=False)


def probe(mp3):
    d = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", mp3], capture_output=True, text=True).stdout.strip()
    res = subprocess.run(["ffmpeg", "-i", mp3, "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    mx = next((l.split("max_volume:")[1].replace("dB", "").strip()
               for l in res.splitlines() if "max_volume:" in l), "?")
    sd = subprocess.run(["ffmpeg", "-i", mp3, "-af", "silencedetect=n=-50dB:d=0.02", "-f", "null", "-"],
                        capture_output=True, text=True).stderr
    ss = [l.split("silence_start:")[1].strip() for l in sd.splitlines() if "silence_start:" in l]
    try:
        dur = float(d); voiced = float(ss[0]) if ss else dur
    except Exception:
        dur, voiced = 0.0, 0.0
    return round(dur, 3), round(voiced, 3), mx


async def main():
    rows = []
    for chunk, cfg in CFG.items():
        old_src = os.path.join(ROOT, "public", "phonics-audio", f"{chunk}.mp3")
        old_dst = os.path.join(OUT, "old", f"{chunk}.mp3")
        if os.path.exists(old_src):
            shutil.copyfile(old_src, old_dst)
            wave_png(old_dst, os.path.join(OUT, "wave", f"old_{chunk}.png"))
            od, ov, omx = probe(old_dst)
        else:
            od = ov = 0; omx = "?"

        if "alias" in cfg:
            rows.append({"chunk": chunk, "alias": cfg["alias"], "old": {"dur": od, "voiced": ov, "max": omx},
                         "variants": []})
            continue

        raw = await ensure_raw(cfg["word"])
        db, zcr = envelope(raw)
        bend, why_e = base_end(chunk, cfg, db)
        bstart, why_s = base_start(chunk, cfg, db, zcr)
        vs = []
        for i, v in enumerate(variants_for(chunk, cfg, bstart, bend)):
            name = f"{chunk}__v{i}"
            f = os.path.join(OUT, "new", f"{name}.mp3")
            process_audio(raw, f, start=v["start"], end=v["end"])
            wave_png(f, os.path.join(OUT, "wave", f"{name}.png"))
            d, vo, mx = probe(f)
            vs.append({"id": name, **v, "dur": d, "voiced": vo, "max": mx})
        dim = vs[0]["dim"] if vs else "end"
        rows.append({"chunk": chunk, "word": cfg["word"],
                     "cur_start": cfg["start"], "cur_end": cfg["end"],
                     "base_start": bstart, "base_end": bend, "dim": dim,
                     "why": why_s if dim == "start" else why_e,
                     "old": {"dur": od, "voiced": ov, "max": omx}, "variants": vs})
        span = [f"{v['start']}-{v['end']}" for v in vs]
        print(f"  {chunk:<10} {cfg['word']:<8} 調{dim:<5} {span}  {why_s if dim=='start' else why_e}")

    # 別名的成品：複製 v0
    for r in rows:
        if "alias" in r:
            srcrow = next(x for x in rows if x["chunk"] == r["alias"])
            src = os.path.join(OUT, "new", f"{srcrow['variants'][0]['id']}.mp3")
            dst = os.path.join(OUT, "new", f"{r['chunk']}__v0.mp3")
            shutil.copyfile(src, dst)
            wave_png(dst, os.path.join(OUT, "wave", f"{r['chunk']}__v0.png"))
            d, v, mx = probe(dst)
            r["variants"] = [{"id": f"{r['chunk']}__v0", "dim": "alias", "off": 0,
                              "start": None, "end": None,
                              "dur": d, "voiced": v, "max": mx}]

    json.dump(rows, open(os.path.join(OUT, "rows.json"), "w"), ensure_ascii=False, indent=1)

    # 試聽頁需要的其他資產
    shutil.copyfile(os.path.join(HERE, "index.html"), os.path.join(OUT, "index.html"))
    shutil.copyfile(os.path.join(ROOT, "src", "data", "data.json"), os.path.join(OUT, "data.json"))
    link = os.path.join(OUT, "words-audio")
    if not os.path.exists(link):
        os.symlink(os.path.join(ROOT, "public", "words-audio"), link)

    print(f"\n共 {len(rows)} 個 chunk -> {OUT}")
    print(f"起試聽頁：cd {OUT} && python3 -m http.server 8931")
    print("然後開 http://localhost:8931/ （clipboard 只在 localhost 可用）")


asyncio.run(main())
