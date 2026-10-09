/**
 * Resolve the delivery address an order is placed with.
 *
 * - A saved address (uuid) must belong to the buyer placing the order. Any uuid
 *   used to be accepted, and /api/orders/detail then returned that address row
 *   — another buyer's flat, building and coordinates.
 * - The order keeps a copy (`orders.delivery_address`, migration 071). It only
 *   held the uuid, so editing or deleting a saved address changed or erased the
 *   address of past orders (4 prod orders point at deleted addresses).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AddressSnapshot = {
  id?: string;
  label?: string | null;
  flat?: string | null;
  building?: string | null;
  landmark?: string | null;
  location_name?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type ResolvedAddress =
  | { ok: true; snapshot: AddressSnapshot | null }
  | { ok: false; error: string };

export async function resolveOrderAddress(sb: any, buyerAddr: unknown, buyerId: unknown): Promise<ResolvedAddress> {
  if (!buyerAddr) return { ok: true, snapshot: null };
  const ref = String(buyerAddr);
  if (!UUID_RE.test(ref)) {
    // Legacy free-text address.
    return { ok: true, snapshot: { location_name: ref.slice(0, 300) } };
  }
  if (!buyerId) return { ok: false, error: "Sign in to use a saved address" };
  const { data } = await sb
    .from("buyer_addresses")
    .select("id, label, flat, building, landmark, location_name, lat, lng")
    .eq("id", ref)
    .eq("buyer_id", String(buyerId))
    .maybeSingle();
  if (!data) return { ok: false, error: "Delivery address not found" };
  return {
    ok: true,
    snapshot: { ...data, lat: data.lat != null ? Number(data.lat) : null, lng: data.lng != null ? Number(data.lng) : null },
  };
}

/** Best-effort: store the copy on the created order rows. Tolerates the column not existing yet. */
export async function saveAddressSnapshot(sb: any, orderIds: string[], snapshot: AddressSnapshot | null): Promise<void> {
  if (!snapshot || orderIds.length === 0) return;
  const { error } = await sb.from("orders").update({ delivery_address: snapshot }).in("id", orderIds);
  if (error && error.code !== "42703" && error.code !== "PGRST204") {
    console.error("[order-address] snapshot write failed", { orderIds, err: error.message });
  }
}
