import { checkCancelReason, CANCEL_REASON_MAX } from "./order-cancel";

/**
 * Asks for the cancel / decline reason in a modal with a textarea (5–200 characters,
 * required). Resolves the trimmed reason, or null when the person backs out.
 */
export function askCancelReason(opts: {
  title: string;
  note?: string;
  label: string;
  confirmText: string;
}): Promise<string | null> {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const dlg = document.createElement("dialog");
  dlg.className = "rlf-reason-dialog";
  dlg.style.cssText = "width:min(92vw,420px);border:0;border-radius:16px;padding:18px;box-sizing:border-box;background:var(--v2-bg,#fff);color:var(--v2-ink,#0f172a);";
  dlg.innerHTML = `
    <form method="dialog" style="display:flex;flex-direction:column;gap:10px;margin:0;">
      <div style="font:800 16px Inter;">${esc(opts.title)}</div>
      ${opts.note ? `<div style="font:500 13px Inter;color:var(--v2-ink-2,#475569);">${esc(opts.note)}</div>` : ""}
      <label for="rlf-reason-text" style="font:700 13px Inter;">${esc(opts.label)}</label>
      <textarea id="rlf-reason-text" rows="3" maxlength="${CANCEL_REASON_MAX}" placeholder="Write a short reason" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid var(--v2-border,#e2e8f0);border-radius:10px;font:400 14px Inter;color:inherit;background:inherit;resize:vertical;"></textarea>
      <div style="display:flex;justify-content:space-between;gap:8px;font:500 12px Inter;">
        <span data-err role="alert" style="color:var(--v2-red,#dc2626);"></span>
        <span data-count style="color:var(--v2-ink-3,#94a3b8);white-space:nowrap;">0/${CANCEL_REASON_MAX}</span>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" data-back style="flex:1;padding:12px;border-radius:10px;border:1px solid var(--v2-border,#e2e8f0);background:var(--v2-bg,#fff);color:inherit;font:700 13px Inter;cursor:pointer;">Go back</button>
        <button type="submit" style="flex:1.4;padding:12px;border-radius:10px;border:0;background:var(--v2-red,#dc2626);color:#fff;font:700 13px Inter;cursor:pointer;">${esc(opts.confirmText)}</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const text = dlg.querySelector("textarea")!;
  const err = dlg.querySelector<HTMLElement>("[data-err]")!;
  const count = dlg.querySelector<HTMLElement>("[data-count]")!;
  const sync = () => { count.textContent = `${text.value.length}/${CANCEL_REASON_MAX}`; err.textContent = ""; };
  text.addEventListener("input", sync);

  return new Promise((resolve) => {
    let result: string | null = null;
    dlg.querySelector("form")!.addEventListener("submit", (e) => {
      const r = checkCancelReason(text.value);
      if (!r.ok) { e.preventDefault(); err.textContent = r.error; text.focus(); return; }
      result = r.reason;
    });
    dlg.querySelector("[data-back]")!.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
    dlg.showModal();
  });
}
