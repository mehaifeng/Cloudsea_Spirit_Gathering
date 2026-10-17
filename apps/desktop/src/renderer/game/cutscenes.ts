import type { Island, Keeper } from '@cloudsea/content';
import { lerp } from '@cloudsea/render';
import { HOME_DOCK } from '@cloudsea/sim';
import * as THREE from 'three';
import { pose, v3, type Shot } from './cinematic';
import { ExploreView } from './explore';

/**
 * 一次性播片的镜头脚本（DESIGN 13、14.3，v0.5）。
 * 每个函数返回一串镜头；最后一个镜头都回到玩家身后的探索机位，切回操作时没有跳变。
 */

/**
 * 开场（v0.6 迫降版）：失去动力的云舟载着玩家斜着滑向小岛 → 触地、在草地上犁出一道土痕、
 * 玩家在甲板上随船身摇晃 → 停住，缓两秒 → 玩家跳下云舟 → 镜头转向岛上发光的云气团 → 回到玩家身后。
 * 云舟的位置与姿态是播片时间 T 的函数；跳过时直接摆到终态。
 */
export function openingShots(view: ExploreView): Shot[] {
  const skiff = view.skiffView;
  if (!skiff) return [];
  const W = ExploreView.WRECK;
  const g = view.ground;
  const f = v3(Math.sin(W.yaw), 0, Math.cos(W.yaw));
  // 侧拍放在离码头远的一侧，免得码头的灯柱、订单板挡在镜头前
  const side0 = v3(f.z, 0, -f.x);
  const dock = v3(HOME_DOCK.x, 0, HOME_DOCK.z + 0.5);
  const sd = v3(W.x, 0, W.z).addScaledVector(side0, 7).distanceTo(dock) > v3(W.x, 0, W.z).addScaledVector(side0, -7).distanceTo(dock) ? side0 : side0.clone().negate();
  const lift = -0.18;
  const L = ExploreView.SLIDE;
  const rest = v3(W.x, g(W.x, W.z) + lift, W.z);
  const td = rest.clone().addScaledVector(f, -L);
  td.y = g(td.x, td.z) + lift;
  const AIR = 6.5;
  const SLIDE_T = 2.9;
  const HOLD = 2;
  const T_STOP = AIR + SLIDE_T;
  const air0 = td.clone().addScaledVector(f, -40).add(v3(0, 26, 0));
  const seat = skiff.seats[0]!;
  let T = 0;
  let impacted = false;
  let finished = false;

  /** 云舟在时间 T 的位置与姿态（yaw / 船头俯仰 / 横滚）。 */
  const poseAt = (time: number): { pos: THREE.Vector3; yaw: number; pitch: number; roll: number; slide: number } => {
    if (time < AIR) {
      const s = time / AIR;
      const pos = new THREE.Vector3().lerpVectors(air0, td, s);
      pos.y = td.y + 26 * Math.pow(1 - s, 1.6);
      const wob = 1 - s * 0.6;
      return { pos, yaw: W.yaw + Math.sin(time * 1.3) * 0.12 * (1 - s), pitch: 0.22 * (1 - s) - (s > 0.85 ? (s - 0.85) * 0.6 : 0), roll: Math.sin(time * 2.1) * 0.22 * wob, slide: 0 };
    }
    if (time < T_STOP) {
      const u = (time - AIR) / SLIDE_T;
      const d = L * (1 - (1 - u) * (1 - u));
      const pos = td.clone().addScaledVector(f, d);
      pos.y = g(pos.x, pos.z) + lift + 0.22 * Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u);
      return { pos, yaw: W.yaw + Math.sin(time * 7) * 0.04 * (1 - u), pitch: lerp(0.05, -0.05, u) + Math.sin(time * 19) * 0.03 * (1 - u), roll: lerp(0.18, 0.1, u) + Math.sin(time * 23) * 0.06 * (1 - u), slide: d / L };
    }
    return { pos: rest.clone(), yaw: W.yaw, pitch: -0.05, roll: 0.1, slide: 1 };
  };
  const apply = (time: number, dt: number) => {
    const p = poseAt(time);
    skiff.group.position.copy(p.pos);
    skiff.group.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    view.setTrenchProgress(p.slide);
    const P = view.player;
    if (time < AIR) {
      skiff.setCore(Math.random() < 0.15 ? 0.6 : 0.15);
      P.stagger = Math.max(P.stagger, 0.35);
      if (Math.random() < dt * 16) view.fx.spawn('puff', p.pos.clone().add(v3(0, 1.4, 0)), 1, { size: 1.3, vy: 0.5, life: 1.8, spread: 0.6, color: 0x8a8290 });
    } else if (time < T_STOP) {
      if (!impacted) {
        impacted = true;
        skiff.setCore(0);
        // 触地这一刻船底才撞坏：换成破损的船底，木屑飞溅（v0.7）
        skiff.setDamaged(true);
        view.fx.spawn('spark', p.pos.clone().add(v3(0, 0.3, 0)), 16, { size: 0.3, vy: 2.4, life: 1.1, spread: 3.2, color: 0x9a6a43 });
        view.fx.spawn('puff', p.pos.clone().add(v3(0, 0.4, 0)), 14, { size: 1.3, vy: 1.2, life: 1.4, spread: 3, color: 0xa08468 });
      }
      P.stagger = 1;
      const bow = p.pos.clone().addScaledVector(f, 2.2);
      if (Math.random() < dt * 30) view.fx.spawn('puff', v3(bow.x, g(bow.x, bow.z) + 0.2, bow.z), 1, { size: 0.7, vy: 1.6, life: 0.9, spread: 1.4, color: 0x7a5236 });
      if (Math.random() < dt * 12) view.fx.spawn('spark', v3(bow.x, g(bow.x, bow.z) + 0.3, bow.z), 2, { size: 0.25, vy: 1.4, life: 0.5, spread: 1.6, color: 0x8fc66e });
    }
  };
  const shake = (time: number): THREE.Vector3 => {
    if (time < AIR - 0.05 || time > T_STOP + 0.4) return v3(0, 0, 0);
    const a = time < T_STOP ? 0.25 * (1 - (time - AIR) / SLIDE_T) + 0.05 : 0.04;
    return v3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
  };
  const deckPlayer = () => v3(view.player.x, view.player.feetY + 1.3, view.player.z);
  /** 跟着 T 走的机位：远景 → 尾随 → 滑行侧拍 → 推近甲板上的玩家。 */
  const camAt = (): { pos: THREE.Vector3; look: THREE.Vector3 } => {
    const p = poseAt(T).pos;
    const wide = pose(td.clone().addScaledVector(sd, 16).addScaledVector(f, -4).add(v3(0, 5, 0)), p.clone().add(v3(0, 0.8, 0)));
    const chase = pose(p.clone().addScaledVector(f, -9).addScaledVector(sd, 3).add(v3(0, 3.6, 0)), p.clone().addScaledVector(f, 6).add(v3(0, 0.6, 0)));
    const side = pose(rest.clone().addScaledVector(sd, 7.5).addScaledVector(f, 2.5).add(v3(0, 2.2, 0)), p.clone().add(v3(0, 1, 0)));
    const close = pose(rest.clone().addScaledVector(sd, 4.2).addScaledVector(f, 2.6).add(v3(0, 2.1, 0)), deckPlayer());
    const mix = (a: { pos: THREE.Vector3; look: THREE.Vector3 }, b: { pos: THREE.Vector3; look: THREE.Vector3 }, k: number) => {
      const e = k * k * (3 - 2 * k);
      return pose(a.pos.clone().lerp(b.pos, e), a.look.clone().lerp(b.look, e));
    };
    let c: { pos: THREE.Vector3; look: THREE.Vector3 };
    if (T < 3.2) c = wide;
    else if (T < 4.4) c = mix(wide, chase, (T - 3.2) / 1.2);
    else if (T < AIR - 0.2) c = chase;
    else if (T < AIR + 0.3) c = mix(chase, side, (T - AIR + 0.2) / 0.5);
    else if (T < T_STOP) c = side;
    else c = mix(side, close, Math.min(1, (T - T_STOP) / 1.6));
    c.pos.add(shake(T));
    return c;
  };
  const clock = (start: number, dur: number) => (k: number, dt: number) => {
    T = start + k * dur;
    if (!finished) apply(T, dt);
  };
  const outPoint = () => {
    // 从朝向云气团的那一舷跳下去（两舷都有登船口，v0.7）
    const O = ExploreView.ORB;
    const pts = ([-1, 1] as const).map((side) => view.boardingPoints(side)).sort((p, q) => Math.hypot(p.approach.x - O.x, p.approach.z - O.z) - Math.hypot(q.approach.x - O.x, q.approach.z - O.z))[0]!;
    return { pts, land: pts.approach };
  };
  /** 终态：云舟停在残骸位置、土痕完整、玩家站在船边的地上、镜头朝向云气团。 */
  const finalize = () => {
    if (finished) return;
    finished = true;
    apply(T_STOP + 1, 0);
    skiff.setCore(0);
    skiff.setDamaged(true);
    view.unride();
    const { land } = outPoint();
    const O = ExploreView.ORB;
    view.cancelWalk();
    view.player.setPosition(land.x, land.z, Math.atan2(O.x - land.x, O.z - land.z));
    view.player.stagger = 0;
    view.camYaw = Math.atan2(land.x - O.x, land.z - O.z);
    view.camPitch = 0.32;
    view.camDist = 8;
  };
  const orb = () => view.orbPos();
  const orbCam = () => {
    const P = view.player;
    const o = orb();
    const dx = o.x - P.x;
    const dz = o.z - P.z;
    const len = Math.hypot(dx, dz) || 1;
    // 越过玩家肩膀看向云气团；偏到离残骸远的一侧，免得镜头钻进船里
    const a = v3(P.x - (dx / len) * 4.2 + (-dz / len) * 2.0, P.feetY + 2.9, P.z - (dz / len) * 4.2 + (dx / len) * 2.0);
    const b = v3(P.x - (dx / len) * 4.2 - (-dz / len) * 2.0, P.feetY + 2.9, P.z - (dz / len) * 4.2 - (dx / len) * 2.0);
    const far = Math.hypot(a.x - W.x, a.z - W.z) > Math.hypot(b.x - W.x, b.z - W.z) ? a : b;
    return pose(far, o);
  };
  return [
    {
      duration: 3.6,
      ease: 'linear',
      subtitle: '风暴过后，一艘云舟失去了动力。',
      onStart: () => {
        view.ride(skiff.group, v3(seat.x, seat.y, seat.z));
        view.setTrenchProgress(0);
        skiff.setDamaged(false);
        apply(0, 0);
      },
      from: camAt,
      to: camAt,
      onUpdate: clock(0, 3.6),
    },
    { duration: AIR - 3.6, ease: 'linear', subtitle: '它歪歪斜斜地朝下方的小岛滑去——', from: camAt, to: camAt, onUpdate: clock(3.6, AIR - 3.6) },
    { duration: SLIDE_T, ease: 'linear', from: camAt, to: camAt, onUpdate: clock(AIR, SLIDE_T) },
    { duration: HOLD, ease: 'linear', from: camAt, to: camAt, onUpdate: clock(T_STOP, HOLD) },
    {
      duration: 2.4,
      ease: 'linear',
      onStart: () => {
        if (finished) return;
        // 跳下云舟：走到登船口 → 往外一跳 → 落到草地上
        view.unride();
        const { pts, land } = outPoint();
        void view.walkTo(pts.inside.x, pts.inside.z, { timeout: 1.2 }).then(() => (finished ? undefined : view.walkTo(land.x, land.z, { jumpAt: 2.2, jumpStrength: 4, timeout: 1.6 })));
      },
      from: camAt,
      to: () => pose(camAt().pos, deckPlayer()),
      onUpdate: clock(T_STOP + HOLD, 2.4),
    },
    {
      duration: 3.8,
      ease: 'inOut',
      subtitle: '岛上很安静。不远处，一团温暖的云气在发光。',
      onStart: finalize,
      from: () => pose(camAt().pos, deckPlayer()),
      to: orbCam,
    },
    { duration: 2.2, ease: 'inOut', from: orbCam, to: () => view.followPose() },
  ];
}

