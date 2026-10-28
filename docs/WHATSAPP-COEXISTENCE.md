# WhatsApp coexistence runbook

Goal: +91 91522 07607 stays in the WhatsApp Business app on the founder's phone **and** is used by
our Cloud API (order updates, promos) at the same time. Meta allows this only through Embedded
Signup run by a Tech Provider / Solution Partner, so the "relifish" Meta app (id 1365998548724131,
business 1255093009942852) must become a Tech Provider first.

Source: Meta docs, "Onboarding WhatsApp Business app users" (embedded-signup/custom-flows/onboarding-business-app-users),
"Embedded Signup implementation", "Get started for Tech Providers". Re-check them if a screen differs.

## Founder: Meta steps, in order

1. **Meta support: activate WABA 1491951102724224** (holds our 19 approved `rf2_*` templates; it has no phone number now).
2. **App Dashboard → Settings → Basic** (app "relifish"):
   - Privacy policy URL: `https://www.relifish.com/privacy`
   - Terms of service URL: `https://www.relifish.com/terms`
   - User data deletion → Data deletion instructions URL: `https://www.relifish.com/data-deletion`
   - App icon, app category, contact email `relifishstore@gmail.com`.
   - Business verification must be complete (App Review won't start without it).
3. **Facebook Login for Business → Settings → Client OAuth settings**: turn on Client OAuth login, Web OAuth login,
   Enforce HTTPS, Embedded Browser OAuth Login, Use Strict Mode for redirect URIs, Login with the JavaScript SDK.
   Allowed domains (JS SDK) and Valid OAuth redirect URIs: `https://www.relifish.com/` (add `https://stage.relifish.com/` to try it on stage).
4. **Facebook Login for Business → Configurations → Create from template →
   "WhatsApp Embedded Signup Configuration With 60 Expiration Token"** (or Create configuration → login
   variation "WhatsApp Embedded Signup", product WhatsApp). Copy the **configuration ID** and send it to Kunal.
5. **WhatsApp → Configuration → Webhooks**:
   - Callback URL: `https://www.relifish.com/api/whatsapp/webhook`
   - Verify token: the value of `WA_VERIFY_TOKEN` on Vercel (ask Kunal; don't paste it in chat)
   - Subscribe fields: `messages`, `account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`
6. **App Review → Tech Provider onboarding**: request **Advanced access** for `whatsapp_business_messaging`
   and `whatsapp_business_management`, with the 2 screen recordings Meta asks for:
   - Video 1: a message sent from our app (or the API Setup cURL script) arriving in WhatsApp.
   - Video 2: creating a message template (WhatsApp Manager is accepted).
7. **After approval**: open `https://www.relifish.com/admin/whatsapp-connect` on a computer, with WhatsApp
   Business open on the phone (app version 2.24.17 or newer). Enter the admin secret, click
   **Connect WhatsApp Business app number** and finish
   the steps (the phone asks you to confirm, and whether to share chat history).
   The page then exchanges the code, subscribes our app to the WABA, and starts the contacts sync and the
   history sync. **This must happen within 24 h of connecting**, and each sync can run only once;
   a repeat shows Meta's error. Send Kunal the `waba_id` and `phone_number_id` shown on screen.

## Env vars (Vercel, project "relifish")

| Var | When | Value |
| --- | --- | --- |
| `PUBLIC_WA_ES_CONFIG_ID` | before step 7, then **redeploy** (build-time) | configuration ID from step 4 |
| `PUBLIC_WA_APP_ID` | optional | defaults to `1365998548724131` |
| `WA_APP_SECRET` | already used by the webhook; must be set | App Dashboard → Settings → Basic → App secret |
| `ADMIN_SECRET`, `WA_VERIFY_TOKEN` | already set | unchanged |
| `WA_PHONE_NUMBER_ID`, `WA_WABA_ID` | after step 7 (Kunal) | ids from the connect page |

`WA_TOKEN` (system-user token) must have access to the WABA the number ends up in. If the connect page
reports a `waba_id` other than 1491951102724224, the templates live on the other WABA: assign the new
WABA to the system user in Business Settings and re-create the `rf2_*` templates there (or ask Meta support).

## What changes on the phone (Meta docs)

- Group chats are **not synced** (not supported on Cloud API).
- Existing broadcast lists become **read-only**; no new broadcast lists.
- Disappearing messages and view-once messages are turned off for 1:1 chats; live location is disabled for 1:1 chats.
- All linked devices (WhatsApp Web/desktop) are unlinked on connect; re-link afterwards. WhatsApp for Windows and WearOS are not supported.
- Calls, catalog, orders, status, labels, quick replies and Channels keep working in the app (they're just not on the API).
- Messages sent from the phone don't open or extend Cloud API 24 h windows. They reach us as `smb_message_echoes`
  and are recorded in `message_log` (kind `manual`).
- Throughput is fixed at 20 messages/second.
- Meta's Deregister API can't be used on coexistence numbers. Disconnecting means offboarding; connecting again needs this whole flow (and the syncs) again.
