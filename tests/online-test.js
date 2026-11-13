/* =====================================================================
   online-test.js — "the app always tries to be online by itself".
   Boots the real app in jsdom with a pretend cloud and a pretend live
   link, then pulls the network away and gives it back, drops the link,
   lets it go silent, and checks that the app reconnects on its own and
   that the status chip stays calm (no flicker, no red for a blip).
   Run: node tests/online-test.js   (also part of npm test)
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const results = [];
let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('returned false');
    pass++; results.push(`  ✓ ${name}`);
  } catch (e) {
    fail++; results.push(`  ✗ ${name}\n      ${e.message}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait until fn() is true (or give up after `ms`). */
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(20); }
  return fn();
}

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) console.error('jsdom:', e.message); });

const pageHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(pageHtml, { url: 'http://localhost/index.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;

/* ---- a pretend live link (EventSource) ---- */
const links = [];
const pulses = () => links.filter((l) => /\/pulse\.json/.test(l.url));
class FakeEventSource {
  constructor(url) {
    this.url = url; this.readyState = 0; this.listeners = {}; this.closed = false;
    links.push(this);
    setTimeout(() => this.attempt(), 5);
  }
  /** Like a browser: with no network it reports an error and keeps retrying by itself. */
  attempt() {
    if (this.closed) return;
    if (net.up) { this.readyState = 1; if (this.onopen) this.onopen(); this.emit('put', { path: '/', data: { at: 1 } }); return; }
    this.fail(false);
    setTimeout(() => this.attempt(), 40);
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  emit(type, data) { for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(data) }); }
  fail(giveUp) { this.readyState = giveUp ? 2 : 0; if (this.onerror) this.onerror(new window.Event('error')); }
  close() { this.closed = true; this.readyState = 2; }
}
window.EventSource = FakeEventSource;

for (const src of ['js/config.js', 'js/store.js', 'js/domain.js', 'js/firebase.js', 'js/auth.js', 'js/sync.js', 'js/ui.js',
  'js/seed.js', 'js/app.js', 'js/views-core.js', 'js/views-stock.js', 'js/views-money.js', 'js/tutorial.js', 'js/help.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, src), 'utf8'));
}

window.EFPL_CONFIG.tutorialAutoStart = false;

/* ---- a pretend cloud ---- */
const net = { up: false, mode: 'ok', calls: 0 };
const { FB } = window;
const netError = () => new FB.FBError('No connection to Firebase — working offline.', 'NETWORK', 0);
FB.get = async (p) => {
  net.calls++;
  await sleep(2);
  if (!net.up) throw netError();
  if (net.mode === 'flaky') throw new Error('Service unavailable (503)');
  if (net.mode === 'expired') { const e = new FB.FBError('Session expired', 'UNAUTHORIZED', 401); e.detail = 'Auth token is expired'; throw e; }
  return null;
};
FB.patch = async () => { if (!net.up) throw netError(); return {}; };
FB.put = FB.patch;
FB.url = (p, token) => `https://example.invalid/${p}.json?auth=${token}`;

setTimeout(run, 30);

async function run() {
  const { Store, Auth, App, Sync, UI } = window;
  Sync._links.backoff([60, 120, 200]);     // seconds in real life; milliseconds here

  App.boot();
  window.localStorage.setItem('efpl.session.v1', JSON.stringify({
    uid: 'u-admin', email: 'kasun.perera@efpl.org', name: 'Kasun', role: 'admin', mode: 'online',
    idToken: 'tok', tokenExpiresAt: Date.now() + 3600e3,
    signedInAt: new Date().toISOString(), rememberUntil: new Date(Date.now() + 864e5).toISOString(),
  }));
  Auth.restore();
  Auth.idToken = async () => 'tok';
  Auth._tokenRefresh = async () => 'tok';
  App.render();
  const chip = () => window.document.getElementById('sync-chip');
  const chipText = () => chip().querySelector('.sync-text').textContent;

  results.push('\nSTARTING WITH NO NETWORK');
  Sync.start();
  await check('with no network the app says Offline, calmly (amber, not red)', async () => {
    await until(() => Sync.state.phase === 'offline');
    return Sync.view().tone === 'offline' && chip().dataset.tone === 'offline' && /^Offline/.test(chipText());
  });
  await check('it keeps trying by itself', async () => {
    const before = net.calls;
    await sleep(500);
    return net.calls > before && Sync._links.open().retrying;
  });

  results.push('\nTHE NETWORK COMES BACK (nobody touches anything)');
  net.up = true;
  await check('it gets back online by itself, without an "online" event', async () => until(() => Sync.state.phase === 'ok', 3000));
  await check('the live link opens by itself and the chip says Live', async () => {
    await until(() => Sync.state.live, 3000);
    return Sync.state.live && chip().dataset.tone === 'live' && chipText() === 'Live';
  });

  results.push('\nBACKGROUND ROUNDS DO NOT FLICKER');
  await check('a background sync keeps showing Live (no "Syncing…")', async () => {
    const p = Sync.now('interval');
    const during = chipText();
    await p;
    return Sync.state.quiet === false && during === 'Live' && chipText() === 'Live';
  });
  await check('pressing the chip does show Syncing…', async () => {
    const p = Sync.now('manual');
    const during = chipText();
    await p;
    return during === 'Syncing…' && chipText() === 'Live';
  });

  results.push('\nTHE LIVE LINK DROPS OR GOES SILENT');
  await check('a link the browser gave up on is opened again by itself', async () => {
    const old = pulses()[pulses().length - 1];
    const count = pulses().length;
    old.fail(true);
    const reopened = await until(() => pulses().length > count && Sync.state.live, 3000);
    return reopened && pulses()[pulses().length - 1] !== old;
  });
  await check('while the browser is reconnecting the chip does not say Live', async () => {
    const cur = pulses()[pulses().length - 1];
    cur.fail(false);                          // readyState 0: the browser retries on its own
    const notLive = !Sync.state.live && chip().dataset.tone !== 'live';
    cur.emit('put', { path: '/', data: { at: 2 } });   // …and it is back
    return notLive && Sync.state.live;
  });
  await check('a link that has gone silent is replaced', async () => {
    const count = links.length;
    Sync._links.staleAfter(80);
    await sleep(150);
    Sync._links.check();
    Sync._links.staleAfter(100000);
    return until(() => links.length > count && Sync.state.live, 2000);
  });

  results.push('\nA PASSING PROBLEM IS NOT AN ERROR');
  await check('a server hiccup shows "Reconnecting…", not red', async () => {
    net.mode = 'flaky';
    await Sync.now('stream');                 // a round that downloads (another device changed something)
    return Sync.state.phase === 'error' && Sync.view().tone === 'connecting' && Sync.view().text === 'Reconnecting…'
      && chip().dataset.tone === 'connecting' && Sync._links.open().retrying;
  });
  await check('…and it recovers by itself', async () => {
    net.mode = 'ok';
    return until(() => Sync.state.phase === 'ok', 3000);
  });
  await check('an expired sign-in is the one thing shown in red, and it stops retrying', async () => {
    net.mode = 'expired';
    await Sync.now('interval');
    const ok = Sync.state.fatal && Sync.view().tone === 'problem' && !Sync._links.open().retrying;
    net.mode = 'ok';
    return ok;
  });

  results.push('\nGOING AND COMING BACK');
  await check('the network going away closes the link and shows Offline', async () => {
    net.up = false;
    window.dispatchEvent(new window.Event('offline'));
    return Sync.state.phase === 'offline' && !Sync.state.live && chip().dataset.tone === 'offline';
  });
  await check('coming back to the app checks straight away', async () => {
    net.up = true;
    const count = links.length;
    window.dispatchEvent(new window.Event('online'));
    return until(() => Sync.state.phase === 'ok' && Sync.state.live && links.length > count, 2000);
  });
  await check('a short blip does not pop up "Offline" / "Back online" notices', async () => {
    const toasts = () => window.document.querySelectorAll('.toast').length;
    const before = toasts();
    net.up = false;
    await Sync.now('interval');
    net.up = true;
    await until(() => Sync.state.phase === 'ok', 3000);
    await sleep(50);
    return toasts() === before;
  });

  results.push('\nOWNER / ADMINISTRATOR: RESET EVERYTHING (ONLY ACCOUNTS KEPT)');
  const patches = [];
  const puts = [];
  FB.patch = async (p, v) => { if (!net.up) throw netError(); patches.push([p, JSON.parse(JSON.stringify(v))]); return {}; };
  FB.put = async (p, v) => { if (!net.up) throw netError(); puts.push([p, JSON.parse(JSON.stringify(v))]); return {}; };
  const signInAs = (role, email) => {
    window.localStorage.setItem('efpl.session.v1', JSON.stringify({
      uid: `u-${role}`, email, name: role, role, mode: 'online', ownerVerified: role === 'super_admin',
      idToken: 'tok', tokenExpiresAt: Date.now() + 3600e3, signedInAt: new Date().toISOString(), rememberUntil: new Date(Date.now() + 864e5).toISOString(),
    }));
    Auth.restore(); Auth.idToken = async () => 'tok';
  };
  const fill = () => {
    Store.add('suppliers', { code: 'SUP-0001', name: 'Test supplier' });
    Store.add('deliveries', { receiptNo: 'RC-2026-0001', status: 'ACCEPTED', bagCount: 10, allocations: [] });
    Store.add('payments', { paymentNo: 'PAY-2026-0001', status: 'APPROVED', netAmount: 3000 });
  };
  fill();
  App.ensureBays();
  Store.patchSettings({ unitPrice: 987654, siteName: 'Changed site' });
  Store.add('audit', { at: new Date().toISOString(), by: 'kasun.perera@efpl.org', action: 'test.entry' });
  const usersBefore = Store.all('users').length;
  signInAs('supervisor', 'sup@efpl.org');
  await check('a supervisor cannot reset everything (no button, refused)', async () => {
    if (Sync.canReset()) return false;
    try { await Sync.wipeEverywhere(); return false; } catch (e) { return /owner or an administrator/i.test(e.message) && Store.all('deliveries').length > 0; }
  });
  signInAs('admin', 'kasun.perera@efpl.org');
  await check('an administrator may reset everything', async () => Sync.canReset());
  await check('with no connection nothing is deleted, and it says so', async () => {
    net.up = false;
    patches.length = 0; puts.length = 0;
    try { await Sync.wipeEverywhere(); return false; } catch (e) {
      net.up = true;
      return /Nothing was deleted/.test(e.message) && Store.all('deliveries').length > 0 && patches.length === 0 && puts.length === 0;
    }
  });
  let wipeAt = null;
  await check('it deletes records, bays, settings and the activity log in the cloud, then tells every device', async () => {
    patches.length = 0; puts.length = 0;
    const res = await Sync.wipeEverywhere();
    wipeAt = res.at;
    const first = patches[0];
    const mark = puts.find((p) => p[0] === 'appConfig/wipe');
    return first[0] === 'biomass' && ['deliveries', 'payments', 'suppliers', 'bags', 'bays', 'farmers', 'settings'].every((c) => first[1][c] === null)
      && !('users' in first[1])
      && puts.some((p) => p[0] === 'auditLog' && p[1] === null)
      && !!mark && mark[1].at === res.at && mark[1].full === true && /kasun/.test(mark[1].by)
      && !puts.some((p) => /^users/.test(p[0])) && !patches.some((p) => /^users/.test(p[0]))
      && patches.some((p) => p[0] === 'biomass' && p[1].pulse);
  });
  await check('this device is brand new; only the accounts are kept', async () => {
    const left = ['deliveries', 'payments', 'suppliers', 'bags', 'audit'].filter((c) => Store.all(c).length);
    // the app puts the 30 starting bays back straight away (fresh, empty ones)
    const oldBays = Store.all('bays').filter((b) => Date.parse(b.updatedAt) > Date.parse('2026-01-02'));
    const queued = (Store.data.outbox || []).filter((o) => ['deliveries', 'payments', 'suppliers', 'audit', 'settings'].includes(o.coll));
    const s = Store.settings();
    const bad = [];
    if (left.length) bad.push(`still there: ${left.join(', ')}`);
    if (oldBays.length) bad.push(`${oldBays.length} edited bays kept`);
    if (s.unitPrice === 987654 || s.siteName === 'Changed site' || s.updatedAt) bad.push('settings not reset');
    if (Store.all('users').length !== usersBefore || !usersBefore) bad.push('accounts changed');
    if (queued.length) bad.push(`${queued.length} old uploads still queued`);
    if (Store.data.meta.wipeSeenAt !== wipeAt || Store.data.meta.wipeFull !== true) bad.push('reset mark not kept');
    if (bad.length) throw new Error(bad.join('; '));
  });
  await check('numbering starts again at 0001', async () => Store.nextSeq('receipt', 1) === 1);
  await check('the starting bays are there again, empty', async () => { App.ensureBays(); return Store.all('bays').length === 30; });
  await check('old settings and old log entries in the cloud are not taken back', async () => {
    const old = new Date(Date.parse(wipeAt) - 60e3).toISOString();
    Sync._mergeSettings({ updatedAt: old, unitPrice: 987654 });
    return Store.settings().unitPrice !== 987654;
  });
  signInAs('super_admin', 'w.v.k.kalhara@gmail.com');
  await check('the owner may reset everything too', async () => Sync.canReset());

  results.push('\nANOTHER DEVICE SEES THE CLEAR-OUT');
  // pretend to be a second device that still has the old records, plus one load typed offline afterwards
  Store.data.meta.wipeSeenAt = undefined;
  const old = new Date(Date.parse(wipeAt) - 3600e3).toISOString();
  const later = new Date(Date.parse(wipeAt) + 60e3).toISOString();
  Store.data.deliveries.push({ id: 'del_old', receiptNo: 'RC-2026-0007', status: 'ACCEPTED', createdAt: old, updatedAt: old, allocations: [] });
  Store.data.deliveries.push({ id: 'del_new', receiptNo: 'RC-2026-0001', status: 'AWAITING_ACCEPTANCE', createdAt: later, updatedAt: later, allocations: [] });
  Store.data.outbox.push({ id: 'ob1', coll: 'deliveries', id2: 'x', at: old }, { id: 'ob2', coll: 'deliveries', at: later });
  Store.data.outbox[Store.data.outbox.length - 2].id = 'del_old';
  Store.data.outbox[Store.data.outbox.length - 1].id = 'del_new';
  let told = null;
  window.addEventListener('efpl:wiped', (e) => { told = e.detail; }, { once: true });
  // …and still has its old log entry and old prices
  const oldAudit = { id: 'aud_old', at: old, createdAt: old, updatedAt: old, by: 'x@efpl.org', action: 'old' };
  Store.data.audit.push(oldAudit);
  Store.data.settings.unitPrice = 987654; Store.data.settings.updatedAt = old;
  FB.get = async (p) => {
    if (!net.up) throw netError();
    if (p === 'appConfig') return { wipe: { at: wipeAt, by: 'kasun.perera@efpl.org', full: true } };
    if (p === 'auditLog') return { aud_old: oldAudit };
    return null;
  };
  await check('it clears its old records, log and settings by itself and says who did it', async () => {
    await Sync.now('stream');
    return !Store.byId('deliveries', 'del_old') && !!told && /kasun/.test(told.by)
      && !Store.byId('audit', 'aud_old') && Store.settings().unitPrice !== 987654
      && !(Store.data.outbox || []).some((o) => o.id === 'del_old');
  });
  await check('an old log entry still in the cloud is not taken back', async () => {
    await Sync.pullAudit();
    return !Store.byId('audit', 'aud_old');
  });
  await check('work typed offline after the clear-out is kept and still uploads', async () => {
    const sent = patches.some((p) => /deliveries$/.test(p[0]) && p[1] && p[1].del_new);
    const sentOld = patches.some((p) => /deliveries$/.test(p[0]) && p[1] && p[1].del_old);
    return !!Store.byId('deliveries', 'del_new') && sent && !sentOld;
  });
  await check('an old record uploaded by a stale device never comes back', async () => {
    Sync._mergeCollection('deliveries', {
      del_zombie: { id: 'del_zombie', receiptNo: 'RC-2026-0003', createdAt: old, updatedAt: later },
      del_fresh: { id: 'del_fresh', receiptNo: 'RC-2026-0004', createdAt: later, updatedAt: later },
    });
    return !Store.byId('deliveries', 'del_zombie') && !!Store.byId('deliveries', 'del_fresh');
  });
  await check('it happens once: the same mark does not clear new work again', async () => {
    const n = Store.all('deliveries').length;
    await Sync.now('stream');
    return Store.all('deliveries').length === n;
  });

  Sync.stop();
  console.log('\n================ EnerFab Biomass Storage · staying online ================');
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  dom.window.close();
  process.exit(fail ? 1 : 0);
}
