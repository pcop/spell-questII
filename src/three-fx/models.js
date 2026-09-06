// 過關獎勵用的低多邊形手刻模型（獎盃／禮物盒／寶箱）。
// 不載外部模型檔案，避免多一個下載失敗點；從一代 `拼字遊戲/three-fx.js`
// 的 buildTrophyModel/buildGiftBoxModel/buildChestModel/buildModels 搬過來。
//
// 注意（見 src/three-fx/README.md 踩雷點 2）：這裡的幾何尺寸引數
// （CylinderGeometry、BoxGeometry 等）維持一代原始數值，不要乘
// pixelRatio——正交相機的座標空間本來就直接對應 CSS 像素。

import * as THREE from 'three';

function buildTrophyModel() {
  const group = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.5 });

  const cup = new THREE.Mesh(new THREE.CylinderGeometry(60, 32, 95, 20), gold);
  cup.position.y = 75;
  group.add(cup);

  const handleGeo = new THREE.TorusGeometry(24, 7, 8, 16, Math.PI * 1.3);
  const handleL = new THREE.Mesh(handleGeo, gold);
  handleL.position.set(-60, 78, 0);
  handleL.rotation.y = Math.PI / 2;
  group.add(handleL);
  const handleR = handleL.clone();
  handleR.position.x = 60;
  handleR.rotation.y = -Math.PI / 2;
  group.add(handleR);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 60, 14), gold);
  stem.position.y = 15;
  group.add(stem);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(55, 65, 22, 20), gold);
  base.position.y = -25;
  group.add(base);

  return group;
}

function buildGiftBoxModel() {
  const group = new THREE.Group();
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xef476f, roughness: 0.55, metalness: 0.05 });
  const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.4 });

  const box = new THREE.Mesh(new THREE.BoxGeometry(150, 110, 150), boxMat);
  group.add(box);

  const ribbonV = new THREE.Mesh(new THREE.BoxGeometry(22, 115, 155), ribbonMat);
  group.add(ribbonV);
  const ribbonH = new THREE.Mesh(new THREE.BoxGeometry(155, 115, 22), ribbonMat);
  group.add(ribbonH);

  const bowL = new THREE.Mesh(new THREE.SphereGeometry(20, 10, 8), ribbonMat);
  bowL.position.set(-18, 68, 0);
  bowL.scale.set(1, 0.7, 0.6);
  group.add(bowL);
  const bowR = bowL.clone();
  bowR.position.x = 18;
  group.add(bowR);
  const bowKnot = new THREE.Mesh(new THREE.SphereGeometry(12, 10, 8), ribbonMat);
  bowKnot.position.set(0, 60, 0);
  group.add(bowKnot);

  return group;
}

// 回傳 { group, lidGroup }：lidGroup 的原點就是鉸鏈位置（底座後緣頂部），
// 蓋子網格相對鉸鏈往 +Z 偏移，所以 lidGroup.rotation.x 轉負角度時，蓋子會
// 繞著後緣往上、往後掀開，跟真實的寶箱開蓋動作方向一致。
function buildChestModel() {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.75, metalness: 0.05 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.5 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(170, 90, 110), woodMat);
  base.position.y = -35;
  group.add(base);

  const band = new THREE.Mesh(new THREE.BoxGeometry(178, 14, 118), goldMat);
  band.position.y = -35;
  group.add(band);

  const lidGroup = new THREE.Group();
  lidGroup.position.set(0, 10, -55);
  group.add(lidGroup);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(170, 40, 110), woodMat);
  lid.position.set(0, 10, 55);
  lidGroup.add(lid);

  const lidBand = new THREE.Mesh(new THREE.BoxGeometry(178, 44, 118), goldMat);
  lidBand.scale.set(1, 0.3, 1);
  lidBand.position.set(0, 10, 55);
  lidGroup.add(lidBand);

  const lock = new THREE.Mesh(new THREE.BoxGeometry(24, 28, 14), goldMat);
  lock.position.set(0, 10, 111);
  lidGroup.add(lock);

  return { group, lidGroup };
}

/**
 * 建立三個過關獎勵模型並掛到 scene（一開始都 visible=false，常駐場景
 * 中用 visible 開關展示，不要每次過關都重建又丟棄幾何體/材質）。
 *
 * @param {THREE.Scene} scene
 * @returns {{trophy: THREE.Group, gift: THREE.Group, chest: THREE.Group, chestLid: THREE.Group}}
 */
export function buildModels(scene) {
  const trophy = buildTrophyModel();
  const gift = buildGiftBoxModel();
  const chestBuilt = buildChestModel();
  const chest = chestBuilt.group;
  const chestLid = chestBuilt.lidGroup;

  [trophy, gift, chest].forEach((g) => {
    g.visible = false;
    scene.add(g);
  });

  return { trophy, gift, chest, chestLid };
}
