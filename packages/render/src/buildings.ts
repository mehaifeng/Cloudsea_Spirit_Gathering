import * as THREE from 'three';
import { lanternMaterial } from './character';
import { jitterGeo, mat, mulberry } from './util';

export interface BuildingVisualState {
  readonly built: boolean;
  /** 0..1 建造进度。 */
  readonly progress: number;
  /** 田地：作物 id 与 0..1 成熟度。 */
  readonly crop: { readonly id: string; readonly growth: number } | null;
  /** 工坊是否在工作。 */
  readonly working: boolean;
}

export interface BuildingView {
  readonly group: THREE.Group;
  /** 夜里发光的材质。 */
  readonly glows: THREE.MeshStandardMaterial[];
  update(state: BuildingVisualState, t: number): void;
}

/**
 * 尺度规范（DESIGN 14.1，v0.5）：人约 1.75 米；门高约 2.2 米、宽约 1.1 米；一层约 3 米；
 * 絮灵 0.4–1.2 米。供人使用的建筑门要能让人通过；栖巢是絮灵尺寸的小屋。
 */
export const SCALE = {
  person: 1.75,
  doorH: 2.2,
  doorW: 1.1,
  story: 3,
  spiritDoorH: 1.0,
} as const;

const C = {
  plaster: 0xefe0c2,
  plasterDark: 0xd9c7a3,
  timber: 0x8a5f40,
  timberDark: 0x6b4a35,
  roofTeal: 0x3f8a86,
  roofRed: 0xb5533c,
  roofThatch: 0xd9b56a,
  stone: 0xa49a90,
  stoneDark: 0x8f857c,
  door: 0x5e4330,
  glass: 0xbfe0f0,
  sail: 0xf6efe2,
  soil: 0x6e4b33,
};

function box(g: THREE.Object3D, w: number, h: number, d: number, color: number, x: number, y: number, z: number, opts: { ry?: number; shadow?: boolean } = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  if (opts.ry) m.rotation.y = opts.ry;
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function mesh(g: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/** 两坡屋顶：沿 x 方向的屋脊，宽 w、深 d、檐口高 y0、屋脊高 y1。 */
function gableRoof(g: THREE.Object3D, w: number, d: number, y0: number, y1: number, color: number, overhang = 0.35): void {
  const shape = new THREE.Shape();
  const hd = d / 2 + overhang;
  shape.moveTo(-hd, 0);
  shape.lineTo(0, y1 - y0);
  shape.lineTo(hd, 0);
  shape.lineTo(hd, -0.15);
  shape.lineTo(0, y1 - y0 - 0.15);
  shape.lineTo(-hd, -0.15);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w + overhang * 2, bevelEnabled: false });
  geo.translate(0, 0, -(w + overhang * 2) / 2);
  geo.rotateY(Math.PI / 2);
  const m = mesh(g, geo, mat(color), 0, y0, 0);
  m.castShadow = true;
  // 山墙
  const gable = new THREE.Shape();
  gable.moveTo(-d / 2, 0);
  gable.lineTo(0, y1 - y0 - 0.15);
  gable.lineTo(d / 2, 0);
  gable.closePath();
  for (const sx of [-1, 1]) {
    const gg = new THREE.ShapeGeometry(gable);
    const gm = mesh(g, gg, mat(C.plaster, { side: THREE.DoubleSide }), (sx * w) / 2, y0, 0);
    gm.rotation.y = Math.PI / 2;
  }
}

/** 一扇人能通过的门（门框 + 门板），贴在 z = zFace 的墙面上。 */
function door(g: THREE.Object3D, x: number, zFace: number, w: number = SCALE.doorW, hgt: number = SCALE.doorH): void {
  box(g, w + 0.2, hgt + 0.12, 0.08, C.timberDark, x, (hgt + 0.12) / 2, zFace + 0.02, { shadow: false });
  box(g, w, hgt, 0.1, C.door, x, hgt / 2, zFace + 0.05, { shadow: false });
  box(g, 0.08, 0.08, 0.06, 0xd8b45a, x + w * 0.35, hgt * 0.48, zFace + 0.12, { shadow: false });
}

function windowPane(g: THREE.Object3D, x: number, y: number, zFace: number, w = 0.8, hgt = 0.7, glowMat?: THREE.MeshStandardMaterial): void {
  box(g, w + 0.16, hgt + 0.16, 0.06, C.timberDark, x, y, zFace + 0.02, { shadow: false });
  const pane = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 0.05), glowMat ?? mat(C.glass));
  pane.position.set(x, y, zFace + 0.05);
  g.add(pane);
}

