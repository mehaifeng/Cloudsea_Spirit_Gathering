import { getContent } from '@cloudsea/content';
import {
  activeUnits,
  CLOUDLORD_SPOT,
  createCharacter,
  createWorld,
  joinWorld,
  makeSpirit,
  saveCharacter,
  type ActiveBattle,
  type BattleAction,
  type CharacterState,
  type SideActions,
  type WorldState,
} from '@cloudsea/sim';
import { describe, expect, it } from 'vitest';
import { ClientSession } from './client';
import { applyPatch, deepEqual, diff } from './diff';
import { HostSession } from './host';
import { PROTOCOL_VERSION } from './protocol';
import { createHub, createLoopback } from './transport';

const content = getContent();

function hostWorld(seed = 1): WorldState {
  const world = createWorld(content, { seed, hostId: 'p1' });
  joinWorld(world, createCharacter(content, { id: 'p1', name: '房主' }));
  return world;
}

describe('差量（DESIGN 9.1，M2）', () => {
  it('applyPatch(prev, diff(prev, next)) = next；没变的子树沿用旧引用', () => {
    const prev = { a: 1, b: { c: [1, 2], d: { e: 'x' } }, gone: true, keep: { k: 1 } };
    const next = { a: 2, b: { c: [1, 2, 3], d: { e: 'x' } }, added: { z: null }, keep: { k: 1 } };
    const patch = diff(prev, next);
    const out = applyPatch(prev, patch);
    expect(deepEqual(out, next)).toBe(true);
    expect(out.keep).toBe(prev.keep);
    expect(out.b.d).toBe(prev.b.d);
    expect(out).not.toBe(prev);
    expect(prev.a).toBe(1); // 不改旧对象
    expect(diff(next, JSON.parse(JSON.stringify(next)))).toEqual([]);
  });

  it('真实世界推进一段时间：差量还原出的世界与房主完全一致，且远小于完整快照', () => {
    const world = hostWorld();
    const { client, host } = createLoopback();
    const hs = new HostSession(content, world, host);
    const cs = new ClientSession(client, { playerId: 'p1' });
    const sizes: number[] = [];
    const orig = client.onMessage;
    void orig;
    for (let i = 0; i < 30; i++) {
      hs.update(100);
      expect(JSON.stringify(cs.world)).toBe(JSON.stringify(world));
    }
    const full = JSON.stringify(world).length;
    const patch = JSON.stringify(diff(JSON.parse(JSON.stringify(world)), (() => { hs.update(100); return JSON.parse(JSON.stringify(world)); })()));
    sizes.push(patch.length);
    expect(sizes[0]!).toBeLessThan(full / 20);
  });
});

describe('Loopback：单人 = 0 个客人的房主', () => {
  it('意图经房主执行，结果与差量回到客户端；客户端改自己的副本不影响房主', async () => {
    const world = hostWorld();
    const { client, host } = createLoopback();
    const hostSession = new HostSession(content, world, host);
    const session = new ClientSession(client, { playerId: 'p1' });
    expect(session.playerId).toBe('p1');
    const events: string[] = [];
    session.onEvents((es) => events.push(...es.map((e) => e.t)));

    const r1 = await session.request({ type: 'adoptStarter' });
    expect(r1).toEqual({ ok: true });
    expect(session.world?.characters['p1']?.party).toHaveLength(1);

    const r2 = await session.request({ type: 'sail', islandId: 'mistHollow' });
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/提灯/);

    hostSession.update(1000);
    expect(session.world?.tick).toBe(10);
    expect(events).toContain('dayStart');

    const snap = session.world as WorldState;
    expect(snap).not.toBe(world);
    snap.characters['p1']!.shells = 999999;
    expect(world.characters['p1']!.shells).toBe(200);
  });

  it('卡顿后单帧最多补算 50 tick', () => {
    const world = hostWorld();
    const { host } = createLoopback();
    const s = new HostSession(content, world, host);
    s.update(60_000);
    expect(world.tick).toBe(50);
  });
});

