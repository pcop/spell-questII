// 答對特效的粒子物理與五種造型定義。從一代 `拼字遊戲/three-fx.js` 的
// PALETTE/STAR_PALETTE/HEART_PALETTE/MAX_PARTICLES/hexToRgb/burst/
// CORRECT_EFFECTS/pickCorrectEffect 搬過來，邏輯不變，只是把原本操作
// 模組層級 `points` 變數的寫法改成參數傳入（`points` 由 index.js 持有）。

export const PALETTE = [0xffb703, 0xfb8500, 0x06d6a0, 0xef476f, 0x8ecae6, 0xffd700];
export const STAR_PALETTE = [0xffd700, 0xffe066, 0xfff4b8, 0xffffff, 0xffb703];
export const HEART_PALETTE = [0xef476f, 0xffb3c6, 0xff8fa3, 0x8ecae6, 0xffd6e8];
export const MAX_PARTICLES = 260;

function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// 答對很頻繁，維持輕量：5 組都沿用同一套「水平等速＋重力墜落」拋物線物理
// （不碰共用的 advanceParticles() 邏輯），只靠「貼圖造型／配色／噴發參數」
// 做出明顯差異。buildOpts 用 function 包起來、在真正觸發時才算
// window.innerWidth/innerHeight，這樣視窗大小改變（旋轉螢幕等）後抓到的
// 還是最新尺寸，不會用到初始化當下的舊值。
export const CORRECT_EFFECTS = [
  {
    name: 'firework',
    textureKey: 'dot',
    palette: PALETTE,
    buildOpts() {
      return {
        originY: window.innerHeight * 0.18,
        speedY: 240,
        gravity: 400,
        duration: 1300,
        radial: true,
        // 炸開角度限制成朝上的扇形，避免整圈 360 度時有粒子直接往下噴過答題區。
        angleMin: Math.PI * 0.15,
        angleRange: Math.PI * 0.7
      };
    }
  },
  {
    name: 'rainbow-rain',
    textureKey: 'dot',
    palette: PALETTE,
    buildOpts() {
      return {
        originY: window.innerHeight * 0.15,
        spreadX: window.innerWidth * 0.5,
        speedY: 180,
        gravity: 420,
        duration: 1300
      };
    }
  },
  {
    name: 'star-scatter',
    textureKey: 'star',
    palette: STAR_PALETTE,
    sizeScale: 0.85,
    buildOpts() {
      return {
        originY: window.innerHeight * 0.18,
        speedY: 200,
        gravity: 380,
        duration: 1400,
        radial: true,
        angleMin: Math.PI * 0.15,
        angleRange: Math.PI * 0.7
      };
    }
  },
  {
    name: 'confetti',
    textureKey: 'confetti',
    palette: PALETTE,
    sizeScale: 1.1,
    buildOpts() {
      return {
        originY: window.innerHeight * 0.12,
        spreadX: window.innerWidth * 0.6,
        speedY: 150,
        gravity: 260,
        duration: 1500
      };
    }
  },
  {
    name: 'heart-bubble',
    textureKey: 'heart',
    palette: HEART_PALETTE,
    sizeScale: 0.95,
    buildOpts() {
      return {
        originY: window.innerHeight * 0.2,
        speedY: 140,
        gravity: 260,
        duration: 1450,
        radial: true,
        angleMin: Math.PI * 0.2,
        angleRange: Math.PI * 0.6
      };
    }
  }
];

// 答對特效防連續重複用：排除「上一次用過的那一組」再從剩下的裡面抽，
// 避免連續兩題看到同一組效果。模組層級變數讓拼字關卡跟拼讀練習（兩邊
// 都呼叫 celebrateCorrect()）共用同一份記錄。
let lastCorrectEffectIndex = -1;

/**
 * 從 CORRECT_EFFECTS 隨機挑一組，排除上一次用過的那一組。
 * @returns {typeof CORRECT_EFFECTS[number]}
 */
