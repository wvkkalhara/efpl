/* =====================================================================
   domain.js — the business rules, in one place.
   All money, weight and moisture arithmetic lives here so the number the
   supervisor reads on screen is the number that reaches Head Office.
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------ roles ------------------------------ */
  const ROLES = ['super_admin', 'admin', 'supervisor', 'storekeeper', 'operator', 'accounts', 'auditor', 'pending'];

  const DEFAULT_ROLE_LABEL = {
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
      'supplier.write', 'delivery.create', 'delivery.accept',
      'bag.generate', 'bag.issue', 'bay.allocate', 'usage.request', 'usage.approve',
      'usage.consume', 'quality.report', 'quality.resolve', 'payment.approve',
      'payment.release', 'payment.pay', 'returns.write', 'report.read', 'audit.read',
      'user.manage', 'settings.write', 'data.manage',
    ],
    supervisor: [
      'supplier.write', 'delivery.create', 'delivery.accept',
      'bay.allocate', 'bag.issue', 'usage.request', 'usage.approve', 'quality.report',
      'quality.resolve', 'payment.approve', 'returns.write', 'report.read',
    ],
    storekeeper: [
      'supplier.write', 'bag.generate', 'bag.issue', 'delivery.create',
      'usage.request', 'quality.report', 'returns.write',
    ],
    operator: ['usage.request', 'usage.consume', 'quality.report'],
    accounts: ['payment.release', 'payment.pay', 'report.read'],
    auditor: ['report.read', 'audit.read'],
    pending: [],   // signed in, but nothing is allowed until the owner assigns a role
  };

  /** Plain-words summary shown when an administrator picks a role for someone. */
  const ROLE_INFO = {
    admin: 'Everything: all yard work, payments, people and their roles, prices and settings.',
    supervisor: 'Accepts trucks and sets deductions, gives bays, approves gasifier issues, authorises payments, closes quality issues.',
    storekeeper: 'Receives trucks, numbers and issues bags, checks returned bags, keeps the supplier list.',
    operator: 'Asks for biomass for the gasifier, weighs and feeds it, reports quality problems.',
    accounts: 'Releases authorised payments to Head Office and marks them paid. Sees deliveries, suppliers and reports.',
    auditor: 'Sees every screen and the activity log, and cannot change anything.',
  };

  /** Roles an administrator is allowed to hand out (owner is special). */
  const ASSIGNABLE_ROLES = ROLES.filter((r) => r !== 'super_admin' && r !== 'pending');

  /* ------------------------ editable roles ---------------------------
     An administrator can rename a role and choose which jobs it may do
     (Administration → Users & roles). The choices are saved with the shared
     business settings, so every device follows them.

     Two things are fixed on purpose:
       - Administrator always keeps everything, so nobody can lock the
         site out of its own settings;
       - Auditor always stays read-only.
     And three permissions can never be handed to another role: managing
     people, changing settings, and reading the whole activity log. */
  const TASKS = [
    { perm: 'delivery.create', group: 'Receiving', label: 'Receive trucks (weigh, count, fill check)' },
    { perm: 'delivery.accept', group: 'Receiving', label: 'Accept trucks, give bays and set deductions' },
    { perm: 'bay.allocate', group: 'Receiving', label: 'Add bays' },
    { perm: 'bag.generate', group: 'Bags', label: 'Number new bags' },
    { perm: 'bag.issue', group: 'Bags', label: 'Issue bags to suppliers' },
    { perm: 'returns.write', group: 'Bags', label: 'Check returned bags' },
    { perm: 'usage.request', group: 'Gasifier', label: 'Ask for biomass for the gasifier' },
    { perm: 'usage.approve', group: 'Gasifier', label: 'Approve gasifier issues and choose the bay' },
    { perm: 'usage.consume', group: 'Gasifier', label: 'Weigh and feed the gasifier' },
    { perm: 'quality.report', group: 'Quality', label: 'Report quality problems and trace bags' },
    { perm: 'quality.resolve', group: 'Quality', label: 'Close quality problems' },
    { perm: 'payment.approve', group: 'Payments', label: 'Authorise payments and change deductions' },
    { perm: 'payment.release', group: 'Payments', label: 'Release payments to Head Office' },
    { perm: 'payment.pay', group: 'Payments', label: 'Mark payments as paid' },
    { perm: 'supplier.write', group: 'Records', label: 'Add and edit suppliers' },
    { perm: 'report.read', group: 'Records', label: 'See reports' },
  ];
  const GRANTABLE = TASKS.map((t) => t.perm);
  const LOCKED_ROLES = ['super_admin', 'admin', 'auditor', 'pending'];   // their permissions never change
  const EDITABLE_ROLES = ROLES.filter((r) => !LOCKED_ROLES.includes(r));

  /** What the administrator saved for the roles, or {} when nothing was changed. */
  function roleSettings() {
    try {
      const s = window.Store && window.Store.settings && window.Store.settings();
      return (s && s.roles && typeof s.roles === 'object') ? s.roles : {};
    } catch { return {}; }
  }

  function permissionsFor(role) {
    const base = PERMISSIONS[role] || [];
    if (!EDITABLE_ROLES.includes(role)) return base;
    const custom = roleSettings()[role];
    // "perms" may come back from the cloud as a list or as {0: 'a', 1: 'b'}
    const raw = custom && custom.perms;
    const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : null);
    if (!list) return custom && custom.none === true ? [] : base;
    return list.filter((p) => GRANTABLE.includes(p));
  }

  const isRoleCustomised = (role) => EDITABLE_ROLES.includes(role) && !!(roleSettings()[role] && (roleSettings()[role].perms || roleSettings()[role].none));

  function roleLabel(role) {
    const custom = roleSettings()[role];
    const name = custom && typeof custom.label === 'string' ? custom.label.trim() : '';
    return (role !== 'super_admin' && role !== 'pending' && name) || DEFAULT_ROLE_LABEL[role] || role;
  }

  /** Reads like a plain object (D.ROLE_LABEL[role]) but follows the saved names. */
  const ROLE_LABEL = new Proxy({}, {
    get: (_t, role) => (typeof role === 'string' ? roleLabel(role) : undefined),
    has: (_t, role) => role in DEFAULT_ROLE_LABEL,
    ownKeys: () => Object.keys(DEFAULT_ROLE_LABEL),
    getOwnPropertyDescriptor: (_t, role) => (role in DEFAULT_ROLE_LABEL ? { enumerable: true, configurable: true, value: roleLabel(role) } : undefined),
  });

  /** One sentence for a role: the built-in one, or the list of jobs once it has been edited. */
  function roleSummary(role) {
    if (!isRoleCustomised(role)) return ROLE_INFO[role] || '';
    const mine = permissionsFor(role);
    const jobs = TASKS.filter((t) => mine.includes(t.perm)).map((t) => t.label.replace(/\s*\(.*\)$/, ''));
    return jobs.length ? jobs.join('. ') + '.' : 'Nothing yet. Tick the jobs this role should do.';
  }

  function can(user, permission) {
    if (!user || !user.role) return false;
    const list = permissionsFor(user.role);
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
    CONSUMED: 'Emptied into gasifier',
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
    CONSUMED: ['RETURNED', 'IN_STOCK', 'DAMAGED', 'RETIRED'],
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
    const min = Number(settings.minSampleSize) || 1;
    return Math.max(min, Math.ceil((bagCount * pct) / 100));
  }

  /**
   * Requirement 3 — the fill check.
   * A random sample of bags is emptied into a cylindrical measuring drum.
   * Average fill height drives the unit price:
   *   >= 90 %  -> full price (Rs 300)
   *   <  90 %  -> reduced price (Rs 270), or the supplier re-fills the bags
   *               and they are counted and sampled again
   * A load is never turned away: it is always received, and anything else
   * that is wrong with it is handled as a percentage deduction (below).
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
    } else {
      decision = 'REDUCED_PRICE'; unitPrice = reduced;
      action = `Below the ${threshold}% agreement — the whole batch is paid at Rs ${reduced}/bag. If the supplier re-fills the bags instead, count and sample them again.`;
    }

    if (opts.outcome === 'OVERRIDE_FULL_PRICE') { decision = 'OVERRIDDEN'; unitPrice = fullPrice; }

    return {
      sampleSize: fills.length || sampleSizeFor(bagCount, settings),
      fills, avgFillPct: avg, thresholdPct: threshold,
      decision, unitPrice, fullPrice, reducedPrice: reduced, action,
      amount: round2(bagCount * unitPrice),
      spread: fills.length ? round2(Math.max.apply(null, fills) - Math.min.apply(null, fills)) : null,
    };
  }

  /* ---------------------------- moisture ----------------------------- */
  /**
   * Bag weight is the field measure of moisture (req 5 & 6).
   * Site formula:  moisture % = (40 / 18) x bag kg - 20
   * which is the straight line through two calibration points:
   *   18 kg -> 20 %   and   36 kg -> 60 %.
   * The two points are settings, so a re-calibration is not a code change.
   */
  function moistureCalibration(settings) {
    const s = settings || {};
    const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
    const kg1 = num(s.moistureCalKg1, 18), pct1 = num(s.moistureCalPct1, 20);
    const kg2 = num(s.moistureCalKg2, 36), pct2 = num(s.moistureCalPct2, 60);
    const slope = kg2 !== kg1 ? (pct2 - pct1) / (kg2 - kg1) : 40 / 18;
    return { kg1, pct1, kg2, pct2, slope, offset: pct1 - slope * kg1 };
  }

  function moistureFromWeight(kg, settings) {
    const w = Number(kg);
    if (!w || !Number.isFinite(w) || w <= 0) return null;
    const c = moistureCalibration(settings);
    return Math.max(0, Math.min(100, Math.round((c.slope * w + c.offset) * 10) / 10));
  }

  /** The bag weight that corresponds to a moisture % (inverse of the line). */
  function weightForMoisture(pct, settings) {
    const c = moistureCalibration(settings);
    return c.slope ? round2((Number(pct) - c.offset) / c.slope) : null;
  }

  const moistureHighPct = (settings) => Number((settings || {}).moistureHighPct ?? (settings || {}).moistureRejectPct) || 45;

  /** OK / WARN / HIGH. A high reading never turns a load away — it is a reason to deduct. */
  function moistureBand(pct, settings) {
    if (pct === null || pct === undefined) return 'UNKNOWN';
    if (pct >= moistureHighPct(settings)) return 'HIGH';
    if (pct >= (Number((settings || {}).moistureWarnPct) || 30)) return 'WARN';
    return 'OK';
  }
  /* ------------------------- drying in the bay -----------------------
     Biomass dries while it waits. The site figure is 0.6 kg a day per bag
     (a 50 kg bag is about 30 kg after a month), until the bag is as dry as
     it gets. This estimates what a bag weighs today from what it weighed
     on a known day, so a bay's moisture is "now", not "on arrival". */
  function driedBagKg(startKg, sinceISO, settings, nowMs) {
    const start = Number(startKg);
    if (!start || !Number.isFinite(start)) return null;
    const s = settings || {};
    const rate = Number.isFinite(Number(s.dryingKgPerDay)) && s.dryingKgPerDay !== null && s.dryingKgPerDay !== '' ? Math.max(0, Number(s.dryingKgPerDay)) : 0.6;
    const floor = Number(s.driestBagKg) > 0 ? Number(s.driestBagKg) : 18;
    const since = Date.parse(sinceISO || 0);
    const days = Number.isFinite(since) ? Math.max(0, ((nowMs || Date.now()) - since) / 864e5) : 0;
    // never "dries" a bag that was already lighter than the floor back up to it
    return round2(Math.max(Math.min(start, floor), start - rate * days));
  }
  const daysSince = (iso, nowMs) => { const t = Date.parse(iso || 0); return Number.isFinite(t) ? Math.max(0, Math.floor(((nowMs || Date.now()) - t) / 864e5)) : null; };
  const moistureReadyPct = (settings) => { const v = Number((settings || {}).moistureReadyPct); return Number.isFinite(v) && v > 0 ? v : 25; };

  const MOISTURE_LABEL = { OK: 'dry enough', WARN: 'damp', HIGH: 'wet', UNKNOWN: '' };
  const moistureTone = (band) => (band === 'OK' ? 'ok' : band === 'WARN' ? 'warn' : band === 'HIGH' ? 'danger' : 'muted');

  /* ---------------------------- deductions --------------------------- */
  /**
   * Biomass is never rejected. A load that is wet, dirty or otherwise short
   * of the agreement is still received, and a percentage is taken off the
   * batch value instead.
   */
  /**
   * The deduction the app proposes from the moisture reading. It is only a
   * starting point: the supervisor can change or clear it before accepting.
   */
  function suggestedDeduction(moisturePct, settings) {
    const s = settings || {};
    const band = moistureBand(moisturePct, s);
    const pick = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.min(100, Number(v))) : d);
    const pct = band === 'HIGH' ? pick(s.deductWetPct, 10) : band === 'WARN' ? pick(s.deductDampPct, 5) : 0;
    return { pct, band, reason: pct ? `${band === 'HIGH' ? 'Wet' : 'Damp'} load: moisture ${moisturePct}% from the bag weight` : '' };
  }

  function applyDeduction(bags, unitPrice, deductionPct) {
    const pct = Math.max(0, Math.min(100, Number(deductionPct) || 0));
    const gross = round2((Number(bags) || 0) * (Number(unitPrice) || 0));
    const deductions = round2((gross * pct) / 100);
    return { deductionPct: pct, grossAmount: gross, deductions, netAmount: round2(gross - deductions) };
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
    DRAFT: ['PENDING_SUPERVISOR', 'APPROVED'],
    PENDING_SUPERVISOR: ['APPROVED', 'DRAFT'],
    APPROVED: ['SENT_TO_HEAD_OFFICE'],
    SENT_TO_HEAD_OFFICE: ['PAID'],
    PAID: [],
  };
  const PAYMENT_LABEL = {
    DRAFT: 'Draft',
    PENDING_SUPERVISOR: 'Awaiting supervisor authorisation',
    APPROVED: 'Authorised — to be released',
    SENT_TO_HEAD_OFFICE: 'Sent to Head Office',
    PAID: 'Paid',
  };
  const paymentCanGo = (from, to) => (PAYMENT_FLOW[from] || []).includes(to);
  /** A step in a payment's history, in plain words. */
  const PAYMENT_ACTION = {
    CREATED: 'Created', PENDING_SUPERVISOR: 'Sent for authorisation', APPROVED: 'Authorised',
    SENT_TO_HEAD_OFFICE: 'Released to Head Office', PAID: 'Paid', DEDUCTION_SET: 'Deduction changed', DRAFT: 'Draft',
  };
  const paymentActionLabel = (a) => PAYMENT_ACTION[a] || String(a || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

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
    const issue = bag.bagIssueId ? Store.byId('bagIssues', bag.bagIssueId) : null;
    // A bag is re-used round after round, so only the run recorded on the
    // bag itself belongs to its current trip.
    const usage = bag.usageId ? Store.byId('usageRequests', bag.usageId) : null;
    const payment = delivery ? Store.all('payments').find((p) => p.deliveryId === delivery.id) : null;
    const quality = Store.all('qualityIssues').filter((q) => q.bagSerial === bag.serial);
    const events = Store.all('bagEvents').filter((e) => e.serial === bag.serial);

    return { bag, delivery, supplier, issue, usage, payment, quality, events };
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
    ROLES, ASSIGNABLE_ROLES, ROLE_LABEL, DEFAULT_ROLE_LABEL, ROLE_INFO, PERMISSIONS, can,
    TASKS, EDITABLE_ROLES, permissionsFor, isRoleCustomised, roleSummary,
    BAG_STATUS, BAG_STATUS_LABEL, BAG_TRANSITIONS, canTransition,
    round2, sampleSizeFor, evaluateFillCheck, moistureFromWeight, moistureBand,
    moistureCalibration, weightForMoisture, moistureHighPct, MOISTURE_LABEL, moistureTone, applyDeduction, suggestedDeduction,
    driedBagKg, daysSince, moistureReadyPct,
    weighTruck, avgBagWeight, PAYMENT_FLOW, PAYMENT_LABEL, paymentCanGo, paymentActionLabel,
    bagSerial, serialRange, parseSerialNumber, traceBag, code39SVG,
    money, kg, pct, dt, dOnly, todayISO,
  };
})();
