import type { BattleEvent } from '../battle/types';
import type { BattleResult } from '../battle/rewards';

/**
 * 世界事件：房主执行意图 / 推进时间后广播给客户端，用于提示、动画与音效。
 * 状态本身随后以快照或差量同步，事件只负责“发生了什么”。
 */
export type WorldEvent =
  | { readonly t: 'toast'; readonly playerId?: string; readonly text: string }
  | { readonly t: 'items'; readonly playerId: string; readonly item: string; readonly count: number; readonly where: 'backpack' | 'storage' }
  | { readonly t: 'shells'; readonly playerId: string; readonly delta: number }
  | { readonly t: 'dayStart'; readonly day: number }
  | { readonly t: 'sailed'; readonly playerId: string; readonly islandId: string }
  | { readonly t: 'battleStart'; readonly playerId: string; readonly battleId: string }
  | { readonly t: 'battleTurn'; readonly playerId: string; readonly battleId: string; readonly events: readonly BattleEvent[] }
  | {
      readonly t: 'battleEnd';
      readonly playerId: string;
      readonly battleId: string;
      readonly result: BattleResult;
      readonly exp: Readonly<Record<string, number>>;
      readonly levelUps: readonly string[];
      readonly captured: readonly string[];
      readonly rescued: boolean;
    }
  | { readonly t: 'dialogue'; readonly playerId: string; readonly keeperId: string; readonly lines: readonly string[]; readonly title?: string }
  | { readonly t: 'affinity'; readonly playerId: string; readonly keeperId: string; readonly delta: number; readonly level: number }
  | { readonly t: 'built'; readonly ownerId: string; readonly buildingId: string }
  | { readonly t: 'cropReady'; readonly ownerId: string; readonly buildingId: string }
  | { readonly t: 'harvest'; readonly ownerId: string; readonly item: string; readonly count: number }
  | { readonly t: 'crafted'; readonly ownerId: string; readonly item: string; readonly count: number }
  | { readonly t: 'hatched'; readonly playerId: string; readonly spiritId: string }
  | { readonly t: 'purified'; readonly playerId: string; readonly spiritId: string }
  | { readonly t: 'recovered'; readonly playerId: string; readonly spiritId: string }
  | { readonly t: 'evolved'; readonly playerId: string; readonly spiritId: string; readonly formId: string }
  | { readonly t: 'keeperVisit'; readonly keeperId: string; readonly playerId: string }
  | { readonly t: 'blueprint'; readonly playerId: string; readonly building: string };
