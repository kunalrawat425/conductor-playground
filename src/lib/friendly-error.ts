/**
 * The message a buyer or seller sees when something fails: the server's own plain sentence
 * when it is one, else `fallback`. Technical text (error codes, HTTP statuses, Postgres /
 * PostgREST / Supabase errors, fetch / JSON failures, stack traces, "undefined"/"null")
 * never reaches the screen; the call site keeps it in console.warn.
 */
const TECHNICAL = new RegExp(
  [
    "\\b[a-z]+_[a-z0-9_]+\\b", // snake_case codes / columns: slot_unavailable, final_price
    "\\bPGRST\\w*", // PostgREST codes
    "duplicate key", "violates", "constraint", "\\brelation\\b", "\\bcolumn\\b", "syntax", "\\buuid\\b", "\\brpc\\b",
    "supabase", "postgres", "razorpay \\d{3}",
    "\\bjson\\b", "unexpected token", "unexpected end", "is not a function", "cannot read prop", "typeerror", "referenceerror",
    "\\bundefined\\b", "\\bnull\\b", "\\bNaN\\b", "\\[object", "\\bat \\S+ \\(", "stack",
    // HTTP statuses ("HTTP 500", "error 404", a bare "400"), not amounts like "₹400".
    "\\bhttp\\b", "status code", "\\b(error|status|code)\\W{0,3}[45]\\d\\d\\b", "\\bmsg91\\b", "^\\s*[45]\\d\\d\\b", "internal server error", "econn", "etimedout", "\\bfetch\\b", "networkerror", "load failed", "aborted",
  ].join("|"),
  "i"
);
const NETWORK = /failed to fetch|networkerror|load failed|network request failed|econn|etimedout|aborted/i;

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const NETWORK_ERROR = "Check your internet connection and try again.";

export function friendlyError(err: unknown, fallback = GENERIC_ERROR): string {
  const raw =
    typeof err === "string" ? err
    : err && typeof err === "object" ? String((err as any).message ?? (err as any).error ?? "")
    : "";
  const msg = raw.trim();
  if (!msg) return fallback;
  if (NETWORK.test(msg)) return NETWORK_ERROR;
  if (msg.length > 160 || TECHNICAL.test(msg)) return fallback;
  return msg;
}
