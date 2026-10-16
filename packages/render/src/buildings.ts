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
  /** 夜里发光的材质与光晕。 */
  readonly glows: THREE.MeshStandardMaterial[];
  update(state: BuildingVisualState, t: number): void;
}

function add(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.castShadow = true;
  o.receiveShadow = true;
  g.add(o);
  return o;
}

const CROP_COLORS: Record<string, number> = { sunWheat: 0xf3c95a, rainBerry: 0x5aa9e6, windbellFruit: 0x9fe0b8 };

/**
 * 建筑模型（低多边形、代码构建）。w × d 是占地（米），模型以占地中心为原点。
 */
export function makeBuildingView(type: string, w: number, d: number, seed: number): BuildingView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const glows: THREE.MeshStandardMaterial[] = [];
  const rnd = mulberry(seed);
  let animate: (state: BuildingVisualState, t: number) => void = () => {};

  switch (type) {
    case 'islandCore': {
      add(body, new THREE.CylinderGeometry(0.9, 1.1, 0.5, 8), mat(0xa49a90), 0, 0.25, 0);
      add(body, new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6), mat(0x8f857c), 0, 1.2, 0);
      const coreMat = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffc56a, emissiveIntensity: 0.8, flatShading: true });
      const crystal = add(body, new THREE.OctahedronGeometry(0.42, 0), coreMat, 0, 2.35, 0);
      glows.push(coreMat);
      animate = (_s, t) => {
        crystal.rotation.y = t * 0.6;
        crystal.position.y = 2.35 + Math.sin(t * 1.5) * 0.08;
      };
      break;
    }
    case 'dock': {
      for (let i = 0; i < 5; i++) add(body, new THREE.BoxGeometry(w * 0.95, 0.12, 0.36), mat(i % 2 ? 0x9a6a43 : 0x8a5f40), 0, 0.15, -d / 2 + 0.25 + i * 0.4);
      for (const sx of [-1, 1]) add(body, new THREE.CylinderGeometry(0.08, 0.1, 1.1, 5), mat(0x6b4a35), (sx * w) / 2.3, 0.45, d / 2 - 0.2);
      // 小风帆
      const boat = new THREE.Group();
      boat.position.set(0, -0.2, d / 2 + 1.4);
      body.add(boat);
      add(boat, new THREE.BoxGeometry(1.1, 0.4, 2.6), mat(0x8a5f40), 0, 0, 0);
      add(boat, new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), mat(0x5e4330), 0, 1.3, 0);
      const sail = add(boat, new THREE.ConeGeometry(0.9, 1.9, 3), mat(0xf6efe2), 0, 1.4, -0.25);
      sail.scale.z = 0.15;
      add(body, new THREE.CylinderGeometry(0.04, 0.05, 1.4, 5), mat(0x5e4330), -w / 2.3, 0.8, -d / 2 + 0.3);
      add(body, new THREE.BoxGeometry(0.2, 0.25, 0.2), lanternMaterial, -w / 2.3, 1.55, -d / 2 + 0.3);
      glows.push(lanternMaterial);
      animate = (_s, t) => {
        boat.position.y = -0.2 + Math.sin(t * 1.2) * 0.06;
        boat.rotation.z = Math.sin(t * 0.9) * 0.03;
      };
      break;
    }
    case 'nest': {
      add(body, new THREE.CylinderGeometry(0.85, 0.95, 0.9, 9), mat(0xd9c39a), 0, 0.45, 0);
      add(body, new THREE.ConeGeometry(1.25, 0.9, 9), mat(0xe07a5f), 0, 1.35, 0, Math.PI / 9);
      add(body, new THREE.CircleGeometry(0.3, 8), mat(0x3d2c22), 0, 0.42, 0.9).rotation.y = 0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(body, new THREE.TorusGeometry(0.88, 0.04, 4, 12), mat(0xb9a07a), 0, 0.15 + i * 0.13, 0).rotation.x = Math.PI / 2 + Math.sin(a) * 0.05;
      }
      break;
    }
    case 'field': {
      add(body, new THREE.BoxGeometry(w * 0.95, 0.16, d * 0.95), mat(0x6e4b33), 0, 0.06, 0);
      const plants = new THREE.Group();
      body.add(plants);
      const spots: Array<[number, number]> = [];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) spots.push([-w / 2 + 0.3 + (i * (w - 0.6)) / 3, -d / 2 + 0.3 + (j * (d - 0.6)) / 3]);
      let shown = '';
      animate = (s) => {
        const key = s.crop ? `${s.crop.id}:${Math.floor(s.crop.growth * 4)}` : 'none';
        if (key === shown) return;
        shown = key;
        plants.clear();
        if (!s.crop) return;
        const stage = Math.min(1, s.crop.growth);
        const ripe = stage >= 1;
        const color = CROP_COLORS[s.crop.id] ?? 0xf3c95a;
        for (const [x, z] of spots) {
          const h = 0.1 + stage * 0.45;
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, h, 4), mat(ripe && s.crop.id === 'sunWheat' ? 0xe8c25a : 0x7fbf5a));
          leaf.position.set(x, 0.15 + h / 2, z);
          leaf.castShadow = true;
          plants.add(leaf);
          if (ripe && s.crop.id !== 'sunWheat') {
            const fruit = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), mat(color));
            fruit.position.set(x + 0.05, 0.2 + h * 0.7, z);
            plants.add(fruit);
          }
        }
      };
      break;
    }
    case 'workshop': {
      add(body, new THREE.BoxGeometry(w * 0.8, 1.4, d * 0.7), mat(0xefe0c2), 0, 0.7, 0);
      const roof = add(body, new THREE.ConeGeometry(Math.max(w, d) * 0.62, 1, 4), mat(0x3f8a86), 0, 1.9, 0, Math.PI / 4);
      roof.scale.z = 0.8;
      add(body, new THREE.BoxGeometry(0.5, 0.9, 0.1), mat(0x6b4a35), 0, 0.45, (d * 0.7) / 2 + 0.01);
      add(body, new THREE.BoxGeometry(0.3, 0.8, 0.3), mat(0x9b9088), w * 0.25, 2.1, -d * 0.15);
      const hub = new THREE.Group();
      hub.position.set(-w * 0.32, 1.6, (d * 0.7) / 2 + 0.15);
      body.add(hub);
      for (let i = 0; i < 4; i++) {
        const blade = add(hub, new THREE.BoxGeometry(0.14, 1.1, 0.04), mat(0xf6efe2), 0, 0.55, 0);
        const arm = new THREE.Group();
        arm.rotation.z = (i / 4) * Math.PI * 2;
        arm.add(blade);
        hub.add(arm);
      }
      animate = (s, t) => {
        hub.rotation.z = t * (s.working ? 2.2 : 0.3);
      };
      break;
    }
    case 'storage': {
      add(body, new THREE.BoxGeometry(w * 0.85, 1.2, d * 0.85), mat(0xb98a5a), 0, 0.6, 0);
      const roof = add(body, new THREE.CylinderGeometry(w * 0.5, w * 0.5, d * 0.9, 6, 1, false, 0, Math.PI), mat(0x8a3f3a), 0, 1.2, 0);
      roof.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      add(body, new THREE.BoxGeometry(0.7, 0.8, 0.06), mat(0x6b4a35), 0, 0.4, (d * 0.85) / 2 + 0.02);
      break;
    }
    case 'hatchery': {
      add(body, new THREE.CylinderGeometry(1.25, 1.35, 0.4, 10), mat(0xd9c39a), 0, 0.2, 0);
      add(body, new THREE.SphereGeometry(1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf7e8d0), 0, 0.4, 0);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        add(body, new THREE.SphereGeometry(0.12, 6, 4), mat(0xf3b94d), Math.cos(a) * 0.95, 0.9 + Math.sin(i) * 0.15, Math.sin(a) * 0.95);
      }
      add(body, new THREE.BoxGeometry(0.5, 0.7, 0.1), mat(0x6b4a35), 0, 0.75, 1.15);
      break;
    }
    case 'purifyPool':
    case 'hotSpring': {
      const spring = type === 'hotSpring';
      const r = Math.min(w, d) * 0.45;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const st = new THREE.Mesh(jitterGeo(new THREE.DodecahedronGeometry(0.22, 0), 0.08, rnd), mat(0xa49a90));
        st.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r);
        body.add(st);
      }
      const water = new THREE.MeshStandardMaterial({ color: spring ? 0x9fd8e6 : 0xbfd0ff, emissive: spring ? 0x4aa6c0 : 0x8a7be8, emissiveIntensity: 0.25, roughness: 0.2, flatShading: true });
      add(body, new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.12, 14), water, 0, 0.1, 0);
      glows.push(water);
      const puffs: THREE.Mesh[] = [];
      for (let i = 0; i < (spring ? 6 : 3); i++) {
        const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, flatShading: true }));
        body.add(p);
        puffs.push(p);
      }
      animate = (_s, t) => {
        puffs.forEach((p, i) => {
          const k = (t * 0.4 + i / puffs.length) % 1;
          p.position.set(Math.sin(i * 2.3) * r * 0.5, 0.2 + k * 1.6, Math.cos(i * 1.7) * r * 0.5);
          p.scale.setScalar(0.6 + k * 1.2);
          (p.material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - k);
        });
      };
      break;
    }
    case 'lamp': {
      add(body, new THREE.CylinderGeometry(0.04, 0.06, 1.35, 5), mat(0x5e4330), 0, 0.67, 0);
      add(body, new THREE.BoxGeometry(0.32, 0.05, 0.05), mat(0x5e4330), 0.12, 1.32, 0);
      add(body, new THREE.BoxGeometry(0.22, 0.28, 0.22), mat(0x3d2c22), 0.26, 1.12, 0);
      add(body, new THREE.BoxGeometry(0.17, 0.22, 0.24), lanternMaterial, 0.26, 1.12, 0);
      glows.push(lanternMaterial);
      break;
    }
    case 'fence': {
      for (const x of [-0.4, 0.4]) add(body, new THREE.BoxGeometry(0.1, 0.7, 0.1), mat(0x8a5f40), x, 0.35, 0);
      for (const y of [0.25, 0.5]) add(body, new THREE.BoxGeometry(0.95, 0.07, 0.05), mat(0x9a6a43), 0, y, 0);
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
      add(body, new THREE.BoxGeometry(0.9, 0.2, 0.9), mat(0x8a5f40), 0, 0.1, 0);
      const FC = [0xf6d365, 0xf7a6b6, 0xffffff, 0xbaa7f3, 0xf59e7b];
      for (let i = 0; i < 6; i++) add(body, new THREE.IcosahedronGeometry(0.09, 0), mat(FC[i % FC.length]!), (rnd() - 0.5) * 0.6, 0.3, (rnd() - 0.5) * 0.6);
      break;
    }
    default:
      add(body, new THREE.BoxGeometry(w * 0.8, 1, d * 0.8), mat(0xcccccc), 0, 0.5, 0);
  }

  // 施工中：脚手架 + 半透明
  const scaffold = new THREE.Group();
  for (const [x, z] of [[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]] as const) {
    add(scaffold, new THREE.BoxGeometry(0.08, 1.8, 0.08), mat(0xb98a5a), x, 0.9, z);
  }
  add(scaffold, new THREE.BoxGeometry(w, 0.06, 0.08), mat(0xb98a5a), 0, 1.2, -d / 2 + 0.1);
  add(scaffold, new THREE.BoxGeometry(w, 0.06, 0.08), mat(0xb98a5a), 0, 1.2, d / 2 - 0.1);
  group.add(scaffold);

  return {
    group,
    glows,
    update(state, t) {
      scaffold.visible = !state.built;
      body.scale.y = state.built ? 1 : Math.max(0.15, state.progress);
      animate(state, t);
    },
  };
}
