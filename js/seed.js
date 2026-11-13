/* =====================================================================
   seed.js — demo data.
   ---------------------------------------------------------------------
   The demo (switched on by the owner) opens a sandboxed copy of the app
   with a realistic two-week site history, so the screens can be shown
   without touching real records. Nothing here ever reaches the live
   store or the cloud.
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

  // name, NIC, phone, village, bank, branch, account number
  const SUPPLIERS = [
    ['K. M. Bandara', '781234567V', '077 123 4567', 'Balangoda', 'Bank of Ceylon', 'Balangoda', '0071234567'],
    ['P. Gunasekara', '196512345678', '071 445 8890', 'Belihuloya', 'Commercial Bank', 'Balangoda', '8001234567'],
    ['S. Wickramasinghe', '823456789X', '076 220 1145', 'Pinnawala', 'People\'s Bank', 'Balangoda', '1122334455'],
    ['M. Fernando & Sons', '901234567V', '077 998 7712', 'Imbulpe', 'Bank of Ceylon', 'Ratnapura', '0079988771'],
    ['A. Rathnayake', '198022334455', '072 331 6678', 'Weligepola', 'Sampath Bank', 'Balangoda', '1009 5566 7788'],
    ['N. Perera', '750998877V', '070 556 3321', 'Kaltota', 'People\'s Bank', 'Balangoda', '2233445566'],
    ['H. Dissanayake', '880123456V', '077 660 9921', 'Rassagala', 'Hatton National Bank', 'Balangoda', '045020112233'],
    ['J. Silva & Sons', '941122334V', '071 889 0034', 'Opanayaka', 'Commercial Bank', 'Ratnapura', '8005566778'],
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
    const bayCount = Number(settings.bayCount) || 30;
    for (let i = 1; i <= bayCount; i++) {
      bays.push(Store.add('bays', {
        code: `BAY-${i}`, name: `Bay ${i}`, capacityBags: Number(settings.bayCapacityBags) || 200, demo: true,
      }, 'seed'));
    }

    /* --------------------------- suppliers --------------------------- */
    const suppliers = SUPPLIERS.map((s, i) => Store.add('suppliers', {
      code: `SUP-${String(i + 1).padStart(4, '0')}`,
      name: s[0], nic: s[1], phone: s[2], address: s[3],
      bankName: s[4], bankBranch: s[5], bankAccount: s[6], bankAccountName: s[0],
      status: 'ACTIVE', demo: true,
    }, 'seed'));

    /* ------------------------- bag stock (serials) ------------------- */
    const PREFIX = settings.bagSerialPrefix;
    const TOTAL_BAGS = 1200;
    const bagRecs = [];
    for (let i = 1; i <= TOTAL_BAGS; i++) {
      bagRecs.push({ serial: D.bagSerial(PREFIX, i), n: i, status: 'IN_STOCK', demo: true, condition: 'GOOD' });
    }
    Store.bulkAdd('bags', bagRecs, 'seed-bags');
    const bagBySerial = new Map(Store.all('bags').map((b) => [b.serial, b]));
    const assignRange = (from, to, patch) => {
      for (let i = from; i <= to; i++) {
        const b = bagBySerial.get(D.bagSerial(PREFIX, i));
        if (b) Object.assign(b, patch);
      }
    };
    const alloc = (i, bags) => ({ bayId: bays[i].id, bayCode: bays[i].code, bags });

    /* --------------------------- deliveries -------------------------- */
    // 1) 300 bags across three bays, full price. Came in heavy 12 days ago
    //    and has been drying since — the bay screen shows it dry by now.
    const d1 = Store.add('deliveries', {
      receiptNo: 'RC-2026-0001', supplierId: suppliers[0].id, biomassType: 'GLIRICIDIA',
      vehicleNo: 'SG LH-4521', driverName: 'R. Bandara', driverNic: '781234567V',
      grossKg: 9360, tareKg: 1860, netKg: 7500, bagCount: 300,
      fillCheck: D.evaluateFillCheck({ bagCount: 300, fills: [96, 94, 98, 95, 97, 96, 95, 99, 94, 96, 97, 95, 98, 96, 95], settings }),
      allocations: [alloc(0, 120), alloc(1, 100), alloc(2, 80)], serials: D.serialRange(PREFIX, 1, 300),
      status: 'ACCEPTED', deliveredAt: ago(12, 8), acceptedAt: ago(12, 10), acceptedBy: 'nimal.silva@efpl.org',
      deductionPct: 0, deductionAmount: 0, payableAmount: 90000,
      weighbridgeSlip: 'WB-8841', demo: true, notes: 'Three bays used: 1, 2 and 3.',
    }, 'seed');

    // 2) 180 bags, fill check short -> reduced price, waiting for the supervisor.
    const d2 = Store.add('deliveries', {
      receiptNo: 'RC-2026-0002', supplierId: suppliers[1].id, biomassType: 'GLIRICIDIA',
      vehicleNo: 'SG JD-7788', driverName: 'S. Fernando', driverNic: '823456789X',
      grossKg: 5900, tareKg: 2050, netKg: 3850, bagCount: 180,
      fillCheck: D.evaluateFillCheck({ bagCount: 180, fills: [82, 85, 86, 83, 84, 87, 85, 84, 85], settings }),
      allocations: [alloc(3, 180)], serials: D.serialRange(PREFIX, 301, 480),
      status: 'ACCEPTED', deliveredAt: ago(2, 9), acceptedAt: ago(2, 11), acceptedBy: 'nimal.silva@efpl.org',
      deductionPct: 0, deductionAmount: 0, payableAmount: 48600,
      weighbridgeSlip: 'WB-8856', demo: true,
      notes: 'Average fill 84.6%: the supplier agreed to the reduced unit price.',
    }, 'seed');

    // 3) 240 bags, more than one bay holds: 200 in bay 5 and 40 in bay 7.
    const d3 = Store.add('deliveries', {
      receiptNo: 'RC-2026-0003', supplierId: suppliers[3].id, biomassType: 'CINNAMON',
      vehicleNo: 'SG KA-1290', driverName: 'M. Farook', driverNic: '901234567V',
      grossKg: 7300, tareKg: 2210, netKg: 5090, bagCount: 240,
      fillCheck: D.evaluateFillCheck({ bagCount: 240, fills: [99, 97, 98, 100, 96, 98, 99, 97, 98, 100, 97, 98], settings }),
      allocations: [alloc(4, 200), alloc(6, 40)], serials: D.serialRange(PREFIX, 481, 720),
      status: 'ACCEPTED', deliveredAt: ago(5, 7), acceptedAt: ago(5, 9), acceptedBy: 'nimal.silva@efpl.org',
      deductionPct: 0, deductionAmount: 0, payableAmount: 72000,
      weighbridgeSlip: 'WB-8822', demo: true,
    }, 'seed');

    // 4) Today: a truck at the gate, weighed and checked, not yet accepted.
    Store.add('deliveries', {
      receiptNo: 'RC-2026-0004', supplierId: suppliers[6].id, biomassType: 'CINNAMON',
      vehicleNo: 'SG PB-3311', driverName: 'H. Dissanayake', driverNic: '880123456V',
      grossKg: 6450, tareKg: 1900, netKg: 4550, bagCount: 200,
      fillCheck: D.evaluateFillCheck({ bagCount: 200, fills: [93, 91, 88, 92, 90, 91, 93, 89, 92, 91], settings }),
      allocations: [], serials: [], status: 'AWAITING_ACCEPTANCE',
      deliveredAt: ago(0, 7), weighbridgeSlip: 'WB-8893', demo: true,
      notes: 'Weighed and sampled at the gate; waiting for the supervisor.',
    }, 'seed');

    // 5) A wet load. Nothing is sent back: it is received and 10% is deducted.
    const wet = D.applyDeduction(160, 300, 10);
    const d5 = Store.add('deliveries', {
      receiptNo: 'RC-2026-0005', supplierId: suppliers[4].id, biomassType: 'OTHER',
      vehicleNo: 'SG GH-9021', driverName: 'A. Rathnayake', driverNic: '198022334455',
      grossKg: 6900, tareKg: 2000, netKg: 4900, bagCount: 160,
      fillCheck: D.evaluateFillCheck({ bagCount: 160, fills: [93, 95, 92, 94, 93, 95, 92, 94], settings }),
      allocations: [alloc(5, 160)], serials: D.serialRange(PREFIX, 721, 880),
      status: 'ACCEPTED', deliveredAt: ago(4, 11), acceptedAt: ago(4, 13), acceptedBy: 'nimal.silva@efpl.org',
      deductionPct: wet.deductionPct, deductionAmount: wet.deductions, payableAmount: wet.netAmount,
      deductionReason: 'Wet load: 30.6 kg per bag reads 48% moisture',
      weighbridgeSlip: 'WB-8830', demo: true,
      notes: 'Received wet after rain. Left in its own bay to dry before use.',
    }, 'seed');

    // Average bag weight is what the moisture reading comes from.
    for (const d of Store.all('deliveries')) {
      if (!d.avgBagKg) d.avgBagKg = D.avgBagWeight(d.netKg, d.bagCount);
    }

    /* ------------------- bag rounds and where the bags are ----------- */
    // The bag store was counted three weeks ago; rounds since then are split
    // between used bags (given first) and new ones.
    Store.add('bagReturns', {
      kind: 'COUNT', returnNo: 'BS-0001', usedCounted: 300, newCounted: 1500, usedDelta: 300, newDelta: 1500,
      note: 'Opening count of the bag store', at: ago(20, 8), returnedAt: ago(20, 8), recordedBy: 'chaminda.raj@efpl.org', demo: true,
    }, 'seed');
    const split = { 1: [300, 0], 2: [0, 180], 3: [0, 240], 4: [0, 160] };
    const round = (roundNo, supplier, from, to, daysAgo, delivery) => {
      const issue = Store.add('bagIssues', {
        roundNo, supplierId: supplier.id, qty: to - from + 1, mode: 'SERIAL_ONLY',
        usedQty: split[roundNo][0], newQty: split[roundNo][1],
        serials: D.serialRange(PREFIX, from, to), issuedAt: ago(daysAgo, 8),
        issuedBy: 'chaminda.raj@efpl.org', sharedWith: 'Printed allocation slip', demo: true,
      }, 'seed');
      Store.update('deliveries', delivery.id, { bagIssueId: issue.id }, 'seed');
      assignRange(from, to, {
        status: 'STORED', supplierId: supplier.id, deliveryId: delivery.id, bagIssueId: issue.id,
        condition: 'GOOD', deliveredAt: delivery.acceptedAt,
      });
    };
    round(1, suppliers[0], 1, 300, 15, d1);
    assignRange(1, 120, { bayId: bays[0].id, bayCode: 'BAY-1' });
    assignRange(121, 220, { bayId: bays[1].id, bayCode: 'BAY-2' });
    assignRange(221, 300, { bayId: bays[2].id, bayCode: 'BAY-3' });
    round(2, suppliers[1], 301, 480, 4, d2);
    assignRange(301, 480, { bayId: bays[3].id, bayCode: 'BAY-4' });
    round(3, suppliers[3], 481, 720, 7, d3);
    assignRange(481, 680, { bayId: bays[4].id, bayCode: 'BAY-5' });
    assignRange(681, 720, { bayId: bays[6].id, bayCode: 'BAY-7' });
    round(4, suppliers[4], 721, 880, 6, d5);
    assignRange(721, 880, { bayId: bays[5].id, bayCode: 'BAY-6' });

    /* ---------------------------- payments --------------------------- */
    const pay = (no, d, supplier, patch) => Store.add('payments', Object.assign({
      paymentNo: no, deliveryId: d.id, supplierId: supplier.id,
      supplierCode: supplier.code, supplierName: supplier.name,
      bags: d.bagCount, unitPrice: d.fillCheck.unitPrice,
      grossAmount: d.fillCheck.amount, deductionPct: d.deductionPct || 0, deductionReason: d.deductionReason || '',
      deductions: d.deductionAmount || 0, netAmount: d.payableAmount, demo: true,
    }, patch), 'seed');

    pay('PAY-2026-0001', d1, suppliers[0], {
      status: 'APPROVED', createdAt: ago(12, 11),
      history: [
        { at: ago(12, 11), by: 'nimal.silva@efpl.org', action: 'CREATED', note: 'Generated on acceptance of RC-2026-0001' },
        { at: ago(12, 12), by: 'nimal.silva@efpl.org', action: 'APPROVED', note: 'Fill check and count verified' },
      ],
    });
    const p2 = pay('PAY-2026-0002', d2, suppliers[1], {
      status: 'PENDING_SUPERVISOR', createdAt: ago(2, 11),
      history: [{ at: ago(2, 11), by: 'chaminda.raj@efpl.org', action: 'CREATED', note: 'Reduced price applied: fill check 84.6%' }],
    });
    pay('PAY-2026-0003', d3, suppliers[3], {
      status: 'SENT_TO_HEAD_OFFICE', createdAt: ago(5, 10), sentAt: ago(4, 9), sentBy: 'accounts@efpl.org',
      history: [
        { at: ago(5, 10), by: 'nimal.silva@efpl.org', action: 'CREATED' },
        { at: ago(5, 11), by: 'nimal.silva@efpl.org', action: 'APPROVED' },
        { at: ago(4, 9), by: 'accounts@efpl.org', action: 'SENT_TO_HEAD_OFFICE', note: 'Sent with the weekly payment run' },
      ],
    });
    pay('PAY-2026-0004', d5, suppliers[4], {
      status: 'PENDING_SUPERVISOR', createdAt: ago(4, 13),
      history: [{ at: ago(4, 13), by: 'nimal.silva@efpl.org', action: 'CREATED', note: 'Received wet, 10% deducted instead of sending the load back' }],
    });

    // Keep the running numbers ahead of the sample records.
    Object.assign(Store.data.counters, {
      receipt: 6, payment: 5, usage: 4, quality: 3, bagReturn: 4, supplier: SUPPLIERS.length + 1,
    });

    /* ------------------------ gasifier usage ------------------------- */
    const u1 = Store.add('usageRequests', {
      requestNo: 'USE-0001', bayId: bays[0].id, bayCode: 'BAY-1', bags: 45,
      requestedBy: 'sunil.ops@efpl.org', requestedAt: ago(2, 6), status: 'CONSUMED',
      approvedBy: 'nimal.silva@efpl.org', approvedAt: ago(2, 7), approvedNote: 'Test bag 19.2 kg, the driest bay. Use this one first.',
      sampleBags: [19.4, 18.9, 19.0], avgBagKg: 19.1, moisturePct: D.moistureFromWeight(19.1, settings),
      totalKg: 859.5, consumedAt: ago(2, 9), consumedBy: 'sunil.ops@efpl.org',
      bagSerials: D.serialRange(PREFIX, 1, 45), bagsGood: 43, bagsTorn: 2,
      fromLoads: [{ deliveryId: d1.id, receiptNo: d1.receiptNo, supplierId: suppliers[0].id, bags: 45 }], demo: true,
    }, 'seed');
    assignRange(1, 43, { status: 'IN_STOCK', condition: 'USED', consumedAt: ago(2, 9), usageId: u1.id, supplierId: null, bayId: null, bayCode: null, deliveryId: null });
    assignRange(44, 45, { status: 'RETIRED', condition: 'TORN', consumedAt: ago(2, 9), usageId: u1.id, supplierId: null, bayId: null, bayCode: null, deliveryId: null });
    Object.assign(bays[0], { lastWeighKg: 19.1, lastWeighAt: ago(2, 9) });

    const u2 = Store.add('usageRequests', {
      requestNo: 'USE-0002', bayId: bays[3].id, bayCode: 'BAY-4', bags: 30,
      requestedBy: 'sunil.ops@efpl.org', requestedAt: ago(1, 6), status: 'CONSUMED',
      approvedBy: 'nimal.silva@efpl.org', approvedAt: ago(1, 7), approvedNote: 'Still damp: mix one bag to two with Bay 1.',
      sampleBags: [20.8, 21.2, 20.5], avgBagKg: 20.83, moisturePct: D.moistureFromWeight(20.83, settings),
      totalKg: 624.9, consumedAt: ago(1, 9), consumedBy: 'sunil.ops@efpl.org',
      bagSerials: D.serialRange(PREFIX, 301, 330), bagsGood: 29, bagsTorn: 1,
      fromLoads: [{ deliveryId: d2.id, receiptNo: d2.receiptNo, supplierId: suppliers[1].id, bags: 30 }], demo: true,
    }, 'seed');
    assignRange(301, 329, { status: 'IN_STOCK', condition: 'USED', consumedAt: ago(1, 9), usageId: u2.id, supplierId: null, bayId: null, bayCode: null, deliveryId: null });
    assignRange(330, 330, { status: 'RETIRED', condition: 'TORN', consumedAt: ago(1, 9), usageId: u2.id, supplierId: null, bayId: null, bayCode: null, deliveryId: null });
    Object.assign(bays[3], { lastWeighKg: 20.83, lastWeighAt: ago(1, 9) });

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
      severity: 'HIGH', category: 'UNDERFILLED',
      description: 'Bags from this load were clearly under-filled when emptied at the gasifier, as the fill check at the gate had shown.',
      correctiveAction: 'Supplier informed. The reduced price was applied to the load.',
      status: 'OPEN', reportedBy: 'sunil.ops@efpl.org', reportedAt: ago(1, 10),
      notifiedAt: ago(1, 12), notifiedVia: 'Phone call to the supplier', demo: true,
    }, 'seed');

    Store.add('qualityIssues', {
      issueNo: 'QI-0002', bagSerial: D.bagSerial(PREFIX, 155),
      usageId: u1.id, deliveryId: d1.id, supplierId: suppliers[0].id, supplierName: suppliers[0].name,
      severity: 'LOW', category: 'FOREIGN_MATERIAL',
      description: 'Cinnamon bark strips found in two bags when emptying into the drum.',
      correctiveAction: 'Supplier advised to separate bark before bagging. No price adjustment this time.',
      status: 'RESOLVED', reportedBy: 'nimal.silva@efpl.org', reportedAt: ago(6, 13),
      resolvedAt: ago(5, 9), resolvedBy: 'nimal.silva@efpl.org', demo: true,
    }, 'seed');

    /* ---------------------------- bag store -------------------------- */
    Store.add('bagReturns', {
      kind: 'PURCHASE', returnNo: 'BS-0002', newQty: 500, vendor: 'Lanka Woven Sacks, invoice 4471',
      at: ago(3, 10), returnedAt: ago(3, 10), recordedBy: 'chaminda.raj@efpl.org', demo: true,
    }, 'seed');
    Store.add('bagReturns', {
      kind: 'DISCARD', returnNo: 'BS-0003', shelf: 'USED', qty: 12, reason: 'Rats: chewed in the corner stack',
      at: ago(1, 17), returnedAt: ago(1, 17), recordedBy: 'chaminda.raj@efpl.org', demo: true,
    }, 'seed');

    /* ------------------------------ audit ---------------------------- */
    Store.add('audit', {
      at: ago(12, 10), by: 'nimal.silva@efpl.org', name: 'Nimal Silva', role: 'supervisor', action: 'delivery.accept',
      entity: 'delivery', entityId: d1.id, detail: 'RC-2026-0001 accepted · 300 bags · Rs 300/bag', demo: true,
    }, 'seed');
    Store.add('audit', {
      at: ago(2, 11), by: 'chaminda.raj@efpl.org', name: 'Chaminda Rajapaksha', role: 'storekeeper', action: 'payment.create',
      entity: 'payment', entityId: p2.id, detail: 'PAY-2026-0002 created at the reduced price', demo: true,
    }, 'seed');

    Store.data.meta.seeded = true;
    Store.save('seed');
    return true;
  }

  window.Seed = { ensure };
})();
