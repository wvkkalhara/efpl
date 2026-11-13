# Changelog

All notable changes to the EnerFab Biomass Storage system.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.9.2] — 2026-11-13

### Changed

* **The invoice is the supplier's invoice.** EnerFab prepares it for the
  supplier, so it is issued in their name: "Invoice from" the supplier
  (name, address, phone, NIC) at the top, with "INVOICE", the number and the
  date, and "Bill to EnerFab (Pvt) Ltd". The EnerFab logo and letterhead are
  gone from it. It ends with "Please pay to" (the supplier's bank),
  signature lines for the supplier, the biomass supervisor and Head Office,
  and a small line: "Prepared by EnerFab (Pvt) Ltd for the supplier".
  The receipt, payment slip and statements keep the EnerFab letterhead.

## [1.9.1] — 2026-11-13

### Added

* **Bank details can be changed where the payment is made.** In "Accept
  RC-…", the Pay to box has a **Change bank details** button. If the
  supplier has no bank details, the boxes (bank, branch, account number,
  account name) are open and must be filled in. A truck cannot be accepted,
  and no payment made, without a bank and account number. The details are
  saved on the supplier.
* The payment window has the same box with **Save bank details**, until the
  payment is paid. Approve, Send to Head Office and Mark as paid need the
  bank details.
* Every change is written to the activity log as "supplier.bank", with the
  old and the new details.

## [1.9.0] — 2026-11-13

### Added

* **Daily bay check.** Bays & stock has a "Daily bay check" button: weigh
  one bag from each bay with stock and type the weights in one window. A bay
  left blank is skipped, since a missed day is fine. The bay window has the
  same check for one bay. Each check becomes the bay's latest weighing.
* **A small graph on every bay tile** shows the bag moisture over the last 14
  days, with "Checked today" or "Not checked today". **Show more** opens the
  full graph (loads in, daily checks, test bags, gasifier) and every reading,
  with the weight lost per day.
* **Staff log (Administration, administrators only).** Everything each
  staff member did, from every device. Filter by person, area, period or a
  search. Shows a summary by person (actions, days active, main areas,
  devices, last active), with Show more and a CSV download. It updates live.
* **New report tables from real weighings:** how the weight goes down in
  each bay, bag weight by days in the bay, daily check coverage, gasifier
  weighing by type, bag fill and pay (100 % or more, 90–99 %, 80–89 %,
  under 80 %), and month by month. Each one has a CSV button and they update live.
* Demo data includes daily checks, with some days missed.

### Changed

* **Bay names must be unique.** Two bays cannot share a code or a name.
  Case and extra spaces do not count as different.
* **Supplier own-bags rule removed.** Suppliers never bring their own bags.
* **Gasifier weighing:** for each type (gliricidia, cinnamon…), type the
  number of bags and the weight of one bag. The weight is one bag × bags,
  in place of the old 3-bag average. Help and training now say the same.
* **Fill check pay:** 100 % full or more gets the full price, never more.
  Below 100 %, the missing part is taken off. Moisture is recorded but never
  cuts the price.

## [1.8.1] — 2026-11-13

### Changed

* **Money is taken off for bags not filled fully, not for moisture.** Loads
  on this site are not wet; the problem is bags not filled to capacity.
  - Accepting a truck no longer suggests 5 % (damp) or 10 % (wet) from the
    bag weight. The "Take off" box starts at 0 and the reason at "Bags are
    not filled fully".
  - Next to it, the fill check is shown: the average and whether the truck
    is already paid at the lower price (for example 84.6 %, below 90 %, Rs 270
    a bag instead of Rs 300).
  - Saved settings with the old 5 % / 10 % suggestions are switched off once,
    on every device. An administrator can switch them on again in Business
    settings ("Take off for a damp/wet load"), if a wet load ever comes.
  - "Change amount taken off" on a payment, the reports, the help and the
    training say the same. Moisture is still shown for drying the bays.

## [1.8.0] — 2026-11-13

### Added

* **Help on every screen and window, hidden until asked for.** Every page has
  a "What is this page?" button at the top, and every window has a "Help"
  button in its title bar. Each opens a few short, plain sentences about what
  the page is for and what to do; "Hide help" closes it. The sign-in and
  "waiting for approval" screens have it too. The words live in
  `js/help.js` and can be edited without touching anything else.

### Changed

* **Plain English throughout.** Harder words were replaced with everyday ones,
  for example:
  - Payments: "Waiting for the supervisor", "Approved, to send to Head
    Office", "With Head Office"; buttons **Approve** and **Send to Head
    Office**; "Not paid yet", "Price per bag", "Taken off", "To pay",
    "How it is worked out".
  - Receive biomass: "Truck full, gross" and "Truck empty, tare", "Biomass
    weight, net", "Value of this load", "Lowest to highest", "Price: Use the
    fill check result", "Bag numbers (only if the bags have them)".
  - Accepting a truck: "Take money off", "Take off (%)", "Why".
  - Gasifier (was "Gasifier issue"): "Which bay to use", **Ask for bags**,
    **Weigh and feed**, "What went to the gasifier".
  - Quality problems: "How serious" (Small, Medium, Serious), "What will be
    done about it", "Supplier has been told", "Close the problem"; Open /
    Closed instead of OPEN / RESOLVED.
  - Suppliers show Active / Not active instead of ACTIVE; "Activity log"
    instead of "Audit trail"; "Load a backup" instead of "Import (merge)".
  - Simpler role descriptions and job names in Users & roles.
* The dashboard's "Empty bags in the store" now comes from the bag store
  (used + new), and the Bag registry shows numbered bags thrown away instead
  of the old "awaiting check" figure.

## [1.7.0] — 2026-11-13

### Added

* **Bag store with new and used bags** (the menu item that was "Bag
  returns"). It works by count, so bags do not need serial numbers.
  - Two shelves: **used bags** (back from the gasifier and still good) and
    **new bags** (bought in).
  - **Issue bags to a supplier:** taken from the used shelf first, topped up
    with new bags. The split is filled in and can be changed; more than is on
    a shelf is refused. The allocation slip shows used and new.
  - **At the gasifier**, the operator counts the emptied bags: good ones go
    back to the used shelf, torn ones are thrown away.
  - **Receive new bags**, **Record torn bags** (found in the store), and
    **Count the store** (a stock-take that sets the figures to what is on the
    shelves and keeps the difference in the history).
  - **Bags with suppliers:** for each supplier, bags given, bags brought back
    full, and how many they are holding now.
  - "Where every bag is": used and new in the store, with suppliers, full in
    the bays. A movements list shows every change and who made it.
  - The dashboard says when new bags run low (the level is in Business
    settings, 500 to start) and, the first time, asks for the opening count.
* **Report a problem found at the gasifier without a bag serial.** The
  gasifier issue remembers which load(s) its bags came from (oldest in the
  bay first), so a problem is traced to the right supplier. Tick the box when
  weighing, or choose the gasifier issue on the Quality screen.

### Changed

* Numbered bags emptied at the gasifier go straight back to the store (or
  are retired if torn) instead of waiting for a separate check.
* The training's bag mission now teaches the bag store, and the gasifier
  mission the counting of empty bags.

## [1.6.1] — 2026-11-13

A full check of every screen for every role, every print and every main
flow (receive → accept → authorise → release → paid, gasifier request →
approve → consume, numbering and issuing bags, quality, returns, suppliers,
settings). What it found is fixed here.

### Changed

* **Fill check sheet:** the "Total of all readings / Average / Remarks" box is
  gone; the app works out the average. A blank sheet (no bag count yet) now
  says how many boxes to fill (5 % of the bags, rounded up).
* **Bag labels follow the site agreement:** the serial, its barcode and the
  "Supplier no" box to write in. The supplier code and receipt number are no
  longer pre-printed, so a bag can go to another supplier next round.
* **Print labels for numbered bags.** After numbering a batch the label
  print opens straight away, and the Bag registry has a Print labels button
  for any range of serials (up to 1,000 per print).
* The Bag registry's "In bays" figure is now "Numbered bags in bays", since
  the bays also hold bags without serials.

### Fixed

* **The bag allocation slip left out bags:** a 300-bag round listed only 240.
  Every bag issued is now listed.
* **Labels stopped at 96:** a 160-bag load printed 96 labels. Every bag now
  gets one.
* **A load without serials printed made-up labels** (EFPL-BG-1, -2 …) with
  barcodes for bags that do not exist. It now explains that there is nothing
  to reprint and where new labels come from.
* **The payment history showed codes** (CREATED, SENT_TO_HEAD_OFFICE) on the
  payment dialog and the printed slip. It now reads Created, Authorised,
  Released to Head Office, Paid.

## [1.6.0] — 2026-11-13

### Added

* **Training academy.** A guided, game-like training for every person,
  built from what their role can do (a role the administrator has customised
  gets the matching missions too). Up to 11 missions: Welcome, Receive a
  truck, Accept a load into the bays, Bays and drying, Feed the gasifier,
  Bags and labels, Trace and quality, Pay the suppliers, Suppliers, Reports,
  Run the system, and a read-only mission for the auditor.
  - A glowing spotlight on the real button or screen, with a short card that
    explains it; some steps ask the person to tap the lit-up button.
  - Points (XP), a rank that grows with the share of missions done (New
    starter → Yard master), a badge per mission, a celebration when a mission
    is finished, and a printable certificate when they are all done.
  - Any device: a card beside the spotlight on a computer or tablet; on a
    phone a sheet at the bottom (or top), with the page scrolled so the lit-up
    part is never under it. The words say "tap" or "click" to match, and
    screens that live under "More" on a phone are shown there.
  - Safe: training only shows and opens things. It never saves a record.
  - Offered once after the first sign-in (Start training / Later), and
    always available again: account menu → Training, My account, the phone's
    More menu, and the new Training screen (Help), where any mission can be
    replayed and progress started again.

### Changed

* **The danger zone now really deletes.** "Reset this device" only cleared
  the device it was pressed on, and the app downloaded everything again from
  the cloud a moment later, so it looked as if nothing happened. Now:
  - **Delete all records everywhere** (owner only): deliveries, payments,
    bags, suppliers, gasifier issues, quality issues, returns and bag rounds
    are deleted in the cloud and on every device. Kept: staff accounts,
    business settings, the bay list (now empty) and the activity log (which
    records who did it). A backup file downloads first, and the words
    DELETE EVERYTHING must be typed. Other devices clear themselves the
    moment they hear of it, keep anything typed offline after it, and a
    device that was switched off can never bring the old records back.
    Numbering starts again at 0001. No change to the database rules needed.
  - **Re-download this device** (for fixing one device): replaces this
    device's copy with the cloud's; nothing is deleted anywhere, and it
    refuses while this device still has changes waiting to upload.

### Fixed

* **Bays showed 0 bags after a truck was accepted.** A bay only counted bags
  whose serial numbers were typed in at acceptance and already existed in the
  bag registry, so a truck accepted without serials ("0 bag serials stored")
  left its bays empty. A bay now holds what was put into it at acceptance,
  less what went to the gasifier from it, oldest load first; serials are
  tracked on top when they are captured. Loads accepted earlier appear in
  their bays straight away, because every accepted delivery kept its bay
  split. "In the yard now" on the dashboard counts the same way.
* **The gasifier issued 0 bags from a bay with no numbered bags.** Weigh and
  consume now takes the requested bags from the bay's count, and marks
  numbered bags as used only when there are some.
* The acceptance message now says how many bags went into which bays
  ("60 bags stored: BAY-20 60") instead of "0 bag serials stored".

## [1.5.2] — 2026-11-13

### Fixed

* **A half-entered truck was lost after printing the blank fill sheet.** On
  a phone or tablet, printing sends the browser to the background and the
  phone often reloads the page on the way back, which wiped everything typed
  on Receive biomass. The form now keeps a draft on the device as you type
  (fill readings and the step included), saves it the moment Print is
  pressed, and brings it back after a reload, with a short notice. The draft
  is removed when the load is registered or cleared, so it can never come
  back as a second delivery.

### Changed

* **The app keeps itself online.** Nobody has to press anything:
  - a failed sync is tried again after 3, 6, 12, 20 and then every 30 seconds;
  - the real-time link is re-opened by itself when it drops, including when
    the sign-in ticket could not be fetched yet (before, it waited for the
    tab to be switched or the network to change);
  - a link that goes silent (phone networks can drop it without saying so)
    is noticed within about a minute and a half and replaced;
  - coming back to the app, the window, or the network checks at once.
* **A calmer status chip.** Short words: Live, Saved to cloud, Reconnecting…,
  Offline. Live has a slow, soft ring; reconnecting is a gentle green pulse.
  Background checks no longer flash "Syncing…" every 30 seconds, and a passing
  network blip is never shown in red. Red is kept for the one thing a person
  must fix (sign in again, or the cloud refusing access). A single quiet note
  appears if the device stays offline, and "Back online" when it returns;
  a blip of a few seconds shows nothing. Animations respect the phone's
  reduced-motion setting.

### Tests

* New `tests/online-test.js` (part of `npm test`): a pretend cloud and live
  link are taken away and given back, dropped, and left silent; 15 checks that
  the app reconnects by itself and the chip stays calm. The smoke test gains
  two checks for the Receive-form draft (146 checks).

## [1.5.1] — 2026-11-13

From the owner's WhatsApp list of 12 November.

### Added

* **Bays: 30 bays of 200 bags** are created the first time the yard opens.
  Every bay can be renamed, resized or removed (when empty), and more added.
* **Tap a bay** to see everything about it now: bags in it, today's moisture,
  today's bag weight, the oldest load, and each load with its arrival and
  today's weight. A bag can be weighed from the bay to replace the estimate.
* **Bay history** (button in the bay): every load in and every issue out,
  with bag weight and **moisture** each time, totals in and out, printable.
* **Drying**: a bag is taken to lose 0.6 kg a day in the bay (50 kg becomes
  about 30 kg in a month), down to 18 kg. Editable in Business settings.
* **Dry bays are shown red** ("Dry, use first", at or below 25 % moisture),
  with a filter and a count on the Bays screen.
* **Printable blank fill-check sheet** on Receive biomass step 3: one box per
  sample bag, to fill in by hand at the drum and type in afterwards. After the
  fill check the supervisor goes straight on to choosing the bays.
* **Invoice** for every accepted load, with the supplier's bank details.
* **Supplier search** and **New supplier** on Receive biomass, and a search
  bar on the Suppliers screen (name, code, phone, village, account).
* **Remove a user** from Administration → Users & roles. They are signed out
  everywhere; their records stay; the same email can be added again later.

### Changed

* **Bank details** are shown when a load is accepted into the bays, and are
  printed on the receipt, invoice, payment slip and supplier statement.
* **The logo is on every print** (receipts, invoices, labels, slips,
  statements, fill sheets, bay history, reports).
* **The fill check must have the whole 5 % sample**, rounded up, with no
  minimum of 3 bags, both on paper and in the system.
* **Default deduction reason** is "Bags are not filled fully". When the load
  reads damp or wet, the moisture wording is offered under the box instead.
* The site is **Balangoda** everywhere; older saved settings are moved over.

### Removed

* The **Farmers** screen and the farmer declaration step before payment.
* The Sinhala + English (two-language) text.

### Fixed

* The single-file build (`npm run build`) left the service-worker start-up in
  place when the files had Windows line endings, so the bundle asked for a
  `sw.js` that is not there. The build now removes it either way, and stops
  with an error if it ever fails to.

### Tests

* The smoke test follows the changes above (no farmers, full 5 % sample,
  default reason, suggested bay split) and has 14 new checks for the owner's
  list: 30 × 200 bays, resizing, drying, red dry bays, bay details and
  history, the blank fill sheet, the logo on every print, bank details,
  supplier search, removing a user, no Farmers screen, no Sinhala text.
  144 checks pass.

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
