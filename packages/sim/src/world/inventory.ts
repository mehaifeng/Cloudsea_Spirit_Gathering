import { ECONOMY, type ContentDb, type ItemStack } from '@cloudsea/content';
import type { ItemBag } from './state';

export function slotsUsed(bag: ItemBag): number {
  return Object.values(bag).reduce((a, n) => a + Math.ceil(n / ECONOMY.stackSize), 0);
}

export function countOf(bag: ItemBag, item: string): number {
  return bag[item] ?? 0;
}

/** 放得下多少个（受格数上限）。 */
export function roomFor(bag: ItemBag, item: string, capacity: number): number {
  const have = countOf(bag, item);
  const partial = have % ECONOMY.stackSize === 0 ? 0 : ECONOMY.stackSize - (have % ECONOMY.stackSize);
  return partial + Math.max(0, capacity - slotsUsed(bag)) * ECONOMY.stackSize;
}

/** 尽量放进去，返回实际放入的数量。 */
export function addItems(bag: ItemBag, item: string, count: number, capacity: number): number {
  const n = Math.max(0, Math.min(count, roomFor(bag, item, capacity)));
  if (n > 0) bag[item] = countOf(bag, item) + n;
  return n;
}

export function removeItems(bag: ItemBag, item: string, count: number): boolean {
  const have = countOf(bag, item);
  if (have < count) return false;
  if (have === count) delete bag[item];
  else bag[item] = have - count;
  return true;
}

/**
 * 在家园时，背包和仓库一起算（建造、加工、交订单都从两边扣：先仓库后背包）。
 */
export function pooledCount(bags: readonly ItemBag[], item: string): number {
  return bags.reduce((a, b) => a + countOf(b, item), 0);
}

export function canPay(bags: readonly ItemBag[], stacks: readonly ItemStack[]): boolean {
  return stacks.every((s) => pooledCount(bags, s.item) >= s.count);
}

export function payFrom(bags: readonly ItemBag[], stacks: readonly ItemStack[]): boolean {
  if (!canPay(bags, stacks)) return false;
  for (const s of stacks) {
    let left = s.count;
    for (const bag of bags) {
      const take = Math.min(left, countOf(bag, s.item));
      if (take > 0) removeItems(bag, s.item, take);
      left -= take;
      if (left === 0) break;
    }
  }
  return true;
}

export function itemName(content: ContentDb, id: string): string {
  return content.items.get(id)?.name ?? id;
}
