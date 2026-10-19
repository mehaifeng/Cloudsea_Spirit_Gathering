import * as THREE from 'three';
import { lanternMaterial } from './character';
import { mat, mulberry } from './util';

/**
 * 风帆商队的大船（v0.11，修船播片）：比玩家的小云舟大一倍多，约 11 米长、3.8 米宽。
 * 放样船身 + 甲板；船尾高起的后甲板与舵轮；中部的船舱（门、亮着的窗、烟囱）；
 * 两根桅杆挂着带商队徽记的方帆，主桅顶是黄铜笼里的大块云气晶体；
 * 前甲板堆着货箱、木桶、麻袋和绳圈；四个推进舱；桅杆之间拉着一串小灯；船头斜桅、船尾旗。
 * 右舷（+x）中部留登船口，放舷梯用。
 *
 * 坐标：船头朝 +z，甲板面在 y = CARAVAN_DECK_Y（船体局部坐标）。
 */
export const CARAVAN_DECK_Y = 1.3;
export const CARAVAN_LENGTH = { stern: -5.0, bow: 5.6 } as const;
/** 右舷登船口：中心 z 与半宽。 */
export const CARAVAN_GATE = { z: 0.1, half: 0.5 } as const;
/** 后甲板：从船尾到 z1，比甲板高 rise。 */
const QUARTER = { z1: -3.3, rise: 0.55 } as const;

/** 船舷（甲板高度处）的半宽。 */
export function caravanHalfWidth(z: number): number {
  if (z <= CARAVAN_LENGTH.stern || z >= CARAVAN_LENGTH.bow) return 0;
  if (z < 0) return 1.9 - 0.5 * Math.pow(-z / 5, 2);
  return 1.9 * (1 - Math.pow(z / 5.6, 2.4));
}

/** 船体局部坐标 (lx, lz) 处的甲板 / 后甲板高度；不在船上返回 null。 */
export function caravanFloorAt(lx: number, lz: number): number | null {
  if (Math.abs(lx) > caravanHalfWidth(lz) - 0.1) return null;
  return CARAVAN_DECK_Y + (lz < QUARTER.z1 ? QUARTER.rise : 0);
}

const gunwaleY = (z: number) => CARAVAN_DECK_Y + 0.3 + (z > 3 ? 0.6 * Math.pow((z - 3) / 2.6, 2) : 0) + (z < QUARTER.z1 ? QUARTER.rise : 0);
const keelY = (z: number) => (z > 0 ? 0.9 * Math.pow(z / 5.6, 2.5) : 0.35 * Math.pow(-z / 5, 3));

const COL = {
  light: 0xb0814f, mid: 0x9a6a43, dark: 0x5e4130, keel: 0x4f3727, deck: 0xc9a27a,
  teal: 0x2f6f6a, green: 0x5cc8a0, brass: 0xc9a35a, sail: 0xf1e6cf, roof: 0x2f5f5a, cloth: 0xd8c7a0,
};

export interface CaravanShipView {
  readonly group: THREE.Group;
  /** 随船身起伏的部分（甲板上的船员挂在它下面，跟着一起晃）。 */
  readonly deck: THREE.Group;
  readonly glows: THREE.MeshStandardMaterial[];
  /** speed：0 = 停泊，1 = 全速。 */
  update(t: number, speed: number): void;
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function bar(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, thick: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, a.distanceTo(b)), mat(color));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

