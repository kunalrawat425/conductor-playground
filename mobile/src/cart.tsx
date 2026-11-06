import { createContext, useContext, useState, type ReactNode } from "react";

/** One seller per checkout, like the website. A line is one pack size of one fish. */
export type CartLine = { listing_id: string; species: string; option_id: string; option_label: string; unit: string; bundle: number; price: number; packs: number };
type Cart = { seller: { id: string; name: string } | null; lines: CartLine[] };
type Ctx = Cart & {
  setPacks: (seller: { id: string; name: string }, line: Omit<CartLine, "packs">, packs: number) => void;
  clear: () => void;
  total: number;
};
const CartCtx = createContext<Ctx | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>({ seller: null, lines: [] });
  const setPacks: Ctx["setPacks"] = (seller, line, packs) => setCart((c) => {
    // Another seller: start a new cart (one seller per order).
    const lines = c.seller?.id === seller.id ? c.lines : [];
    const rest = lines.filter((l) => !(l.listing_id === line.listing_id && l.option_id === line.option_id));
    const next = packs > 0 ? [...rest, { ...line, packs }] : rest;
    return { seller: next.length ? seller : null, lines: next };
  });
  const total = cart.lines.reduce((s, l) => s + l.price * l.packs, 0);
  return <CartCtx.Provider value={{ ...cart, setPacks, clear: () => setCart({ seller: null, lines: [] }), total }}>{children}</CartCtx.Provider>;
}
export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
