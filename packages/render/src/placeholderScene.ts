import * as THREE from 'three';
import { ELEMENT_INFO, ELEMENTS } from '@cloudsea/content';
import { createRng } from '@cloudsea/sim';

/**
 * 脚手架阶段的占位场景：一座低多边形浮岛悬在云海上，周围漂着五色属性晶石。
 * 只用来验证 Electron + Vite + Three.js 的整条链路；正式的岛屿生成在 M1 第 5 步从原型迁移。
 */
export interface PlaceholderScene {
  dispose(): void;
}

export function mountPlaceholderScene(canvas: HTMLCanvasElement, seed = 1): PlaceholderScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6d7b8');
  scene.fog = new THREE.Fog('#f6d7b8', 30, 90);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 9, 26);
  camera.lookAt(0, 1, 0);

  scene.add(new THREE.HemisphereLight('#fff4e0', '#8a7bb0', 1.4));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  sun.position.set(8, 14, 6);
  scene.add(sun);

  const rng = createRng(seed);
  const island = buildIsland(rng);
  scene.add(island);

  const sea = new THREE.Mesh(
    new THREE.CircleGeometry(80, 48),
    new THREE.MeshStandardMaterial({ color: '#fff6ec', flatShading: true }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -6;
  scene.add(sea);

  const crystals = ELEMENTS.map((el, i) => {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.6, 0),
      new THREE.MeshStandardMaterial({ color: ELEMENT_INFO[el].color, flatShading: true }),
    );
    const angle = (i / ELEMENTS.length) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * 9, 2.5, Math.sin(angle) * 9);
    scene.add(mesh);
    return { mesh, angle };
  });

  const resize = (): void => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const t = timer.getElapsed();
    island.rotation.y = t * 0.08;
    island.position.y = Math.sin(t * 0.6) * 0.25;
    for (const c of crystals) {
      const a = c.angle + t * 0.25;
      c.mesh.position.set(Math.cos(a) * 9, 2.5 + Math.sin(t * 1.3 + c.angle) * 0.4, Math.sin(a) * 9);
      c.mesh.rotation.y = t;
    }
    renderer.render(scene, camera);
  });

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
    },
  };
}

/** 顶面草地、侧面岩层、底部倒锥的低多边形浮岛，按面上顶点色。 */
function buildIsland(rng: ReturnType<typeof createRng>): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(6, 1.2, 7, 9, 3).toNonIndexed();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;

  // 按顶点坐标抖动（同一坐标同一偏移，保证面不撕裂）
  const offsets = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    // 用取整后的整数做键：toFixed 会把接缝处的 -1e-16 写成 "-0.000"，与 "0.000" 不同而裂开
    const key = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.round(v * 1000) + 0).join(',');
    let o = offsets.get(key);
    if (o === undefined) {
      o = (rng.next() - 0.5) * 0.7;
      offsets.set(key, o);
    }
    pos.setY(i, pos.getY(i) + o);
  }

  const grass = new THREE.Color('#8fc66e');
  const rockTop = new THREE.Color('#b99a7a');
  const rockBottom = new THREE.Color('#7a6a8c');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    if (y > 3.2) c.copy(grass);
    else c.copy(rockTop).lerp(rockBottom, THREE.MathUtils.clamp((3.2 - y) / 7, 0, 1));
    for (let k = 0; k < 3; k++) c.toArray(colors, (f + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }));
}
