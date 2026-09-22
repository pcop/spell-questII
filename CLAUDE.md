# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 這是什麼

拼字冒險王二代——給 4–8 歲兒童的英文拼字練習遊戲，純前端 Vite 專案，無後端、無帳號，進度存 `localStorage`。是從一代 `../拼字遊戲/`（1638 行單一 IIFE）逐模組重構而來，`規劃.md` 記錄了完整的分期決策、刻意不做的 backlog、以及執行中修正過的判斷（例如 phonics 為什麼沒有改 per-word 音檔）——動到架構層級的東西前先讀它。UI 文案全部正體中文。

## 常用指令

```bash
npm install
npm run dev            # http://localhost:5173，base 為 '/'
npm run build          # base 自動變 '/spell-questII/'（見下方部署）
npm test               # vitest run，5 個測試檔、不需要瀏覽器
npx vitest run tests/game.test.js          # 跑單一檔案
npx vitest run -t "錯題複習"                 # 依測試名稱過濾
```

**Node 版本硬性需求**：`^22.22.2 || ^24.15.0 || >=26`（`package.json` 的 `engines`）。`jsdom@30` 在 Node 20 一 import 就會炸（`webidl.util.markAsUncloneable is not a function`），這不是測試壞掉，是版本不對。

### 瀏覽器實機驗證（沒有 UI 自動化測試，靠這個）

`playwright` 已裝為 devDependency，系統有 `google-chrome`，用 `chromium.launch({ channel: 'chrome' })` 不需要另外下載瀏覽器。腳本放 scratchpad、用 `NODE_PATH="$(pwd)/node_modules" node <script>` 執行。先 `npx vite --port 5183 &` 起 dev server。改 CSS/畫面後**一定要**截圖看過，`tests/integration.smoke.test.js` 只驗證 id/流程存在，不驗證樣式有沒有真的套上。

**點字母方塊要用 pointer 事件，不能用 `.click()`**：`bindTileInteraction()` 只綁 `pointerdown/move/up/cancel`（觸控拖曳支援，跟一代一致），Playwright 用 `page.mouse.down()/up()`，jsdom 用 `dispatchEvent(new PointerEvent('pointerdown', ...))`。其他按鈕都是普通 `click`。

### 新增單字後產生音檔

音檔全部由 **Azure Speech 官方 API** 生成（`en-US-JennyNeural`）。需要環境變數：

```bash
export AZURE_SPEECH_KEY='...'      # Speech resource 的 KEY 1
export AZURE_SPEECH_REGION='eastasia'
python3 tools/generate-azure-audio.py --all    # 增量：只產生缺的或參數變了的
```

**`--all` 是安全的**：`tools/audio-manifest.json` 記錄每個檔案的生成參數指紋（文字/IPA、語音、語速、輸出格式），沒變動的一律略過。加了新單字就跑這行，只有新的那幾個會送去合成。其他選項：

```bash
--words --letters --phonics       # 只跑某一類
--chunks=ee,oo --out-dir=/tmp/x   # 小樣本生成到別處試聽，不碰 public/
--force                           # 忽略 manifest 全量重生
--reindex                         # 不呼叫 API，只用現有檔案重建 manifest
```

免費層 F0 每月 50 萬字元，全部 204 個音檔加起來約 3 萬字元，跑十幾次都還在額度內。

**manifest 的 key 一定要帶類別前綴**（`phonics/a.mp3`）。三個目錄的檔名會撞——`a.mp3` 同時是字母 A 與音素 /æ/，`ear.mp3`/`eye.mp3` 又同時是單字，共 28 個重名；只用檔名當 key 它們會互相覆蓋，指紋永遠對不上，每次都被判定成「要重生」。

#### phonics 音素是直接合成的，沒有裁切

`tools/phonics-ipa.py` 的 `CHUNK_IPA` 是 chunk → IPA 的對照表，透過 SSML `<phoneme alphabet="ipa">` 直接合成。**加新 chunk 就是加一筆 IPA**，不必找載體單字、不必量裁切秒數。Azure 遇到不認得的 phone 會回 HTTP 400 並指出是哪個，不會默默唸錯。

