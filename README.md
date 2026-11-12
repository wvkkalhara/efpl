# EnerFab Biomass Storage

An **offline-first** web app for the biomass store at EnerFab (Pvt) Ltd — bag-level traceability, bay storage, gasifier issue, and supplier payments that cannot leave the building without a farmer declaration.

Built from the 15-point requirements document and the WhatsApp decisions on bag serial numbers.

```bash
git clone <this repo> && cd efpl-biomass
npm install        # jsdom, test-only
npm test           # smoke test against the real app
npm run build      # dist/EnerFab-Biomass-Storage.html  ← one file, no server needed
npm start          # http://localhost:3000  ← the installable PWA
```

---

## Why it is built this way

A biomass store has three realities that shape everything: **the truck arrives whether or not the internet works**, **the supervisor's hands are dirty**, and **every number on screen is money owed to a farmer**. So:

* the local device is the source of truth; Firebase is the shared copy that catches up later (`js/store.js`, `js/sync.js`);
* one identifier — the **bag serial** — ties the supplier, the farmer, the bay, the gasifier run and the payment together;
* every price is computed by the app from the stored agreement, never typed by a human at the gate.

No framework and no runtime dependencies — the app is plain HTML, CSS and JavaScript loaded by `<script>` tags. `node --check` runs on all of it, and the tests boot the real app in a DOM.

---

## What it does, against the requirements

| # | Requirement | Where |
|---|---|---|
| 1 | Supplier register with bank details and search | Suppliers · Receive biomass |
| 2 | Weighing, bag count, random bag check | Receive biomass |
| 3 | Fill-check sample (the full 5 %, printable blank sheet) → Rs 300 / Rs 270 / recount | Receive biomass step 3 |
| – | Nothing is rejected: wet or poor loads are received and a % is deducted | Accept & allocate · Payments |
| – | Moisture from bag weight: % = (40 ÷ 18) × kg − 20 (18 kg = 20 %, 36 kg = 60 %) | Everywhere a bag is weighed · Settings |
| 4 | Accept, allocate bays (30 × 200 to start, each resizable), bags per bay, drying 0.6 kg/bag/day, dry bays shown red, bay history with moisture | Accept & allocate · Bays & stock |
| 5 | Supervisor approves the bay from bag weight/moisture | Gasifier issue |
| 6 | Weigh 3 bags at consumption → average → out weight | Weigh & consume |
| 7 | Incoming vs outgoing bags and kg | Dashboard · Reports |
| 8 | Multiple biomass types (Gliricidia, Ipil Ipil, cinnamon, off-cuts, shell) | Settings · seeded |
| 9 | Payment on acceptance → supervisor → Head Office | Payments |
| 10 | ~~Farmer list required before release~~ — removed on request (Nov 2026) | — |
| 11 | Problem traced back to the supplier | Trace a bag · Quality |
| 12 | Receipt number + printed sticker + invoice, logo and bank details on every print | Print receipt · Invoice · Print labels |
| 13 | Supplier writes supplier no. + farmer no. on the tag | Label write-in boxes |
| 14 | Bag returns, repair, replacement order | Bag returns |
| 15 | Reports | Reports (CSV + print) |

Plus the owner controls: **pause/restore the whole service**, with the guarantee that the paused screen can only appear when the owner puts it there (no expiry dates anywhere), and that no data is ever deleted by pausing.

---

## Signing in (no Firebase console needed)

1. **You** tap *Continue with Google* and pick `w.v.k.kalhara@gmail.com` → you are recognised as **Super Admin** automatically, on any device (your Google email is verified, which the app requires for owner rights).
2. **Everyone else** taps the same button with their own Google account. Their account is created by Google, they appear in *Administration → Users & roles* as **Awaiting approval**, and you pick a role. Done.
3. No Google account? *Create an account* on the sign-in screen makes an email/password login — which also lands in **Awaiting approval**.
4. After the first successful sign-in, that device keeps working with **no connection at all** (90-day session + a PBKDF2-hashed offline password check).

A freshly signed-in account has **no permissions whatsoever** until a role is assigned. This is enforced by the database rules themselves, not just the screens, so a stranger who finds the URL can read and change nothing.

## Roles

| Role | Demo email | Can do |
|---|---|---|
| **Super Admin (owner)** | `w.v.k.kalhara@gmail.com` | Everything + subscription switch + admins |
| Administrator | `kasun.perera@efpl.org` | All operations, users, settings |
| Biomass Supervisor | `nimal.silva@efpl.org` | Accept trucks, allocate bays, approve issues, authorise payments |
| Store Keeper | `chaminda.raj@efpl.org` | Receive, number/issue bags, farmer split, returns |
| Gasifier Operator | `sunil.ops@efpl.org` | Request, weigh, consume, report quality |
| Accounts | `accounts@efpl.org` | Release to Head Office, mark paid |
| Auditor | `audit@efpl.org` | Read-only |

