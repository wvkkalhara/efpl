# Bag Tagging & Serial Procedure (SOP)

**Scope:** every biomass bag that enters or leaves the EnerFab biomass store.
**Agreed position (WhatsApp, Nov 2026):** a bag carries **a serial number only**. The supplier writes his own number and the farmer's registration number in the blank box on the tag. No name is printed on the tag, ever.

---

## 1. The number

```
EFPL-BG-000001
└──┬─┘ └┬┘ └─┬──┘
   │    │    └── 6-digit sequence  → 999 999 bags before we ever need a new prefix
   │    └───────  BG = Bag
   └──────────── company prefix
```

* One number per bag, for the life of the bag.
* **Never reuse a number.** A retired bag keeps its number and its record.
* Numbers are issued **by the system**, before the bags leave the store. A supplier never chooses a number.
* The number is duplicated as a **Code 39 barcode** on the sticker so a scanner can read it later. The human-readable number is printed large; the barcode is a convenience, not a requirement.

---

## 2. The sticker

Printed from **Bag registry → Print bag labels** (or from a delivery → *Print bag labels*).

| Field | Purpose |
|---|---|
| `EnerFab Biomass` (green) | Owner mark |
| **Serial, large mono type** | The identifier a person reads at the gate |
| Code 39 barcode | Scanner input; hand-typable if the scanner fails |
| `Supplier: SUP-0004` | Which supplier's round this bag belongs to |
| `Receipt: RC-2026-0003` | The delivery it arrived with |
| **Farmer reg. no:** ____________ | Written by the supplier in marker |
| **Supplier no.:** ______________ | Written by the supplier in marker |

Size: 70 × 45 mm, printed 24 per A4 sheet (or 96-up mini sheets). Ordinary laser printer, ordinary sticker stock. **No special printer is needed.**

---

## 3. Who does what

### 3.1 Store keeper — before the round

1. Open **Bag registry → Number new bags**, enter the quantity (e.g. 5 000), confirm the prefix.
2. Print the label sheets and fix a sticker to **every** bag.
3. Open **Bag registry → Issue to supplier**: choose the supplier, the round number and how many bags. The system allocates the next free serials.
4. Print the **allocation slip** — it lists every serial and has a blank column for the farmer number.
5. Give the supplier the slip (and a photo on WhatsApp). The round is now recorded against that supplier.

### 3.2 Supplier — while filling

1. Fill the bag as agreed (full, not slack).
2. Write the **farmer registration number** in the first box — the farmer whose biomass is in *that* bag.
3. Write his own **supplier number** in the second box.
4. Load the truck. Bags without a sticker or a written farmer number are not accepted.

### 3.3 Store keeper — at the gate

1. **Receive biomass**: supplier, vehicle, driver, biomass type.
2. Gross / tare from the weighbridge, then the **bag count**.
3. Fill check on the random sample (see the requirements review).
4. Capture the serials: scan them, or paste the range `EFPL-BG-003001-003480`.
   * The app checks the count against the bag count.
   * **It refuses a serial that is already in the store** — this is the duplicate guard.
   * Serials that are not in the registry are flagged, not invented.
5. Supervisor accepts, allocates the bays, and a payment is created automatically.
6. Print the receipt (A4) for the supplier.

### 3.4 Gasifier operator — at consumption

1. Request biomass; the supervisor approves the bay (based on the bag-weight check).
2. Weigh three bags as they go in. The average is applied to the whole issue.
3. If the biomass behaves badly, raise a **quality issue from the bag serial** — the supplier and farmer are attached automatically.

### 3.5 Empty bags — the return

1. Empty bags come back to the bag store.
2. **Bag returns**: count them, split into good / repairable / beyond repair.
3. Good bags return to stock with their original number and can be issued again.
4. Repairable bags raise a repair order; beyond-repair bags raise a replacement order.
5. A bag that never comes back is visible as **lost** — chase it.

---

## 4. Rounds, and the "second round" problem

A **round** is one issue of a numbered set of bags to one supplier.

```
Round 1  →  SUP-0001  →  EFPL-BG-000001 … 000300   →  returned, refilled
Round 2  →  SUP-0002  →  EFPL-BG-000301 … 000480   →  in the field
Round 3  →  SUP-0001  →  EFPL-BG-000001 … 000300   →  same bags, new round
```

The concern raised on WhatsApp was that a farmer *and* a supplier can both be registered, which makes distribution in the second round complicated. With serial-only tags:

* the bag does not care who holds it — only the **round record** says who it was issued to;
* the **farmer link is captured per delivery** (written on the tag + declared at payment), so the same bag can carry a different farmer's biomass in the next round without a reprint;
* the bag's own history keeps every round it has been through, so a complaint about a bag from three months ago still resolves to the right supplier and farmer **for that round**.

**Rule of thumb:** if a bag's farmer box is unreadable or empty at the gate, the store keeper asks the supplier then and there, and records it in the farmer declaration. Never guess.

---

## 5. Exceptions

| Situation | What to do |
|---|---|
| **Sticker lost or illegible** | Do not re-stick a new number. Read the barcode, or find the bag by its round, and re-mark the same serial by hand in permanent marker. Record the re-mark in the delivery notes. |
| **Duplicate serial at the gate** | Stop. Two bags cannot share a number. Quarantine the bag, record the supplier, and raise a quality issue. This is the only error that cannot be repaired later. |
| **Bag beyond repair** | Retire it in the app (status `RETIRED`). Its number is never reissued. |
| **Supplier brings unnumbered bags** | Accept only if the supervisor approves, register the delivery with serials left blank, and flag it as *untraceable*. Chase numbering before the next round. |
| **Bag found in the yard with no record** | Search the serial. If unknown, treat as untraceable stock and record it as an adjustment — do not silently add it to a bay. |
| **Scanner not working** | Paste the serial range into the box. Ten seconds, no typing. |

---

## 6. Training one-pager (pin this in the store)

> **One bag, one number, for life.**
> 1. Number and stick **before** the bag leaves.
> 2. Supplier writes the **farmer number** and **his number** on the tag.
> 3. At the gate: weigh, count, sample, **scan the numbers**.
> 4. Supervisor allocates the bay — bags must add up.
> 5. Operator weighs three bags, writes nothing, records in the app.
> 6. Empty bags come back; count them and record the damages.
> **Never** reuse a number. **Never** accept an unnumbered bag without the supervisor.

---

## 7. Preparing 5 000 bags in one day — checklist

- [ ] Label stock in hand (5 000 labels ≈ 209 A4 sheets at 24-up) and a laser printer with toner
- [ ] Print from the app: *Number new bags → 5 000* → then *Print labels* in batches of 500 (a stuck printer should not cost the whole run)
- [ ] Two people: one prints and cuts, one peels and fixes — ~600 bags/hour per person
- [ ] Keep the printed serial list per round; photograph it and send it to the supplier on WhatsApp
- [ ] Register the issue round in the app **before** the bags physically leave
- [ ] Store the numbered bags by round in the bag store, not mixed with unnumbered stock
- [ ] Marker pens (permanent, fine tip) — one per supplier, supplied by EnerFab, so the writing is legible
- [ ] If the printer fails: number by hand from the allocation slip, in sequence, and record it. A hand-written serial is valid; a missing serial is not.
