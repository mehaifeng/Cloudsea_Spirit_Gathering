import type { Island, Keeper } from '@cloudsea/content';
import { makeSkiff } from '@cloudsea/render';
import * as THREE from 'three';
import { pose, v3, type Shot } from './cinematic';
import { ExploreView } from './explore';
import { STARTER_SPOT } from './tutorial';

/**
 * 一次性播片的镜头脚本（DESIGN 13、14.3，v0.5）。
 * 每个函数返回一串镜头；最后一个镜头都回到玩家身后的探索机位，切回操作时没有跳变。
 */

/** 开场：失控的云舟从云海上空坠向荒岛 → 撞击 → 镜头转向岛上发光的云气团 → 回到玩家。 */
export function openingShots(view: ExploreView): Shot[] {
  const g = view.ground;
  const wreck = ExploreView.WRECK;
  const crash = v3(wreck.x, g(wreck.x, wreck.z), wreck.z);
  const start = v3(-70, 34, -55);
  const falling = makeSkiff();
  let fallingAdded = false;
  const removeFalling = () => {
    view.scene.remove(falling.group);
  };
  const skiffAt = (k: number): THREE.Vector3 => {
    // 一条下坠的弧线，后段越来越陡
    const p = new THREE.Vector3().lerpVectors(start, crash, k);
    p.y = THREE.MathUtils.lerp(start.y, crash.y + 0.4, Math.pow(k, 1.8));
    return p;
  };
  const flyStart = 0;
  const flyEnd = 0.92;
  let flyK = 0;
  const updateFall = (k: number, dt: number) => {
    flyK = flyStart + (flyEnd - flyStart) * k;
    const p = skiffAt(flyK);
    const next = skiffAt(Math.min(1, flyK + 0.01));
    falling.group.position.copy(p);
    falling.group.lookAt(next);
    falling.group.rotateZ(Math.sin(performance.now() / 180) * 0.25);
    falling.update(performance.now() / 1000, 1);
    if (Math.random() < dt * 14) view.fx.spawn('puff', p.clone().add(v3(0, 1, 0)), 1, { size: 1.2, vy: 0.6, life: 1.6, spread: 0.5, color: 0x8a8290 });
  };
  const follow = view.followPose();
  const puff = v3(STARTER_SPOT.x, g(STARTER_SPOT.x, STARTER_SPOT.z) + 0.8, STARTER_SPOT.z);
  return [
    {
      duration: 4.6,
      ease: 'linear',
      subtitle: '风暴过后，一艘云舟在云海上空失去了动力。',
      onStart: () => {
        if (!fallingAdded) view.scene.add(falling.group);
        fallingAdded = true;
        view.setSkiffVisible(false);
      },
      from: () => pose(v3(-20, 40, 60), v3(-40, 20, -20)),
      to: () => pose(v3(-8, 26, 40), skiffAt(flyK)),
      onUpdate: (k, dt) => updateFall(k * 0.72, dt),
    },
    {
      duration: 2.4,
      ease: 'inOut',
      subtitle: '它一头扎向下方的小岛——',
      from: () => pose(v3(-8, 26, 40), skiffAt(flyK)),
      to: () => pose(v3(crash.x - 8, crash.y + 6, crash.z + 12), skiffAt(flyK)),
      onUpdate: (k, dt) => updateFall(0.72 + k * 0.28, dt),
    },
    {
      duration: 1.6,
      ease: 'out',
      shake: 0.6,
      onStart: () => {
        removeFalling();
        view.setSkiffVisible(true);
        view.fx.spawn('puff', crash.clone().add(v3(0, 0.6, 0)), 18, { size: 1.4, vy: 1.4, life: 1.6, spread: 4 });
        view.fx.spawn('spark', crash.clone().add(v3(0, 1, 0)), 10, { size: 0.5, vy: 2, life: 0.9, spread: 3, color: 0xffd59a });
      },
      from: () => pose(v3(crash.x - 8, crash.y + 6, crash.z + 12), crash),
      to: () => pose(v3(crash.x - 6, crash.y + 4, crash.z + 9), crash),
    },
    {
      duration: 3.8,
      ease: 'inOut',
      subtitle: '岛上很安静。不远处，一团温暖的云气在发光。',
      from: () => pose(v3(crash.x - 6, crash.y + 4, crash.z + 9), crash),
      to: () => pose(v3(puff.x - 3.5, puff.y + 1.8, puff.z + 5.5), puff),
    },
    {
      duration: 2.2,
      ease: 'inOut',
      from: () => pose(v3(puff.x - 3.5, puff.y + 1.8, puff.z + 5.5), puff),
      to: () => follow,
    },
  ];
}

/** 首次遭遇野生絮灵：从玩家身后推到絮灵的侧脸。 */
export function firstWildShots(view: ExploreView, wildId: string, name: string): Shot[] {
  const target = () => {
    const c = view.creatureView(wildId);
    return c ? c.headPos() : v3(view.player.x, view.ground(view.player.x, view.player.z) + 0.6, view.player.z);
  };
  const start = view.followPose();
  const side = () => {
    const t = target();
    const P = view.player;
    const dx = t.x - P.x;
    const dz = t.z - P.z;
    const len = Math.hypot(dx, dz) || 1;
    // 站在玩家与絮灵连线的侧面
    return v3(t.x - (dx / len) * 1.6 + (-dz / len) * 2.2, t.y + 0.5, t.z - (dz / len) * 1.6 + (dx / len) * 2.2);
  };
  return [
    {
      duration: 1.4,
      ease: 'inOut',
      onStart: () => view.creatureView(wildId)?.hop(3),
      from: () => start,
      to: () => pose(side(), target()),
    },
    { duration: 1.4, ease: 'linear', subtitle: `野生的${name}注意到了你！`, from: () => pose(side(), target()), to: () => pose(side().add(v3(0, 0.2, 0)), target()) },
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