Sign-in is Firebase Authentication — Google first, email/password as an alternative. The Firebase SDK is fetched from Google's CDN **only** when the Google button is pressed; the rest of the app is entirely self-hosted. A demo with sample records is built in but hidden; the owner can show it from **Administration → Subscription → Demo mode**. Anyone can add a password to a Google account under **My account and password**.

---

## File map

```
index.html                  the app shell
css/app.css                 "weighbridge" design system, EnerFab palette, system fonts only
js/config.js                Firebase project, super-admin email, business defaults
js/store.js                 local database (localStorage, atomic debounced writes, outbox)
js/domain.js                business rules: fill check, moisture line, deductions, payment flow, trace, Code 39
js/firebase.js              tiny Firebase client over fetch (auth + RTDB REST)
js/auth.js                  sign-in, roles, 90-day device session, PBKDF2 offline credentials
js/sync.js                  offline-first push/pull, conflict resolution, subscription push
js/ui.js                    escaping, modals, toasts, tables, printing, CSV
js/seed.js                  first-run demo history (3 weeks of site activity)
js/app.js                   shell, router, sign-in, subscription gate
js/views-core.js            dashboard · receive · deliveries · trace
js/views-stock.js           bag registry · bays · gasifier
js/views-money.js           payments · suppliers · farmers · quality · returns · reports · admin
sw.js · manifest.webmanifest   installable PWA, cache-first shell
firebase.rules.json         the database lock — must be published
firebase.json · .firebaserc hosting + rules deploy settings for efpl-2feb8
server.js                   optional static server for LAN/tablet use
build.js                    bundles everything into dist/
tests/smoke-test.js         automated checks against the real app
docs/                       requirements review · bag tagging SOP · research · deployment · GitHub setup

.github/workflows/ci.yml    syntax check → JSON check → tests → build → artefact
CONTRIBUTING.md             house rules, how to add a screen or a collection
SECURITY.md                 what must never be committed, and what protects what
CHANGELOG.md · LICENSE      version history · proprietary licence
.gitignore · .editorconfig · .nvmrc
```

`dist/` and `node_modules/` are generated and deliberately **not** in git —
`npm run build` recreates the single file at any time, and CI uploads it as a
build artefact.

---

## Tests

```bash
npm install        # jsdom is the only dependency, and it is only for tests
npm test
```

CI runs the same command on every push (`.github/workflows/ci.yml`), together
with a syntax check of every source file, JSON validation and a build.

The suite boots `index.html` in jsdom, seeds the demo history, signs in, walks all 14 routes, then drives real flows: it accepts a waiting truck with a 5 % deduction (allocation, serial capture, auto payment, audit entry), approves and consumes a gasifier issue, verifies the Rs 300 / Rs 270 rule and the moisture formula, checks that a serial traces to supplier + farmer + receipt, and confirms the subscription gate hides the app from staff but not from the owner.

Run it after every change. (The v1.3.0 changes were verified by driving the same flows in a browser; run `npm test` once on a machine with Node.js to confirm the suite itself.)

---

## Go-live in five steps

1. Publish `firebase.rules.json` in the Firebase console (Realtime Database → Rules).
2. Make sure your web address is listed in Firebase → Authentication → Settings → **Authorized domains** (Firebase Hosting domains and `localhost` already are).
3. **Administration → Business settings**: confirm Rs 300 / Rs 270 / 90 % and the moisture line (18 kg = 20 %, 36 kg = 60 %) with the signed supplier agreement.
4. Create the real bays in **Bays & stock** (the live app starts empty; sample data lives only in the sandboxed demo). Optionally set `allowLocalPreview: false` to hide the demo button.
5. Number the bags, print the labels, issue round 1, receive the first truck.

**Hosting on Cloudflare Pages (GitHub → Cloudflare):** no build step — see `docs/DEPLOY-CLOUDFLARE.md`.
`_headers` and `_redirects` provide the security headers and keep docs/tooling off the public site.

**Hosting on Firebase:** full detail in `docs/DEPLOY-FIREBASE.md`. With the Firebase CLI linked to this
repository, deploying is one command:

```bash
firebase login
firebase use efpl-2feb8
firebase deploy --only hosting,database
```

`firebase.json` already sets the cache headers (so `sw.js` is never cached) and
the Content-Security-Policy that allows the Google sign-in window and the
Firebase endpoints — and nothing else.

---

## Known limits (deliberately honest)

* Database rules must be published before any device other than this one can sync.
* Business rules run in the browser — right for trusted staff, but a Cloud Function should own pricing and payment transitions before the system becomes the only record of a payment.
* Two devices editing the same record: newest change wins.
* A shared tablet stays signed in as the last user; a device PIN is the next thing to add.
* No fuel-consumption (kg → kWh) reporting yet; that needs the gasifier's own figures.

## Suggested next phase

Cloud Functions for server-side pricing and payment transitions · device PIN on resume · moisture-meter field · bag cost and asset value · supplier portal (read-only statement) · kg-to-energy reporting.
