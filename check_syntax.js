function withCart(fn) {
  if (window.RelifishCart) return fn(window.RelifishCart);
  document.addEventListener("v2-cart-ready", () => fn(window.RelifishCart), { once: true });
}

const grid = document.getElementById("v2-menu-grid");
const cartMount = document.getElementById("v2-cart-bar-mount");
if (grid && listings) {
  function Cart() { return window.RelifishCart; }

  function getSellerItems() {
    const c = Cart();
    if (!c) return {};
    const cart = c.getCart();
    const out = {};
    for (const lid of Object.keys(cart)) {
      if (cart[lid].seller_id === sellerId) out[lid] = cart[lid];
    }
    return out;
  }
// I will just dump the entire script content using awk
