import type { ListingPriceOption } from "./listing-pricing";
import type { PriceUnit } from "./species";

/**
 * Shared UI for seller listing forms: choose **count (piece)** vs **weight (kg)**,
 * then multiple price rows (label + ₹ + optional compare-at). All rows share one unit.
 */
export function setupListingPricingEditor(opts: {
  container: HTMLElement;
  hiddenInput: HTMLInputElement;
  addButton: HTMLElement;
  initial: ListingPriceOption[];
  onUnitChange?: () => void;
}): { sync: () => void; addRow: () => void } {
  const { container, hiddenInput, addButton, initial, onUnitChange } = opts;

  function resolvedUnit(): PriceUnit {
    const basis = container.querySelector(".listing-pricing-basis") as HTMLSelectElement | null;
    if (basis?.value === "weight") return "kg";
    return "piece";
  }

  function updateBundleFieldVisibility() {
    const basis = container.querySelector(".listing-pricing-basis") as HTMLSelectElement | null;
    const show = basis?.value === "count" || basis?.value === "weight";
    container.querySelectorAll(".listing-bundle-wrap").forEach((el) => {
      (el as HTMLElement).style.display = show ? "block" : "none";
    });
  }

  /** Piece: integer ≥ 1. Kg: decimal ≥ 0.01. Labels ask for a concrete count/weight, then ₹. */
  function updateBundleFieldCopy() {
    const ru = resolvedUnit();
    const unitWord = ru === "piece" ? "pieces" : "kg";
    container.querySelectorAll(".pricing-row").forEach((row) => {
      const wrap = row.querySelector(".listing-bundle-wrap") as HTMLElement | null;
      const lab = wrap?.querySelector(".bundle-label-host") as HTMLElement | null;
      const inp = wrap?.querySelector(".bundle-size-inp") as HTMLInputElement | null;
      const hint = row.querySelector(".bundle-hint") as HTMLElement | null;
      const suffix = row.querySelector(".bundle-unit-suffix") as HTMLElement | null;
      if (suffix) suffix.textContent = unitWord;
      if (!wrap || !lab || !inp || !hint) return;
      if (ru === "piece") {
        lab.innerHTML = `How many pieces? <span class="listing-req" aria-hidden="true">*</span>`;
        inp.required = true;
        inp.min = "1";
        inp.step = "1";
        inp.inputMode = "numeric";
        inp.setAttribute("aria-label", "Number of pieces for this price");
        inp.removeAttribute("placeholder");
        hint.innerHTML =
          "Type the count, then selling ₹ → e.g. <strong>3</strong> pieces at <strong>₹150</strong>. Use <strong>1</strong> for price per single piece.";
      } else if (ru === "kg") {
        lab.innerHTML = `How many kg? <span class="listing-req" aria-hidden="true">*</span>`;
        inp.required = true;
        inp.min = "0.01";
        inp.step = "0.01";
        inp.inputMode = "decimal";
        inp.setAttribute("aria-label", "Kilograms for this price");
        inp.removeAttribute("placeholder");
        hint.innerHTML =
          "Type kg, then ₹ → e.g. <strong>1</strong> kg at <strong>₹400</strong>, or <strong>0.5</strong> kg (half kg) at <strong>₹220</strong>.";
      }
    });
  }

  function updateRemoveButtons() {
    const rows = container.querySelectorAll(".pricing-row");
    const n = rows.length;
    rows.forEach((row) => {
      const btn = row.querySelector(".btn-remove-price") as HTMLButtonElement | null;
      if (!btn) return;
      const only = n <= 1;
      btn.disabled = only;
      btn.setAttribute("aria-disabled", only ? "true" : "false");
      btn.title = only ? "At least one price tier is required" : "Remove this price tier";
      btn.style.opacity = only ? "0.45" : "1";
      btn.style.cursor = only ? "not-allowed" : "pointer";
    });
  }

  function syncHidden() {
    const unit = resolvedUnit();
    const rows = container.querySelectorAll(".pricing-row");
    const out: ListingPriceOption[] = [];
    rows.forEach((row, i) => {
      const id = (row as HTMLElement).dataset.optId || `opt_${i}`;
      const label = (row.querySelector(".price-label-inp") as HTMLInputElement)?.value?.trim() || "Option";
      const price = parseFloat((row.querySelector(".price-inp") as HTMLInputElement)?.value || "0");
      const compareRaw = (row.querySelector(".price-compare-inp") as HTMLInputElement)?.value?.trim();
      const compareParsed = compareRaw ? parseFloat(compareRaw) : NaN;
      if (!Number.isFinite(price) || price <= 0) return;
      const rowOut: ListingPriceOption = {
        id,
        label,
        price,
        unit,
      };
      if (unit === "piece") {
        const bsRaw = (row.querySelector(".bundle-size-inp") as HTMLInputElement)?.value?.trim() ?? "";
        let bs = parseInt(bsRaw, 10);
        if (!Number.isFinite(bs) || bs < 1) bs = 1;
        rowOut.bundle_size = Math.floor(bs);
      } else if (unit === "kg") {
        const bsRaw = (row.querySelector(".bundle-size-inp") as HTMLInputElement)?.value?.trim() ?? "";
        let bs = parseFloat(bsRaw);
        if (!Number.isFinite(bs) || bs < 0.01) bs = 1;
        rowOut.bundle_size = Math.round(bs * 100) / 100;
      }
      if (Number.isFinite(compareParsed) && compareParsed >= 1 && compareParsed > price) {
        rowOut.compare_at_price = compareParsed;
      }
      const pmin = parseFloat((row.querySelector(".preorder-min-inp") as HTMLInputElement)?.value || "");
      const pmax = parseFloat((row.querySelector(".preorder-max-inp") as HTMLInputElement)?.value || "");
      if (Number.isFinite(pmin) && pmin > 0) rowOut.preorder_price_min = pmin;
      if (Number.isFinite(pmax) && pmax > 0) rowOut.preorder_price_max = pmax;
      out.push(rowOut);
    });
    hiddenInput.value = JSON.stringify(out);
    updateRemoveButtons();
    updateBundleFieldVisibility();
    updateBundleFieldCopy();
    onUnitChange?.();
  }

  function dealIsAmtMode(wrap: HTMLElement): boolean {
    const checked = wrap.querySelector("input.deal-mode-radio:checked") as HTMLInputElement | null;
    return checked?.value === "amt";
  }

  function computeDealPreview(wrap: HTMLElement): {
    selling: number;
    list: number;
    save: number;
    pctOff: number;
  } | null {
    const compareInp = wrap.querySelector(".price-compare-inp") as HTMLInputElement | null;
    const list = parseFloat(compareInp?.value || "");
    if (!Number.isFinite(list) || list < 1) return null;
    const isAmt = dealIsAmtMode(wrap);
    if (isAmt) {
      const amtInp = wrap.querySelector(".discount-amt-inp") as HTMLInputElement | null;
      const amt = parseFloat(amtInp?.value || "");
      if (!Number.isFinite(amt) || amt <= 0) return null;
      const selling = Math.max(1, Math.round((list - amt) * 100) / 100);
      if (selling >= list) return null;
      const save = Math.round((list - selling) * 100) / 100;
      const pctOff = Math.max(0, Math.round((1 - selling / list) * 100));
      return { selling, list, save, pctOff };
    }
    const pctInp = wrap.querySelector(".discount-pct-inp") as HTMLInputElement | null;
    const pct = parseFloat(pctInp?.value || "");
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;
    const selling = Math.max(1, Math.round((list * (100 - pct)) / 100));
    if (selling >= list) return null;
    const save = Math.round((list - selling) * 100) / 100;
    const pctOff = Math.round((1 - selling / list) * 100);
    return { selling, list, save, pctOff };
  }

  function refreshDealPreviewLine(wrap: HTMLElement) {
    const el = wrap.querySelector(".deal-preview-line") as HTMLElement | null;
    if (!el) return;
    const res = computeDealPreview(wrap);
    const compareInp = wrap.querySelector(".price-compare-inp") as HTMLInputElement | null;
    const listRaw = parseFloat(compareInp?.value || "");
    if (!Number.isFinite(listRaw) || listRaw < 1) {
      el.innerHTML = `<span style="color:var(--gray-500);font-size:11px;">Enter <strong>list ₹</strong> and a discount to preview savings and final price.</span>`;
      return;
    }
    if (!res) {
      el.innerHTML = `<span style="color:var(--gray-500);font-size:11px;">Enter <strong>% off</strong> or <strong>₹ off</strong> (one mode at a time).</span>`;
      return;
    }
    el.innerHTML = `<span style="color:var(--gray-800);">Selling <strong style="color:var(--green);font-size:1.05em;">₹${res.selling}</strong> · Save ₹${res.save} <span style="color:var(--gray-600);">(${res.pctOff}% off list)</span></span>`;
  }

  function wireDealButtons(wrap: HTMLElement) {
    const priceInp = wrap.querySelector(".price-inp") as HTMLInputElement | null;
    const compareInp = wrap.querySelector(".price-compare-inp") as HTMLInputElement | null;
    const pctInp = wrap.querySelector(".discount-pct-inp") as HTMLInputElement | null;
    const amtInp = wrap.querySelector(".discount-amt-inp") as HTMLInputElement | null;

    function toggleDiscountModeRows() {
      const isAmt = dealIsAmtMode(wrap);
      const rPct = wrap.querySelector(".deal-discount-pct-row") as HTMLElement | null;
      const rAmt = wrap.querySelector(".deal-discount-amt-row") as HTMLElement | null;
      if (rPct) rPct.style.display = isAmt ? "none" : "flex";
      if (rAmt) rAmt.style.display = isAmt ? "flex" : "none";
      refreshDealPreviewLine(wrap);
    }

    wrap.querySelectorAll("input.deal-mode-radio").forEach((radio) => {
      radio.addEventListener("change", toggleDiscountModeRows);
    });

    [compareInp, pctInp, amtInp].forEach((inp) => {
      inp?.addEventListener("input", () => refreshDealPreviewLine(wrap));
      inp?.addEventListener("change", () => refreshDealPreviewLine(wrap));
    });

    wrap.querySelector(".btn-apply-deal")?.addEventListener("click", (e) => {
      e.preventDefault();
      const res = computeDealPreview(wrap);
      if (!res || !priceInp) return;
      priceInp.value = String(res.selling);
      syncHidden();
      refreshDealPreviewLine(wrap);
    });

    toggleDiscountModeRows();
  }

  function updatePreorderTierVisibility() {
    const isEnabled = !!(document.getElementById("is_preorder_enabled") as HTMLInputElement | null)?.checked;
    container.querySelectorAll<HTMLElement>(".preorder-price-tier").forEach((el) => {
      el.style.display = isEnabled ? "block" : "none";
    });
  }

  function renderRow(opt: ListingPriceOption) {
    const id = opt.id || `opt_${Date.now()}`;
    const wrap = document.createElement("div");
    wrap.className = "pricing-row";
    wrap.dataset.optId = id;
    const labelEsc = String(opt.label).replace(/</g, "").replace(/"/g, "'");
    const cap = opt.compare_at_price != null && opt.compare_at_price > 0 ? opt.compare_at_price : "";
    const ru = resolvedUnit();
    let bundleInputValue = "1";
    if (ru === "piece") {
      bundleInputValue =
        opt.bundle_size != null && opt.bundle_size >= 1 ? String(Math.floor(Number(opt.bundle_size))) : "1";
    } else if (ru === "kg") {
      const rawKg = opt.bundle_size != null ? Number(opt.bundle_size) : 1;
      const nk = Number.isFinite(rawKg) && rawKg >= 0.01 ? Math.round(rawKg * 100) / 100 : 1;
      bundleInputValue = String(nk);
    }
    const bundleMin = ru === "kg" ? "0.01" : "1";
    const bundleStep = ru === "kg" ? "0.01" : "1";
    const bundleInputMode = ru === "kg" ? "decimal" : "numeric";
    const unitSuffix = ru === "piece" ? "pieces" : "kg";
    wrap.innerHTML = `
      <div class="pricing-row-grid" style="display:grid;grid-template-columns:minmax(72px,1fr) auto minmax(92px,1fr) 36px;gap:6px 8px;align-items:end;margin-bottom:8px;">
        <div class="form-group listing-bundle-wrap" style="margin:0;display:none;">
          <label class="bundle-label-host" style="font-size:12px;line-height:1.25;"></label>
          <input type="number" inputmode="${bundleInputMode}" class="bundle-size-inp" min="${bundleMin}" step="${bundleStep}" style="width:100%;min-width:0;box-sizing:border-box;padding:8px;border:1px solid var(--gray-200);border-radius:8px;" value="${bundleInputValue}" />
        </div>
        <span class="bundle-unit-suffix" style="font-size:13px;font-weight:700;color:var(--gray-800);padding-bottom:10px;white-space:nowrap;align-self:end;">${unitSuffix}</span>
        <div class="form-group" style="margin:0;">
          <label style="font-size:12px;">Selling ₹ <span class="listing-req" aria-hidden="true">*</span></label>
          <input type="number" inputmode="decimal" class="price-inp" min="1" step="0.01" style="width:100%;min-width:0;box-sizing:border-box;padding:8px;border:1px solid var(--gray-200);border-radius:8px;" value="${opt.price > 0 ? opt.price : ""}" required />
        </div>
        <button type="button" class="btn-remove-price" aria-label="Remove this price tier" style="height:40px;border:none;background:var(--gray-100);border-radius:8px;cursor:pointer;align-self:end;">✕</button>
      </div>
      <p class="bundle-hint" style="font-size:11px;color:var(--gray-500);margin:0 0 10px;line-height:1.4;"></p>
      <div class="form-group" style="margin:0 0 8px;">
        <label style="font-size:12px;">Name on menu <span style="font-weight:400;color:var(--gray-500);">(optional)</span></label>
        <input type="text" class="price-label-inp" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--gray-200);border-radius:8px;" value="${labelEsc}" placeholder="e.g. Large, 6‑pc pack, 500 grams tray…" />
      </div>
      <div class="pricing-row-deal" style="margin-top:8px;padding:12px 14px;background:var(--gray-50, #f9fafb);border-radius:10px;border:1px solid var(--gray-200, #e5e7eb);">
        <div style="font-size:12px;font-weight:700;margin-bottom:4px;color:var(--gray-800);">Deal (optional)</div>
        <p style="font-size:11px;color:var(--gray-600);margin:0 0 12px;line-height:1.45;">Choose <strong>one</strong> discount type. Preview updates as you type; one tap fills <strong>Selling ₹</strong> above.</p>
        <div class="form-group" style="margin:0 0 12px;">
          <label style="font-size:12px;">List / compare-at ₹ <span style="font-weight:400;color:var(--gray-500);">(was / MRP on menu)</span></label>
          <input type="number" inputmode="decimal" class="price-compare-inp" min="1" step="0.01" placeholder="e.g. 600" value="${cap !== "" ? cap : ""}" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--gray-200);border-radius:8px;margin-top:4px;" />
        </div>
        <div style="font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:8px;">Discount type</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:10px;font-size:13px;">
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
            <input type="radio" class="deal-mode-radio" name="deal-mode-${id}" value="pct" checked />
            <span>% off list</span>
          </label>
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
            <input type="radio" class="deal-mode-radio" name="deal-mode-${id}" value="amt" />
            <span>Fixed ₹ off list</span>
          </label>
        </div>
        <div class="deal-discount-pct-row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
          <input type="number" inputmode="numeric" class="discount-pct-inp" min="1" max="99" step="1" placeholder="10" style="width:72px;padding:8px;border-radius:8px;border:1px solid var(--gray-200);box-sizing:border-box;" />
          <span style="font-size:12px;color:var(--gray-600);">% taken off the list price</span>
        </div>
        <div class="deal-discount-amt-row" style="display:none;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
          <span style="font-size:13px;font-weight:600;">₹</span>
          <input type="number" inputmode="decimal" class="discount-amt-inp" min="0.01" step="0.01" placeholder="60" style="width:88px;padding:8px;border-radius:8px;border:1px solid var(--gray-200);box-sizing:border-box;" />
          <span style="font-size:12px;color:var(--gray-600);">off the list price</span>
        </div>
        <div class="deal-preview-line" style="min-height:36px;margin-bottom:10px;padding:10px 12px;background:white;border-radius:8px;border:1px solid var(--gray-200);line-height:1.4;"></div>
        <button type="button" class="btn-apply-deal" style="width:100%;padding:11px 14px;border-radius:10px;border:none;background:var(--green);color:white;font-weight:700;cursor:pointer;font-size:13px;">Apply discount → Selling ₹</button>
      </div>
      <div class="preorder-price-tier" style="display:none;margin-top:8px;padding:12px;background:#EEF2FF;border-radius:8px;border:1px solid #C7D2FE;">
        <div style="font-size:12px;font-weight:700;color:#4F46E5;margin-bottom:4px;">🌙 Pre-order price range (this tier)</div>
        <p style="font-size:11px;color:#4338CA;margin:0 0 8px;line-height:1.4;">Buyer pays max price upfront. You set actual price after morning catch. No discount in pre-order.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:11px;font-weight:600;color:#4338CA;display:block;margin-bottom:4px;">Min estimate (₹)</label>
            <input type="number" class="preorder-min-inp" min="1" step="1" placeholder="e.g. 300" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #C7D2FE;border-radius:6px;font-size:13px;" value="${opt.preorder_price_min ?? ""}" />
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:#4338CA;display:block;margin-bottom:4px;">Max estimate (₹)</label>
            <input type="number" class="preorder-max-inp" min="1" step="1" placeholder="e.g. 500" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #C7D2FE;border-radius:6px;font-size:13px;" value="${opt.preorder_price_max ?? ""}" />
          </div>
        </div>
      </div>
    `;
    wrap.querySelector(".btn-remove-price")?.addEventListener("click", () => {
      if (container.querySelectorAll(".pricing-row").length <= 1) return;
      wrap.remove();
      syncHidden();
      syncAddButton();
    });
    wrap.querySelectorAll("input").forEach((el) => {
      el.addEventListener("input", syncHidden);
      el.addEventListener("change", syncHidden);
    });
    wireDealButtons(wrap);
    container.appendChild(wrap);
    updateBundleFieldCopy();
    updatePreorderTierVisibility();
  }

  const modeEl = document.createElement("div");
  modeEl.className = "listing-pricing-mode";
  const u0 = initial[0]?.unit ?? "piece";
  const isWeight = u0 === "kg";
  modeEl.innerHTML = `
    <div style="display:grid;gap:10px;margin-bottom:14px;padding:12px;background:var(--gray-50,#f9fafb);border-radius:10px;border:1px solid var(--gray-200,#e5e7eb);">
      <div class="form-group" style="margin:0;">
        <label for="listing-pricing-basis" style="font-size:12px;font-weight:600;">Sell by</label>
        <select id="listing-pricing-basis" class="listing-pricing-basis" style="width:100%;max-width:100%;padding:8px;border-radius:8px;border:1px solid var(--gray-200);font-size:14px;">
          <option value="count" ${!isWeight ? "selected" : ""}>Count — per piece</option>
          <option value="weight" ${isWeight ? "selected" : ""}>Weight — per kg</option>
        </select>
      </div>
      <p class="listing-pricing-kg-hint" style="margin:0;font-size:11px;color:var(--gray-600);line-height:1.4;display:${isWeight ? "block" : "none"};">Use decimals for less than 1 kg (e.g. <strong>0.5</strong> for half kg). Legacy gram listings load as kg.</p>
    </div>
  `;
  container.prepend(modeEl);

  const basisSel = modeEl.querySelector(".listing-pricing-basis") as HTMLSelectElement;
  const kgHint = modeEl.querySelector(".listing-pricing-kg-hint") as HTMLElement | null;
  basisSel.addEventListener("change", () => {
    if (kgHint) kgHint.style.display = basisSel.value === "weight" ? "block" : "none";
    syncHidden();
    updateBundleFieldVisibility();
    updateBundleFieldCopy();
    onUnitChange?.();
  });
  updateBundleFieldVisibility();
  updateBundleFieldCopy();

  initial.forEach((o) => renderRow(o));
  syncHidden();

  const MAX_TIERS = 3;

  function syncAddButton() {
    const count = container.querySelectorAll(".pricing-row").length;
    const disabled = count >= MAX_TIERS;
    (addButton as HTMLButtonElement).disabled = disabled;
    addButton.setAttribute("aria-disabled", String(disabled));
    addButton.title = disabled ? "Maximum 3 price tiers allowed" : "";
    addButton.style.opacity = disabled ? "0.4" : "";
    addButton.style.cursor = disabled ? "not-allowed" : "";
  }

  function addRow() {
    const count = container.querySelectorAll(".pricing-row").length;
    if (count >= MAX_TIERS) return;
    renderRow({ id: `opt_${Date.now()}`, label: "", price: 0, unit: resolvedUnit() });
    syncHidden();
    syncAddButton();
  }

  addButton.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      addRow();
    },
    { capture: true }
  );

  // Sync button state after initial rows render
  syncAddButton();

  return { sync: syncHidden, addRow };
}
