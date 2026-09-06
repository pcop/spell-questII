// 純裝飾性 WebGL 特效層（骨架，Phase 0；邏輯已於 Phase 2 從一代搬過來）。
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
import { buildTextures } from './textures.js';
import { buildModels } from './models.js';
import { MAX_PARTICLES, pickCorrectEffect, burst, advanceParticles } from './particles.js';

// 模組層級狀態（同一份場景/渲染器整個生命週期只建一次，見 initThreeFx()）。
let scene = null;
let camera = null;
let renderer = null;
let points = null;
let models = null; // { trophy, gift, chest, chestLid }
let textures = null; // { dot, star, confetti, heart }
let baseParticleSize = 0; // 40 * pixelRatio，換算好存起來，切造型時只需再乘各組的 sizeScale
let activeParticles = null;
let activeModel = null;
let rafId = null;
let resizeHandler = null;

function onResize() {
  camera.left = window.innerWidth / -2;
  camera.right = window.innerWidth / 2;
  camera.top = window.innerHeight / 2;
  camera.bottom = window.innerHeight / -2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function ensureLoop() {
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

function hideActiveModel() {
  if (activeModel && activeModel.group) activeModel.group.visible = false;
  activeModel = null;
}

// 統一的渲染迴圈：粒子（答對用）跟模型展示（過關用）理論上不會同時觸發
// （分屬遊戲畫面跟結果畫面），但兩邊各自獨立判斷是否還在播，避免其中一個
// 播完就把另一個也一起中斷掉。
function tick(now) {
  let stillActive = false;
  const dt = 1 / 60;

  if (activeParticles) {
    stillActive = true;
    const stillPlaying = advanceParticles(points, activeParticles, dt, now);
    if (!stillPlaying) {
      activeParticles = null;
    }
  }

  if (activeModel) {
    stillActive = true;
    const m = activeModel;
    const mElapsed = now - m.startTime;
    m.group.rotation.y += m.rotateSpeed * dt;
    if (m.kind === 'chest' && !m.opened) {
      const lidProgress = Math.min(mElapsed / m.lidDuration, 1);
      m.lidGroup.rotation.x = -lidProgress * Math.PI * 0.58;
      if (lidProgress >= 1) {
        m.opened = true;
        if (m.onLidOpen) {
          // 裝飾層絕不能讓呼叫端的回呼錯誤把這裡也拖垮，出事只印警告。
          try {
            m.onLidOpen();
          } catch (err) {
            console.warn('開寶箱回呼發生錯誤，不影響遊戲本身', err);
          }
        }
      }
    }
    if (mElapsed >= m.duration) {
      m.group.visible = false;
      activeModel = null;
    }
  }

  renderer.render(scene, camera);
  rafId = stillActive ? requestAnimationFrame(tick) : null;
}

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
  try {
    if (!container) return false;

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(
      window.innerWidth / -2, window.innerWidth / 2,
      window.innerHeight / 2, window.innerHeight / -2,
      1, 1000
    );
    camera.position.z = 100;

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    resizeHandler = onResize;
    window.addEventListener('resize', resizeHandler);

    // 過關獎勵模型用 MeshStandardMaterial，需要實際光源才會有立體明暗，
    // 粒子系統用的 PointsMaterial 不吃光源（見上方踩雷點 3）。
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(150, 260, 400);
    scene.add(dirLight);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    geometry.setDrawRange(0, 0);

    textures = buildTextures();
    baseParticleSize = 40 * renderer.getPixelRatio();

    const material = new THREE.PointsMaterial({
      // sizeAttenuation:false 時 size 是 framebuffer 像素，要乘 pixelRatio
      // 才能讓外觀大小在不同螢幕密度下一致（見上方踩雷點 2）。
      size: baseParticleSize,
      map: textures.dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      // 正交相機不套用透視相機的「越遠越小」縮放公式（見上方踩雷點 1）。
      sizeAttenuation: false
    });

    points = new THREE.Points(geometry, material);
    scene.add(points);

    models = buildModels(scene);

    renderer.render(scene, camera); // 立即渲染一次，及早驗證 WebGL context 真的可用
    return true;
  } catch (err) {
    console.warn('三維特效初始化失敗，拼字遊戲關卡會被暫時鎖住。', err);
    return false;
  }
}

/**
 * 答對特效（火花/彩虹雨/星星/五彩紙屑/愛心泡泡，五選一隨機且避免連續重複）。
 *
 * @returns {void}
 */
export function celebrateCorrect() {
  if (!points) return; // initThreeFx 尚未成功初始化，裝飾層安靜跳過
  const effect = pickCorrectEffect();
  // 材質（PointsMaterial）只有一份、所有粒子共用，切到新造型的貼圖後
  // 一定要設 needsUpdate，否則 three.js 不會重新綁定新的 map。
  points.material.map = textures[effect.textureKey];
  points.material.size = baseParticleSize * (effect.sizeScale || 1);
  points.material.needsUpdate = true;
  const opts = effect.buildOpts();
  opts.palette = effect.palette;
  activeParticles = burst(points, 60, opts);
  ensureLoop();
}

/**
 * 過關展示動畫。
 *
 * Phase 1 契約更新（凍結，供 Agent 4 呼叫）：新增第二參數 `{ onLidOpen }`，
 * 因為 'chest' 動畫需要在蓋子掀開瞬間精準通知呼叫端彈出貼紙揭曉視窗，
 * 呼叫端不應該自己用 setTimeout 猜時間。'showcase' 不會觸發這個回呼。
 *
 * @param {'showcase'|'chest'} [kind='showcase'] - 'showcase'：一般過關，
 *   獎盃／禮物盒隨機展示旋轉（對應一代 celebrateLevelComplete()）；
 *   'chest'：首次三星過關的開寶箱動畫（對應一代 celebrateChestOpen()）。
 * @param {{onLidOpen?:()=>void}} [callbacks] - 'chest' 動畫蓋子掀開瞬間呼叫
 *   `onLidOpen()`；如果中途被 `cancelCelebration()` 打斷，`onLidOpen`
 *   不能再被呼叫（一代 CLAUDE.md 明確記錄的坑：貼紙彈窗晚一拍蓋在下個畫面上）。
 * @returns {void}
 */
export function celebrateLevelComplete(kind = 'showcase', callbacks = {}) {
  if (!models) return; // initThreeFx 尚未成功初始化，裝飾層安靜跳過
  hideActiveModel();

  if (kind === 'chest') {
    models.chest.rotation.set(0, 0, 0);
    models.chestLid.rotation.x = 0;
    models.chest.visible = true;
    activeModel = {
      group: models.chest,
      kind: 'chest',
      lidGroup: models.chestLid,
      startTime: performance.now(),
      duration: 2400,
      rotateSpeed: 0.3,
      lidDuration: 700,
      opened: false,
      onLidOpen: callbacks.onLidOpen || null
    };
  } else {
    const pick = Math.random() < 0.5 ? models.trophy : models.gift;
    pick.rotation.set(0, 0, 0);
    pick.visible = true;
    activeModel = {
      group: pick,
      kind: 'showcase',
      startTime: performance.now(),
      duration: 1800,
      rotateSpeed: 1.1
    };
  }

  ensureLoop();
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
  if (activeParticles && points) {
    points.geometry.setDrawRange(0, 0);
    activeParticles = null;
  }
  // hideActiveModel() 把 activeModel 設回 null，連帶讓還沒觸發的
  // onLidOpen 一起失效（tick() 只在 activeModel 存在時才會呼叫它）。
  hideActiveModel();
}
