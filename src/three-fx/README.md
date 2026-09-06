# three-fx 技術筆記（非對外文件）

這份筆記不是使用者文件，是「踩過的雷」清單，給之後維護這個模組的人看。
Phase 2 已經把一代的特效邏輯（粒子系統、低多邊形模型、動畫迴圈）搬過來，
拆成四支檔案：

- `index.js` — 對外 4 個 export（`initThreeFx`/`celebrateCorrect`/
  `celebrateLevelComplete`/`cancelCelebration`），持有 scene/camera/
  renderer/points/models 等模組層級狀態，以及統一的 `tick()` 動畫迴圈。
- `textures.js` — 答對特效用的四種 Canvas 貼圖（dot/star/confetti/heart）。
- `models.js` — 過關獎勵的三個低多邊形手刻模型（獎盃/禮物盒/寶箱）。
- `particles.js` — 粒子物理（`burst`/`advanceParticles`）與五種答對特效
  的造型定義（`CORRECT_EFFECTS`/`pickCorrectEffect`）。

## 為什麼改成 npm 依賴，不用 CDN importmap

一代 `index.html` 用 `<script type="importmap">` 從 jsdelivr CDN 載入
three.js。這是目前唯一的外部網路依賴——資料、音檔、圖片全部是本地檔案，
只有 three.js 需要連得上 CDN 才能用。一代的失敗處理是：CDN 連不上就不
設定 `window.ThreeFX`，拼字關卡整個鎖死（規劃.md F 段決策 3：three.js
維持硬性需求，不做 2D 備援——這個「鎖死」行為本身二代不變）。

二代改成 `npm install three`（版本對齊一代 `three@0.185.1`），由 Vite
在建置時把 three.js 打包進本地產出的 bundle。這不是要放棄「WebGL 不支援
時鎖關卡」這個機制，而是要**降低失敗模式本身發生的機率**：CDN 是否可達
是執行期、看使用者網路環境的不確定因素；本地依賴把「拿得到 three.js 的
程式碼」這件事從「執行期網路請求」變成「建置期就決定好、跟其他程式碼一起
打包」，之後唯一還會失敗的情境只剩「這台裝置的瀏覽器/顯卡不支援
WebGL」——這是真實的硬體/瀏覽器限制，沒辦法靠改依賴載入方式解決，所以
偵測機制（`initThreeFx()` 回傳 false/reject）要繼續保留。

## 三個踩雷點

1. **正交相機 + `PointsMaterial.sizeAttenuation` 必須設 `false`**
   一代用正交相機（座標空間直接對應螢幕像素）。`sizeAttenuation` 預設
   `true`，是幫透視相機做「離相機越遠、點越小」的縮放公式；套用在正交
   相機上，算出來的粒子尺寸會遠比預期小很多——這正是一代先前「3D 特效
   看起來很小/幾乎看不到」的主因。結論：正交相機一定要顯式設
   `sizeAttenuation: false`。

2. **`PointsMaterial.size` 要乘 `renderer.getPixelRatio()`（只限這個，模型幾何尺寸不用）**
   `sizeAttenuation:false` 之後，`PointsMaterial.size` 的單位變成
   framebuffer 像素（drawing buffer 尺寸），不是 CSS 像素。Renderer 若
   呼叫 `setPixelRatio(2)`（retina 螢幕常見值），同一個 size 數字在 2x
   螢幕上畫出來的外觀大小只有 1x 螢幕的一半。所以粒子的 size 要乘上
   `renderer.getPixelRatio()`，才能讓外觀大小在不同螢幕密度下一致。
   低多邊形模型（獎盃/禮物盒/寶箱）的幾何尺寸**不要**乘
   `renderer.getPixelRatio()`——正交相機的座標空間本來就直接對應 CSS
   像素（camera 的 left/right/top/bottom 設成
   `window.innerWidth`/`innerHeight`），renderer 的投影管線會自己處理
   framebuffer 縮放，模型的 world unit 已經等於 CSS 像素。一代模型尺寸
   落在 100~300 這個「像素單位」範圍，原因是對應螢幕像素的正交相機，
   跟 pixelRatio 無關；誤乘 pixelRatio 會讓模型在 retina 螢幕上變成
   兩倍大，是這份筆記要避免製造的新地雷。（對照一代原始碼：
   `three-fx.js` 只有 `baseParticleSize = 40 * renderer.getPixelRatio()`
   這一處乘了 pixelRatio，`buildTrophyModel`/`buildGiftBoxModel`/
   `buildChestModel` 裡的幾何尺寸引數全部是原始數字，沒有乘
   pixelRatio。一代 CLAUDE.md 裡「points/models 都要乘 pixelRatio」的
   說法不夠精確，以程式碼為準。）

