/* =====================================================================
   sync.js — offline-first cloud sync.
   ---------------------------------------------------------------------
   The local store is the source of truth while the site is working. This
   engine quietly pulls other devices' changes and pushes the queue when
   a connection appears. Nothing is ever blocked waiting for the network.

   The rules it follows, so old data can never push newer data out:

   1. PULL BEFORE PUSH. A tablet that was offline for a week first learns
      what changed in the cloud; whatever is newer there replaces its copy
      and is taken out of its upload queue. Only then does it upload.
   2. A NEWER RECORD REPLACES THE WHOLE RECORD. The cloud drops empty
      values, so "the farmer was cleared from this bag" arrives as a record
      with no farmer key at all. Copying keys over the old record would
      leave the old farmer in place; replacing the record does not.
   3. ONE REFUSED COLLECTION DOES NOT STOP THE REST. If the database rules
      refuse one kind of record, the others still sync and the refused ones
      stay queued on the device.
   4. STAFF ACCOUNTS COME FROM THE CLOUD. Roles are decided by an
      administrator and stored under /users; every device follows that.
   5. RUNNING NUMBERS MOVE PAST WHAT ARRIVES, and a duplicate receipt or
      payment number created offline is renumbered before it is uploaded.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG;
  const Store = window.Store;
  const FB = window.FB;

  const SYNCED = [
    'suppliers', 'farmers', 'bags', 'bagIssues', 'deliveries', 'bays',
    'usageRequests', 'qualityIssues', 'payments', 'bagReturns',
  ];
  // What the owner's "Delete all records everywhere" clears. Kept: staff,
  // business settings, the bay list (bays empty themselves, since what is in
  // a bay comes from the deliveries) and the activity log (append-only).
  const WIPED = SYNCED.filter((c) => c !== 'bays');
  const AUDIT_PATH = 'auditLog';
  const CHUNK = 400;                 // records per upload request
  const FULL_PULL_EVERY_MS = 120000; // background pulls of the whole yard are spaced out
  const GIVE_UP_AFTER = 6;           // refused uploads are retried this often, then only on "Sync now"

  const state = {
    phase: 'idle',        // idle | syncing | ok | error | blocked | offline | signed-out
    lastSyncAt: null,
    lastPullAt: 0,
    lastError: null,
    pushed: 0,
    pulled: 0,
    refused: [],          // collections the database rules would not accept
    live: false,          // true while the real-time link to the cloud is open
    quiet: false,         // a background round is running: the status chip does not flicker for it
    settled: 'idle',      // the last phase that was not "syncing" (what a quiet round keeps showing)
    fatal: false,         // a problem that retrying will not fix (sign-in expired)
    retryAt: 0,           // when the next automatic attempt to get back online is due
    listeners: new Set(),
  };

  const emit = () => { for (const fn of state.listeners) { try { fn(state); } catch (e) { console.error(e); } } };
  const set = (patch) => {
    Object.assign(state, patch);
    if (state.phase !== 'syncing') state.settled = state.phase;
    emit();
  };

  let timer = null;
  let running = false;
  let started = false;

  const stamp = (r) => Date.parse((r && r.updatedAt) || 0) || 0;
  /** A date string as milliseconds; no date is 0 (note: Date.parse(0) is the year 2000). */
  const ms = (s) => (typeof s === 'string' && s ? Date.parse(s) || 0 : 0);
  const isRefusal = (err) => err && (err.status === 401 || err.status === 403 || err.code === 'PERMISSION_DENIED' || err.code === 'UNAUTHORIZED');
  const isExpiredToken = (err) => isRefusal(err) && /expired|invalid.*token|could not parse auth token/i.test(err.detail || '');
  const Auth = () => window.Auth;

  /* --------------------------- pull / merge -------------------------- */
  /** Replace a local record with the cloud's newer copy (rule 2 above). */
  function replaceRecord(mine, r) {
    for (const k of Object.keys(mine)) if (!(k in r)) delete mine[k];
    Object.assign(mine, r);
  }

  function mergeCollection(coll, remote) {
    if (!remote || typeof remote !== 'object') return 0;
    let changed = 0;
    const local = Store.data[coll];
    const byId = new Map(local.map((x) => [x.id, x]));
    // after the owner cleared the records, nothing made before that may come back
    const wipeAt = WIPED.includes(coll) ? ms(Store.data.meta.wipeSeenAt) : 0;
    for (const id of Object.keys(remote)) {
      if (!remote[id] || typeof remote[id] !== 'object' || Array.isArray(remote[id])) continue;
      const r = Store.normalize(coll, Store.clean(remote[id]));
      if (r.id !== id) continue;            // a record must live under its own id
      if (wipeAt && ms(r.createdAt) <= wipeAt) continue;
      const mine = byId.get(id);
      if (!mine) {
        local.push(r);
        byId.set(id, r);
        changed++;
      } else if (stamp(r) > stamp(mine)) {
        replaceRecord(mine, r);            // cloud is newer -> it wins, whole record
        Store.clearDirty(coll, id);        // and our older edit must not be uploaded over it
        changed++;
      } else if (stamp(mine) > stamp(r)) {
        Store.markDirty(coll, id);         // we are newer -> keep ours, upload it
      }
    }
    return changed;
  }

  /** Business settings are shared: the newest saved copy wins on every device. */
  function mergeSettings(remote) {
    if (!remote || typeof remote !== 'object' || !remote.updatedAt) return 0;
    const local = Store.data.settings;
    if (stamp(remote) <= stamp(local)) return 0;
    const r = Store.clean(remote);
    const next = Object.assign({}, CFG.defaults, {
      siteName: local.siteName, siteLocation: local.siteLocation, headOfficeEmail: local.headOfficeEmail,
    }, r);
    if (!Array.isArray(next.biomassTypes) || !next.biomassTypes.length) next.biomassTypes = local.biomassTypes;
    Store.data.settings = next;
    Store.migrateSettings();             // settings saved by an older version get the same corrections
    Store.clearDirty('settings', 'singleton');
    return 1;
  }

  /**
   * Staff accounts. The cloud copy (keyed by sign-in id) is the authority for
   * who has which role, because only an administrator can write a role there.
   */
  async function pullUsers(token) {
    const me = Auth().current();
    if (!me) return { ok: false };
    let remote = null;
    try {
      remote = await FB.get('users', token);
    } catch (err) {
      if (err.code === 'NETWORK') return { ok: false, offline: true };
      if (isExpiredToken(err)) throw err;
      // Someone without a role may only read their own entry.
      if (!me.uid) return { ok: false };
      try {
        const own = await FB.get(`users/${me.uid}`, token);
        remote = own ? { [me.uid]: own } : {};
      } catch (err2) {
        if (err2.code === 'NETWORK') return { ok: false, offline: true };
        if (isExpiredToken(err2)) throw err2;
        return { ok: false };
      }
    }
    if (!remote || typeof remote !== 'object') return { ok: true, changed: 0 };

    const users = Store.data.users;
    const queued = new Set((Store.data.outbox || []).filter((o) => o.coll === 'users').map((o) => o.id));
    const canManage = Auth().can('user.manage');
    const roles = window.Domain.ASSIGNABLE_ROLES;
    const myEmail = String(me.email || '').toLowerCase();
    const before = Auth().role();
    let changed = 0;
    let iAmDisabled = false;
    const arrivals = [];          // people who have just signed in and are waiting for a role

    for (const uid of Object.keys(remote)) {
      const p = Store.clean(remote[uid]);
      if (!p || typeof p !== 'object' || typeof p.email !== 'string') continue;
      const email = p.email.toLowerCase();
      if (Auth().isOwnerEmail(email)) continue;                 // the owner is never a staff row
      const cloudRole = roles.includes(p.role) ? p.role : 'pending';
      const cloudActive = p.active !== false;
      let mine = users.find((u) => u.uid === uid) || users.find((u) => (u.email || '').toLowerCase() === email);

      if (!mine) {
        if (p.removed === true) continue;                       // removed before this device ever saw them
        users.push({
          id: `usr_${uid}`, uid, email, name: typeof p.name === 'string' && p.name ? p.name : email.split('@')[0],
          role: cloudRole, active: cloudActive,
          createdAt: p.updatedAt || new Date().toISOString(), updatedAt: p.updatedAt || new Date().toISOString(),
          pendingSince: cloudRole === 'pending' ? (p.updatedAt || new Date().toISOString()) : null,
        });
        changed++;
        if (cloudRole === 'pending') arrivals.push(typeof p.name === 'string' && p.name ? p.name : email);
        continue;
      }

      if (!mine.uid) {
        // Added here by email before the person ever signed in: now we know
        // their sign-in id, so the role chosen for them can be uploaded.
        mine.uid = uid;
        changed++;
        if (canManage && mine.role && mine.role !== 'pending' && mine.role !== cloudRole) {
          mine.updatedAt = new Date().toISOString();
          Store.markDirty('users', mine.id);
          continue;
        }
      }
      if (queued.has(mine.id) && canManage) continue;           // our own change is still on its way up

      const patch = {};
      if (mine.role !== cloudRole && mine.role !== 'super_admin') patch.role = cloudRole;
      if ((mine.active !== false) !== cloudActive) patch.active = cloudActive;
      if (typeof p.name === 'string' && p.name && p.name !== mine.name) patch.name = p.name;
      if ((mine.deleted === true) !== (p.removed === true)) patch.deleted = p.removed === true;
      if (Object.keys(patch).length) {
        Object.assign(mine, patch, { updatedAt: p.updatedAt || mine.updatedAt });
        if (patch.role && patch.role !== 'pending') mine.pendingSince = null;
        Store.clearDirty('users', mine.id);
        changed++;
      }
      if (email === myEmail && !cloudActive) iAmDisabled = true;
    }

    if (changed) {
      Store.save('sync-users');
      window.dispatchEvent(new CustomEvent('efpl:data-changed', { detail: { changed, users: true } }));
    }
    if (arrivals.length && canManage) window.dispatchEvent(new CustomEvent('efpl:new-person', { detail: { names: arrivals } }));
    if (iAmDisabled) window.dispatchEvent(new CustomEvent('efpl:account-disabled'));
    else if (Auth().current() && Auth().role() !== before) window.dispatchEvent(new CustomEvent('efpl:role-changed'));
    return { ok: true, changed };
  }

  async function pullData(token) {
    let remote;
    try {
      remote = await FB.get(CFG.syncPath, token);
    } catch (err) {
      if (err.code === 'NETWORK') { set({ phase: 'offline', lastError: null }); return false; }
      if (isExpiredToken(err)) throw err;
      if (isRefusal(err)) {
        set({
          phase: 'blocked',
          lastError: 'The database is refusing to let this account read the records. Check that firebase.rules.json is published and that an administrator has given this account a role.',
        });
        return false;
      }
      set({ phase: 'error', lastError: err.message });
      return false;
    }

    let changed = 0;
    if (remote && typeof remote === 'object') {
      for (const coll of SYNCED) {
        if (remote[coll]) changed += mergeCollection(coll, remote[coll]);
      }
      changed += mergeSettings(remote.settings);
    }
    Store.bumpCounters();
    const renumbered = Store.fixDuplicateNumbers();
    if (renumbered) window.dispatchEvent(new CustomEvent('efpl:renumbered', { detail: { count: renumbered } }));
    if (changed) Store.save('sync-pull');
    state.lastPullAt = Date.now();
    set({ pulled: changed });
    if (changed) window.dispatchEvent(new CustomEvent('efpl:data-changed', { detail: { changed } }));
    return true;
  }

  async function pullConfig(token) {
    // Remote configuration: the subscription switch lives here.
    try {
      const cfg = await FB.get(CFG.configPath, token);
      // Owner's switches (announcement banner, demo mode) — applied whether or
      // not the subscription has ever been touched.
      if (cfg && cfg.remote && typeof cfg.remote === 'object') {
        const before = JSON.stringify(Store.data.config.remote || {});
        const next = Object.assign({}, Store.data.config.remote, Store.clean(cfg.remote));
        if (JSON.stringify(next) !== before) {
          Store.data.config.remote = next;
          Store.save('sync-config');
          window.dispatchEvent(new CustomEvent('efpl:data-changed', { detail: { config: true } }));
        }
      }
      // the owner cleared the records everywhere: this device follows
      if (cfg && cfg.wipe && typeof cfg.wipe.at === 'string') applyWipe(cfg.wipe);
      if (cfg && cfg.subscription && typeof cfg.subscription.status === 'string') {
        const local = Store.data.config.subscription;
        const remoteUpdated = Date.parse(cfg.subscription.updatedAt || 0) || 0;
        const localUpdated = Date.parse(local.updatedAt || 0) || 0;
        if (remoteUpdated >= localUpdated) {
          const was = local.status;
          Store.data.config.subscription = Object.assign({}, cfg.subscription);
          if (cfg.remote) Store.data.config.remote = Object.assign({}, Store.data.config.remote, cfg.remote);
          Store.save('sync-config');
          if (was !== cfg.subscription.status) window.dispatchEvent(new CustomEvent('efpl:subscription-changed'));
        }
      }
    } catch (err) {
      if (isExpiredToken(err)) throw err;
      /* configuration is optional on first run */
    }
  }

  /** Clear this device's copy once for each clear-out the owner made. */
  function applyWipe(wipe) {
    const at = ms(wipe.at);
    const seen = ms(Store.data.meta.wipeSeenAt);
    if (!at || at <= seen) return false;
    const removed = Store.wipeRecords(WIPED, wipe.at);
    window.dispatchEvent(new CustomEvent('efpl:data-changed', { detail: { wipe: true } }));
    window.dispatchEvent(new CustomEvent('efpl:wiped', { detail: { at: wipe.at, by: wipe.by || '', removed } }));
    return true;
  }

  /* ------------------------------ push ------------------------------- */
  function cloudProfile(rec) {
    const profile = { email: rec.email, active: rec.active !== false, updatedAt: rec.updatedAt || new Date().toISOString() };
    if (typeof rec.name === 'string' && rec.name) profile.name = rec.name.slice(0, 120);
    // The rules only accept a real role. A person waiting for approval has
    // none, and the owner is recognised by the verified email, not by a role.
    if (window.Domain.ASSIGNABLE_ROLES.includes(rec.role)) profile.role = rec.role;
    profile.removed = rec.deleted === true;      // taken off the staff list by an administrator
    return profile;
  }

  async function push(manual) {
    const outbox = Store.data.outbox || [];
    if (!outbox.length) { set({ refused: [] }); return 0; }
    const token = await Auth().idToken();
    if (!token) { set({ phase: 'signed-out' }); return 0; }

    const groups = new Map();
    for (const item of outbox) {
      if (!groups.has(item.coll)) groups.set(item.coll, []);
      groups.get(item.coll).push(item);
    }

    let pushed = 0;
    const done = new Set();
    const refused = [];
    let offline = false;
    let lastError = null;

    const send = async (coll, items, upload) => {
      // Uploads the database keeps refusing are left queued, and retried
      // only when someone presses "Sync now" — not every 30 seconds for ever.
      const live = manual ? items : items.filter((it) => (it.tries || 0) < GIVE_UP_AFTER);
      if (!live.length) { refused.push(coll); return; }
      try {
        await upload(live);
        for (const it of live) done.add(it);
        pushed += live.length;
      } catch (err) {
        if (err.code === 'NETWORK') { offline = true; return; }
        if (isExpiredToken(err)) throw err;
        for (const it of live) it.tries = (it.tries || 0) + 1;
        if (isRefusal(err)) refused.push(coll);
        else lastError = err.message;
      }
    };

    for (const [coll, items] of groups) {
      if (offline) break;

      if (coll === 'users') {
        // One request per person, so one refused account cannot hold up the others.
        for (const it of items) {
          if (offline) break;
          const rec = Store.byId('users', it.id);
          if (!rec || !rec.uid || Auth().isOwnerEmail(rec.email)) { done.add(it); continue; }
          await send('users', [it], () => FB.patch(`users/${rec.uid}`, cloudProfile(rec), token));
        }
        continue;
      }

      if (coll === 'settings') {
        if (!Auth().can('settings.write')) { for (const it of items) done.add(it); continue; }
        await send('settings', items, () => FB.patch(CFG.syncPath, { settings: Store.settings() }, token));
        continue;
      }

      if (coll === 'audit') {
        for (let i = 0; i < items.length && !offline; i += CHUNK) {
          const part = items.slice(i, i + CHUNK);
          const payload = {};
          for (const it of part) { const rec = Store.byId('audit', it.id); if (rec) payload[it.id] = rec; else done.add(it); }
          const live = part.filter((it) => payload[it.id]);
          if (live.length) await send('audit', live, (ok) => FB.patch(AUDIT_PATH, Object.fromEntries(ok.map((it) => [it.id, payload[it.id]])), token));
        }
        continue;
      }

      if (!SYNCED.includes(coll)) { for (const it of items) done.add(it); continue; }

      for (let i = 0; i < items.length && !offline; i += CHUNK) {
        const part = items.slice(i, i + CHUNK);
        const payload = {};
        for (const it of part) { const rec = Store.byId(coll, it.id); if (rec) payload[it.id] = rec; else done.add(it); }
        const live = part.filter((it) => payload[it.id]);
        if (live.length) await send(coll, live, (ok) => FB.patch(`${CFG.syncPath}/${coll}`, Object.fromEntries(ok.map((it) => [it.id, payload[it.id]])), token));
      }
    }

    if (done.size) {
      Store.data.outbox = (Store.data.outbox || []).filter((o) => !done.has(o));
      Store.save('sync-push');
    }
    // Tell the other devices something changed, so they fetch it now instead
    // of at their next two-minute check (see "live link" below).
    if (pushed && !offline) {
      try {
        await FB.patch(CFG.syncPath, { pulse: { at: new Date().toISOString(), by: Store.data.meta.deviceId } }, token);
      } catch (err) { if (isExpiredToken(err)) throw err; /* older rules: the others simply find out a little later */ }
    }
    const uniqueRefused = Array.from(new Set(refused));
    const patch = { pushed, refused: uniqueRefused };
    if (offline) patch.phase = 'offline';
    else if (uniqueRefused.length) {
      patch.phase = 'error';
      patch.lastError = `The cloud did not accept changes to: ${uniqueRefused.join(', ')}. They are safe on this device. This usually means your role may not change them, or the database rules need publishing again.`;
    } else if (lastError) { patch.phase = 'error'; patch.lastError = lastError; }
    set(patch);
    return pushed;
  }

  /* ---------------------------- orchestration ------------------------ */
  async function round(reason) {
    const token = await Auth().idToken();
    if (!token) { set({ phase: 'signed-out' }); return; }
    const manual = reason === 'manual';

    // 1. Who am I allowed to be? (roles, disabled accounts)
    const u = await pullUsers(token);
    if (u.offline) { set({ phase: 'offline', lastError: null }); return; }

    // Someone still waiting for a role has nothing else to sync, except their own sign-up.
    if (Auth().isPending()) { await push(manual); if (state.phase === 'syncing') set({ phase: 'idle' }); return; }

    // 2. What changed elsewhere?  (rule 1: pull before push)
    //    The background tick only downloads the whole yard every couple of
    //    minutes — unless this device has something to upload, in which case
    //    it must look first.
    const hasUploads = (Store.data.outbox || []).length > 0;
    //    With the live link open we hear about other devices' changes at
    //    once, so the background download only runs as a safety net.
    const every = state.live ? FULL_PULL_EVERY_MS * 3 : FULL_PULL_EVERY_MS;
    const duePull = manual || reason !== 'interval' || hasUploads || Date.now() - state.lastPullAt >= every;
    if (duePull) {
      const ok = await pullData(token);
      if (!ok) return;
    }
    await pullConfig(token);

    // 3. Now upload what this device has that is newer.
    await push(manual);
  }

  async function syncNow(reason) {
    if (running) { if (reason === 'manual') again = true; return; }
    const me = Auth().current();
    if (!me) { set({ phase: 'signed-out' }); return; }
    if (me.mode === 'preview' || Store.space === 'demo') return;   // the demo never syncs
    if (navigator.onLine === false) { set({ phase: 'offline' }); scheduleRetry(); return; }

    running = true;
    clearTimeout(retryTimer); retryTimer = null; state.retryAt = 0;
    // Only a sync someone asked for (or the first one) shows "Syncing…".
    // Background rounds run every few seconds; the chip keeps showing the
    // settled state instead of flickering.
    state.quiet = reason !== 'manual' && reason !== 'start';
    set({ phase: 'syncing', fatal: false });
    try {
      try {
        await round(reason);
      } catch (err) {
        if (!isExpiredToken(err)) throw err;
        // The sign-in ticket ran out mid-way: get a fresh one and go again, once.
        await Auth()._tokenRefresh();
        await round(reason);
      }
      if (state.phase === 'syncing') set({ lastSyncAt: new Date().toISOString(), lastError: null, phase: 'ok' });
      else if (state.phase !== 'offline' && state.phase !== 'blocked') set({ lastSyncAt: new Date().toISOString() });
    } catch (err) {
      const expired = isExpiredToken(err);
      set({ phase: 'error', fatal: expired, lastError: expired ? 'Your sign-in has expired. Sign out and sign in again to resume syncing.' : (err && err.message) || 'Sync failed' });
    } finally {
      running = false;
      state.quiet = false;
      // Stay online by ourselves: a failed round is tried again soon, a good
      // one re-opens any live link that has dropped.
      if (state.phase === 'ok' || state.phase === 'idle') { retryStep = 0; ensureLinks(); }
      else if (state.phase === 'offline' || (state.phase === 'error' && !state.fatal)) scheduleRetry();
      emit();
      // Screens that show live figures (reports, activity log, staff list) redraw on this.
      window.dispatchEvent(new CustomEvent('efpl:live', { detail: { reason } }));
      if (again) { again = false; setTimeout(() => syncNow('change'), 50); }
    }
  }

  /* ------------------------------ live link --------------------------
     Real time, in both directions:
       - a change made on this device is uploaded a couple of seconds
         later (not at the next 30-second tick);
       - the cloud keeps a tiny "pulse" value that every device watches
         over a streaming connection. When another device uploads, the
         pulse changes and this device fetches the news straight away.
     If the stream cannot be opened (old browser, network that blocks it,
     rules not yet published) nothing breaks: the regular checks carry on. */
  let stream = null;
  let streamRenew = null;
  let streamOpening = false;
  let streamBeat = 0;        // last time anything (data or keep-alive) arrived on the link
  let streamFails = 0;
  let pullSoon = null;
  let pushSoon = null;
  let again = false;

  /* ---------------------------- staying online -----------------------
     The app keeps trying to be online by itself, without anyone pressing
     anything: a failed sync is retried after 3, 6, 12, 20 and then every
     30 seconds; a dropped live link is re-opened the same way; a link that
     has gone silent (a phone network can drop it without saying so) is
     replaced; and coming back to the app, the tab or the network checks
     at once. Nothing here ever shows an error for a passing network blip. */
  const BACKOFF = [3000, 6000, 12000, 20000, 30000];
  const backoff = (n) => BACKOFF[Math.min(n, BACKOFF.length - 1)];
  let STALE_LINK_MS = 100000;     // Firebase sends a keep-alive about every 30 s
  let retryTimer = null;
  let retryStep = 0;

  const mayGoOnline = () => {
    const me = Auth().current();
    return !!me && me.mode !== 'preview' && Store.space !== 'demo';
  };

  function scheduleRetry() {
    if (retryTimer || !mayGoOnline()) return;
    const wait = backoff(retryStep++);
    state.retryAt = Date.now() + wait;
    retryTimer = setTimeout(() => { retryTimer = null; state.retryAt = 0; syncNow('retry'); }, wait);
  }

  /** Open whichever live link is missing (cheap to call often). */
  function ensureLinks() {
    if (!mayGoOnline() || navigator.onLine === false) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!stream && !streamOpening && !streamRenewPending()) openStream();
    if (!userStream && !userStreamOpening && !userStreamRenewPending()) openUserStream();
  }
  const streamRenewPending = () => !!streamRenew && !stream;
  const userStreamRenewPending = () => !!userStreamRenew && !userStream;

  /** Watchdog: replace a link that has gone quiet for too long. */
  function checkLinks() {
    if (stream && streamBeat && Date.now() - streamBeat > STALE_LINK_MS) openStream();
    if (userStream && userStreamBeat && Date.now() - userStreamBeat > STALE_LINK_MS) openUserStream();
    ensureLinks();
  }

  /** Coming back to the app, the tab or the network: check straight away. */
  function wake(reason) {
    if (!mayGoOnline()) return;
    if (navigator.onLine === false) { set({ phase: 'offline' }); return; }
    // skip any waiting: this is the moment the network is most likely back
    retryStep = 0;
    if (!stream) { clearTimeout(streamRenew); streamRenew = null; streamFails = 0; }
    if (!userStream) { clearTimeout(userStreamRenew); userStreamRenew = null; userStreamFails = 0; }
    syncNow(reason);
    checkLinks();
  }

  function setLive(on) {
    if (state.live === on) return;
    state.live = on;
    emit();
  }

  function closeStream() {
    clearTimeout(streamRenew);
    streamRenew = null;
    if (stream) { try { stream.close(); } catch { /* already closed */ } }
    stream = null;
    setLive(false);
  }

  /** Try the link again later, waiting longer each time it fails. */
  function reopenStreamLater(ms) {
    clearTimeout(streamRenew);
    streamRenew = setTimeout(() => { streamRenew = null; openStream(); }, ms !== undefined ? ms : backoff(streamFails++));
  }

  async function openStream() {
    closeStream();
    const me = Auth().current();
    if (typeof window.EventSource !== 'function' || !me || me.mode === 'preview' || Store.space === 'demo' || Auth().isPending()) return;
    if (navigator.onLine === false) return;
    streamOpening = true;
    let token;
    try { token = await Auth().idToken(); } catch { token = null; }
    streamOpening = false;
    if (!token) { reopenStreamLater(); return; }              // no signal for the sign-in ticket yet
    if (stream) return;                                         // another call got there first
    let es;
    try { es = new window.EventSource(FB.url(`${CFG.syncPath}/pulse`, token)); } catch { reopenStreamLater(); return; }
    stream = es;
    streamBeat = Date.now();
    let first = true;
    const beat = () => { if (stream === es) streamBeat = Date.now(); };
    const onPulse = (e) => {
      if (stream !== es) return;
      beat();
      streamFails = 0;
      setLive(true);
      if (first) { first = false; return; }                     // the value as it was when we connected
      let by = null;
      try { const d = JSON.parse(e.data); by = d && d.data && d.data.by; } catch { /* ignore */ }
      if (by && by === Store.data.meta.deviceId) return;     // our own upload
      clearTimeout(pullSoon);
      pullSoon = setTimeout(() => syncNow('stream'), 700);
    };
    es.addEventListener('put', onPulse);
    es.addEventListener('patch', onPulse);
    es.addEventListener('keep-alive', beat);
    es.onopen = beat;
    // not allowed to watch (rules not published yet, or no role): look again in a few minutes
    es.addEventListener('cancel', () => { if (stream === es) { closeStream(); reopenStreamLater(5 * 60 * 1000); } });
    es.addEventListener('auth_revoked', () => { if (stream === es) openStream(); });     // sign-in ticket ran out
    es.onerror = () => {
      if (stream !== es) return;
      setLive(false);                                           // the browser reconnects by itself (readyState 0)…
      if (es.readyState === 2) { closeStream(); reopenStreamLater(); }   // …unless it gave up: then we do
    };
    // the ticket in the address lasts an hour — reconnect with a fresh one before that
    streamRenew = setTimeout(() => { streamRenew = null; openStream(); }, 50 * 60 * 1000);
  }

  /* The staff list has its own live link, because the people it matters most
     to cannot use the one above: someone who has just signed in has no role
     yet, so they cannot touch the "pulse" — and it is exactly their arrival an
     administrator wants to see at once.
       - an administrator (or the owner) watches the whole staff list;
       - everyone else watches only their own entry, so a role given to them
         (or their account being switched off) arrives immediately. */
  let userStream = null;
  let userStreamRenew = null;
  let userStreamOpening = false;
  let userStreamBeat = 0;
  let userStreamFails = 0;
  let usersSoon = null;

  function closeUserStream() {
    clearTimeout(userStreamRenew);
    userStreamRenew = null;
    if (userStream) { try { userStream.close(); } catch { /* already closed */ } }
    userStream = null;
  }

  function reopenUserStreamLater(ms) {
    clearTimeout(userStreamRenew);
    userStreamRenew = setTimeout(() => { userStreamRenew = null; openUserStream(); }, ms !== undefined ? ms : backoff(userStreamFails++));
  }

  async function openUserStream() {
    closeUserStream();
    const me = Auth().current();
    if (typeof window.EventSource !== 'function' || !me || me.mode === 'preview' || Store.space === 'demo') return;
    if (navigator.onLine === false) return;
    const all = Auth().isSuper(me) || Auth().can('user.manage');
    if (!all && !me.uid) return;
    userStreamOpening = true;
    let token;
    try { token = await Auth().idToken(); } catch { token = null; }
    userStreamOpening = false;
    if (!token) { reopenUserStreamLater(); return; }
    if (userStream) return;
    let es;
    try { es = new window.EventSource(FB.url(all ? 'users' : `users/${me.uid}`, token)); } catch { reopenUserStreamLater(); return; }
    userStream = es;
    userStreamBeat = Date.now();
    let first = true;
    const beat = () => { if (userStream === es) userStreamBeat = Date.now(); };
    const onChange = () => {
      if (userStream !== es) return;
      beat();
      userStreamFails = 0;
      if (first) { first = false; return; }                   // the list as it was when we connected
      clearTimeout(usersSoon);
      usersSoon = setTimeout(() => { if (running) again = true; else syncNow('stream'); }, 400);
    };
    es.addEventListener('put', onChange);
    es.addEventListener('patch', onChange);
    es.addEventListener('keep-alive', beat);
    es.onopen = beat;
    es.addEventListener('cancel', () => { if (userStream === es) { closeUserStream(); reopenUserStreamLater(5 * 60 * 1000); } });
    es.addEventListener('auth_revoked', () => { if (userStream === es) openUserStream(); });
    es.onerror = () => {
      if (userStream !== es) return;
      if (es.readyState === 2) { closeUserStream(); reopenUserStreamLater(); }
    };
    userStreamRenew = setTimeout(() => { userStreamRenew = null; openUserStream(); }, 50 * 60 * 1000);
  }

  /** A local change was saved: upload it shortly, batching quick edits together. */
  function onLocalChange(reason) {
    if (/^(sync|renumber|seed|types-migrate|login|bootstrap)/.test(String(reason || ''))) return;
    if (!(Store.data.outbox || []).length) return;
    clearTimeout(pushSoon);
    pushSoon = setTimeout(() => { if (running) again = true; else syncNow('change'); }, 2000);
  }

  const Sync = {
    state,
    onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); },
    start() {
      clearInterval(timer);
      timer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        syncNow('interval');
        checkLinks();
      }, CFG.syncIntervalMs || 30000);
      if (!started) {
        // attach the window listeners once, however often people sign in and out
        started = true;
        window.addEventListener('online', () => wake('online'));
        window.addEventListener('offline', () => { closeStream(); closeUserStream(); set({ phase: 'offline' }); });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake('visible'); });
        // a phone bringing the app back from the background, or a click back into the window
        window.addEventListener('pageshow', (e) => { if (e.persisted) wake('visible'); });
        window.addEventListener('focus', () => { if (!state.live || state.phase !== 'ok') wake('visible'); });
        Store.onChange(onLocalChange);
        // a new role changes what this person may watch
        window.addEventListener('efpl:role-changed', () => { openStream(); openUserStream(); });
      }
      retryStep = 0; streamFails = 0; userStreamFails = 0;
      if (navigator.onLine !== false) { syncNow('start'); openStream(); openUserStream(); }
      else { set({ phase: 'offline' }); scheduleRetry(); }
    },
    stop() {
      clearInterval(timer); clearTimeout(pullSoon); clearTimeout(pushSoon); clearTimeout(usersSoon);
      clearTimeout(retryTimer); retryTimer = null; state.retryAt = 0;
      closeStream(); closeUserStream();
    },
    now: syncNow,

    /**
     * The shared activity log is read on demand (Administration → Audit
     * trail), newest entries only, so it never slows the normal sync down.
     */
    async pullAudit(limit = 400) {
      const me = Auth().current();
      if (!me || me.mode === 'preview' || Store.space === 'demo' || navigator.onLine === false) return { ok: false };
      try {
        const token = await Auth().idToken();
        if (!token) return { ok: false };
        const remote = await FB.get(AUDIT_PATH, token, { orderBy: '"$key"', limitToLast: String(limit) });
        if (!remote || typeof remote !== 'object') return { ok: true, added: 0 };
        const have = new Set(Store.data.audit.map((a) => a.id));
        let added = 0;
        for (const id of Object.keys(remote)) {
          const r = Store.clean(remote[id]);
          if (!r || typeof r !== 'object' || r.id !== id || have.has(id)) continue;
          Store.data.audit.push(r);
          added++;
        }
        if (added) {
          Store.data.audit.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
          Store.save('sync-audit');
        }
        return { ok: true, added };
      } catch (err) {
        return { ok: false, refused: isRefusal(err), error: err.message };
      }
    },

    /** Super admin only: publish the announcement banner and the demo switch. */
    async pushRemote(patch) {
      if (!Auth().isSuper(Auth().current())) throw new Error('Only the owner can change this');
      Store.data.config.remote = Object.assign({}, Store.data.config.remote, patch);
      Store.save('remote-config');
      const token = await Auth().idToken();
      if (!token || navigator.onLine === false) throw new Error('Saved on this device. Connect to the internet so it reaches the other devices.');
      await FB.patch(`${CFG.configPath}/remote`, Store.data.config.remote, token);
      return Store.data.config.remote;
    },

    /**
     * Owner only: delete the records in the cloud and on every device.
     *   1. delete them in the cloud (one request: all or nothing);
     *   2. leave the "cleared at" mark, which tells every other device to
     *      clear its copy and never take back anything made before it;
     *   3. delete once more, in case a device uploaded in between;
     *   4. clear this device and wake the others.
     * Errors say exactly how far it got.
     */
    async wipeEverywhere() {
      const me = Auth().current();
      if (!Auth().isSuper(me)) throw new Error('Only the owner can delete the records');
      if (me.mode === 'preview' || Store.space === 'demo') throw new Error('Not in the demo');
      if (navigator.onLine === false) throw new Error('No connection. Connect to the internet, then try again: the records have to be deleted in the cloud.');
      const token = await Auth().idToken();
      if (!token) throw new Error('Sign in again, then try again.');
      const at = new Date().toISOString();
      const wipe = { at, by: me.email || '' };
      const nothing = Object.fromEntries(WIPED.map((c) => [c, null]));
      try { await FB.patch(CFG.syncPath, nothing, token); } catch (err) {
        throw new Error(`Nothing was deleted. ${err.code === 'NETWORK' ? 'The connection dropped.' : err.message} Try again.`);
      }
      try { await FB.patch(CFG.configPath, { wipe }, token); } catch (err) {
        throw new Error('The records were deleted in the cloud, but the other devices could not be told yet, so they still show their copy. Press the button again to finish.');
      }
      try { await FB.patch(CFG.syncPath, nothing, token); } catch { /* the mark already stops old records coming back */ }
      const removed = Store.wipeRecords(WIPED, at);
      try { await FB.patch(CFG.syncPath, { pulse: { at, by: Store.data.meta.deviceId } }, token); } catch { /* the others find out at their next check */ }
      window.dispatchEvent(new CustomEvent('efpl:data-changed', { detail: { wipe: true } }));
      return { at, removed };
    },

    /**
     * Anyone who manages data: throw away this device's copy and download it
     * again from the cloud. Nothing is deleted anywhere. Refused while this
     * device still has changes the cloud has not received.
     */
    async redownload() {
      const pending = (Store.data.outbox || []).length;
      if (pending) throw new Error(`${pending} change${pending === 1 ? ' has' : 's have'} not reached the cloud yet. Sync first (connect to the internet), then try again.`);
      Store.resetAll({ keepUsers: true });
      state.lastPullAt = 0;
      await syncNow('manual');
      return state.phase;
    },

    /** Super admin only: publish the subscription switch to every device. */
    async pushSubscription(sub) {
      if (!Auth().isSuper(Auth().current())) throw new Error('Only the owner can change the subscription');
      Store.data.config.subscription = Object.assign({}, sub, {
        updatedAt: new Date().toISOString(),
        updatedBy: (Auth().current() || {}).email || null,
      });
      Store.save('subscription');
      window.dispatchEvent(new CustomEvent('efpl:subscription-changed'));
      const token = await Auth().idToken();
      if (!token) throw new Error('Connect to the internet once so the change reaches all devices, then try again.');
      await FB.patch(CFG.configPath, { subscription: Store.data.config.subscription }, token);
      return Store.data.config.subscription;
    },

    /**
     * What the status chip shows: a calm, short word and a tone.
     *   live        connected in real time
     *   ok          saved to the cloud (live link not open, regular checks on)
     *   connecting  getting (back) online by itself, nothing for anyone to do
     *   offline     no network: everything is kept on this device
     *   problem     needs a person (rules, role, sign-in expired)
     * A background round never changes it, so it does not flicker.
     */
    view() {
      const phase = state.phase === 'syncing' && state.quiet ? state.settled : state.phase;
      const pending = (Store.data.outbox || []).length;
      switch (phase) {
        case 'syncing': return { tone: 'connecting', text: 'Syncing…', detail: 'Bringing this device up to date' };
        case 'ok':
          if (pending) return { tone: state.live ? 'live' : 'ok', text: `${pending} to upload`, detail: 'Uploading in a moment' };
          return state.live
            ? { tone: 'live', text: 'Live', detail: 'Connected in real time. Changes from other devices appear at once.' }
            : { tone: 'ok', text: 'Saved to cloud', detail: 'Everything is saved. Connecting the live link…' };
        case 'offline': return {
          tone: 'offline', text: pending ? `Offline · ${pending} saved here` : 'Offline',
          detail: 'No connection. Work is saved on this device and uploads by itself when the signal returns.',
        };
        case 'blocked': return { tone: 'problem', text: 'Cloud access blocked', detail: state.lastError || '' };
        case 'error':
          if (state.fatal || state.refused.length) return { tone: 'problem', text: state.fatal ? 'Sign in again' : 'Some changes not accepted', detail: state.lastError || '' };
          return { tone: 'connecting', text: 'Reconnecting…', detail: 'The connection dropped. Trying again by itself.' };
        case 'signed-out': return { tone: 'offline', text: 'Signed out', detail: '' };
        default: return { tone: 'connecting', text: 'Connecting…', detail: 'Getting online' };
      }
    },
    label() { return this.view().text; },

    // exposed for the automated tests
    _mergeCollection: mergeCollection, _mergeSettings: mergeSettings, _cloudProfile: cloudProfile,
    _links: {
      check: checkLinks,
      wake,
      staleAfter(ms) { STALE_LINK_MS = ms; },
      backoff(steps) { BACKOFF.splice(0, BACKOFF.length, ...steps); },
      open: () => ({ stream: !!stream, userStream: !!userStream, retrying: !!retryTimer }),
    },
  };

  window.Sync = Sync;
})();
