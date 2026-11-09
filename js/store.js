/* =====================================================================
   store.js — the offline-first database.
   ---------------------------------------------------------------------
   Everything the site does is written here first, on this device, then
   pushed to Firebase when a connection is available. The app therefore
   keeps working through a power cut, a dead router or a dropped signal,
   and nothing a storekeeper types is ever lost because "the internet was
   down".
   ===================================================================== */
(function () {
  'use strict';

  const CFG = window.EFPL_CONFIG;

  /* localStorage can be unavailable (private mode, sandboxed preview
     frame, locked-down browser policy). Fall back to memory so the UI
     still runs, and tell the user their work is not persisted. */
  const memBacking = Object.create(null);
  let persistence = 'none';
  try {
    const probe = '__efpl_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    persistence = 'localStorage';
  } catch (_) {
    persistence = 'memory';
  }

  const raw = {
    get(k) {
      if (persistence === 'localStorage') return window.localStorage.getItem(k);
      return memBacking[k] ?? null;
    },
    set(k, v) {
      if (persistence === 'localStorage') { window.localStorage.setItem(k, v); return; }
      memBacking[k] = v;
    },
    del(k) {
      if (persistence === 'localStorage') { window.localStorage.removeItem(k); return; }
      delete memBacking[k];
    },
  };

  const COLLECTIONS = [
    'users', 'suppliers', 'farmers', 'bags', 'bagIssues', 'deliveries', 'bays',
    'usageRequests', 'qualityIssues', 'payments', 'bagReturns', 'audit', 'outbox',
  ];

  const nowISO = () => new Date().toISOString();
  const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

  function blankDoc() {
    const d = {
      meta: {
        schema: 1,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        deviceId: uid('dev'),
        seeded: false,
        seq: 1,
      },
      settings: Object.assign({}, CFG.defaults, {
        siteName: 'EnerFab Biomass Storage',
        siteLocation: 'Nawagaththegama',
        headOfficeEmail: 'accounts@efpl.org',
        biomassTypes: CFG.biomassTypes,
        updatedAt: null,
      }),
      config: {
        subscription: {
          status: 'ACTIVE',        // ACTIVE | SUSPENDED — only set by the super admin
          message: '',
          note: '',
          updatedAt: null,
          updatedBy: null,
        },
        remote: { syncEnabled: true, announcement: '' },
      },
      counters: {},
    };
    for (const c of COLLECTIONS) d[c] = [];
    return d;
  }

  function deepMerge(base, patch) {
    if (Array.isArray(base) || Array.isArray(patch)) return patch;
    if (typeof base !== 'object' || base === null) return patch;
    if (typeof patch !== 'object' || patch === null) return patch;
    const out = Object.assign({}, base);
    for (const k of Object.keys(patch)) out[k] = deepMerge(base[k], patch[k]);
    return out;
  }

  const Store = {
    data: blankDoc(),
    persistence,
    listeners: new Set(),
    _saveTimer: null,
    _suspended: false,

    /* ------------------------------------------------------------------ */
    init() {
      const rawDoc = raw.get(CFG.storageKey);
      if (rawDoc) {
        try {
          const parsed = JSON.parse(rawDoc);
          this.data = deepMerge(blankDoc(), parsed);
        } catch (e) {
          console.error('Corrupt local database — starting a fresh one.', e);
          // Never silently destroy: keep a copy for recovery.
          raw.set(`${CFG.storageKey}.corrupt.${Date.now()}`, rawDoc);
          this.data = blankDoc();
        }
      } else {
        this.data = blankDoc();
      }
      for (const c of COLLECTIONS) if (!Array.isArray(this.data[c])) this.data[c] = [];
      this.data.settings = Object.assign(blankDoc().settings, this.data.settings || {});
      this.data.config = deepMerge(blankDoc().config, this.data.config || {});
      return this.data;
    },

    /* ------------------------------------------------------------------ */
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    notify(reason) { for (const fn of this.listeners) { try { fn(reason); } catch (e) { console.error(e); } } },

    save(reason = 'change') {
      this.data.meta.updatedAt = nowISO();
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        if (persistence === 'localStorage') {
          try {
            raw.set(CFG.storageKey, JSON.stringify(this.data));
          } catch (e) {
            if (String(e && e.name) === 'QuotaExceededError') {
              this.notify('quota');
              window.dispatchEvent(new CustomEvent('efpl:storage-full'));
            } else {
              console.error('Save failed', e);
            }
          }
        }
        this.notify(reason);
      }, 180);
      return this.data;
    },

    /** Synchronous flush — used before printing or on page hide. */
    flush() {
      clearTimeout(this._saveTimer);
      if (persistence === 'localStorage') raw.set(CFG.storageKey, JSON.stringify(this.data));
      return this.data;
    },

    /* -------------------------- collections --------------------------- */
    all(coll) { return this.data[coll] || []; },
    byId(coll, id) { return this.all(coll).find((r) => r.id === id) || null; },
    where(coll, pred) { return this.all(coll).filter(pred); },

    nextSeq(name, start = 1) {
      const cur = this.data.counters[name] ?? start;
      this.data.counters[name] = cur + 1;
      return cur;
    },
    nextCode(name, prefix, pad = 4) {
      return `${prefix}-${String(this.nextSeq(name, 1)).padStart(pad, '0')}`;
    },

    /** Mark a record for the cloud sync queue. */
    markDirty(coll, id) {
      if (!this.data.outbox) this.data.outbox = [];
      const existing = this.data.outbox.find((o) => o.coll === coll && o.id === id);
      if (existing) { existing.at = nowISO(); return; }
      this.data.outbox.push({ id: uid('ob'), coll, id, at: nowISO(), tries: 0 });
      if (this.data.outbox.length > 4000) this.data.outbox.splice(0, 1000);
    },

    add(coll, record, reason = 'add') {
      const rec = Object.assign({ id: uid(coll.slice(0, 3)), createdAt: nowISO(), updatedAt: nowISO() }, record);
      this.data[coll].push(rec);
      this.markDirty(coll, rec.id);
      this.save(reason);
      return rec;
    },

    update(coll, id, patch, reason = 'update') {
      const rec = this.byId(coll, id);
      if (!rec) return null;
      Object.assign(rec, patch, { updatedAt: nowISO() });
      this.markDirty(coll, id);
      this.save(reason);
      return rec;
    },

    /** Soft delete — biomass records are never really destroyed. */
    remove(coll, id, reason = 'remove') {
      const rec = this.byId(coll, id);
      if (!rec) return null;
      rec.deleted = true;
      rec.deletedAt = nowISO();
      rec.updatedAt = nowISO();
      this.markDirty(coll, id);
      this.save(reason);
      return rec;
    },

    /** Bulk insert with one save at the end (5 000 bags = one write). */
    bulkAdd(coll, records, reason = 'bulk-add') {
      const out = [];
      for (const r of records) {
        const rec = Object.assign({ id: uid(coll.slice(0, 3)), createdAt: nowISO(), updatedAt: nowISO() }, r);
        this.data[coll].push(rec);
        if (this.data.outbox) this.data.outbox.push({ id: uid('ob'), coll, id: rec.id, at: nowISO(), tries: 0 });
        out.push(rec);
      }
      if (this.data.outbox && this.data.outbox.length > 4000) {
        this.data.outbox.splice(0, this.data.outbox.length - 4000);
      }
      this.save(reason);
      return out;
    },

    settings() { return this.data.settings; },
    patchSettings(patch) {
      Object.assign(this.data.settings, patch, { updatedAt: nowISO() });
      this.markDirty('settings', 'singleton');
      this.save('settings');
      return this.data.settings;
    },

    subscription() { return (this.data.config && this.data.config.subscription) || { status: 'ACTIVE' }; },

    /* ------------------------- import / export ------------------------ */
    exportJSON() { return JSON.parse(JSON.stringify(this.data)); },

    importJSON(obj, { merge = false } = {}) {
      if (!obj || typeof obj !== 'object') throw new Error('Not a valid backup file');
      if (merge) {
        for (const c of COLLECTIONS) {
          if (!Array.isArray(obj[c])) continue;
          for (const rec of obj[c]) {
            const mine = this.byId(c, rec.id);
            if (!mine) this.data[c].push(rec);
            else if (String(rec.updatedAt || '') > String(mine.updatedAt || '')) Object.assign(mine, rec);
          }
        }
      } else {
        this.data = deepMerge(blankDoc(), obj);
      }
      this.flush();
      this.notify('import');
      return this.data;
    },

    resetAll({ keepUsers = true } = {}) {
      const users = keepUsers ? this.data.users : [];
      this.data = blankDoc();
      this.data.users = users;
      this.flush();
      this.notify('reset');
      return this.data;
    },

    stats() {
      return {
        persistence: this.persistence,
        bytes: persistence === 'localStorage' ? (raw.get(CFG.storageKey) || '').length : 0,
        bags: this.all('bags').length,
        pending: (this.data.outbox || []).length,
        deviceId: this.data.meta.deviceId,
      };
    },
  };

  window.Store = Store;
})();
