import type { Stat } from './stats';

/** 性格作用的四项属性（决策 11：不影响生命）。 */
export const NATURE_STATS = ['power', 'guard', 'agility', 'resonance'] as const satisfies readonly Stat[];
export type NatureStat = (typeof NATURE_STATS)[number];

export interface Nature {
  readonly id: string;
  readonly name: string;
  /** +10% 的属性。 */
  readonly up: NatureStat;
  /** -10% 的属性；与 up 相同即中性性格。 */
  readonly down: NatureStat;
}

/** 16 种性格 = 12 种偏向 + 4 种中性（DESIGN 4.2）。顺序即编号，絮灵码依赖它，只能在末尾追加。 */
export const NATURES: readonly Nature[] = [
  { id: 'reckless', name: '莽撞', up: 'power', down: 'guard' },
  { id: 'sturdy', name: '敦实', up: 'power', down: 'agility' },
  { id: 'stubborn', name: '倔强', up: 'power', down: 'resonance' },
  { id: 'gentle', name: '温和', up: 'guard', down: 'power' },
  { id: 'lazy', name: '慵懒', up: 'guard', down: 'agility' },
  { id: 'steadfast', name: '固执', up: 'guard', down: 'resonance' },
  { id: 'brisk', name: '轻快', up: 'agility', down: 'power' },
  { id: 'hasty', name: '急躁', up: 'agility', down: 'guard' },
  { id: 'restless', name: '好动', up: 'agility', down: 'resonance' },
  { id: 'serene', name: '恬静', up: 'resonance', down: 'power' },
  { id: 'sensitive', name: '敏感', up: 'resonance', down: 'guard' },
  { id: 'leisurely', name: '悠然', up: 'resonance', down: 'agility' },
  { id: 'earnest', name: '认真', up: 'power', down: 'power' },
  { id: 'calm', name: '平和', up: 'guard', down: 'guard' },
  { id: 'carefree', name: '随性', up: 'agility', down: 'agility' },
  { id: 'naive', name: '天真', up: 'resonance', down: 'resonance' },
];

export const NATURE_MULTIPLIER = 0.1;
