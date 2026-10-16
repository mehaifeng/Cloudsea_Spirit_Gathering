import type { GatherKind } from '@cloudsea/content';
import * as THREE from 'three';
import { jitterGeo, mat, mulberry } from './util';

const TREE_COLS = {
  green: [0x6fae55, 0x82bf62, 0x5f9c4c],
  bloom: [0xf2a9ba, 0xf7c1cc, 0xe991a6],
  amber: [0xe9a957, 0xf0bf6a, 0xd98f45],
} as const;

export interface PropView {
  readonly group: THREE.Group;
  /** 可采集 / 已采完（采完时缩小、变暗）。 */
  setAvailable(available: boolean): void;
  update(t: number): void;
}

export function makeTree(s: number, kind: keyof typeof TREE_COLS, rnd: () => number): { group: THREE.Group; foliage: THREE.Group } {
  const g = new THREE.Group();
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * s, 0.2 * s, 1.4 * s, 5), mat(0x8a5f40));
  tr.position.y = 0.7 * s;
  tr.castShadow = true;
  g.add(tr);
  const fol = new THREE.Group();
  fol.position.y = 1.35 * s;
  g.add(fol);
  const cols = TREE_COLS[kind];
  const n = 2 + Math.floor(rnd() * 2);
  for (let k = 0; k < n; k++) {
    const r = (0.82 - k * 0.17) * s;
    const m = new THREE.Mesh(jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.35, rnd), mat(cols[k % 3]!));
    m.position.set((rnd() - 0.5) * 0.35 * s, k * 0.55 * s, (rnd() - 0.5) * 0.35 * s);
    m.rotation.y = rnd() * 6;
    m.castShadow = true;
    fol.add(m);
  }
  return { group: g, foliage: fol };
}

export function makeRock(s: number, rnd: () => number, color?: number): THREE.Mesh {
  const m = new THREE.Mesh(jitterGeo(new THREE.DodecahedronGeometry(0.5 * s, 0), 0.25 * s, rnd), mat(color ?? (rnd() < 0.5 ? 0xa49a90 : 0x8f857c)));
  m.position.y = 0.1 * s;
  m.rotation.set(rnd(), rnd() * 6, rnd() * 0.4);
  m.scale.y = 0.7;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 采集点外观：树 / 石头 / 雷铜矿 / 雾晶 / 浆果丛。 */
export function makeGatherProp(kind: GatherKind, seed: number): PropView {
  const rnd = mulberry(seed);
  const group = new THREE.Group();
  const extras: THREE.Object3D[] = [];
  let foliage: THREE.Group | null = null;
  const ph = rnd() * 6;
  switch (kind) {
    case 'tree': {
      const k = rnd();
      const t = makeTree(0.75 + rnd() * 0.45, k < 0.6 ? 'green' : k < 0.85 ? 'bloom' : 'amber', rnd);
      group.add(t.group);
      foliage = t.foliage;
      extras.push(t.foliage);
      break;
    }
    case 'rock':
      group.add(makeRock(0.9 + rnd() * 0.6, rnd));
      extras.push(group.children[0]!);
      break;
    case 'ore': {
      group.add(makeRock(1 + rnd() * 0.4, rnd, 0x7e7488));
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.12 + rnd() * 0.08, 0), mat(0xc58a4a, { emissive: 0xa77be8, emissiveIntensity: 0.25 }));
        c.position.set((rnd() - 0.5) * 0.6, 0.25 + rnd() * 0.2, (rnd() - 0.5) * 0.6);
        c.rotation.set(rnd(), rnd(), rnd());
        group.add(c);
        extras.push(c);
      }
      break;
    }
    case 'crystal': {
      for (let i = 0; i < 5; i++) {
        const h = 0.4 + rnd() * 0.7;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.12 + rnd() * 0.08, h, 5), mat(0xcfd6f2, { emissive: 0x8fa0e0, emissiveIntensity: 0.35, roughness: 0.4 }));
        c.position.set((rnd() - 0.5) * 0.7, h / 2, (rnd() - 0.5) * 0.7);
        c.rotation.set((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6);
        c.castShadow = true;
        group.add(c);
        extras.push(c);
      }
      break;
    }
    case 'bush': {
      const b = new THREE.Mesh(jitterGeo(new THREE.IcosahedronGeometry(0.55, 0), 0.2, rnd), mat(0x5f9c4c));
      b.position.y = 0.4;
      b.scale.y = 0.75;
      b.castShadow = true;
      group.add(b);
      for (let i = 0; i < 7; i++) {
        const berry = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), mat(rnd() < 0.5 ? 0x5aa9e6 : 0xd85a8a));
        const a = rnd() * Math.PI * 2;
        berry.position.set(Math.cos(a) * 0.48, 0.3 + rnd() * 0.3, Math.sin(a) * 0.48);
        group.add(berry);
        extras.push(berry);
      }
      break;
    }
  }
  return {
    group,
    setAvailable(available) {
      for (const e of extras) e.visible = kind === 'tree' || kind === 'rock' ? true : available;
      const s = available ? 1 : kind === 'tree' ? 0.6 : 0.75;
      if (kind === 'tree' && foliage) foliage.scale.setScalar(s);
      if (kind === 'rock') group.children[0]!.scale.set(s, 0.7 * s, s);
    },
    update(t) {
      if (foliage) foliage.rotation.z = Math.sin(t * 1.2 + ph) * 0.035;
    },
  };
}
