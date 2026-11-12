/* =====================================================================
   seed.js — first-run demo data.
   ---------------------------------------------------------------------
   A brand-new install with an empty database is impossible to evaluate,
   so the first run fills it with a realistic three-week site history.
   Everything here is clearly marked demo=true and can be wiped from
   Administration → Danger zone without touching real records.
   ===================================================================== */
(function () {
  'use strict';
  const Store = window.Store;
  const D = window.Domain;

  const now = Date.now();
  const ago = (days, hours = 9) => {
    const d = new Date(now - days * 864e5);
    d.setHours(hours, Math.floor(Math.random() * 50), 0, 0);
    return d.toISOString();
  };

  const SUPPLIERS = [
    ['K. M. Bandara', '781234567V', '077 123 4567', 'Nawagaththegama'],
    ['P. Gunasekara', '196512345678', '071 445 8890', 'Anamaduwa'],
    ['S. Wickramasinghe', '823456789X', '076 220 1145', 'Puttalam'],
    ['M. Fernando & Sons', '901234567V', '077 998 7712', 'Chilaw'],
    ['A. Rathnayake', '198022334455', '072 331 6678', 'Galgamuwa'],
    ['N. Perera', '750998877V', '070 556 3321', 'Anuradhapura'],
    ['H. Dissanayake', '880123456V', '077 660 9921', 'Kurunegala'],
    ['J. Silva & Sons', '941122334V', '071 889 0034', 'Mahawa'],
  ];

  const FARMERS = [
    ['R. M. Jayasundara', 'F1', 'Nawagaththegama', 0], ['B. G. Somapala', 'F1', 'Nawagaththegama', 0],
    ['T. Ranasinghe', 'F1', 'Thabbowa', 0], ['L. Kumara', 'F1', 'Karuwalagaswewa', 0],
    ['W. A. Manike', 'F2', 'Anamaduwa', 1], ['C. Weerasinghe', 'F2', 'Anamaduwa', 1],
    ['D. Munasinghe', 'F2', 'Nawagaththegama', 1], ['K. P. Herath', 'F3', 'Puttalam', 2],
    ['S. Abeywickrama', 'F3', 'Palavi', 2], ['G. Nandasena', 'F4', 'Chilaw', 3],
    ['M. S. Farook', 'F4', 'Madampe', 3], ['E. Bandaranayake', 'F5', 'Galgamuwa', 4],
    ['U. P. Dharmadasa', 'F6', 'Anuradhapura', 5], ['V. Kumarasiri', 'F7', 'Kurunegala', 6],
    ['I. Chandrasena', 'F8', 'Mahawa', 7], ['X. P. Warnakulasuriya', 'F8', 'Mahawa', 7],
  ];

  function ensure() {
    if (Store.data.meta.seeded) return false;
    if (Store.all('suppliers').length || Store.all('deliveries').length) {
      Store.data.meta.seeded = true;
      Store.save('seeded-flag');
      return false;
    }

    const settings = Store.settings();

    /* ------------------------------ staff ---------------------------- */
    const staff = [
      ['kasun.perera@efpl.org', 'Kasun Perera', 'admin'],
      ['nimal.silva@efpl.org', 'Nimal Silva', 'supervisor'],
      ['chaminda.raj@efpl.org', 'Chaminda Rajapaksha', 'storekeeper'],
      ['sunil.ops@efpl.org', 'Sunil Herath', 'operator'],
      ['accounts@efpl.org', 'EnerFab Accounts', 'accounts'],
      ['audit@efpl.org', 'Internal Audit', 'auditor'],
    ];
    for (const [email, name, role] of staff) {
      if (!Store.all('users').some((u) => u.email === email)) {
        Store.add('users', { email, name, role, active: true, demo: true }, 'seed');
      }
    }

    /* ------------------------------ bays ----------------------------- */
    const bays = [];
    for (let i = 1; i <= settings.bayCount; i++) {
      bays.push(Store.add('bays', {
        code: `BAY-${i}`, name: `Bay ${i}`, capacityBags: i <= 4 ? 900 : 600,
        demo: true, note: i > 4 ? 'Reserve bay' : '',
      }, 'seed'));
    }

    /* --------------------------- suppliers --------------------------- */
    const suppliers = SUPPLIERS.map((s, i) => Store.add('suppliers', {
      code: `SUP-${String(i + 1).padStart(4, '0')}`,
      name: s[0], nic: s[1], phone: s[2], address: s[3],
      isFarmer: i === 0 || i === 5,          // req 10: a supplier may also be a farmer
      farmerCode: i === 0 ? 'F1' : i === 5 ? 'F6' : null,
      status: 'ACTIVE', bank: i % 3 === 0 ? 'BOC · 0071234567' : i % 3 === 1 ? 'Commercial Bank · 8001234567' : 'People\'s Bank · 1122334455',
      demo: true,
    }, 'seed'));

    /* ---------------------------- farmers ---------------------------- */
    const farmers = FARMERS.map((f, i) => Store.add('farmers', {
      code: `FRM-${String(i + 1).padStart(4, '0')}`,
      name: f[0], farmerNo: f[1], village: f[2],
      supplierId: suppliers[f[3]] ? suppliers[f[3]].id : null,
      nic: i % 2 === 0 ? `${700000000 + i * 1234567}V`.slice(0, 10) : `19${70 + i}12345678`.slice(0, 12),
      phone: `07${i % 7}${String(1000000 + i * 91357).slice(0, 7)}`,
      landAcres: 1 + (i % 5), status: 'ACTIVE', demo: true,
    }, 'seed'));

    /* ------------------------- bag stock (serials) ------------------- */
    const PREFIX = settings.bagSerialPrefix;
    const TOTAL_BAGS = 1200;
    const bagRecs = [];
    for (let i = 1; i <= TOTAL_BAGS; i++) {
      bagRecs.push({ serial: D.bagSerial(PREFIX, i), n: i, status: 'IN_STOCK', demo: true, condition: 'GOOD' });
    }
    Store.bulkAdd('bags', bagRecs, 'seed-bags');
    const bagByN = (n) => Store.all('bags').find((b) => b.serial === D.bagSerial(PREFIX, n));

    /* --------------------------- deliveries -------------------------- */
    // 1) 300 bags, three bays, full price — the req 4 worked example.
    const d1 = Store.add('deliveries', {
      receiptNo: 'RC-2026-0001', supplierId: suppliers[0].id, biomassType: 'GLIRICIDIA',
      vehicleNo: 'WP LH-4521', driverName: 'R. Bandara', driverNic: '781234567V',
      grossKg: 8120, tareKg: 1860, netKg: 6260, bagCount: 300,
      fillCheck: D.evaluateFillCheck({ bagCount: 300, fills: [96, 94, 98, 95, 97], settings }),
      allocations: [], farmerSplit: [], status: 'ACCEPTED',
      deliveredAt: ago(3, 8), acceptedAt: ago(3, 10), acceptedBy: 'nimal.silva@efpl.org',
      weighbridgeSlip: 'WB-8841', demo: true, notes: 'Three bays used — 1, 2 and 3.',
    }, 'seed');

    const issue1 = Store.add('bagIssues', {
      roundNo: 1, supplierId: suppliers[0].id, qty: 300, mode: 'SERIAL_ONLY',
      serials: D.serialRange(PREFIX, 1, 300), issuedAt: ago(6, 8), issuedBy: 'chaminda.raj@efpl.org',
      sharedWith: 'Printed allocation slip + WhatsApp', demo: true,
    }, 'seed');

    const alloc1 = [{ bayId: bays[0].id, bayCode: 'BAY-1', bags: 120 }, { bayId: bays[1].id, bayCode: 'BAY-2', bags: 100 }, { bayId: bays[2].id, bayCode: 'BAY-3', bags: 80 }];
    Store.update('deliveries', d1.id, {
      allocations: alloc1,
      farmerSplit: [
        { farmerId: farmers[0].id, code: farmers[0].code, name: farmers[0].name, bags: 120 },
        { farmerId: farmers[1].id, code: farmers[1].code, name: farmers[1].name, bags: 90 },
        { farmerId: farmers[2].id, code: farmers[2].code, name: farmers[2].name, bags: 60 },
        { farmerId: farmers[3].id, code: farmers[3].code, name: farmers[3].name, bags: 30 },
      ],
      bagIssueId: issue1.id,
    }, 'seed');

    // 2) 180 bags, fill check failed -> reduced price, awaiting supervisor.
    const d2 = Store.add('deliveries', {
      receiptNo: 'RC-2026-0002', supplierId: suppliers[1].id, biomassType: 'GLIRICIDIA',
      vehicleNo: 'NW JD-7788', driverName: 'S. Fernando', driverNic: '823456789X',
      grossKg: 5900, tareKg: 2050, netKg: 3850, bagCount: 180,
      fillCheck: D.evaluateFillCheck({ bagCount: 180, fills: [82, 85, 86, 83, 84, 87], settings }),
      allocations: [{ bayId: bays[3].id, bayCode: 'BAY-4', bags: 180 }],
      farmerSplit: [
        { farmerId: farmers[4].id, code: farmers[4].code, name: farmers[4].name, bags: 100 },
        { farmerId: farmers[5].id, code: farmers[5].code, name: farmers[5].name, bags: 80 },
      ],
      status: 'ACCEPTED', deliveredAt: ago(2, 9), acceptedAt: ago(2, 11), acceptedBy: 'nimal.silva@efpl.org',
      weighbridgeSlip: 'WB-8856', demo: true,
      notes: 'Average fill 84.5% — supplier agreed to the reduced unit price.',
    }, 'seed');

    // 3) 240 bags in bay 4, paid and sent to Head Office.
    const d3 = Store.add('deliveries', {
      receiptNo: 'RC-2026-0003', supplierId: suppliers[3].id, biomassType: 'CINNAMON',
      vehicleNo: 'CP KA-1290', driverName: 'M. Farook', driverNic: '901234567V',
      grossKg: 7300, tareKg: 2210, netKg: 5090, bagCount: 240,
      fillCheck: D.evaluateFillCheck({ bagCount: 240, fills: [99, 97, 98, 100], settings }),
      allocations: [{ bayId: bays[4].id, bayCode: 'BAY-5', bags: 240 }],
      farmerSplit: [
        { farmerId: farmers[9].id, code: farmers[9].code, name: farmers[9].name, bags: 140 },
        { farmerId: farmers[10].id, code: farmers[10].code, name: farmers[10].name, bags: 100 },
      ],
      status: 'ACCEPTED', deliveredAt: ago(5, 7), acceptedAt: ago(5, 9), acceptedBy: 'nimal.silva@efpl.org',
      weighbridgeSlip: 'WB-8822', demo: true,
    }, 'seed');

    // 4) Today: truck waiting, not yet accepted.
    Store.add('deliveries', {
      receiptNo: 'RC-2026-0004', supplierId: suppliers[6].id, biomassType: 'CINNAMON',
      vehicleNo: 'NW PB-3311', driverName: 'H. Dissanayake', driverNic: '880123456V',
      grossKg: 6450, tareKg: 1900, netKg: 4550, bagCount: 200,
      fillCheck: D.evaluateFillCheck({ bagCount: 200, fills: [93, 91, 88], settings }),
      allocations: [], farmerSplit: [], status: 'AWAITING_ACCEPTANCE',
      deliveredAt: ago(0, 7), weighbridgeSlip: 'WB-8893', demo: true,
      notes: 'Bags delivered; verification of a count and quality still pending.',
    }, 'seed');

    // 5) A wet load. Nothing is sent back: it is received and 10% is deducted.
    const wet = D.applyDeduction(160, 300, 10);
    const d5 = Store.add('deliveries', {
      receiptNo: 'RC-2026-0005', supplierId: suppliers[4].id, biomassType: 'OTHER',
      vehicleNo: 'NW GH-9021', driverName: 'A. Rathnayake', driverNic: '198022334455',
      grossKg: 6900, tareKg: 2000, netKg: 4900, bagCount: 160,
      fillCheck: D.evaluateFillCheck({ bagCount: 160, fills: [93, 95, 92], settings }),
      allocations: [{ bayId: bays[5].id, bayCode: 'BAY-6', bags: 160 }],
      farmerSplit: [{ farmerId: farmers[11].id, code: farmers[11].code, name: farmers[11].name, bags: 160 }],
      status: 'ACCEPTED', deliveredAt: ago(4, 11), acceptedAt: ago(4, 13), acceptedBy: 'nimal.silva@efpl.org',
      deductionPct: wet.deductionPct, deductionAmount: wet.deductions, payableAmount: wet.netAmount,
      deductionReason: 'Wet load: 30.6 kg per bag reads 48% moisture',
      weighbridgeSlip: 'WB-8830', demo: true,
      notes: 'Received wet after rain. Kept in the reserve bay to dry before use.',
    }, 'seed');

    // Average bag weight is what the moisture reading comes from.
    for (const d of Store.all('deliveries')) {
      if (!d.avgBagKg) d.avgBagKg = D.avgBagWeight(d.netKg, d.bagCount);
    }

    /* --------------------- assign bag serials ------------------------ */
    function assignRange(from, to, patch) {
      for (let i = from; i <= to; i++) {
        const b = bagByN(i);
        if (b) Object.assign(b, patch);
      }
    }
    const batch2Start = 301, batch2End = 480;
    const batch3Start = 481, batch3End = 720;

    assignRange(1, 300, { status: 'STORED', supplierId: suppliers[0].id, deliveryId: d1.id, bagIssueId: issue1.id, bayCode: 'MIXED', condition: 'GOOD' });
    // split by bay
    assignRange(1, 120, { bayId: bays[0].id, bayCode: 'BAY-1' });
    assignRange(121, 220, { bayId: bays[1].id, bayCode: 'BAY-2' });
    assignRange(221, 300, { bayId: bays[2].id, bayCode: 'BAY-3' });
    // farmer ownership follows the declared split
    assignRange(1, 120, { farmerId: farmers[0].id });
    assignRange(121, 210, { farmerId: farmers[1].id });
    assignRange(211, 270, { farmerId: farmers[2].id });
    assignRange(271, 300, { farmerId: farmers[3].id });

    const issue2 = Store.add('bagIssues', {
      roundNo: 2, supplierId: suppliers[1].id, qty: 180, mode: 'SERIAL_ONLY',
      serials: D.serialRange(PREFIX, batch2Start, batch2End), issuedAt: ago(4, 8),
      issuedBy: 'chaminda.raj@efpl.org', sharedWith: 'Printed allocation slip', demo: true,
    }, 'seed');
    Store.update('deliveries', d2.id, { bagIssueId: issue2.id }, 'seed');
    assignRange(batch2Start, batch2End, {
      status: 'STORED', supplierId: suppliers[1].id, deliveryId: d2.id, bagIssueId: issue2.id,
      bayId: bays[3].id, bayCode: 'BAY-4', condition: 'GOOD',
    });
    assignRange(batch2Start, batch2Start + 99, { farmerId: farmers[4].id });
    assignRange(batch2Start + 100, batch2End, { farmerId: farmers[5].id });

    const issue3 = Store.add('bagIssues', {
      roundNo: 3, supplierId: suppliers[3].id, qty: 240, mode: 'SERIAL_ONLY',
      serials: D.serialRange(PREFIX, batch3Start, batch3End), issuedAt: ago(7, 8),
      issuedBy: 'chaminda.raj@efpl.org', sharedWith: 'Printed allocation slip', demo: true,
    }, 'seed');
    Store.update('deliveries', d3.id, { bagIssueId: issue3.id }, 'seed');
    assignRange(batch3Start, batch3End, {
      status: 'STORED', supplierId: suppliers[3].id, deliveryId: d3.id, bagIssueId: issue3.id,
      bayId: bays[4].id, bayCode: 'BAY-5', condition: 'GOOD',
    });
    assignRange(batch3Start, batch3Start + 139, { farmerId: farmers[9].id });
    assignRange(batch3Start + 140, batch3End, { farmerId: farmers[10].id });

    const issue4 = Store.add('bagIssues', {
      roundNo: 4, supplierId: suppliers[4].id, qty: 160, mode: 'SERIAL_ONLY',
      serials: D.serialRange(PREFIX, 721, 880), issuedAt: ago(6, 9),
      issuedBy: 'chaminda.raj@efpl.org', sharedWith: 'Printed allocation slip', demo: true,
    }, 'seed');
    Store.update('deliveries', d5.id, { bagIssueId: issue4.id, serials: D.serialRange(PREFIX, 721, 880) }, 'seed');
    assignRange(721, 880, {
      status: 'STORED', supplierId: suppliers[4].id, deliveryId: d5.id, bagIssueId: issue4.id,
      bayId: bays[5].id, bayCode: 'BAY-6', farmerId: farmers[11].id, condition: 'GOOD', deliveredAt: ago(4, 13),
    });
    assignRange(1, 300, { deliveredAt: ago(3, 10) });
    assignRange(batch2Start, batch2End, { deliveredAt: ago(2, 11) });
    assignRange(batch3Start, batch3End, { deliveredAt: ago(5, 9) });

    /* ---------------------------- payments --------------------------- */
    const p1 = Store.add('payments', {
      paymentNo: 'PAY-2026-0001', deliveryId: d1.id, supplierId: suppliers[0].id,
      supplierCode: suppliers[0].code, supplierName: suppliers[0].name,
      bags: 300, unitPrice: 300, grossAmount: 90000, deductions: 0, netAmount: 90000,
      status: 'APPROVED', createdAt: ago(3, 11),
      history: [
        { at: ago(3, 11), by: 'chaminda.raj@efpl.org', action: 'CREATED', note: 'Auto-generated on acceptance' },
        { at: ago(3, 12), by: 'nimal.silva@efpl.org', action: 'APPROVED', note: 'Fill check and count verified' },
      ], demo: true,
    }, 'seed');

    const p2 = Store.add('payments', {
      paymentNo: 'PAY-2026-0002', deliveryId: d2.id, supplierId: suppliers[1].id,
      supplierCode: suppliers[1].code, supplierName: suppliers[1].name,
      bags: 180, unitPrice: 270, grossAmount: 48600, deductions: 0, netAmount: 48600,
      status: 'PENDING_SUPERVISOR', createdAt: ago(2, 11),
      history: [{ at: ago(2, 11), by: 'chaminda.raj@efpl.org', action: 'CREATED', note: 'Reduced price applied — fill check 84.5%' }],
      demo: true,
    }, 'seed');

    const p3 = Store.add('payments', {
      paymentNo: 'PAY-2026-0003', deliveryId: d3.id, supplierId: suppliers[3].id,
      supplierCode: suppliers[3].code, supplierName: suppliers[3].name,
      bags: 240, unitPrice: 300, grossAmount: 72000, deductions: 0, netAmount: 72000,
      status: 'SENT_TO_HEAD_OFFICE', createdAt: ago(5, 10),
      sentAt: ago(4, 9), sentBy: 'accounts@efpl.org',
      history: [
        { at: ago(5, 10), by: 'chaminda.raj@efpl.org', action: 'CREATED' },
        { at: ago(5, 11), by: 'nimal.silva@efpl.org', action: 'APPROVED' },
        { at: ago(4, 9), by: 'accounts@efpl.org', action: 'SENT_TO_HEAD_OFFICE', note: 'Batch sent with the weekly payment run' },
      ], demo: true,
    }, 'seed');

    Store.add('payments', {
      paymentNo: 'PAY-2026-0004', deliveryId: d5.id, supplierId: suppliers[4].id,
      supplierCode: suppliers[4].code, supplierName: suppliers[4].name,
      bags: 160, unitPrice: 300, grossAmount: wet.grossAmount, deductionPct: wet.deductionPct,
      deductionReason: 'Wet load: 30.6 kg per bag reads 48% moisture',
      deductions: wet.deductions, netAmount: wet.netAmount,
      status: 'PENDING_SUPERVISOR', createdAt: ago(4, 13),
      history: [{ at: ago(4, 13), by: 'nimal.silva@efpl.org', action: 'CREATED', note: 'Received wet, 10% deducted instead of sending the load back' }],
      demo: true,
    }, 'seed');

    // Keep the running numbers ahead of the sample records.
    Object.assign(Store.data.counters, {
      receipt: 6, payment: 5, usage: 4, quality: 3, bagReturn: 2, supplier: SUPPLIERS.length + 1, farmer: FARMERS.length + 1,
    });

    /* ------------------------ gasifier usage ------------------------- */
    const u1 = Store.add('usageRequests', {
      requestNo: 'USE-0001', bayId: bays[0].id, bayCode: 'BAY-1', bags: 45,
      requestedBy: 'sunil.ops@efpl.org', requestedAt: ago(2, 6), status: 'CONSUMED',
      approvedBy: 'nimal.silva@efpl.org', approvedAt: ago(2, 7), approvedNote: 'Test bag 22.1 kg, drier than Bay 4. Use this bay first.',
      sampleBags: [22.4, 21.9, 22.0], avgBagKg: 22.1, moisturePct: D.moistureFromWeight(22.1, settings),
      totalKg: 994.5, consumedAt: ago(2, 9), consumedBy: 'sunil.ops@efpl.org',
      bagSerials: D.serialRange(PREFIX, 1, 45), demo: true,
    }, 'seed');
    assignRange(1, 45, { status: 'CONSUMED', consumedAt: ago(2, 9), usageId: u1.id });

    const u2 = Store.add('usageRequests', {
      requestNo: 'USE-0002', bayId: bays[3].id, bayCode: 'BAY-4', bags: 30,
      requestedBy: 'sunil.ops@efpl.org', requestedAt: ago(1, 6), status: 'CONSUMED',
      approvedBy: 'nimal.silva@efpl.org', approvedAt: ago(1, 7), approvedNote: 'Moisture slightly high — mix 1:2 with Bay 1.',
      sampleBags: [24.8, 25.2, 24.5], avgBagKg: 24.83, moisturePct: D.moistureFromWeight(24.83, settings),
      totalKg: 744.9, consumedAt: ago(1, 9), consumedBy: 'sunil.ops@efpl.org',
      bagSerials: D.serialRange(PREFIX, 301, 330), demo: true,
    }, 'seed');
    assignRange(301, 330, { status: 'CONSUMED', consumedAt: ago(1, 9), usageId: u2.id });

    Store.add('usageRequests', {
      requestNo: 'USE-0003', bayId: bays[1].id, bayCode: 'BAY-2', bags: 40,
      requestedBy: 'sunil.ops@efpl.org', requestedAt: ago(0, 6), status: 'PENDING',
      approvedBy: null, demo: true,
      note: 'Night shift requirement; waiting for the supervisor to pick the bay.',
    }, 'seed');

    /* ------------------------- quality issues ------------------------ */
    Store.add('qualityIssues', {
      issueNo: 'QI-0001', bagSerial: D.bagSerial(PREFIX, 302),
      usageId: u2.id, deliveryId: d2.id, supplierId: suppliers[1].id, supplierName: suppliers[1].name,
      farmerId: farmers[4].id, farmerName: farmers[4].name,
      severity: 'HIGH', category: 'MOISTURE',
      description: 'Bags weighed about 25 kg at consumption, which reads 35% moisture, and the gasifier flame was unstable. Suspected wet biomass from this batch.',
      correctiveAction: 'Supplier informed; bags from this batch to be mixed 1:2 with a drier bay until the batch is finished.',
      status: 'OPEN', reportedBy: 'sunil.ops@efpl.org', reportedAt: ago(1, 10),
      notifiedAt: ago(1, 12), notifiedVia: 'Phone call to supplier + WhatsApp to farmer group', demo: true,
    }, 'seed');

    Store.add('qualityIssues', {
      issueNo: 'QI-0002', bagSerial: D.bagSerial(PREFIX, 155),
      usageId: u1.id, deliveryId: d1.id, supplierId: suppliers[0].id, supplierName: suppliers[0].name,
      farmerId: farmers[1].id, farmerName: farmers[1].name,
      severity: 'LOW', category: 'FOREIGN_MATERIAL',
      description: 'Cinnamon bark strips found in two bags when emptying into the drum.',
      correctiveAction: 'Farmer advised to separate bark before bagging. No price adjustment this time.',
      status: 'RESOLVED', reportedBy: 'nimal.silva@efpl.org', reportedAt: ago(6, 13),
      resolvedAt: ago(5, 9), resolvedBy: 'nimal.silva@efpl.org', demo: true,
    }, 'seed');

    /* --------------------------- bag returns ------------------------- */
    Store.add('bagReturns', {
      returnNo: 'BR-0001', returnedBags: 60, good: 51, repairable: 6, replaced: 3, lost: 0,
      returnedAt: ago(1, 17), recordedBy: 'chaminda.raj@efpl.org',
      repairOrderRaised: true, replacementOrderQty: 50, replacementOrderedAt: ago(1, 18),
      note: 'Stitching repaired in-house; 50 replacement bags ordered from the supplier.',
      demo: true,
    }, 'seed');

    /* ------------------------------ audit ---------------------------- */
    Store.add('audit', {
      at: ago(3, 10), by: 'nimal.silva@efpl.org', action: 'delivery.accept',
      entity: 'delivery', entityId: d1.id, detail: 'RC-2026-0001 accepted · 300 bags · Rs 300/bag', demo: true,
    }, 'seed');
    Store.add('audit', {
      at: ago(2, 11), by: 'nimal.silva@efpl.org', action: 'payment.approve',
      entity: 'payment', entityId: p2.id, detail: 'PAY-2026-0002 queued for authorisation review', demo: true,
    }, 'seed');

    Store.data.meta.seeded = true;
    Store.save('seed');
    return true;
  }

  window.Seed = { ensure };
})();
