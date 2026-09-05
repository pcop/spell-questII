// 純裝飾性 WebGL 特效層（骨架，Phase 0）。
//
// 這支模組永遠不能讓遊戲的核心功能「靜默」失敗——WebGL 不支援時，
// initThreeFx() 必須明確回傳 false（或 reject），讓呼叫端（未來的
// game 模組）可以決定要不要鎖住拼字關卡。這是繼承自一代
// `拼字遊戲/three-fx.js` 的硬性行為（見 規劃.md F 段決策 3）：
// three.js 維持硬性需求，不做 2D 備援；差別只在於：
//   - 一代：CDN 載入失敗 or WebGL 初始化失敗 → 都不設定 window.ThreeFX，
//     靠 `threefx-ready`/`threefx-error` 兩個自訂 DOM 事件通知 app.js。
//     事件監聽必須在 DOMContentLoaded 之前同步註冊，因為 `type="module"`
//     腳本的執行時機等同 defer，會比 DOMContentLoaded 更早跑完
//     （這是一代修過的一個競速 bug，見一代 CLAUDE.md）。
//   - 二代：改用本地 npm 依賴（`import * as THREE from 'three'`），
//     「連不上 CDN」這個失敗模式已經不存在，但「裝置不支援 WebGL」
//     仍然是真實的失敗情境。既然是 ES module 環境、呼叫端就是
//     import 這支檔案的人，改用回傳值/Promise 比自訂 DOM 事件更直接、
//     也不用擔心事件監聽時機的競速問題，所以 initThreeFx() 簽名是
//     `Promise<boolean>`：resolve true＝可用，resolve false 或
//     reject＝WebGL 不支援/初始化失敗。
//
// ---------------------------------------------------------------------
// 已知踩雷點（從一代 `拼字遊戲/three-fx.js` 565 行搬過來時務必保留，
// 否則會重踩）：
//
// 1. 正交相機（OrthographicCamera） + PointsMaterial.sizeAttenuation：
//    一代座標空間直接對應螢幕像素（正交相機），sizeAttenuation 預設
//    是 true，這個公式是為透視相機設計的「越遠越小」，套在正交相機上
//    會讓算出來的粒子尺寸遠比預期小很多。PointsMaterial 一定要設定
//    `sizeAttenuation: false`。
//
// 2. pixelRatio 換算（只影響 PointsMaterial.size，不影響模型幾何尺寸）：
//    sizeAttenuation:false 之後，PointsMaterial 的 size 數值單位變成
//    framebuffer 像素（drawing buffer），不是 CSS 像素。renderer 若用
//    `setPixelRatio(2)`（retina），同一個 size 在 2x 螢幕上畫出來的
//    實際大小只有 1x 螢幕的一半，所以 size 要乘上
//    `renderer.getPixelRatio()` 才能讓外觀大小在不同螢幕密度下一致。
//    低多邊形模型（獎盃/禮物盒/寶箱）的幾何尺寸（CylinderGeometry、
//    BoxGeometry 等的引數）不要乘 pixelRatio——正交相機的座標空間本來
//    就直接對應 CSS 像素（camera 的 left/right/top/bottom 是
//    window.innerWidth/innerHeight），renderer 的投影管線會自己處理
//    framebuffer 縮放，模型的 world unit 已經等於 CSS 像素。一代模型
//    尺寸落在 100~300 這個範圍，原因是「對應螢幕像素的正交相機」，跟
//    pixelRatio 無關；誤乘 pixelRatio 會讓模型在 retina 螢幕上變成兩倍大。
//
// 3. MeshStandardMaterial 需要光源：手刻的低多邊形模型（獎盃/禮物盒/
//    寶箱）用 MeshStandardMaterial（吃光照才有立體明暗），場景一定要
//    加 AmbientLight + DirectionalLight。PointsMaterial 粒子系統不吃
//    光源，不需要加光源也看得到。
// ---------------------------------------------------------------------

import * as THREE from 'three';

