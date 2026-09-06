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

```bash
python3 tools/generate-neural-audio.py      # 全部重新生成（Edge-TTS + ffmpeg，需網路）
```
全跑會覆蓋所有既有音檔，通常不要這樣做——只生成新檔案的做法是 `exec` 這支腳本的模組內容後直接呼叫 `generate_tts()` + `process_word_audio()` / `process_audio()`（腳本頂層有 `asyncio.run(main())`，要先把那兩行 strip 掉，並塞 `__file__` 進 exec 的 namespace 讓 `ROOT_DIR` 算得出來）。生成後**每個檔案都要**跑 `ffmpeg -i <f> -af volumedetect -f null - 2>&1 | grep mean_volume`，`-91.0 dB` 代表完全靜音（一代真的發生過，根因是 `atrim` 後沒 `asetpts=PTS-STARTPTS`，已修，但這個檢查留著）。

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
- 每個 chunk 文字對應一個 `public/phonics-audio/<chunk>.mp3`，**同拼法只有一份音**。同拼法不同發音時用 `phonics.audioOverrides: { "<chunk索引>": "<虛擬id>" }`（`fly`→`y-long-i`、`book`/`foot`→`oo-short`、`pear`→`ear-pear`、`heart`→`ear-heart`），虛擬 id 要先在 `tools/generate-neural-audio.py` 的 `CHUNK_CONFIG` 登記載體單字與裁切秒數。
- 新 chunk 或新單字都要產生音檔，`tests/data-consistency.test.js` 會檢查音檔存在、串接一致、`zh` 非空、`theme` 有對應、`audioOverrides` 指向的檔案存在——加完跑 `npm test` 就知道漏了什麼。
- 自訂關卡加進 `themes[].customLevels[].wordIds`；主題可同時有 `difficultyTiers` 分級關卡跟 `customLevels`（`getLevelDefsForTheme` 兩種都吃，一代不行）。

## 部署

push 到 `main` 觸發 `.github/workflows/deploy.yml`：`npm ci` → `npm test` → `npm run build` → GitHub Pages，測試沒過不會部署。網址 https://pcop.github.io/spell-questII/ 。`vite.config.js` 只在 `command === 'build'` 時把 `base` 設成 `/spell-questII/`，dev/test 維持 `/`。Repo 是 public，可以不帶 token 用 `curl https://api.github.com/repos/pcop/spell-questII/actions/runs?per_page=1` 看部署狀態（log 內容要 token）。

## 吉祥物

`mascot.js` 5 角色 × 9 表情 = 45 張 `public/mascot-images/<prefix>_<expression>.png`。角色隨機輪替，表情**依事件**從子集挑：答對 `laughing/winking/blushing`、答錯 `worried/pouting`、提示固定 `thinking`、待機 `neutral/thinking`。事件對應的 export：`mascotReactCorrectEmotion` / `mascotReactWrong` / `mascotReactHint` / `mascotReactCheer`，呼叫點都在 `game-flow.js`。