describe('客人加入（M2）', () => {
  it('客人带角色存档加入：认领家园岛；角色 id 和在线的人撞了会换一个；版本不一致、房间满了会被拒绝', () => {
    const world = hostWorld();
    const hub = createHub();
    new HostSession(content, world, hub.host);
    new ClientSession(hub.connect('local'), { playerId: 'p1' });
    // 旧版存档的角色 id 也是 p1：被改成 p1x2，絮灵的主人一起改
    const guestChar = createCharacter(content, { id: 'p1', name: '客人' });
    const s = makeSpirit(content, 'warmbud', 5, { id: 'p1-s1', owner: 'p1' });
    guestChar.spirits[s.id] = { ...s, state: 'party' };
    guestChar.party.push(s.id);
    const guest = new ClientSession(hub.connect('g1'), { character: saveCharacter(guestChar) });
    expect(guest.playerId).toBe('p1x2');
    expect(world.characters['p1x2']!.name).toBe('客人');
    expect(world.characters['p1x2']!.spirits['p1-s1']!.ownerId).toBe('p1x2');
    expect(world.homes['p1x2']).toBeTruthy();
    expect(guest.world?.characters['p1']?.name).toBe('房主');

    // 版本不一致
    const reasons: string[] = [];
    const bad = hub.connect('bad');
    bad.onMessage((m) => m.type === 'reject' && reasons.push(m.reason));
    bad.send({ type: 'hello', protocol: PROTOCOL_VERSION + 1, character: saveCharacter(createCharacter(content, { id: 'zz', name: 'x' })) });
    expect(reasons[0]).toMatch(/版本不一致/);
    // 满 4 人
    for (const id of ['g2', 'g3']) new ClientSession(hub.connect(id), { character: saveCharacter(createCharacter(content, { id, name: id })) });
    const full: string[] = [];
    const g4 = new ClientSession(hub.connect('g4'), { character: saveCharacter(createCharacter(content, { id: 'g4', name: 'g4' })) });
    g4.onClose((r) => full.push(r));
    expect(g4.playerId).toBeNull();
    expect(Object.keys(world.characters)).toHaveLength(4);

    // 客人断线：角色离开世界，家园岛留着
    hub.disconnect('g1');
    expect(world.characters['p1x2']).toBeUndefined();
    expect(world.homes['p1x2']).toBeTruthy();
  });
});

describe('4 人云主讨伐（M2 验收：全程不出现不同步）', () => {
  function strongCharacter(id: string, name: string): CharacterState {
    const c = createCharacter(content, { id, name });
    const lines = ['warmbud', 'eavedrop', 'kitefluff', 'forgespark'];
    for (let k = 0; k < 2; k++) {
      const s = makeSpirit(content, lines[(id.length + k) % 4]!, 36, { id: `${id}-s${k + 1}`, owner: id, talents: 25, formIndex: 1 });
      c.spirits[s.id] = { ...s, state: 'party' };
      c.party.push(s.id);
    }
    c.tutorial = { step: 6, done: true };
    return c;
  }

  function mine(b: ActiveBattle, pid: string): SideActions {
    const out: Record<number, BattleAction> = {};
    const foe = activeUnits(b.state, 1)[0];
    for (const { slot, unit } of activeUnits(b.state, 0)) {
      if (unit.ownerId !== pid || unit.charging) continue;
      out[slot] = foe ? { type: 'skill', skillId: 'jab', target: { side: 1, slot: foe.slot } } : { type: 'skill', skillId: 'guard' };
    }
    return out;
  }

  it('房主 + 3 位客人经协议加入、一起航行到灯塔岛、讨伐云主到胜利；每一步每个客户端的世界都与房主一致', async () => {
    const world = createWorld(content, { seed: 99, hostId: 'h' });
    joinWorld(world, strongCharacter('h', '房主'));
    world.guardiansBeaten.push('sunPlainsLord');
    const hub = createHub();
    const host = new HostSession(content, world, hub.host);
    const clients = [new ClientSession(hub.connect('local'), { playerId: 'h' })];
    for (const id of ['ga', 'gbb', 'gccc']) clients.push(new ClientSession(hub.connect(id), { character: saveCharacter(strongCharacter(id, id)) }));
    const ids = clients.map((c) => c.playerId!);
    expect(ids).toEqual(['h', 'ga', 'gbb', 'gccc']);
    const lastEvents = new Map<string, string[]>();
    clients.forEach((c, i) => c.onEvents((es) => lastEvents.set(ids[i]!, [...(lastEvents.get(ids[i]!) ?? []), ...es.map((e) => e.t)])));

    const inSync = () => {
      const truth = JSON.stringify(world);
      for (const c of clients) expect(JSON.stringify(c.world)).toBe(truth);
    };
    const req = async (i: number, intent: Parameters<ClientSession['request']>[0]) => {
      const r = await clients[i]!.request(intent);
      expect(r, `${ids[i]} ${intent.type}`).toEqual({ ok: true });
      inSync();
    };

    for (let i = 0; i < 4; i++) await req(i, { type: 'sail', islandId: 'sunLighthouse' });
    while (Object.values(world.players).some((p) => p.voyage)) {
      host.update(100);
      inSync();
    }
    for (let i = 0; i < 4; i++) await req(i, { type: 'move', x: CLOUDLORD_SPOT.x + i * 0.5, z: CLOUDLORD_SPOT.z + 3, yaw: Math.PI });
    await req(0, { type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' });
    const battleId = world.players['h']!.battleId!;
    for (let i = 1; i < 4; i++) await req(i, { type: 'joinBattle', battleId });
    expect(world.battles[battleId]!.participants).toEqual(ids);

    let rounds = 0;
    while (world.battles[battleId] && rounds++ < 80) {
      for (let i = 0; i < 4; i++) {
        const b = world.battles[battleId];
        if (!b) break;
        await req(i, { type: 'battleActions', battleId, actions: mine(b, ids[i]!) });
      }
      host.update(100);
      inSync();
    }
    expect(world.battles[battleId]).toBeUndefined();
    expect(world.lighthousesLit).toEqual(['sunPlainsLord']);
    for (const id of ids) {
      expect(lastEvents.get(id)).toContain('battleEnd');
      expect(lastEvents.get(id)).toContain('lighthouseLit');
    }
    inSync();
  });
});
