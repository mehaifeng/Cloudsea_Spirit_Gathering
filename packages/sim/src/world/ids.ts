import type { WorldState } from './state';

/** 世界内的唯一 id（房主分配，确定性）。 */
export function newId(world: WorldState, prefix: string): string {
  return `${prefix}${world.nextId++}`;
}