3. **`MeshStandardMaterial` 需要光源，`PointsMaterial` 不需要**
   過關獎勵的手刻低多邊形模型（獎盃/禮物盒/寶箱）用
   `MeshStandardMaterial`（PBR 材質，吃光照才有立體明暗），場景必須加
   `AmbientLight` + `DirectionalLight`，不然模型會是全黑或死白平面。
   答對特效用的 `PointsMaterial` 粒子系統則完全不吃光源，不需要額外
   加光源也看得到——這兩種材質對光源的依賴不一樣，改動其中一個時要記得
   這個差異。

## 事件通知機制的調整（Phase 0 已決定，非踩雷點但值得記錄）

一代用 `threefx-ready`/`threefx-error` 兩個自訂 DOM 事件通知
`app.js`，因為 `three-fx.js` 是 `type="module"` 的獨立 script（行為等同
defer），跟 `app.js` 之間沒有直接的函式呼叫關係，只能靠全域事件溝通；
監聽器還必須在 `DOMContentLoaded` 之前同步註冊，因為 module script 執行
時機比 `DOMContentLoaded` 更早（一代修過的競速 bug）。

二代 `three-fx/index.js` 是一支被其他模組直接 `import` 的 ES module，
呼叫端就是 import 它的程式碼本身，不需要靠自訂 DOM 事件跨模組通知，改用
`initThreeFx(container): Promise<boolean>` 的回傳值/Promise 即可，也就
不用擔心監聽器註冊時機的競速問題。`resolve(true)` 對應一代的
`threefx-ready`，`resolve(false)`／reject 對應一代的 `threefx-error`。

## 現況（Phase 2 已完成搬遷）

- `initThreeFx(container)` — 建 scene/正交相機/renderer，掛到傳入的
  `container` 底下，加光源、建粒子 BufferGeometry/PointsMaterial、呼叫
  `buildModels()`，`renderer.render()` 立即渲染一次驗證 WebGL 真的可用，
  整段包在 try/catch，任何錯誤（含裝置不支援 WebGL）都 `return false`
  而不是往外拋；也註冊了 `window resize` 監聽（`onResize()`）。
- `celebrateCorrect()` — 用 `pickCorrectEffect()` 從 `CORRECT_EFFECTS`
  五選一（避免連續重複），切貼圖/size 後記得設
  `material.needsUpdate = true`，再呼叫 `burst()` 觸發粒子噴發。
- `celebrateLevelComplete(kind, callbacks)` — `kind='showcase'`：獎盃/
  禮物盒隨機挑一個展示旋轉；`kind='chest'`：播放開寶箱動畫，`tick()`
  裡逐幀追蹤 `lidGroup.rotation.x` 的掀蓋進度（`lidProgress`），進度
  剛好到 1（蓋子視覺上真的掀開的那一刻）才呼叫
  `callbacks.onLidOpen()`——不是用 `setTimeout` 猜時間。
- `cancelCelebration()` — 清空粒子 `drawRange`、呼叫 `hideActiveModel()`
  把 `activeModel` 設回 `null`，讓還沒觸發的 `onLidOpen` 永遠不會再被
  `tick()` 呼叫到。

已用 `node --check` 確認四支檔案語法正確，並用 `npx vite build`
（含一次以 `index.js` 為 entry 的臨時建置）驗證 `import * as THREE from
'three'` 能正確 resolve、整個模組能被 bundle 打包。因為 vitest 的 node
環境沒有真實 WebGL context，這個模組沒有寫自動化測試（跟 Phase 0 的
決定一致）。
