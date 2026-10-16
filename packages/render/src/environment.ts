import type { Element } from '@cloudsea/content';
import { createTerrain } from '@cloudsea/sim';
import * as THREE from 'three';
import { buildIslandMesh } from './island';
import { makeTree } from './props';
import { C, canvasTexture, lerp, mulberry } from './util';

const DAY = { top: 0x5b92cf, hor: 0xf8dcc3, low: 0xfff3e6, fog: 0xf2dccb, sun: 0xffe2b8, hs: 0xdbe8ff, hg: 0x8d9a6c, hi: 0.78, sc: 0xfff0d8, si: 1.05, cl: 0xfff8ef, cs: 0xd6c3c8 };
const NIGHT = { top: 0x0b1430, hor: 0x3b3f6c, low: 0x575d8c, fog: 0x2b3058, sun: 0x8ea6ff, hs: 0x5e6db0, hg: 0x151a2c, hi: 0.32, sc: 0x9cb2ff, si: 0.24, cl: 0x5c6392, cs: 0x272b50 };

const NOISE = `float hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(hh(i),hh(i+vec2(1,0)),u.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),u.x),u.y);}
float fb(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n2(p);p*=2.03;a*=.5;}return s;}`;

export const glowTexture = (): THREE.CanvasTexture =>
  canvasTexture((g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,220,150,1)');
    gr.addColorStop(0.35, 'rgba(255,170,70,.45)');
    gr.addColorStop(1, 'rgba(255,150,50,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });

/**
 * 天空、云海、光照、雾、远岛、云、尘光与天气粒子（从原型迁移）。
 * setNight(0..1) 平滑切换昼夜；setWeather 切换天气表现。
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.Fog;
  private readonly sky: THREE.Mesh;
  private readonly skyU;
  private readonly seaU;
  private readonly sea: THREE.Mesh;
  private readonly sunDir = new THREE.Vector3(-0.55, 0.62, 0.45).normalize();
  private readonly clouds: Array<{ g: THREE.Group; th: number; d: number; sp: number }> = [];
  private readonly farIslands: Array<{ g: THREE.Group; y: number; ph: number }> = [];
  private readonly motes: THREE.Points;
  private readonly moteSeed: number[][] = [];
  private readonly rain: THREE.LineSegments;
  private readonly leaves: THREE.Points;
  private weather: Element | null = null;
  private night = 0;
  private flash = 0;
  private fogDensity = 0;
  /** 发光物（灯、提灯）的材质，夜里亮起。 */
  readonly glowMaterials = new Set<THREE.MeshStandardMaterial>();
  readonly glowSprites = new Set<THREE.Sprite>();

  constructor(readonly scene: THREE.Scene, opts: { farIslands?: boolean } = {}) {
    this.fog = new THREE.Fog(DAY.fog, 38, 190);
    scene.fog = this.fog;
    scene.background = C(DAY.hor);

    this.skyU = {
      uTop: { value: C(DAY.top) },
      uHor: { value: C(DAY.hor) },
      uLow: { value: C(DAY.low) },
      uSun: { value: C(DAY.sun) },
      uSunDir: { value: this.sunDir.clone() },
      uStar: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyU,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform vec3 uTop,uHor,uLow,uSun,uSunDir;uniform float uStar;varying vec3 vD;
 float h3(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
 void main(){vec3 d=normalize(vD);float y=d.y;vec3 c=y>0.?mix(uHor,uTop,smoothstep(0.,.55,y)):mix(uHor,uLow,smoothstep(0.,-.22,y));
 float s=max(dot(d,normalize(uSunDir)),0.);c+=uSun*(pow(s,60.)*.7+pow(s,6.)*.14);
 if(uStar>.01){vec3 g=floor(d*170.);float r=h3(g);c+=vec3(step(.9965,r)*smoothstep(.04,.35,y)*uStar*(.5+.5*h3(g+1.3)));}
 gl_FragColor=vec4(c,1.);
 #include <colorspace_fragment>
 }`,
      }),
    );
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(DAY.hs, DAY.hg, DAY.hi * Math.PI);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(DAY.sc, DAY.si * Math.PI);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 100 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    this.seaU = {
      uTime: { value: 0 },
      uCol: { value: C(DAY.cl) },
      uShade: { value: C(DAY.cs) },
      uFog: { value: C(DAY.fog) },
      uCam: { value: new THREE.Vector3() },
    };
    const seaGeo = new THREE.PlaneGeometry(700, 700, 110, 110);
    seaGeo.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(
      seaGeo,
      new THREE.ShaderMaterial({
        uniforms: this.seaU,
        fog: false,
        vertexShader: `uniform float uTime;varying vec3 vW;varying float vH;void main(){vec4 w=modelMatrix*vec4(position,1.);
 float h=sin(w.x*.06+uTime*.4)*.8+cos(w.z*.05+uTime*.3)*.7+sin((w.x+w.z)*.11+uTime*.7)*.3;w.y+=h;vH=h;vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
        fragmentShader: `uniform vec3 uCol,uShade,uFog,uCam;uniform float uTime;varying vec3 vW;varying float vH;${NOISE}
 void main(){vec2 p=vW.xz*.03;float n=fb(p+vec2(uTime*.012,uTime*.007));float m=fb(p*2.7-vec2(uTime*.02,-uTime*.01));
 float v=smoothstep(.32,.85,n*.75+m*.35+vH*.07);vec3 c=mix(uShade,uCol,v);float d=length(vW.xz-uCam.xz);
 c=mix(c,uFog,smoothstep(30.,230.,d));gl_FragColor=vec4(c,1.);
 #include <colorspace_fragment>
 }`,
      }),
    );
    this.sea.position.y = -11;
    scene.add(this.sea);

    const rnd = mulberry(99);
    if (opts.farIslands !== false) {
      for (let i = 0; i < 7; i++) {
        const R = 3 + rnd() * 4.5;
        const t = createTerrain({ seed: i + 3, radius: R, amplitude: 0.5 });
        const isl = buildIslandMesh(t, { rings: 5, segments: 18, depth: R * 1.3, layers: 4, grass: 0, flowers: 0 });
        const g = new THREE.Group();
        g.add(isl);
        const th = (i / 7) * Math.PI * 2 + rnd() * 0.6;
        const d = 55 + rnd() * 48;
        g.position.set(Math.cos(th) * d, -3 + rnd() * 10, Math.sin(th) * d);
        const nt = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < nt; k++) {
          const a = rnd() * 6;
          const r = rnd() * R * 0.5;
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r;
          const tree = makeTree(0.8 + rnd() * 0.5, rnd() < 0.7 ? 'green' : 'bloom', rnd);
          tree.group.position.set(x, t.height(x, z) - 0.05, z);
          g.add(tree.group);
        }
        scene.add(g);
        this.farIslands.push({ g, y: g.position.y, ph: rnd() * 6 });
      }
    }
    const cm = new THREE.MeshStandardMaterial({ color: 0xfff9f2, flatShading: true, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.12 });
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const n = 4 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const s = 1.2 + rnd() * 1.8;
        const p = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), cm);
        p.position.set(k * 1.6 - n * 0.8 + (rnd() - 0.5), (rnd() - 0.3) * 1.2, (rnd() - 0.5) * 2);
        p.scale.y = 0.7;
        g.add(p);
      }
      const th = rnd() * Math.PI * 2;
      const d = 34 + rnd() * 80;
      g.position.set(Math.cos(th) * d, -7 + rnd() * 16, Math.sin(th) * d);
      g.rotation.y = rnd() * 6;
      scene.add(g);
      this.clouds.push({ g, th, d, sp: (0.004 + rnd() * 0.006) * (rnd() < 0.5 ? -1 : 1) });
    }

    const MN = 150;
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MN * 3), 3));
    for (let i = 0; i < MN; i++) {
      const th = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 18;
      this.moteSeed.push([Math.cos(th) * r, rnd() * 5 + 0.3, Math.sin(th) * r, rnd() * 6]);
    }
    this.motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xfff2d6, size: 0.09, transparent: true, opacity: 0.6, depthWrite: false }));
    this.motes.frustumCulled = false;
    scene.add(this.motes);

    // 雨：一组下落的短线
    const RN = 900;
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RN * 6), 3));
    this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbcd6f0, transparent: true, opacity: 0.55 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    // 风：飘叶
    const LN = 80;
    const leafGeo = new THREE.BufferGeometry();
    leafGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LN * 3), 3));
    this.leaves = new THREE.Points(leafGeo, new THREE.PointsMaterial({ color: 0x8fd1a8, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false }));
    this.leaves.frustumCulled = false;
    this.leaves.visible = false;
    scene.add(this.leaves);
  }

  setNight(n: number): void {
    this.night = n;
  }

  /** 天气表现；fogLevel 是岛的雾浓度（0–5），叠加在雾天之上。 */
  setWeather(w: Element | null, fogLevel = 0): void {
    this.weather = w;
    this.fogDensity = Math.min(1, (w === 'mist' ? 0.55 : 0) + fogLevel * 0.15);
    this.rain.visible = w === 'rain' || w === 'thunder';
    this.leaves.visible = w === 'wind';
  }

  update(dt: number, t: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    const n = this.night;
    const mix = (out: THREE.Color, a: number, b: number) => out.set(a).lerp(C(b), n);
    mix(this.skyU.uTop.value, DAY.top, NIGHT.top);
    mix(this.skyU.uHor.value, DAY.hor, NIGHT.hor);
    mix(this.skyU.uLow.value, DAY.low, NIGHT.low);
    mix(this.skyU.uSun.value, DAY.sun, NIGHT.sun);
    this.skyU.uStar.value = n;
    const overcast = this.weather === 'rain' || this.weather === 'thunder' ? 0.35 : this.weather === 'mist' ? 0.25 : 0;
    const grey = C(0x9aa3b5);
    this.skyU.uTop.value.lerp(grey, overcast * (1 - n));
    mix(this.fog.color, DAY.fog, NIGHT.fog);
    this.fog.color.lerp(C(0xd8dbe3), this.fogDensity * (1 - n) * 0.8);
    this.fog.near = lerp(38, 8, this.fogDensity);
    this.fog.far = lerp(190, 55, this.fogDensity);
    (this.scene.background as THREE.Color).copy(this.fog.color);
    mix(this.seaU.uFog.value, DAY.fog, NIGHT.fog);
    mix(this.seaU.uCol.value, DAY.cl, NIGHT.cl);
    mix(this.seaU.uShade.value, DAY.cs, NIGHT.cs);
    mix(this.hemi.color, DAY.hs, NIGHT.hs);
    mix(this.hemi.groundColor, DAY.hg, NIGHT.hg);
    // 雷天闪电
    if (this.weather === 'thunder' && Math.random() < dt * 0.15) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.hemi.intensity = (lerp(DAY.hi, NIGHT.hi, n) * (1 - overcast * 0.3) + this.flash * 1.5) * Math.PI;
    mix(this.sun.color, DAY.sc, NIGHT.sc);
    this.sun.intensity = lerp(DAY.si, NIGHT.si, n) * (1 - overcast * 0.6) * Math.PI;
    for (const m of this.glowMaterials) m.emissiveIntensity = 0.3 + n * 2.2;
    for (const s of this.glowSprites) (s.material as THREE.SpriteMaterial).opacity = n * 0.85;

    this.sky.position.copy(camera.position);
    this.seaU.uTime.value = t;
    this.seaU.uCam.value.copy(camera.position);
    this.sun.position.set(focus.x + this.sunDir.x * 40, this.sunDir.y * 40, focus.z + this.sunDir.z * 40);
    this.sun.target.position.set(focus.x, 0, focus.z);

    const mm = this.motes.material as THREE.PointsMaterial;
    mm.color.setHSL(lerp(0.11, 0.12, n), lerp(0.6, 1, n), lerp(0.92, 0.65, n));
    mm.opacity = 0.5 + n * 0.45;
    mm.size = 0.08 + n * 0.05;
    const mp = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.moteSeed.forEach((s, i) => {
      mp.setXYZ(i, focus.x + s[0]! + Math.sin(t * 0.3 + s[3]!) * 0.8, s[1]! + Math.sin(t * 0.7 + s[3]! * 2) * 0.35, focus.z + s[2]! + Math.cos(t * 0.25 + s[3]!) * 0.8);
    });
    mp.needsUpdate = true;

    if (this.rain.visible) {
      const rp = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < rp.count / 2; i++) {
        const sx = ((i * 7919) % 400) / 10 - 20;
        const sz = ((i * 104729) % 400) / 10 - 20;
        const y = 14 - ((t * 18 + (i % 97) * 0.37) % 16);
        rp.setXYZ(i * 2, focus.x + sx, y, focus.z + sz);
        rp.setXYZ(i * 2 + 1, focus.x + sx + 0.05, y - 0.45, focus.z + sz);
      }
      rp.needsUpdate = true;
    }
    if (this.leaves.visible) {
      const lp = this.leaves.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < lp.count; i++) {
        const span = 40;
        const x = (((t * 4 + i * 3.7) % span) + span) % span - span / 2;
        lp.setXYZ(i, focus.x + x, 0.5 + ((i * 13) % 50) / 10 + Math.sin(t * 2 + i) * 0.4, focus.z + (((i * 7.3) % span) - span / 2));
      }
      lp.needsUpdate = true;
    }
    for (const f of this.farIslands) f.g.position.y = f.y + Math.sin(t * 0.3 + f.ph) * 0.6;
    for (const c of this.clouds) {
      c.th += c.sp * dt;
      c.g.position.x = focus.x * 0.3 + Math.cos(c.th) * c.d;
      c.g.position.z = focus.z * 0.3 + Math.sin(c.th) * c.d;
    }
  }
}

/** 从游戏内时刻算夜晚系数（黄昏 / 黎明各有一段渐变）。tickOfDay：06:00 起算。 */
export function nightFactor(tickOfDay: number, dayTicks = 7800, ticksPerDay = 12000, fade = 500): number {
  const t = tickOfDay;
  if (t < fade) return 1 - t / fade; // 黎明
  if (t < dayTicks - fade) return 0;
  if (t < dayTicks + fade) return (t - (dayTicks - fade)) / (2 * fade); // 黄昏
  if (t > ticksPerDay - fade) return 1;
  return 1;
}
