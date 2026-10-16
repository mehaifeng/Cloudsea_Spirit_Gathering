import { getContent } from '@cloudsea/content';
import { createCharacter, createWorld, joinWorld, type WorldState } from '@cloudsea/sim';
import { describe, expect, it } from 'vitest';
import { ClientSession } from './client';
import { HostSession } from './host';
import { createLoopback } from './transport';

const content = getContent();

describe('Loopback：单人 = 0 个客人的房主', () => {
  it('意图经房主执行，结果与快照回到客户端；客户端拿不到可写引用以外的途径改世界', async () => {
    const world = createWorld(content, { seed: 1, hostId: 'p1' });
    joinWorld(world, createCharacter(content, { id: 'p1', name: '测试' }));
    const { client, host } = createLoopback('p1');
    const hostSession = new HostSession(content, world, host);
    const session = new ClientSession('p1', client);
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

    // 客户端改快照不会影响房主的世界
    const snap = session.world as WorldState;
    expect(snap).not.toBe(world);
    snap.characters['p1']!.shells = 999999;
    expect(world.characters['p1']!.shells).toBe(200);
  });

  it('卡顿后单帧最多补算 50 tick', () => {
    const world = createWorld(content, { seed: 1, hostId: 'p1' });
    const { host } = createLoopback('p1');
    const s = new HostSession(content, world, host);
    s.update(60_000);
    expect(world.tick).toBe(50);
  });
});