const CROP_COLORS: Record<string, number> = { sunWheat: 0xf3c95a, rainBerry: 0x5aa9e6, windbellFruit: 0x9fe0b8 };

/**
 * 建筑模型（低多边形、代码构建，按尺度规范）。w × d 是未旋转时的占地（米）；
 * 模型以占地中心为原点、门朝 +z，旋转由调用方设置 group.rotation.y。
 */
export function makeBuildingView(type: string, w: number, d: number, seed: number): BuildingView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const glows: THREE.MeshStandardMaterial[] = [];
  const rnd = mulberry(seed);
  let animate: (state: BuildingVisualState, t: number) => void = () => {};
  const windowGlow = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffb050, emissiveIntensity: 0.3, flatShading: true });

  switch (type) {
    case 'islandCore': {
      // 岛核：石台 + 石柱 + 漂浮的光晶，比人高一截
      mesh(body, new THREE.CylinderGeometry(0.95, 1.1, 0.45, 8), mat(C.stone), 0, 0.22, 0);
      mesh(body, new THREE.CylinderGeometry(0.7, 0.85, 0.3, 8), mat(C.stoneDark), 0, 0.6, 0);
      mesh(body, new THREE.CylinderGeometry(0.22, 0.32, 2.7, 6), mat(C.stoneDark), 0, 2.1, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const r = mesh(body, new THREE.BoxGeometry(0.12, 0.9, 0.12), mat(C.stone), Math.cos(a) * 0.36, 3.1, Math.sin(a) * 0.36);
        r.rotation.z = Math.cos(a) * 0.25;
        r.rotation.x = -Math.sin(a) * 0.25;
      }
      const coreMat = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffc56a, emissiveIntensity: 0.8, flatShading: true });
      const crystal = mesh(body, new THREE.OctahedronGeometry(0.42, 0), coreMat, 0, 3.9, 0);
      glows.push(coreMat);
      animate = (_s, t) => {
        crystal.rotation.y = t * 0.6;
        crystal.position.y = 3.9 + Math.sin(t * 1.5) * 0.08;
      };
      break;
    }
    case 'dock': {
      // 码头：木栈台 + 订单板小亭 + 系泊桩（云舟另行摆放）
      for (let i = 0; i < Math.round(d / 0.4); i++) box(body, w, 0.14, 0.38, i % 2 ? C.timber : C.timberDark, 0, 0.18, -d / 2 + 0.2 + i * 0.4);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(body, 0.18, 1.2, 0.18, C.timberDark, (sx * (w - 0.3)) / 2, 0.5, (sz * (d - 0.3)) / 2);
      // 订单板亭
      const kiosk = new THREE.Group();
      kiosk.position.set(-w / 2 + 0.8, 0.25, -d / 2 + 0.6);
      body.add(kiosk);
      for (const sx of [-1, 1]) box(kiosk, 0.12, 2.3, 0.12, C.timberDark, sx * 0.6, 1.15, 0);
      box(kiosk, 1.4, 0.9, 0.08, 0xd9c7a3, 0, 1.55, 0.05);
      for (let i = 0; i < 3; i++) box(kiosk, 0.3, 0.38, 0.02, 0xfff8ee, -0.4 + i * 0.4, 1.58, 0.1, { shadow: false });
      box(kiosk, 1.6, 0.12, 0.6, C.roofTeal, 0, 2.35, 0.1);
      // 灯柱
      box(body, 0.1, 2.2, 0.1, C.timberDark, w / 2 - 0.3, 1.25, -d / 2 + 0.3);
      mesh(body, new THREE.BoxGeometry(0.24, 0.3, 0.24), lanternMaterial, w / 2 - 0.3, 2.45, -d / 2 + 0.3);
      glows.push(lanternMaterial);
      break;
    }
    case 'nest': {
      // 栖巢：絮灵尺寸的圆屋（比人矮），编织墙 + 茅草顶 + 小圆门
      const r = Math.min(w, d) * 0.42;
      mesh(body, new THREE.CylinderGeometry(r, r * 1.05, 1.25, 12), mat(0xd9c39a), 0, 0.62, 0);
      for (let i = 0; i < 5; i++) {
        const ring = mesh(body, new THREE.TorusGeometry(r * 1.02, 0.035, 4, 16), mat(0xb9a07a), 0, 0.15 + i * 0.25, 0);
        ring.rotation.x = Math.PI / 2;
        ring.castShadow = false;
      }
      mesh(body, new THREE.ConeGeometry(r * 1.35, 1.3, 12), mat(C.roofThatch), 0, 1.9, 0).rotation.y = Math.PI / 12;
      mesh(body, new THREE.SphereGeometry(0.16, 6, 4), mat(0xe07a5f), 0, 2.6, 0);
      const doorGeo = new THREE.CircleGeometry(0.42, 12);
      const dm = mesh(body, doorGeo, mat(0x3d2c22), 0, 0.5, r + 0.01);
      dm.castShadow = false;
      // 门口的小垫子
      box(body, 0.9, 0.05, 0.5, 0xe8a5a0, 0, 0.03, r + 0.35, { shadow: false });
      break;
    }
    case 'field': {
      // 田地：木边框 + 垄 + 5×5 作物
      box(body, w - 0.1, 0.22, d - 0.1, C.timberDark, 0, 0.08, 0);
      box(body, w - 0.4, 0.24, d - 0.4, C.soil, 0, 0.1, 0);
      for (let i = 0; i < 5; i++) box(body, w - 0.5, 0.06, 0.16, 0x5c3d29, 0, 0.24, -d / 2 + 0.45 + (i * (d - 0.9)) / 4, { shadow: false });
      const plants = new THREE.Group();
      body.add(plants);
      const spots: Array<[number, number]> = [];
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) spots.push([-w / 2 + 0.45 + (i * (w - 0.9)) / 4, -d / 2 + 0.45 + (j * (d - 0.9)) / 4]);
      let shown = '';
      animate = (s) => {
        const key = s.crop ? `${s.crop.id}:${Math.floor(Math.min(1, s.crop.growth) * 4)}` : 'none';
        if (key === shown) return;
        shown = key;
        plants.clear();
        if (!s.crop) return;
        const stage = Math.min(1, s.crop.growth);
        const ripe = stage >= 1;
        const color = CROP_COLORS[s.crop.id] ?? 0xf3c95a;
        for (const [x, z] of spots) {
          const hgt = 0.15 + stage * (s.crop.id === 'sunWheat' ? 0.85 : 0.55);
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09, hgt, 4), mat(ripe && s.crop.id === 'sunWheat' ? 0xe8c25a : 0x7fbf5a));
          leaf.position.set(x, 0.24 + hgt / 2, z);
          leaf.castShadow = true;
          plants.add(leaf);
          if (ripe && s.crop.id !== 'sunWheat') {
            const fruit = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), mat(color));
            fruit.position.set(x + 0.07, 0.3 + hgt * 0.7, z);
            plants.add(fruit);
          }
        }
      };
      break;
    }
    case 'workshop': {
      // 工坊：一层半的木骨架房（墙 2.8 米、屋脊约 4.6 米）+ 侧边风车塔
      const hw = w - 1.6;
      const hd = d - 0.6;
      const hx = -0.6;
      const hall = new THREE.Group();
      hall.position.x = hx;
      body.add(hall);
      box(hall, hw, 0.3, hd, C.stone, 0, 0.15, 0);
      box(hall, hw, 2.8, hd, C.plaster, 0, 1.7, 0);
      for (const sx of [-1, 1]) box(hall, 0.16, 2.8, hd + 0.04, C.timber, (sx * hw) / 2, 1.7, 0);
      box(hall, hw + 0.04, 0.16, hd + 0.04, C.timber, 0, 3.05, 0);
      gableRoof(hall, hw, hd, 3.1, 4.7, C.roofTeal);
      door(hall, -0.5, hd / 2);
      windowPane(hall, hw / 2 - 0.8, 1.7, hd / 2, 0.8, 0.7, windowGlow);
      box(hall, 0.5, 1.4, 0.5, C.stoneDark, hw / 2 - 0.6, 4.6, -hd / 4);
      // 风车塔
      const tower = new THREE.Group();
      tower.position.set(w / 2 - 0.75, 0, 0);
      body.add(tower);
      mesh(tower, new THREE.CylinderGeometry(0.45, 0.65, 4.6, 8), mat(C.plasterDark), 0, 2.3, 0);
      mesh(tower, new THREE.ConeGeometry(0.7, 0.9, 8), mat(C.roofRed), 0, 5.05, 0);
      const hub = new THREE.Group();
      hub.position.set(0, 4.3, 0.75);
      tower.add(hub);
      mesh(hub, new THREE.CylinderGeometry(0.12, 0.12, 0.3, 6), mat(C.timberDark), 0, 0, 0).rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        arm.rotation.z = (i / 4) * Math.PI * 2;
        hub.add(arm);
        box(arm, 0.08, 1.9, 0.06, C.timber, 0, 0.95, 0);
        box(arm, 0.42, 1.5, 0.03, C.sail, 0.24, 1.1, 0.02);
      }
      glows.push(windowGlow);
      animate = (s, t) => {
        hub.rotation.z = t * (s.working ? 1.6 : 0.25);
      };
      break;
    }
    case 'storage': {
      // 仓库：谷仓（墙 3 米、弧形屋顶到约 4.4 米），双开大门
      box(body, w - 0.2, 0.25, d - 0.2, C.stone, 0, 0.12, 0);
      box(body, w - 0.4, 3, d - 0.4, 0xb98a5a, 0, 1.75, 0);
      for (let i = 0; i < 6; i++) box(body, 0.06, 3, d - 0.36, C.timberDark, -w / 2 + 0.4 + (i * (w - 0.8)) / 5, 1.75, 0, { shadow: false });
      const roof = mesh(body, new THREE.CylinderGeometry((d - 0.2) / 2, (d - 0.2) / 2, w - 0.1, 10, 1, false, 0, Math.PI), mat(C.roofRed), 0, 3.2, 0);
      roof.rotation.z = Math.PI / 2;
      roof.scale.set(1, 1, 0.75);
      box(body, 2, 2.4, 0.08, C.door, 0, 1.45, (d - 0.4) / 2 + 0.03);
      box(body, 2.1, 0.1, 0.1, C.timberDark, 0, 1.45, (d - 0.4) / 2 + 0.08, { shadow: false });
      box(body, 0.06, 2.3, 0.1, C.timberDark, 0, 1.45, (d - 0.4) / 2 + 0.08, { shadow: false });
      break;
    }
    case 'hatchery': {
      // 繁殖屋：圆顶房（顶高约 3.4 米），门能让人进去，外墙点缀蛋纹
      const r = Math.min(w, d) * 0.46;
      mesh(body, new THREE.CylinderGeometry(r, r + 0.1, 0.35, 14), mat(C.stone), 0, 0.17, 0);
      mesh(body, new THREE.CylinderGeometry(r - 0.05, r - 0.05, 1.6, 14), mat(0xf7e8d0), 0, 1.15, 0);
      mesh(body, new THREE.SphereGeometry(r - 0.05, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf7e8d0), 0, 1.95, 0);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3;
        const egg = mesh(body, new THREE.SphereGeometry(0.16, 6, 5), mat([0xf3b94d, 0x5aa9e6, 0x5cc8a0, 0xa77be8, 0xb8bfd6][i % 5]!), Math.cos(a) * (r - 0.02), 1.0 + (i % 2) * 0.45, Math.sin(a) * (r - 0.02));
        egg.scale.y = 1.3;
      }
      door(body, 0, r - 0.1);
      mesh(body, new THREE.OctahedronGeometry(0.22, 0), mat(0xfff1c8, { emissive: 0xffd08a, emissiveIntensity: 0.4 }), 0, 1.95 + r - 0.1, 0);
      break;
    }
    case 'purifyPool':
    case 'hotSpring': {
      const spring = type === 'hotSpring';
      const r = Math.min(w, d) * 0.42;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const st = mesh(body, jitterGeo(new THREE.DodecahedronGeometry(0.28, 0), 0.1, rnd), mat(C.stone), Math.cos(a) * r, 0.16, Math.sin(a) * r);
        st.rotation.y = rnd() * 6;
      }
      const water = new THREE.MeshStandardMaterial({ color: spring ? 0x9fd8e6 : 0xbfd0ff, emissive: spring ? 0x4aa6c0 : 0x8a7be8, emissiveIntensity: 0.25, roughness: 0.2, flatShading: true });
      mesh(body, new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.14, 16), water, 0, 0.1, 0);
      glows.push(water);
      if (spring) {
        // 木围屏（1.6 米，比人肩高）
        for (let i = 0; i < 7; i++) box(body, 0.5, 1.6, 0.08, C.timber, -w / 2 + 0.4 + i * 0.52, 0.8, -d / 2 + 0.15);
      } else {
        // 净化池旁的灯柱（1.8 米）
        box(body, 0.12, 1.8, 0.12, C.timberDark, w / 2 - 0.35, 0.9, -d / 2 + 0.35);
        mesh(body, new THREE.BoxGeometry(0.26, 0.3, 0.26), lanternMaterial, w / 2 - 0.35, 1.9, -d / 2 + 0.35);
        glows.push(lanternMaterial);
      }
      const puffs: THREE.Mesh[] = [];
      for (let i = 0; i < (spring ? 7 : 3); i++) {
        const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, flatShading: true }));
        body.add(p);
        puffs.push(p);
      }
      animate = (_s, t) => {
        puffs.forEach((p, i) => {
          const k = (t * 0.35 + i / puffs.length) % 1;
          p.position.set(Math.sin(i * 2.3) * r * 0.5, 0.25 + k * 2.2, Math.cos(i * 1.7) * r * 0.5);
          p.scale.setScalar(0.6 + k * 1.4);
          (p.material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - k);
        });
      };
      break;
    }
    case 'lamp': {
      // 路灯：2.6 米，灯在人头顶上方
      box(body, 0.12, 2.5, 0.12, C.door, 0, 1.25, 0);
      box(body, 0.5, 0.07, 0.07, C.door, 0.18, 2.45, 0);
      box(body, 0.28, 0.34, 0.28, 0x3d2c22, 0.38, 2.22, 0);
      mesh(body, new THREE.BoxGeometry(0.22, 0.28, 0.3), lanternMaterial, 0.38, 2.22, 0);
      glows.push(lanternMaterial);
      break;
    }
    case 'fence': {
      for (const x of [-0.45, 0.45]) box(body, 0.1, 1, 0.1, C.timber, x, 0.5, 0);
      for (const y of [0.35, 0.75]) box(body, 1, 0.08, 0.05, C.timberDark, 0, y, 0);
      break;
    }
    case 'path': {
      for (let i = 0; i < 3; i++) {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.22 + rnd() * 0.08, 0.25, 0.06, 6), mat(0xd8cbb5));
        st.position.set((rnd() - 0.5) * 0.5, 0.03, (rnd() - 0.5) * 0.5);
        st.receiveShadow = true;
        body.add(st);
      }
      break;
    }
    case 'flowerbed': {
      box(body, 0.9, 0.25, 0.9, C.timber, 0, 0.12, 0);
      const FC = [0xf6d365, 0xf7a6b6, 0xffffff, 0xbaa7f3, 0xf59e7b];
      for (let i = 0; i < 7; i++) {
        const x = (rnd() - 0.5) * 0.6;
        const z = (rnd() - 0.5) * 0.6;
        box(body, 0.03, 0.3, 0.03, 0x5c9a4c, x, 0.4, z, { shadow: false });
        mesh(body, new THREE.IcosahedronGeometry(0.08, 0), mat(FC[i % FC.length]!), x, 0.58, z);
      }
      break;
    }
    default:
      box(body, w * 0.8, 2.8, d * 0.8, 0xcccccc, 0, 1.4, 0);
  }

  // 施工中：脚手架（随建筑高度）+ 主体按进度长高
  const scaffold = new THREE.Group();
  const sh = type === 'workshop' ? 4.6 : type === 'storage' || type === 'hatchery' ? 3.4 : type === 'islandCore' || type === 'dock' ? 0 : 2.2;
  if (sh > 0) {
    for (const [x, z] of [[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]] as const) box(scaffold, 0.1, sh, 0.1, 0xb98a5a, x, sh / 2, z);
    for (const y of [sh * 0.45, sh * 0.9]) {
      box(scaffold, w, 0.07, 0.1, 0xb98a5a, 0, y, -d / 2 + 0.1);
      box(scaffold, w, 0.07, 0.1, 0xb98a5a, 0, y, d / 2 - 0.1);
    }
  }
  group.add(scaffold);

  return {
    group,
    glows,
    update(state, t) {
      scaffold.visible = !state.built;
      body.scale.y = state.built ? 1 : Math.max(0.12, state.progress);
      animate(state, t);
    },
  };
}
