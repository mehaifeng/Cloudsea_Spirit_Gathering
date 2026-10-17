import * as THREE from 'three';
import { lanternMaterial } from './character';
import { mat, mulberry } from './util';

/**
 * 云舟（DESIGN 3.6，v0.6 重做）：以云气为动力的小型浮空艇，约 5 米长、1.9 米宽。
 * 船身由一串横截面放样而成（船底收窄、船头翘起），所有零件都连在船身上，不悬空：
 * 甲板、齐腰栏杆（左舷留一道登船口）、中桅 + 桅顶云气晶体与黄铜笼、船头灯柱与吊灯、
 * 两侧推进舱（挂架插进船身）+ 螺旋桨与导流环（支撑杆连着舱体）、船尾舵、船头饰。
 * 失事版：船底破洞、龙骨折裂、碎木板支棱出来；甲板以上基本完好，只是核心熄灭、一根栏杆折断。
 * v0.7：两舷都有登船口；可放下的舷梯（按高差自适应倾角，见 makeGangway）；可在“完好 / 破损”之间切换
 * （开场迫降时触地那一刻才换成破损的船底）。
 *
 * 坐标：船头朝 +z，甲板面在 y = SKIFF_DECK_Y（船体局部坐标）。
 */
export const SKIFF_DECK_Y = 0.68;
/** 船身半长（船尾到船头约 -2.3..2.55）。 */
export const SKIFF_LENGTH = { stern: -2.3, bow: 2.55 } as const;
/** 登船口的 z 范围（两舷都有，v0.7）。 */
export const SKIFF_GATE = { z0: -0.55, z1: 0.25 } as const;

/** 两侧推进舱：舱体中心 z、向外伸出的最远处（含导流环）、前后半长。碰撞要算上它们。 */
export const SKIFF_POD = { z: -1.35, reach: 1.62, half: 0.85 } as const;

/** 船身连推进舱在内、某个 z 处的碰撞半宽。 */
export function skiffCollisionHalfWidth(z: number): number {
  const hull = skiffHalfWidth(z);
  return Math.abs(z - SKIFF_POD.z) <= SKIFF_POD.half ? Math.max(hull, SKIFF_POD.reach) : hull;
}

/** 船舷（甲板高度处）的半宽，随 z 变化。 */
export function skiffHalfWidth(z: number): number {
  if (z <= SKIFF_LENGTH.stern || z >= SKIFF_LENGTH.bow) return 0;
  if (z < 0) return 0.95 - 0.25 * Math.pow(-z / 2.3, 2);
  return 0.95 * (1 - Math.pow(z / 2.55, 2.2));
}

const gunwaleY = (z: number) => 0.9 + (z > 1 ? 0.26 * Math.pow((z - 1) / 1.55, 2) : 0) + (z < -1.7 ? 0.06 : 0);
const keelY = (z: number) => 0.05 + (z > 0 ? 0.55 * Math.pow(z / 2.55, 2.5) : 0.22 * Math.pow(-z / 2.3, 3));

export interface SkiffView {
  readonly group: THREE.Group;
  /** 甲板上的位置（船体局部坐标）：0 号给玩家，其余给絮灵。 */
  readonly seats: readonly THREE.Vector3[];
  readonly glows: THREE.MeshStandardMaterial[];
  /** speed：0 = 停泊，1 = 全速。 */
  update(t: number, speed: number): void;
  /** 云气核心亮度 0..1（开场迫降时闪烁、熄灭）。 */
  setCore(level: number): void;
  /** 切换完好 / 破损（只有 damageable 或 wrecked 的云舟有破损版）。 */
  setDamaged(damaged: boolean): void;
}

const WOOD = { light: 0xa8774b, mid: 0x9a6a43, dark: 0x6b4a35, keel: 0x5a3e2c, trim: 0xe07a5f, deck: 0xc9a27a, brass: 0xc9a35a, teal: 0x3f8a86 };