/**
 * 第一场战斗前的袭击（v0.6，原“首次遭遇”运镜移到这里）：蚀化絮灵从远处冲过来，
 * 镜头先越过玩家肩膀看它跑来，再推到它的侧脸；播完接战斗转场。
 */
export function ambushShots(view: ExploreView, actorId: string): Shot[] {
  const target = () => {
    const c = view.actor(actorId);
    return c ? c.headPos().sub(view.root.position) : v3(view.player.x, view.player.feetY + 0.6, view.player.z);
  };
  const shoulder = () => {
    const P = view.player;
    const t = target();
    const dx = t.x - P.x;
    const dz = t.z - P.z;
    const len = Math.hypot(dx, dz) || 1;
    return v3(P.x - (dx / len) * 2.4 + (-dz / len) * 1.2, P.feetY + 2.0, P.z - (dz / len) * 2.4 + (dx / len) * 1.2);
  };
  const side = () => {
    const t = target();
    const P = view.player;
    const dx = t.x - P.x;
    const dz = t.z - P.z;
    const len = Math.hypot(dx, dz) || 1;
    // 站在玩家与絮灵连线的侧面，看它的侧脸
    return v3(t.x - (dx / len) * 1.4 + (-dz / len) * 2.2, t.y + 0.45, t.z - (dz / len) * 1.4 + (dx / len) * 2.2);
  };
  return [
    { duration: 1.3, ease: 'inOut', subtitle: '不远处，一团混沌的迷雾翻滚着聚拢——', from: () => view.followPose(), to: () => pose(shoulder(), target()) },
    { duration: 1.5, ease: 'linear', from: () => pose(shoulder(), target()), to: () => pose(shoulder(), target()) },
    {
      duration: 1.6,
      ease: 'inOut',
      subtitle: '一只被蚀雾侵蚀的絮灵冲了过来！',
      onStart: () => view.actor(actorId)?.hop(3.5),
      from: () => pose(shoulder(), target()),
      to: () => pose(side(), target()),
    },
  ];
}

