# Changelog

All notable changes to the EnerFab Biomass Storage system.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
