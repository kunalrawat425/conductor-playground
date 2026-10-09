/** Escape text for HTML text and attribute contexts. */
export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * JSON for a <script type="application/ld+json"> body. JSON.stringify does not
 * escape "<", so a seller-controlled species or name containing "</script>"
 * broke out of the tag and ran script on every visitor's page.
 */
export function jsonLdString(data: unknown): string {
  return (typeof data === "string" ? data : JSON.stringify(data))
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
