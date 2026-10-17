import type { CharacterSaveFile, Intent, WorldEvent, WorldState } from '@cloudsea/sim';
import type { Patch } from './diff';

/** 协议版本：房主与客人不一致时拒绝连接（避免不同版本的 sim 跑出不同结果）。 */
export const PROTOCOL_VERSION = 2;

/** 客户端 → 房主。 */
export type ClientMessage =
  /**
   * 打招呼：房主自己的本机客户端只带 playerId；客人带上自己的角色存档（DESIGN 9.3：角色存在客人本机）。
   */
  | { readonly type: 'hello'; readonly protocol: number; readonly playerId?: string; readonly character?: CharacterSaveFile }
  | { readonly type: 'intent'; readonly seq: number; readonly intent: Intent }
  | { readonly type: 'leave' };

/** 房主 → 客户端。 */
export type HostMessage =
  /** 接受加入：本机玩家 id（角色 id 和别人撞了会被改掉）+ 完整世界。 */
  | { readonly type: 'welcome'; readonly playerId: string; readonly world: Readonly<WorldState> }
  | { readonly type: 'reject'; readonly reason: string }
  | { readonly type: 'result'; readonly seq: number; readonly ok: boolean; readonly error?: string }
  | { readonly type: 'events'; readonly events: readonly WorldEvent[] }
  /** 完整世界快照（副本）。客户端只读，修改它也不会影响房主（铁律 4）。 */
  | { readonly type: 'snapshot'; readonly world: Readonly<WorldState> }
  /** 与这位客人上次收到的世界相比的差量（DESIGN 9.1，M2）。 */
  | { readonly type: 'delta'; readonly patch: Patch };
