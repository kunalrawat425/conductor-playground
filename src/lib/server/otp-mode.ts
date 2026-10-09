/**
 * The fixed "123456" dev OTP is allowed only in local dev, or on a deploy that
 * opts in explicitly with ALLOW_DEV_OTP=true (staging QA). Never set it on
 * production: before this, a missing MSG91 env var silently enabled it there.
 */
export function otpDevBypassAllowed(): boolean {
  if (import.meta.env.DEV) return true;
  return (import.meta.env.ALLOW_DEV_OTP || process.env.ALLOW_DEV_OTP) === "true";
}
