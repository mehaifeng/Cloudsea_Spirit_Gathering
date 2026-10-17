/**
 * 状态差量（DESIGN 9.1，M2）：房主每 tick 只发“和这位客人上次收到的状态”相比变了的部分。
 * - 对象逐键递归；数组整体比较、变了就整个替换（世界里的数组都很短：队伍、订单、蓝图……）。
 * - applyPatch 写时复制：变了的路径换新对象，没变的部分沿用旧引用（界面可以按引用判断有没有变）。
 */
export type PatchOp = { readonly p: readonly string[]; readonly v: unknown } | { readonly p: readonly string[]; readonly d: 1 };
export type Patch = readonly PatchOp[];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!(k in (b as object)) || !deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

export function diff(prev: unknown, next: unknown): PatchOp[] {
  const out: PatchOp[] = [];
  const walk = (a: unknown, b: unknown, path: string[]) => {
    if (isObj(a) && isObj(b)) {
      for (const k of Object.keys(a)) if (!(k in b)) out.push({ p: [...path, k], d: 1 });
      for (const k of Object.keys(b)) {
        if (!(k in a)) out.push({ p: [...path, k], v: b[k] });
        else if (a[k] !== b[k]) walk(a[k], b[k], [...path, k]);
      }
      return;
    }
    if (!deepEqual(a, b)) out.push({ p: path, v: b });
  };
  walk(prev, next, []);
  return out;
}

export function applyPatch<T>(base: T, patch: Patch): T {
  let root: unknown = base;
  for (const op of patch) {
    if (op.p.length === 0) {
      root = 'v' in op ? op.v : undefined;
      continue;
    }
    root = setIn(root, op.p, 0, op);
  }
  return root as T;
}

function setIn(node: unknown, path: readonly string[], i: number, op: PatchOp): unknown {
  const copy: Record<string, unknown> = isObj(node) ? { ...node } : {};
  const k = path[i]!;
  if (i === path.length - 1) {
    if ('d' in op) delete copy[k];
    else copy[k] = op.v;
  } else {
    copy[k] = setIn(copy[k], path, i + 1, op);
  }
  return copy;
}