/**
 * 建立 renderer / scene / 正交相機，掛到 container 底下。
 *
 * @param {HTMLElement} container - three.js canvas 要掛載的容器元素
 *   （一代是 `#three-fx-layer`）。
 * @returns {Promise<boolean>} resolve true＝WebGL 初始化成功、可以呼叫
 *   下面的 celebrate* 系列函式；resolve false 或 reject＝WebGL 不支援
 *   或初始化失敗，呼叫端應鎖住拼字關卡（沿用一代行為，不做 2D 備援）。
 */
export async function initThreeFx(container) {
  // TODO Phase 2：從 拼字遊戲/three-fx.js 的 initScene() 搬邏輯過來：
  //   - new THREE.Scene()
  //   - new THREE.OrthographicCamera(...)（座標空間對應 window.innerWidth/innerHeight）
  //   - new THREE.WebGLRenderer({ alpha: true, antialias: true })
  //   - renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  //   - AmbientLight + DirectionalLight（見上方踩雷點 3）
  //   - 建立粒子 BufferGeometry/PointsMaterial（見上方踩雷點 1、2；
  //     size 才要乘 pixelRatio）
  //   - buildModels()（獎盃/禮物盒/寶箱，見一代 buildTrophyModel 等函式；
  //     幾何尺寸維持原始數值，不要乘 pixelRatio，見上方踩雷點 2 的說明）
  //   - renderer.render(scene, camera) 立即渲染一次，及早驗證 WebGL context 真的可用
  //   - 用 try/catch 包住整個初始化，抓到任何錯誤就 resolve(false)（或 reject），
  //     不要讓例外往外拋炸掉呼叫端。
  //   - 記得也要處理 window resize（一代的 onResize()）。
  throw new Error('initThreeFx: not implemented yet (Phase 0 骨架, Phase 2 才會搬邏輯)');
}

/**
 * 答對特效（火花/彩虹雨/星星/五彩紙屑/愛心泡泡，五選一隨機且避免連續重複）。
 *
 * @returns {void}
 */
export function celebrateCorrect() {
  // TODO Phase 2：從 拼字遊戲/three-fx.js 的 celebrateCorrect() + burst() +
  // CORRECT_EFFECTS 陣列 + pickCorrectEffect() 搬邏輯過來。
  // 注意：材質（PointsMaterial）只有一份、所有粒子共用，切換造型的貼圖後
  // 記得設 `material.needsUpdate = true`，否則 three.js 不會重新綁定新的 map。
}

/**
 * 過關展示動畫。
 *
 * @param {'showcase'|'chest'} [kind='showcase'] - 'showcase'：一般過關，
 *   獎盃／禮物盒隨機展示旋轉（對應一代 celebrateLevelComplete()）；
 *   'chest'：首次三星過關的開寶箱動畫（對應一代 celebrateChestOpen()，
 *   蓋子掀開瞬間要能觸發一個 onLidOpen 回呼讓貼紙彈窗準時彈出，
 *   而不是呼叫端自己用 setTimeout 猜時間）。
 * @returns {void}
 */
export function celebrateLevelComplete(kind = 'showcase') {
  // TODO Phase 2：從 拼字遊戲/three-fx.js 的 celebrateLevelComplete() /
  // celebrateChestOpen() 搬邏輯過來，並統一成這一個函式用 kind 參數分流
  // （一代是兩支獨立的對外函式，二代先合併成一支，行為不變）。
}

/**
 * 取消還在播放的動畫（模型展示/開寶箱/粒子），中途離開結果畫面時要呼叫。
 *
 * 最重要的作用：讓「開寶箱」動畫還沒觸發的 onLidOpen 回呼永遠不會再被
 * 呼叫——不然孩子在寶箱打開前就點走，貼紙彈窗會晚半拍憑空跳出來蓋在
 * 下一個畫面上面（一代 CLAUDE.md 明確記錄這個坑）。
 *
 * @returns {void}
 */
export function cancelCelebration() {
  // TODO Phase 2：從 拼字遊戲/three-fx.js 的 cancelCelebration() 搬邏輯過來：
  //   - 若有 activeParticles 在播，清空 drawRange 並清掉狀態
  //   - 呼叫 hideActiveModel()，把還在展示的模型 visible = false
  //     並且清掉 activeModel（連帶讓還沒觸發的 onLidOpen 失效）
}