/** 放样船身：每个横截面 9 个点（左舷 → 龙骨 → 右舷）。返回非索引几何（按面上色）。 */
function hullGeometry(wrecked: boolean, rnd: () => number): { geo: THREE.BufferGeometry; holes: THREE.Vector3[] } {
  const zs = [-2.3, -2.05, -1.6, -1.0, -0.35, 0.3, 0.95, 1.5, 1.95, 2.3, 2.55];
  const sections = zs.map((z, si) => {
    const hw = Math.max(0.03, skiffHalfWidth(z === 2.55 ? 2.54 : z));
    const gy = gunwaleY(z);
    let ky = keelY(z);
    // 失事：船身中段的龙骨被撞得往上折
    if (wrecked && si >= 3 && si <= 6) ky += 0.08 + rnd() * 0.12;
    const fr = [1, 0.97, 0.72, 0.28];
    const fy = [0, 0.45, 0.85, 0.98];
    const half = fr.map((f, i) => new THREE.Vector3(hw * f, gy + (ky - gy) * fy[i]!, z));
    const keel = new THREE.Vector3(0, ky, z);
    return [...half.map((v) => new THREE.Vector3(-v.x, v.y, v.z)), keel, ...[...half].reverse()];
  });
  const pos: number[] = [];
  const col: number[] = [];
  const holes: THREE.Vector3[] = [];
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
      // 色带：最上一条是红色饰边，往下浅木 / 中木交替，船底深色
      const band = i < 4 ? i : 7 - i;
      const color = band === 0 ? WOOD.trim : band === 1 ? WOOD.light : band === 2 ? WOOD.mid : WOOD.keel;
      if (wrecked && band >= 2 && s >= 2 && s <= 7 && rnd() < 0.42) {
        holes.push(A[i]!.clone().add(B[i + 1]!).multiplyScalar(0.5));
        continue;
      }
      tri(A[i]!, B[i]!, B[i + 1]!, color);
      tri(A[i]!, B[i + 1]!, A[i + 1]!, color);
    }
  }
  // 船尾板（扇形封口）
  const st = sections[0]!;
  const center = new THREE.Vector3(0, (gunwaleY(-2.3) + keelY(-2.3)) / 2, -2.3);
  for (let i = 0; i < st.length - 1; i++) tri(center, st[i + 1]!, st[i]!, WOOD.dark);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return { geo, holes };
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** 两点之间的一根杆（盒子），用于栏杆扶手、撑杆。 */
function bar(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, thick: number, color: number): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), mat(color));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function makeSkiff(opts: { wrecked?: boolean; damageable?: boolean; seed?: number } = {}): SkiffView {
  const wrecked = !!opts.wrecked;
  const twoState = wrecked || !!opts.damageable;
  const rnd = mulberry(opts.seed ?? 7);
  const group = new THREE.Group();
  const hull = new THREE.Group();
  group.add(hull);
  const glows: THREE.MeshStandardMaterial[] = [];
  /** 完好时显示的零件 / 破损时显示的零件。 */
  const intact: THREE.Object3D[] = [];
  const broken: THREE.Object3D[] = [];
  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide });

  // 船身（可破损的云舟两份：完好的与破洞的）
  const addHull = (damaged: boolean): THREE.Vector3[] => {
    const { geo, holes } = hullGeometry(damaged, damaged ? mulberry((opts.seed ?? 7) + 101) : rnd);
    const m = new THREE.Mesh(geo, hullMat);
    m.castShadow = true;
    m.receiveShadow = true;
    hull.add(m);
    (damaged ? broken : intact).push(m);
    return holes;
  };
  addHull(false);
  const holes = twoState ? addHull(true) : [];

  // 甲板：按船舷形状挤出的木板面
  const shape = new THREE.Shape();
  const dz: number[] = [];
  for (let z = -2.25; z <= 2.2; z += 0.15) dz.push(z);
  dz.forEach((z, i) => {
    const w = Math.max(0.02, skiffHalfWidth(z) - 0.06);
    if (i === 0) shape.moveTo(-w, -z);
    else shape.lineTo(-w, -z);
  });
  for (let i = dz.length - 1; i >= 0; i--) shape.lineTo(Math.max(0.02, skiffHalfWidth(dz[i]!) - 0.06), -dz[i]!);
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
  deckGeo.rotateX(-Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, mat(WOOD.deck));
  deck.position.y = SKIFF_DECK_Y - 0.08;
  deck.receiveShadow = true;
  hull.add(deck);
  for (let z = -1.9; z <= 1.9; z += 0.45) {
    const w = skiffHalfWidth(z) - 0.08;
    if (w > 0.1) box(hull, w * 2, 0.012, 0.035, WOOD.dark, 0, SKIFF_DECK_Y + 0.006, z).castShadow = false;
  }

  // 栏杆：立柱从船舷立起，扶手连着立柱；左舷留登船口
  const railTop = SKIFF_DECK_Y + 0.9;
  const postZ = [-2.0, -1.4, -0.8, SKIFF_GATE.z0, SKIFF_GATE.z1, 0.85, 1.45, 1.9];
  for (const sx of [-1, 1]) {
    const tops: THREE.Vector3[] = [];
    postZ.forEach((z, i) => {
      const x = sx * (skiffHalfWidth(z) - 0.05);
      const base = gunwaleY(z);
      const h = railTop - base;
      const post = box(hull, 0.06, h + 0.05, 0.06, WOOD.dark, x, base + h / 2 - 0.02, z);
      // 破损：右舷船尾一根立柱折断（完好版用整根）
      if (twoState && sx === 1 && i === 1) {
        intact.push(post);
        const stub = box(hull, 0.06, (h + 0.05) * 0.45, 0.06, WOOD.dark, x, base + (h * 0.45) / 2, z);
        stub.rotation.z = 0.5;
        broken.push(stub);
        tops.push(new THREE.Vector3(x, railTop, z));
        (tops[tops.length - 1] as THREE.Vector3 & { fragile?: boolean }).fragile = true;
        return;
      }
      tops.push(new THREE.Vector3(x, railTop, z));
    });
    for (let i = 0; i < tops.length - 1; i++) {
      const a = tops[i]! as THREE.Vector3 & { fragile?: boolean };
      const b = tops[i + 1]! as THREE.Vector3 & { fragile?: boolean };
      // 两舷登船口的门柱之间不连扶手
      if (a.z === SKIFF_GATE.z0 && b.z === SKIFF_GATE.z1) continue;
      const r = bar(hull, a, b, 0.06, WOOD.dark);
      if (a.fragile || b.fragile) intact.push(r);
    }
  }
  // 船尾横栏（连两舷最后一根立柱）
  bar(hull, new THREE.Vector3(-(skiffHalfWidth(-2.0) - 0.05), railTop, -2.0), new THREE.Vector3(skiffHalfWidth(-2.0) - 0.05, railTop, -2.0), 0.06, WOOD.dark);

  // 中桅 + 桅顶云气晶体（桅杆穿进晶体）+ 黄铜笼（上下两道环，辐条连着桅杆）
  const mastZ = -0.75;
  const mastTop = 2.75;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, mastTop - SKIFF_DECK_Y + 0.4, 7), mat(WOOD.dark));
  mast.position.set(0, (mastTop + SKIFF_DECK_Y - 0.4) / 2, mastZ);
  mast.castShadow = true;
  hull.add(mast);
  const coreMat = new THREE.MeshStandardMaterial({ color: 0xdff4ff, emissive: 0x8fd1f0, emissiveIntensity: 0.9, flatShading: true });
  glows.push(coreMat);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.27, 0), coreMat);
  core.position.set(0, mastTop + 0.12, mastZ);
  hull.add(core);
  const ringY = [mastTop - 0.18, mastTop + 0.44];
  for (const y of ringY) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 4, 14), mat(WOOD.brass, { metalness: 0.3, roughness: 0.6 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, y, mastZ);
    hull.add(ring);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 0.34;
    const z = Math.sin(a) * 0.34;
    bar(hull, new THREE.Vector3(x, ringY[0]!, mastZ + z), new THREE.Vector3(x, ringY[1]!, mastZ + z), 0.03, WOOD.brass);
  }
  // 下环辐条连到桅杆；上环辐条交到桅顶小帽
  for (let i = 0; i < 2; i++) {
    const a = (i / 2) * Math.PI;
    bar(hull, new THREE.Vector3(-Math.cos(a) * 0.34, ringY[0]!, mastZ - Math.sin(a) * 0.34), new THREE.Vector3(Math.cos(a) * 0.34, ringY[0]!, mastZ + Math.sin(a) * 0.34), 0.03, WOOD.brass);
    bar(hull, new THREE.Vector3(-Math.cos(a) * 0.34, ringY[1]!, mastZ - Math.sin(a) * 0.34), new THREE.Vector3(Math.cos(a) * 0.34, ringY[1]!, mastZ + Math.sin(a) * 0.34), 0.03, WOOD.brass);
  }
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 6), mat(WOOD.brass));
  cap.position.set(0, ringY[1]! + 0.1, mastZ);
  hull.add(cap);

  // 船头灯柱：从甲板立起 → 向前的灯臂 → 吊杆 → 提灯
  const lampZ = 1.75;
  box(hull, 0.08, 1.25, 0.08, WOOD.dark, 0, SKIFF_DECK_Y + 0.6, lampZ);
  box(hull, 0.06, 0.06, 0.5, WOOD.dark, 0, SKIFF_DECK_Y + 1.2, lampZ + 0.22);
  box(hull, 0.02, 0.14, 0.02, 0x3d2c22, 0, SKIFF_DECK_Y + 1.1, lampZ + 0.43);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2), lanternMaterial);
  lamp.position.set(0, SKIFF_DECK_Y + 0.9, lampZ + 0.43);
  hull.add(lamp);
  box(hull, 0.24, 0.04, 0.24, 0x3d2c22, 0, SKIFF_DECK_Y + 1.04, lampZ + 0.43);
  glows.push(lanternMaterial);

  // 船头饰：插在船头尖上的小尖角
  const prow = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.55, 5), mat(WOOD.trim));
  prow.rotation.x = Math.PI / 2 - 0.35;
  prow.position.set(0, gunwaleY(2.5) - 0.02, 2.62);
  hull.add(prow);

  // 船尾舵：一半插进船尾板
  const rudder = box(hull, 0.06, 0.85, 0.55, WOOD.trim, 0, 0.62, -2.42);
  rudder.rotation.x = 0.08;

  // 两侧推进舱：挂架（插进船身）→ 舱体 → 尾锥 → 螺旋桨毂与桨叶；导流环用三根撑杆连在舱体上
  const props: THREE.Group[] = [];
  let bentBlade: THREE.Object3D | null = null;
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x8fd1f0, emissiveIntensity: 0.6, flatShading: true });
  glows.push(ringMat);
  const rings: THREE.Mesh[] = [];
  const podZ = SKIFF_POD.z;
  for (const sx of [-1, 1]) {
    const pod = new THREE.Group();
    const podX = sx * 1.32;
    pod.position.set(podX, 0.56, podZ);
    hull.add(pod);
    const inner = skiffHalfWidth(podZ) * 0.8;
    // 挂架：从船身里面伸出来接到舱体侧面
    const pylonLen = Math.abs(podX) - inner;
    const pylon = box(pod, pylonLen, 0.12, 0.42, WOOD.brass, -sx * (pylonLen / 2), 0.02, 0.05);
    pylon.castShadow = true;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.26, 1.0, 8), mat(WOOD.teal));
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    pod.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.3, 8), mat(WOOD.teal));
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.65;
    pod.add(nose);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.12, 0.2, 8), mat(WOOD.brass));
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -0.6;
    pod.add(tail);
    const prop = new THREE.Group();
    prop.position.z = -0.74;
    pod.add(prop);
    const hub = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 6), mat(WOOD.brass));
    hub.rotation.x = -Math.PI / 2;
    prop.add(hub);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.02), mat(WOOD.mid));
      blade.position.y = 0.17;
      blade.rotation.y = 0.35;
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2;
      arm.add(blade);
      prop.add(arm);
    }
    if (twoState && sx === 1) bentBlade = (prop.children[2] as THREE.Group).children[0]!;
    props.push(prop);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 5, 18), ringMat);
    ring.position.z = -0.74;
    pod.add(ring);
    rings.push(ring);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      bar(pod, new THREE.Vector3(Math.cos(a) * 0.2, Math.sin(a) * 0.2, -0.58), new THREE.Vector3(Math.cos(a) * 0.4, Math.sin(a) * 0.4, -0.74), 0.03, WOOD.brass);
    }
  }

  // 破损：破洞边支棱出来的碎木板
  if (twoState) {
    const r2 = mulberry((opts.seed ?? 7) + 7);
    for (const hp of holes) {
      for (let k = 0; k < 2; k++) {
        const shard = box(hull, 0.05, 0.03, 0.35 + r2() * 0.25, r2() < 0.5 ? WOOD.mid : WOOD.keel, hp.x * (0.9 + r2() * 0.2), hp.y - 0.02, hp.z + (r2() - 0.5) * 0.3);
        shard.rotation.set((r2() - 0.5) * 1.2, (r2() - 0.5) * 0.8, (r2() - 0.5) * 1.4);
        broken.push(shard);
      }
    }
  }
  let damaged = false;
  const applyDamage = (d: boolean) => {
    damaged = d && twoState;
    for (const o of intact) o.visible = !damaged;
    for (const o of broken) o.visible = damaged;
    if (bentBlade) bentBlade.rotation.x = damaged ? 0.9 : 0;
  };
  applyDamage(wrecked);

  const seats = [new THREE.Vector3(-0.15, SKIFF_DECK_Y, 0.55), new THREE.Vector3(-0.38, SKIFF_DECK_Y, -1.45), new THREE.Vector3(0.38, SKIFF_DECK_Y, -1.45), new THREE.Vector3(0.3, SKIFF_DECK_Y, 1.15)];

  let coreLevel = wrecked ? 0 : 1;
  const applyCore = () => {
    coreMat.emissiveIntensity = 0.9 * coreLevel;
    coreMat.color.setScalar(0.55 + 0.45 * coreLevel);
    ringMat.emissiveIntensity = 0.6 * coreLevel;
  };
  applyCore();

  return {
    group,
    seats,
    glows,
    setDamaged(d) {
      applyDamage(d);
    },
    setCore(level) {
      coreLevel = level;
      applyCore();
    },
    update(t, speed) {
      core.rotation.y = t * 1.2 * coreLevel;
      if (damaged || wrecked) return;
      for (const p of props) p.rotation.z = t * (4 + speed * 30);
      for (const r of rings) r.scale.setScalar(1 + Math.sin(t * 6) * 0.05 * (0.3 + speed));
      hull.position.y = Math.sin(t * 1.4) * 0.06;
      hull.rotation.z = Math.sin(t * 0.9) * 0.025;
      hull.rotation.x = -speed * 0.06;
    },
  };
}

