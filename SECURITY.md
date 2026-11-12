# Security policy

## Reporting a problem

Do not open a public issue for a security problem. Send it to the system owner:

**W. V. K. Kalhara — w.v.k.kalhara@gmail.com**

Include what you did, what happened, and the browser you used. You will get an
answer within two working days.

## What this repository must never contain

| Never commit | Why |
|---|---|
| `serviceAccountKey.json`, any `*-firebase-adminsdk-*.json` | Full admin access to the Firebase project and every farmer's data |
| `.env`, `.env.*` | Secrets in general |
| Database exports or backups containing farmers' NIC / phone numbers | Personal data under the Sri Lanka PDPA (Act No. 9 of 2022) |
| Photos of the gate log, weighbridge slips, delivery notes | Same |

`.gitignore` already blocks the common cases. Check `git status` before every
push.

### About the `apiKey` in `js/config.js`

It is **not a secret**. Google ships this identifier inside every Firebase web
app; it only names the project. What actually protects the data is:

1. **Firebase Authentication** — every read and write requires a signed-in user;
2. **`firebase.rules.json`** — the rules that decide what that user may touch.

So: keep the database rules published, never open the project in "test mode",
and never put a service-account key anywhere near the browser.

## What is protected, and how

* **Identity** — Firebase Auth (Google or email/password). Passwords never pass
  through this application.
* **Authorisation** — seven roles, checked before every screen renders and every
  action runs. A new account starts as *pending* with zero permissions; only the
  owner or an admin can write a role, and the rules reject any role outside the
  allow-list.
* **Owner switch** — only `w.v.k.kalhara@gmail.com` can pause or restore the
  service; the rules enforce it, not just the UI.
* **Sessions** — 90-day sliding device session; the offline password check uses
  PBKDF2-SHA256 with 210 000 iterations and a per-user random salt.
* **Brute force** — exponential lockout per email on a device, plus Firebase's
  server-side throttling.
* **Output** — every rendered string is HTML-escaped; CSV exports are guarded
  against formula injection.
* **Integrity** — money and weights are recomputed from the stored agreement,
  never taken from an input field; the payment state machine refuses skipped
  steps; bag serials cannot be duplicated.
* **Audit** — append-only trail with user, action, amount, device and time.

## Known limitations (accepted, documented)

* Business rules execute in the browser. Right for trusted staff; a Cloud
  Function should own pricing and payment transitions before this becomes the
  only record of a payment.
* A shared site tablet stays signed in as the last user until a device PIN is
  added (planned).
* Two devices editing the same record: newest change wins.
* `allowLocalPreview` in `js/config.js` opens a no-password demo entry. It must
  be `false` in production.

## Before go-live

- [ ] `firebase.rules.json` published in the Realtime Database console
- [ ] `allowLocalPreview: false` and a fresh build
- [ ] Every staff account has a real role (no one left *pending* who should work)
- [ ] A backup exported and stored off the tablet
- [ ] The site's own address added to Firebase → Authentication → Authorized domains
