# TODO

## Push notifications not working

- [ ] **Fix / verify push notifications end-to-end** (buyers and/or sellers not receiving alerts).

**Likely areas to check**

- Env: `PUBLIC_VAPID_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT` in `.env` (see `.env.example`).
- Subscription flow: client permission + saving `push_subscription` on `buyers` / `sellers` rows.
- Server: `src/lib/server/buyer-push.ts` (and any seller push helpers), `src/pages/api/push-notify.ts`.
- Service worker: `public/sw.js` — push event handler, subscription mismatch with app origin.
- HTTPS / localhost: Web Push requires secure context (or localhost) for `PushManager`.

**Acceptance**

- [ ] New order / status change triggers a visible notification on a subscribed device.
- [ ] Document any required setup (keys, browser permission) in README or runbook if non-obvious.
