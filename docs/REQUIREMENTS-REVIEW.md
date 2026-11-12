# Biomass Storage Software — Requirements Review & Commentary

**Prepared for:** EnerFab (Pvt) Ltd — Biomass Storage, Nawagaththegama
**For:** Mr. Kaniska (development) · Biomass Supervisor · Management
**Version:** 1.0 · 9 November 2026
**Source documents:** *Biomass Storage software Requirements (1).txt* (15 points) and the WhatsApp thread on bag numbering
**Companion:** working web app in this folder (`index.html`, `dist/EnerFab-Biomass-Storage.html`)

---

## 1. Short answer

**Yes — this can be done, and it is not too much.** All fifteen points describe a single, coherent flow that runs on one identifier: **the bag serial number**. Once every bag has a number before it leaves the store, points 11, 12 and 13 stop being three separate features and become one lookup.

What *is* "too much" is only the part that has no written agreement behind it. Three things need a decision on paper before go-live, and they are all commercial rather than technical:

| # | Needs a written decision | Why it blocks the software |
|---|---|---|
| A | The exact fill-check rule (sample size, measuring drum, who measures, what happens at 89 % vs 91 %) | This number changes what a supplier is paid. It must be defensible in a dispute. |
| B | Who signs the farmer declaration and when (supplier at the gate, or supplier before payment release) | Requirement 10 makes the payment conditional on it; somebody has to own the truth of that list. |
| C | Moisture policy — bag weight is the accepted measure (moisture % = 40/18 × kg − 20); what are the damp/wet limits and the deduction for each | Requirements 5 and 6 depend on it; without numbers, "wet biomass" is an argument, not a rule. |

The app is built with defaults for all three (90 % / Rs 300 → Rs 270 · declaration before release · 30 % damp, 45 % wet; wet loads are received with a % deduction, never rejected) and **every one of them is editable in Administration → Business settings**, so a decision tomorrow is a settings change, not a code change.

---

## 2. Point-by-point commentary

### 1. Suppliers, farmers and who collects from whom ✅ Built
The system keeps a supplier register and a farmer register, with each farmer attached to the supplier who collects from them. Farmers can be reassigned; history stays intact because deliveries and bags keep the supplier and farmer of record.

**Comment:** one gap in the wording — it assumes one farmer belongs to one supplier. In the field a farmer often sells to two collectors in the same season. The data model already allows it (a bag records both the supplier of the delivery *and* the farmer declared for that bag), so nothing breaks if that becomes the practice. **Question:** do we allow a farmer to be listed under two suppliers?

### 2. Weighing, bag count, random bag check ✅ Built
Gross, tare and net are captured with a weighbridge slip number, the bag count is entered separately, and the system immediately shows **average kg per bag** — which is the first moisture signal (point 5).

**Comment:** please confirm the weighbridge readings are entered by hand from the slip, or whether the indicator has a serial/network output. If it has an output, the reading can be captured directly and the single biggest source of clerical error disappears.

### 3. Fill check and the price adjustment ✅ Built — **needs agreement (A)**
The app samples the agreed percentage of bags (default 5 %, minimum 3), records each fill height in the drum, computes the average and applies the agreement:

| Average fill | Decision | Unit price |
|---|---|---|
| ≥ 100 % | Pass | Rs 300 |
| 90 – 99 % | Pass (marginal, noted) | Rs 300 |
| below 90 % | Reduced price for the whole batch, **or** the supplier re-fills and the bags are counted and sampled again | Rs 270 |
| any load | Never rejected. Wet or poor biomass is received and the supervisor deducts a % at acceptance | % off the batch value |

A supervisor can override to full price, but only with a written reason, and every override is written to the audit trail.

**Comment — this is the point most likely to cause an argument at the gate.** Three things make it defensible:
1. the sample must be *actually random*, so the app prompts for a sample count and the supervisor picks the bags from the truck, not from the top layer;
2. the drum must be the same drum every time, and it should be marked with a scale (a strip of tape with 10 % graduations is enough);
3. the supplier must see the reading and sign the receipt — which the printed receipt already provides for.

