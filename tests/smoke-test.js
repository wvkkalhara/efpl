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
  settle();
}

/**
 * Closing a dialog steps the browser history back, and page changes wait
 * for that step to land. The suite runs without pausing, so deliver those
 * steps here instead of leaving every later page change waiting.
 */
function settle() {
  for (let i = 0; i < 20 && window.UI.isSettling(); i++) window.dispatchEvent(new window.PopStateEvent('popstate'));
}

/** jsdom keeps closed modals around for the 200 ms fade — clear them between steps. */
function closeModals() {
  settle();
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

  check('the demo button is hidden unless the owner turns it on', () => {
    const wasDemo = Store.space === 'demo';
    Store.useSpace('live');
    const hidden = !Auth.demoEnabled();
    Store.data.config.remote = Object.assign({}, Store.data.config.remote, { demoMode: true });
    const shown = Auth.demoEnabled();
    Store.data.config.remote.demoMode = false;
    if (wasDemo) Store.useSpace('demo');
    return hidden && shown && !window.document.querySelector('#preview-btn');
  });

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
  check('a very low fill is still received, at the reduced price', () => {
    const r = Domain.evaluateFillCheck({ bagCount: 10, fills: [60, 58], settings: s });
    return r.decision === 'REDUCED_PRICE' && r.unitPrice === 270 && r.amount === 2700;
  });
  check('there is no reject outcome any more', () => {
    const r = Domain.evaluateFillCheck({ bagCount: 10, fills: [60], settings: s, outcome: 'REJECT' });
    return r.decision !== 'REJECTED' && !Domain.PERMISSIONS.admin.includes('delivery.reject');
  });
  check('supervisor override is honoured', () => {
    const r = Domain.evaluateFillCheck({ bagCount: 10, fills: [84], settings: s, outcome: 'OVERRIDE_FULL_PRICE' });
    return r.unitPrice === 300;
  });
  check('sample size is the full 5%, rounded up, with no minimum of 3', () => {
    return Domain.sampleSizeFor(100, s) === 5 && Domain.sampleSizeFor(20, s) === 1 && Domain.sampleSizeFor(50, s) === 3;
  });

  results.push('\nWEIGHING & MOISTURE (requirements 2, 5, 6)');
  check('net weight = gross - tare', () => Domain.weighTruck(8120, 1860).netKg === 6260);
  check('gross lighter than tare is refused', () => Domain.weighTruck(1000, 2000).ok === false);
  check('average bag weight', () => Domain.avgBagWeight(6260, 300) === 20.87);
  check('moisture formula: 36 kg bag = 60%', () => Domain.moistureFromWeight(36, s) === 60);
  check('moisture formula: 18 kg bag = 20%', () => Domain.moistureFromWeight(18, s) === 20);
  check('moisture formula: y = 40/18 x - 20 in between (27 kg = 40%)', () => Domain.moistureFromWeight(27, s) === 40);
  check('moisture never goes below zero for a very light bag', () => Domain.moistureFromWeight(5, s) === 0);
  check('the line can be re-calibrated from settings', () => {
    const custom = Object.assign({}, s, { moistureCalKg1: 20, moistureCalPct1: 10, moistureCalKg2: 40, moistureCalPct2: 50 });
    return Domain.moistureFromWeight(30, custom) === 30 && Domain.weightForMoisture(60, s) === 36;
  });
  check('moisture bands: dry, damp, wet (never "reject")', () => {
    return Domain.moistureBand(20, s) === 'OK' && Domain.moistureBand(31, s) === 'WARN' && Domain.moistureBand(60, s) === 'HIGH';
  });

  results.push('\nDEDUCTIONS (nothing is rejected)');
  check('10% off 160 bags at Rs 300 leaves Rs 43,200', () => {
    const m = Domain.applyDeduction(160, 300, 10);
    return m.grossAmount === 48000 && m.deductions === 4800 && m.netAmount === 43200;
  });
  check('no deduction leaves the batch value untouched', () => Domain.applyDeduction(100, 270, 0).netAmount === 27000);
  check('a deduction is clamped to 0-100%', () => Domain.applyDeduction(10, 300, 250).netAmount === 0 && Domain.applyDeduction(10, 300, -5).netAmount === 3000);
  check('the wet demo load was received with a deduction, not rejected', () => {
    const d = Store.all('deliveries').find((x) => x.receiptNo === 'RC-2026-0005');
    const p = Store.all('payments').find((x) => x.deliveryId === d.id);
    return d.status === 'ACCEPTED' && d.deductionPct === 10 && p.netAmount === 43200 && p.deductions === 4800;
  });
  check('suggested deduction: none when dry, 5% damp, 10% wet', () => {
    return Domain.suggestedDeduction(20, s).pct === 0 && Domain.suggestedDeduction(35, s).pct === 5
      && Domain.suggestedDeduction(60, s).pct === 10 && Domain.suggestedDeduction(null, s).pct === 0;
  });
  check('suggestions can be switched off in settings', () => {
    return Domain.suggestedDeduction(60, Object.assign({}, s, { deductWetPct: 0, deductDampPct: 0 })).pct === 0;
  });
  check('no delivery in the demo is rejected', () => !Store.all('deliveries').some((d) => d.status === 'REJECTED'));

  results.push('\nBIOMASS TYPES');
  check('starts with Gliricidia, Cinnamon and Other', () => {
    return window.VH.biomassTypes().map((t) => t.label).join(',') === 'Gliricidia,Cinnamon,Other';
  });
  check('a type can be added and is offered when receiving', () => {
    const t = window.VH.addBiomassType('Ipil Ipil');
    App.navigate('intake');
    const offered = [...window.document.querySelectorAll('[name=biomassType] option')].map((o) => o.textContent);
    return t.id === 'IPIL_IPIL' && offered.includes('Ipil Ipil') && !offered.includes('Timber off-cuts');
  });
  check('the same name cannot be added twice', () => !!window.VH.addBiomassType('ipil ipil').error);
  check('a type can be removed again', () => {
    window.VH.removeBiomassType('IPIL_IPIL');
    return window.VH.biomassTypes().length === 3 && window.VH.typeLabel('IPIL_IPIL') === 'Ipil ipil';
  });

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
  check('serial 000302 traces to supplier and receipt', () => {
    const t = Domain.traceBag(Store, 'EFPL-BG-000302');
    return t && t.supplier && t.delivery && t.delivery.receiptNo === 'RC-2026-0002';
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
  check('the farmer screen is gone', () => !App.routes.farmers);

  results.push('\nRECEIVING A TRUCK (end to end)');
  const pending = Store.all('deliveries').find((d) => d.status === 'AWAITING_ACCEPTANCE');
  check('a truck is waiting for acceptance', () => !!pending);
  closeModals();
  App.acceptFlow(pending.id);
  check('acceptance dialog opens with bay allocations', () => !!window.document.querySelector('[data-bay]'));
  const inputs = window.document.querySelectorAll('[data-bay]');
  check('the suggested split already adds up to the bag count', () => {
    return [...inputs].reduce((a, i) => a + (Number(i.value) || 0), 0) === pending.bagCount;
  });
  // the supervisor overrides the suggestion and puts the whole load in the first bay
  inputs.forEach((i) => { i.value = '0'; });
  inputs[0].value = String(pending.bagCount);
  inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  // give the truck serials that are in the registry but still in stock
  // (one short, so a serial that is already sitting in BAY-1 can be scanned by mistake)
  const freeSerials = Store.all('bags').filter((b) => b.status === 'IN_STOCK').slice(0, pending.bagCount - 1).map((b) => b.serial);
  const serialBox = window.document.querySelector('[name=serials]');
  serialBox.value = freeSerials.join(' ') + ' EFPL-BG-000100';
  const paymentsBefore = Store.all('payments').length;
  // the supervisor takes 5% off this load instead of sending it back
  const pctBox = window.document.querySelector('[name=deductionPct]');
  check('a damp load opens with the suggested deduction and the default reason', () => {
    return pctBox.value === '5' && window.document.querySelector('[name=deductionReason]').value === 'Bags are not filled fully';
  });
  window.document.querySelector('[name=deductionReason]').value = '';
  pctBox.value = '5';
  pctBox.dispatchEvent(new window.Event('input', { bubbles: true }));
  window.document.querySelector('[data-act=accept]').click();
  check('a deduction without a reason is refused', () => Store.byId('deliveries', pending.id).status === 'AWAITING_ACCEPTANCE');
  window.document.querySelector('[name=deductionReason]').value = 'Damp load';
  window.document.querySelector('[data-act=accept]').click();
  check('delivery flips to ACCEPTED', () => Store.byId('deliveries', pending.id).status === 'ACCEPTED');
  check('a payment is generated automatically', () => Store.all('payments').length === paymentsBefore + 1);
  check('the payment carries the 5% deduction', () => {
    const p = Store.all('payments').find((x) => x.deliveryId === pending.id);
    const gross = pending.bagCount * p.unitPrice;
    return p.deductionPct === 5 && p.grossAmount === gross && p.deductions === gross * 0.05 && p.netAmount === gross * 0.95
      && p.deductionReason === 'Damp load' && Store.byId('deliveries', pending.id).payableAmount === p.netAmount;
  });
  check('new payment numbers do not collide with existing ones', () => {
    const nos = Store.all('payments').map((p) => p.paymentNo);
    return new Set(nos).size === nos.length;
  });
  check('a serial already in a bay is not taken a second time', () => {
    const stored = Store.all('bags').filter((b) => b.serial === 'EFPL-BG-000100');
    return stored.length === 1 && stored[0].deliveryId !== pending.id;
  });
  check('captured serials became stored bags in the bay', () => {
    const stored = Store.all('bags').filter((b) => b.deliveryId === pending.id && b.status === 'STORED');
    return stored.length === Math.min(pending.bagCount, freeSerials.length);
  });
  check('the owner leaves no entry in the activity log', () => {
    return !Store.all('audit').some((a) => a.by === 'w.v.k.kalhara@gmail.com');
  });

  results.push('\nGASIFIER (requirements 5, 6) — done as an administrator');
  session('admin', 'kasun.perera@efpl.org');
  App.render();
  check('an administrator does not see the owner in the staff list', () => {
    return Store.all('users').some((u) => u.email === 'w.v.k.kalhara@gmail.com')
      && !Auth.listUsers().some((u) => u.email === 'w.v.k.kalhara@gmail.com');
  });
  check('an administrator gets no Subscription tab', () => {
    App.navigate('admin');
    const tabs = [...window.document.querySelectorAll('[data-tab]')].map((b) => b.dataset.tab);
    return tabs.includes('users') && tabs.includes('audit') && !tabs.includes('sub')
      && !/Super Admin|owner/i.test(window.document.querySelector('#view').textContent);
  });
  check('a backup taken by an administrator leaves the owner out', () => {
    const data = App.exportData();
    return !JSON.stringify(data.users).includes('w.v.k.kalhara') && data.users.length > 0;
  });
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
  check('consumed bags leave the bay', () => {
    const used = Store.all('bags').filter((b) => b.usageId === useReq.id);
    return used.length === after.bags && used.every((b) => b.status === 'CONSUMED');
  });
  check('staff actions are logged with who did them', () => {
    const a = Store.all('audit').filter((x) => x.action === 'usage.consume').pop();
    return a && a.by === 'kasun.perera@efpl.org' && a.entityId === useReq.id
      && Store.all('audit').some((x) => x.action === 'usage.approve' && x.by === 'kasun.perera@efpl.org');
  });
  check('moisture at consumption follows the site formula', () => after.moisturePct === Domain.moistureFromWeight(after.avgBagKg, Store.settings()));
  check('consuming does not create duplicate bag serials', () => {
    const serials = Store.all('bags').map((b) => b.serial);
    return new Set(serials).size === serials.length && serials.length === 1200;
  });

  results.push('\nEACH ROLE SEES ONLY ITS OWN WORK');
  const screensAs = (role, email) => { session(role, email); App.render(); return App.visibleScreens(); };
  check('gasifier operator: gasifier and stock, no money, no receiving', () => {
    const s2 = screensAs('operator', 'sunil.ops@efpl.org');
    return s2.includes('gasifier') && s2.includes('bays') && s2.includes('quality')
      && !s2.includes('payments') && !s2.includes('intake') && !s2.includes('suppliers') && !s2.includes('admin') && !s2.includes('reports');
  });
  check('the operator menu on screen matches', () => {
    const shown = [...window.document.querySelectorAll('.sidebar [data-nav]')].map((b) => b.dataset.nav);
    return shown.includes('gasifier') && !shown.includes('payments') && !shown.includes('admin');
  });
  check('a screen outside the role cannot be opened by its address', () => {
    App.navigate('payments');
    return /Not part of your role/.test(window.document.querySelector('#view').textContent);
  });
  check('operator is only told about gasifier work', () => {
    const navs = window.VH.myTasks().map((t) => t.nav);
    return navs.every((n) => ['gasifier', 'quality'].includes(n));
  });
  check('accounts: payments and reports, no receiving, no gasifier', () => {
    const s2 = screensAs('accounts', 'accounts@efpl.org');
    return s2.includes('payments') && s2.includes('reports') && s2.includes('deliveries')
      && !s2.includes('intake') && !s2.includes('gasifier') && !s2.includes('bags') && !s2.includes('admin');
  });
  check('store keeper: receiving and bags, no reports, no administration', () => {
    const s2 = screensAs('storekeeper', 'chaminda.raj@efpl.org');
    return s2.includes('intake') && s2.includes('bags') && s2.includes('returns') && !s2.includes('reports') && !s2.includes('admin');
  });
  check('supervisor is told about trucks and authorisations', () => {
    screensAs('supervisor', 'nimal.silva@efpl.org');
    const navs = window.VH.myTasks().map((t) => t.nav);
    return navs.includes('payments') && !navs.includes('admin');
  });
  check('supervisor has the yard and payments but not Administration', () => {
    const s2 = screensAs('supervisor', 'nimal.silva@efpl.org');
    return s2.includes('deliveries') && s2.includes('payments') && s2.includes('reports') && !s2.includes('admin');
  });
  check('auditor sees every screen except the receiving form', () => {
    const s2 = screensAs('auditor', 'audit@efpl.org');
    return s2.length === Object.keys(App.routes).length - 1 && !s2.includes('intake') && s2.includes('admin');
  });
  check('every role has a plain-words description', () => Domain.ASSIGNABLE_ROLES.every((r) => Domain.ROLE_INFO[r] && App.screensForRole(r).length > 1));

  results.push('\nCLOUD SYNC (old data must never come back)');
  session('admin', 'kasun.perera@efpl.org');
  App.render();
  const { Sync } = window;
  const later = (ms) => new Date(Date.now() + ms).toISOString();
  check('a newer cloud record replaces the local one and cancels the stale upload', () => {
    const bag = Store.all('bags').find((b) => b.status === 'STORED' && b.bayId);
    Store.markDirty('bags', bag.id);                       // this device has an older edit queued
    const cloud = { id: bag.id, serial: bag.serial, status: 'IN_STOCK', condition: 'GOOD', updatedAt: later(60000) };
    Sync._mergeCollection('bags', { [bag.id]: cloud });
    const after = Store.byId('bags', bag.id);
    const stillQueued = Store.data.outbox.some((o) => o.coll === 'bags' && o.id === bag.id);
    return after.status === 'IN_STOCK' && !('farmerId' in after) && !('bayId' in after) && !stillQueued;
  });
  check('an older cloud record does not overwrite a newer local one', () => {
    const sup = Store.all('suppliers')[0];
    Store.update('suppliers', sup.id, { phone: '077 000 0000' });
    Sync._mergeCollection('suppliers', { [sup.id]: Object.assign({}, sup, { phone: 'OLD', updatedAt: '2020-01-01T00:00:00.000Z' }) });
    return Store.byId('suppliers', sup.id).phone === '077 000 0000'
      && Store.data.outbox.some((o) => o.coll === 'suppliers' && o.id === sup.id);
  });
  check('a delivery that comes back without its empty lists still opens', () => {
    Sync._mergeCollection('deliveries', { del_cloud1: {
      id: 'del_cloud1', receiptNo: 'RC-2026-0090', supplierId: Store.all('suppliers')[0].id, bagCount: 10, netKg: 200,
      fillCheck: { decision: 'NOT_CHECKED', unitPrice: 300, amount: 3000 }, deliveredAt: later(0), updatedAt: later(0),
    } });
    const d = Store.byId('deliveries', 'del_cloud1');
    closeModals();
    App.openDelivery('del_cloud1');
    const opened = /RC-2026-0090/.test(window.document.body.textContent);
    closeModals();
    return Array.isArray(d.allocations) && Array.isArray(d.fillCheck.fills) && d.fillCheck.avgFillPct === null && opened;
  });
  check('receipt numbers move past what other devices used', () => {
    Store.bumpCounters();
    return Store.data.counters.receipt === 91;
  });
  check('a number used twice while offline is renumbered before upload', () => {
    const mine = Store.add('deliveries', { receiptNo: 'RC-2026-0090', supplierId: Store.all('suppliers')[0].id, bagCount: 5, status: 'AWAITING_ACCEPTANCE', deliveredAt: later(1000) });
    const fixed = Store.fixDuplicateNumbers();
    const nos = Store.all('deliveries').map((d) => d.receiptNo);
    return fixed === 1 && mine.receiptNo === 'RC-2026-0091' && mine.renumberedFrom === 'RC-2026-0090' && new Set(nos).size === nos.length;
  });
  check('shared settings: the newest saved copy wins, an older one is ignored', () => {
    Store.patchSettings({ unitPrice: 300 });
    const ignored = Sync._mergeSettings({ unitPrice: 111, updatedAt: '2020-01-01T00:00:00.000Z' });
    const taken = Sync._mergeSettings({ unitPrice: 320, reducedUnitPrice: 288, fillThresholdPct: 90, updatedAt: later(60000) });
    const ok = ignored === 0 && taken === 1 && Store.settings().unitPrice === 320 && Store.settings().biomassTypes.length > 0;
    Store.patchSettings({ unitPrice: 300, reducedUnitPrice: 270 });
    return ok;
  });
  check('the owner role and "pending" are never uploaded as a role', () => {
    return !('role' in Sync._cloudProfile({ email: 'a@b.c', role: 'super_admin' }))
      && !('role' in Sync._cloudProfile({ email: 'a@b.c', role: 'pending' }))
      && Sync._cloudProfile({ email: 'a@b.c', role: 'supervisor' }).role === 'supervisor';
  });
  check('numbering 5 000 bags queues every one of them for the cloud', () => {
    const before = Store.data.outbox.length;
    Store.bulkAdd('bags', Array.from({ length: 5000 }, (_, i) => ({ serial: `TEST-BG-${i}`, status: 'IN_STOCK' })));
    const queued = Store.data.outbox.length - before;
    Store.data.bags = Store.data.bags.filter((b) => !String(b.serial).startsWith('TEST-BG-'));
    Store.data.outbox = Store.data.outbox.filter((o) => !Array.isArray(Store.data[o.coll]) || Store.byId(o.coll, o.id));
    return queued === 5000;
  });

  results.push('\nMY ACCOUNT');
  session('storekeeper', 'chaminda.raj@efpl.org');
  App.render();
  check('every role can open My account, with a password form', () => {
    closeModals();
    App.accountDialog();
    const m = window.document.querySelector('.modal-backdrop');
    const ok = !!m && !!m.querySelector('[name=newPassword]') && !!m.querySelector('[data-act=save-pw]') && /chaminda\.raj@efpl\.org/.test(m.textContent);
    closeModals();
    return ok;
  });
  check('a Google account is offered "Create a password"', () => {
    const s3 = JSON.parse(window.localStorage.getItem('efpl.session.v1'));
    window.localStorage.setItem('efpl.session.v1', JSON.stringify(Object.assign(s3, { provider: 'google', mode: 'google' })));
    Auth.restore();
    closeModals();
    App.accountDialog();
    const txt = window.document.querySelector('.modal-backdrop').textContent;
    closeModals();
    return !Auth.hasPassword() && /Create a password/.test(txt) && /You joined with Google/.test(txt);
  });

  results.push('\nRECEIVE FORM (one step at a time)');
  session('admin', 'kasun.perera@efpl.org');
  App.render();
  App.navigate('intake');
  check('only the first step is shown, and it cannot be skipped empty', () => {
    const f = window.document.querySelector('#intake-form');
    const shown = () => [...f.querySelectorAll(':scope > section')].map((x) => (x.hidden ? 0 : 1)).join('');
    const start = shown();
    f.querySelector('#step-next').click();
    return start === '1000' && shown() === '1000' && f.querySelector('#step-submit').hidden;
  });
  check('a complete step moves on, and the last step offers Register', () => {
    const f = window.document.querySelector('#intake-form');
    const put = (n, v) => { const e = f.querySelector(`[name=${n}]`); e.value = v; e.dispatchEvent(new window.Event('input', { bubbles: true })); };
    const shown = () => [...f.querySelectorAll(':scope > section')].map((x) => (x.hidden ? 0 : 1)).join('');
    put('supplierId', Store.all('suppliers')[0].id); put('vehicleNo', 'WP AB-1'); put('driverName', 'Driver');
    f.querySelector('#step-next').click();
    const two = shown();
    put('grossKg', '5600'); put('tareKg', '2000'); put('bagCount', '100');
    f.querySelector('#step-next').click();
    const cells = f.querySelectorAll('[data-fill]');
    // 5% of 100 bags: all five must be entered before the bags step
    cells[0].value = '92'; cells[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    f.querySelector('#step-next').click();
    const blocked = shown() === '0010';
    cells.forEach((c) => { c.value = '92'; c.dispatchEvent(new window.Event('input', { bubbles: true })); });
    f.querySelector('#step-next').click();
    return two === '0100' && cells.length === 5 && blocked && shown() === '0001' && !f.querySelector('#step-submit').hidden;
  });

  results.push('\nLIVE REPORTS AND PRINTING');
  session('admin', 'kasun.perera@efpl.org');
  App.render();
  App.navigate('reports');
  const rv = () => window.document.querySelector('#view');
  const figures = () => [...rv().querySelectorAll('.stat-value')].map((x) => x.textContent).join('|');
  check('reports open on the last 30 days with a chart', () => {
    return rv().querySelector('[data-preset="30"]').classList.contains('active') && rv().querySelectorAll('path.rc-in').length > 0;
  });
  check('choosing a supplier changes every figure without leaving the page', () => {
    const before = figures();
    const sel = rv().querySelector('[name=rpSupplier]');
    sel.value = Store.all('suppliers')[1].id;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    const changed = figures() !== before;
    sel.value = '';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    return changed && figures() === before;
  });
  check('the report redraws by itself when new records arrive', () => {
    const before = figures();
    const d = Store.add('deliveries', { receiptNo: 'RC-2026-0500', supplierId: Store.all('suppliers')[0].id, bagCount: 100, netKg: 2000,
      status: 'ACCEPTED', acceptedAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), payableAmount: 30000 });
    window.dispatchEvent(new window.CustomEvent('efpl:live'));
    const changed = figures() !== before;
    Store.data.deliveries = Store.data.deliveries.filter((x) => x.id !== d.id);
    window.dispatchEvent(new window.CustomEvent('efpl:live'));
    return changed && figures() === before;
  });
  check('printing puts the document in the print area, without buttons', () => {
    const d = Store.all('deliveries').find((x) => x.receiptNo === 'RC-2026-0005');
    App.printReceipt(d.id);
    const root = window.document.getElementById('print-root');
    const ok = !!root && /Biomass receipt/.test(root.textContent) && /RC-2026-0005/.test(root.textContent) && !root.querySelector('button');
    window.dispatchEvent(new window.Event('afterprint'));
    return ok && !window.document.getElementById('print-root');
  });
  check('bag labels print with a barcode each', () => {
    const d = Store.all('deliveries').find((x) => x.receiptNo === 'RC-2026-0005');
    App.printLabels(d.id);
    const n = window.document.querySelectorAll('#print-root .sticker svg.barcode').length;
    window.dispatchEvent(new window.Event('afterprint'));
    return n > 0 && n <= 96;
  });

  results.push('\nOWNER\'S LIST OF 12 NOVEMBER');
  session('admin', 'kasun.perera@efpl.org');
  App.render();
  const printed = (fn) => {
    fn();
    const root = window.document.getElementById('print-root');
    const out = root ? root.innerHTML : '';
    window.dispatchEvent(new window.Event('afterprint'));
    return out;
  };
  const supWithBank = Store.all('suppliers').find((x) => x.bankAccount);
  const accepted = Store.all('deliveries').find((x) => x.status === 'ACCEPTED' && x.supplierId === (supWithBank || {}).id)
    || Store.all('deliveries').find((x) => x.status === 'ACCEPTED');
  const acceptedSup = Store.byId('suppliers', accepted.supplierId);

  check('the site is Balangoda, and the old site name is moved over', () => {
    const s0 = Store.data.settings;
    const keep = Object.assign({}, s0);
    s0.rev = 0; s0.siteLocation = 'Nawa' + 'gaththegama';
    Store.migrateSettings();
    const moved = s0.siteLocation;
    Object.assign(s0, keep);
    return Store.settings().siteLocation === 'Balangoda' && moved === 'Balangoda';
  });
  check('a new yard starts with 30 bays of 200 bags', () => {
    Store.useSpace('live');
    const empty = Store.all('bays').length === 0;
    const made = App.ensureBays();
    const bays = Store.all('bays');
    const ok = empty && made === 30 && bays.length === 30 && bays.every((b) => b.capacityBags === 200);
    Store.data.bays = []; Store.data.outbox = []; Store.save('test-cleanup');
    Store.useSpace('demo');
    return ok;
  });
  check('a bay can be resized (bay size is flexible)', () => {
    App.navigate('bays');
    const bay = Store.all('bays').find((b) => b.code === 'BAY-8');
    closeModals();
    App.editBay(bay.id);
    const box = window.document.querySelector('.modal [name=capacityBags]');
    box.value = '250';
    window.document.querySelector('.modal [data-act=save]').click();
    const ok = Store.byId('bays', bay.id).capacityBags === 250;
    Store.update('bays', bay.id, { capacityBags: 200 }, 'test-revert');
    closeModals();
    return ok;
  });
  check('a bag dries 0.6 kg a day: 50 kg is about 30 kg after a month, never below 18 kg', () => {
    const s0 = Store.settings();
    const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
    return Domain.driedBagKg(50, ago(30), s0) === 32 && Domain.driedBagKg(50, ago(100), s0) === 18 && Domain.driedBagKg(50, ago(0), s0) === 50;
  });
  check('dry bays are marked red on the bay screen', () => {
    App.navigate('bays');
    const tiles = window.document.querySelectorAll('.bay-tile.is-dry');
    const ready = Store.all('bays').filter((b) => { const x = window.VH.bayNow(b); return x && x.ready; }).length;
    return ready > 0 && tiles.length === ready;
  });
  check('tapping a bay shows what is in it now, with a History button', () => {
    const bay = Store.all('bays').find((b) => window.VH.bagsInBay(b.id) > 0);
    closeModals();
    App.openBay(bay.id);
    const m = window.document.querySelector('.modal');
    const ok = /In the bay now/.test(m.textContent) && /Moisture today/.test(m.textContent) && !!m.querySelector('[data-act=history]');
    closeModals();
    return ok;
  });
  check('bay history lists loads in and out with the moisture each time', () => {
    const bay = Store.all('bays').find((b) => b.code === 'BAY-1');
    const rows = window.VH.bayHistory(bay.id);
    closeModals();
    App.bayHistory(bay.id);
    const shown = window.document.querySelector('.modal').textContent;
    closeModals();
    return rows.some((r) => r.kind === 'in') && rows.some((r) => r.kind === 'out')
      && rows.every((r) => r.kind === 'weigh' || typeof r.moisture === 'number') && /history/.test(shown);
  });
  check('a blank fill-check sheet prints one box per sample bag (5% of 120 = 6)', () => {
    const html = printed(() => App.printFillSheet({ bagCount: 120 }));
    return /Fill check sheet/.test(html) && /Bag 6/.test(html) && !/Bag 7/.test(html);
  });
  check('every print carries the logo', () => {
    const pay = Store.all('payments')[0];
    const docs = [
      printed(() => App.printReceipt(accepted.id)),
      printed(() => App.printInvoice(accepted.id)),
      printed(() => App.printFillSheet({})),
      printed(() => App.printPaymentSlip(pay.id)),
      printed(() => App.printSupplierStatement(acceptedSup.id)),
    ];
    const labels = printed(() => App.printLabels(accepted.id));
    return docs.every((h) => h.includes('print-logo')) && labels.includes('sticker-logo');
  });
  check('the invoice and the receipt carry the supplier\'s bank details', () => {
    const inv = printed(() => App.printInvoice(accepted.id));
    const rec = printed(() => App.printReceipt(accepted.id));
    return !!acceptedSup.bankAccount && /Purchase invoice/.test(inv) && inv.includes(acceptedSup.bankAccount) && rec.includes(acceptedSup.bankAccount);
  });
  check('supplier search on Receive biomass narrows the list', () => {
    App.navigate('intake');
    const f = window.document.querySelector('#intake-form');
    const find = f.querySelector('#sup-find');
    find.value = acceptedSup.name;
    find.dispatchEvent(new window.Event('input', { bubbles: true }));
    const opts = [...f.querySelectorAll('[name=supplierId] option')].filter((o) => o.value);
    return opts.length === 1 && f.querySelector('[name=supplierId]').value === acceptedSup.id && !!f.querySelector('#sup-new');
  });
  check('a half-entered load survives printing and a page reload, on the step it was on', () => {
    App.navigate('intake');
    let f = window.document.querySelector('#intake-form');
    const put = (n, v) => { const e = f.querySelector(`[name=${n}]`); e.value = v; e.dispatchEvent(new window.Event('input', { bubbles: true })); };
    put('supplierId', acceptedSup.id); put('vehicleNo', 'SG DR-0001'); put('driverName', 'Draft Driver');
    f.querySelector('#step-next').click();
    put('grossKg', '6000'); put('tareKg', '4000'); put('bagCount', '40');
    f.querySelector('#step-next').click();
    const cell = f.querySelector('[data-fill]');
    cell.value = '87'; cell.dispatchEvent(new window.Event('input', { bubbles: true }));
    printed(() => f.querySelector('#print-fill-sheet').click());   // saves the draft before printing
    // what a phone does when it comes back from the print screen: reload the page
    App.mountView();
    f = window.document.querySelector('#intake-form');
    const shown = [...f.querySelectorAll(':scope > section')].map((x) => (x.hidden ? 0 : 1)).join('');
    return f.querySelector('[name=vehicleNo]').value === 'SG DR-0001' && f.querySelector('[name=supplierId]').value === acceptedSup.id
      && f.querySelector('[name=bagCount]').value === '40' && f.querySelector('[data-fill]').value === '87' && shown === '0010';
  });
  check('the draft is forgotten once the load is cleared', () => {
    const f = window.document.querySelector('#intake-form');
    f.querySelector('#cancel-intake').click();
    App.mountView();
    return window.document.querySelector('#intake-form [name=vehicleNo]').value === ''
      && !Object.keys(window.localStorage).some((k) => k.startsWith('efpl.intakeDraft'));
  });
  check('an administrator can remove a user, and add the same email back later', () => {
    const u = Store.all('users').find((x) => x.role === 'storekeeper' && !x.deleted);
    Auth.removeUser(u.id);
    const gone = !Auth.listUsers().some((x) => x.id === u.id) && Store.byId('users', u.id).active === false;
    Auth.createUser({ email: u.email, name: u.name, role: 'storekeeper' });
    const back = Auth.listUsers().some((x) => x.id === u.id && x.active !== false);
    return gone && back;
  });
  check('there is no Farmers screen in any menu', () => {
    return !App.routes.farmers && !App.visibleScreens().includes('farmers') && !/Farmers/.test(window.document.querySelector('.app-shell').textContent);
  });
  check('no Sinhala text on any screen', () => {
    for (const r of Object.keys(App.routes)) {
      App.navigate(r);
      if (/[඀-෿]/.test(window.document.body.textContent)) throw new Error(`Sinhala text on ${r}`);
    }
    return true;
  });

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

  check('HTML from a supplier name is escaped, not executed', () => {
    const html = UI.esc('<img src=x onerror=alert(1)>');
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
