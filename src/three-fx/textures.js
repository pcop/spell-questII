// 答對特效用的貼圖（Canvas 手繪，不載外部圖檔，避免多一個下載失敗點）。
// 從一代 `拼字遊戲/three-fx.js` 的 makeDotTexture/makeStarTexture/
// makeConfettiTexture/makeHeartTexture/buildTextures 搬過來，邏輯不變。

import * as THREE from 'three';

function makeDotTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeStarTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const spikes = 5;
  const outerR = size * 0.46;
  const innerR = size * 0.19;
  let rot = -Math.PI / 2;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
  for (let i = 0; i < spikes; i++) {
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.shadowColor = 'rgba(255,255,255,0.85)';
  ctx.shadowBlur = size * 0.18;
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

function makeConfettiTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4); // 斜放成菱形，跟圓點/星形一眼就能分辨
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  const w = size * 0.62;
  ctx.fillRect(-w / 2, -w * 0.28, w, w * 0.56);
  return new THREE.CanvasTexture(canvas);
}

function makeHeartTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const topY = size * 0.32;
  ctx.beginPath();
  ctx.moveTo(cx, size * 0.84);
  ctx.bezierCurveTo(size * 1.05, size * 0.55, size * 0.78, size * 0.06, cx, topY);
  ctx.bezierCurveTo(size * 0.22, size * 0.06, size * -0.05, size * 0.55, cx, size * 0.84);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.shadowColor = 'rgba(255,255,255,0.85)';
  ctx.shadowBlur = size * 0.12;
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

/**
 * 建立答對特效用的四種貼圖（一次建好、之後重複切換 material.map 使用）。
 * @returns {{dot: THREE.CanvasTexture, star: THREE.CanvasTexture, confetti: THREE.CanvasTexture, heart: THREE.CanvasTexture}}
 */
export function buildTextures() {
  return {
    dot: makeDotTexture(),
    star: makeStarTexture(),
    confetti: makeConfettiTexture(),
    heart: makeHeartTexture()
  };
}
