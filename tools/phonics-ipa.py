#!/usr/bin/env python3
"""phonics chunk → IPA 對照表（給 Azure Speech SSML <phoneme alphabet="ipa"> 用）

這張表要取代 generate-neural-audio.py 的整套 CHUNK_CONFIG 裁切機制。舊作法是
「合成完整載體單字 → 用秒數把音素切出來」，裁切點只能靠能量/過零率反推，濁子音
那批（moon/blue/bird/door/book）正是啟發式失效的地方；直接給 IPA 就沒有邊界問題。

### 塞音為什麼要帶 schwa

孤立的塞音 /b/ /d/ /ɡ/ /p/ /t/ /k/ 在物理上就幾乎沒有聲音——爆破只有 10~20ms，
沒有後接母音就只剩無聲的閉塞。這不是哪家 TTS 的問題：Edge-TTS 裁出來的 ck/nk
峰值只有 -20dB，espeak-ng 合成 [[b]] 直接是空檔，兩邊同一個原因。自然拼讀教學
本來就把這些音唸成帶輕 schwa 的 "buh"/"kuh"，所以這裡照教學慣例加 ə。

擦音（f/s/ʃ/θ/h）與響音（m/n/l/r/w）本身可以持續發聲，不需要 schwa。

### fallback 文字

<phoneme> 一定要給 fallback 文字（IPA 沒被辨識時唸的內容），這裡放 chunk 原本的
拼法。Azure 遇到不認得的 phone 會直接回 HTTP 400，不會默默唸錯，所以 fallback
實際上很少派上用場，但文件要求要給。
"""

# chunk → (IPA, 是否帶 schwa 的註記)
# 註記只寫給人看，說明為什麼這樣定；程式只用 IPA 字串。
CHUNK_IPA = {
    # ---- 單字母短母音 ----
    "a":         ("æ",    "at"),
    "e":         ("ɛ",    "ed"),
    "i":         ("ɪ",    "it"),
    "o":         ("ɑ",    "ox；美式 /ɑ/，英式是 /ɒ/"),
    "u":         ("ʌ",    "up"),
    "y":         ("i",    "happy 字尾的長 e"),
    "y-long-i":  ("aɪ",   "fly/sky 的長 i"),

    # ---- 母音組合 ----
    "ee":        ("i",    "see"),
    "ea":        ("i",    "eat"),
    "oo":        ("u",    "moon"),
    "oo-short":  ("ʊ",    "book/foot"),
    "ow":        ("aʊ",   "cow"),
    "ou":        ("aʊ",   "out"),
    "ay":        ("eɪ",   "say"),
    "ue":        ("u",    "blue"),
    "eigh":      ("eɪ",   "eight"),
    "oa":        ("oʊ",   "oak"),
    "aw":        ("ɔ",    "saw"),

    # ---- R 控制母音 ----
    # 美式 r 化母音在 Azure en-US 的 phone set 裡是母音 + ɹ；先用標準 IPA，
    # 若回 400 再改用 Azure 的 sapi phone set（見 speech-ssml-phonetic-sets）。
    "ar":        ("ɑɹ",   "art"),
    "er":        ("ɝ",    "her"),
    "ir":        ("ɝ",    "bird；跟 er/ur 同音"),
    "or":        ("ɔɹ",   "for"),
    "ur":        ("ɝ",    "fur"),
    "air":       ("ɛɹ",   "air"),
    "ear":       ("ɪɹ",   "ear"),
    "ear-pear":  ("ɛɹ",   "pear；跟 air 同音"),
    "ear-heart": ("ɑɹ",   "heart；跟 ar 同音"),
    "our":       ("ɔɹ",   "four"),
    "oor":       ("ɔɹ",   "door"),

    # ---- 單子音 ----
    # 塞音/塞擦音帶 ə，理由見檔頭
    "b":         ("bə",   "塞音，帶 schwa"),
    "c":         ("kə",   "塞音，帶 schwa"),
    "d":         ("də",   "塞音，帶 schwa"),
    "g":         ("ɡə",   "塞音，帶 schwa"),
    "j":         ("dʒə",  "塞擦音，帶 schwa"),
    "k":         ("kə",   "塞音，帶 schwa"),
    "p":         ("pə",   "塞音，帶 schwa"),
    "t":         ("tə",   "塞音，帶 schwa"),
    "q":         ("kwə",  "quick 的 /kw/，帶 schwa"),
    # 擦音與響音可以持續發聲，不加 schwa
    "f":         ("f",    "擦音"),
    "h":         ("h",    "擦音；單獨唸本來就很輕"),
    "l":         ("l",    "響音"),
    "m":         ("m",    "響音"),
    "n":         ("n",    "響音"),
    "r":         ("ɹ",    "響音；美式 r"),
    "s":         ("s",    "擦音"),
    "v":         ("v",    "擦音"),
    "w":         ("w",    "滑音"),
    "z":         ("z",    "擦音"),
    "x":         ("ks",   "box 的 /ks/，兩個音"),

    # ---- 雙字母子音 & 疊字 ----
    "ch":        ("tʃə",  "塞擦音，帶 schwa"),
    "sh":        ("ʃ",    "擦音"),
    "th":        ("θ",    "think 的清 th"),
    "wh":        ("w",    "美式 wh 已與 w 合流"),
    "nk":        ("ŋk",   "pink 的 /ŋk/；不能簡化成 k，那會教錯"),
    "eye":       ("aɪ",   "eye"),

    # ---- 別名：英語疊字只發一個音 ----
    "ck":        ("kə",   "= k"),
    "ll":        ("l",    "= l"),
    "rr":        ("ɹ",    "= r"),
    "pp":        ("pə",   "= p"),
}


def ssml_for_chunk(chunk: str, voice: str = "en-US-JennyNeural") -> str:
    """組出單一音素的 SSML。fallback 文字用 chunk 原本的拼法。"""
    ipa = CHUNK_IPA[chunk][0]
    # 虛擬 chunk id（y-long-i / oo-short / ear-pear …）的拼法要去掉後綴
    text = chunk.split("-")[0]
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">'
        f'<voice name="{voice}">'
        f'<phoneme alphabet="ipa" ph="{ipa}">{text}</phoneme>'
        "</voice></speak>"
    )


if __name__ == "__main__":
    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    ns = {"__file__": os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "generate-neural-audio.py")}
    src = open(ns["__file__"], encoding="utf-8").read().replace("asyncio.run(main())", "pass")
    exec(compile(src, ns["__file__"], "exec"), ns)
    cfg = ns["CHUNK_CONFIG"]

    missing = sorted(set(cfg) - set(CHUNK_IPA))
    extra = sorted(set(CHUNK_IPA) - set(cfg))
    print(f"CHUNK_CONFIG {len(cfg)} 個 / IPA 表 {len(CHUNK_IPA)} 個")
    print(f"  缺 IPA: {missing or '無'}")
    print(f"  多出來: {extra or '無'}")
    print()
    for chunk, (ipa, note) in CHUNK_IPA.items():
        print(f"  {chunk:<11} /{ipa}/{'':<{max(0, 8 - len(ipa))}}  {note}")
