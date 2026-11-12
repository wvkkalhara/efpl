# Research: brand, design language and security

**Date:** 9 November 2026 · **For:** EnerFab Biomass Storage system

---

## 1. Brand research — where the assets actually come from

**`efpl.com` is not EnerFab.** It is a parked domain listed for sale by Get On The Web Limited (US$ 33,750) — the page says so in as many words. Nothing on it is EnerFab property, and none of it was used here.

**The real company site is `efpl.org`** — *EnerFab (Pvt) Ltd · Green Engineering*, No. 115/3 Rampart Road, Sri Jayawardanapura Kotte · +94 112 888821 · info@efpl.org. Every brand element in this app was taken from that site:

| Asset | Source on efpl.org | How it is used here |
|---|---|---|
| Logo mark (green `e` formed by a leaf swoosh over stacked timber bars) | `assets/images/enerfab-logo.png` | Sidebar, sign-in card, app icon, label header |
| Wordmark (red **EnerFab** + green *Green Engineering*) | `enerfab-logoand-name-2017-534x192.png` | Reference for the type treatment; the app uses the mark with a text lockup so it stays legible at 40 px |
| Leaf green | sampled `#187800` | Primary brand colour, primary buttons, active nav |
| Light sage | sampled `#9CCC84` | Meters, focus rings, soft fills |
| Wordmark red | sampled `#C00000` | Danger/irreversible actions only |
| Tagline | site footer / logo | "Green Engineering" in the sidebar footer |

**Palette actually implemented** (CSS custom properties in `css/app.css`):

```
--bg        #e8ece5   the neumorphic surface (soft sage-grey, not white)
--ink       #1e2a1c   body text            (12.5:1 on the surface)
--green     #187800   brand / primary      (4.7:1)
--green-dark#0f5200   links, emphasis      (7.9:1)
--green-soft#9ccc84   meters, focus ring
--red       #c00000   destructive only     (5.4:1)
```

Business context that shaped the build: EnerFab has run biomass gasifiers since 2005, a 40 000-plant fuelwood plantation at Nawagaththegama, and a collection network of roughly 2 000 suppliers / 3 000 farmers. The species in the app (Gliricidia, Ipil Ipil, cinnamon waste, timber off-cuts, coconut shell) are the ones named on their own site — not invented placeholders.

---

## 2. Design language — neumorphism, done defensibly

Neumorphism (soft extruded "moulded plastic" surfaces) was requested, so it is the visual language throughout: one surface colour, two shadows (a light top-left, a dark bottom-right), and inset shadows for anything you type into or read out of.

The known weakness of neumorphism is **low contrast** — it makes affordances pretty and hard to see. Three rules were applied so it stays usable on a site tablet in daylight:

1. **Keep the text out of the soft zone.** Surface `#e8ece5`, text `#1e2a1c` = **12.5 : 1**. Secondary text `#4c5a49` = 6.1 : 1. Even the muted grey used for timestamps is 3.8 : 1, which is AA for large text.
2. **Never signal with colour alone.** Every status is a word plus a tone: `IN BAY`, `DAMAGED`, `PENDING SUPERVISOR` — a colour-blind supervisor loses nothing.
3. **Give interactive elements a real edge.** Inputs and pressed states are *inset* (visibly recessed); buttons are *raised* and lift slightly on hover. The focus ring is a 2 px dashed green outline, not a colour change, so it is visible on any surface.

Also implemented: 44 px minimum touch targets, a responsive collapse to a single column under 860 px, `prefers-reduced-motion` support, no text in images, and print styles so receipts and labels come out clean.

---

## 3. Security architecture

### 3.1 What this system actually is

An **offline-first PWA**: the browser holds the working copy, Firebase Realtime Database holds the shared copy. There is no application server, so there is no server to patch — but that also means *the browser is the client and the database rules are the lock*. Both are addressed below.

**Current state of the database (verified 9 Nov 2026):** `GET https://efpl-2feb8-default-rtdb.firebaseio.com/.json` returns **401 Permission denied**, so the database is *not* in public test mode. Good. It also means the app cannot sync until the rules in `firebase.rules.json` are published — the app detects this, shows "Cloud access blocked (rules)" in the sync chip, and keeps working offline rather than failing.

### 3.2 Controls in place

