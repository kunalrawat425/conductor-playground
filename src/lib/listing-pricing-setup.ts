import type { ListingPriceOption } from "./listing-pricing";

/**
 * Shared UI for seller listing forms: multiple price rows with label + ₹ + unit.
 */
export function setupListingPricingEditor(opts: {
  container: HTMLElement;
  hiddenInput: HTMLInputElement;
  addButton: HTMLElement;
  initial: ListingPriceOption[];
  onUnitChange?: () => void;
}): { sync: () => void } {
  const { container, hiddenInput, addButton, initial, onUnitChange } = opts;

  function syncHidden() {
    const rows = container.querySelectorAll(".pricing-row");
    const out: ListingPriceOption[] = [];
    rows.forEach((row, i) => {
      const id = (row as HTMLElement).dataset.optId || `opt_${i}`;
      const label = (row.querySelector(".price-label-inp") as HTMLInputElement)?.value?.trim() || "Option";
      const price = parseFloat((row.querySelector(".price-inp") as HTMLInputElement)?.value || "0");
      const unit = (row.querySelector(".price-unit-select") as HTMLSelectElement)?.value || "piece";
      if (!Number.isFinite(price) || price <= 0) return;
      out.push({
        id,
        label,
        price,
        unit: unit === "dozen" ? "dozen" : "piece",
      });
    });
    hiddenInput.value = JSON.stringify(out);
    onUnitChange?.();
  }

  function renderRow(opt: ListingPriceOption) {
    const id = opt.id || `opt_${Date.now()}`;
    const wrap = document.createElement("div");
    wrap.className = "pricing-row";
    wrap.dataset.optId = id;
    const labelEsc = String(opt.label).replace(/</g, "").replace(/"/g, "'");
    wrap.innerHTML = `
      <div class="pricing-row-grid" style="display:grid;grid-template-columns:1fr 100px 110px 36px;gap:8px;align-items:end;margin-bottom:8px;">
        <div class="form-group" style="margin:0;">
          <label style="font-size:12px;">Label</label>
          <input type="text" class="price-label-inp" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--gray-200);border-radius:8px;" value="${labelEsc}" placeholder="Per piece, Large…" />
        </div>
        <div class="form-group" style="margin:0;">
          <label style="font-size:12px;">₹</label>
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
    container.appendChild(wrap);
  }

  initial.forEach((o) => renderRow(o));
  syncHidden();

  addButton.addEventListener("click", () => {
    renderRow({ id: `opt_${Date.now()}`, label: "", price: 0, unit: "piece" });
    syncHidden();
  });

  return { sync: syncHidden };
}
