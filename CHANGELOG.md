# Changelog

All notable changes to the EnerFab Biomass Storage system.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.0] — 2026-11-12

### Changed

* **Nothing is rejected.** Every load is received. A short fill still drops
  the batch to the reduced price; anything else (wet, dirty) is handled by a
  **percentage deduction** the supervisor enters, with a reason, when accepting
  the load. It can be corrected on the payment until the payment is authorised,
  and it shows on the receipt, payment slip, supplier statement, reports and CSV.
  The "Reject" button, the "send back" option and the Rejected filter are gone.
* **Suggested deduction.** The accept dialog opens with a deduction already
  proposed from the moisture reading: 5 % for a damp load, 10 % for a wet one
  (both editable in Business settings; 0 turns it off). The supervisor can
  change or clear it before accepting.
* **Moisture formula.** Moisture is read from bag weight as
  `moisture % = (40 / 18) × kg − 20` (18 kg = 20 %, 36 kg = 60 %). The two
  points are in Business settings. Bands are now dry / damp / wet (30 % and
  45 % by default) and a wet reading is a reason to deduct, not to reject.
* **New look ("weighbridge").** Deep-green sidebar, DIN-style figures, a
  moisture scale wherever a bag is weighed, bag serials drawn as tags, calmer
  tables and dialogs, a two-panel sign-in screen. System fonts only, so it
  still opens offline and passes the Content-Security-Policy.

### Added

* **Language choice.** Each device can show English only, or English with
  Sinhala alongside (menu, headings, field names, buttons, table headers,
  statuses). The switch is in the account menu, the phone "More" sheet and on
  the sign-in screen. Wording lives in one table in `js/i18n.js`.

### Fixed

* Save buttons in dialogs (supplier, farmer, quality issue, bag return, new
  account) did nothing because the form reader expected a `<form>`.
* An approved gasifier request had no "Weigh and consume" button.
* Consuming bags created a second record with the same serial. A bag now keeps
  one record for life and moves emptied → checked → back to stock / repair /
  retired under Bag returns.
* A serial already in a bay could be attached to a second delivery; it is now
  skipped and reported. More serials than counted bags are refused.
* Error messages in the acceptance and farmer-declaration dialogs never showed.
* A supplier marked "also a farmer" listed every farmer in the declaration.
* Demo data now starts its receipt/payment numbers after the sample records.
* Bay moisture uses every bag in the bay, not only the latest delivery.

## [1.2.0] — 2026-11-12

### Changed

* **Feels like an installed app** — bottom tab bar and slide-up sheets on
  phones, icon rail on tablets, full sidebar on desktop. The phone back gesture
  closes dialogs first, then returns to the previous page. New visual style,
  one consistent icon set, safe-area and touch fixes, modern scrollbars.
* **Demo runs in its own sandbox** — the "Preview with demo data" session has a
  separate local store that never syncs and cannot see real records. Demo
  records are no longer seeded into the live store.

### Security

* Database rules now check each person's role: unapproved accounts get no
  access, each role writes only the record types it uses, and nobody can raise
  their own role.
* Owner rights require a verified owner email.
* All incoming records (forms, backups, cloud sync) are cleaned of HTML and
  non-numeric numbers; inline scripts are blocked by the Content-Security-Policy.
* Local server no longer serves dotfiles or tooling, and survives malformed URLs.

### Added

* Cloudflare Pages support: `_headers` (security headers) and `_redirects`
  (keeps docs, tests and tooling off the public site). See
  `docs/DEPLOY-CLOUDFLARE.md`.

## [1.0.0] — 2026-11-09

First working release, built from the 15-point requirements document and the
WhatsApp decisions on bag numbering.

### Added

* **Offline-first core** — local database with debounced atomic writes, an
  outbox queue and a 30-second sync to Firebase Realtime Database. The app keeps
  working through a power cut; nothing typed at the gate is lost.
* **Bag-level traceability** — every bag carries one serial for life. A serial
  resolves to the issue round, supplier, farmer, weighbridge receipt, bay,
  gasifier run, moisture reading, payment and any quality issue.
* **Receiving** — supplier/vehicle/driver capture, weighbridge gross-tare-net,
  bag count, average bag weight and a moisture estimate from bag weight.
* **Fill check** — agreement-driven sampling (5 %, minimum 3), average fill
  height, automatic Rs 300 / Rs 270 pricing, recount/reject path, and a
  supervisor override that requires a written reason.
* **Bay management** — multi-bay allocation with an exact bag-count check,
  capacity limits, and stock derived from the bag serials in each bay.
* **Gasifier issue** — operator request, supervisor approval showing every
  bay's average bag weight and moisture, three-bag weighing at consumption, and
  the average applied to the whole issue for the outgoing weight.
* **Payments** — generated on acceptance, `DRAFT → PENDING SUPERVISOR →
  APPROVED → SENT TO HEAD OFFICE → PAID`, farmer declaration required before
  authorisation, printable payment slip with signature blocks.
* **Master data** — suppliers (including "supplier is also a farmer") and
  farmers, with the EnerFab species list seeded.
* **Quality issues** — raised from a bag serial, so the supplier and the farmer
  are attached automatically, with notification and resolution tracking.
* **Bag returns** — good / repairable / beyond repair, repair order, replacement
  order, and per-serial bag lifecycle.
* **Reports** — in vs out, stock by bay, supplier performance, payment register,
  CSV export and print.
* **Printing** — A4 receipt, 70 × 45 mm bag stickers with Code 39 barcodes and
  write-in boxes for the farmer and supplier numbers, and a bag allocation slip
  per issue round.
* **Sign-in** — Google sign-in (new accounts land in a permission-less *pending*
  role until the owner assigns one) and email/password with self-registration;
  90-day device sessions and a PBKDF2 offline password check so a cold start
  with no signal still works.
* **Roles** — owner (super admin), admin, supervisor, storekeeper, gasifier
  operator, accounts, auditor (read-only).
* **Owner switch** — pause/restore the whole service, enforced in the database
  rules, with no expiry date anywhere: the paused screen appears only when the
  owner puts it there, and pausing never deletes or hides data.
* **Audit trail** — append-only, with user, action, amount, device and time.
* **Design** — neumorphic UI on the EnerFab palette (`#187800`, `#9CCC84`,
  `#C00000`), EnerFab logo, responsive to a phone, `prefers-reduced-motion`
  support, print styles.
* **Delivery** — installable PWA with a service worker, a zero-dependency static
  server for LAN use, and a single-file build (`dist/`) that runs from a USB
  stick.
* **Docs** — requirements review with open questions, bag tagging SOP, brand and
  security research, deployment guide, contributing guide.
* **Tests** — 74 automated checks that boot the real app in jsdom and drive the
  receiving, gasifier, payment, traceability and permission flows.
* **CI** — GitHub Actions workflow: syntax check, JSON validation, tests, build,
  artefact upload.

### Known limitations

* Business rules run in the browser; Cloud Functions should own pricing and
  payment transitions before this becomes the only record of a payment.
* Realtime Database rules must be published before other devices can sync.
* Two devices editing one record: newest change wins.
* A shared tablet stays signed in as the last user until a device PIN exists.
