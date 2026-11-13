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

  const OUTBOX_CAP = 60000;   // 5 000 bags numbered in one go must all reach the cloud
  const nowISO = () => new Date().toISOString();
  const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;


  /* --------------------------- input hygiene --------------------------
     Every record entering the store — typed in a form, imported from a
     backup, or pulled from the cloud — passes through clean(). It removes
     the characters that build HTML (< > " `) from text, and forces number
     fields to be real numbers, so a value written by anyone with database
     access can never become markup or script on another person's screen. */
  const NUM_KEYS = new Set([
    'bags', 'bagCount', 'avgBagKg', 'avgFillPct', 'moisturePct', 'netKg', 'grossKg', 'tareKg',
    'unitPrice', 'reducedUnitPrice', 'grossAmount', 'deductions', 'netAmount', 'amount', 'capacity',
    'capacityBags', 'count', 'roundNo', 'sampleSizePct', 'minSampleSize', 'standardDryBagKg',
    'fillThresholdPct', 'replacementOrderQty', 'landAcres', 'fillPct', 'kg', 'weightKg', 'qty',
    'quantity', 'bagsIssued', 'bagsReturned', 'damaged', 'tries', 'n',
    'deductionPct', 'deductionAmount', 'payableAmount', 'dryingKgPerDay', 'driestBagKg', 'moistureReadyPct',
    'bayCapacityBags', 'lastWeighKg', 'rev', 'moistureCalKg1', 'moistureCalPct1',
    'moistureCalKg2', 'moistureCalPct2', 'moistureWarnPct', 'moistureHighPct', 'deductDampPct', 'deductWetPct',
    // bag store
    'usedQty', 'newQty', 'bagsGood', 'bagsTorn', 'newDelta', 'usedDelta', 'newCounted', 'usedCounted',
    'bagReorderLevel', 'requestedBags',
  ]);
  const HTML_CHARS = /[<>"`]/g;
  function clean(value, key) {
    if (value === null || value === undefined) return value;
    if (key && NUM_KEYS.has(key)) {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
      if (typeof value === 'string' && value.trim() === '') return null;
      if (typeof value !== 'object') return null;
    }
    if (typeof value === 'string') return value.replace(HTML_CHARS, '');
    if (Array.isArray(value)) return value.map((v) => clean(v));
    if (typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        out[k] = clean(value[k], k);
      }
      return out;
    }
    return value;
  }

  /* ------------------------- record shape guard -----------------------
     The cloud database drops empty lists and empty values, so a record that
     left this device as { allocations: [], avgFillPct: null } comes back
     without those keys. normalize() puts the expected shape back so no
     screen ever trips over a missing list. */
  function normalize(coll, rec) {
    if (!rec || typeof rec !== 'object') return rec;
    const list = (k) => { if (!Array.isArray(rec[k])) rec[k] = rec[k] && typeof rec[k] === 'object' ? Object.values(rec[k]) : []; };
    if (coll === 'deliveries') {
      list('allocations'); list('farmerSplit'); list('serials');
      if (rec.fillCheck && typeof rec.fillCheck === 'object') {
        const f = rec.fillCheck;
        if (!Array.isArray(f.fills)) f.fills = f.fills && typeof f.fills === 'object' ? Object.values(f.fills) : [];
        if (f.avgFillPct === undefined) f.avgFillPct = null;
        if (f.spread === undefined) f.spread = null;
      }
      if (!rec.status) rec.status = 'AWAITING_ACCEPTANCE';
    }
    if (coll === 'bagIssues') list('serials');
    if (coll === 'payments') list('history');
    if (coll === 'usageRequests' && rec.status === 'CONSUMED') { list('sampleBags'); list('bagSerials'); list('fromLoads'); list('typeWeights'); }
    return rec;
  }

  /* Running numbers (RC-2026-0007, PAY-…) are counted on each device. After
     records arrive from other devices the counters must move past them, or
     two tablets would hand out the same receipt number. */
  const NUMBERED = [
    ['receipt', 'deliveries', 'receiptNo'], ['payment', 'payments', 'paymentNo'],
    ['usage', 'usageRequests', 'requestNo'], ['quality', 'qualityIssues', 'issueNo'],
    ['bagReturn', 'bagReturns', 'returnNo'], ['supplier', 'suppliers', 'code'], ['farmer', 'farmers', 'code'],
  ];
  const tailNumber = (v) => { const m = String(v || '').match(/(\d+)\s*$/); return m ? Number(m[1]) : 0; };

  /* The live records and the demo records live under different storage
     keys, so the no-password demo can never see or upload real data. */
  let space = 'live';
  const storeKey = () => (space === 'demo' ? `${CFG.storageKey}.demo` : CFG.storageKey);

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
        siteLocation: 'Balangoda',
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
      const rawDoc = raw.get(storeKey());
      if (rawDoc) {
        try {
          const parsed = JSON.parse(rawDoc);
          this.data = deepMerge(blankDoc(), parsed);
        } catch (e) {
          console.error('Corrupt local database — starting a fresh one.', e);
          // Never silently destroy: keep a copy for recovery.
          raw.set(`${storeKey()}.corrupt.${Date.now()}`, rawDoc);
          this.data = blankDoc();
        }
      } else {
        this.data = blankDoc();
      }
      for (const c of COLLECTIONS) {
        this.data[c] = Array.isArray(this.data[c])
          ? this.data[c].filter((r) => r && typeof r === 'object').map((r) => normalize(c, clean(r))) : [];
      }
      if (!this.data.counters || typeof this.data.counters !== 'object') this.data.counters = {};
      if (!this.data.meta || typeof this.data.meta !== 'object') this.data.meta = blankDoc().meta;
      this.bumpCounters();
      this.data.settings = Object.assign(blankDoc().settings, this.data.settings || {});
      this.migrateSettings();
      this.data.config = deepMerge(blankDoc().config, this.data.config || {});
      return this.data;
    },

    /**
     * One-off corrections to saved settings when the app changes its mind
     * about a default. Done quietly: it must never count as "an administrator
     * saved the settings", or a tidy-up on one tablet would overwrite the
     * prices in the cloud. Also run on settings that arrive from the cloud.
     */
    migrateSettings() {
      const s = this.data.settings;
      if (!s || (s.rev || 0) >= 4) return false;
      if ((s.rev || 0) < 3) {
        if (!s.siteLocation || /gaththegama/i.test(s.siteLocation)) s.siteLocation = 'Balangoda';   // the site is in Balangoda
        s.minSampleSize = 1;                    // the fill check measures the full 5 %, with no extra minimum
        for (const k of ['dryingKgPerDay', 'driestBagKg', 'moistureReadyPct', 'bayCapacityBags', 'defaultDeductionReason']) {
          if (s[k] === undefined || s[k] === null || s[k] === '') s[k] = CFG.defaults[k];
        }
      }
      // Loads here are not wet; money is taken off for bags not filled
      // fully. The old moisture suggestions (5 % damp, 10 % wet) go off once;
      // an administrator can switch them on again in Business settings.
      s.deductDampPct = 0;
      s.deductWetPct = 0;
      s.rev = 4;
      return true;
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
            raw.set(storeKey(), JSON.stringify(this.data));
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
      if (persistence === 'localStorage') {
        try { raw.set(storeKey(), JSON.stringify(this.data)); } catch (e) {
          if (String(e && e.name) === 'QuotaExceededError') window.dispatchEvent(new CustomEvent('efpl:storage-full'));
          else console.error('Save failed', e);
        }
      }
      return this.data;
    },

    /* -------------------------- collections --------------------------- */
    clean,

    get space() { return space; },
    /** Switch between the live store and the sandboxed demo store. */
    useSpace(name) {
      const next = name === 'demo' ? 'demo' : 'live';
      if (next === space && this.data) return this.data;
      if (this.data) this.flush();
      space = next;
      return this.init();
    },

    /** Remove seeded demo records (and their upload queue entries) from the live store. */
    purgeDemo() {
      if (space !== 'live') return 0;
      let removed = 0;
      const gone = new Set();
      for (const c of COLLECTIONS) {
        if (!Array.isArray(this.data[c])) continue;
        this.data[c] = this.data[c].filter((r) => {
          if (r && r.demo === true) { removed++; gone.add(`${c}:${r.id}`); return false; }
          return true;
        });
      }
      if (removed) {
        this.data.outbox = (this.data.outbox || []).filter((o) => !gone.has(`${o.coll}:${o.id}`));
        this.data.meta.seeded = true;
        this.flush();
      }
      return removed;
    },
    all(coll) { return this.data[coll] || []; },
    byId(coll, id) { return this.all(coll).find((r) => r.id === id) || null; },
    where(coll, pred) { return this.all(coll).filter(pred); },

    nextSeq(name, start = 1) {
      const cur = this.data.counters[name] ?? start;
      this.data.counters[name] = cur + 1;
      return cur;
    },
    normalize,

    /** Move every running number past the highest one already on record. */
    bumpCounters() {
      for (const [name, coll, field] of NUMBERED) {
        let max = 0;
        for (const r of this.data[coll] || []) max = Math.max(max, tailNumber(r[field]));
        if ((this.data.counters[name] || 1) <= max) this.data.counters[name] = max + 1;
      }
    },

    /**
     * Two devices that were both offline can hand out the same number. When
     * that shows up after a sync, the record still waiting in this device's
     * upload queue (so nobody else has seen it yet) takes a fresh number and
     * keeps a note of the old one. Returns how many were renumbered.
     */
    fixDuplicateNumbers() {
      let fixed = 0;
      const queued = new Set((this.data.outbox || []).map((o) => `${o.coll}:${o.id}`));
      for (const [name, coll, field] of NUMBERED) {
        const seen = new Map();
        const rows = (this.data[coll] || []).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
        for (const r of rows) {
          const no = r[field];
          if (!no) continue;
          if (!seen.has(no)) { seen.set(no, r); continue; }
          const first = seen.get(no);
          // prefer to renumber the one only this device knows about
          const victim = queued.has(`${coll}:${r.id}`) ? r : (queued.has(`${coll}:${first.id}`) ? first : null);
          if (!victim) continue;
          this.bumpCounters();
          const n = this.nextSeq(name, 1);
          const fresh = String(no).replace(/(\d+)\s*$/, (m) => String(n).padStart(m.length, '0'));
          victim.renumberedFrom = no;
          victim[field] = fresh;
          victim.updatedAt = nowISO();
          this.markDirty(coll, victim.id);
          if (victim === first) seen.set(no, r);
          // a payment keeps pointing at its delivery by id, so nothing else changes
          fixed++;
        }
      }
      if (fixed) this.save('renumber');
      return fixed;
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
      // Never drop queued changes: a truncated queue means records that
      // silently never reach the cloud. The cap is only a last-resort guard.
      if (this.data.outbox.length > OUTBOX_CAP) this.data.outbox.splice(0, this.data.outbox.length - OUTBOX_CAP);
    },
    /** Forget a queued upload (the cloud already holds something newer). */
    clearDirty(coll, id) {
      if (!this.data.outbox) return;
      this.data.outbox = this.data.outbox.filter((o) => !(o.coll === coll && o.id === id));
    },

    add(coll, record, reason = 'add') {
      const rec = Object.assign({ id: uid(coll.slice(0, 3)), createdAt: nowISO(), updatedAt: nowISO() }, clean(record));
      this.data[coll].push(rec);
      this.markDirty(coll, rec.id);
      this.save(reason);
      return rec;
    },

    update(coll, id, patch, reason = 'update') {
      const rec = this.byId(coll, id);
      if (!rec) return null;
      Object.assign(rec, clean(patch), { updatedAt: nowISO() });
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
        const rec = Object.assign({ id: uid(coll.slice(0, 3)), createdAt: nowISO(), updatedAt: nowISO() }, clean(r));
        this.data[coll].push(rec);
        if (this.data.outbox) this.data.outbox.push({ id: uid('ob'), coll, id: rec.id, at: nowISO(), tries: 0 });
        out.push(rec);
      }
      if (this.data.outbox && this.data.outbox.length > OUTBOX_CAP) {
        this.data.outbox.splice(0, this.data.outbox.length - OUTBOX_CAP);
      }
      this.save(reason);
      return out;
    },

    settings() { return this.data.settings; },
    patchSettings(patch) {
      Object.assign(this.data.settings, clean(patch), { updatedAt: nowISO() });
      this.markDirty('settings', 'singleton');
      this.save('settings');
      return this.data.settings;
    },

    subscription() { return (this.data.config && this.data.config.subscription) || { status: 'ACTIVE' }; },

    /* ------------------------- import / export ------------------------ */
    exportJSON() { return JSON.parse(JSON.stringify(this.data)); },

    importJSON(objRaw, { merge = false } = {}) {
      if (!objRaw || typeof objRaw !== 'object') throw new Error('Not a valid backup file');
      const obj = clean(objRaw);
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

    /**
     * The owner or an administrator cleared the records everywhere
     * (Administration → Data & sync). With `full`, it is a reset to brand
     * new: the settings return to the defaults as well.
     * Empty those collections on this device and forget their pending
     * uploads, so nothing old is sent back up. Anything made on this device
     * AFTER the clear-out (offline work) is kept. Numbering starts again.
     */
    wipeRecords(colls, atISO, { full = false } = {}) {
      const ms = (s) => (typeof s === 'string' && s ? Date.parse(s) || 0 : 0);   // Date.parse(0) would be the year 2000
      const at = ms(atISO);
      const after = (r) => ms(r && r.createdAt) > at;
      let removed = 0;
      for (const c of colls) {
        const before = (this.data[c] || []).length;
        this.data[c] = (this.data[c] || []).filter(after);
        removed += before - this.data[c].length;
      }
      const keepIds = new Set(colls.flatMap((c) => this.data[c].map((r) => `${c}:${r.id}`)));
      this.data.outbox = (this.data.outbox || []).filter((o) => !colls.includes(o.coll) || keepIds.has(`${o.coll}:${o.id}`));
      if (full) {
        // a full reset: business settings go back to the factory defaults too
        // (unless someone already saved new ones on this device after the reset)
        if (ms(this.data.settings && this.data.settings.updatedAt) <= at) {
          this.data.settings = blankDoc().settings;
          this.migrateSettings();
          this.data.outbox = this.data.outbox.filter((o) => o.coll !== 'settings');
        }
      }
      this.data.counters = {};
      this.bumpCounters();
      this.data.meta.wipeSeenAt = atISO;
      this.data.meta.wipeFull = full;
      this.flush();
      this.notify('wipe');
      return removed;
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
        bytes: persistence === 'localStorage' ? (raw.get(storeKey()) || '').length : 0,
        bags: this.all('bags').length,
        pending: (this.data.outbox || []).length,
        deviceId: this.data.meta.deviceId,
      };
    },
  };

  window.Store = Store;
})();