function hullGeometry(): THREE.BufferGeometry {
  const zs = [-5.0, -4.7, -4.0, -3.0, -1.8, -0.5, 0.8, 2.0, 3.0, 3.9, 4.6, 5.2, 5.6];
  const sections = zs.map((z) => {
    const hw = Math.max(0.05, caravanHalfWidth(z === 5.6 ? 5.58 : z));
    const gy = gunwaleY(z);
    const ky = keelY(z);
    const fr = [1, 0.99, 0.9, 0.62, 0.25];
    const fy = [0, 0.3, 0.6, 0.86, 0.98];
    const half = fr.map((f, i) => new THREE.Vector3(hw * f, gy + (ky - gy) * fy[i]!, z));
    return [...half.map((v) => new THREE.Vector3(-v.x, v.y, v.z)), new THREE.Vector3(0, ky, z), ...[...half].reverse()];
  });
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, color: number) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
    c.setHex(color);
    for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
  };
  for (let s = 0; s < sections.length - 1; s++) {
    const A = sections[s]!;
    const B = sections[s + 1]!;
    for (let i = 0; i < A.length - 1; i++) {
      // 色带：最上一条青绿饰边，一条商队绿，往下浅木 / 中木，船底深色
      const band = i < 5 ? i : 9 - i;
      const color = band === 0 ? COL.teal : band === 1 ? COL.green : band === 2 ? COL.light : band === 3 ? COL.mid : COL.keel;
      tri(A[i]!, B[i]!, B[i + 1]!, color);
      tri(A[i]!, B[i + 1]!, A[i + 1]!, color);
    }
  }
  const st = sections[0]!;
  const center = new THREE.Vector3(0, (gunwaleY(-5) + keelY(-5)) / 2, -5);
  for (let i = 0; i < st.length - 1; i++) tri(center, st[i + 1]!, st[i]!, COL.dark);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** 鼓起来的方帆：宽 w、高 h，中间往前鼓 belly 米；正面画一个商队徽记（绿圆 + 白色帆形）。 */
function sail(w: number, h: number, belly: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, h, 6, 4);
  const p = geo.attributes['position']!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2);
    const y = p.getY(i) / (h / 2);
    p.setZ(i, belly * (1 - x * x) * (1 - 0.6 * y * y));
  }
  geo.computeVertexNormals();
  const cloth = new THREE.Mesh(geo, mat(COL.sail, { side: THREE.DoubleSide }));
  cloth.castShadow = true;
  g.add(cloth);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.98, h * 0.12), mat(COL.green, { side: THREE.DoubleSide }));
  stripe.position.set(0, -h * 0.36, belly * 0.55 + 0.02);
  g.add(stripe);
  const badge = new THREE.Mesh(new THREE.CircleGeometry(h * 0.2, 12), mat(COL.green, { side: THREE.DoubleSide }));
  badge.position.set(0, h * 0.08, belly + 0.03);
  g.add(badge);
  const mark = new THREE.BufferGeometry();
  const r = h * 0.13;
  mark.setAttribute('position', new THREE.Float32BufferAttribute([0, r, 0, -r * 0.7, -r * 0.7, 0, r * 0.5, -r * 0.5, 0], 3));
  mark.computeVertexNormals();
  const m = new THREE.Mesh(mark, mat(COL.sail, { side: THREE.DoubleSide }));
  m.position.set(0, h * 0.08, belly + 0.05);
  g.add(m);
  return g;
}

