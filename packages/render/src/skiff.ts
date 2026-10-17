import * as THREE from 'three';
import { lanternMaterial } from './character';
import { mat } from './util';

/**
 * 云舟（DESIGN 3.6，v0.5）：以云气为动力的小型浮空艇，约 4.6 米长。
 * 木船身 + 两侧推进舱（螺旋桨 + 云气光环）+ 中桅上的云气核心 + 船头提灯。
 * 按尺度规范：甲板离地约 0.6 米，栏杆齐腰（约 0.9 米），人站在甲板上露出上半身。
 */
export interface SkiffView {
  readonly group: THREE.Group;
  /** 甲板上的位置（船体局部坐标）：0 号给玩家，其余给絮灵。 */
  readonly seats: readonly THREE.Vector3[];
  readonly glows: THREE.MeshStandardMaterial[];
  /** speed：0 = 停泊，1 = 全速。 */
  update(t: number, speed: number): void;
}

export function makeSkiff(opts: { wrecked?: boolean } = {}): SkiffView {
  const group = new THREE.Group();
  const hull = new THREE.Group();
  group.add(hull);
  const glows: THREE.MeshStandardMaterial[] = [];
  const wood = 0x9a6a43;
  const woodDark = 0x6b4a35;
  const brass = 0xc9a35a;

  // 船身：船底是一个被压扁、两头收窄的八棱柱
  const keel = new THREE.CylinderGeometry(0.85, 0.55, 4.4, 8, 3);
  const pos = keel.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i); // 沿船长方向（之后转到 z）
    const taper = 1 - Math.pow(Math.abs(y) / 2.2, 2.2) * 0.75;
    pos.setX(i, pos.getX(i) * taper);
    pos.setZ(i, pos.getZ(i) * taper * 0.75);
  }
  keel.computeVertexNormals();
  keel.rotateX(Math.PI / 2);
  const keelMesh = new THREE.Mesh(keel, mat(wood));
  keelMesh.position.y = 0.25;
  keelMesh.castShadow = true;
  hull.add(keelMesh);
  // 甲板
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 3.8), mat(0xc9a27a));
  deck.position.y = 0.62;
  deck.receiveShadow = true;
  hull.add(deck);
  for (let i = -3; i <= 3; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.04), mat(woodDark));
    plank.position.set(0, 0.68, i * 0.5);
    hull.add(plank);
  }
  // 栏杆（齐腰 0.9 米）
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 3.4), mat(woodDark));
    rail.position.set(sx * 0.72, 1.5, 0);
    hull.add(rail);
    for (let i = -3; i <= 3; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.05), mat(woodDark));
      post.position.set(sx * 0.72, 1.08, i * 0.55);
      hull.add(post);
    }
  }
  // 船头翘起与船尾尾鳍
  const prow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 5), mat(woodDark));
  prow.rotation.x = Math.PI / 2 - 0.5;
  prow.position.set(0, 0.95, 2.25);
  hull.add(prow);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.8), mat(0xe07a5f));
  fin.position.set(0, 1.2, -2.05);
  hull.add(fin);

  // 中桅 + 云气核心（黄铜笼子里的发光晶体）
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.9, 6), mat(woodDark));
  mast.position.set(0, 1.6, -0.6);
  hull.add(mast);
  const coreMat = new THREE.MeshStandardMaterial({ color: 0xdff4ff, emissive: 0x8fd1f0, emissiveIntensity: 0.9, flatShading: true });
  glows.push(coreMat);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), coreMat);
  core.position.set(0, 2.55, -0.6);
  hull.add(core);
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 0.03), mat(brass));
    const a = (i / 4) * Math.PI * 2;
    bar.position.set(Math.cos(a) * 0.3, 2.55, -0.6 + Math.sin(a) * 0.3);
    hull.add(bar);
  }
  // 船头提灯
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.22), lanternMaterial);
  lamp.position.set(0, 1.55, 2.0);
  hull.add(lamp);
  glows.push(lanternMaterial);

  // 两侧推进舱：舱体 + 四叶螺旋桨 + 云气光环
  const props: THREE.Group[] = [];
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x8fd1f0, emissiveIntensity: 0.6, transparent: true, opacity: 0.75, flatShading: true });
  glows.push(ringMat);
  const rings: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const pod = new THREE.Group();
    pod.position.set(sx * 1.25, 0.75, -0.9);
    hull.add(pod);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.16), mat(brass));
    strut.position.x = -sx * 0.3;
    pod.add(strut);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.9, 8), mat(0x3f8a86));
    body.rotation.x = Math.PI / 2;
    pod.add(body);
    const prop = new THREE.Group();
    prop.position.z = -0.52;
    pod.add(prop);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.02), mat(wood));
      blade.position.y = 0.21;
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2;
      arm.add(blade);
      prop.add(arm);
    }
    props.push(prop);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 5, 16), ringMat);
    ring.position.z = -0.5;
    pod.add(ring);
    rings.push(ring);
  }

  const seats = [new THREE.Vector3(0, 0.67, 0.6), new THREE.Vector3(-0.4, 0.67, -1.4), new THREE.Vector3(0.4, 0.67, -1.4), new THREE.Vector3(0, 0.67, 1.5)];

  if (opts.wrecked) {
    // 失事的云舟：侧倾、桅杆折断、核心熄灭
    hull.rotation.z = 0.35;
    hull.rotation.x = -0.12;
    mast.scale.y = 0.45;
    mast.position.y = 1.1;
    core.visible = false;
    coreMat.emissiveIntensity = 0;
    ringMat.opacity = 0.2;
  }

  return {
    group,
    seats,
    glows,
    update(t, speed) {
      if (opts.wrecked) return;
      for (const p of props) p.rotation.z = t * (4 + speed * 30);
      for (const r of rings) r.scale.setScalar(1 + Math.sin(t * 6) * 0.06 * (0.3 + speed));
      core.rotation.y = t * 1.2;
      hull.position.y = Math.sin(t * 1.4) * 0.08;
      hull.rotation.z = Math.sin(t * 0.9) * 0.03;
      hull.rotation.x = -speed * 0.06;
    },
  };
}