一代與二代早期是「合成完整載體單字 → 用秒數切出音素」，`CHUNK_CONFIG` 那套已經退休（見 `規劃.md`）。它的根本問題是裁切點只能靠能量/過零率反推，而濁子音（moon/blue/bird/door/book）的子音與母音在這兩個指標上分不開——實測把 `start` 移到程式算出的「母音起點」，開頭 40ms 的低頻能量佔比反而升高（moon 51.8%→71.5%），因為濁塞音後面那段共振峰滑向母音的過渡量起來像母音、聽起來還是 "buh"。

**哪些音要帶 schwa**（`phonics-ipa.py` 檔頭有完整實測數據）：塞音與塞擦音（爆破只有 10~20ms），以及 f/θ/h/v（單獨合成只有 −34～−40dB）。其餘可持續音維持純音素靠增益拉到 `PEAK_TARGET_DB`。IPA 長音符號 `ː` Azure 完全忽略，別試。

#### 音檔驗收：兩個檢查都內建在腳本輸出裡

1. `mean_volume ≤ -90dB` 代表整檔靜音。
2. **尾端靜音**：比對「有聲到哪裡」與總長度。只驗音量抓不到「後半段被淡成靜音」——混著靜音尾巴的 mean 看起來完全正常，Edge-TTS 時代 43 個音素只剩前 0.24 秒就是這樣潛伏了很久。
   判定要**配對** `silence_start`/`silence_end`，只有「最後一段靜音延續到檔尾」才算；取第一個會把音素**內部**的閉塞誤判成截斷（`nk` 的 /ŋ/→/k/ 中間本來就有 90ms 無聲）。

#### ffmpeg 濾鏡的兩個地雷

- **淡出不能用 `afade=t=out:st=<絕對秒數>`**。`st` 是片段內的絕對時間，寫死就等於「所有音檔一律在某個時間點歸零並永遠保持靜音」。用 `areverse,afade=t=in,areverse` 走相對結尾。
- **切尾端靜音要用反轉後的 `start_periods`，不是 `stop_periods`**。`stop_periods` 要求連續 `stop_duration` 秒低於門檻才切，而那個門檻必須大於音素**內部**的閉塞（約 90ms），否則會把音素攔腰切斷；可是拉到 0.1 秒就切不掉 0.12~0.16 秒的尾端殘響。反轉後尾端變成開頭，`start_periods` 只看開頭那一段，中間閉塞不受影響。

單字音檔的 `silenceremove` 另有一個約束：`stop_duration` 要明顯大於單字內部塞音的閉塞停頓（實測 40~100ms），否則會把詞中停頓誤判成唸完、直接切掉後面的音節（chicken/spoon/apple/purple/duck 都曾經這樣被攔腰截斷）。

## 架構

### 模組分層與依賴方向

```
main.js
 └─ ui/           （唯一碰 DOM 的層）
     ├─ index.js      showView / bindStaticEvents / handleKeydown（唯一的 document keydown 監聽器，依可見 view 分流）
     ├─ game-flow.js  主選單→選主題→選難度→遊戲→結果，整個拼字關卡的 DOM 渲染與事件
     ├─ mascot.js     吉祥物
     ├─ flashcards.js / blend.js / progress-page.js
     └─ 呼叫 ↓
 game/     純邏輯，禁止 document.*（wordbank.js 查詢、session.js 作答狀態機、helpers.js）
 audio/    語音/音效，禁止 document.*
 three-fx/ WebGL 特效（index.js + particles/models/textures）
 progress/ localStorage 讀寫與 v1→v2 遷移
 data/     data.json / messages.json 靜態 import
```

`game/index.js`、`audio/index.js`、`three-fx/index.js`、`ui/index.js` 的 export 簽名是 Phase 1 凍結的跨模組契約，各檔案頂部註解有完整 JSDoc。改簽名要同步改所有呼叫端；加新 export 隨意。

### game session 的協作方式

UI **不維護任何本地狀態鏡像**：每次 `placeLetterInSlot`/`removeLastLetter`/`useHint`/`resetForRetry` 之後一律重呼叫 `getCurrentQuestionView(session)` 拿 `slots`（`{tileId, letter, hinted}`）跟 `tiles`（`{id, letter, used}`）整個重繪。`session` 物件本身對 UI 是 opaque 的。