/** 首次登岛：绕岛一圈的定场镜头 + 标题卡，最后落回玩家身后。 */
export function arrivalShots(view: ExploreView, island: Island): Shot[] {
  const R = island.radius;
  const center = v3(0, view.ground(0, 0), 0);
  const orbit = (a: number) => pose(v3(Math.cos(a) * R * 1.25, R * 0.55, Math.sin(a) * R * 1.25), center);
  const a0 = Math.PI * 0.35;
  return [
    { duration: 3.6, ease: 'linear', title: { main: island.name, sub: island.description }, from: () => orbit(a0), to: () => orbit(a0 + 0.9) },
    { duration: 1.8, ease: 'inOut', from: () => orbit(a0 + 0.9), to: () => view.followPose() },
  ];
}

/** 初见守岛人：越肩镜头推到守岛人，标题卡写名字与性格。 */
export function keeperIntroShots(view: ExploreView, keeperId: string, def: Keeper): Shot[] {
  const k = () => {
    const kv = view.keeperView(keeperId);
    return kv ? v3(kv.x, view.ground(kv.x, kv.z) + 1.55, kv.z) : v3(0, 1.5, 0);
  };
  const shoulder = () => {
    const P = view.player;
    const t = k();
    const dx = t.x - P.x;
    const dz = t.z - P.z;
    const len = Math.hypot(dx, dz) || 1;
    return v3(P.x - (dx / len) * 2.2 + (-dz / len) * 1.3, view.ground(P.x, P.z) + 2.0, P.z - (dz / len) * 2.2 + (dx / len) * 1.3);
  };
  return [
    { duration: 1.2, ease: 'inOut', onStart: () => view.keeperView(keeperId)?.waveHand(), from: () => view.followPose(), to: () => pose(shoulder(), k()) },
    { duration: 2.4, ease: 'linear', title: { main: `守岛人 · ${def.name}`, sub: def.personality.join('、') }, from: () => pose(shoulder(), k()), to: () => pose(shoulder().add(v3(0, 0.1, 0)), k()) },
  ];
}
