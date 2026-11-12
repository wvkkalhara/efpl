/* =====================================================================
   sync.js — offline-first cloud sync.
   ---------------------------------------------------------------------
   The local store is the source of truth while the site is working. This
   engine quietly pushes the queue and pulls other devices' changes when
   a connection appears. Nothing is ever blocked waiting for the network.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG;
  const Store = window.Store;
  const FB = window.FB;

  const SYNCED = [
    'suppliers', 'farmers', 'bags', 'bagIssues', 'deliveries', 'bays',
    'usageRequests', 'qualityIssues', 'payments', 'bagReturns', 'users',
  ];

  const state = {
    phase: 'idle',        // idle | syncing | ok | error | blocked | offline | signed-out
    lastSyncAt: null,
    lastError: null,
    pushed: 0,
    pulled: 0,
    listeners: new Set(),
  };

  const emit = () => { for (const fn of state.listeners) { try { fn(state); } catch (e) { console.error(e); } } };
  const set = (patch) => { Object.assign(state, patch); emit(); };

  let timer = null;
  let running = false;

  function newer(a, b) {
    const A = Date.parse((a && a.updatedAt) || 0) || 0;
    const B = Date.parse((b && b.updatedAt) || 0) || 0;
    return A > B;
  }

  /* --------------------------- pull / merge -------------------------- */
  function mergeCollection(coll, remote) {
    if (!remote || typeof remote !== 'object') return 0;
    let changed = 0;
    const local = Store.data[coll];
    for (const id of Object.keys(remote)) {
      if (!remote[id] || typeof remote[id] !== 'object' || Array.isArray(remote[id])) continue;
      const r = Store.clean(remote[id]);
      if (r.id !== id) continue;            // a record must live under its own id
      const mine = local.find((x) => x.id === id);
      if (!mine) {
        local.push(r);
        changed++;
      } else if (newer(r, mine)) {
        Object.assign(mine, r);          // cloud is newer -> take it
        changed++;
      } else if (newer(mine, r) && !mine.deleted) {
        Store.markDirty(coll, id);       // we are newer -> keep ours, push later
      }
    }
    return changed;
  }

  async function pull() {
    const token = await window.Auth.idToken();
    if (!token) { set({ phase: 'signed-out' }); return; }

    let remote;
    try {
      remote = await FB.get(CFG.syncPath, token);
    } catch (err) {
      if (err.code === 'NETWORK') { set({ phase: 'offline', lastError: null }); return; }
      if (err.status === 401 || err.code === 'PERMISSION_DENIED' || err.code === 'UNAUTHORIZED') {
        set({
          phase: 'blocked',
          lastError: 'The database is refusing access. Publish firebase.rules.json in the Firebase console so that signed-in staff can read and write.',
        });
        return;
      }
      set({ phase: 'error', lastError: err.message });
      return;
    }

    let changed = 0;
    if (remote && typeof remote === 'object') {
      for (const coll of SYNCED) {
        if (remote[coll]) changed += mergeCollection(coll, remote[coll]);
      }
    }
    if (changed) Store.save('sync-pull');
    set({ pulled: changed });

    // Remote configuration: the subscription switch lives here.
    try {
      const cfg = await FB.get(CFG.configPath, token);
      if (cfg && cfg.subscription && typeof cfg.subscription.status === 'string') {
        const local = Store.data.config.subscription;
        const remoteUpdated = Date.parse(cfg.subscription.updatedAt || 0) || 0;
        const localUpdated = Date.parse(local.updatedAt || 0) || 0;
        if (remoteUpdated >= localUpdated) {
          Store.data.config.subscription = Object.assign({}, cfg.subscription);
          if (cfg.remote) Store.data.config.remote = Object.assign({}, Store.data.config.remote, cfg.remote);
          Store.save('sync-config');
          window.dispatchEvent(new CustomEvent('efpl:subscription-changed'));
        }
      }
    } catch { /* configuration is optional on first run */ }
  }

  /* ------------------------------ push ------------------------------- */
  async function push() {
    const outbox = Store.data.outbox || [];
    if (!outbox.length) return 0;
    const token = await window.Auth.idToken();
    if (!token) { set({ phase: 'signed-out' }); return 0; }

    // Group by collection -> one PATCH per collection keeps the request count low.
    const groups = new Map();
    for (const item of outbox) {
      if (!groups.has(item.coll)) groups.set(item.coll, []);
      groups.get(item.coll).push(item);
    }

    let pushed = 0;
    const done = [];
    for (const [coll, items] of groups) {
      if (coll === 'settings') continue;
      let collPath = coll;
      if (coll === 'users') collPath = 'users';
      const payload = {};
      for (const it of items) {
        const rec = coll === 'settings' ? Store.settings() : Store.byId(coll, it.id);
        if (!rec) { done.push(it); continue; }
        payload[it.id] = rec;
      }
      if (!Object.keys(payload).length) continue;
      try {
        if (coll === 'users') {
          // users are keyed by uid in the cloud so the rules can match auth.uid
          const byUid = {};
          for (const [id, rec] of Object.entries(payload)) {
            if (!rec.uid) continue;
            const profile = { email: rec.email, name: rec.name, active: rec.active !== false, updatedAt: rec.updatedAt };
            // The rules only accept a real role, and only the owner/an admin may
            // write it. A person waiting for approval simply has no role yet.
            if (rec.role && rec.role !== 'pending') profile.role = rec.role;
            byUid[rec.uid] = profile;
          }
          if (Object.keys(byUid).length) await FB.patch('users', byUid, token);
        } else {
          await FB.patch(`${CFG.syncPath}/${collPath}`, payload, token);
        }
        pushed += Object.keys(payload).length;
        for (const it of items) done.push(it);
      } catch (err) {
        if (err.code === 'NETWORK') { set({ phase: 'offline' }); break; }
        if (err.status === 401) {
          set({ phase: 'blocked', lastError: 'Write refused by the database rules (401). Publish firebase.rules.json.' });
          break;
        }
        for (const it of items) it.tries = (it.tries || 0) + 1;
        set({ phase: 'error', lastError: err.message });
      }
    }

    if (done.length) {
      const remaining = (Store.data.outbox || []).filter((o) => !done.includes(o));
      Store.data.outbox = remaining;
      Store.save('sync-push');
    }
    set({ pushed });
    return pushed;
  }

  /* ---------------------------- orchestration ------------------------ */
  async function syncNow(reason) {
    if (running) return;
    if (!window.Auth.current()) { set({ phase: 'signed-out' }); return; }
    if (window.Auth.current().mode === 'preview' || Store.space === 'demo') return;   // the demo never syncs
    if (navigator.onLine === false) { set({ phase: 'offline' }); return; }

    running = true;
    set({ phase: 'syncing' });
    try {
      await push();
      await pull();
      set({ lastSyncAt: new Date().toISOString(), lastError: null, phase: state.phase === 'syncing' ? 'ok' : state.phase });
    } catch (err) {
      set({ phase: 'error', lastError: err.message });
    } finally {
      running = false;
      emit();
    }
  }

  const Sync = {
    state,
    onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); },
    start() {
      clearInterval(timer);
      timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow('interval'); }, CFG.syncIntervalMs || 30000);
      window.addEventListener('online', () => syncNow('online'));
      window.addEventListener('offline', () => set({ phase: 'offline' }));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) syncNow('visible');
      });
      if (navigator.onLine) syncNow('start');
      else set({ phase: 'offline' });
    },
    stop() { clearInterval(timer); },
    now: syncNow,

    /** Super admin only: publish the subscription switch to every device. */
    async pushSubscription(sub) {
      if (!window.Auth.isSuper(window.Auth.current())) throw new Error('Only the owner can change the subscription');
      Store.data.config.subscription = Object.assign({}, sub, {
        updatedAt: new Date().toISOString(),
        updatedBy: (window.Auth.current() || {}).email || null,
      });
      Store.save('subscription');
      window.dispatchEvent(new CustomEvent('efpl:subscription-changed'));
      const token = await window.Auth.idToken();
      if (!token) throw new Error('Connect to the internet once so the change reaches all devices, then try again.');
      await FB.patch(CFG.configPath, { subscription: Store.data.config.subscription }, token);
      return Store.data.config.subscription;
    },

    label() {
      switch (state.phase) {
        case 'syncing': return 'Syncing…';
        case 'ok': return 'All changes saved to cloud';
        case 'offline': return 'Offline — saving on this device';
        case 'blocked': return 'Cloud access blocked (rules)';
        case 'error': return 'Sync error — retrying';
        case 'signed-out': return 'Signed out';
        default: return 'Ready';
      }
    },
  };

  window.Sync = Sync;
})();
