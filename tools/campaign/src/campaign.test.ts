import { getContent } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { CampaignBot } from './bot';

const content = getContent();

describe('全流程可通关（M3-6）：从新游戏开始只发意图', () => {
  for (const seed of [1, 2, 3]) {
    it(`种子 ${seed}：依次打赢五位守卫与云主，看到终章`, () => {
      const bot = new CampaignBot(content, seed);
      const r = bot.run(60);
      expect(r.reason ?? '').toBe('');
      expect(r.finished).toBe(true);
      expect(bot.world.lighthousesLit).toEqual(['sunPlainsLord', 'windValleyLord', 'rainMarshLord', 'thunderCliffLord', 'mistSeaLord']);
      expect(bot.world.guardiansBeaten).toHaveLength(5);
      expect(bot.world.chapter).toBe(6);
      // 顺序：每一区都是先守卫、后云主
      const order = r.milestones.map((m) => m.what).filter((w) => w.startsWith('打赢灯塔会守卫') || w.startsWith('讨伐'));
      expect(order).toHaveLength(10);
      order.forEach((w, i) => expect(w.startsWith(i % 2 === 0 ? '打赢灯塔会守卫' : '讨伐'), w).toBe(true));
    }, 120_000);
  }
});
