import * as THREE from 'three';
import { canvasTexture } from './util';

const tex = {
  heart: () =>
    canvasTexture((g, s) => {
      g.fillStyle = '#ff7d92';
      g.beginPath();
      const k = s / 64;
      g.moveTo(32 * k, 54 * k);
      g.bezierCurveTo(6 * k, 36 * k, 6 * k, 14 * k, 20 * k, 12 * k);
      g.bezierCurveTo(27 * k, 11 * k, 31 * k, 16 * k, 32 * k, 20 * k);
      g.bezierCurveTo(33 * k, 16 * k, 37 * k, 11 * k, 44 * k, 12 * k);
      g.bezierCurveTo(58 * k, 14 * k, 58 * k, 36 * k, 32 * k, 54 * k);
      g.fill();
    }),
  puff: () =>
    canvasTexture((g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,.95)');
      gr.addColorStop(0.6, 'rgba(255,255,255,.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    }),
  spark: () =>
    canvasTexture((g, s) => {
      g.translate(s / 2, s / 2);
      g.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) {
        g.rotate(Math.PI / 4);
        g.beginPath();
        g.moveTo(0, -s / 2);
        g.lineTo(s / 10, 0);
        g.lineTo(0, s / 2);
        g.lineTo(-s / 10, 0);
        g.fill();
      }
    }),
};

export type FxKind = keyof typeof tex;

interface Particle {
  sp: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
}

/** 简单的 sprite 粒子（心形、烟、闪光）。 */
export class Fx {
  private readonly textures: Record<FxKind, THREE.Texture>;
  private readonly parts: Particle[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.textures = { heart: tex.heart(), puff: tex.puff(), spark: tex.spark() };
  }

  spawn(kind: FxKind, pos: THREE.Vector3, n: number, o: { size: number; vy: number; life: number; spread: number; color?: THREE.ColorRepresentation }): void {
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textures[kind], transparent: true, depthWrite: false, color: o.color ?? 0xffffff }));
      sp.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3));
      sp.scale.setScalar(o.size * (0.7 + Math.random() * 0.6));
      this.scene.add(sp);
      this.parts.push({
        sp,
        vy: o.vy * (0.6 + Math.random() * 0.7),
        vx: (Math.random() - 0.5) * o.spread,
        vz: (Math.random() - 0.5) * o.spread,
        life: o.life * (0.7 + Math.random() * 0.5),
        max: o.life,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const f = this.parts[i]!;
      f.life -= dt;
      f.sp.position.x += f.vx * dt;
      f.sp.position.y += f.vy * dt;
      f.sp.position.z += f.vz * dt;
      f.vx *= 0.97;
      f.vz *= 0.97;
      f.sp.material.opacity = Math.max(0, Math.min(1, f.life / f.max));
      if (f.life <= 0) {
        this.scene.remove(f.sp);
        f.sp.material.dispose();
        this.parts.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const f of this.parts) {
      this.scene.remove(f.sp);
      f.sp.material.dispose();
    }
    this.parts.length = 0;
  }
}
