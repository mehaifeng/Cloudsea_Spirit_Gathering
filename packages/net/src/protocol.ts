import type { Intent, WorldEvent, WorldState } from '@cloudsea/sim';

/** 客户端 → 房主。 */
export type ClientMessage =
  | { readonly type: 'intent'; readonly seq: number; readonly intent: Intent }
  | { readonly type: 'hello'; readonly playerId: string };

/** 房主 → 客户端。 */
export type HostMessage =
  | { readonly type: 'result'; readonly seq: number; readonly ok: boolean; readonly error?: string }
  | { readonly type: 'events'; readonly events: readonly WorldEvent[] }
  /** 世界快照（副本）。客户端只读，修改它也不会影响房主（铁律 4）。 */
  | { readonly type: 'snapshot'; readonly world: Readonly<WorldState> };