/**
 * 舷梯（v0.7）：从登船口放到地面 / 码头的木板坡道，两侧有扶绳。
 * 局部坐标：原点在甲板边缘（登船口），沿 +x 向外、向下；set(run, drop, extend) 按水平距离与落差摆好，
 * extend 0..1 控制伸出多少（放下 / 收起的动画）。
 */
export interface GangwayView {
  readonly group: THREE.Group;
  set(run: number, drop: number, extend: number): void;
}

export function makeGangway(): GangwayView {
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  group.add(tilt);
  const planks: THREE.Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.72), mat(i % 2 ? WOOD.mid : WOOD.light));
    p.castShadow = true;
    p.receiveShadow = true;
    tilt.add(p);
    planks.push(p);
  }
  const beams = [-1, 1].map((sz) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 0.06), mat(WOOD.dark));
    b.position.z = sz * 0.38;
    tilt.add(b);
    return b;
  });
  const ropes = [-1, 1].map((sz) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.03), mat(0xc9a27a));
    r.position.z = sz * 0.38;
    tilt.add(r);
    return r;
  });
  const posts = [-1, 1].flatMap((sz) => [0, 1].map((end) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), mat(WOOD.dark));
    p.userData['end'] = end;
    p.position.z = sz * 0.38;
    tilt.add(p);
    return p;
  }));
  return {
    group,
    set(run, drop, extend) {
      const L = Math.hypot(run, drop) * Math.max(0, Math.min(1, extend));
      group.visible = extend > 0.01;
      tilt.rotation.z = -Math.atan2(drop, run);
      const n = Math.max(1, Math.round(L / 0.24));
      planks.forEach((p, i) => {
        p.visible = i < n;
        p.position.set(0.12 + (i * (L - 0.12)) / Math.max(1, n - 1), 0, 0);
        if (i >= n) p.position.x = 0;
      });
      for (const b of beams) {
        b.scale.x = Math.max(0.01, L);
        b.position.set(L / 2, -0.04, b.position.z);
      }
      for (const r of ropes) {
        r.scale.x = Math.max(0.01, L);
        r.position.set(L / 2, 0.55, r.position.z);
      }
      for (const p of posts) {
        p.position.x = p.userData['end'] ? Math.max(0.03, L - 0.03) : 0.03;
        p.position.y = 0.28;
        p.rotation.z = Math.atan2(drop, run);
      }
    },
  };
}
