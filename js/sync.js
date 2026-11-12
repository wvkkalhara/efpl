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
    listeners: new Set(),
  };

  const emit = () => { for (const fn of state.listeners) { try { fn(state); } catch (e) { console.error(e); } } };
  const set = (patch) => { Object.assign(state, patch); emit(); };

  let timer = null;
  let running = false;
  let started = false;

  const stamp = (r) => Date.parse((r && r.updatedAt) || 0) || 0;
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
    for (const id of Object.keys(remote)) {
      if (!remote[id] || typeof remote[id] !== 'object' || Array.isArray(remote[id])) continue;
      const r = Store.normalize(coll, Store.clean(remote[id]));
      if (r.id !== id) continue;            // a record must live under its own id
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

  /* ------------------------------ push ------------------------------- */
  function cloudProfile(rec) {
    const profile = { email: rec.email, active: rec.active !== false, updatedAt: rec.updatedAt || new Date().toISOString() };
    if (typeof rec.name === 'string' && rec.name) profile.name = rec.name.slice(0, 120);
    // The rules only accept a real role. A person waiting for approval has
    // none, and the owner is recognised by the verified email, not by a role.
    if (window.Domain.ASSIGNABLE_ROLES.includes(rec.role)) profile.role = rec.role;
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
    if (running) return;
    const me = Auth().current();
    if (!me) { set({ phase: 'signed-out' }); return; }
    if (me.mode === 'preview' || Store.space === 'demo') return;   // the demo never syncs
    if (navigator.onLine === false) { set({ phase: 'offline' }); return; }

    running = true;
    set({ phase: 'syncing' });
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
      set({ phase: 'error', lastError: expired ? 'Your sign-in has expired. Sign out and sign in again to resume syncing.' : (err && err.message) || 'Sync failed' });
    } finally {
      running = false;
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
  let pullSoon = null;
  let pushSoon = null;
  let again = false;

  function closeStream() {
    clearTimeout(streamRenew);
    if (stream) { try { stream.close(); } catch { /* already closed */ } }
    stream = null;
    state.live = false;
  }

  async function openStream() {
    closeStream();
    const me = Auth().current();
    if (typeof window.EventSource !== 'function' || !me || me.mode === 'preview' || Store.space === 'demo' || Auth().isPending()) return;
    if (navigator.onLine === false) return;
    let token;
    try { token = await Auth().idToken(); } catch { return; }
    if (!token) return;
    let es;
    try { es = new window.EventSource(FB.url(`${CFG.syncPath}/pulse`, token)); } catch { return; }
    stream = es;
    let first = true;
    const onPulse = (e) => {
      if (stream !== es) return;
      state.live = true;
      if (first) { first = false; emit(); return; }           // the value as it was when we connected
      let by = null;
      try { const d = JSON.parse(e.data); by = d && d.data && d.data.by; } catch { /* ignore */ }
      if (by && by === Store.data.meta.deviceId) return;     // our own upload
      clearTimeout(pullSoon);
      pullSoon = setTimeout(() => syncNow('stream'), 700);
    };
    es.addEventListener('put', onPulse);
    es.addEventListener('patch', onPulse);
    es.addEventListener('cancel', () => { if (stream === es) closeStream(); });          // not allowed to watch
    es.addEventListener('auth_revoked', () => { if (stream === es) openStream(); });     // sign-in ticket ran out
    es.onerror = () => {
      if (stream !== es) return;
      state.live = false;
      if (es.readyState === 2) { closeStream(); streamRenew = setTimeout(openStream, 60000); }   // gave up: try again in a minute
    };
    // the ticket in the address lasts an hour — reconnect with a fresh one before that
    streamRenew = setTimeout(openStream, 50 * 60 * 1000);
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
  let usersSoon = null;

  function closeUserStream() {
    clearTimeout(userStreamRenew);
    if (userStream) { try { userStream.close(); } catch { /* already closed */ } }
    userStream = null;
  }

  async function openUserStream() {
    closeUserStream();
    const me = Auth().current();
    if (typeof window.EventSource !== 'function' || !me || me.mode === 'preview' || Store.space === 'demo') return;
    if (navigator.onLine === false) return;
    const all = Auth().isSuper(me) || Auth().can('user.manage');
    if (!all && !me.uid) return;
    let token;
    try { token = await Auth().idToken(); } catch { return; }
    if (!token) return;
    let es;
    try { es = new window.EventSource(FB.url(all ? 'users' : `users/${me.uid}`, token)); } catch { return; }
    userStream = es;
    let first = true;
    const onChange = () => {
      if (userStream !== es) return;
      if (first) { first = false; return; }                   // the list as it was when we connected
      clearTimeout(usersSoon);
      usersSoon = setTimeout(() => { if (running) again = true; else syncNow('stream'); }, 400);
    };
    es.addEventListener('put', onChange);
    es.addEventListener('patch', onChange);
    es.addEventListener('cancel', () => { if (userStream === es) closeUserStream(); });
    es.addEventListener('auth_revoked', () => { if (userStream === es) openUserStream(); });
    es.onerror = () => {
      if (userStream !== es) return;
      if (es.readyState === 2) { closeUserStream(); userStreamRenew = setTimeout(openUserStream, 60000); }
    };
    userStreamRenew = setTimeout(openUserStream, 50 * 60 * 1000);
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
      timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow('interval'); }, CFG.syncIntervalMs || 30000);
      if (!started) {
        // attach the window listeners once, however often people sign in and out
        started = true;
        window.addEventListener('online', () => { syncNow('online'); openStream(); openUserStream(); });
        window.addEventListener('offline', () => { closeStream(); closeUserStream(); set({ phase: 'offline' }); });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && navigator.onLine) {
            syncNow('visible');
            if (!stream) openStream();
            if (!userStream) openUserStream();
          }
        });
        Store.onChange(onLocalChange);
        // a new role changes what this person may watch
        window.addEventListener('efpl:role-changed', () => { openStream(); openUserStream(); });
      }
      if (navigator.onLine) { syncNow('start'); openStream(); openUserStream(); }
      else set({ phase: 'offline' });
    },
    stop() { clearInterval(timer); clearTimeout(pullSoon); clearTimeout(pushSoon); clearTimeout(usersSoon); closeStream(); closeUserStream(); },
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

    label() {
      switch (state.phase) {
        case 'syncing': return 'Syncing…';
        case 'ok': return state.live ? 'Live — saved to cloud' : 'All changes saved to cloud';
        case 'offline': return 'Offline — saving on this device';
        case 'blocked': return 'Cloud access blocked';
        case 'error': return state.refused.length ? 'Some changes not accepted' : 'Sync error — retrying';
        case 'signed-out': return 'Signed out';
        default: return 'Ready';
      }
    },

    // exposed for the automated tests
    _mergeCollection: mergeCollection, _mergeSettings: mergeSettings, _cloudProfile: cloudProfile,
  };

  window.Sync = Sync;
})();
