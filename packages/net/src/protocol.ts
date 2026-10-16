import type { Intent, WorldEvent, WorldState } from '@cloudsea/sim';

/** 客户端 → 房主。 */
export type ClientMessage =
  | { readonly type: 'intent'; readonly seq: number; readonly intent: Intent }
  | { readonly type: 'hello'; readonly playerId: string };

/** 房主 → 客户端。 */
export type HostMessage =
  | { readonly type: 'result'; readonly seq: number; readonly ok: boolean; readonly error?: string }
  | { readonly type: 'events'; readonly events: readonly WorldEvent[] }
  /**
   * 世界快照。Loopback 直接传只读引用（零拷贝）；跨进程的传输层负责序列化。
   * 客户端永远不能修改它（铁律 4）。
   */
  | { readonly type: 'snapshot'; readonly world: Readonly<WorldState> };