**Question:** when the average falls between 70 % and 89 %, is the *whole batch* paid at Rs 270, or only the under-filled bags? The app currently applies one unit price to the whole batch, which is what the requirement says. The alternative (pay per-bag by sample result) is harder to explain and impossible to verify at the gate.

### 4. Acceptance, bay allocation, bags per bay ✅ Built
On acceptance the supervisor allocates the bags across one or more bays; the counts must add up exactly to the bags counted at the gate, and the system refuses to over-fill a bay beyond its capacity. Bay stock is then *derived* from the bag serials in that bay, so it corrects itself every time a bag leaves.

**Comment:** the requirement says "if the quantity is in 3 bays, there should be a record of how many bags in each bay". Because each bag has a serial, we get something stronger: not just *how many*, but *which ones*. That matters at point 11.

### 5. Gasifier issue with supervisor approval ✅ Built
The operator raises a request; the supervisor approves it and, at that moment, sees the average bag weight and estimated moisture for **every** bay, so the decision is made on data rather than memory. The approval note is stored.

**Comment:** bag weight is a good proxy but a poor measurement — it mixes moisture with bag size and species. If EnerFab buys even one moisture meter (a cheap capacitance probe is around Rs 25,000–40,000), the app can record the meter reading next to the weight and the proxy becomes a cross-check instead of the primary evidence. Worth doing before the next wet season.

### 6. Weighing at consumption ✅ Built
The operator weighs three bags as they go in; the average of those three is applied to the whole issue, and the outgoing weight is recorded as `average × bags`.

**Comment:** three bags on a 40-bag issue is a 7.5 % sample — fine for the monthly figure, weak for a single day. It is exactly what the requirement asks for, so it is implemented as written; if the concern is moisture disputes, weigh five on a random day each week and compare.

### 7. Incoming vs outgoing weight and bags ✅ Built
Every report shows bags and kilograms in, bags and kilograms out, the net movement and the implied store loss. This is the number that catches theft, spillage and moisture loss in one figure.

### 8. Three or four biomass types ✅ Built
Seeded with the species EnerFab actually handles: **Gliricidia, Ipil Ipil, cinnamon waste, timber off-cuts, coconut shell**, plus "mixed / other approved". Each type carries a rate factor so a premium fuel can be priced differently without changing the app.

### 9. Payment generated on acceptance, authorised by supervisor, sent to Head Office ✅ Built
Acceptance automatically creates the payment at the unit price decided by the fill check. The flow is enforced in this order:

`DRAFT` → `PENDING SUPERVISOR` → `APPROVED` → `SENT TO HEAD OFFICE` → `PAID`

The app refuses to skip a step, and every step records who did it and when. A payment slip prints with signature blocks for prepared-by, supervisor and Head Office accounts.

**Comment:** requirement 9 says the supervisor authorises; requirement 10 says the farmer list must arrive before release. The app therefore treats the payment as **draft until the farmer declaration is complete**, so the supervisor cannot authorise something that is not yet supported.

### 10. Farmer list before payment ✅ Built — **needs decision (B)**
The supplier (or the store keeper on his behalf) enters bags per farmer; the total must equal the bags delivered, or the app will not move the payment forward. If the supplier is also a farmer, he is registered as both and can appear in the list.

**Comment — the practical difficulty:** a supplier with 40 farmers will not stand at the gate filling a form. Two workable options:
- **Option 1 (recommended):** the supplier sends the farmer list on WhatsApp *before* the truck leaves, the store keeper types it while the truck is being weighed. Release depends on it — which is exactly the pressure the requirement intends.
- **Option 2:** allow a provisional split (e.g. 100 % to the supplier) and require the farmer list before the *next* delivery is accepted. Softer, but weaker.

The app currently supports Option 1 and can be switched to Option 2 with a settings change. **Question:** which one does management want?

