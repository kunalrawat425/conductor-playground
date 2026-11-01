# Buyer messages: tone audit (1 Nov 2026)

The founder's rule: every message a buyer gets should read like a gentle, friendly reminder that says what
happens next. It should never push, give an order, or read like a bill ("not paid yet" and "pay now" are banned).

Checks used on every message:

- **pushy / command**: "pay now", "complete payment", "place it now", "hurry".
- **dues**: reads like a bill ("payment not completed", "waiting for payment", "payment needed").
- **seller promo**: a seller's name shown to the buyer. Only allowed in the buyer's own order details, and kept short there.
- **local**: sellers are "verified sellers", never "local".
- **tracking**: there is no live tracking. Point to "Your orders" (https://www.relifish.com/orders) instead.
- **no next step**: the message doesn't say what happens next or who to ask.
- **emoji / price / discount**: at most one emoji. No prices or discount words in promos.

Support line: "WhatsApp or call us on 9152207607" (a real person replies).

What the "Can change" column means:

- **Code now**: changed in this PR.
- **Re-approval**: needs Meta or DLT approval first. Those are drafted below and not sent.

---

## 1. Email (code now: changed in this PR)

Subjects and preview lines come from `src/lib/email-subjects.ts`. The bodies come from
`src/lib/email-templates.ts`, plus the small shell in `src/lib/server/notify-order-parties.ts`.

| # | When | Current | Problems | New (shipped) |
|---|---|---|---|---|
| E1 | Order created, not paid yet (`orders/create`, `create-seller-cart`). Badge + subject + intro | Badge/subject "Order placed — complete payment to confirm — Surmai"; intro "Your order status has changed. You can track every step in the app with live updates."; button "Track Order →" (/track) | command, dues, tracking | Badge/subject "Your order is almost done — Surmai"; intro "Your order is saved. The payment is the last step to confirm it for your slot, and you can finish it from Your orders. Stuck anywhere? WhatsApp or call us on 9152207607, a real person replies."; button "See your orders →" (/orders) |
| E1b | Same, pickup scheduled | "Pickup scheduled — complete payment to confirm 🗓️" | command, dues | "Pickup scheduled, almost done 🗓️" + same intro |
| E2 | Any other order update email: confirmed, out for delivery, delivered, item removed (`orderEmailBuyer`) | intro "Your order status has changed. You can track every step in the app with live updates."; "Track Order →" | tracking, no next step | "Here's the latest on your order. You can see it any time in Your orders. Questions? WhatsApp or call us on 9152207607."; "See your orders →" (/orders) |
| E3 | Payment receipt (`razorpay-verify`, `razorpayReceiptEmail`) | Heading "Your order is confirmed" (wrong: the seller hasn't confirmed yet); "Here's your receipt. Track your order in the app for live updates."; "Track Order →" | tracking; promises a confirmation that hasn't happened | "Payment received, thank you"; "Here's your receipt. Your order is confirmed next, and we'll let you know as soon as it is. You can see it any time in Your orders."; "See your order →" |
| E3s | Receipt subject/preview ("placed") | Preview: "Payment received for your Surmai. Fishtokri confirms it within 2 hours." | seller promo | "Payment received for your Surmai, thank you. It's usually confirmed within 2 hours, and we'll let you know." Evening pre-order: "…Pre-orders are confirmed by 9:30 AM, and we'll let you know." |
| E4 | Paid through the webhook path (`notifyOrderParties` payment_confirmed) | "Payment received" / "We received your payment (₹X) for surmai (order #ID). Your order will be confirmed shortly." | no next step / help | "Payment received, thank you" / "We received your payment (₹X) for your surmai (order #ID). We'll let you know as soon as it's confirmed. Any special request for the cut? WhatsApp or call us on 9152207607." |
| E5 | Seller cancelled | Heading "Order cancelled"; "Your surmai order #ID couldn't be fulfilled and is cancelled. Reason… Refund…"; preview "Sorry! Nothing was charged." | no next step | Heading "Sorry, your order couldn't go ahead"; "Sorry, your surmai order #ID couldn't go ahead. Reason… Refund… Want another fish or a different slot? WhatsApp or call us on 9152207607, we'll help you right away."; preview "Sorry! ₹X refunded. / No payment was taken. We can help you pick another fish or slot." |
| E6 | Buyer cancelled | "You cancelled your order" / "Your surmai order #ID is cancelled. …" | no next step | "Your order is cancelled" / "…is cancelled, as you asked. Reason… Refund… Whenever you'd like fish again, the menu is open. Questions? WhatsApp or call us on 9152207607."; preview "No payment was taken." when unpaid |
| E7 | Unpaid order expired (nightly cron, 24 h) | Subject "Your Relifish order wasn't completed"; preview "Payment didn't go through. Order again in 2 taps."; "Order cancelled" / "…was cancelled because payment was not completed in time. Nothing has been charged. You can order again any time." | dues; reads like a telling-off | Subject "Your Relifish order didn't go through"; preview "No payment was taken. Got stuck? WhatsApp or call us on 9152207607."; "Your order didn't go through" / "Your surmai order #ID didn't go through, so it's now closed and no payment was taken. Got stuck anywhere? WhatsApp or call us on 9152207607, we'll sort it out. Whenever you'd like, the menu is open for your next order." |
| E8 | Refund processed | "…It should reach your account in 5–7 working days." | no help line | same + " Questions? WhatsApp or call us on 9152207607." |
| E9 | Out for delivery preview | "Should reach you by 2 PM. Keep your phone close." | curt command | "Should reach you by 2 PM. Please keep your phone close for the delivery person." |
| E10 | One item removed from a cart (seller/orders) | Subject "Surmai was removed from your order #ID — ₹120 refunded" | abrupt | "Sorry, Surmai was removed from your order #ID — ₹120 refunded" |
| E11 | Every `notifyOrderParties` email footer | "Need help? Message us on WhatsApp · email" | no phone, no real-person promise | "Need help? WhatsApp or call us on 9152207607, a real person replies · email" |
| E12 | Waitlist welcome (`waitlist/join`) | "You order first — with exclusive launch discounts"; perks box "Launch discounts from sellers / Introductory prices / …" (🏷️ ✅✅✅✅ 💬) | discount words, prices, too many emojis | Step 3: "You get first access to order, including early pre-orders for the next morning's catch". Perks box and emojis removed. "Questions? WhatsApp or call us on 9152207607, a real person replies." |
| E13 | Verify email | "Verify your email…" | fine | unchanged |
| E14 | Confirmed / delivered subjects + previews | "Your Relifish order is confirmed", "…delivered, on time!" + "How was it?" | fine | unchanged |
| E15 | Pre-order placed email (`preorderPlacedLabel`, intro) | "Pre-order placed — catch reserved for today"; "…you will only be charged up to the max estimate shown." | fine | unchanged |

Left as they were in the receipt: the seller block (name and pickup location). It is the buyer's own order
details, and pickup needs the location.

## 2. Web push (code now: changed in this PR)

These live in `src/lib/server/buyer-order-push-copy.ts`.

| # | Status | Current | Problems | New (shipped) |
|---|---|---|---|---|
| P1 | placed | "Order placed" / "Tap to pay securely and confirm your surmai order." | command | "Your order is almost done" / "Your surmai order is saved. The payment is the last step to confirm it for your slot. Stuck? WhatsApp us on 9152207607." |
| P2 | pending_payment | "Payment pending" / "Your surmai order is waiting for payment. Tap to complete it." | dues, command | same as P1 |
| P3 | payment_required (balance after final price) | "Payment needed" / "Complete payment for your surmai order" | dues, command | "Your order's final price is in" / "The final price of your surmai order came out a little higher. Tap to see it. Questions? WhatsApp us on 9152207607." |
| P4 | expired_unpaid | "Order cancelled" / "…was cancelled — payment wasn't completed. You haven't been charged." | dues | "Your order didn't go through" / "No payment was taken for your surmai order. Got stuck? WhatsApp us on 9152207607, we'll sort it out." |
| P5 | cancelled by the seller | "Order cancelled" / "Your surmai order couldn't be fulfilled and is cancelled. Reason… refund" | no next step | "Order cancelled" / "Sorry, your surmai order couldn't go ahead. Reason… refund… Want another fish or slot? WhatsApp us on 9152207607." |
| P6 | cancelled (no details) | "Order Cancelled" / "…was cancelled. Full refund processing." | no help | "Order cancelled" / "…was cancelled. Any payment is refunded in full. Questions? WhatsApp us on 9152207607." |
| P7 | declined | "Sorry, your surmai order was declined" | no next step | "Sorry, your surmai order couldn't go ahead. Want another fish or slot? WhatsApp us on 9152207607." |
| P8 | paid | "Payment received" / "We got your payment for surmai. Waiting for confirmation." | flat | "Payment received, thank you" / "We got your payment for your surmai order. We'll let you know as soon as it's confirmed." |
| P9 | completed | "Order completed" / "Your surmai order is complete. Thanks!" | no next step | "Delivered!" / "Hope you enjoy your surmai. Tap to tell us how it was." |
| P10 | refunded | "A refund was processed for your surmai order" | no timing | "…order. It reaches your account in 5–7 working days." |
| — | confirmed, out_for_delivery, picked_up, scheduled, item removed, buyer cancel | — | fine | unchanged |

## 3. On-site copy (code now: changed in this PR)

| # | Where | Current | Problems | New (shipped) |
|---|---|---|---|---|
| S1 | /me order list, status pill | "Pay now" / "Pay balance" | command, dues | "Almost done" / "Final price is in" |
| S2 | /me order list, card link | "Complete payment →" / "Track →" | command, tracking | "Finish my order →" / "View →" |
| S3 | /track/[id] status heading | "Complete payment" / "Additional payment needed" | command, dues | "Almost done" / "Final price is in" |
| S4 | /track/[id] pre-order box | "Pay now to place your pre-order." | command | "Your pre-order is placed once the payment goes through." |
| S5 | /track/[id] Razorpay card | "💳 Complete payment" / "Pay securely via Razorpay (UPI, cards, netbanking). Your order confirms instantly." | command; "confirms instantly" isn't true (the seller confirms) | "💳 One last step: the payment" / "Pay securely via Razorpay (UPI, cards, netbanking), and we'll let you know as soon as your order is confirmed. Stuck? WhatsApp or call us on 9152207607." |
| S6 | Login modal | "Track your order status and get notifications" | tracking | "See your orders and get updates" |

Searched and left alone:

- The "Pay ₹X →" button. It is the payment button itself, not a nudge.
- The neutral "Payment pending" tag on /track and OrderCard.
- The nav and footer "Track order" links on the homepage, Footer.astro and /track's meta description. They are page names and SEO text (homepage SEO content stays as it is). Rename them separately if the founder wants.
- The "sold out before checkout" error state. It is factual.

No "hurry", "only X left" or "last chance" wording turned up in buyer pages.

## 4. SMS (DLT-approved, reference only, not changed)

These are in `src/lib/server/sms.ts` `SMS_TEXT`. They are the model for the tone.

- SIGNUP: "Hi {#var#}, your Relifish account is ready. Fresh fish from {#var#}, cleaned and cut, delivered home. Not sure what to pick? WhatsApp or call us on 9152207607, a real person replies. Menu: https://www.relifish.com/shop - Relifish" (var2 is sent as "a verified seller near you")
- CART: "Hi {#var#}, your Relifish order for {#var#} is not placed yet. Stuck anywhere? WhatsApp or call us on 9152207607, we will sort it out. Menu: https://www.relifish.com/shop - Relifish"
- UNPAID: "Hi {#var#}, your Relifish order for {#var#} is almost done. The payment is pending for your delivery slot {#var#}. Stuck anywhere? WhatsApp or call us on 9152207607, we will sort it out. Your orders: https://www.relifish.com/orders - Relifish"
- CONFIRMED: "Hi {#var#}, your Relifish order {#var#} is confirmed and will reach you {#var#}, cleaned and cut. We will text you when it is on the way. Questions? WhatsApp or call us on 9152207607. - Relifish"
- OUT: "Your Relifish order {#var#} is on the way and should reach you {#var#}. Please keep your phone close for the delivery person. Anything urgent? Call us on 9152207607. - Relifish"
- CANCELLED: "Sorry {#var#}, your Relifish order {#var#} could not go ahead: {#var#}. Your refund of {#var#} will reach your account in 5-7 working days. Want another fish or slot? WhatsApp or call us on 9152207607. - Relifish"
- CANCELLED_NOPAY: "Sorry {#var#}, your Relifish order {#var#} could not go ahead: {#var#}. No payment was taken. Want another fish or slot? WhatsApp or call us on 9152207607. - Relifish"
- OTP (approved): "{code} is your Relifish login OTP. It is valid for 10 minutes. Do not share it with anyone. Fresh fish near you: https://www.relifish.com/shop - Relifish"

Still off:

- **PAID** ("Payment received for your Relifish order {#var#} from {#var#}. Delivery: {#var#}. Track: https://www.relifish.com/track - Relifish") names the seller and uses tracking wording.
- **DELIVERED** ("…Rate it: https://www.relifish.com/track") also points at /track.

Neither is sent today. Before either is used, register new DLT texts, for example:

- PAID: "Payment received for your Relifish order {#var#}, thank you. Delivery: {#var#}. We will text you when it is confirmed. Questions? WhatsApp or call us on 9152207607. - Relifish"
- DELIVERED: "Your Relifish order {#var#} is delivered. Hope you enjoy the {#var#}! Tell us how it was: https://www.relifish.com/orders - Relifish"

## 5. WhatsApp (Meta-approved rf2_*: not edited)

The approved rf2 entries in `src/lib/messaging/templates.ts` are unchanged. Gentle v3 drafts are added as
`DRAFT_TEMPLATES` in the same file. They are kept out of `TEMPLATES`, so `scripts/wa-setup.ts` never submits them
and no sender uses them. A test checks them against Meta's rules and the brand rules (`tests/lib/whatsapp-engine.test.ts`).

**Before wiring any draft in:**

- Several drafts drop the seller variable, so the sender's variables change. `orderMessage` in
  `notify-order-whatsapp.ts` and the promo builders in `messaging/schedule.ts` need updating.
- For rf3_cart_swap and the catch drafts, the senders must stop passing prices in `{{3}}`.

| Approved | Problems | Draft |
|---|---|---|
| rf2_welcome | "a local seller near {{2}}" (sent as "near you"); "Your fish person"; 2 emojis; "We've got Thane covered" | rf3_welcome |
| rf2_welcome_search | "Today's prices are live" (price talk in a promo); 2 emojis; button "See today's prices" | rf3_welcome_search |
| rf2_cart_today | seller name {{3}}; "Place it now"; 2 emojis | rf3_cart_today |
| rf2_cart_preorder | seller name {{3}}; "Pre-order tonight" (command); 2 emojis | rf3_cart_preorder |
| rf2_promo_cart | seller name {{4}}; "Place it now"; 2 emojis | rf3_promo_cart |
| rf2_promo_unpaid | "Finish the payment to confirm it" (command, dues) | rf3_promo_unpaid |
| rf2_order_again | seller name {{3}}; 2 emojis | rf3_order_again |
| rf2_cart_swap | "{{3}}'s menu" (seller name); price in {{4}}; 2 emojis | rf3_cart_swap |
| rf2_weekend | "Sellers near…" without "verified"; 3 emojis | rf3_weekend |
| rf2_catch_preorder | prices in {{3}} | rf3_catch_preorder |
| rf2_catch_prices | prices in {{3}}; "Prices are fixed by the seller" | rf3_catch_today |
| rf2_unpaid | "the payment hasn't gone through yet. Tap below to pay" (dues, command); button "Pay & confirm my slot" | rf3_unpaid |
| rf2_paid / _evening / _fast | seller name; "Track my order" button; 2 emojis (_fast) | rf3_paid / rf3_paid_evening / rf3_paid_fast |
| rf2_confirmed | seller name {{1}}; "Track my order"; 2 emojis | rf3_confirmed |
| rf2_out | "Track my delivery" button | rf3_out |
| rf2_delivered | seller name {{3}}; 2 emojis | rf3_delivered |
| rf2_cancelled | "from another seller"; button "Find the same fish"; 2 emojis | rf3_cancelled |
| rf2_login_otp | see below | no draft |

Full draft texts. All promos have the footer "Reply STOP to stop offers". Buttons are listed as URL / quick reply.

- **rf3_welcome** (MARKETING, image): "Hi {{1}}, welcome to Relifish! 🐟 Fresh fish from verified sellers near {{2}}, cleaned and cut your way and brought to your door.\nThe next delivery slot is {{3}}, and today's catch is in the store whenever you'd like a look.\nNot sure what to pick? Just reply here, a real person replies." Buttons: See today's fish / Help me choose
- **rf3_welcome_search** (MARKETING, image): "Hi {{1}}, good to have you on Relifish! 🐟 Verified sellers near {{2}} have the morning's catch up in the store, and you see the size and cut before you order.\nThe next slot is {{3}}.\nLooking for something you don't see? Just reply here and we'll check for you." Buttons: See today's fish / Ask about a fish
- **rf3_cart_today** (MARKETING, image): "Hi {{1}}, your {{2}} is still in your cart 🛒\nIf you'd like it, it can reach you {{3}}, cleaned and cut your way.\nAny special cut or question? Just reply here, or call us on 9152207607." Buttons: See my cart / I have a question
- **rf3_cart_preorder** (MARKETING, image): "Hi {{1}}, your {{2}} is in your cart 🛒\nIf you pre-order tonight, it can reach you {{3}}, cleaned and cut your way.\nQuestions? Just reply here, or call us on 9152207607." Buttons: See my cart / I have a question
- **rf3_promo_cart** (MARKETING, image): "Happy {{1}}, {{2}}! Your {{3}} is still in your cart 🛒\nToday's catch is in, and the next slot is {{4}}.\nWhenever you're ready, it's one tap away. Questions? Just reply here." Buttons: See my cart / I have a question
- **rf3_promo_unpaid** (MARKETING, image): "Happy {{1}}, {{2}}! Your {{3}} order is saved with us 🛒\nIt's almost done: the payment is the last step, and if your old slot has passed you can pick a new one. The next slot is {{4}}.\nStuck anywhere? Just reply here, or call us on 9152207607, and we'll sort it out." Buttons: Finish my order / Payment not working?
- **rf3_order_again** (MARKETING, image): "Hi {{1}}, hope the {{2}} was just the way you like it 😊\nWhenever you'd like it again, fresh stock is in and the next slot is {{3}}.\nWant something different this time? Just reply here, we'll help." Buttons: Order the same again / Try something new
- **rf3_cart_swap** (MARKETING, image): "Hi {{1}}, the {{2}} in your cart isn't on today's menu, sorry about that.\nA fresh pick you might like instead: {{3}}, cleaned and cut, delivered {{4}} 🐟\nWant something else? Just reply here and we'll help you choose." Buttons: See today's menu / Help me choose
- **rf3_weekend** (MARKETING, image): "Happy Saturday, {{1}}! 🐟 Sunday fish, sorted tonight without the market rush.\nVerified sellers near {{2}} have the catch up now: {{3}}. You can pre-order tonight for {{4}}.\nNeed help choosing? Just reply here." Buttons: Pick my weekend fish / Help me choose
- **rf3_catch_preorder** (MARKETING, image): "Hi {{1}}, happy {{2}}! 🐟 Tomorrow morning's fresh catch is open for pre-order:\n{{3}}\nPre-orders placed by {{4}} reach you {{5}}, cleaned and cut your way.\nWant help choosing? Just reply here." Buttons: See tomorrow's catch / Help me choose
- **rf3_catch_today** (MARKETING, image): "Hi {{1}}, happy {{2}}! Today's fresh catch is in 🐟\n{{3}}\nOrders placed by {{4}} are delivered {{5}}, cleaned and cut your way.\nTell us your favourite fish and we'll let you know when it lands. Just reply here." Buttons: See today's fish / Tell me my fish lands
- **rf3_unpaid** (UTILITY, image): "Hi {{1}}, your order {{2}} for {{3}} is saved and almost done.\nThe payment is the last step to confirm it for your {{4}} slot. If the page doesn't open inside Instagram or Facebook, open the link in Chrome or Safari.\nStuck anywhere? Just reply here, or call us on 9152207607, and we'll sort it out with you." Buttons: Finish my order / Payment not working?
- **rf3_paid** (UTILITY): "Payment received for order {{1}}, thank you {{2}}! ✅\nIt's usually confirmed within 2 hours, and we'll message you as soon as it is.\nAny special request for the cut? Just reply here." Buttons: See my order / Add a cut request
- **rf3_paid_evening** (UTILITY): "Payment received for order {{1}}, thank you {{2}}! ✅ You're all set for {{3}}.\nPre-orders are confirmed first thing in the morning, by 9:30 AM, and we'll message you as soon as yours is.\nQuestions? Just reply here." Buttons: See my order / Add a cut request
- **rf3_paid_fast** (UTILITY): "That was quick, {{1}}! ✅ Payment received for order {{2}}.\nIt will be confirmed {{3}}, and we'll message you when it's on the way.\nNeed anything? Just reply here." Buttons: See my order / Add a cut request
- **rf3_confirmed** (UTILITY, image): "Confirmed! ✅ Your order {{1}} is accepted.\nYour fish reaches you {{2}}, cleaned and cut your way.\nWe'll message you when it's on the way. Questions? Just reply here." Buttons: See my order / Chat with us
- **rf3_out** (UTILITY): "Your fish is on the way 🛵 Order {{1}} should reach you by {{2}}.\nPlease keep your phone close for the delivery person. Anything urgent? Call us on 9152207607." Buttons: See my order / Chat with us
- **rf3_delivered** (UTILITY, image): "Delivered! Hope the {{1}} turns out just the way you like it, {{2}} 😊\nHow was it, the fish, the cut, the delivery? Two taps to tell us, it helps families near you.\nSomething not right? Just reply here and we'll make it right." Buttons: Rate my fish / Something's not right
- **rf3_cancelled** (UTILITY): "Sorry, {{1}}, your order {{2}} couldn't go ahead: {{3}}.\nRefund: {{4}}. We'll keep you posted until it's done.\nWant another fish or a different slot? Just reply here, or call us on 9152207607, and we'll help 🙏" Buttons: See today's menu / Talk to us

**rf2_login_otp (AUTHENTICATION):** "*{{1}}* is your verification code. For your security, do not share this code." with the footer "Expires in 10 minutes."

Meta fixes the body text of AUTHENTICATION templates. Custom wording isn't allowed; the only switches are the security line and the expiry footer. So a "gentle" version can't be submitted as an authentication template. The current text is already neutral, so keep it.

If a friendlier OTP is ever wanted, the only route is a UTILITY template, for example: "Hi! {{1}} is your Relifish login code. It's valid for 10 minutes; please keep it to yourself. Fresh fish near you is waiting in the store." Meta usually rejects OTPs sent as UTILITY, so this is not recommended.
