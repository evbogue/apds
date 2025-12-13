# APDS 

A personal data server (pds) for ANProto https://anproto.com/

Try it at https://apds.anproto.com/ 

---
MIT

## Web Push (server)

This server exposes minimal Web Push subscription + notification plumbing:

- `GET /push/vapidPublicKey` returns `{ publicKey }` (base64url) for `pushManager.subscribe({ applicationServerKey })`.
- `POST /push/subscribe` stores a browser PushSubscription (JSON body).
- `POST /push/test` triggers a test push to all stored subscriptions.

When a *new* ANProto message is added via WebSocket, the server sends a push with payload `{ type: "latest" }` so the service worker can wake up and fetch `/latest`.

By default it sends `{ type: "anproto", sigs: ["...==", ...] }` (batched + throttled), so the service worker can process specific messages and/or still fetch `/latest` as a fallback.

Notes:
- The server writes `subscriptions.json` and `vapid.json` locally.
- Set `VAPID_SUBJECT` (e.g. `mailto:you@example.com` or `https://your.site`) if you don’t want the default.