### 11. Traceability of a problem back to supplier and farmer ✅ Built
Type a serial (or the last four digits) and the app shows: the issue round and date, the supplier, the farmer declared for that bag, the weighbridge receipt and net weight, the bay, the gasifier run that consumed it, the moisture reading at consumption, and the payment it was included in. A quality issue is raised *from* that chain, so the supplier and farmer are attached automatically.

**Comment:** this is the requirement the serial number exists for. Without the number, "we know approximately where it came from" is all you can ever say.

### 12. Receipt number and printed sticker ✅ Built
Each delivery gets a receipt number (`RC-2026-0001`). The app prints:
- a **receipt** (A4) for the supplier, with the fill-check readings and signature blocks;
- **bag stickers** (70 × 45 mm, 96-up sheets) carrying the serial, a Code 39 barcode, the supplier code and the receipt number.

**Comment:** stickers print on plain A4 sticker sheets from any laser printer. The barcode matters more than it looks: a Rs 6,000 handheld scanner turns gate entry from typing 300 serials into 300 trigger pulls, and removes mistyping entirely. Until then, the app accepts a pasted range (`EFPL-BG-000301-000480`) which is nearly as fast.

### 13. Supplier marks supplier number and farmer number on the tag ✅ Built — as designed in the WhatsApp thread
The sticker has two dashed write-in boxes: *farmer registration no.* and *supplier no.* The supplier writes them with a permanent marker as he fills the bags. The app never forces a reprint when a bag changes hands.

### 14. Bag returns, damage, repair, replacement order ✅ Built
Empty bags come back, are checked, and are recorded as good (returned to stock), repairable (repair order raised) or beyond repair (replacement quantity ordered). Bags are tracked individually by serial, so a bag that never comes back is visible as *lost* rather than silently missing.

### 15. Reports ✅ Built
In/out weights and bags, stock by bay, supplier performance (bags, average fill, value, quality issues), payment register, bag lifecycle and loss. All exportable to CSV and printable.

---

## 3. The WhatsApp thread — is the tagging approach workable?

The messages settle on this: **bags carry a serial number only**, fixed to the bag before it goes to the supplier, and the **supplier writes his number and the farmer's registration number on the bag** at delivery. The problem raised is that if a farmer and a supplier are both registered, distributing bags in the second round becomes difficult.

**It works, and serial-only is the right choice.** The reasoning, in the order the messages raise it:

1. **One number, one bag, forever.** If the sticker carried the farmer's name, every change of hands needs a reprint — and reprints are where traceability dies. A blank write-in box costs nothing and survives the second round.
2. **The serial is registered in the system before issue**, against the supplier and the round. That is what makes the tag trustworthy: the number is not chosen by the supplier, it is already in the book.
3. **The farmer link is captured twice** — once in marker pen on the tag, and once in the farmer declaration at payment (point 10), which is the copy that matters when the money moves.
4. **Second-round difficulty is a distribution problem, not a numbering problem.** The app solves it by keeping *rounds*: each issue has a round number, a supplier and a serial range. `EFPL-BG-000301 – 000480` went out in round 2 to one supplier; if those bags come back for a third round, they are simply issued again in a new round, and the bag's history shows both.

**Five thousand bags tomorrow** — what to do, in order:

1. Print the serials in the app (Bag registry → Number new bags → 5 000). It produces `EFPL-BG-000001 … EFPL-BG-005000` in one step and labels in A4 sheets.
2. Fix stickers to the bags **before** they are handed to suppliers. A bag without a sticker does not leave the store.
3. Record the issue round per supplier in the app and print the **allocation slip** (it lists every serial and has a blank column for the farmer number). Give a copy to the supplier; photograph it and send it on WhatsApp.
4. At the gate, capture the serials (scan, or paste the range) and record which bay.
5. Supplier writes farmer no. + supplier no. on each tag as he fills. Where he does not, the declaration at payment still captures it.

