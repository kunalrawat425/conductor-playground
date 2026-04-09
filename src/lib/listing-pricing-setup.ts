import type { ListingPriceOption } from "./listing-pricing";

/**
 * Shared UI for seller listing forms: multiple price rows with label + ₹ + unit,
 * optional compare-at (list) price and quick % / ₹-off helpers.
 */
export function setupListingPricingEditor(opts: {
  container: HTMLElement;
  hiddenInput: HTMLInputElement;
  addButton: HTMLElement;
  initial: ListingPriceOption[];
  onUnitChange?: () => void;
}): { sync: () => void; addRow: () => void } {
  const { container, hiddenInput, addButton, initial, onUnitChange } = opts;

  function syncHidden() {
    const rows = container.querySelectorAll(".pricing-row");
    const out: ListingPriceOption[] = [];
    rows.forEach((row, i) => {
      const id = (row as HTMLElement).dataset.optId || `opt_${i}`;
      const label = (row.querySelector(".price-label-inp") as HTMLInputElement)?.value?.trim() || "Option";
      const price = parseFloat((row.querySelector(".price-inp") as HTMLInputElement)?.value || "0");
      const unit = (row.querySelector(".price-unit-select") as HTMLSelectElement)?.value || "piece";
      const compareRaw = (row.querySelector(".price-compare-inp") as HTMLInputElement)?.value?.trim();
      const compareParsed = compareRaw ? parseFloat(compareRaw) : NaN;
      if (!Number.isFinite(price) || price <= 0) return;
      const rowOut: ListingPriceOption = {
        id,
        label,
        price,
        unit: unit === "dozen" ? "dozen" : "piece",
      };
      if (Number.isFinite(compareParsed) && compareParsed >= 1 && compareParsed > price) {
        rowOut.compare_at_price = compareParsed;
      }
      out.push(rowOut);
    });
    hiddenInput.value = JSON.stringify(out);
    onUnitChange?.();
  }

  function wireDealButtons(wrap: HTMLElement) {
    const compareInp = wrap.querySelector(".price-compare-inp") as HTMLInputElement | null;
    const priceInp = wrap.querySelector(".price-inp") as HTMLInputElement | null;
    const pctInp = wrap.querySelector(".discount-pct-inp") as HTMLInputElement | null;
    const amtInp = wrap.querySelector(".discount-amt-inp") as HTMLInputElement | null;

    wrap.querySelector(".btn-apply-pct")?.addEventListener("click", (e) => {
      e.preventDefault();
      const list = parseFloat(compareInp?.value || "");
      const pct = parseFloat(pctInp?.value || "");
      if (!priceInp || !Number.isFinite(list) || list < 1) return;
      if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return;
      const selling = Math.max(1, Math.round((list * (100 - pct)) / 100));
      priceInp.value = String(selling);
      syncHidden();
    });

    wrap.querySelector(".btn-apply-amt")?.addEventListener("click", (e) => {
      e.preventDefault();
      const list = parseFloat(compareInp?.value || "");
      const amt = parseFloat(amtInp?.value || "");
      if (!priceInp || !Number.isFinite(list) || list < 1) return;
      if (!Number.isFinite(amt) || amt <= 0) return;
      const selling = Math.max(1, Math.round((list - amt) * 100) / 100);
      priceInp.value = String(selling);
      syncHidden();
    });
  }

  function renderRow(opt: ListingPriceOption) {
    const id = opt.id || `opt_${Date.now()}`;
    const wrap = document.createElement("div");
    wrap.className = "pricing-row";
    wrap.dataset.optId = id;
    const labelEsc = String(opt.label).replace(/</g, "").replace(/"/g, "'");
    const cap = opt.compare_at_price != null && opt.compare_at_price > 0 ? opt.compare_at_price : "";
    wrap.innerHTML = `
      <div class="pricing-row-grid" style="display:grid;grid-template-columns:1fr 100px 110px 36px;gap:8px;align-items:end;margin-bottom:8px;">
        <div class="form-group" style="margin:0;">
          <label style="font-size:12px;">Label</label>
          <input type="text" class="price-label-inp" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--gray-200);border-radius:8px;" value="${labelEsc}" placeholder="Per piece, Large…" />
        </div>
        <div class="form-group" style="margin:0;">
          <label style="font-size:12px;">Selling ₹</label>
          <input type="number" class="price-inp" min="1" step="0.01" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--gray-200);border-radius:8px;" value="${opt.price > 0 ? opt.price : ""}" required />
        </div>
        <div class="form-group" style="margin:0;">
          <label style="font-size:12px;">Unit</label>
          <select class="price-unit-select" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--gray-200);">
            <option value="piece" ${opt.unit === "piece" ? "selected" : ""}>per piece</option>
            <option value="dozen" ${opt.unit === "dozen" ? "selected" : ""}>per dozen</option>
          </select>
        </div>
        <button type="button" class="btn-remove-price" style="height:40px;border:none;background:var(--gray-100);border-radius:8px;cursor:pointer;">✕</button>
      </div>
      <div class="pricing-row-deal" style="margin-top:8px;padding:10px 12px;background:var(--gray-50, #f9fafb);border-radius:8px;border:1px dashed var(--gray-300, #e5e7eb);">
        <div style="font-size:11px;font-weight:600;margin-bottom:8px;color:var(--gray-600, #4b5563);">Deal (optional)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:end;">
          <div class="form-group" style="margin:0;">
            <label style="font-size:11px;">List / compare-at ₹</label>
            <input type="number" class="price-compare-inp" min="1" step="0.01" placeholder="Was / MRP" value="${cap !== "" ? cap : ""}" />
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-size:11px;">Quick: % off list</label>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <input type="number" class="discount-pct-inp" min="1" max="99" step="1" placeholder="%" style="width:52px;padding:6px;border-radius:6px;border:1px solid var(--gray-200);" />
              <button type="button" class="btn-apply-pct" style="font-size:11px;padding:6px 10px;border-radius:6px;border:1px solid var(--blue, #0066cc);background:white;color:var(--blue, #0066cc);cursor:pointer;font-weight:600;">Apply</button>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
          <span style="font-size:11px;color:var(--gray-500);">₹ off from list:</span>
          <input type="number" class="discount-amt-inp" min="1" step="1" placeholder="Amount" style="width:80px;padding:6px;border-radius:6px;border:1px solid var(--gray-200);" />
          <button type="button" class="btn-apply-amt" style="font-size:11px;padding:6px 10px;border-radius:6px;border:1px solid var(--blue, #0066cc);background:white;color:var(--blue, #0066cc);cursor:pointer;font-weight:600;">Apply</button>
        </div>
        <p style="font-size:10px;color:var(--gray-500);margin:10px 0 0;line-height:1.35;">Set <strong>compare-at</strong> above the selling price to show strikethrough and “% off” on the menu. Use <strong>Quick</strong> after entering list ₹.</p>
      </div>
    `;
    wrap.querySelector(".btn-remove-price")?.addEventListener("click", () => {
      if (container.querySelectorAll(".pricing-row").length <= 1) return;
      wrap.remove();
      syncHidden();
    });
    wrap.querySelectorAll("input, select").forEach((el) => {
      el.addEventListener("input", syncHidden);
      el.addEventListener("change", syncHidden);
    });
    wireDealButtons(wrap);
    container.appendChild(wrap);
  }

  initial.forEach((o) => renderRow(o));
  syncHidden();

  function addRow() {
    renderRow({ id: `opt_${Date.now()}`, label: "", price: 0, unit: "piece" });
    syncHidden();
  }

  addButton.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      addRow();
    },
    { capture: true }
  );

  return { sync: syncHidden, addRow };
}
