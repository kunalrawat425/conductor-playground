# Staging end-to-end (real Razorpay TEST payments)

Secrets live in `.context/staging.env` (gitignored): `PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET` (test mode), `SUPABASE_ACCESS_TOKEN`, `CRON_SECRET`, `ADMIN_SECRET`.
Staging buyer/seller log in with the dev OTP `123456` (`ALLOW_DEV_OTP=true` on Preview only).

```
npm i --no-save playwright && npx playwright install chromium
export BASE=https://stage.relifish.store        # or a preview URL
node scripts/e2e-staging/pay.mjs <order_id> <buyer_id> <phone> success|failure   # Netbanking mock bank
METHOD=card node scripts/e2e-staging/pay.mjs ...                                   # card + test OTP
BLOCK_VERIFY=1 node ...pay.mjs ...            # browser "dies": only the webhook can confirm
CANCEL_AFTER_OPEN=1 node ...pay.mjs ...       # buyer cancels with checkout open, then pays
node scripts/e2e-staging/seller.mjs <order_id> ready_for_pickup price=2 completed
node scripts/e2e-staging/webhook.mjs payment.captured <razorpay_order_id>         # signed, from the real payment
```
Verify every step in the DB: `orders`, `razorpay_payments` (ledger), `order_events` (history), `fish_listings.weight_avail`.