export function makeCaravanShip(seed = 5): CaravanShipView {
  const rnd = mulberry(seed);
  const group = new THREE.Group();
  const deck = new THREE.Group();
  group.add(deck);
  const glows: THREE.MeshStandardMaterial[] = [lanternMaterial];

  const hull = new THREE.Mesh(hullGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }));
  hull.castShadow = true;
  hull.receiveShadow = true;
  deck.add(hull);

  // 甲板
  const shape = new THREE.Shape();
  const zs: number[] = [];
  for (let z = -4.95; z <= 5.3; z += 0.25) zs.push(z);
  zs.forEach((z, i) => {
    const w = Math.max(0.03, caravanHalfWidth(z) - 0.08);
    if (i === 0) shape.moveTo(-w, -z);
    else shape.lineTo(-w, -z);
  });
  for (let i = zs.length - 1; i >= 0; i--) shape.lineTo(Math.max(0.03, caravanHalfWidth(zs[i]!) - 0.08), -zs[i]!);
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
  deckGeo.rotateX(-Math.PI / 2);
  const deckMesh = new THREE.Mesh(deckGeo, mat(COL.deck));
  deckMesh.position.y = CARAVAN_DECK_Y - 0.1;
  deckMesh.receiveShadow = true;
  deck.add(deckMesh);
  for (let z = -3.0; z <= 4.8; z += 0.5) {
    const w = caravanHalfWidth(z) - 0.1;
    if (w > 0.2) box(deck, w * 2, 0.012, 0.04, COL.dark, 0, CARAVAN_DECK_Y + 0.006, z).castShadow = false;
  }

  // 后甲板：高起的平台 + 两级台阶 + 舵轮
  const qLen = QUARTER.z1 - CARAVAN_LENGTH.stern - 0.05;
  const qw = caravanHalfWidth(-4.2) - 0.1;
  box(deck, qw * 2, QUARTER.rise, qLen, COL.light, 0, CARAVAN_DECK_Y + QUARTER.rise / 2, (QUARTER.z1 + CARAVAN_LENGTH.stern) / 2 + 0.02).receiveShadow = true;
  box(deck, qw * 2 + 0.02, 0.06, 0.08, COL.dark, 0, CARAVAN_DECK_Y + QUARTER.rise, QUARTER.z1);
  for (let i = 0; i < 2; i++) box(deck, 0.9, QUARTER.rise * (i + 1) / 3, 0.28, COL.mid, 0, CARAVAN_DECK_Y + (QUARTER.rise * (i + 1)) / 6, QUARTER.z1 + 0.42 - i * 0.28);
  const wheelZ = -4.25;
  const qy = CARAVAN_DECK_Y + QUARTER.rise;
  box(deck, 0.12, 0.85, 0.12, COL.dark, 0, qy + 0.42, wheelZ);
  const wheel = new THREE.Group();
  wheel.position.set(0, qy + 1.0, wheelZ + 0.1);
  deck.add(wheel);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 5, 14), mat(COL.mid));
  wheel.add(rim);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.52, 0.035), mat(COL.dark));
    spoke.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
  }
  const hubM = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8), mat(COL.brass));
  hubM.rotation.x = Math.PI / 2;
  wheel.add(hubM);

  // 栏杆：两舷立柱 + 扶手，右舷登船口不连；后甲板上一圈矮栏
  const railH = 0.85;
  const postsZ: number[] = [];
  for (let z = -4.7; z <= 4.9; z += 0.8) postsZ.push(Math.round(z * 100) / 100);
  const gate = [CARAVAN_GATE.z - CARAVAN_GATE.half, CARAVAN_GATE.z + CARAVAN_GATE.half];
  for (const sx of [-1, 1]) {
    const zsSide = [...postsZ.filter((z) => sx < 0 || z < gate[0]! - 0.2 || z > gate[1]! + 0.2), ...(sx > 0 ? gate : [])].sort((a, b) => a - b);
    const tops = zsSide.map((z) => {
      const x = sx * (caravanHalfWidth(z) - 0.06);
      const base = gunwaleY(z);
      const top = base + railH - 0.3 + (z > 3 ? 0.1 : 0);
      box(deck, 0.08, top - base + 0.05, 0.08, COL.dark, x, (top + base) / 2, z);
      return new THREE.Vector3(x, top, z);
    });
    for (let i = 0; i < tops.length - 1; i++) {
      if (sx > 0 && tops[i]!.z === gate[0] && tops[i + 1]!.z === gate[1]) continue;
      bar(deck, tops[i]!, tops[i + 1]!, 0.07, COL.dark);
    }
  }
  // 登船口两边的门柱顶上一对小灯笼
  for (const z of gate) {
    const x = caravanHalfWidth(z) - 0.06;
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), lanternMaterial);
    l.position.set(x, gunwaleY(z) + railH - 0.05, z);
    deck.add(l);
  }

  // 船舱：墙、门、亮着的窗、坡屋顶、烟囱
  const cab = { z0: -3.15, z1: -1.25, w: 2.5, h: 1.9 };
  const cz = (cab.z0 + cab.z1) / 2;
  const cd = cab.z1 - cab.z0;
  box(deck, cab.w, cab.h, cd, COL.cloth, 0, CARAVAN_DECK_Y + cab.h / 2, cz).receiveShadow = true;
  for (const sx of [-1, 1]) for (const z of [cab.z0, cab.z1]) box(deck, 0.12, cab.h, 0.12, COL.dark, (sx * cab.w) / 2, CARAVAN_DECK_Y + cab.h / 2, z);
  box(deck, 0.7, 1.45, 0.06, COL.dark, -0.45, CARAVAN_DECK_Y + 0.72, cab.z1 + 0.02);
  box(deck, 0.06, 0.06, 0.06, COL.brass, -0.2, CARAVAN_DECK_Y + 0.75, cab.z1 + 0.06);
  const win = (x: number, z: number, ry: number) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.04), lanternMaterial);
    w.position.set(x, CARAVAN_DECK_Y + 1.2, z);
    w.rotation.y = ry;
    deck.add(w);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), mat(COL.dark));
    frame.position.set(x, CARAVAN_DECK_Y + 0.99, z);
    frame.rotation.y = ry;
    deck.add(frame);
  };
  win(0.6, cab.z1 + 0.02, 0);
  for (const sx of [-1, 1]) {
    win((sx * cab.w) / 2 + sx * 0.02, cz - 0.4, Math.PI / 2);
    win((sx * cab.w) / 2 + sx * 0.02, cz + 0.45, Math.PI / 2);
  }
  // 坡屋顶：两片斜板 + 屋脊
  for (const sx of [-1, 1]) {
    const r = box(deck, cab.w / 2 + 0.35, 0.08, cd + 0.4, COL.roof, (sx * (cab.w / 2 + 0.35)) / 2 - sx * 0.02, CARAVAN_DECK_Y + cab.h + 0.32, cz);
    r.rotation.z = -sx * 0.48;
  }
  box(deck, 0.14, 0.12, cd + 0.45, COL.dark, 0, CARAVAN_DECK_Y + cab.h + 0.6, cz);
  box(deck, 0.24, 0.6, 0.24, COL.dark, 0.7, CARAVAN_DECK_Y + cab.h + 0.55, cab.z0 + 0.45);
  box(deck, 0.32, 0.06, 0.32, COL.brass, 0.7, CARAVAN_DECK_Y + cab.h + 0.86, cab.z0 + 0.45);

  // 两根桅杆：桅杆、上下帆桁、方帆、桅顶三角旗；主桅顶黄铜笼里一大块云气晶体
  const coreMat = new THREE.MeshStandardMaterial({ color: 0xdff4ff, emissive: 0x8fd1f0, emissiveIntensity: 0.9, flatShading: true });
  glows.push(coreMat);
  const sails: THREE.Group[] = [];
  let core: THREE.Mesh | null = null;
  const pennants: THREE.Mesh[] = [];
  for (const m of [{ z: 0.9, top: 8.2, w: 3.6, main: true }, { z: 3.4, top: 6.6, w: 2.8, main: false }]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, m.top - CARAVAN_DECK_Y + 0.3, 7), mat(COL.dark));
    mast.position.set(0, (m.top + CARAVAN_DECK_Y - 0.3) / 2, m.z);
    mast.castShadow = true;
    deck.add(mast);
    const lo = CARAVAN_DECK_Y + 2.2;
    const hi = m.top - (m.main ? 1.4 : 0.5);
    for (const y of [lo, hi]) {
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, m.w + 0.3, 6), mat(COL.dark));
      yard.rotation.z = Math.PI / 2;
      yard.position.set(0, y, m.z + 0.08);
      yard.castShadow = true;
      deck.add(yard);
    }
    const s = sail(m.w, hi - lo - 0.1, 0.35);
    s.position.set(0, (lo + hi) / 2, m.z + 0.12);
    deck.add(s);
    sails.push(s);
    // 帆脚的缆绳拉到船舷
    for (const sx of [-1, 1]) bar(deck, new THREE.Vector3((sx * m.w) / 2, lo, m.z + 0.1), new THREE.Vector3(sx * (caravanHalfWidth(m.z - 0.6) - 0.1), gunwaleY(m.z - 0.6) + 0.1, m.z - 0.6), 0.02, COL.cloth);
    const pen = new THREE.BufferGeometry();
    pen.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.4, 0, 0, -0.2, -1.1], 3));
    pen.computeVertexNormals();
    const p = new THREE.Mesh(pen, mat(COL.green, { side: THREE.DoubleSide }));
    p.position.set(0, m.top + (m.main ? 0.95 : 0.35), m.z);
    deck.add(p);
    pennants.push(p);
    if (m.main) {
      const cy = m.top - 0.55;
      core = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), coreMat);
      core.position.set(0, cy, m.z);
      deck.add(core);
      for (const y of [cy - 0.55, cy + 0.6]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 4, 16), mat(COL.brass, { metalness: 0.3, roughness: 0.6 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, y, m.z);
        deck.add(ring);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        bar(deck, new THREE.Vector3(Math.cos(a) * 0.55, cy - 0.55, m.z + Math.sin(a) * 0.55), new THREE.Vector3(Math.cos(a) * 0.55, cy + 0.6, m.z + Math.sin(a) * 0.55), 0.035, COL.brass);
      }
    }
  }
  // 桅杆之间、前桅到船头拉一串小灯
  const lampLine = (a: THREE.Vector3, b: THREE.Vector3, n: number) => {
    bar(deck, a, b, 0.015, COL.dark);
    for (let i = 1; i < n; i++) {
      const p = a.clone().lerp(b, i / n);
      p.y -= Math.sin((i / n) * Math.PI) * 0.35;
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.11), lanternMaterial);
      l.position.copy(p);
      deck.add(l);
    }
  };
  lampLine(new THREE.Vector3(0, CARAVAN_DECK_Y + 4.6, 0.9), new THREE.Vector3(0, CARAVAN_DECK_Y + 4.0, 3.4), 5);
  lampLine(new THREE.Vector3(0, CARAVAN_DECK_Y + 3.6, 3.4), new THREE.Vector3(0, gunwaleY(5.3) + 0.9, 5.9), 4);

  // 船头：斜桅 + 船头饰；船尾：舵 + 旗杆与商队旗
  const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.8, 6), mat(COL.dark));
  sprit.rotation.x = Math.PI / 2 - 0.35;
  sprit.position.set(0, gunwaleY(5.4) + 0.25, 6.05);
  deck.add(sprit);
  const prow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 5), mat(COL.green));
  prow.rotation.x = Math.PI / 2 - 0.3;
  prow.position.set(0, gunwaleY(5.5) - 0.15, 5.75);
  deck.add(prow);
  box(deck, 0.1, 1.5, 0.9, COL.teal, 0, 0.9, -5.2).rotation.x = 0.08;
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 2.2, 5), mat(COL.dark));
  flagPole.position.set(0, qy + 1.1, -4.85);
  deck.add(flagPole);
  const flagGeo = new THREE.PlaneGeometry(1.0, 0.6, 4, 1);
  const flag = new THREE.Mesh(flagGeo, mat(COL.green, { side: THREE.DoubleSide }));
  flag.rotation.y = Math.PI / 2;
  flag.position.set(0, qy + 1.85, -5.35);
  deck.add(flag);

  // 前甲板的货：货箱（两摞）、木桶、麻袋、绳圈；都避开右舷登船口到船舱门的通道
  const crate = (x: number, y: number, z: number, s: number) => {
    const b = box(deck, s, s, s, rnd() < 0.5 ? COL.light : COL.mid, x, y + s / 2, z);
    b.rotation.y = (rnd() - 0.5) * 0.3;
    box(deck, s + 0.02, 0.05, s + 0.02, COL.dark, x, y + s * 0.8, z).rotation.y = b.rotation.y;
    return s;
  };
  const d0 = CARAVAN_DECK_Y;
  crate(-1.0, d0, 1.9, 0.6);
  crate(-1.0, d0 + 0.6, 1.95, 0.5);
  crate(-0.35, d0, 1.95, 0.55);
  crate(-1.05, d0, 2.6, 0.55);
  crate(-0.9, d0, -0.6, 0.5);
  crate(-1.15, d0, -0.05, 0.45);
  for (const [x, z] of [[0.95, 2.3], [1.0, 2.85], [0.45, 2.55]] as const) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.62, 9), mat(COL.mid));
    barrel.position.set(x, d0 + 0.31, z);
    barrel.castShadow = true;
    deck.add(barrel);
    for (const y of [0.12, 0.5]) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 9), mat(COL.dark));
      hoop.position.set(x, d0 + y, z);
      deck.add(hoop);
    }
  }
  for (let i = 0; i < 3; i++) {
    const sack = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), mat(COL.cloth));
    sack.scale.set(1, 0.7, 1.3);
    sack.position.set(-0.3 + i * 0.32, d0 + 0.18, 3.25 + (i % 2) * 0.15);
    sack.rotation.y = rnd() * 3;
    sack.castShadow = true;
    deck.add(sack);
  }
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 5, 12), mat(COL.cloth));
  coil.rotation.x = Math.PI / 2;
  coil.position.set(1.0, d0 + 0.06, -0.9);
  deck.add(coil);

  // 四个推进舱：两舷各两个（挂架插进船身）+ 螺旋桨 + 发光导流环
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x8fd1f0, emissiveIntensity: 0.6, flatShading: true });
  glows.push(ringMat);
  const props: THREE.Group[] = [];
  for (const pz of [-2.2, 2.4]) {
    for (const sx of [-1, 1]) {
      const pod = new THREE.Group();
      const hw = caravanHalfWidth(pz);
      pod.position.set(sx * (hw + 0.45), 0.9, pz);
      deck.add(pod);
      box(pod, 0.7, 0.14, 0.5, COL.brass, -sx * 0.35, 0.05, 0);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 1.3, 8), mat(COL.teal));
      body.rotation.x = Math.PI / 2;
      body.castShadow = true;
      pod.add(body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 8), mat(COL.teal));
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.85;
      pod.add(nose);
      const prop = new THREE.Group();
      prop.position.z = -0.8;
      pod.add(prop);
      for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.03), mat(COL.mid));
        blade.position.y = 0.22;
        blade.rotation.y = 0.35;
        const arm = new THREE.Group();
        arm.rotation.z = (i / 4) * Math.PI * 2;
        arm.add(blade);
        prop.add(arm);
      }
      props.push(prop);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.045, 5, 18), ringMat);
      ring.position.z = -0.8;
      pod.add(ring);
    }
  }

  return {
    group,
    deck,
    glows,
    update(t, speed) {
      if (core) core.rotation.y = t * 0.8;
      for (const p of props) p.rotation.z = t * (5 + speed * 30);
      for (const s of sails) s.scale.z = 1 + Math.sin(t * 1.7 + s.position.z) * 0.12 + speed * 0.3;
      for (const p of pennants) p.rotation.y = Math.sin(t * 3 + p.position.z) * 0.35;
      flag.rotation.y = Math.PI / 2 + Math.sin(t * 2.4) * 0.2;
      deck.position.y = Math.sin(t * 1.1) * 0.06;
      deck.rotation.z = Math.sin(t * 0.8) * 0.015;
      deck.rotation.x = -speed * 0.05;
    },
  };
}