幾個容易踩的行為：
- `checkAnswer()` 答錯**不會**自動清槽位，只維持 `locked:true`；UI 播完 500ms 搖晃動畫後要自己呼叫 `resetForRetry(session)`。
- `advanceToNextQuestion()` 只在 `awaitingNext` 為真時有效（防止拼到一半按空白鍵跳題）。
- 答對後不自動跳題，停在原題等「下一題」按鈕或空白鍵——這是一代的刻意設計。
- 進度**每答一題就寫入** localStorage（`checkAnswer` 內部），`finishLevel` 只補寫 bestStars/collectibles。曾經有人改成關卡結束才批次寫，被退回：孩子中途重整會丟整關進度。
- `useHint` 每題限一次，用過的題目在 `finishLevel` 算星等時視同非首次答對。

### 關卡定義是單一入口

`getLevelDefsForTheme(themeId)` 是**唯一**解析「這個主題有哪些關卡」的地方，回傳 `LevelDef[]`，每筆帶 `kind: 'tier' | 'custom' | 'review'`：
- `tier`：依 `data.json` 的 `difficultyTiers` 用單字長度自動分級
- `custom`：主題物件的 `customLevels`，手動指定 `wordIds`
- `review`：**虛擬關卡**（Phase 3 錯題複習），從該主題所有關卡的 `wordProgress` 加總，`wrong > 0 && correct - wrong < 2` 的字進來，依 `wrong - correct` 降冪；符合的字為 0 時根本不 push（不是 `playable:false`）

`review` 沿用一模一樣的遊戲畫面/判分/持久化，零專屬 UI。兩處要記得排除它：`finishLevel` 永遠 `isNewSticker:false`（否則貼紙可以無限刷）；`getValidLevelCombos()` 不含它（否則進度頁多一列、`progress-page.js` 認不得 key）。`renderThemeGrid` 算主題卡片星等分母時也要跳過。

`MIN_WORDS_PER_LEVEL = 3`：任何來源的關卡單字不足都自動 `playable:false`。

### 進度資料

key `spelling_game_progress_v2`；`loadProgress()` 讀不到時會找一代的 `spelling_game_progress_v1`，用 `migrateV1ToV2()` 轉換後**存回新 key**（一次性）。`levels` 的 key 用 `levelKey(themeId, tier)` 組成 `${themeId}_${tier}`，`tier` 是 opaque string（數字 tier、custom level id、`'review'` 都走這個），**不要當數字用**。`settings.hintMode` 實際值是 `'image' | 'audio' | 'both'`。

測試要隔離 storage 用 `createMemoryStorage()` + `setProgressStorage()`（game 模組）或直接把 storage 傳進 `store.js` 的函式。

### three.js 是拼字關卡的硬性需求

`initThreeFx(container)` 回傳 `Promise<boolean>`，false 就永久鎖住「開始遊戲」按鈕（不做 2D 備援，`規劃.md` 決策 3）。字卡/拼讀/進度頁不受影響。`celebrateLevelComplete('chest', { onLidOpen })` 的回呼在 `tick()` 裡蓋子 `lidProgress` 第一次到 1 那一幀觸發；離開結果畫面**一定要**呼叫 `cancelCelebration()`，否則貼紙彈窗會晚一拍蓋在下個畫面上。

三個踩雷點（`three-fx/index.js` 頂部有詳細說明，`three-fx/README.md` 也有）：正交相機 + `PointsMaterial.sizeAttenuation:false`；**只有** `PointsMaterial.size` 要乘 `renderer.getPixelRatio()`，模型幾何尺寸不用（一代 CLAUDE.md 寫「都要乘」是錯的）；`MeshStandardMaterial` 模型需要 `AmbientLight + DirectionalLight`。

### CSS 與 JS 的耦合點（改樣式前必看）

`index.html` 的所有元素 `id`、下列 class、`@keyframes` 名稱都被 JS 用字串比對，**改名就靜默壞掉**、smoke test 不會抓到：
- JS 切換的 class：`filled` `hinted` `used` `dragging` `active` `correct-flash` `shake` `group-a/b` `group-start` `disabled`（level-card）`collected/locked`（sticker-item）`ok/fail`（threefx-status）`celebrating`（mascot-wrap）`celebrate-correct` `cheer` `tilt-left` `tilt-right` `pulse`（mascot）
- `mascot.js` 靠 `animationend` 的 `e.animationName` 收 class：`celebrateCorrect` `cheer` `tiltLeft` `tiltRight` `idlePulse` 必須維持是 CSS animation（不能改 transition）且名字不變
- `--celebrate-scale` 由 JS 寫入、`.mascot.celebrate-correct` 讀取
- z-index 相對順序：`.mascot-wrap` < `#three-fx-layer` < `.result-panel` < `.toast` < `.sticker-modal` < `.mascot-wrap.celebrating`；`#three-fx-layer` 必須 `pointer-events:none`
- **不要用 ID 選擇器寫 `display`**：`#btn-next-question { display:block }` 曾經蓋過 JS 的 `hidden` 屬性讓按鈕提早出現，現在是 `:not([hidden])`

