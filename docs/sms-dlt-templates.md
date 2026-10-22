# Order SMS: DLT templates (MSG91)

Buyers get an SMS when a **delivery** order is confirmed, goes out for delivery, and is delivered.
Code: `src/lib/server/sms.ts` (`ORDER_SMS_TEMPLATES` must match the texts below exactly).

## Register on the DLT portal

- Header (sender ID): `RELFSH`
- Category / type: **Service Implicit** (transactional)
- Each `{#var#}` is at most 30 characters. The app sends plain ASCII only (no ₹, no en dash), so each SMS is one segment.
- The tracking URL `https://www.relifish.com/track` is fixed text in the template. Whitelist it
  (URL whitelisting) on the DLT portal **and** in MSG91, or operators block the SMS.
  A per-order link (`/track/<order id>`) does not fit: the order id alone is 36 characters, over the 30-character variable limit.

| # | Name | Template text | Variables |
|---|------|---------------|-----------|
| 1 | Order confirmed | `Relifish: Your order {#var#} for {#var#} is confirmed. Delivery: {#var#}. Track: https://www.relifish.com/track` | order no. (`#AB12CD34`), fish (`Rohu + 2 more`), slot (`Sat 25 Oct, 9-11 AM`; no slot: `Sat 25 Oct morning` for a pre-order, `today` for same day) |
| 2 | Out for delivery | `Relifish: Your order {#var#} is out for delivery, arriving by {#var#}. Track: https://www.relifish.com/track` | order no., arriving-by time (`11 AM`; no slot: `today`) |
| 3 | Delivered | `Relifish: Your order {#var#} has been delivered. Enjoy your fish! Track: https://www.relifish.com/track` | order no. |

Longest filled-in message (template 1, 30-character fish and slot) is under 160 characters
(checked in `tests/lib/sms.test.ts`).

## Set up in MSG91

1. After DLT approval, create one **Flow** per template in MSG91 (SMS → Flow), paste the approved
   text, and replace each `{#var#}` with `##var1##`, `##var2##`, `##var3##` in order. Set the DLT template id.
2. Copy each flow id into Vercel (Production and Preview) env vars:
   - `MSG91_FLOW_ORDER_CONFIRMED`
   - `MSG91_FLOW_OUT_FOR_DELIVERY`
   - `MSG91_FLOW_DELIVERED`
3. `MSG91_AUTH_KEY`, `MSG91_SENDER_ID` (`RELFSH`) and `PUBLIC_ENABLE_MSG91=true` are the same ones the login OTP uses.

Nothing is sent (a **dry run**: the exact MSG91 request body is logged as `[sms] DRY RUN`, phone
masked, no authkey) when `SMS_DRY_RUN=true`, `PUBLIC_ENABLE_MSG91` is not `true`, the flow id is
not set, or the order is a test order (QA seller or test buyer, `orders.is_test`). Pickup orders get
no SMS. The status change always goes through.
