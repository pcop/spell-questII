# 拼字冒險王 二代 🧭 🌈

> 給學齡前～國小低年級（4–8 歲）兒童的沉浸式英文拼字練習遊戲。
> 純前端架構、無後端、無帳號系統、零登入開箱即玩，進度即時保存在裝置中！

[![GitHub Pages Deployment](https://img.shields.io/badge/demo-GitHub%20Pages-brightgreen)](https://pcop.github.io/spell-questII/)
[![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-0.185-black?logo=three.js)](https://threejs.org/)
[![Vitest](https://img.shields.io/badge/Tests-73%20passed-success?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

線上立即暢玩：👉 **[https://pcop.github.io/spell-questII/](https://pcop.github.io/spell-questII/)**

---

## 📖 專案簡介

「拼字冒險王 二代」是從一代（1600+ 行單一 IIFE）歷經完整架構重構的全新升級版本。在繼承一代所有優良教學體驗（自然發音、多音節視覺分組、真人神經語音、3D 寶箱獎勵）的基礎上，以現代化前端工程全面翻新，大幅提升系統穩定度、擴充性、視覺辨識度與遊戲互動性。

### 核心設計原則
- **兒童友善（4–8 歲）**：全介面採用親切的正體中文文案、大尺寸點擊區塊、鮮明漫畫風立體視覺與動態吉祥物陪伴。
- **純前端、隱私優先**：零後端伺服器、無需註冊或綁定任何帳號，所有學習進度與貼紙收藏皆安全儲存於本機瀏覽器（`localStorage`）。
- **觸控與鍵盤雙軌支援**：支援觸控點擊、滑動拖曳及實體鍵盤快捷操作，適應平板、手機與電腦桌機。
- **無挫折感學習**：答錯不扣分、提供智慧提示安全閥、錯題本間隔複習機制，營造充滿成就感的正向回饋循環。

---

## 🌟 二代全新升級亮點

相較於一代，二代進行了全方位的技術與體驗升級：

| 升級面向 | 一代狀況 | 二代現代化成果 |
|---|---|---|
| **專案架構** | 1638 行單一 `app.js` IIFE | 採用 **Vite + ES Modules** 嚴格分層架構（UI／遊戲狀態機／音訊／3D／進度層） |
| **品質驗證** | 零自動化測試，仰賴人工點測 | 內建 **Vitest 完整測試套件（73 項測試全綠）**，涵蓋出題狀態機、音訊查找、資料一致性與冒煙整合測試 |
| **複習機制** | 僅記錄單字答題次數，未實作練習 | **全新「錯題複習模式」**，自動分析弱項字彙並降冪出題，集中火力消滅盲點 |
| **吉祥物互動** | 45 張立繪純隨機播放，與作答無關 | **事件智慧情緒驅動**：答對開心、答錯委屈、卡關思考，表情與情境生動呼應 |
| **視覺介面** | 偏淡的粉彩配色，部分文字對比不足 | **「夜空冒險」風格重構**：深靛紫漸層背景＋高對比珊瑚橙/青綠行動色，立體漫畫厚邊框 |
| **3D 特效依賴** | 透過外部 CDN 載入 Three.js | **完全本地化 npm 依賴**，徹底消除因 CDN 網路不穩導致功能鎖死的風險 |
| **進度無痛遷移** | — | 內建 **v1 ➔ v2 自動無損遷移機制**，孩子在一代累積的星等與貼紙完全保留 |
| **自然拼讀發音** | `oo`、`ear` 等同拼法多發音存在偏差 | 導入 `audioOverrides` 虛擬映射機制，精準呈現長短音差異，並修復音訊裁切靜音問題 |

---

## 🎮 遊戲與學習模式

### 1. 冒險闖關模式（拼字練習主線）
- **7 大生活化主題**：🐾 動物、🎨 顏色、🔢 數字、🍉 水果、🧸 日常物品、🙆 身體部位、🧩 其他。
- **靈活的關卡體系**：
  - **長度分級關卡**：依單字字母長度自動劃分為 初級（3 字母）／中級（4 字母）／高級（5+ 字母）。
  - **自訂關卡（Custom Levels）**：支援手動挑選單字組合（例如「暑假複習1」、「Phonics複習1」），不受長度限制。
  - **錯題複習關卡（Review Mode）**：當主題內有累積錯題時自動出現，以弱項單字為核心，不發送重複貼紙，專注鞏固基礎。
- **三種提示模式自選**：
  - 🖼️ **圖片模式**：呈現生動 Emoji / 顏色色塊，並附帶中文輔助說明（補足抽象詞意）。
  - 🔊 **發音模式**：隱藏圖文，純靠聽音辨字拼寫，適合進階挑戰聽力。
  - 🖼️🔊 **綜合模式**：圖文語音雙管齊下，打下最紮實基礎。
- **💡 提示安全閥**：遇到困難時可點擊燈泡，系統會自動填入下一個正確字母（每題限用一次，保留挑戰樂趣）。
- **多音節視覺輔助**：多音節單字（如 `banana`、`turtle`）自動加大音節間距並以交替淡色底色提示節奏。
- **答對手動確認**：答對後畫面定格顯示完整拼法，孩子看清楚、聽明白後再點擊「▶️ 下一題」或按空白鍵前進，不再手忙腳亂。

### 2. 📖 單字字卡（單字自學）
- 提供個別主題全部單字或特定難度的字卡清單。
- 顯示高清圖示、單字拼寫、中文意涵，多音節單字額外標註連字號拆解（例如 `ap-ple`）。
- **🔤 自然發音（Phonics）逐音拆解**：點擊即可逐音節/音素點讀，靜音字母（如 silent e）淡化標示，最後合成完整單字發音。
- 支援 🐢 慢速（0.5x）、🚶 正常（0.8x）、🐇 快速（1.0x）語速即時切換。
- 支援鍵盤左右方向鍵（`←` / `→`）流暢切換字卡。

### 3. 🎧 拼讀練習（聽音辨字）
- 無限隨機題庫練習，不計分、不限時、無挫折感。
- 系統自動播放單字之自然發音拼讀拆解音，畫面呈現 3 個干擾圖文選項。
- 孩子聽音選字，若答錯僅會淡出排除該錯誤選項，可繼續嘗試直到答對為止。

### 4. ⭐ 我的進度與貼紙簿
- **闖關星等總覽**：各主題與難度最佳成績、正確率一覽無遺。
- **🎟️ 貼紙收集冊**：每個關卡首次榮獲 3 星通關，即可觸發 3D 開寶箱動畫獲得專屬紀念貼紙！
- **進度備份與轉移**：提供「💾 匯出進度」與「📂 匯入進度」JSON 功能，輕鬆將進度同步至平板或新手機。
- **3D 特效診斷工具**：一鍵檢查裝置 WebGL 與 Three.js 執行狀態。

---

## 🚀 快速開始

### 環境需求
- **Node.js**：`^22.22.2 || ^24.15.0 || >=26.0.0`
  > ⚠️ 因 `jsdom@30` 的環境限制，Node 20 不相容，建議使用 Node 22 或 24。

### 本地開發步驟

```bash
# 1. 複製專案
git clone https://github.com/pcop/spell-questII.git
cd spell-questII

# 2. 安裝相依套件
npm install

# 3. 啟動本機開發伺服器
npm run dev
# 瀏覽器開啟 http://localhost:5173 即可開始遊玩！
```

### 專案指令一覽

| 指令 | 說明 |
|---|---|
| `npm run dev` | 啟動本機 Vite 開發伺服器（根目錄模式，熱更新） |
| `npm run build` | 建置正式發布產物至 `dist/`（自動套用 GitHub Pages 子路徑 `/spell-questII/`） |
| `npm run preview` | 本地預覽建置完成的正式產物 |
| `npm test` | 執行 Vitest 73 項單元與整合測試 |
| `npx vitest run tests/game.test.js` | 執行單一測試檔案 |
| `npx vitest run -t "錯題複習"` | 依關鍵字過濾執行特定測試案例 |

---

## 🏗️ 架構設計

本專案遵循嚴格的關注點分離（SoC）原則，各模組職責清晰，禁止跨層越權存取：

```
src/
├── main.js                 # 應用程式入口，協調各層初始化
├── ui/                     # 【唯一操作 DOM 的視圖層】
│   ├── index.js            # 視圖切換（showView）、全域鍵盤監聽分流
│   ├── game-flow.js        # 拼字闖關流程渲染與拼盤互動（Pointer Events）
│   ├── mascot.js           # 吉祥物立繪管理與情緒動畫切換
│   ├── flashcards.js       # 單字字卡介面
│   ├── blend.js            # 聽音拼讀練習介面
│   └── progress-page.js    # 成績總覽、貼紙簿、進度匯出入
├── game/                   # 【純邏輯層，嚴禁 DOM 操作】
│   ├── session.js          # 作答狀態機（置入、移除、提示、判分）
│   ├── wordbank.js         # 單字查詢、關卡定義解析（長度分級/自訂/複習）
│   └── helpers.js          # 洗牌、星等判定、資料輔助運算
├── audio/                  # 【語音音效層，嚴禁 DOM 操作】
│   ├── index.js            # 神經語音播放、自然拼讀音素查找、合成音效
│   └── web-speech.js       # 瀏覽器原生語音降級備援
├── three-fx/               # 【3D 粒子與模型特效層（Three.js）】
│   ├── index.js            # 正交相機、燈光、特效場景管理
│   ├── particles.js        # 答對彩帶雨／煙火粒子效果
│   ├── models.js           # 低多邊形手刻 3D 獎盃／禮物盒／開寶箱幾何模型
│   └── textures.js         # 模型貼圖程序化生成
├── progress/               # 【進度持久化層】
│   ├── store.js            # localStorage 讀寫與防呆校驗
│   ├── schema.js           # 資料結構規範
│   └── migrate.js          # v1 到 v2 存檔無痛自動升級器
├── data/                   # 【靜態題庫與語系資料】
│   ├── data.json           # 110+ 個單字庫、7 個主題、自然發音規則
│   └── messages.json       # 鼓勵語句池
└── styles.css              # 全域視覺規範、CSS 設計 Token、立體按鈕與動畫
```

---

## 📚 題庫擴充指南（新增與修改單字）

所有單字庫與關卡規則皆定義於 `src/data/data.json`，無需改動任何 JavaScript 邏輯即可擴充內容：

### 1. 單字資料格式範例

```json
{
  "id": "animal_cat",
  "word": "cat",
  "theme": "animals",
  "emoji": "🐱",
  "zh": "貓",
  "phonics": {
    "chunks": ["c", "a", "t"],
    "silent": []
  }
}
```

- **`id`**：全域唯一識別碼（建議格式：`主題_單字`）。
- **`word`**：小寫英文單字。
- **`theme`**：對應的主題代碼（如 `animals`、`fruits` 等）。
- **`emoji`**：代表圖片（若為顏色或抽象詞彙無法用 emoji，可設為 `"emoji": null` 並加入 `"swatch": "#FF5733"` 顯示色塊）。
- **`zh`**：正體中文釋義（會在「圖片」提示模式下輔助顯示）。
- **`syllables`**（選填）：多音節單字劃分（如 `["ap", "ple"]`），串接後必須等於原單字。
- **`phonics.chunks`**：自然發音音素拆解，串接後必須等於原單字。常見組合如子音群（`sh`、`ch`、`th`）、母音團（`ea`、`oo`、`ai`）各為獨立 chunk。
- **`phonics.silent`**：不發音字母在 `chunks` 陣列中的索引（如 silent e，顯示時會淡化處理）。
- **`phonics.audioOverrides`**（選填）：特殊發音映射（如 `fly` 的 `y` 需唸長音 i，可配置 `{"2": "y-long-i"}` 改查特殊音檔）。

### 2. 生成真人神經語音檔（Edge-TTS）

若新增了未曾出現的單字或新的拼讀 chunk，請使用工具腳本生成 MP3 音訊：

```bash
# 需具備 Python 3、edge-tts 與 ffmpeg
python3 tools/generate-neural-audio.py
```

- 生成音檔後，請利用 `ffmpeg` 驗證確保無異常靜音檔（mean volume 需大於 `-91.0 dB`）：
  ```bash
  ffmpeg -i public/words-audio/<word>.mp3 -af volumedetect -f null - 2>&1 | grep mean_volume
  ```
- 執行 `npm test`，`tests/data-consistency.test.js` 會自動檢查所有單字拼寫、音檔是否存在與關聯正確性。

---

## 💻 裝置相容性與操作支援

- **瀏覽器支援**：支援所有現代主流瀏覽器（Chrome 89+、Safari 16.4+、Firefox 108+、Edge 89+）。
- **行動裝置音訊解鎖**：因應行動瀏覽器（iOS Safari / Android Chrome）的自動播放限制，首次點擊畫面時會自動解鎖 Web Audio 播放權限。
- **實體鍵盤快速鍵**：
  - **英文字母鍵（A–Z）**：自動填入對應的字母方塊。
  - **Backspace / Delete**：移除最後一個填入的字母方塊。
  - **空白鍵（Space）**：作答正確後，快速前進至「下一題」。
  - **方向鍵（`←` / `→`）**：在單字字卡畫面切換上一張／下一張。

---

## 🛠️ CI/CD 與自動化部署

專案採用 GitHub Actions 進行持續整合與部署（`.github/workflows/deploy.yml`）：
- 每次推送到 `main` 分支時，自動啟動 Node.js 24 環境。
- 嚴格執行 `npm test` 測試，確保 73 個測試全數通過後才觸發打包。
- 自動將產物部署至 GitHub Pages：[https://pcop.github.io/spell-questII/](https://pcop.github.io/spell-questII/)。

---

## 📄 授權條款

本專案採 [MIT 授權條款](LICENSE) 開源釋出，歡迎自由運用、學習或推廣於兒童英語教育。
