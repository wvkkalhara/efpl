/* =====================================================================
   domain.js — the business rules, in one place.
   All money, weight and moisture arithmetic lives here so the number the
   supervisor reads on screen is the number that reaches Head Office.
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------ roles ------------------------------ */
  const ROLES = ['super_admin', 'admin', 'supervisor', 'storekeeper', 'operator', 'accounts', 'auditor', 'pending'];

  const ROLE_LABEL = {
    super_admin: 'Super Admin (owner)',
    admin: 'Administrator',
    supervisor: 'Biomass Supervisor',
    storekeeper: 'Store Keeper',
    operator: 'Gasifier Operator',
    accounts: 'Accounts',
    auditor: 'Auditor (read only)',
    pending: 'Awaiting approval',
  };

  const PERMISSIONS = {
    super_admin: ['*'],
    admin: [
      'supplier.write', 'farmer.write', 'delivery.create', 'delivery.accept', 'delivery.reject',
      'bag.generate', 'bag.issue', 'bay.allocate', 'usage.request', 'usage.approve',
      'usage.consume', 'quality.report', 'quality.resolve', 'payment.split', 'payment.approve',
      'payment.release', 'payment.pay', 'returns.write', 'report.read', 'audit.read',
      'user.manage', 'settings.write', 'data.manage',
    ],
    supervisor: [
      'supplier.write', 'farmer.write', 'delivery.create', 'delivery.accept', 'delivery.reject',
      'bay.allocate', 'bag.issue', 'usage.request', 'usage.approve', 'quality.report',
      'quality.resolve', 'payment.split', 'payment.approve', 'returns.write', 'report.read', 'audit.read',
    ],
    storekeeper: [
      'supplier.write', 'farmer.write', 'bag.generate', 'bag.issue', 'delivery.create',
      'usage.request', 'quality.report', 'payment.split', 'returns.write', 'report.read',
    ],
    operator: ['usage.request', 'usage.consume', 'quality.report', 'report.read'],
    accounts: ['payment.release', 'payment.pay', 'report.read'],
    auditor: ['report.read', 'audit.read'],
    pending: [],   // signed in, but nothing is allowed until the owner assigns a role
  };

  /** Roles an administrator is allowed to hand out (owner is special). */
  const ASSIGNABLE_ROLES = ROLES.filter((r) => r !== 'super_admin' && r !== 'pending');

  function can(user, permission) {
    if (!user || !user.role) return false;
    const list = PERMISSIONS[user.role] || [];
    return list.includes('*') || list.includes(permission);
  }

  /* --------------------------- bag lifecycle -------------------------- */
  const BAG_STATUS = {
    IN_STOCK: 'IN_STOCK',
    ISSUED: 'ISSUED',
    DELIVERED: 'DELIVERED',
    STORED: 'STORED',
    CONSUMED: 'CONSUMED',
    RETURNED: 'RETURNED',
    DAMAGED: 'DAMAGED',
    REPAIRED: 'REPAIRED',
    RETIRED: 'RETIRED',
    LOST: 'LOST',
  };

  const BAG_STATUS_LABEL = {
    IN_STOCK: 'In bag store',
    ISSUED: 'Issued to supplier',
    DELIVERED: 'Delivered (weighed)',
    STORED: 'In bay',
    CONSUMED: 'Fed to gasifier',
    RETURNED: 'Returned empty',
    DAMAGED: 'Damaged',
    REPAIRED: 'Repaired',
    RETIRED: 'Retired',
    LOST: 'Lost',
  };

  const BAG_TRANSITIONS = {
    IN_STOCK: ['ISSUED', 'RETIRED', 'LOST'],
    ISSUED: ['DELIVERED', 'IN_STOCK', 'LOST'],
    DELIVERED: ['STORED', 'RETURNED'],
    STORED: ['CONSUMED'],
    CONSUMED: ['RETURNED'],
    RETURNED: ['IN_STOCK', 'DAMAGED', 'REPAIRED'],
    DAMAGED: ['REPAIRED', 'RETIRED'],
    REPAIRED: ['IN_STOCK'],
    RETIRED: [],
    LOST: [],
  };

  const canTransition = (from, to) => (BAG_TRANSITIONS[from] || []).includes(to);

  /* ------------------------------ money ------------------------------ */
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  function sampleSizeFor(bagCount, settings) {
    const pct = Number(settings.sampleSizePct) || 5;
    const min = Number(settings.minSampleSize) || 3;
    return Math.max(min, Math.ceil((bagCount * pct) / 100));
  }

  /**
   * Requirement 3 — the fill check.
   * A random sample of bags is emptied into a cylindrical measuring drum.
   * Average fill height drives the unit price:
   *   >= 90 %  -> full price (Rs 300)
   *   70-89 %  -> reduced price (Rs 270) or send back to be re-filled
   *   < 70 %   -> recount / re-fill before acceptance
   */
  function evaluateFillCheck(opts) {
    const settings = opts.settings || {};
    const bagCount = Number(opts.bagCount) || 0;
    const threshold = Number(settings.fillThresholdPct) || 90;
    const fullPrice = Number(settings.unitPrice) || 300;
    const reduced = Number(settings.reducedUnitPrice) || 270;
    const fills = (opts.fills || []).map((n) => Math.max(0, Math.min(150, Number(n) || 0)));
    const avg = fills.length ? Math.round((fills.reduce((a, b) => a + b, 0) / fills.length) * 10) / 10 : null;

    let decision, unitPrice, action;
    if (avg === null) {
      decision = 'NOT_CHECKED'; unitPrice = fullPrice; action = 'Record at least one fill height.';
    } else if (avg >= 100) {
      decision = 'PASS'; unitPrice = fullPrice; action = 'Accept at the full contract price.';
    } else if (avg >= threshold) {
      decision = 'PASS_MARGINAL'; unitPrice = fullPrice;
      action = `Just above the ${threshold}% agreement — accept at full price, note the reading.`;
    } else if (avg >= threshold - 20) {
      decision = 'REDUCED_PRICE'; unitPrice = reduced;
      action = `Below the ${threshold}% agreement — pay at Rs ${reduced}/bag, or send back for re-filling and recount.`;
    } else {
      decision = 'RECOUNT_REQUIRED'; unitPrice = reduced;
      action = 'Well below agreement — reject for re-filling, or accept at the reduced price with a written reason.';
    }

    if (opts.outcome === 'OVERRIDE_FULL_PRICE') { decision = 'OVERRIDDEN'; unitPrice = fullPrice; }
    if (opts.outcome === 'REJECT') { decision = 'REJECTED'; }

    return {
      sampleSize: fills.length || sampleSizeFor(bagCount, settings),
      fills, avgFillPct: avg, thresholdPct: threshold,
      decision, unitPrice, fullPrice, reducedPrice: reduced, action,
      amount: round2(bagCount * unitPrice),
      spread: fills.length ? round2(Math.max.apply(null, fills) - Math.min.apply(null, fills)) : null,
    };
  }

  /* ---------------------------- moisture ----------------------------- */
  /** Bag weight is the field proxy for moisture (req 5 & 6). */
  function moistureFromWeight(kg, settings) {
    const dry = Number(settings.standardDryBagKg) || 20;
    if (!kg) return null;
    return Math.max(0, Math.min(80, Math.round((1 - dry / Number(kg)) * 1000) / 10));
  }

  function moistureBand(pct, settings) {
    if (pct === null || pct === undefined) return 'UNKNOWN';
    if (pct >= (Number(settings.moistureRejectPct) || 45)) return 'REJECT';
    if (pct >= (Number(settings.moistureWarnPct) || 25)) return 'WARN';
    return 'OK';
  }

  /* ---------------------------- weighing ----------------------------- */
  function weighTruck(grossKg, tareKg) {
    const g = Number(grossKg), t = Number(tareKg);
    if (!Number.isFinite(g) || !Number.isFinite(t)) return { ok: false, msg: 'Enter both readings.' };
    if (g <= 0 || t < 0) return { ok: false, msg: 'Readings must be positive.' };
    if (g <= t) return { ok: false, msg: 'Gross must be greater than tare — swap the readings?' };
    const net = g - t;
    if (net > 60000) return { ok: false, msg: 'Net over 60 t — re-check the weighbridge.' };
    if (net < 50) return { ok: false, msg: 'Net under 50 kg — is the truck actually loaded?' };
    return { ok: true, netKg: round2(net) };
  }

  const avgBagWeight = (netKg, bagCount) => (bagCount ? round2(Number(netKg) / Number(bagCount)) : null);

  /* ---------------------------- payments ----------------------------- */
  const PAYMENT_FLOW = {
    DRAFT: ['PENDING_SUPERVISOR'],
    PENDING_SUPERVISOR: ['APPROVED', 'DRAFT'],
    APPROVED: ['SENT_TO_HEAD_OFFICE'],
    SENT_TO_HEAD_OFFICE: ['PAID'],
    PAID: [],
  };
  const PAYMENT_LABEL = {
    DRAFT: 'Draft — farmer split pending',
    PENDING_SUPERVISOR: 'Awaiting supervisor authorisation',
    APPROVED: 'Authorised — to be released',
    SENT_TO_HEAD_OFFICE: 'Sent to Head Office',
    PAID: 'Paid',
  };
  const paymentCanGo = (from, to) => (PAYMENT_FLOW[from] || []).includes(to);

  /* ------------------------------ serials ---------------------------- */
  function bagSerial(prefix, n, width = 6) {
    return `${prefix}-${String(n).padStart(width, '0')}`;
  }

  function serialRange(prefix, from, to, width = 6) {
    const out = [];
    for (let i = from; i <= to; i++) out.push(bagSerial(prefix, i, width));
    return out;
  }

  /** Accepts "EFPL-BG-000123", "000123", "123" -> 123 (or null). */
  function parseSerialNumber(serial, prefix) {
    if (!serial) return null;
    const s = String(serial).toUpperCase().trim();
    const m = s.match(/(\d+)\s*$/);
    if (!m) return null;
    return Number(m[1]);
  }

  /* --------------------------- traceability -------------------------- */
  /** Req 11 + the WhatsApp decision: one serial number tells the story. */
  function traceBag(Store, serialInput) {
    const wanted = String(serialInput || '').trim().toUpperCase();
    const bag = Store.all('bags').find((b) => String(b.serial).toUpperCase() === wanted)
      || Store.all('bags').find((b) => String(b.serial).toUpperCase().endsWith(wanted) && wanted.length >= 4);
    if (!bag) return null;

    const delivery = bag.deliveryId ? Store.byId('deliveries', bag.deliveryId) : null;
    const supplier = bag.supplierId ? Store.byId('suppliers', bag.supplierId) : null;
    const farmer = bag.farmerId ? Store.byId('farmers', bag.farmerId) : null;
    const issue = bag.bagIssueId ? Store.byId('bagIssues', bag.bagIssueId) : null;
    const usage = Store.all('usageRequests').find((u) => (u.bagSerials || []).includes(bag.serial));
    const payment = delivery ? Store.all('payments').find((p) => p.deliveryId === delivery.id) : null;
    const quality = Store.all('qualityIssues').filter((q) => q.bagSerial === bag.serial);
    const events = Store.all('bagEvents').filter((e) => e.serial === bag.serial);

    return { bag, delivery, supplier, farmer, issue, usage, payment, quality, events };
  }

  /* --------------------------- barcode (Code 39) --------------------- */
  const CODE39 = {
    '0': '101001101101', '1': '110100101011', '2': '101100101011', '3': '110110010101',
    '4': '101001101011', '5': '110100110101', '6': '101100110101', '7': '101001011011',
    '8': '110100101101', '9': '101100101101', 'A': '110101001011', 'B': '101101001011',
    'C': '110110100101', 'D': '101011001011', 'E': '110101100101', 'F': '101101100101',
    'G': '101010011011', 'H': '110101001101', 'I': '101101001101', 'J': '101011001101',
    'K': '110101010011', 'L': '101101010011', 'M': '110110101001', 'N': '101011010011',
    'O': '110101101001', 'P': '101101101001', 'Q': '101010110011', 'R': '110101011001',
    'S': '101101011001', 'T': '101011011001', 'U': '110010101011', 'V': '100110101011',
    'W': '110011010101', 'X': '100101101011', 'Y': '110010110101', 'Z': '100110110101',
    '-': '100101011011', '.': '110010101101', ' ': '100110101101', '$': '100100100101',
    '/': '100100101001', '+': '100101001001', '%': '101001001001', '*': '100101101101',
  };

  /** Returns an inline SVG string — no library, prints crisply at any size. */
  function code39SVG(text, opts) {
    const o = Object.assign({ height: 42, narrow: 2, quiet: 10, showText: true }, opts || {});
    const value = `*${String(text).toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '-')}*`;
    let x = o.quiet;
    let bars = '';
    for (const ch of value) {
      const pattern = CODE39[ch] || CODE39['-'];
      for (let i = 0; i < pattern.length; i++) {
        const w = pattern[i] === '1' ? o.narrow : o.narrow * 2.4;
        if (i % 2 === 0) bars += `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${o.height}" fill="#111"/>`;
        x += w;
      }
      x += o.narrow * 2.4; // inter-character gap
    }
    const width = x + o.quiet;
    const label = o.showText
      ? `<text x="${(width / 2).toFixed(1)}" y="${o.height + 13}" text-anchor="middle" font-family="monospace" font-size="11" fill="#111">${value.replace(/\*/g, '')}</text>`
      : '';
    const h = o.height + (o.showText ? 18 : 0);
    return `<svg class="barcode" viewBox="0 0 ${width.toFixed(1)} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Barcode ${value.replace(/\*/g, '')}">${bars}${label}</svg>`;
  }

  /* --------------------------- formatting ---------------------------- */
  const money = (n) => 'Rs ' + (Number(n) || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kg = (n) => (n === null || n === undefined ? '—' : `${(Number(n) || 0).toLocaleString('en-LK', { maximumFractionDigits: 2 })} kg`);
  const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);

  function dt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
  function dOnly(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  const todayISO = () => new Date().toISOString().slice(0, 10);

  window.Domain = {
    ROLES, ASSIGNABLE_ROLES, ROLE_LABEL, PERMISSIONS, can,
    BAG_STATUS, BAG_STATUS_LABEL, BAG_TRANSITIONS, canTransition,
    round2, sampleSizeFor, evaluateFillCheck, moistureFromWeight, moistureBand,
    weighTruck, avgBagWeight, PAYMENT_FLOW, PAYMENT_LABEL, paymentCanGo,
    bagSerial, serialRange, parseSerialNumber, traceBag, code39SVG,
    money, kg, pct, dt, dOnly, todayISO,
  };
})();