設計 token 全在 `styles.css` 的 `:root`，新 UI 直接用。

### phonics 逐段播放的節奏

`speakPhonics` 逐段播放的節奏由 `phonicsChunkGapMs`（預設 130）/ `phonicsWordGapMs`（預設 260）控制，可用 `setPhonicsGaps()` 調整。**音檔本身不含尾端靜音**——修掉 afade bug 之前每個檔都拖著 0.2 秒以上的靜音尾巴，播放序列靠 `ended` 推進，那段空白就是當時的間隔來源；音檔修乾淨後節奏改由播放層明確控制，調快慢不用重新生成音檔。

### public/ 資產路徑

`words-audio/` `phonics-audio/` `mascot-images/` 在 `public/`，執行期路徑**必須**用 `import.meta.env.BASE_URL` 前綴（`audio/index.js` 的 `wordAudioUrl()`/`phonicsAudioUrl()`、`mascot.js`），不能寫死 `/words-audio/...`——本機 dev 看不出問題，部署到 GitHub Pages 子路徑就整批 404。

## 內容模型（加單字最常做，照這個）

`src/data/data.json`，每筆：

```json
{ "id": "other_jump", "word": "jump", "theme": "other", "emoji": "🦘", "zh": "跳",
  "phonics": { "chunks": ["j", "u", "m", "p"], "silent": [] } }
```

- `phonics.chunks` 串接必須等於 `word`；`syllables`（選填）同理。拆法：子音群 ch/sh/th/ck/wh/nk、母音團 ee/ea/oo/ow/ou/ay/ue/eigh/oa/aw、r 控制母音 ar/er/ir/or/ur/air/ear/our/oor、疊字 ll/rr/pp 各一個 chunk；子音混合（br/pl/st）拆開。`silent` 是 chunks 的索引（silent e、`walk` 的 l）。
- 無合適 emoji 用 `"emoji": null, "swatch": "#hex"`。
- 每個 chunk 文字對應一個 `public/phonics-audio/<chunk>.mp3`，**同拼法只有一份音**。同拼法不同發音時用 `phonics.audioOverrides: { "<chunk索引>": "<虛擬id>" }`（`fly`→`y-long-i`、`book`/`foot`→`oo-short`、`pear`→`ear-pear`、`heart`→`ear-heart`），虛擬 id 要先在 `tools/phonics-ipa.py` 的 `CHUNK_IPA` 登記它的 IPA。
- 新 chunk 或新單字都要產生音檔，`tests/data-consistency.test.js` 會檢查音檔存在、串接一致、`zh` 非空、`theme` 有對應、`audioOverrides` 指向的檔案存在——加完跑 `npm test` 就知道漏了什麼。
- 自訂關卡加進 `themes[].customLevels[].wordIds`；主題可同時有 `difficultyTiers` 分級關卡跟 `customLevels`（`getLevelDefsForTheme` 兩種都吃，一代不行）。

## 部署

push 到 `main` 觸發 `.github/workflows/deploy.yml`：`npm ci` → `npm test` → `npm run build` → GitHub Pages，測試沒過不會部署。網址 https://pcop.github.io/spell-questII/ 。`vite.config.js` 只在 `command === 'build'` 時把 `base` 設成 `/spell-questII/`，dev/test 維持 `/`。Repo 是 public，可以不帶 token 用 `curl https://api.github.com/repos/pcop/spell-questII/actions/runs?per_page=1` 看部署狀態（log 內容要 token）。

## 吉祥物

`mascot.js` 5 角色 × 9 表情 = 45 張 `public/mascot-images/<prefix>_<expression>.png`。角色隨機輪替，表情**依事件**從子集挑：答對 `laughing/winking/blushing`、答錯 `worried/pouting`、提示固定 `thinking`、待機 `neutral/thinking`。事件對應的 export：`mascotReactCorrectEmotion` / `mascotReactWrong` / `mascotReactHint` / `mascotReactCheer`，呼叫點都在 `game-flow.js`。
