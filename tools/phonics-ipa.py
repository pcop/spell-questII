#!/usr/bin/env python3
"""phonics chunk → IPA 對照表（給 Azure Speech SSML <phoneme alphabet="ipa"> 用）

這張表取代了早期「合成完整載體單字 → 用秒數把音素切出來」的裁切機制：裁切點只能
靠能量/過零率反推，而濁子音那批（moon/blue/bird/door/book）的子音與母音在這兩個
指標上分不開。直接給 IPA 就沒有邊界可以切錯。

### 哪些音要帶 schwa（全部經過實測）

自然拼讀把音分成 stop sounds（塞音，唸 "buh"）與 continuous sounds（可持續音，
拉長唸 /sss/ /mmm/），這裡照這個慣例，只有兩種情況加 ə：

1. **塞音與塞擦音**（p t k b d ɡ tʃ dʒ）——爆破只有 10~20ms，沒有後接母音就
   只剩無聲的閉塞。這不是哪家 TTS 的問題：Edge-TTS 裁出來的 ck 峰值只有
   -20dB，espeak 合成 [[b]] 直接是空檔，同一個物理原因。
2. **弱到救不回來的 f / θ / h / v**——實測 Azure 單獨合成這四個的峰值是
   -34.2 / -39.9 / -40.2 / -38.4 dB，幾乎沒有聲音；帶 ə 之後是 -4.4 / -5.0 /
   -5.8 / -4.7。拉 30dB 以上的增益只會放大噪音。

其餘可持續音維持純音素，靠固定增益拉到 PEAK_TARGET_DB：
    m -13.7  n -11.7  l -14.8  ɹ -13.2  w -18.5  s -15.4  ʃ -12.6  z -16.1 dB
偏弱但都有實質訊號，增益拉得動。母音全部 -3.6 ~ -7.7 dB，不必處理。

試過但沒用的：IPA 長音符號 ː **Azure 完全忽略**（加了之後數值與不加一模一樣）；
重複寫法不可靠（hhh 改善到 -9.4，fff 毫無改善）。

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
    # f/θ/h/v 照理是可持續音，但實測單獨合成只有 -34~-40dB，只能帶 schwa
    "f":         ("fə",   "清擦音；單獨 -34.2dB，救不回來"),
    "h":         ("hə",   "純氣音；單獨 -40.2dB，救不回來"),
    "l":         ("l",    "響音；-14.8dB，靠增益"),
    "m":         ("m",    "響音；-13.7dB，靠增益"),
    "n":         ("n",    "響音；-11.7dB，靠增益"),
    "r":         ("ɹ",    "響音；美式 r，-13.2dB，靠增益"),
    "s":         ("s",    "擦音；-15.4dB，靠增益"),
    "v":         ("və",   "濁擦音但極弱；單獨 -38.4dB，救不回來"),
    "w":         ("w",    "滑音；-18.5dB，靠增益"),
    "z":         ("z",    "擦音；-16.1dB，靠增益"),
    "x":         ("ks",   "box 的 /ks/，兩個音"),

    # ---- 雙字母子音 & 疊字 ----
    "ch":        ("tʃə",  "塞擦音，帶 schwa"),
    "sh":        ("ʃ",    "擦音；-12.6dB，靠增益"),
    "th":        ("θə",   "think 的清 th；單獨 -39.9dB，救不回來"),
    "wh":        ("w",    "美式 wh 已與 w 合流"),
    "nk":        ("ŋk",   "pink 的 /ŋk/；不能簡化成 k，那會教錯"),
    "eye":       ("aɪ",   "eye"),


    # ---- onset：子音群 ----
    # 跟單一塞音同理要帶 schwa——孤立的子音群結尾若是塞音，爆破聲撐不起來。
    "bl":        ("blə",    "子音群，帶 schwa"),
    "br":        ("bɹə",    "子音群，帶 schwa"),
    "cl":        ("klə",    "子音群，帶 schwa"),
    "cr":        ("kɹə",    "子音群，帶 schwa"),
    "fl":        ("flə",    "子音群，帶 schwa"),
    "fr":        ("fɹə",    "子音群，帶 schwa"),
    "gr":        ("ɡɹə",    "子音群，帶 schwa"),
    "sl":        ("slə",    "子音群，帶 schwa"),
    "sp":        ("spə",    "子音群，帶 schwa"),
    "sw":        ("swə",    "子音群，帶 schwa"),
    "thr":       ("θɹə",    "子音群，帶 schwa"),

    # ---- rime：韻腳（onset-rime 拆法用） ----
    # 韻腳裡的塞音**不必**帶 schwa：前面有母音撐著，/eɪk/ 本身就聽得清楚。
    # 這也是 onset-rime 的一個附帶好處——cake 從 /kə æ kə/ 變成 /kə/ + /eɪk/。
    "ack":       ("æk",     "black"),
    "ake":       ("eɪk",    "cake/bake/lake/rake；magic e 長音"),
    "alk":       ("ɔk",     "walk；l 不發音"),
    "all":       ("ɔl",     "ball"),
    "ame":       ("eɪm",    "game/name"),
    "and":       ("ænd",    "hand"),
    "ane":       ("eɪn",    "cane/lane"),
    "ape":       ("eɪp",    "grape/tape/cape"),
    "ase":       ("eɪs",    "case/vase"),
    "at":        ("æt",     "cat/hat"),
    "ate":       ("eɪt",    "date/gate"),
    "ave":       ("eɪv",    "cave/wave"),
    "awl":       ("ɔl",     "crawl；跟 -all 同音"),
    "each":      ("itʃ",    "peach"),
    "ead":       ("id",     "read（現在式，長音）"),
    "eal":       ("il",     "teal"),
    "eart":      ("ɑɹt",    "heart；ea 唸 /ɑɹ/ 是例外"),
    "ed":        ("ɛd",     "red/bed"),
    "een":       ("in",     "green"),
    "eep":       ("ip",     "sheep/sleep"),
    "eg":        ("ɛɡ",     "leg"),
    "en":        ("ɛn",     "ten/pen"),
    "ig":        ("ɪɡ",     "pig"),
    "ike":       ("aɪk",    "bike/hike"),
    "im":        ("ɪm",     "swim"),
    "imb":       ("aɪm",    "climb；b 不發音、i 長音"),
    "ime":       ("aɪm",    "time/lime；跟 -imb 同音"),
    "ine":       ("aɪn",    "nine/line/pine"),
    "ink":       ("ɪŋk",    "pink"),
    "ird":       ("ɝd",     "bird"),
    "irt":       ("ɝt",     "shirt"),
    "ite":       ("aɪt",    "white"),
    "ive":       ("aɪv",    "five"),
    "ix":        ("ɪks",    "six"),
    "oat":       ("oʊt",    "goat"),
    "ock":       ("ɑk",     "sock/clock"),
    "og":        ("ɔɡ",     "dog/frog"),
    "old":       ("oʊld",   "gold"),
    "olf":       ("ʊlf",    "wolf"),
    "ook":       ("ʊk",     "book；短 oo"),
    "oon":       ("un",     "spoon；長 oo"),
    "oot":       ("ʊt",     "foot；短 oo，跟 -ooth 不同"),
    "ooth":      ("uθ",     "tooth；長 oo"),
    "orse":      ("ɔɹs",    "horse"),
    "ose":       ("oʊz",    "nose；s 發 /z/"),
    "outh":      ("aʊθ",    "mouth"),
    "own":       ("aʊn",    "brown"),
    "ox":        ("ɑks",    "fox/box"),
    "uck":       ("ʌk",     "duck"),
    "ump":       ("ʌmp",    "jump"),
    "un":        ("ʌn",     "run"),
    "up":        ("ʌp",     "cup"),

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
    import json
    import os

    # 直接對照 data.json 實際用到的 chunk——這才是真正要涵蓋的集合。
    # （早期是對照 generate-neural-audio.py 的 CHUNK_CONFIG，那支腳本已經退休。）
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "src", "data", "data.json"), encoding="utf-8") as f:
        data = json.load(f)

    used = set()
    for entry in data["wordBank"]:
        ph = entry.get("phonics") or {}
        for i, chunk in enumerate(ph.get("chunks", [])):
            override = (ph.get("audioOverrides") or {}).get(str(i))
            used.add(override or chunk)

    missing = sorted(used - set(CHUNK_IPA))
    unused = sorted(set(CHUNK_IPA) - used)
    print(f"data.json 用到 {len(used)} 個 chunk / IPA 表有 {len(CHUNK_IPA)} 個")
    print(f"  缺 IPA（會壞）: {missing or '無'}")
    print(f"  表裡有但沒人用: {unused or '無'}")
    print()
    for chunk, (ipa, note) in CHUNK_IPA.items():
        mark = " " if chunk in used else "·"
        print(f" {mark}{chunk:<11} /{ipa}/{'':<{max(0, 8 - len(ipa))}}  {note}")
