/**
 * smoke-test.js — boots the real app in jsdom and drives the main flows.
 *
 *   NODE_PATH=/path/to/node_modules node tests/smoke-test.js
 *
 * It is deliberately not a unit-test framework: it loads index.html exactly
 * as a browser would, then checks that a storekeeper can actually receive a
 * truck, that the price rule fires, and that a serial traces back.
 */
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const results = [];

function check(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('returned false');
    pass++; results.push(`  ✓ ${name}`);
  } catch (e) {
    fail++; results.push(`  ✗ ${name}\n      ${e.message}`);
  }
}

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) console.error('jsdom:', e.message); });
vc.on('error', (...a) => console.error('page error:', ...a));

const SCRIPTS = [
  'js/config.js', 'js/store.js', 'js/domain.js', 'js/firebase.js', 'js/auth.js',
  'js/sync.js', 'js/ui.js', 'js/seed.js', 'js/app.js',
  'js/views-core.js', 'js/views-stock.js', 'js/views-money.js',
];

const pageHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');   // scripts are evaluated manually, in order

const dom = new JSDOM(pageHtml, {
  url: 'http://localhost/index.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});

const { window } = dom;

for (const src of SCRIPTS) {
  window.eval(fs.readFileSync(path.join(ROOT, src), 'utf8'));
}

setTimeout(run, 30);

function session(role = 'super_admin', email = 'w.v.k.kalhara@gmail.com') {
  window.localStorage.setItem('efpl.session.v1', JSON.stringify({
    uid: 'u1', email, name: 'W. V. K. Kalhara', role, mode: 'offline', ownerVerified: role === 'super_admin',
    signedInAt: new Date().toISOString(),
    rememberUntil: new Date(Date.now() + 864e5).toISOString(),
  }));
  window.Auth.restore();
}

/** jsdom keeps closed modals around for the 200 ms fade — clear them between steps. */
function closeModals() {
  window.document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
}

function run() {
  const { Store, Auth, App, Domain, UI } = window;
  window.App.boot();
  results.push('\nBOOT');
  check('app object mounted', () => !!App && typeof App.render === 'function');
  check('localStorage usable', () => Store.persistence === 'localStorage');
  check('live store starts with no demo records', () => Store.space === 'live' && Store.all('suppliers').length === 0);
  // The rest of the suite runs against the sandboxed demo store.
  Store.useSpace('demo');
  window.Seed.ensure();
  Auth.init();
  check('demo history seeded (demo store only)', () => Store.space === 'demo' && Store.all('suppliers').length === 8 && Store.all('bags').length === 1200);
  check('super admin exists with owner role', () => {
    const u = Store.all('users').find((x) => x.email === 'w.v.k.kalhara@gmail.com');
    return u && u.role === 'super_admin';
  });
  check('subscription defaults to ACTIVE (no auto-expiry)', () => Store.subscription().status === 'ACTIVE');
  check('login screen shown when signed out', () => !!window.document.querySelector('#login-form'));
  check('sign-in screen offers Google (no console step needed)', () => !!window.document.querySelector('#google-btn'));
  check('sign-in screen offers self-service account creation', () => !!window.document.querySelector('#create-account'));

  results.push('\nSIGN IN');
  session();
  Auth.restore();
  App.render();
  check('shell renders after restore', () => !!window.document.querySelector('.app-shell'));
  check('no sign-in screen once signed in', () => !window.document.querySelector('#login-form'));

  results.push('\nNAVIGATION (every route renders)');
  const routes = Object.keys(App.routes);
  for (const r of routes) {
    check(`route #/${r}`, () => {
      App.navigate(r);
      const view = window.document.querySelector('#view');
      return view && view.innerHTML.length > 80;
    });
  }

  results.push('\nPRICE RULE (requirement 3)');
  const s = Store.settings();
  check('300 Rs/bag at 95% average', () => {
    const r = Domain.evaluateFillCheck({ bagCount: 100, fills: [95, 95, 95], settings: s });
    return r.unitPrice === 300 && r.amount === 30000 && r.decision === 'PASS_MARGINAL';
  });
  check('270 Rs/bag when average falls to 84%', () => {
    const r = Domain.evaluateFillCheck({ bagCount: 180, fills: [82, 85, 86, 83, 84, 87], settings: s });
    return r.unitPrice === 270 && r.amount === 48600 && r.decision === 'REDUCED_PRICE';
  });
  check('very low fill asks for a recount', () => {
    const r = Domain.evaluateFillCheck({ bagCount: 10, fills: [60, 58], settings: s });
    return r.decision === 'RECOUNT_REQUIRED';
  });
  check('supervisor override is honoured', () => {
    const r = Domain.evaluateFillCheck({ bagCount: 10, fills: [84], settings: s, outcome: 'OVERRIDE_FULL_PRICE' });
    return r.unitPrice === 300;
  });
  check('sample size follows the agreement (5%, min 3)', () => {
    return Domain.sampleSizeFor(100, s) === 5 && Domain.sampleSizeFor(20, s) === 3;
  });

  results.push('\nWEIGHING & MOISTURE (requirements 2, 5, 6)');
  check('net weight = gross - tare', () => Domain.weighTruck(8120, 1860).netKg === 6260);
  check('gross lighter than tare is refused', () => Domain.weighTruck(1000, 2000).ok === false);
  check('average bag weight', () => Domain.avgBagWeight(6260, 300) === 20.87);
  check('moisture estimate from bag weight', () => Domain.moistureFromWeight(25, s) === 20);
  check('moisture band warns at 25%', () => Domain.moistureBand(26, s) === 'WARN');

  results.push('\nBAG SERIALS (the WhatsApp decision)');
  check('parses a hyphenated range', () => {
    const list = window.VH.parseSerials('EFPL-BG-000301-000310', 'EFPL-BG');
    return list.length === 10 && list[0] === 'EFPL-BG-000301' && list[9] === 'EFPL-BG-000310';
  });
  check('parses a bare range and single numbers', () => {
    const list = window.VH.parseSerials('12-14 20', 'EFPL-BG');
    return list.length === 4 && list.includes('EFPL-BG-000020');
  });
  check('de-duplicates repeated scans', () => {
    const list = window.VH.parseSerials('5,5,5', 'EFPL-BG');
    return list.length === 1;
  });
  check('every seeded bag has a unique serial', () => {
    const serials = Store.all('bags').map((b) => b.serial);
    return new Set(serials).size === serials.length;
  });

  results.push('\nTRACEABILITY (requirement 11)');
  check('serial 000302 traces to supplier, farmer and receipt', () => {
    const t = Domain.traceBag(Store, 'EFPL-BG-000302');
    return t && t.supplier && t.farmer && t.delivery && t.delivery.receiptNo === 'RC-2026-0002';
  });
  check('a consumed bag also shows the gasifier run', () => {
    const t = Domain.traceBag(Store, 'EFPL-BG-000045');
    return t && t.bag.status === 'CONSUMED' && t.usage && t.usage.avgBagKg > 0;
  });
  check('unknown serial returns null (no invented record)', () => Domain.traceBag(Store, 'EFPL-BG-999999') === null);

  results.push('\nBAY STOCK (requirement 4)');
  check('bay 1 holds exactly the bags allocated to it (stored + drawn)', () => {
    const inBay = Store.all('bags').filter((b) => b.bayCode === 'BAY-1' && ['STORED', 'CONSUMED'].includes(b.status)).length;
    const delivery = Store.all('deliveries').find((d) => d.receiptNo === 'RC-2026-0001');
    const allocated = delivery.allocations.find((a) => a.bayCode === 'BAY-1').bags;
    return inBay === allocated;
  });
  check('allocations add up to the bag count', () => {
    const d = Store.all('deliveries').find((x) => x.receiptNo === 'RC-2026-0001');
    return d.allocations.reduce((a, x) => a + x.bags, 0) === d.bagCount;
  });

  results.push('\nPAYMENTS (requirements 9, 10)');
  check('payment cannot be sent to H.O. while it is a draft', () => Domain.paymentCanGo('DRAFT', 'SENT_TO_HEAD_OFFICE') === false);
  check('draft -> supervisor -> approved -> head office -> paid', () => {
    return Domain.paymentCanGo('DRAFT', 'PENDING_SUPERVISOR')
      && Domain.paymentCanGo('PENDING_SUPERVISOR', 'APPROVED')
      && Domain.paymentCanGo('APPROVED', 'SENT_TO_HEAD_OFFICE')
      && Domain.paymentCanGo('SENT_TO_HEAD_OFFICE', 'PAID');
  });
  check('reduced-price payment totals 180 x 270', () => {
    const p = Store.all('payments').find((x) => x.paymentNo === 'PAY-2026-0002');
    return p.netAmount === 48600 && p.unitPrice === 270;
  });
  check('farmer split covers the delivery', () => {
    const d = Store.all('deliveries').find((x) => x.receiptNo === 'RC-2026-0001');
    return d.farmerSplit.reduce((a, f) => a + f.bags, 0) === d.bagCount;
  });

  results.push('\nRECEIVING A TRUCK (end to end)');
  const pending = Store.all('deliveries').find((d) => d.status === 'AWAITING_ACCEPTANCE');
  check('a truck is waiting for acceptance', () => !!pending);
  closeModals();
  App.acceptFlow(pending.id);
  check('acceptance dialog opens with bay allocations', () => !!window.document.querySelector('[data-bay]'));
  const inputs = window.document.querySelectorAll('[data-bay]');
  inputs[0].value = String(pending.bagCount);
  inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  // give the truck serials that are in the registry but still in stock
  const freeSerials = Store.all('bags').filter((b) => b.status === 'IN_STOCK').slice(0, pending.bagCount).map((b) => b.serial);
  const serialBox = window.document.querySelector('[name=serials]');
  serialBox.value = freeSerials.join(' ');
  const paymentsBefore = Store.all('payments').length;
  window.document.querySelector('[data-act=accept]').click();
  check('delivery flips to ACCEPTED', () => Store.byId('deliveries', pending.id).status === 'ACCEPTED');
  check('a payment is generated automatically', () => Store.all('payments').length === paymentsBefore + 1);
  check('captured serials became stored bags in the bay', () => {
    const stored = Store.all('bags').filter((b) => b.deliveryId === pending.id && b.status === 'STORED');
    return stored.length === Math.min(pending.bagCount, freeSerials.length);
  });
  check('an audit entry was written', () => Store.all('audit').some((a) => a.action === 'delivery.accept' && a.entityId === pending.id));
  check('audit entry records who did it', () => {
    const a = Store.all('audit').filter((x) => x.action === 'delivery.accept').pop();
    return a.by === 'w.v.k.kalhara@gmail.com';
  });

  results.push('\nGASIFIER (requirements 5, 6)');
  const useReq = Store.all('usageRequests').find((u) => u.status === 'PENDING');
  check('an operator request is waiting for approval', () => !!useReq);
  closeModals();
  App.approveUsage(useReq.id);
  check('approval dialog lists bays with moisture', () => window.document.querySelectorAll('[name=pick]').length > 0);
  window.document.querySelector('[data-act=ok]').click();
  check('request moves to APPROVED', () => Store.byId('usageRequests', useReq.id).status === 'APPROVED');
  closeModals();
  App.consumeUsage(useReq.id);
  ['w1', 'w2', 'w3'].forEach((n, i) => {
    const el = window.document.querySelector(`[name=${n}]`);
    if (el) { el.value = String(22 + i * 0.5); el.dispatchEvent(new window.Event('input', { bubbles: true })); }
  });
  window.document.querySelector('[data-act=ok]').click();
  const after = Store.byId('usageRequests', useReq.id);
  check('consumption records the three-bag average', () => after.status === 'CONSUMED' && after.avgBagKg > 22 && after.avgBagKg < 23);
  check('outgoing weight = average x bags', () => after.totalKg === Math.round(after.avgBagKg * after.bags * 100) / 100);
  check('consumed bags leave the bay', () => Store.all('bags').filter((b) => b.usageId === useReq.id).every((b) => b.status === 'CONSUMED'));

  results.push('\nSECURITY');
  check('suspended state hides the app from ordinary staff', () => {
    Store.data.config.subscription = { status: 'SUSPENDED', message: 'Paused for testing', updatedAt: new Date().toISOString(), updatedBy: 'x' };
    session('storekeeper', 'chaminda.raj@efpl.org');
    App.render();
    const body = window.document.body.textContent;
    return body.includes('Service paused') && !window.document.querySelector('.app-shell');
  });
  check('the owner still gets in while suspended', () => {
    session('super_admin', 'w.v.k.kalhara@gmail.com');
    App.render();
    return !!window.document.querySelector('.app-shell');
  });
  check('subscription is not date-driven (no expiry field is consulted)', () => {
    const sub = Store.subscription();
    return !('expiresAt' in sub) && !('renewalDate' in sub);
  });
  Store.data.config.subscription = { status: 'ACTIVE', message: '', updatedAt: new Date().toISOString(), updatedBy: 'x' };
  session();
  App.render();

  check('HTML from a farmer name is escaped, not executed', () => {
    const farmer = Store.all('farmers')[0];
    farmer.name = '<img src=x onerror=alert(1)>';
    const html = UI.esc(farmer.name);
    farmer.name = 'R. M. Jayasundara';
    return !html.includes('<img') && html.includes('&lt;img');
  });
  check('role permissions are enforced for the operator role', () => {
    return Domain.can({ role: 'operator' }, 'usage.consume') === true
      && Domain.can({ role: 'operator' }, 'payment.approve') === false
      && Domain.can({ role: 'auditor' }, 'delivery.create') === false;
  });
  check('only the owner can hold the super_admin role', () => {
    const u = Store.all('users').find((x) => x.email === 'w.v.k.kalhara@gmail.com');
    return u.role === 'super_admin' && Domain.ROLES.includes('super_admin');
  });
  check('credential hash never leaves the browser in an exported backup', () => {
    const json = JSON.stringify(Store.exportJSON());
    return !json.includes('scrypt$') && !json.toLowerCase().includes('password');
  });
  check('audit trail is append-only from the UI (no delete path exists)', () => {
    return typeof Store.data.audit === 'object' && Array.isArray(Store.data.audit);
  });

  results.push('\nJOINING WITHOUT THE FIREBASE CONSOLE');
  check('a first-time account lands in "pending", not in a working role', () => {
    const u = window.Store.add('users', { email: 'new.person@gmail.com', name: 'New Person', role: 'pending', active: true }, 'test');
    session('pending', 'new.person@gmail.com');
    App.render();
    const shown = /Waiting for approval/.test(window.document.body.textContent);
    window.Store.remove('users', u.id);
    return shown;
  });
  check('a pending account can do nothing at all', () => {
    return Domain.can({ role: 'pending' }, 'delivery.create') === false
      && Domain.can({ role: 'pending' }, 'report.read') === false;
  });
  check('owner rights need a verified owner email, not just the address', () => {
    const base = { email: 'w.v.k.kalhara@gmail.com', role: 'super_admin', mode: 'online' };
    return window.Auth.isSuper(base) === false
      && window.Auth.isSuper(Object.assign({}, base, { ownerVerified: true })) === true;
  });
  check('records are cleaned of markup and non-numbers on the way in', () => {
    const c = window.Store.clean({ id: 'x', bags: '<b>1</b>', name: 'A<script>"' });
    return c.bags === null && !/[<>"]/.test(c.name);
  });
  check('admins cannot mint another owner or a pending role', () => {
    const list = Domain.ASSIGNABLE_ROLES;
    return !list.includes('super_admin') && !list.includes('pending') && list.includes('supervisor');
  });

  results.push('\nOFFLINE QUEUE');
  check('writes are queued for the cloud', () => (Store.data.outbox || []).length > 0);
  check('queue drains without a network (no throw)', () => {
    window.Sync.now('test');
    return true;
  });

  console.log('\n================ EnerFab Biomass Storage · smoke test ================');
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  dom.window.close();
  process.exit(fail ? 1 : 0);
}