**Feasibility of printing and fixing 5 000 tags:** at roughly 600 labels per hour for one person (print, peel, stick), that is ~8 person-hours — a two-person job for one working day. If that is too slow for tomorrow, a workable fallback is to number **only** what goes out in the first round (e.g. 2 000), and let the rest carry the plain number in marker until stickers are printed. The system accepts hand-written serials as long as they are unique and recorded, because the serial is data, not artwork.

**One rule that must not be broken:** never reuse a serial, and never issue a bag that has no number. A duplicate number is the only failure that cannot be repaired afterwards.

---

## 4. Gaps I would add to the requirement document

These are not in the fifteen points but will be asked for within a month of go-live:

| Gap | Why it matters | In the app? |
|---|---|---|
| **Duplicate-serial check at the gate** | The one unrecoverable error | ✅ Refuses a serial already stored |
| **Who received the truck** | Accountability at the gate | ✅ `receivedBy` on every delivery |
| **Weight loss in store** | Catches theft, spillage, moisture loss | ✅ Reports |
| **Supplier quality score** | Basis for the next contract | ✅ Average fill + issues per supplier |
| **Price history** | Disputes are about "the rate at the time" | ⚠ Today the price is frozen on each payment; a full rate-history table is a Phase 2 item |
| **Bag cost** | Bags are an asset; loss is real money | ⚠ Counted, not yet valued |
| **Night shift / two operators** | Who consumed what | ✅ Each issue records its operator |
| **Deduction instead of rejection** | Loads are never turned away | ✅ Supervisor enters a % and a reason at acceptance; it prints on the receipt and payment slip |
| **Moisture meter readings** | Replaces the weight proxy | ⚠ Field exists for weight only; meter field is Phase 2 |
| **Data protection (Sri Lanka PDPA)** | Farmers' NIC and phone are personal data | ✅ See security document; no NIC is shown to operators |

---

## 5. Questions for the reply (copy into WhatsApp)

1. **Fill rule:** is the whole batch paid at Rs 270 when the average is 70–89 %, or only the under-filled bags? *(Currently: whole batch.)*
2. **Farmer declaration:** must it be complete before *this* payment is released, or before the *next* delivery is accepted?
3. **Moisture:** do we accept bag weight as the official proxy until a meter is bought, and are 30 % / 45 % the right damp and wet limits, and what % is deducted at each?
4. **Multiple suppliers per farmer:** allowed or not?
5. **Weighbridge:** is the reading typed by hand, or does the indicator have an output we can read directly?
6. **Who measures the fill check** — store keeper, supervisor, or both? (The app records whoever is signed in.)
7. **Bag ownership:** are numbered bags EnerFab property that must come back, and is a lost bag charged to the supplier?
8. **Payment sign-off:** is the supervisor's authorisation enough for Head Office, or does a second signature (manager) apply above a value?

---

## 6. How the build maps to the fifteen points

| Req | Screen in the app | Test in `tests/smoke-test.js` |
|---|---|---|
| 1 | Suppliers · Farmers | seeded registers |
| 2 | Receive biomass (step 2) | net = gross − tare; average per bag |
| 3 | Receive biomass (step 3) | price rule at 95 %, 84 %, 60 %; override |
| 4 | Accept & allocate bay | allocation totals; bay stock consistency |
| 5 | Gasifier issue (approve) | bays listed with moisture |
| 6 | Gasifier issue (weigh & consume) | three-bag average; out weight |
| 7 | Dashboard · Reports | in vs out |
| 8 | Business settings · seeded types | Gliricidia etc. |
| 9 | Payments | state machine refuses skipped steps |
| 10 | Declare farmer split | split must equal bags |
| 11 | Trace a bag · Quality issues | serial → supplier → farmer → run |
| 12 | Print receipt · Print labels | receipt + Code 39 stickers |
| 13 | Bag labels (write-in boxes) | — |
| 14 | Bag returns | good / repaired / replaced |
| 15 | Reports (CSV + print) | — |

Everything in this table is implemented and covered by the automated checks in `tests/smoke-test.js`.
