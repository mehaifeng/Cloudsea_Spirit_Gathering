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
  /** 跳下云舟这一镜：走到登船口（≤ 1.2 秒）+ 蓄力、跳、落地缓冲（约 1.3 秒），留够余量，落地后才切下一镜。 */
  const JUMP_T = 3.4;
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
  /** 跳下云舟的侧拍机位：站在船舷外、沿船身方向退开，登船口和落点都在画面里。 */
  const jumpCam = () => {
    const { pts, land } = outPoint();
    const ox = land.x - pts.inside.x;
    const oz = land.z - pts.inside.z;
    const len = Math.hypot(ox, oz) || 1;
    const mid = v3((land.x + pts.inside.x) / 2, 0, (land.z + pts.inside.z) / 2);
    // 船身方向的两侧选离码头远的那一侧，免得码头的灯柱挡住镜头
    const a = mid.clone().add(v3((-oz / len) * 5.2 + (ox / len) * 1.6, 0, (ox / len) * 5.2 + (oz / len) * 1.6));
    const b = mid.clone().add(v3((oz / len) * 5.2 + (ox / len) * 1.6, 0, (-ox / len) * 5.2 + (oz / len) * 1.6));
    const cam = a.distanceTo(dock) > b.distanceTo(dock) ? a : b;
    cam.y = g(cam.x, cam.z) + 1.9;
    return pose(cam, v3(mid.x, g(mid.x, mid.z) + 1.1, mid.z));
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
      // 跳下云舟（v0.10）：先用 0.9 秒把镜头换到侧拍（人这时走向登船口），起跳时镜头已经停稳
      duration: 0.9,
      ease: 'inOut',
      onStart: () => {
        if (finished) return;
        // 走到登船口 → 蹲下蓄力 → 越过船舷跳出 → 落到草地上（编排好的一跳，船舷不挡）
        view.unride();
        const { pts, land } = outPoint();
        void view.walkTo(pts.inside.x, pts.inside.z, { timeout: 1.2 }).then(() => (finished ? undefined : view.leapTo(land.x, land.z)));
      },
      from: camAt,
      to: jumpCam,
      onUpdate: clock(T_STOP + HOLD, 0.9),
    },
    { duration: JUMP_T - 0.9, ease: 'linear', from: jumpCam, to: jumpCam, onUpdate: clock(T_STOP + HOLD + 0.9, JUMP_T - 0.9) },
    {
      duration: 3.8,
      ease: 'inOut',
      subtitle: '岛上很安静。不远处，一团温暖的云气在发光。',
      onStart: finalize,
      from: jumpCam,
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

/** 修船播片里的对话（v0.11）：领队讲清为什么来、这次修船谁出钱、以及商队往后的规矩（DESIGN 6.3 / 8 / 9.3）。 */
const CARAVAN_LEADER = '商队领队 · 苏棹';
const REPAIR_TALK: ReadonlyArray<{ who: string; lines: readonly string[] }> = [
  {
    who: CARAVAN_LEADER,
    lines: [
      '喂——人没事吧？絮灵也没事？那就好。',
      '我们在三里外就看见这股黑烟了。灯塔会托商队给新来的守岛人捎第一批货，说这两天就到——原来就是你。',
    ],
  },
  { who: '你', lines: ['风暴把云舟的核心打灭了……刚才还有一只被蚀雾侵蚀的絮灵冲过来。'] },
  {
    who: CARAVAN_LEADER,
    lines: [
      '蚀雾都摸到这儿了？难怪灯塔会急着派人。',
      '船交给我们。商队跟灯塔会有约在先：守岛人的船出了事，我们捞人、修船，账记在灯塔会头上。你一个云贝都不用掏。',
      '往后打交道的日子还长，商队的规矩先跟你说说——',
      '每天早上，商队的船都会经过你的码头。订单板上挂着我们想收的货，按单交货，给的云贝比直接卖给我们多。',
      '种子、暖心包、技能书、建筑蓝图，码头都买得到；你岛上种的、做的，也都能卖给我们。',
      '还有：在野外要是絮灵全倒下了，别慌。商队的船满云海跑，顺路就把你捎回家。',
      '好了，干活！阿木、小满，木板和工具箱搬过来，先补船底！',
    ],
  },
];

/**
 * 商队修船（v0.10 首战之后；v0.11 重做）：
 * 1. 残骸的黑烟引来一艘风帆商队的大船（帆上有商队徽记，甲板上有船员）；落稳、放下舷梯；
 * 2. 领队走下舷梯来见你，两位伙计扛着木板、捧着工具箱跟着；
 * 3. 对话（播片停在两人的镜头上，等玩家翻完）：为什么来、谁出钱、商队往后的规矩；
 * 4. 伙计放下木板和工具箱：一个蹲在船边钉木板（破洞一块块补上），一个锯木板；
 * 5. 领队爬上残骸，把新的云气晶体举上桅顶，核心重新亮起；
 * 6. 纸色转场、“半日后” → 修好的云舟停在码头边，大船起飞，船上的人挥手 → 回到玩家身后。
 * 播完或跳过后由调用方执行 view.endRepair()（保证残骸已换成修好的云舟）；跳过时对话照常留着给玩家看。
 */
export function repairShots(view: ExploreView, talk: { say: (who: string, lines: readonly string[]) => void; open: () => boolean }): Shot[] {
  const W = ExploreView.WRECK;
  const g = view.ground;
  const spot = view.caravanSpot();
  const land = v3(spot.x, spot.y, spot.z);
  // 从残骸看过去大船那一侧的方向：船从这一侧更远、更高的地方斜着落下来
  const away = v3(spot.x - W.x, 0, spot.z - W.z).normalize();
  const sky = land.clone().addScaledVector(away, 28).add(v3(0, 16, 0));
  const leave = land.clone().addScaledVector(away, 34).add(v3(0, 24, 0));
  const wreck = () => v3(W.x, g(W.x, W.z) + 0.8, W.z);
  // 全景：残骸与大船连线的侧面，离码头和玩家都远的一侧
  const mid = v3((W.x + spot.x) / 2, 0, (W.z + spot.z) / 2);
  const n = v3(-away.z, 0, away.x);
  const dockAt = v3(HOME_DOCK.x, 0, HOME_DOCK.z);
  const me = v3(view.player.x, 0, view.player.z);
  const score = (p: THREE.Vector3) => Math.min(p.distanceTo(dockAt), p.distanceTo(me) * 1.5);
  const sideA = mid.clone().addScaledVector(n, 17);
  const sideB = mid.clone().addScaledVector(n, -17);
  const sideSign = score(sideA) > score(sideB) ? 1 : -1;
  // 大船连帆有 9 米高、11 米长：机位退远、抬高，看向偏大船那一侧，整条船都在画面里
  const shipSide = mid.clone().lerp(v3(spot.x, 0, spot.z), 0.35);
  const sidePos = shipSide.clone().addScaledVector(n, 24 * sideSign).addScaledVector(away, -4);
  sidePos.y = g(sidePos.x, sidePos.z) + 8;
  const wide = () => pose(sidePos, v3(shipSide.x, g(shipSide.x, shipSide.z) + 3.2, shipSide.z));
  let meet: ReturnType<ExploreView['caravanMeet']> | null = null;
  let spots: ReturnType<ExploreView['repairSpots']> | null = null;
  const M = () => (meet ??= view.caravanMeet());
  const S = () => (spots ??= view.repairSpots());
  // 舷梯侧拍：站在舷梯脚的侧面，大船、舷梯和下来的人都在画面里
  const gangCam = () => {
    const m = M();
    const p = m.foot.clone().addScaledVector(away.clone().negate(), 3.5).addScaledVector(n, 6.5 * sideSign);
    return pose(v3(p.x, g(p.x, p.z) + 2.6, p.z), v3(m.leader.x, m.leader.y + 1.4, m.leader.z));
  };
  // 两人对话：站在两人连线的侧面（离大船远的一侧），略偏玩家这边，看得到领队的脸
  const talkCam = () => {
    const leader = view.caravanPerson('leader') ?? M().leader.clone().add(v3(0, 1.55, 0));
    const P = view.player;
    const you = v3(P.x, P.feetY + 1.55, P.z);
    const c = leader.clone().add(you).multiplyScalar(0.5);
    const u = you.clone().sub(leader).setY(0).normalize();
    const side = v3(-u.z, 0, u.x);
    if (c.clone().add(side).distanceTo(land) < c.clone().sub(side).distanceTo(land)) side.negate();
    const p = c.clone().addScaledVector(side, 3.3).addScaledVector(u, 1.1);
    return pose(v3(p.x, g(p.x, p.z) + 1.85, p.z), c.add(v3(0, -0.1, 0)));
  };
  // 修船全景：大船一侧斜看残骸，木板堆和伙计都在画面里
  const workWide = () => {
    const s = S();
    const look = v3((W.x + s.pile.x) / 2, g(W.x, W.z) + 0.9, (W.z + s.pile.z) / 2);
    const p = look.clone().addScaledVector(n, 9 * sideSign).addScaledVector(away, 3.5);
    return pose(v3(p.x, g(p.x, p.z) + 4, p.z), look);
  };
  // 钉木板的近景：从侧面看蹲着钉木板的伙计（锤子、新木板和船壳都在画面里）
  const hammerCam = () => {
    const s = S();
    const out = v3(s.kneel.x - s.hole.x, 0, s.kneel.z - s.hole.z).normalize();
    const along = v3(-out.z, 0, out.x).multiplyScalar(-sideSign);
    const c = s.hole.clone().lerp(v3(s.kneel.x, s.hole.y, s.kneel.z), 0.5);
    const p = c.clone().addScaledVector(along, 3.4).addScaledVector(out, 2.3);
    return pose(v3(p.x, g(p.x, p.z) + 1.5, p.z), c.add(v3(0, 0.25, 0)));
  };
  // 桅顶：从残骸外侧低处仰拍领队把晶体举上去
  const mastCam = () => {
    const s = S();
    const out = v3(s.boardPath[0]!.x - W.x, 0, s.boardPath[0]!.z - W.z).normalize();
    const p = v3(W.x, 0, W.z).addScaledVector(out, 5.2).addScaledVector(n, 1.6 * sideSign);
    return pose(v3(p.x, g(p.x, p.z) + 1.1, p.z), s.core.clone().add(v3(0, -0.6, 0)));
  };
  // 修好之后：从岛内看码头边的云舟，商队的大船在后面升空
  const berth = () => {
    const b = view.berth();
    return v3(b.x, b.y + 1, b.z);
  };
  // 码头机位：修好的云舟在近处，越过它看商队大船升空离开（跟着大船转）
  const dockCam = () => {
    const b = berth();
    const ship = view.caravanPerson('helm') ?? land.clone();
    const d = v3(b.x - ship.x, 0, b.z - ship.z).normalize();
    const p = b.clone().addScaledVector(d, 7).addScaledVector(v3(-d.z, 0, d.x), 2.5);
    return pose(v3(p.x, g(p.x, p.z) + 2.6, p.z), b.clone().lerp(ship, 0.55));
  };
  let said = false;
  let lit = false;
  let swapped = false;
  const leaderAt = () => {
    const p = view.caravanPerson('leader');
    return p ? { x: p.x, z: p.z } : null;
  };
  return [
    {
      duration: 4.6,
      ease: 'inOut',
      subtitle: '残骸的黑烟升得老高。一艘大船循着烟从云里降了下来——帆上画着风帆商队的徽记。',
      onStart: () => {
        view.repairHold = true;
        view.spawnCaravan(spot);
        view.placeCaravan(sky, 0.12);
        view.playerLook = { x: spot.x, z: spot.z };
      },
      from: () => view.followPose(),
      to: wide,
      onUpdate: (k) => {
        // 最后 15% 的时间已经落稳
        const u = Math.min(1, k / 0.85);
        const e = 1 - (1 - u) * (1 - u);
        view.placeCaravan(new THREE.Vector3().lerpVectors(sky, land, e), 0.12 * (1 - e));
      },
    },
    {
      duration: 3.6,
      ease: 'inOut',
      subtitle: '船刚停稳，舷梯就放了下来。领队走下船，两个伙计扛着木板、捧着工具箱跟在后面。',
      onStart: () => {
        view.placeCaravan(land, 0);
        view.lowerCaravanGangway();
        const m = M();
        const P = view.player;
        view.crewPose('mu', { carry: 'plank' });
        view.crewPose('man', { carry: 'box' });
        view.crewWalk('leader', [{ x: m.leader.x, z: m.leader.z, then: () => view.crewPose('leader', { wave: true }) }], () => Math.atan2(P.x - m.leader.x, P.z - m.leader.z));
        view.crewWalk('mu', [m.mu]);
        view.crewWalk('man', [m.man]);
        view.crewPose('leader', { lookAt: { x: m.player.x, z: m.player.z } });
        const far = Math.hypot(m.player.x - P.x, m.player.z - P.z) > 5;
        void view.walkTo(m.player.x, m.player.z, { run: far, faceYaw: Math.atan2(m.leader.x - m.player.x, m.leader.z - m.player.z), timeout: 3.4 });
        view.playerLook = { x: m.leader.x, z: m.leader.z };
      },
      from: wide,
      to: gangCam,
    },
    {
      duration: 1.4,
      ease: 'inOut',
      onStart: () => {
        if (said) return;
        said = true;
        view.crewPose('leader', { talking: true });
        for (const t of REPAIR_TALK) talk.say(t.who, t.lines);
      },
      from: gangCam,
      to: talkCam,
      // 停在这个镜头上，等玩家翻完对话
      hold: talk.open,
    },
    {
      duration: 4.4,
      ease: 'inOut',
      subtitle: '领队一招手，大家朝残骸走去。',
      onStart: () => {
        const s = S();
        view.crewPose('leader', { talking: false, lookAt: null, carry: 'crystal' });
        view.crewWalk('leader', s.boardPath, () => s.mast.face);
        view.crewWalk('mu', [
          { ...s.pile, then: () => { view.crewPose('mu', { carry: null }); view.dropCargo('planks', s.pile); } },
          { x: s.kneel.x, z: s.kneel.z, then: () => view.crewWork('mu', 'hammer', s.hole) },
        ], () => s.kneel.face);
        view.crewWalk('man', [
          { ...s.box, then: () => { view.crewPose('man', { carry: null }); view.dropCargo('box', s.box); } },
          { x: s.saw.x, z: s.saw.z, then: () => view.crewWork('man', 'saw', v3(s.pile.x, g(s.pile.x, s.pile.z) + 0.25, s.pile.z)) },
        ], () => s.saw.face);
        // 玩家让到一边看（不挡近景机位）
        const watch = v3(W.x, 0, W.z).addScaledVector(away, 3.4).addScaledVector(n, -3.4 * sideSign);
        if (view.terrain.inside(watch.x, watch.z, 1) && view.terrain.waterDistance(watch.x, watch.z) > 1) void view.walkTo(watch.x, watch.z, { faceYaw: Math.atan2(W.x - watch.x, W.z - watch.z), timeout: 4 });
        view.playerLook = { x: W.x, z: W.z };
      },
      from: talkCam,
      to: workWide,
      onUpdate: () => view.crewPose('leader', { lookAt: null }),
    },
    {
      duration: 4.6,
      ease: 'inOut',
      subtitle: '拆掉碎板，量好、锯好，再把新木板一块块钉上船底。',
      from: hammerCam,
      to: () => {
        const c = hammerCam();
        return pose(c.pos.clone().lerp(c.look, 0.2), c.look);
      },
      onUpdate: (k) => view.setWreckRepair(0.15 + 0.7 * k),
    },
    {
      duration: 3.6,
      ease: 'inOut',
      subtitle: '最后，领队把一颗新的云气晶体举上桅顶——核心又亮了。',
      onStart: () => {
        // 万一还没走到（例如帧率很低），直接站到桅杆下
        const s = S();
        view.crewWalk('leader', [{ x: s.mast.x, z: s.mast.z }], () => s.mast.face);
      },
      from: mastCam,
      to: () => {
        const c = mastCam();
        return pose(c.pos.clone().add(v3(0, 0.4, 0)), c.look.clone().add(v3(0, 0.3, 0)));
      },
      onUpdate: (k) => {
        if (k > 0.12) view.crewPose('leader', { raised: true });
        if (k > 0.55 && !lit) {
          lit = true;
          view.crewPose('leader', { carry: null, raised: false });
          view.fx.spawn('spark', S().core, 18, { size: 0.3, vy: 1.2, life: 1.1, spread: 1.6, color: 0xbfe8ff });
        }
        view.setWreckRepair(0.85 + 0.15 * k, lit ? Math.min(1, (k - 0.55) / 0.2) : 0);
      },
    },
    {
      duration: 2.2,
      ease: 'linear',
      title: { main: '半日后' },
      // 0.5 秒盖满纸色 → 停住（这时换成修好的云舟、伙计回到船上）→ 最后 0.6 秒揭开
      fade: (k) => Math.min(1, k / 0.23, (1 - k) / 0.27),
      onUpdate: (k) => {
        if (k > 0.3 && !swapped) {
          swapped = true;
          view.finishRepair();
        }
      },
      // 盖满纸色之前镜头不动，盖满后直接切到码头机位
      from: () => (swapped ? dockCam() : mastCam()),
      to: () => (swapped ? dockCam() : mastCam()),
    },
    {
      duration: 3.8,
      ease: 'inOut',
      subtitle: '云舟修好了，停在码头边。大船上的人朝你挥手：“明早码头见！想找絮灵，就去麦浪坡！”',
      onUpdate: (k) => {
        const e = k * k;
        view.placeCaravan(new THREE.Vector3().lerpVectors(land, leave, e), -0.15 * Math.min(1, k * 3));
      },
      from: dockCam,
      to: dockCam,
    },
    { duration: 2, ease: 'inOut', from: dockCam, to: () => view.followPose() },
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