| Area | Control |
|---|---|
| **Identity** | Firebase Authentication — Google sign-in (verified enabled) plus email/password. Passwords never pass through this app. |
| **Provisioning** | A new account (Google or self-created) lands in a **pending** role with an empty permission set. Only the owner/admin can write a role, and the database rules reject any role outside the allow-list — so nobody can promote themselves. |
| **Authorisation** | Six roles enforced on every screen and every action: owner (super admin), admin, supervisor, storekeeper, gasifier operator, accounts, auditor (read-only). Role checks run before a button is even rendered. |
| **Database rules** | `firebase.rules.json`: reads require a signed-in user; writes additionally require the subscription to be `ACTIVE`; only `w.v.k.kalhara@gmail.com` can write the subscription switch; roles are validated against an allow-list; users can only write their own profile. |
| **Session** | Long-lived "remember this device" (90 days, sliding) so yard staff do not re-type passwords; ID token refreshed in the background; sign-out clears the local session. |
| **Offline credentials** | The last successful password is cached as **PBKDF2-SHA256, 210 000 iterations, 16-byte random salt** so a cold start with no signal can still verify that person. Only ever created *after* a real Firebase sign-in. |
| **Brute force** | Five failed attempts ⇒ exponential lockout (30 s doubling, capped at 15 min) per email on that device, plus Firebase's own server-side throttling. |
| **Input handling** | Every string rendered goes through an HTML escaper; numeric inputs are range-validated; CSV exports are guarded against formula injection (`=`, `+`, `-`, `@` prefixed cells). |
| **Integrity** | Money and weights are recomputed from the stored rules, never taken from the browser's last keystroke; the payment state machine refuses skipped steps; bag serials cannot be duplicated. |
| **Audit** | Append-only trail: who, what, when, which device, with the amount. No delete path exists in the UI. |
| **Data at rest** | Nothing on Firebase Storage; JSON backup export/import with merge-by-newest; corrupt local databases are preserved under a timestamped key instead of being overwritten. |
| **Transport** | HTTPS only (Firebase endpoints + Firebase Hosting). No third-party scripts, no CDN, no analytics beacons — the whole app is self-hosted files. |

### 3.3 The owner's kill switch, and why it cannot bite the customer

Requirement from the owner: *the system may be paused, but the customer must never see a "subscription ended" message unless the owner actually sends one.*

Implemented rules:

* the flag lives at `appConfig/subscription/status` and defaults to **ACTIVE**;
* **only** `w.v.k.kalhara@gmail.com` can change it (enforced in the database rules, not just the UI);
* there is **no expiry date, trial timer or renewal check anywhere in the code** — a search for `expiresAt` in the subscription object returns nothing. It is a human switch, not a clock;
* while paused, ordinary staff see a calm message written by the owner and **no data is deleted or hidden**; the owner can still sign in and work;
* the paused state reaches every device on the next sync (30 s), and locally at once.

### 3.4 Sri Lanka Personal Data Protection Act (No. 9 of 2022)

The system holds farmers' names, NIC numbers, phone numbers, villages and land size — personal data under the PDPA. The Act's general obligations (lawful basis, data minimisation, accuracy, integrity and confidentiality via appropriate technical measures such as access controls) map onto what is built here:

* **Data minimisation** — only NIC, phone, village, land size; no bank details of farmers, no family data.
* **Access control** — operators and auditors never see a NIC: the trace screen shows the farmer's name and code, not identity numbers.
* **Purpose limitation** — personal data is used for payment and traceability only.
* **Retention** — records are soft-deleted, and a backup/export exists so records can be produced for a subject access request within the statutory one month.
* **Practical note:** Part I obligations commence 1 January 2027, so this should be straightened out before then, and any privacy notice given to farmers should say what is collected and why. (See the AW Chambers and BizAdvisor summaries of the Act.)

Not yet done, and worth doing: a written retention schedule and a named contact for data-subject requests.

### 3.5 Honest limitations

| Limitation | Consequence | Mitigation / next step |
|---|---|---|
| Rules are not published yet | No cloud sync, single-device only | Apply `firebase.rules.json` (5 minutes, see deployment guide) |
| Business rules run in the browser | A determined user with dev-tools could forge a *local* record; it would then sync | Acceptable for internal staff; move pricing and payment transitions into a Cloud Function in Phase 2 for bank-grade assurance |
| Shared site tablet | Anyone holding the tablet is signed in as the last user | Add a 4-digit device PIN on resume (Phase 2) or lock the tablet to this app |
| `apiKey` in `config.js` | **Not** a secret — Google ships it in every web app; it only identifies the project | Keep the database locked by rules; never commit a service-account key |
| No field-level schema validation in rules yet | A malformed record could be written by a signed-in user | Rules validate required fields; full schema validation is Phase 2 |
| Preview mode | `allowLocalPreview: true` shows a no-password demo entry | **Set to `false` before go-live** |

### 3.6 Go-live security checklist

- [ ] Publish `firebase.rules.json` in the Realtime Database console
- [ ] Create each staff account in Firebase Authentication (email + temp password)
- [ ] Register the same emails in Administration with the correct role
- [ ] Confirm the owner account is `w.v.k.kalhara@gmail.com` and shows *Super Admin*
- [ ] Set `allowLocalPreview: false` in `js/config.js` and rebuild
- [ ] Test with a real supervisor login on the site tablet, aeroplane mode on
- [ ] Export a backup and store it off the tablet
- [ ] Agree the retention schedule and who answers a data-subject request
