type SpinnerKind = "on-dark" | "neutral" | "textlink" | "bell";

function spinnerHtml(kind: SpinnerKind): string {
  const cls =
    kind === "on-dark"
      ? "btn-spinner btn-spinner--on-dark"
      : kind === "bell"
        ? "btn-spinner btn-spinner--bell"
        : kind === "textlink"
          ? "btn-spinner btn-spinner--textlink"
          : "btn-spinner";
  return `<span class="${cls}" aria-hidden="true"></span>`;
}

/** Full-width / primary actions: show only a centered spinner while loading. */
export function setButtonLoading(
  btn: HTMLButtonElement,
  loading: boolean,
  idleLabel: string,
  kind: SpinnerKind = "on-dark"
): void {
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = spinnerHtml(kind);
    btn.setAttribute("aria-busy", "true");
  } else {
    btn.disabled = false;
    btn.textContent = idleLabel;
    btn.removeAttribute("aria-busy");
  }
}

/** Seller/buyer notification bell: spinner replaces emoji while loading. */
export function setBellLoading(btn: HTMLButtonElement, loading: boolean, bellEmoji: string): void {
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = spinnerHtml("bell");
    btn.setAttribute("aria-busy", "true");
  } else {
    btn.disabled = false;
    btn.textContent = bellEmoji;
    btn.removeAttribute("aria-busy");
  }
}
