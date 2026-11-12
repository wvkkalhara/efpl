# Changelog

All notable changes to the EnerFab Biomass Storage system.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.4.4] — 2026-11-12

### Added

* **My account.** Everyone, whatever their role, has "My account and
  password" in the account menu (and in the phone "More" sheet). Someone who
  joined with Google can create a password there and then also sign in with
  email and password, including with no signal on that device. Anyone can
  change their password there.

### Changed

* **The demo is hidden.** The "Preview with demo data" button is gone from the
  sign-in screen. The owner can bring it back from Administration →
  Subscription → Demo mode (shown on every device's sign-in screen), or open
  the demo on their own device from the same place. The "Remove demo data"
  button is gone, since real devices never hold demo records.

### Fixed

* The announcement banner was only saved on the owner's device; it now reaches
  every device.

## [1.4.3] — 2026-11-12

### Changed

* **Simpler look.** Light sidebar, white cards on a soft background, one green
  for actions, bigger text (16px) and bigger touch targets (48px, 52–54px for
  the main action), rounded shapes, tables without boxes. The only dark block
  left is the "In the yard now" figure on the dashboard. One type family on
  every device, with room for Sinhala.
* **Receive biomass is now four short steps** (Supplier, Weight, Fill check,
  Bags) shown one at a time, with Back and Next. A step cannot be skipped
  while something in it is missing, and Enter moves to the next step.

### Fixed

* **A person who signed in did not appear for the administrator.** The staff
  list on Users & roles was read once when the screen opened, so anyone who
  signed in afterwards stayed invisible until the administrator left the
  screen and came back.
* **New sign-ins and role changes now arrive at once.** The staff list has its
  own live link: an administrator's device hears about a new person within a
  second or two and shows a notice, and the person's own device gets its role
  the moment it is given (before, up to 30 seconds).
* The "waiting for approval" screen kept checking every 25 seconds for ever,
  even after the person was let in, redrawing the app each time.
* Someone who signs in with Google and is still waiting for a role now starts
  syncing straight away, so their sign-up is uploaded without delay.

## [1.4.2] — 2026-11-12

### Changed

* **Reports are a live view.** Pick any period (7, 30 or 90 days, this month,
  all time, or your own dates), a supplier and a biomass type, and every
  figure, the in/out chart and all tables follow at once. The page updates by
  itself when records arrive from another device, and keeps your filters.
  New: money summary, payments by stage, loads by biomass type, moisture per
  supplier, and a payments CSV.
* **Everything updates in real time.** A change made on one device is uploaded
  about two seconds later, and every other device hears about it at once over
  a live link to the cloud and redraws: dashboard, deliveries, payments,
  reports, the staff list and the activity log. The sync chip says "Live" while
  the link is open. If the link cannot be opened, the regular checks carry on
  as before. Needs the latest `firebase.rules.json` (it adds the small "pulse"
  value the devices watch).
* **Printing works on phones and tablets.** Receipts, bag labels, allocation
  slips, payment slips, supplier statements and reports are now printed from
  the app's own window with a print stylesheet. The old hidden-frame method
  printed the whole screen on Android and iOS.

## [1.4.1] — 2026-11-12

### Added

* **Roles can be edited.** In Administration → Users & roles an administrator
  can rename any role and tick which jobs a role may do. Administrator always
  keeps everything and Auditor stays read-only. The database rules now let the
  five working roles write all yard records, so the app's role settings decide
  who does what; publish `firebase.rules.json` again.
* Reports is now its own job ("See reports") instead of following payments.

## [1.4.0] — 2026-11-12

**Publish `firebase.rules.json` again after installing this version.** It adds
two places in the database (shared settings and the shared activity log). Until
it is published everything else still syncs; only those two stay per device.

### Changed

* **Each role sees only its own work.** The menu, the phone tab bar and the
  dashboard now show a person just the screens their role uses: a gasifier
  operator gets the gasifier and stock, accounts gets payments and reports, a
  store keeper gets receiving and bags. A screen outside the role cannot be
  opened by typing its address. The auditor still sees everything, read-only.
* **"Waiting for you" on the dashboard.** A short list of the jobs that person
  can act on now (trucks to accept, issues to approve or weigh, payments to
  authorise or release, people waiting for a role), each one a tap away.
* **Simpler staff management.** Users & roles explains every role in plain
  words with the screens it opens, and the Add account form shows the same
  while you choose.

### Fixed — cloud sync

* **An out-of-date device could overwrite newer records.** Sync now downloads
  first; anything newer in the cloud replaces the device's copy and is removed
  from its upload queue. Only then does the device upload.
* **Cleared values came back.** When a newer record arrives, it replaces the
  whole local record. Before, a bag returned to stock on one tablet kept its
  old supplier, farmer and bay on the others.
* **Roles never reached other devices.** Staff accounts are now downloaded on
  every sync: a new person shows up for the administrator, a role change
  reaches that person's device within a minute, and an account that is
  switched off is signed out. An account added by email gets its role as soon
  as the person first signs in.
* **One refused upload stopped all syncing.** The activity log was being sent
  to a place the database rules did not allow, which left devices stuck on
  "Cloud access blocked". Each kind of record now syncs on its own; a refused
  one stays safely queued and is retried on "Sync now".
* **Two devices could issue the same receipt or payment number.** Running
  numbers move past whatever arrives from the cloud, and a duplicate made
  offline is renumbered (with a note of the old number) before it is uploaded.
* **Only 4,000 of 5,000 newly numbered bags were uploaded.** The upload queue
  no longer drops entries; large batches go up in parts.
* **Deliveries from another device could fail to open** because the cloud
  leaves out empty lists. Records are put back into shape on arrival.
* An expired sign-in is refreshed and the sync retried, instead of being
  reported as a rules problem.
* A change made a split second before the tab was closed is now saved.
* The screen refreshes when records arrive from another device, but not while
  someone is typing or has a dialog open.
* Background sync downloads the full data every two minutes instead of every
  30 seconds (immediately when there is something to upload or on "Sync now").

### Added

* **Business settings are shared.** Prices, the fill agreement, the moisture
  line and biomass types saved by an administrator reach every device.
* **The activity log is shared.** Entries from every device are uploaded, and
  Administration → Audit trail shows the latest 300 from all of them, with the
  person's name and role.

## [1.3.1] — 2026-11-12

### Changed

* **Biomass types are now your own list.** It starts with Gliricidia, Cinnamon
  and Other (timber off-cuts and the rest are gone). Add or remove types under
  Administration → Business settings, or with "Add another type" on the Receive
  biomass screen. Types already used by past deliveries stay on those records.

* **The owner account is invisible to everyone else.** Administrators no longer
  see it in Users & roles or in backups they download, the Subscription tab
  stays owner-only, and screens say "an administrator" instead of "the owner".
* **Activity log.** Sign-ins, sign-outs and every staff action are logged with
  the person, device and time. The owner account leaves no entries, and any it
  made earlier are no longer shown.

### Fixed

* Cloud sync stopped with "Cloud access blocked" (401 on `users`) for the owner:
  the app sent the owner's profile with the role `super_admin`, which the
  database rules do not accept as a role value. The owner's role is no longer
  sent; owner rights come from the verified email.
* Content-Security-Policy now lets DevTools fetch Firebase's source maps.

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
