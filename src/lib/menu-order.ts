/**
 * A seller's menu order: sort_order ascending (unset last), then the order the
 * seller added items (created_at ascending). sort_order arrives with migration
 * 082; before it, every row is "unset" and created_at alone decides.
 */
export type MenuOrderRow = { id: string; sort_order?: number | null; created_at?: string | null };

export function compareMenuOrder(a: MenuOrderRow, b: MenuOrderRow): number {
  const sa = a.sort_order ?? Infinity;
  const sb = b.sort_order ?? Infinity;
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ca = String(a.created_at ?? "");
  const cb = String(b.created_at ?? "");
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

/** Ids in menu order after moving one item a step up or down; null if the id isn't in the list. */
export function moveInMenu(rows: MenuOrderRow[], id: string, direction: "up" | "down"): string[] | null {
  const ids = [...rows].sort(compareMenuOrder).map((r) => r.id);
  const i = ids.indexOf(id);
  if (i < 0) return null;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

/**
 * Rows grouped by seller, each group in menu order. A query without an ORDER BY comes back
 * in Postgres storage order, which changes whenever a row is updated (a reorder, a pause),
 * so /shop seller cards showed a different "first item" from the seller's menu.
 */
export function menuBySeller<T extends MenuOrderRow>(rows: T[], sellerOf: (row: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const sid = sellerOf(r);
    if (!sid) continue;
    if (!out.has(sid)) out.set(sid, []);
    out.get(sid)!.push(r);
  }
  for (const list of out.values()) list.sort(compareMenuOrder);
  return out;
}