export function pickCorrectEffect() {
  const pool = CORRECT_EFFECTS.filter((_, i) => i !== lastCorrectEffectIndex);
  const choice = pool[Math.floor(Math.random() * pool.length)];
  lastCorrectEffectIndex = CORRECT_EFFECTS.indexOf(choice);
  return choice;
}

/**
 * 觸發一次粒子噴發：把資料寫進 `points` 的 BufferGeometry 屬性，回傳
 * 供 `advanceParticles()` 逐幀推進用的狀態物件。
 *
 * @param {import('three').Points} points
 * @param {number} count
 * @param {object} opts
 * @returns {{count:number, velocities:{vx:number,vy:number}[], gravity:number, startTime:number, duration:number}}
 */
export function burst(points, count, opts) {
  count = Math.min(count, MAX_PARTICLES);
  const originX = opts.originX || 0;
  const originY = opts.originY || 0;
  const spreadX = opts.spreadX || window.innerWidth * 0.3;
  const speedY = opts.speedY || 220;
  const gravity = opts.gravity || 420;
  const duration = opts.duration || 1200;
  // radial: true=像煙火一樣從一點朝四面八方炸開；false=像雨一樣從一片寬區域落下
  const radial = !!opts.radial;
  const palette = opts.palette || PALETTE;
  // radial 預設整圈 360 度炸開；angleMin/angleRange 可以限制成一個扇形角度範圍
  // （0=正右、Math.PI/2=正上方）。
  const angleMin = opts.angleMin != null ? opts.angleMin : 0;
  const angleRange = opts.angleRange != null ? opts.angleRange : Math.PI * 2;

  const positions = points.geometry.attributes.position.array;
  const colors = points.geometry.attributes.color.array;
  const velocities = [];

  for (let i = 0; i < count; i++) {
    if (radial) {
      positions[i * 3] = originX + (Math.random() - 0.5) * 16;
      positions[i * 3 + 1] = originY + (Math.random() - 0.5) * 16;
    } else {
      positions[i * 3] = originX + (Math.random() - 0.5) * spreadX;
      positions[i * 3 + 1] = originY + (Math.random() - 0.5) * 20;
    }
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;

    const rgb = hexToRgb(palette[Math.floor(Math.random() * palette.length)]);
    colors[i * 3] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];

    if (radial) {
      const angle = angleMin + Math.random() * angleRange;
      const speed = speedY * (0.5 + Math.random() * 0.8);
      velocities.push({ vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
    } else {
      velocities.push({
        vx: (Math.random() - 0.5) * 160,
        vy: speedY * (0.6 + Math.random() * 0.8)
      });
    }
  }

  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.color.needsUpdate = true;
  points.geometry.setDrawRange(0, count);
  points.material.opacity = 1;

  return { count, velocities, gravity, startTime: performance.now(), duration };
}

/**
 * 逐幀推進一次粒子噴發的物理（水平等速＋重力墜落＋尾段淡出）。
 *
 * @param {import('three').Points} points
 * @param {{count:number, velocities:{vx:number,vy:number}[], gravity:number, startTime:number, duration:number}} state
 * @param {number} dt
 * @param {number} now
 * @returns {boolean} 還在播放中回傳 true；已播完（同時已重設 drawRange 為 0）回傳 false
 */
export function advanceParticles(points, state, dt, now) {
  const positions = points.geometry.attributes.position.array;
  const elapsed = now - state.startTime;
  for (let i = 0; i < state.count; i++) {
    const v = state.velocities[i];
    positions[i * 3] += v.vx * dt;
    positions[i * 3 + 1] += v.vy * dt;
    v.vy -= state.gravity * dt;
  }
  points.geometry.attributes.position.needsUpdate = true;

  const progress = elapsed / state.duration;
  if (progress >= 1) {
    points.geometry.setDrawRange(0, 0);
    return false;
  }
  if (progress > 0.7) {
    points.material.opacity = 1 - (progress - 0.7) / 0.3;
  }
  return true;
}
