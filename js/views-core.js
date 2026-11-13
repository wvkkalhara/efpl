/* =====================================================================
   views-core.js — dashboard, receiving, deliveries, traceability.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG, Store = window.Store, Auth = window.Auth,
    UI = window.UI, D = window.Domain, Sync = window.Sync, App = window.App;
  const { esc, money, kg, dt, dOnly, badge } = UI;

  /* ------------------------- shared view helpers --------------------- */
  const VH = {
    audit(action, entity, entityId, detail) {
      // The activity log covers the staff. The owner account leaves no entries.
      if (Auth.isSuper(Auth.current())) return;
      const me = Auth.current() || {};
      Store.add('audit', {
        at: new Date().toISOString(),
        by: String(me.email || 'system').toLowerCase(),
        name: me.name || '', role: Auth.role(),
        action, entity, entityId: String(entityId || ''), detail: String(detail || '').slice(0, 500),
        device: Store.data.meta.deviceId,
      }, 'audit');
      // Keep the device copy to a size the tablet can hold; the cloud keeps it all.
      const log = Store.data.audit;
      if (log.length > 4000) {
        const queued = new Set((Store.data.outbox || []).filter((o) => o.coll === 'audit').map((o) => o.id));
        let drop = log.length - 3000;
        Store.data.audit = log.filter((a) => (drop > 0 && !queued.has(a.id) ? (drop--, false) : true));
      }
    },
    supplierOptions() {
      return Store.where('suppliers', (s) => !s.deleted && s.status !== 'INACTIVE')
        .slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }));
    },
    /* ------------------------------ bank ------------------------------
       Where the supplier is paid. Older records hold one free-text "bank"
       line; newer ones hold bank, branch, account number and account name. */
    hasBank(sup) { return !!(sup && (sup.bankAccount || sup.bankName || sup.bank)); },
    bankText(sup) {
      if (!VH.hasBank(sup)) return 'No bank details on file';
      const parts = [sup.bankName, sup.bankBranch ? `${sup.bankBranch} branch` : '', sup.bankAccount ? `A/C ${sup.bankAccount}` : '',
        sup.bankAccountName && sup.bankAccountName !== sup.name ? `in the name of ${sup.bankAccountName}` : ''].filter(Boolean);
      return parts.length ? parts.join(', ') : String(sup.bank || '');
    },
    bankHtml(sup) {
      if (!VH.hasBank(sup)) return '<p class="t-warn small">No bank details on file for this supplier. Add them under Suppliers so Head Office can pay.</p>';
      if (!sup.bankAccount && !sup.bankName) return `<p>${esc(sup.bank)}</p>`;
      return `<table class="mini bank-box">
        <tr><td>Account name</td><td><b>${esc(sup.bankAccountName || sup.name || '')}</b></td></tr>
        <tr><td>Account number</td><td><b class="mono">${esc(sup.bankAccount || '—')}</b></td></tr>
        <tr><td>Bank</td><td>${esc(sup.bankName || '—')}${sup.bankBranch ? `, ${esc(sup.bankBranch)} branch` : ''}</td></tr>
      </table>`;
    },
    /** Full enough to pay: a bank and an account number. */
    bankReady(sup) { return !!(sup && ((sup.bankName && sup.bankAccount) || (!sup.bankName && !sup.bankAccount && sup.bank))); },
    canEditBank() { return Auth.can('supplier.write') || Auth.can('delivery.accept') || Auth.can('payment.approve') || Auth.can('payment.release'); },
    BANKS: ['Bank of Ceylon', 'People\'s Bank', 'Commercial Bank', 'Hatton National Bank', 'Sampath Bank', 'Seylan Bank', 'National Savings Bank', 'Nations Trust Bank', 'DFCC Bank', 'Regional Development Bank', 'Sanasa Development Bank'],
    /**
     * "Pay to" with a way to change it on the spot. When the supplier has no
     * bank details the fields start open and must be filled in.
     */
    bankEditor(sup, opts) {
      const o = opts || {};
      const ready = VH.bankReady(sup);
      const can = VH.canEditBank();
      const v = (k) => esc(sup ? (sup[k] || (k === 'bankName' && !sup.bankAccount ? sup.bank || '' : '')) : '');
      return `<div class="bank-edit" data-bank-edit>
        <div class="bank-show" ${ready ? '' : 'hidden'}>${VH.bankHtml(sup)}
          ${can ? '<button type="button" class="nm-btn small" data-bank-toggle>Change bank details</button>' : ''}</div>
        ${!ready && !can ? '<p class="t-warn small">No bank details on file. Ask someone who can edit suppliers to add them.</p>' : ''}
        <div class="bank-form" ${ready || !can ? 'hidden' : ''}>
          ${ready ? '' : '<p class="t-warn small"><b>No bank details for this supplier.</b> Add them now so Head Office can pay.</p>'}
          <div class="grid-2">
            ${UI.field('Bank', `<input class="nm-input" name="payBankName" list="pay-bank-list" value="${v('bankName')}" placeholder="Bank of Ceylon">`)}
            ${UI.field('Branch', `<input class="nm-input" name="payBankBranch" value="${v('bankBranch')}" placeholder="Balangoda">`)}
            ${UI.field('Account number', `<input class="nm-input" name="payBankAccount" inputmode="numeric" value="${v('bankAccount')}" placeholder="0071234567">`)}
            ${UI.field('Account name', `<input class="nm-input" name="payBankAccountName" value="${v('bankAccountName')}" placeholder="As printed on the passbook">`, 'Leave empty if it is the supplier name.')}
          </div>
          <div class="row-actions">
            ${o.saveButton ? '<button type="button" class="nm-btn small primary" data-bank-save>Save bank details</button>' : ''}
            ${ready ? '<button type="button" class="nm-btn small" data-bank-toggle>Keep the old details</button>' : ''}
          </div>
          <datalist id="pay-bank-list">${VH.BANKS.map((b) => `<option value="${esc(b)}"></option>`).join('')}</datalist>
        </div>
      </div>`;
    },
    /** Wire the toggle. Returns read(): null when unchanged, else the new details (or an error). */
    wireBankEditor(root) {
      const box = root.querySelector('[data-bank-edit]');
      if (!box) return () => null;
      const show = box.querySelector('.bank-show'), form = box.querySelector('.bank-form');
      UI.$$('[data-bank-toggle]', box).forEach((b) => b.addEventListener('click', () => {
        const opening = form.hidden;
        form.hidden = !opening; show.hidden = opening;
        if (opening) { const f = form.querySelector('[name=payBankAccount]'); if (f) f.focus(); }
      }));
      return () => {
        if (form.hidden) return null;
        const val = (n) => String((form.querySelector(`[name=${n}]`) || {}).value || '').trim().replace(/\s+/g, ' ');
        const out = { bankName: val('payBankName'), bankBranch: val('payBankBranch'), bankAccount: val('payBankAccount').replace(/[\s-]/g, ''), bankAccountName: val('payBankAccountName') };
        if (!out.bankName) out.error = 'Enter the bank';
        else if (!out.bankAccount) out.error = 'Enter the account number';
        else if (!/^[0-9A-Za-z]{4,24}$/.test(out.bankAccount)) out.error = 'The account number should be 4 to 24 letters or digits';
        return out;
      };
    },
    /** Save new bank details on the supplier, and say so in the activity log. */
    saveBank(supplierId, b, why) {
      const sup = Store.byId('suppliers', supplierId);
      if (!sup || !b) return false;
      const had = VH.hasBank(sup), before = VH.bankText(sup);
      Store.update('suppliers', sup.id, {
        bankName: b.bankName, bankBranch: b.bankBranch, bankAccount: b.bankAccount, bankAccountName: b.bankAccountName,
        bank: [b.bankName, b.bankAccount].filter(Boolean).join(' · '),
      }, 'supplier-bank');
      VH.audit('supplier.bank', 'supplier', sup.id, `${sup.code || ''} ${sup.name}: bank details ${had ? `changed from "${before}" ` : 'added '}to "${VH.bankText(Store.byId('suppliers', sup.id))}"${why ? ` (${why})` : ''}`);
      return true;
    },

    /* ------------------------------ bays ------------------------------
       What is in a bay right now, and how dry it is today. Biomass dries
       as it waits (Domain.driedBagKg), so the figure moves every day
       without anyone weighing anything. A real weighing of the bay (a
       test bag at approval, the daily bay check, one bag per type at the gasifier) replaces the
       estimate from that moment on. */
    /**
     * What is in a bay, load by load. The bay holds what was put into it when
     * loads were accepted (the bags per bay chosen then), less what went to
     * the gasifier from it, oldest load first. This does NOT depend on bag
     * serial numbers: a truck accepted without serials still fills its bays.
     * (Serials, when they are captured, are tracked on top of this.)
     */
    bayLayers(bayId) {
      const layers = [];
      for (const d of Store.all('deliveries')) {
        if (d.deleted || d.status !== 'ACCEPTED') continue;
        for (const a of d.allocations || []) {
          if (a.bayId !== bayId || !(Number(a.bags) > 0)) continue;
          layers.push({ delivery: d, deliveryId: d.id, count: Number(a.bags), since: d.acceptedAt || d.deliveredAt || null });
        }
      }
      layers.sort((a, b) => String(a.since || '').localeCompare(String(b.since || '')));
      let out = 0;
      for (const u of Store.all('usageRequests')) {
        if (!u.deleted && u.status === 'CONSUMED' && u.bayId === bayId) out += Number(u.bags) || 0;
      }
      for (const l of layers) {            // first in, first out
        if (out <= 0) break;
        const take = Math.min(out, l.count);
        l.count -= take;
        out -= take;
      }
      return layers.filter((l) => l.count > 0);
    },

    bayNow(bayOrId) {
      const bay = typeof bayOrId === 'string' ? Store.byId('bays', bayOrId) : bayOrId;
      if (!bay) return null;
      const s = Store.settings();
      const groups = VH.bayLayers(bay.id);
      const count = groups.reduce((a, g) => a + g.count, 0);
      const measuredAt = bay.lastWeighKg && bay.lastWeighAt ? Date.parse(bay.lastWeighAt) : NaN;
      const loads = [];
      let kgSum = 0, kgN = 0, arrSum = 0, arrN = 0;
      for (const g of groups) {
        const d = g.delivery;
        const since = g.since;
        const startKg = d && d.avgBagKg ? d.avgBagKg : null;
        // a weighing of the bay after this load came in is better than the estimate
        const useMeasured = Number.isFinite(measuredAt) && since && measuredAt > Date.parse(since);
        const estKg = useMeasured ? D.driedBagKg(bay.lastWeighKg, bay.lastWeighAt, s) : D.driedBagKg(startKg, since, s);
        loads.push({
          delivery: d, count: g.count, since, days: D.daysSince(since), startKg,
          startMoisture: startKg ? D.moistureFromWeight(startKg, s) : null,
          estKg, moisture: estKg ? D.moistureFromWeight(estKg, s) : null, measured: !!useMeasured,
        });
        if (estKg) { kgSum += estKg * g.count; kgN += g.count; }
        if (startKg) { arrSum += startKg * g.count; arrN += g.count; }
      }
      loads.sort((a, b) => String(a.since || '').localeCompare(String(b.since || '')));
      const estKg = kgN ? D.round2(kgSum / kgN) : null;
      const moisture = estKg ? D.moistureFromWeight(estKg, s) : null;
      const capacity = Number(bay.capacityBags) || 0;
      const ready = moisture !== null && count > 0 && moisture <= D.moistureReadyPct(s);
      return {
        bay, count, capacity,
        pctFull: capacity ? Math.round((count / capacity) * 100) : 0, over: capacity > 0 && count > capacity,
        loads, estKg, moisture, band: D.moistureBand(moisture, s), ready,
        arrivalKg: arrN ? D.round2(arrSum / arrN) : null,
        oldestDays: loads.length ? Math.max.apply(null, loads.map((l) => l.days || 0)) : null,
        measured: bay.lastWeighKg && bay.lastWeighAt ? { kg: bay.lastWeighKg, at: bay.lastWeighAt } : null,
      };
    },

    /* ------------------------- daily bay check -------------------------
       Someone weighs one bag from each bay, most days (a missed day is
       fine). Each reading is kept as a store record (kind BAY_CHECK) and is
       also the bay's latest weighing, so today's estimate starts from it. */
    bayChecks(bayId) {
      return Store.all('bagReturns')
        .filter((r) => !r.deleted && r.kind === 'BAY_CHECK' && (!bayId || r.bayId === bayId))
        .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    },
    canBayCheck() { return Auth.can('usage.approve') || Auth.can('usage.consume') || Auth.can('bay.allocate'); },
    checkedToday(bayId) {
      const today = new Date().toDateString();
      return VH.bayChecks(bayId).some((r) => new Date(r.at).toDateString() === today);
    },
    saveBayCheck(bayId, kgValue, note) {
      const bay = Store.byId('bays', bayId);
      const w = Number(kgValue);
      if (!bay || !(w > 0)) return null;
      const s = Store.settings();
      const now = new Date().toISOString();
      const me = (Auth.current() || {}).email || '';
      const rec = Store.add('bagReturns', {
        kind: 'BAY_CHECK', bayId, bayCode: bay.code, kg: w, moisturePct: D.moistureFromWeight(w, s),
        bags: VH.bagsInBay(bayId), note: note || '', at: now, returnedAt: now, recordedBy: me,
      }, 'bay-check');
      Store.update('bays', bayId, { lastWeighKg: w, lastWeighAt: now, lastWeighBy: me }, 'bay-weigh');
      VH.audit('bay.check', 'bay', bay.code, `${bay.code} daily check: one bag ${w} kg · moisture ${D.moistureFromWeight(w, s)}%`);
      return rec;
    },

    /**
     * Every weight known for a bay, oldest first: loads coming in, daily
     * checks, test bags at approval and the bags weighed at the gasifier.
     * This is how the weight (and so the moisture) goes down over time.
     */
    bayReadings(bayId) {
      const s = Store.settings();
      const out = [];
      const add = (at, kgv, kind, label) => { const k = Number(kgv); if (at && k > 0) out.push({ at, kg: k, moisture: D.moistureFromWeight(k, s), kind, label }); };
      for (const d of Store.all('deliveries')) {
        if (d.deleted || d.status !== 'ACCEPTED') continue;
        if ((d.allocations || []).some((a) => a.bayId === bayId)) add(d.acceptedAt || d.deliveredAt, d.avgBagKg, 'in', `${d.receiptNo} came in`);
      }
      for (const c of VH.bayChecks(bayId)) add(c.at, c.kg, 'check', 'Daily check');
      for (const u of Store.all('usageRequests')) {
        if (u.deleted || u.bayId !== bayId) continue;
        if (u.testBagKg && u.approvedAt) add(u.approvedAt, u.testBagKg, 'test', `${u.requestNo} test bag`);
        if (u.status === 'CONSUMED') add(u.consumedAt, u.avgBagKg, 'out', `${u.requestNo} to the gasifier`);
      }
      return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    },

    /** A small line of the moisture over the last days (for a bay tile). */
    sparkline(points, opts) {
      const o = Object.assign({ w: 120, h: 30, days: 14 }, opts || {});
      const since = Date.now() - o.days * 864e5;
      const pts = (points || []).filter((p) => Date.parse(p.at) >= since && p.moisture !== null);
      if (pts.length < 2) return `<span class="spark-empty">${pts.length ? `1 reading: ${pts[0].moisture}%` : 'no readings yet'}</span>`;
      const xs = pts.map((p) => Date.parse(p.at));
      const ys = pts.map((p) => p.moisture);
      const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      const y0 = Math.min.apply(null, ys) - 2, y1 = Math.max.apply(null, ys) + 2;
      const X = (v) => (x1 === x0 ? o.w / 2 : 2 + ((v - x0) / (x1 - x0)) * (o.w - 4));
      const Y = (v) => (y1 === y0 ? o.h / 2 : o.h - 3 - ((v - y0) / (y1 - y0)) * (o.h - 6));
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)} ${Y(p.moisture).toFixed(1)}`).join(' ');
      const last = pts[pts.length - 1];
      const first = pts[0];
      const down = last.moisture < first.moisture;
      return `<svg class="spark ${down ? 'is-down' : 'is-up'}" viewBox="0 0 ${o.w} ${o.h}" width="${o.w}" height="${o.h}" role="img" aria-label="Moisture from ${first.moisture}% to ${last.moisture}% over ${pts.length} readings">
        <path d="${d}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${X(xs[xs.length - 1]).toFixed(1)}" cy="${Y(last.moisture).toFixed(1)}" r="2.6"/></svg>`;
    },

    /** A bigger chart of the moisture readings, with the dry line marked. */
    bayChart(points, opts) {
      const o = Object.assign({ w: 640, h: 200 }, opts || {});
      const s = Store.settings();
      const pts = (points || []).filter((p) => p.moisture !== null);
      if (!pts.length) return '<p class="muted">No weights recorded for this bay yet.</p>';
      const pad = { l: 34, r: 10, t: 10, b: 24 };
      const xs = pts.map((p) => Date.parse(p.at));
      const ready = D.moistureReadyPct(s);
      const ys = pts.map((p) => p.moisture).concat([ready]);
      const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      const y0 = Math.max(0, Math.floor((Math.min.apply(null, ys) - 3) / 5) * 5), y1 = Math.ceil((Math.max.apply(null, ys) + 3) / 5) * 5;
      const X = (v) => pad.l + (x1 === x0 ? (o.w - pad.l - pad.r) / 2 : ((v - x0) / (x1 - x0)) * (o.w - pad.l - pad.r));
      const Y = (v) => o.h - pad.b - ((v - y0) / (y1 - y0 || 1)) * (o.h - pad.t - pad.b);
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)} ${Y(p.moisture).toFixed(1)}`).join(' ');
      const ticks = [y0, Math.round((y0 + y1) / 2), y1];
      const KIND = { in: 'came in', check: 'daily check', test: 'test bag', out: 'to the gasifier' };
      return `<svg class="bay-chart" viewBox="0 0 ${o.w} ${o.h}" role="img" aria-label="Moisture of the bay over time">
        ${ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${o.w - pad.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="ax" x="${pad.l - 6}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${t}%</text>`).join('')}
        <line class="dry-line" x1="${pad.l}" x2="${o.w - pad.r}" y1="${Y(ready).toFixed(1)}" y2="${Y(ready).toFixed(1)}"/>
        <text class="ax dry" x="${o.w - pad.r}" y="${(Y(ready) - 4).toFixed(1)}" text-anchor="end">dry: ${ready}%</text>
        <path class="ln" d="${line}"/>
        ${pts.map((p, i) => `<circle class="pt pt-${p.kind}" cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.moisture).toFixed(1)}" r="4"><title>${dOnly(p.at)}: ${p.kg} kg, ${p.moisture}% (${KIND[p.kind] || p.kind})</title></circle>`).join('')}
        <text class="ax" x="${pad.l}" y="${o.h - 6}">${dOnly(new Date(x0).toISOString())}</text>
        <text class="ax" x="${o.w - pad.r}" y="${o.h - 6}" text-anchor="end">${dOnly(new Date(x1).toISOString())}</text>
      </svg>`;
    },

    /** Everything that went into and came out of a bay, newest first, with the moisture each time. */
    bayHistory(bayId) {
      const s = Store.settings();
      const rows = [];
      for (const d of Store.all('deliveries')) {
        if (d.deleted || d.status !== 'ACCEPTED') continue;
        for (const a of d.allocations || []) {
          if (a.bayId !== bayId) continue;
          rows.push({
            at: d.acceptedAt || d.deliveredAt, kind: 'in', bags: a.bags, kgPerBag: d.avgBagKg || null,
            moisture: d.avgBagKg ? D.moistureFromWeight(d.avgBagKg, s) : null,
            ref: d.receiptNo, who: (Store.byId('suppliers', d.supplierId) || {}).name || '', note: VH.typeLabel(d.biomassType),
          });
        }
      }
      for (const u of Store.all('usageRequests')) {
        if (u.deleted || u.bayId !== bayId) continue;
        if (u.testBagKg && u.approvedAt) {
          rows.push({ at: u.approvedAt, kind: 'weigh', bags: null, kgPerBag: u.testBagKg, moisture: D.moistureFromWeight(u.testBagKg, s), ref: u.requestNo, who: u.approvedBy || '', note: 'Test bag weighed before approval' });
        }
        if (u.status === 'CONSUMED') {
          rows.push({ at: u.consumedAt, kind: 'out', bags: u.bags, kgPerBag: u.avgBagKg || null, moisture: u.avgBagKg ? D.moistureFromWeight(u.avgBagKg, s) : null, ref: u.requestNo, who: u.consumedBy || '', note: u.totalKg ? `${D.kg(u.totalKg)} to the gasifier` : 'To the gasifier' });
        }
      }
      for (const c of VH.bayChecks(bayId)) {
        rows.push({ at: c.at, kind: 'weigh', bags: null, kgPerBag: c.kg, moisture: D.moistureFromWeight(c.kg, s), ref: 'Daily check', who: c.recordedBy || '', note: c.note || 'One bag weighed' });
      }
      return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    },
    bayOptions() {
      return Store.where('bays', (b) => !b.deleted).map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
    },
    /**
     * The bag store, by count (serials are not needed). Two shelves:
     *   new  — never used: bought in, or counted at a stock-take;
     *   used — emptied at the gasifier and still good.
     * Bags go out to suppliers from the used shelf first, topped up with new
     * ones; torn bags found at the gasifier or in the store are thrown away.
     * Movements are kept in the bagReturns collection (kind PURCHASE,
     * DISCARD, COUNT), on the bag rounds (usedQty / newQty) and on the
     * gasifier issues (bagsGood / bagsTorn). Records made before the bag
     * store existed are shown in the history but do not move the shelves.
     */
    bagStore() {
      const n = (v) => Number(v) || 0;
      let fresh = 0, used = 0, discarded = 0, discarded30 = 0;
      const moves = [];
      const recent = (at) => Date.now() - (Date.parse(at || '') || 0) < 30 * 864e5;
      for (const r of Store.all('bagReturns')) {
        if (r.deleted) continue;
        const at = r.at || r.returnedAt;
        const by = r.recordedBy || '';
        if (r.kind === 'PURCHASE') {
          fresh += n(r.newQty);
          moves.push({ at, kind: 'PURCHASE', what: 'New bags received', newD: n(r.newQty), usedD: 0, ref: r.returnNo, note: [r.vendor, r.note].filter(Boolean).join(' · '), by });
        } else if (r.kind === 'DISCARD') {
          const q = n(r.qty);
          if (r.shelf === 'NEW') fresh -= q; else used -= q;
          discarded += q; if (recent(at)) discarded30 += q;
          moves.push({ at, kind: 'DISCARD', what: 'Thrown away', newD: r.shelf === 'NEW' ? -q : 0, usedD: r.shelf === 'NEW' ? 0 : -q, ref: r.returnNo, note: r.reason || r.note || '', by });
        } else if (r.kind === 'BAY_CHECK') {
          // daily bay checks are kept in the same list; they do not move bags
        } else if (r.kind === 'COUNT') {
          fresh += n(r.newDelta); used += n(r.usedDelta);
          moves.push({ at, kind: 'COUNT', what: 'Store counted', newD: n(r.newDelta), usedD: n(r.usedDelta), ref: r.returnNo, note: `Counted ${n(r.newCounted).toLocaleString()} new and ${n(r.usedCounted).toLocaleString()} used${r.note ? ` · ${r.note}` : ''}`, by });
        } else {
          moves.push({ at, kind: 'OLD', what: 'Bag return (before the bag store)', newD: 0, usedD: 0, ref: r.returnNo, note: `${n(r.returnedBags)} checked: ${n(r.good)} good, ${n(r.repairable)} to repair, ${n(r.replaced)} replaced`, by });
        }
      }
      for (const i of Store.all('bagIssues')) {
        if (i.deleted) continue;
        const sup = (Store.byId('suppliers', i.supplierId) || {}).name || '';
        if (i.usedQty !== undefined || i.newQty !== undefined) {
          used -= n(i.usedQty); fresh -= n(i.newQty);
          moves.push({ at: i.issuedAt, kind: 'ISSUE', what: `Given to ${sup}`, newD: -n(i.newQty), usedD: -n(i.usedQty), ref: `Round ${i.roundNo}`, note: '', by: i.issuedBy || '' });
        } else {
          moves.push({ at: i.issuedAt, kind: 'OLD', what: `Given to ${sup} (before the bag store)`, newD: 0, usedD: 0, ref: `Round ${i.roundNo}`, note: `${n(i.qty)} numbered bags`, by: i.issuedBy || '' });
        }
      }
      for (const u of Store.all('usageRequests')) {
        if (u.deleted || u.status !== 'CONSUMED' || (u.bagsGood === undefined && u.bagsTorn === undefined)) continue;
        used += n(u.bagsGood);
        discarded += n(u.bagsTorn); if (recent(u.consumedAt)) discarded30 += n(u.bagsTorn);
        moves.push({ at: u.consumedAt, kind: 'GASIFIER', what: 'Emptied at the gasifier', newD: 0, usedD: n(u.bagsGood), ref: u.requestNo, note: `${n(u.bagsGood)} good back to the store${n(u.bagsTorn) ? `, ${n(u.bagsTorn)} torn thrown away` : ''}`, by: u.consumedBy || '' });
      }
      moves.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      const withSuppliers = VH.supplierBags().reduce((a, x) => a + Math.max(0, x.holding), 0);
      const inBays = Store.where('bays', (b) => !b.deleted).reduce((a, b) => a + VH.bagsInBay(b.id), 0);
      const reorder = Number(Store.settings().bagReorderLevel);
      return {
        new: fresh, used, total: fresh + used, discarded, discarded30, withSuppliers, inBays,
        reorderLevel: Number.isFinite(reorder) && reorder >= 0 ? reorder : 500,
        low: fresh <= (Number.isFinite(reorder) && reorder >= 0 ? reorder : 500),
        started: moves.some((m) => m.kind !== 'OLD'),
        moves,
      };
    },

    /** How many bags each supplier is holding: given to them, less brought back full. */
    supplierBags() {
      const out = new Map();
      for (const i of Store.all('bagIssues')) {
        if (i.deleted || !i.supplierId) continue;
        const q = (i.usedQty !== undefined || i.newQty !== undefined) ? (Number(i.usedQty) || 0) + (Number(i.newQty) || 0) : (Number(i.qty) || 0);
        const r = out.get(i.supplierId) || { given: 0, back: 0, last: null };
        r.given += q;
        if (!r.last || String(i.issuedAt) > String(r.last)) r.last = i.issuedAt;
        out.set(i.supplierId, r);
      }
      for (const d of Store.all('deliveries')) {
        if (d.deleted || !d.supplierId || d.status === 'REJECTED') continue;
        const r = out.get(d.supplierId) || { given: 0, back: 0, last: null };
        r.back += Number(d.bagCount) || 0;
        out.set(d.supplierId, r);
      }
      return [...out.entries()].map(([id, r]) => {
        const s = Store.byId('suppliers', id) || {};
        return { supplier: s, supplierId: id, given: r.given, back: r.back, holding: r.given - r.back, last: r.last };
      }).sort((a, b) => b.holding - a.holding);
    },

    /** Bags in a bay now: accepted into it, less issued to the gasifier from it. */
    bagsInBay(bayId) { return VH.bayLayers(bayId).reduce((a, l) => a + l.count, 0); },
    paymentFor(deliveryId) { return Store.all('payments').find((p) => p.deliveryId === deliveryId) || null; },
    deliveryFor(id) { return Store.byId('deliveries', id); },

    /** Parse "EFPL-BG-000301-000480", "301-480", "1,2,3" or one-per-line. */
    parseSerials(text, prefix) {
      const out = [];
      const seen = new Set();
      const push = (s) => { const v = String(s).trim().toUpperCase(); if (v && !seen.has(v)) { seen.add(v); out.push(v); } };
      String(text || '').split(/[\s,;]+/).filter(Boolean).forEach((token) => {
        const range = token.match(/^([A-Z-]*?)(\d+)\s*[-–]\s*(?:[A-Z-]*?)(\d+)$/i);
        if (range) {
          const from = Number(range[2]), to = Number(range[3]);
          if (to >= from && to - from <= 5000) {
            for (let i = from; i <= to; i++) push(D.bagSerial(prefix, i));
            return;
          }
        }
        const num = token.match(/(\d+)$/);
        if (num && /^[A-Z-]*\d+$/i.test(token)) { push(D.bagSerial(prefix, Number(num[1]))); return; }
        push(token);
      });
      return out;
    },

    /**
     * The jobs waiting for the signed-in person. Each line is only added
     * when their role can actually do that job, so a gasifier operator is
     * never told about payments and accounts is never told about trucks.
     */
    myTasks() {
      const out = [];
      const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
      const add = (perm, count, tone, text, nav) => { if (count > 0 && Auth.can(perm) && App.canSee(nav)) out.push({ tone, text, nav }); };
      const deliveries = Store.all('deliveries').filter((d) => !d.deleted);
      const usage = Store.all('usageRequests').filter((u) => !u.deleted);
      const pays = Store.all('payments').filter((p) => !p.deleted);
      const bags = Store.all('bags');
      const count = (list, st) => list.filter((x) => x.status === st).length;
      const sum = (st) => pays.filter((p) => p.status === st).reduce((a, p) => a + (p.netAmount || 0), 0);

      const waiting = count(deliveries, 'AWAITING_ACCEPTANCE');
      add('delivery.accept', waiting, 'warn', `${n(waiting, 'truck is', 'trucks are')} waiting to be accepted and given a bay`, 'deliveries');
      const toApprove = count(usage, 'PENDING');
      add('usage.approve', toApprove, 'warn', `${n(toApprove, 'gasifier request needs', 'gasifier requests need')} your approval`, 'gasifier');
      const toWeigh = count(usage, 'APPROVED');
      add('usage.consume', toWeigh, 'warn', `${n(toWeigh, 'approved issue is', 'approved issues are')} ready to weigh and feed to the gasifier`, 'gasifier');
      // "Draft" only exists on payments made before the farmer step was removed
      const toAuth = count(pays, 'PENDING_SUPERVISOR') + count(pays, 'DRAFT');
      add('payment.approve', toAuth, 'warn', `${n(toAuth, 'payment', 'payments')} to authorise, worth ${money(sum('PENDING_SUPERVISOR') + sum('DRAFT'))}`, 'payments');
      const dry = Store.where('bays', (b) => !b.deleted).filter((b) => { const now = VH.bayNow(b); return now && now.ready; }).length;
      add('usage.approve', dry, 'danger', `${n(dry, 'bay is', 'bays are')} dry and should be used first`, 'bays');
      const toRelease = count(pays, 'APPROVED');
      add('payment.release', toRelease, 'info', `${n(toRelease, 'authorised payment', 'authorised payments')} to release to Head Office, worth ${money(sum('APPROVED'))}`, 'payments');
      const toPay = count(pays, 'SENT_TO_HEAD_OFFICE');
      add('payment.pay', toPay, 'info', `${n(toPay, 'payment is', 'payments are')} with Head Office, to mark as paid`, 'payments');
      const openQ = count(Store.all('qualityIssues'), 'OPEN');
      add('quality.resolve', openQ, 'danger', `${n(openQ, 'quality issue is', 'quality issues are')} open`, 'quality');
      // the bag store: start it once, then watch the new-bag shelf
      const bs = VH.bagStore();
      if (!bs.started) add('returns.write', 1, 'info', 'Count the empty bags in the store to start the bag store', 'returns');
      else if (bs.low) add('returns.write', 1, 'danger', `Only ${Math.max(0, bs.new).toLocaleString()} new bags left in the store: order more`, 'returns');
      const inStore = count(bags, 'IN_STOCK');
      if (bags.length && inStore < 50) add('bag.generate', 1, 'warn', `Only ${inStore} numbered bags left: number and label a new batch if you use serials`, 'bags');
      const pendingUsers = Auth.listUsers().filter((u) => Auth.roleOf(u) === 'pending').length;
      add('user.manage', pendingUsers, 'warn', `${n(pendingUsers, 'person is', 'people are')} waiting for you to give them a role`, 'admin');
      return out;
    },

    /* ----------------------------- biomass types ----------------------
       The list lives in settings so the site can add its own. */
    prettyType(id) {
      const s = String(id || '').replace(/_/g, ' ').toLowerCase();
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
    },
    biomassTypes() {
      const s = Store.settings();
      if (s.biomassTypesRev !== 2) {
        // One-time move from the old built-in list: start from the site's two
        // types and keep any other type that deliveries already use.
        const list = CFG.biomassTypes.map((t) => ({ id: t.id, label: t.label }));
        const old = Array.isArray(s.biomassTypes) ? s.biomassTypes : [];
        for (const d of Store.all('deliveries')) {
          const id = d.biomassType;
          if (!id || list.some((t) => t.id === id)) continue;
          const was = old.find((t) => t && t.id === id);
          list.push({ id, label: was ? was.label : VH.prettyType(id) });
        }
        // Written without touching the "last changed" time: a tidy-up on one
        // device must never count as newer than the settings an administrator saved.
        s.biomassTypes = list;
        s.biomassTypesRev = 2;
        Store.save('types-migrate');
      }
      return (Store.settings().biomassTypes || []).filter((t) => t && t.id && t.label);
    },
    typeLabel(id) {
      const t = VH.biomassTypes().find((x) => x.id === id);
      return t ? t.label : VH.prettyType(id);
    },
    /** Returns the new type, or { error } when the name is empty or taken. */
    addBiomassType(name) {
      const label = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!label) return { error: 'Type a name for the biomass type' };
      const list = VH.biomassTypes();
      if (list.some((t) => t.label.toLowerCase() === label.toLowerCase())) return { error: `${label} is already in the list` };
      let id = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `TYPE_${Date.now().toString(36).toUpperCase()}`;
      while (list.some((t) => t.id === id)) id += '_2';
      const type = { id, label };
      Store.patchSettings({ biomassTypes: list.concat([type]) });
      VH.audit('settings.type.add', 'settings', id, `Biomass type added: ${label}`);
      return type;
    },
    removeBiomassType(id) {
      const list = VH.biomassTypes();
      if (list.length <= 1) return { error: 'Keep at least one biomass type' };
      const t = list.find((x) => x.id === id);
      Store.patchSettings({ biomassTypes: list.filter((x) => x.id !== id) });
      VH.audit('settings.type.remove', 'settings', id, `Biomass type removed: ${t ? t.label : id}`);
      return {};
    },
    /** Small dialog used from Receive biomass and from settings. */
    addTypeDialog(onAdded) {
      UI.modal({
        title: 'Add a biomass type',
        size: 'sm',
        body: `<div class="form-errors" role="alert"></div>
          ${UI.field('Name', UI.input('typeName', { placeholder: 'Ipil Ipil, coconut shell…' }), 'It appears in the list when a truck is received.')}`,
        footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="add">Add type</button>',
        onMount(el, close) {
          const go = () => {
            const res = VH.addBiomassType(el.querySelector('[name=typeName]').value);
            if (res.error) { UI.showErrors(el, [res.error]); return; }
            UI.toast(`${res.label} added`, 'ok');
            close();
            if (onAdded) onAdded(res);
          };
          el.querySelector('[data-act=add]').addEventListener('click', go);
          el.querySelector('[name=typeName]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        },
      });
    },

    /** Money actually payable for a delivery (after any deduction). */
    payable(d) {
      if (!d) return 0;
      if (d.payableAmount !== undefined && d.payableAmount !== null) return Number(d.payableAmount) || 0;
      const p = VH.paymentFor(d.id);
      if (p) return Number(p.netAmount) || 0;
      return (d.fillCheck && Number(d.fillCheck.amount)) || 0;
    },

    moistureBadge(pct) {
      if (pct === null || pct === undefined) return '<span class="muted">—</span>';
      const band = D.moistureBand(pct, Store.settings());
      return badge(`${pct}% · ${D.MOISTURE_LABEL[band]}`, D.moistureTone(band));
    },

    /**
     * The moisture scale: bag weight read against the site line
     * (18 kg = 20 %, 36 kg = 60 %). Used wherever a bag is weighed.
     */
    moistureScale(bagKg, opts) {
      const s = Store.settings();
      const o = opts || {};
      const max = 80;
      const warn = Number(s.moistureWarnPct) || 30;
      const high = D.moistureHighPct(s);
      const pct = bagKg ? D.moistureFromWeight(bagKg, s) : null;
      const band = D.moistureBand(pct, s);
      const pos = (v) => Math.max(0, Math.min(100, (v / max) * 100));
      const ticks = [20, warn, high, 60].filter((v, i, a) => a.indexOf(v) === i && v < max).sort((a, b) => a - b);
      return `<div class="mscale ${o.compact ? 'compact' : ''}" role="img" aria-label="${pct === null ? 'No bag weight yet' : `Moisture ${pct} percent, ${D.MOISTURE_LABEL[band]}`}">
        <div class="mscale-read">
          <span class="mscale-pct t-${D.moistureTone(band)}">${pct === null ? '—' : `${pct}%`}</span>
          <span class="mscale-cap">${pct === null ? 'moisture, from bag weight' : `moisture · ${esc(D.MOISTURE_LABEL[band])}${bagKg ? ` · ${esc(bagKg)} kg per bag` : ''}`}</span>
        </div>
        <div class="mscale-track">
          <span class="mz mz-ok" style="width:${pos(warn)}%"></span>
          <span class="mz mz-warn" style="width:${pos(high) - pos(warn)}%"></span>
          <span class="mz mz-high" style="width:${100 - pos(high)}%"></span>
          ${pct === null ? '' : `<span class="mscale-pin" style="left:${pos(pct)}%"></span>`}
        </div>
        <div class="mscale-ticks">${ticks.map((t) => `<span style="left:${pos(t)}%"><b>${t}%</b>${D.weightForMoisture(t, s)} kg</span>`).join('')}</div>
      </div>`;
    },

    printHeader(title, meta) {
      return `<div class="row print-head"><img class="print-logo" src="assets/enerfab-logo.png" alt="EnerFab" /><div class="print-title">
          <div class="co">EnerFab (Pvt) Ltd · Green Engineering</div>
          <h1>${esc(title)}</h1>
          <div class="meta">${esc(meta || '')}</div>
        </div><div style="text-align:right" class="meta">
          ${esc(Store.settings().siteName)}<br/>${esc(Store.settings().siteLocation)}<br/>Printed ${esc(dt(new Date().toISOString()))}
        </div></div><hr/>`;
    },
  };
  window.VH = VH;

  /* ============================== DASHBOARD ========================== */
  App.register('dashboard', {
    title: 'Dashboard',
    render(view) {
      const bags = Store.all('bags');
      const deliveries = Store.all('deliveries');
      const accepted = deliveries.filter((d) => d.status === 'ACCEPTED');
      const last30 = accepted.filter((d) => Date.now() - Date.parse(d.acceptedAt || d.deliveredAt) < 30 * 864e5);
      const netIn = last30.reduce((a, d) => a + (d.netKg || 0), 0);
      const bagsIn = last30.reduce((a, d) => a + (d.bagCount || 0), 0);

      const usage = Store.all('usageRequests').filter((u) => u.status === 'CONSUMED');
      const last7 = usage.filter((u) => Date.now() - Date.parse(u.consumedAt) < 7 * 864e5);
      const kgOut = last7.reduce((a, u) => a + (u.totalKg || 0), 0);
      const bagsOut = last7.reduce((a, u) => a + (u.bags || 0), 0);

      const awaiting = deliveries.filter((d) => d.status === 'AWAITING_ACCEPTANCE');
      const pendingPay = Store.all('payments').filter((p) => ['DRAFT', 'PENDING_SUPERVISOR', 'APPROVED'].includes(p.status));
      const pendingValue = pendingPay.reduce((a, p) => a + (p.netAmount || 0), 0);
      const openQuality = Store.all('qualityIssues').filter((q) => q.status === 'OPEN');
      const pendingUsage = Store.all('usageRequests').filter((u) => u.status === 'PENDING');

      const bays = Store.where('bays', (b) => !b.deleted).map((b) => ({ ...b, count: VH.bagsInBay(b.id) }));

      // "Waiting for you": only the jobs this person's role can actually do.
      const alerts = VH.myTasks();

      const capacity = bays.reduce((a, b) => a + (b.capacityBags || 0), 0);
      // in the yard = what the bays hold (serials or not)
      const inYard = bays.reduce((a, b) => a + b.count, 0);
      const yardPct = capacity ? Math.min(100, Math.round((inYard / capacity) * 100)) : 0;

      view.innerHTML = `
        <section class="hero nm-card">
          <div class="hero-main">
            <p class="hero-date">${esc(dOnly(new Date().toISOString()))}, ${esc(Store.settings().siteLocation)}</p>
            <h2>${esc(greeting())}, ${esc((Auth.current().name || '').split(' ')[0] || 'team')}</h2>
            <div class="hero-actions">
              ${Auth.can('delivery.create') ? '<button class="nm-btn primary" data-quick="intake"><i class="i i-plus"></i>Receive biomass</button>' : ''}
              ${Auth.can('usage.approve') ? '<button class="nm-btn" data-quick="gasifier"><i class="i i-flame"></i>Approve gasifier request</button>' : ''}
              ${!Auth.can('usage.approve') && (Auth.can('usage.consume') || Auth.can('usage.request')) ? `<button class="nm-btn ${Auth.can('delivery.create') ? '' : 'primary'}" data-quick="gasifier"><i class="i i-flame"></i>Gasifier</button>` : ''}
              ${!Auth.can('delivery.create') && Auth.can('payment.release') ? '<button class="nm-btn primary" data-quick="payments">Payments</button>' : ''}
              ${App.canSee('reports') ? '<button class="nm-btn" data-quick="reports"><i class="i i-chart"></i>Reports</button>' : ''}
            </div>
          </div>
          <div class="hero-yard">
            <span class="hero-yard-label">In the yard now</span>
            <strong class="hero-yard-value">${inYard.toLocaleString()}<small>bags</small></strong>
            <div class="meter on-dark"><span style="width:${yardPct}%"></span></div>
            <span class="hero-yard-sub">${yardPct}% of ${capacity.toLocaleString()} bag capacity, ${bays.filter((b) => b.count > 0).length} of ${bays.length} bays in use</span>
          </div>
        </section>

        <section class="tasks">
          <h3>Waiting for you</h3>
          ${alerts.length ? `<div class="alerts">${alerts.map((a) => `
            <button class="alert-chip nm-card tone-${a.tone}" data-quick="${a.nav}">
              <span class="alert-dot"></span><span>${esc(a.text)}</span>${UI.icon('chevron', 'chev')}
            </button>`).join('')}</div>` : '<p class="muted tasks-none">Nothing is waiting for you right now.</p>'}
        </section>

        <section class="stats">
          ${UI.stat('Received, last 30 days', `${(netIn / 1000).toFixed(1)} t`, `${bagsIn.toLocaleString()} bags accepted`)}
          ${UI.stat('Into the gasifier, last 7 days', `${(kgOut / 1000).toFixed(2)} t`, `${bagsOut} bags weighed out`)}
          ${App.canSee('payments') ? UI.stat('Payments in progress', money(pendingValue), `${pendingPay.length} awaiting action`, pendingPay.length ? 'warn' : null) : ''}
          ${App.canSee('returns') || App.canSee('bags') ? (() => {
            const bs = VH.bagStore();
            return UI.stat('Empty bags in the store', Math.max(0, bs.used + bs.new).toLocaleString(), `${Math.max(0, bs.used).toLocaleString()} used, ${Math.max(0, bs.new).toLocaleString()} new`, bs.started && bs.low ? 'danger' : null);
          })() : ''}
        </section>

        <section class="cols-2">
          <div class="nm-card pad">
            <div class="card-head"><h3>Stock by bay</h3>${App.canSee('bays') ? '<button class="link" data-quick="bays">Manage bays</button>' : ''}</div>
            ${bays.map((b) => {
              const pctFull = Math.min(100, Math.round((b.count / (b.capacityBags || 900)) * 100));
              return `<div class="bay-row">
                <div class="bay-row-head"><b>${esc(b.code)}</b><span class="muted">${b.count.toLocaleString()} / ${(b.capacityBags || 0).toLocaleString()} bags</span></div>
                <div class="meter"><span style="width:${pctFull}%"></span></div>
              </div>`;
            }).join('') || '<p class="muted">No bays configured.</p>'}
          </div>

          <div class="nm-card pad">
            <div class="card-head"><h3>Latest movements</h3>${App.canSee('deliveries') ? '<button class="link" data-quick="deliveries">All deliveries</button>' : ''}</div>
            <ul class="timeline">
              ${movements().map((m) => `<li>
                <span class="tl-dot tone-${m.tone}"></span>
                <div><b>${esc(m.title)}</b><div class="muted small">${esc(m.sub)}</div></div>
                <span class="muted small">${esc(m.when)}</span>
              </li>`).join('') || '<li class="muted">No movements yet.</li>'}
            </ul>
          </div>
        </section>

        ${App.canSee('trace') ? `<section class="nm-card pad quick-trace">
          <div>
            <h3>Trace a bag</h3>
            <p class="muted">Type the number on the tag to see its supplier, bay and gasifier run.</p>
          </div>
          <form class="trace-search" id="dash-trace">
            <input class="nm-input" id="dash-trace-input" placeholder="${esc(Store.settings().bagSerialPrefix)}-000302" autocomplete="off" aria-label="Bag serial" />
            <button class="nm-btn primary" type="submit">Trace</button>
          </form>
        </section>` : ''}`;

      UI.$$('[data-quick]', view).forEach((b) => b.addEventListener('click', () => App.navigate(b.dataset.quick)));
      const dashTrace = view.querySelector('#dash-trace');
      if (dashTrace) dashTrace.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = view.querySelector('#dash-trace-input').value.trim();
        App.navigate('trace', () => {
          const inp = document.getElementById('trace-input');
          if (inp && val) { inp.value = val; document.getElementById('trace-go').click(); }
        });
      });
    },
  });

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function movements() {
    const items = [];
    for (const d of Store.all('deliveries').slice(-6)) {
      items.push({
        at: d.acceptedAt || d.deliveredAt, tone: d.status === 'ACCEPTED' ? 'ok' : 'warn',
        title: `${d.receiptNo}, ${d.bagCount} bags in`, sub: `${supplierName(d.supplierId)}, ${statusLabel(d.status).toLowerCase()}${d.deductionPct ? `, ${d.deductionPct}% deducted` : ''}`,
      });
    }
    for (const u of Store.all('usageRequests').filter((x) => x.status === 'CONSUMED').slice(-6)) {
      items.push({
        at: u.consumedAt, tone: 'info', title: `${u.bags} bags to gasifier`,
        sub: `${u.bayCode}, ${u.avgBagKg} kg average, moisture ${u.moisturePct}%`,
      });
    }
    return items.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0)).slice(0, 8)
      .map((m) => ({ ...m, when: dOnly(m.at) }));
  }

  const supplierName = (id) => (Store.byId('suppliers', id) || {}).name || '—';
  /** REJECTED only exists on records made before loads stopped being turned away. */
  const STATUS_LABEL = { AWAITING_ACCEPTANCE: 'Waiting to be accepted', ACCEPTED: 'Accepted', REJECTED: 'Sent back (old record)' };
  const statusLabel = (st) => STATUS_LABEL[st] || String(st || '').replace(/_/g, ' ');
  const statusTone = (st) => (st === 'ACCEPTED' ? 'ok' : st === 'REJECTED' ? 'muted' : 'warn');

  /* =============================== INTAKE ============================ */
  App.register('intake', {
    title: 'Receive biomass',
    perm: 'delivery.create',
    render(view) {
      const s = Store.settings();
      view.innerHTML = `
        <form id="intake-form" class="intake" novalidate>
          <div class="form-errors" role="alert"></div>

          <section class="nm-card pad">
            <div class="step-head"><span class="step-no">1</span><div><h3>Who delivered?</h3>
              <p class="muted small">Find the supplier, then enter the vehicle and driver.</p></div></div>
            <div class="supplier-pick">
              <input class="nm-input" id="sup-find" type="search" placeholder="Search supplier by name, code, phone or village" autocomplete="off" aria-label="Search suppliers" />
              ${Auth.can('supplier.write') ? '<button type="button" class="nm-btn" id="sup-new"><i class="i i-plus"></i>New supplier</button>' : ''}
            </div>
            <div class="grid-3">
              ${UI.field('Supplier', UI.select('supplierId', VH.supplierOptions(), { required: true, placeholder: 'Select supplier…' }), '<span id="sup-count"></span>')}
              ${UI.field('Biomass type', UI.select('biomassType', VH.biomassTypes().map((t) => ({ value: t.id, label: t.label })), { required: true }),
                Auth.can('settings.write') ? '<button type="button" class="link" id="add-type"><i class="i i-plus"></i>Add another type</button>' : '')}
              ${UI.field('Vehicle number', UI.input('vehicleNo', { placeholder: 'SG LH-4521', required: true }))}
              ${UI.field('Driver name', UI.input('driverName', { placeholder: 'Full name', required: true }))}
              ${UI.field('Driver NIC', UI.input('driverNic', { placeholder: '781234567V' }))}
              ${UI.field('Weighbridge slip no.', UI.input('weighbridgeSlip', { placeholder: 'WB-8893' }))}
            </div>
          </section>

          <section class="nm-card pad">
            <div class="step-head"><span class="step-no">2</span><div><h3>Weighing and bag count</h3>
              <p class="muted small">Type the weighbridge readings and count the bags. The app works out how wet the biomass is from the bag weight.</p></div></div>
            <div class="grid-4">
              ${UI.field('Truck full, gross (kg)', UI.input('grossKg', { type: 'number', min: 0, step: '0.01', required: true }))}
              ${UI.field('Truck empty, tare (kg)', UI.input('tareKg', { type: 'number', min: 0, step: '0.01', required: true }))}
              ${UI.field('Biomass weight, net (kg)', UI.input('netKg', { readonly: true, value: '' }))}
              ${UI.field('Bags counted', UI.input('bagCount', { type: 'number', min: 1, max: s.maxBagsPerDelivery, required: true }))}
            </div>
            <div class="weigh-out" id="weigh-out"></div>
          </section>

          <section class="nm-card pad">
            <div class="step-head"><span class="step-no">3</span><div><h3>Random fill check</h3>
              <p class="muted small">Empty ${s.sampleSizePct} bags in every 100 into the drum and type how full each one was (%). Type them all. Full price only if the bags are 100% full; below that the price follows the fill.</p></div></div>
            <div class="row-actions" style="margin:0 0 14px">
              <button type="button" class="nm-btn" id="print-fill-sheet"><i class="i i-printer"></i>Print a blank sheet to fill in by hand</button>
              <span class="muted small">Write the readings on paper at the drum, then type them in here.</span>
            </div>
            <div class="fill-check">
              <div class="fill-inputs" id="fill-inputs"></div>
              <div class="fill-result nm-inset" id="fill-result"></div>
            </div>
            <div class="grid-2" style="margin-top:12px">
              ${UI.field('Price', UI.select('outcome', [
                { value: 'AUTO', label: 'Use the fill check result' },
                { value: 'OVERRIDE_FULL_PRICE', label: 'Pay the full price anyway (write why)' },
              ], { value: 'AUTO' }))}
              ${UI.field('Note', UI.input('fillNote', { placeholder: 'Needed only when paying the full price anyway' }))}
            </div>
            <p class="muted small">No truck is sent away. If the supplier fills the bags more, count and check them again. If the bags are not filled fully, the supervisor can take a percent off when accepting.</p>
          </section>

          <section class="nm-card pad">
            <div class="step-head"><span class="step-no">4</span><div><h3>Bag numbers (only if the bags have them)</h3>
              <p class="muted small">Scan or type the numbers on the bag stickers. A range works too: <code>EFPL-BG-000301-000480</code>. You can leave this empty.</p></div></div>
            ${UI.field('Bag numbers on this truck', UI.textarea('serialsText', { rows: 3, placeholder: 'EFPL-BG-000301-000480   (or one serial per line)' }))}
            <div id="serial-preview" class="calc-strip"></div>
            ${UI.field('Notes', UI.textarea('notes', { rows: 2, placeholder: 'Anything the supervisor should know' }))}
          </section>

          <div class="intake-actions">
            <button type="button" class="nm-btn" id="cancel-intake">Clear</button>
            <span class="intake-spacer"></span>
            <button type="button" class="nm-btn" id="step-back">Back</button>
            <button type="button" class="nm-btn primary" id="step-next">Next</button>
            <button type="submit" class="nm-btn primary" id="step-submit">Register delivery</button>
          </div>
        </form>`;

      const form = view.querySelector('#intake-form');
      const s2 = Store.settings();
      let fills = [];
      let registered = false;

      const bagCountEl = form.querySelector('[name=bagCount]');
      const grossEl = form.querySelector('[name=grossKg]');
      const tareEl = form.querySelector('[name=tareKg]');
      const netEl = form.querySelector('[name=netKg]');

      function renderFillInputs() {
        const count = Number(bagCountEl.value) || 0;
        const sample = D.sampleSizeFor(count || 1, s2);
        const wrap = form.querySelector('#fill-inputs');
        const done = fills.slice(0, sample).filter((n) => Number.isFinite(n)).length;
        wrap.innerHTML = `<div class="fill-head">Sample: <b>${sample}</b> bag(s)
            <span class="muted small">(${s2.sampleSizePct}% of ${count || 0} bags)</span>
            <span class="fill-progress ${done === sample ? 't-ok' : 't-warn'}" id="fill-progress">${done} of ${sample} entered</span></div>
          <div class="fill-grid">${Array.from({ length: sample }, (_, i) => `
            <label class="fill-cell"><span>#${i + 1}</span>
              <input class="nm-input" type="number" min="0" max="150" step="0.1" data-fill="${i}"
                value="${fills[i] !== undefined ? fills[i] : ''}" placeholder="%" /></label>`).join('')}</div>`;
        wrap.querySelectorAll('[data-fill]').forEach((el) => el.addEventListener('input', () => {
          fills[Number(el.dataset.fill)] = el.value === '' ? undefined : Number(el.value);
          const n = fills.slice(0, sample).filter((v) => Number.isFinite(v)).length;
          const prog = wrap.querySelector('#fill-progress');
          if (prog) { prog.textContent = `${n} of ${sample} entered`; prog.className = `fill-progress ${n === sample ? 't-ok' : 't-warn'}`; }
          updateFill();
        }));
      }
      /** How many of the required sample readings are still missing. */
      const fillsMissing = () => {
        const sample = D.sampleSizeFor(Number(bagCountEl.value) || 1, s2);
        return sample - fills.slice(0, sample).filter((n) => Number.isFinite(n)).length;
      };

      function updateWeigh() {
        const g = Number(grossEl.value), t = Number(tareEl.value), count = Number(bagCountEl.value);
        const res = D.weighTruck(g, t);
        const out = form.querySelector('#weigh-out');
        const started = grossEl.value !== '' && tareEl.value !== '';
        if (!res.ok) {
          netEl.value = '';
          out.innerHTML = `<div class="calc-strip"><span class="${started ? 't-warn' : 'muted'}">${esc(started ? res.msg : 'Enter the gross and tare readings.')}</span></div>${VH.moistureScale(null)}`;
          return;
        }
        netEl.value = res.netKg;
        const perBag = D.avgBagWeight(res.netKg, count);
        out.innerHTML = `
          <div class="calc-strip">
            <div><span class="muted small">Net weight</span><b>${kg(res.netKg)}</b></div>
            <div><span class="muted small">Average per bag</span><b>${perBag ? `${perBag} kg` : 'enter the bag count'}</b></div>
          </div>
          ${VH.moistureScale(perBag)}`;
      }

      function updateFill() {
        const count = Number(bagCountEl.value) || 0;
        const valid = fills.filter((n) => Number.isFinite(n));
        const outcome = form.querySelector('[name=outcome]').value;
        const r = D.evaluateFillCheck({ bagCount: count, fills: valid, settings: s2, outcome: outcome === 'AUTO' ? null : outcome });
        const box = form.querySelector('#fill-result');
        const tone = r.decision === 'NOT_CHECKED' ? 'muted' : r.decision === 'PASS' || r.decision === 'OVERRIDDEN' ? 'ok' : 'warn';
        box.innerHTML = `
          <div class="fill-big ${tone}">${r.avgFillPct === null ? '—' : `${r.avgFillPct}%`}</div>
          <div class="muted small">average fill of ${valid.length} sample bag(s)</div>
          <div class="fill-table">
            <div><span>Price per bag</span><b>${money(r.payPerBag)}</b></div>
            <div><span>Full price</span><b>${money(r.fullPrice)}</b></div>
            <div><span>Value of this load</span><b>${money(r.amount)}</b></div>
            <div><span>Lowest to highest</span><b>${r.spread === null ? '—' : `${r.spread.toFixed(1)}%`}</b></div>
          </div>
          <p class="fill-action tone-${tone}">${esc(r.action)}</p>`;
      }

      function updateSerials() {
        const prefix = Store.settings().bagSerialPrefix;
        const list = VH.parseSerials(form.querySelector('[name=serialsText]').value, prefix);
        const count = Number(bagCountEl.value) || 0;
        const box = form.querySelector('#serial-preview');
        if (!list.length) { box.innerHTML = '<span class="muted">No bag numbers. That is fine.</span>'; return; }
        const known = Store.all('bags');
        const unknown = list.filter((sn) => !known.some((b) => b.serial === sn));
        const mismatch = count && list.length !== count;
        box.innerHTML = `<div><span class="muted small">Serials captured</span><b>${list.length}</b></div>
          <div><span class="muted small">Bags counted</span><b>${count || '—'}</b></div>
          <div><span class="muted small">Not in the bag registry</span><b class="${unknown.length ? 't-warn' : 't-ok'}">${unknown.length}</b></div>
          ${mismatch ? `<div class="t-warn"><span class="muted small"><i class="i i-alert"></i>Count</span><b>${list.length - count > 0 ? '+' : ''}${list.length - count} vs bag count</b></div>` : ''}`;
      }

      bagCountEl.addEventListener('input', () => { fills = []; renderFillInputs(); updateWeigh(); updateFill(); updateSerials(); });
      grossEl.addEventListener('input', updateWeigh);
      tareEl.addEventListener('input', updateWeigh);
      form.querySelector('[name=outcome]').addEventListener('change', updateFill);
      form.querySelector('[name=serialsText]').addEventListener('input', UI.debounce(updateSerials, 250));
      form.querySelector('#cancel-intake').addEventListener('click', () => { form.reset(); fills = []; renderFillInputs(); updateWeigh(); updateFill(); updateSerials(); });

      renderFillInputs(); updateWeigh(); updateFill(); updateSerials();

      const addType = form.querySelector('#add-type');
      if (addType) addType.addEventListener('click', () => VH.addTypeDialog((type) => {
        // add the new type to the list in place, so nothing already typed is lost
        const sel = form.querySelector('[name=biomassType]');
        const opt = document.createElement('option');
        opt.value = type.id; opt.textContent = type.label;
        sel.appendChild(opt);
        sel.value = type.id;
      }));

      /* One step on screen at a time: who, weight, fill check, bags. */
      const steps = UI.$$(':scope > section', form);
      const STEP_NAMES = ['Supplier', 'Weight', 'Fill check', 'Bags'];
      const stepper = document.createElement('ol');
      stepper.className = 'stepper';
      form.insertBefore(stepper, steps[0]);
      let step = 0;
      const checkStep = (i) => {
        const d = UI.formData(form);
        if (i === 0) {
          if (!d.supplierId) return 'Choose who delivered the biomass';
          if (!d.vehicleNo) return 'Enter the vehicle number';
          if (!d.driverName) return 'Enter the driver name';
        }
        if (i === 1) {
          const w = D.weighTruck(d.grossKg, d.tareKg);
          if (!w.ok) return w.msg;
          if (!d.bagCount || d.bagCount < 1) return 'Enter the number of bags counted';
        }
        if (i === 2) {
          const missing = fillsMissing();
          if (missing > 0) return `Enter the fill height for every sample bag: ${missing} still missing`;
          if (d.outcome === 'OVERRIDE_FULL_PRICE' && !d.fillNote) return 'Write the reason for paying the full price';
        }
        return '';
      };
      const showStep = (i, quiet) => {
        step = Math.max(0, Math.min(steps.length - 1, i));
        steps.forEach((s, k) => { s.hidden = k !== step; });
        stepper.innerHTML = steps.map((_, k) => `<li class="${k === step ? 'on' : k < step ? 'done' : ''}"><button type="button" data-step="${k}"><b>${k + 1}</b><span>${STEP_NAMES[k] || ''}</span></button></li>`).join('');
        UI.$$('[data-step]', stepper).forEach((b) => b.addEventListener('click', () => goTo(Number(b.dataset.step))));
        form.querySelector('#step-back').hidden = step === 0;
        form.querySelector('#step-next').hidden = step === steps.length - 1;
        form.querySelector('#step-submit').hidden = step !== steps.length - 1;
        if (!quiet) window.scrollTo(0, 0);
      };
      const goTo = (target) => {
        // going forward, every step on the way must be complete
        for (let k = step; k < target; k++) {
          const msg = checkStep(k);
          if (msg) { showStep(k); UI.showErrors(form, [msg]); UI.toast(msg, 'warn'); return; }
        }
        UI.showErrors(form, []);
        showStep(target);
      };
      form.querySelector('#step-next').addEventListener('click', () => goTo(step + 1));
      form.querySelector('#step-back').addEventListener('click', () => goTo(step - 1));
      form.querySelector('#cancel-intake').addEventListener('click', () => { UI.showErrors(form, []); showStep(0); });
      showStep(0, true);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        // Enter on the keyboard moves to the next step; only the last step registers.
        if (step < steps.length - 1) { goTo(step + 1); return; }
        const data = UI.formData(form);
        const errors = [];
        if (!data.supplierId) errors.push({ field: 'Supplier', msg: 'Choose who delivered the biomass' });
        if (!data.vehicleNo) errors.push({ field: 'Vehicle', msg: 'Required' });
        if (!data.driverName) errors.push({ field: 'Driver', msg: 'Required' });
        const w = D.weighTruck(data.grossKg, data.tareKg);
        if (!w.ok) errors.push({ field: 'Weight', msg: w.msg });
        if (!data.bagCount || data.bagCount < 1) errors.push({ field: 'Bags', msg: 'Enter the number of bags counted' });
        if (data.bagCount > Store.settings().maxBagsPerDelivery) errors.push({ field: 'Bags', msg: `More than ${Store.settings().maxBagsPerDelivery} bags — split the delivery` });        if (data.outcome === 'OVERRIDE_FULL_PRICE' && !data.fillNote) errors.push({ field: 'Reason', msg: 'A written reason is required to override the price' });
        if (data.bagCount >= 1 && fillsMissing() > 0) errors.push({ field: 'Fill check', msg: `Enter the fill height for every sample bag: ${fillsMissing()} still missing` });
        UI.showErrors(form, errors);
        if (errors.length) {
          const first = [0, 1, 2].find((k) => checkStep(k));
          if (first !== undefined) showStep(first);
          UI.toast(errors[0].msg, 'danger');
          return;
        }

        const validFills = fills.slice(0, D.sampleSizeFor(data.bagCount, Store.settings())).filter((n) => Number.isFinite(n));
        const fillCheck = D.evaluateFillCheck({
          bagCount: data.bagCount, fills: validFills, settings: Store.settings(),
          outcome: data.outcome === 'AUTO' ? null : data.outcome,
        });
        const prefix = Store.settings().bagSerialPrefix;
        const serials = VH.parseSerials(data.serialsText, prefix);
        const receiptNo = 'RC-' + new Date().getFullYear() + '-' + String(Store.nextSeq('receipt', 1)).padStart(4, '0');

        const delivery = Store.add('deliveries', {
          receiptNo, supplierId: data.supplierId, biomassType: data.biomassType,
          vehicleNo: data.vehicleNo.toUpperCase(), driverName: data.driverName,
          driverNic: data.driverNic || '', weighbridgeSlip: data.weighbridgeSlip || '',
          grossKg: Number(data.grossKg), tareKg: Number(data.tareKg), netKg: w.netKg,
          bagCount: data.bagCount, avgBagKg: D.avgBagWeight(w.netKg, data.bagCount),
          fillCheck, serials, allocations: [],
          status: 'AWAITING_ACCEPTANCE',
          deliveredAt: new Date().toISOString(),
          receivedBy: Auth.current().email,
          notes: data.notes || '', fillNote: data.fillNote || '',
        }, 'delivery-create');

        VH.audit('delivery.create', 'delivery', delivery.id, `${receiptNo} · ${data.bagCount} bags · ${supplierName(delivery.supplierId)}`);
        // the load is registered: its draft must never come back
        registered = true;
        try { localStorage.removeItem(intakeDraftKey()); } catch { /* ignore */ }
        UI.toast(`Delivery ${receiptNo} registered`, 'ok');
        // Whoever may accept goes straight on to choosing the bays; anyone
        // else sees the delivery waiting for the supervisor.
        const canAccept = Auth.can('delivery.accept');
        App.navigate('deliveries', () => setTimeout(() => (canAccept ? App.acceptFlow(delivery.id) : App.openDelivery(delivery.id)), 120));
      });

      /* supplier search + add */
      const supSel = form.querySelector('[name=supplierId]');
      const supFind = form.querySelector('#sup-find');
      const fillSuppliers = (keep) => {
        const q = supFind.value.trim().toLowerCase();
        const all = Store.where('suppliers', (x) => !x.deleted && x.status !== 'INACTIVE').slice().sort((a, b) => a.name.localeCompare(b.name));
        const list = q ? all.filter((x) => `${x.code} ${x.name} ${x.phone || ''} ${x.address || ''} ${x.nic || ''}`.toLowerCase().includes(q)) : all;
        const cur = keep || supSel.value;
        supSel.innerHTML = `<option value="">${list.length ? 'Select supplier…' : 'No supplier matches'}</option>`
          + list.map((x) => `<option value="${esc(x.id)}">${esc(`${x.code} · ${x.name}${x.address ? ` (${x.address})` : ''}`)}</option>`).join('');
        if (list.some((x) => x.id === cur)) supSel.value = cur;
        else if (q && list.length === 1) supSel.value = list[0].id;       // one match: take it
        form.querySelector('#sup-count').textContent = q ? `${list.length} of ${all.length} suppliers match` : `${all.length} suppliers`;
      };
      supFind.addEventListener('input', () => fillSuppliers());
      supFind.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
      fillSuppliers();
      const supNew = form.querySelector('#sup-new');
      if (supNew) supNew.addEventListener('click', () => App.editSupplier(null, (rec) => { supFind.value = ''; fillSuppliers(rec.id); }));

      /* Draft: what has been typed is kept on this device until the load is
         registered or cleared. Printing on a phone or tablet sends the
         browser to the background, and the phone often reloads the page on
         the way back; a reload, a sign-in refresh or leaving the screen must
         not cost the gate a half-entered truck. */
      const draftKey = intakeDraftKey();
      const saveDraft = () => {
        if (registered) return;
        const values = {};
        UI.$$('[name]', form).forEach((el) => { if (el.name) values[el.name] = el.value; });
        values.supFind = supFind.value;
        const typed = Object.keys(values).some((k) => k !== 'outcome' && k !== 'biomassType' && k !== 'netKg' && String(values[k] || '').trim() !== '');
        try {
          if (typed || fills.some((n) => Number.isFinite(n))) localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), step, values, fills }));
          else localStorage.removeItem(draftKey);
        } catch { /* private window: nothing more can be done */ }
      };
      const saveSoon = UI.debounce(saveDraft, 250);
      form.addEventListener('input', saveSoon);
      form.addEventListener('change', saveSoon);
      form.addEventListener('click', (e) => { if (e.target.closest('#step-next, #step-back, [data-step]')) setTimeout(saveDraft, 0); });
      form.querySelector('#cancel-intake').addEventListener('click', () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } });
      const onHide = () => {
        if (document.body.contains(form)) { if (!registered) saveDraft(); return; }
        window.removeEventListener('pagehide', onHide);          // the screen has gone: stop listening
        document.removeEventListener('visibilitychange', onHide);
      };
      window.addEventListener('pagehide', onHide);
      document.addEventListener('visibilitychange', onHide);

      let draft = null;
      try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { draft = null; }
      if (draft && draft.values && Date.now() - (draft.at || 0) < 3 * 864e5) {
        const v = draft.values;
        if (v.supFind) { supFind.value = v.supFind; fillSuppliers(v.supplierId); }
        UI.$$('[name]', form).forEach((el) => {
          if (el.name in v && el.name !== 'netKg' && v[el.name] !== undefined) el.value = v[el.name];
        });
        if (v.supplierId && [...supSel.options].some((o) => o.value === v.supplierId)) supSel.value = v.supplierId;
        fills = Array.isArray(draft.fills) ? draft.fills.map((n) => (n === null || n === undefined ? undefined : Number(n))) : [];
        renderFillInputs(); updateWeigh(); updateFill(); updateSerials();
        showStep(Number(draft.step) || 0, true);
        UI.toast('Your unfinished load is back where you left it', 'ok');
      }

      form.querySelector('#print-fill-sheet').addEventListener('click', () => {
        saveDraft();                       // before the browser leaves for the print screen
        Store.flush();
        const d = UI.formData(form);
        App.printFillSheet({ bagCount: d.bagCount, supplierId: d.supplierId, vehicleNo: d.vehicleNo, biomassType: d.biomassType });
      });
    },
  });

  /** One unfinished Receive form per person, per store (live or demo). */
  function intakeDraftKey() {
    const me = Auth.current() || {};
    return `efpl.intakeDraft.v1.${Store.space}.${String(me.email || me.uid || 'anyone').toLowerCase()}`;
  }

  /* ============================= DELIVERIES ========================== */
  App.register('deliveries', {
    title: 'Deliveries',
    render(view) {
      const rows = Store.all('deliveries').slice().sort((a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt));
      const pending = rows.filter((r) => r.status === 'AWAITING_ACCEPTANCE');

      view.innerHTML = `
        <div class="toolbar">
          <div class="seg" role="tablist">
            ${['All', 'Waiting to be accepted', 'Accepted'].map((t, i) => {
              const vals = ['ALL', 'AWAITING_ACCEPTANCE', 'ACCEPTED'];
              return `<button class="seg-btn ${i === 0 ? 'active' : ''}" data-filter="${vals[i]}">${t}${vals[i] === 'AWAITING_ACCEPTANCE' && pending.length ? ` <span class="count">${pending.length}</span>` : ''}</button>`;
            }).join('')}
          </div>
          <div class="toolbar-right">
            ${Auth.can('delivery.create') ? '<button class="nm-btn primary" id="new-delivery"><i class="i i-plus"></i>Receive biomass</button>' : ''}
          </div>
        </div>
        <div id="delivery-table"></div>`;

      const draw = (filter) => {
        const list = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter);
        view.querySelector('#delivery-table').innerHTML = UI.table({
          rows: list,
          empty: 'No deliveries recorded yet.',
          rowKey: (r) => r.id,
          columns: [
            { label: 'Receipt', render: (r) => `<b>${esc(r.receiptNo)}</b><div class="muted small">${esc(dOnly(r.deliveredAt))}</div>` },
            { label: 'Supplier', render: (r) => `${esc(supplierName(r.supplierId))}<div class="muted small">${esc(r.vehicleNo || '')}</div>` },
            { label: 'Type', render: (r) => esc(typeLabel(r.biomassType)) },
            { label: 'Bags', cls: 'num', render: (r) => (r.bagCount || 0).toLocaleString() },
            { label: 'Net kg', cls: 'num', render: (r) => (r.netKg || 0).toLocaleString() },
            { label: 'Fill check', render: (r) => fillBadge(r) },
            { label: 'Moisture', render: (r) => VH.moistureBadge(r.avgBagKg ? D.moistureFromWeight(r.avgBagKg, Store.settings()) : null) },
            { label: 'Deducted', cls: 'num', render: (r) => (r.deductionPct ? `<span class="t-danger">${r.deductionPct}%</span>` : '<span class="muted">—</span>') },
            { label: 'Status', render: (r) => badge(statusLabel(r.status), statusTone(r.status)) },
            { label: 'Payment', render: (r) => { const p = VH.paymentFor(r.id); return p ? badge(D.PAYMENT_LABEL[p.status] || p.status, UI.statusTone(p.status)) : '<span class="muted">—</span>'; } },
            { label: '', cls: 'actions', render: (r) => `<button class="nm-btn tiny" data-open="${r.id}">Open</button>` },
          ],
        });
        UI.$$('[data-open]', view).forEach((b) => b.addEventListener('click', () => App.openDelivery(b.dataset.open)));
      };
      draw('ALL');
      UI.$$('[data-filter]', view).forEach((b) => b.addEventListener('click', () => {
        UI.$$('[data-filter]', view).forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        draw(b.dataset.filter);
      }));
      const nd = view.querySelector('#new-delivery');
      if (nd) nd.addEventListener('click', () => App.navigate('intake'));
    },
  });

  const typeLabel = (id) => VH.typeLabel(id);

  function fillBadge(r) {
    const f = r.fillCheck;
    if (!f || f.avgFillPct === null || f.avgFillPct === undefined) return '<span class="muted">not checked</span>';
    const tone = f.decision === 'PASS' || f.decision === 'PASS_MARGINAL' || f.decision === 'OVERRIDDEN' ? 'ok' : 'warn';
    const word = f.decision === 'SHORT' ? `${f.cutPct}% off` : ({ PASS: 'full price', PASS_MARGINAL: 'full price', REDUCED_PRICE: 'lower price (old rule)', OVERRIDDEN: 'full price, by decision' }[f.decision] || 'lower price');
    return `${badge(`${f.avgFillPct}%`, tone)}<div class="muted small">${esc(word)}</div>`;
  }

  /* ---------------------- delivery detail + actions ------------------ */
  App.openDelivery = function (id) {
    const d = Store.byId('deliveries', id);
    if (!d) return UI.toast('Delivery not found', 'danger');
    const sup = Store.byId('suppliers', d.supplierId) || {};
    const p = VH.paymentFor(d.id);
    const allocRows = (d.allocations || []).map((a) => `<tr><td>${esc(a.bayCode)}</td><td class="num">${a.bags}</td></tr>`).join('');

    UI.modal({
      title: `Delivery ${d.receiptNo}`,
      size: 'lg',
      body: `
        <div class="detail-grid">
          <div class="nm-inset pad-sm">
            <h4>Supplier</h4>
            <p><b>${esc(sup.name || '—')}</b><br/><span class="muted">${esc(sup.code || '')} · ${esc(sup.phone || '')}</span></p>
            <h4>Vehicle</h4>
            <p>${esc(d.vehicleNo || '—')}<br/><span class="muted">${esc(d.driverName || '')} ${d.driverNic ? `· ${esc(d.driverNic)}` : ''}</span></p>
          </div>
          <div class="nm-inset pad-sm">
            <h4>Weighbridge</h4>
            <p>Gross ${kg(d.grossKg)} · Tare ${kg(d.tareKg)}<br/><b>Net ${kg(d.netKg)}</b></p>
            <h4>Bags</h4>
            <p>${(d.bagCount || 0).toLocaleString()} bags, ${d.avgBagKg ? `${d.avgBagKg} kg per bag` : '—'}</p>
            ${d.avgBagKg ? `<p>${VH.moistureBadge(D.moistureFromWeight(d.avgBagKg, Store.settings()))}</p>` : ''}
          </div>
          <div class="nm-inset pad-sm">
            <h4>Fill check</h4>
            ${d.fillCheck && d.fillCheck.avgFillPct !== null ? `
              <p><b class="big">${d.fillCheck.avgFillPct}%</b> average of ${d.fillCheck.fills.length} sample bags<br/>
              <span class="muted">${esc((d.fillCheck.fills || []).join(' · '))}</span></p>
              <p>Price per bag <b>${money(D.fillPayPerBag(d.fillCheck))}</b>${d.fillCheck.cutPct ? ` (${d.fillCheck.cutPct}% off for bags not full)` : ''}<br/>Value of the load <b>${money(d.fillCheck.amount)}</b></p>` : '<p class="muted">Not checked.</p>'}
            ${d.deductionPct ? `<p class="t-danger">Deducted <b>${d.deductionPct}%</b> (${money(d.deductionAmount)})<br/><span class="muted">${esc(d.deductionReason || '')}</span></p>
              <p>Payable <b>${money(VH.payable(d))}</b></p>` : ''}
          </div>
          <div class="nm-inset pad-sm">
            <h4>Allocation</h4>
            ${allocRows ? `<table class="mini"><thead><tr><th>Bay</th><th class="num">Bags</th></tr></thead><tbody>${allocRows}</tbody></table>` : '<p class="muted">No bay allocated yet.</p>'}
            <h4 style="margin-top:8px">Pay to</h4>
            ${VH.bankHtml(sup)}
          </div>
        </div>
        ${d.serials && d.serials.length ? `<p class="small muted">${d.serials.length} bag serial(s) captured, ${esc(d.serials[0])} → ${esc(d.serials[d.serials.length - 1])}</p>` : ''}
        ${d.notes ? `<p class="small"><b>Notes:</b> ${esc(d.notes)}</p>` : ''}
        ${d.rejectedReason ? `<p class="small muted"><b>Sent back at the time:</b> ${esc(d.rejectedReason)}</p>` : ''}
        <div class="detail-status">
          ${badge(statusLabel(d.status), statusTone(d.status))}
          ${p ? badge(`${p.paymentNo} · ${D.PAYMENT_LABEL[p.status]}`, UI.statusTone(p.status)) : ''}
        </div>`,
      footer: `
        <button class="nm-btn" data-act="print"><i class="i i-printer"></i>Print receipt</button>
        <button class="nm-btn" data-act="labels"><i class="i i-tag"></i>Print bag labels</button>
        ${['AWAITING_ACCEPTANCE', 'REJECTED'].includes(d.status) && Auth.can('delivery.accept') ? '<button class="nm-btn primary" data-act="accept">Accept and allocate bay</button>' : ''}
        ${d.status === 'ACCEPTED' ? '<button class="nm-btn" data-act="invoice"><i class="i i-printer"></i>Invoice</button>' : ''}
      `,
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          if (!btn) return;
          const act = btn.dataset.act;
          if (act === 'print') return App.printReceipt(d.id);
          if (act === 'labels') return App.printLabels(d.id);
          if (act === 'accept') { close(); return App.acceptFlow(d.id); }
          if (act === 'invoice') return App.printInvoice(d.id);
        });
      },
    });
  };

  /* ----------------------------- acceptance -------------------------- */
  App.acceptFlow = function (id) {
    const d = Store.byId('deliveries', id);
    if (!d) return;
    const s = Store.settings();
    const bays = Store.where('bays', (b) => !b.deleted);
    const prefix = s.bagSerialPrefix;
    const sup0 = Store.byId('suppliers', d.supplierId) || {};
    // Money is taken off only for bags not filled to capacity (never for
    // moisture). The fill check works out the percent: 100 % full is the full
    // price; 92 % full means 8 % off. It is filled in here, once, and the
    // supervisor can change it.
    const fc = d.fillCheck || {};
    const newRule = fc.cutPct !== undefined && fc.cutPct !== null;
    // checks made before the 100 % rule already carry their lower price
    const unitPrice = newRule ? (Number(fc.fullPrice) || s.unitPrice) : (Number(fc.unitPrice) || s.unitPrice);
    const fillAvg = Number.isFinite(Number(fc.avgFillPct)) && fc.avgFillPct !== null ? Number(fc.avgFillPct) : null;
    const suggestPct = newRule ? Number(fc.cutPct) || 0 : 0;
    const defaultReason = suggestPct && fillAvg !== null
      ? `Bags not filled fully: ${fillAvg}% full on average`
      : (s.defaultDeductionReason || 'Bags are not filled fully');
    const fillNote = fillAvg === null
      ? 'No fill check was recorded for this truck.'
      : `Fill check: <b>${fillAvg}%</b> full on average${(fc.fills || []).length ? ` (${fc.fills.length} bags checked)` : ''}. ${fc.decision === 'OVERRIDDEN'
        ? 'The full price is paid anyway, by decision.'
        : fillAvg >= D.FULL_FROM_PCT ? 'The bags are full: full price.'
          : newRule ? `Bags must be 100% full, so <b>${suggestPct}%</b> is filled in below.`
            : `This truck was checked under the old rule and is already paid at ${money(unitPrice)} a bag.`}`;

    // Start with a sensible split: empty bays first, then wherever there is room.
    const holds = new Map(bays.map((b) => [b.id, VH.bagsInBay(b.id)]));
    const room = (b) => Math.max(0, (Number(b.capacityBags) || 0) - holds.get(b.id));
    const plan = new Map();
    let left = d.bagCount;
    for (const b of bays.filter((x) => holds.get(x.id) === 0).concat(bays.filter((x) => holds.get(x.id) > 0))) {
      if (left <= 0) break;
      const take = Math.min(left, room(b));
      if (take > 0) { plan.set(b.id, take); left -= take; }
    }
    if (left > 0 && bays.length) plan.set(bays[0].id, (plan.get(bays[0].id) || 0) + left);   // nowhere has room: the supervisor decides

    UI.modal({
      title: `Accept ${d.receiptNo}`,
      size: 'lg',
      body: `
        <div class="form-errors" role="alert" id="accept-errors"></div>
        <p class="muted">Choose the bays for these <b>${d.bagCount}</b> bags. Empty bays are filled in for you; change any number. The total must be ${d.bagCount}.</p>
        ${bays.length ? '' : '<div class="banner banner-warn">There are no bays yet. Add them under Bays &amp; stock first.</div>'}
        <div class="alloc-grid" id="alloc-table">
          ${bays.map((b) => `<label class="alloc-cell ${plan.get(b.id) ? 'on' : ''}">
              <span class="alloc-code">${esc(b.code)}</span>
              <input class="nm-input" type="number" min="0" step="1" data-bay="${b.id}" value="${plan.get(b.id) || 0}" aria-label="Bags into ${esc(b.code)}" />
              <span class="alloc-room">${holds.get(b.id)} in, room for ${room(b)}</span>
            </label>`).join('')}
        </div>
        <p class="alloc-total">Total <b id="alloc-total">${d.bagCount}</b> of ${d.bagCount} <span id="alloc-hint" class="muted"></span></p>
        <h4>Pay to</h4>
        ${VH.bankEditor(sup0)}
        <h4>Bags not full: take money off</h4>
        <p class="muted small">Every truck is accepted. The bags must be 100% full for the full price; what is missing is taken off. Wetness is shown but never cuts the price.</p>
        <div class="fill-note ${fillAvg !== null && fillAvg < D.FULL_FROM_PCT && fc.decision !== 'OVERRIDDEN' ? 'is-low' : ''}">${fillNote}</div>
        <div class="grid-2" style="margin-top:12px">
          ${UI.field('Take off (%)', UI.input('deductionPct', { type: 'number', min: 0, max: 100, step: '0.1', value: suggestPct }),
            suggestPct ? `From the fill check: ${fillAvg}% full means ${suggestPct}% off. You can change it.` : '0 = nothing taken off.')}
          ${UI.field('Why', UI.input('deductionReason', { value: defaultReason, placeholder: 'Bags are not filled fully' }), 'Only used when the percent is above 0.')}
        </div>
        <div class="calc-strip" id="deduct-out"></div>
        <div class="grid-2" style="margin-top:12px">
          ${UI.field('Bag numbers on this truck (if any)', UI.textarea('serials', { rows: 3, value: (d.serials || []).join(' '), placeholder: 'EFPL-BG-000301-000480' }))}
          ${UI.field('Supervisor note', UI.textarea('acceptNote', { rows: 3, placeholder: 'Count verified, bags checked for damage…' }))}
        </div>
        <p class="small muted">Only bag numbers already in the Bag registry are used. Unknown numbers are skipped.</p>`,
      footer: `<button class="nm-btn" data-close>Cancel</button>
               <button class="nm-btn primary" data-act="accept">Accept and create payment</button>`,
      onMount(el, close) {
        const totalEl = el.querySelector('#alloc-total');
        const hintEl = el.querySelector('#alloc-hint');
        const recalc = () => {
          const total = UI.$$('[data-bay]', el).reduce((a, i) => a + (Number(i.value) || 0), 0);
          totalEl.textContent = total;
          const diff = total - d.bagCount;
          const over = UI.$$('[data-bay]', el).filter((i) => {
            const b = bays.find((x) => x.id === i.dataset.bay);
            i.closest('.alloc-cell').classList.toggle('on', Number(i.value) > 0);
            const tooMany = b && (Number(i.value) || 0) > room(b);
            i.closest('.alloc-cell').classList.toggle('over', !!tooMany);
            return tooMany;
          }).length;
          hintEl.textContent = (diff === 0 ? 'adds up' : `${diff > 0 ? `${diff} too many` : `${-diff} still to place`}`)
            + (over ? `. ${over} bay(s) will be over their size, which is allowed` : '');
          hintEl.className = diff === 0 ? 't-ok' : 't-warn';
        };
        UI.$$('[data-bay]', el).forEach((i) => i.addEventListener('input', recalc));
        recalc();
        const readBank = VH.wireBankEditor(el);

        const pctEl = el.querySelector('[name=deductionPct]');
        const money$ = () => D.applyDeduction(d.bagCount, unitPrice, pctEl.value);
        const paintDeduction = () => {
          const m = money$();
          el.querySelector('#deduct-out').innerHTML = `
            <div><span class="muted small">${d.bagCount} bags at ${money(unitPrice)}</span><b>${money(m.grossAmount)}</b></div>
            <div><span class="muted small">Deducted (${m.deductionPct}%)</span><b class="${m.deductions ? 't-danger' : ''}">${m.deductions ? '− ' : ''}${money(m.deductions)}</b></div>
            <div><span class="muted small">Payable to the supplier</span><b>${money(m.netAmount)}</b></div>`;
        };
        pctEl.addEventListener('input', paintDeduction);
        paintDeduction();

        el.querySelector('[data-act=accept]').addEventListener('click', () => {
          const allocs = UI.$$('[data-bay]', el)
            .map((i) => {
              const bay = Store.byId('bays', i.dataset.bay);
              return { bayId: i.dataset.bay, bayCode: bay ? bay.code : '—', bags: Number(i.value) || 0 };
            }).filter((a) => a.bags > 0);
          const total = allocs.reduce((a, b) => a + b.bags, 0);
          const errors = [];
          if (!allocs.length) errors.push({ field: 'Bays', msg: 'Allocate at least one bay' });
          if (total !== d.bagCount) errors.push({ field: 'Allocation', msg: `Bags per bay add up to ${total} but ${d.bagCount} were counted` });
          // A bay's size is a guide, not a wall: going over it is allowed and
          // shows on the bay as "over size".
          const m = money$();
          const rawPct = Number(pctEl.value);
          const deductionReason = el.querySelector('[name=deductionReason]').value.trim();
          if (pctEl.value !== '' && (!Number.isFinite(rawPct) || rawPct < 0 || rawPct > 100)) errors.push({ field: 'Deduction', msg: 'Enter a percentage between 0 and 100' });
          if (m.deductionPct > 0 && !deductionReason) errors.push({ field: 'Deduction', msg: 'Write the reason for the deduction — the supplier will see it on the payment slip' });

          const serials = VH.parseSerials(el.querySelector('[name=serials]').value, prefix);
          if (serials.length > d.bagCount) errors.push({ field: 'Serials', msg: `${serials.length} serials entered but only ${d.bagCount} bags were counted` });

          // Pay to: new or changed bank details are saved on the supplier; none at all stops the payment.
          const bank = readBank();
          if (bank && bank.error) errors.push({ field: 'Pay to', msg: bank.error });
          if (!bank && !VH.bankReady(Store.byId('suppliers', d.supplierId))) errors.push({ field: 'Pay to', msg: 'Add the supplier\'s bank details before the payment is made' });

          UI.showErrors(el.querySelector('#accept-errors').parentNode, errors);
          if (errors.length) { el.querySelector('.modal-body').scrollTop = 0; return; }
          if (bank) VH.saveBank(d.supplierId, bank, `on accepting ${d.receiptNo}`);

          // Attach serials -> bag records
          const bySerial = new Map(Store.all('bags').map((b) => [b.serial, b]));
          const unknown = [];
          const busy = [];
          const taken = [];
          let attached = 0;
          const perBay = {};
          for (const a of allocs) perBay[a.bayId] = a.bags;
          const now = new Date().toISOString();
          serials.forEach((sn) => {
            const bag = bySerial.get(sn);
            if (!bag) { unknown.push(sn); return; }
            // A bag can only arrive from the bag store or from a supplier round.
            if (!['IN_STOCK', 'ISSUED'].includes(bag.status)) { busy.push(sn); return; }
            let bay = null;
            for (const a of allocs) { if (perBay[a.bayId] > 0) { bay = a; perBay[a.bayId] -= 1; break; } }
            Object.assign(bag, {
              status: 'STORED', supplierId: d.supplierId, deliveryId: d.id, usageId: null,
              bayId: bay ? bay.bayId : (allocs[0] || {}).bayId,
              bayCode: bay ? bay.bayCode : (allocs[0] || {}).bayCode,
              deliveredAt: now, updatedAt: now,
            });
            Store.markDirty('bags', bag.id);
            taken.push(sn);
            attached++;
          });

          // Payment
          const paymentNo = 'PAY-' + new Date().getFullYear() + '-' + String(Store.nextSeq('payment', 1)).padStart(4, '0');
          const sup = Store.byId('suppliers', d.supplierId) || {};
          const payment = Store.add('payments', {
            paymentNo, deliveryId: d.id, supplierId: d.supplierId,
            supplierCode: sup.code, supplierName: sup.name,
            bags: d.bagCount, unitPrice,
            grossAmount: m.grossAmount, deductionPct: m.deductionPct, deductionReason: m.deductionPct ? deductionReason : '',
            deductions: m.deductions, netAmount: m.netAmount,
            // goes straight to the supervisor: there is no farmer declaration step any more
            status: 'PENDING_SUPERVISOR', createdAt: now,
            history: [{ at: now, by: Auth.current().email, action: 'CREATED',
              note: `Generated on acceptance of ${d.receiptNo}${m.deductionPct ? ` · ${m.deductionPct}% deducted: ${deductionReason}` : ''}` }],
          }, 'payment-create');

          Store.update('deliveries', d.id, {
            status: 'ACCEPTED', acceptedAt: new Date().toISOString(), acceptedBy: Auth.current().email,
            allocations: allocs, serials: taken, acceptNote: el.querySelector('[name=acceptNote]').value.trim(),
            deductionPct: m.deductionPct, deductionReason: m.deductionPct ? deductionReason : '',
            deductionAmount: m.deductions, payableAmount: m.netAmount, rejectedReason: null,
          }, 'delivery-accept');

          VH.audit('delivery.accept', 'delivery', d.id,
            `${d.receiptNo} accepted · ${d.bagCount} bags · ${allocs.map((a) => `${a.bayCode}:${a.bags}`).join(', ')} · ${money(payment.netAmount)}${m.deductionPct ? ` · ${m.deductionPct}% deducted (${deductionReason})` : ''}`);
          VH.audit('payment.create', 'payment', payment.id, `${paymentNo} created for ${sup.name} · ${money(payment.netAmount)}`);

          UI.toast(`Accepted. ${d.bagCount} bags stored: ${allocs.map((a) => `${a.bayCode} ${a.bags}`).join(', ')}.${attached ? ` ${attached} bag serials recorded.` : ''} Payment ${paymentNo} created.`, 'ok', 6000);
          if (unknown.length) UI.toast(`${unknown.length} serial(s) are not in the bag registry and were skipped`, 'warn', 6000);
          if (busy.length) UI.toast(`${busy.length} serial(s) are already in a bay or in use and were skipped (first: ${busy[0]})`, 'warn', 7000);
          close();
          App.refresh();
        });
      },
    });
  };

  /* ------------------------ fill-check sheet ------------------------- */
  /**
   * A blank sheet for the drum: one box per sample bag, filled in by hand
   * at the gate and typed into the app afterwards. With no bag count yet it
   * prints a general sheet with 30 boxes.
   */
  App.printFillSheet = function (opts) {
    const o = opts || {};
    const s = Store.settings();
    const count = Number(o.bagCount) || 0;
    const sample = count ? D.sampleSizeFor(count, s) : 30;
    const sup = o.supplierId ? (Store.byId('suppliers', o.supplierId) || {}) : {};
    const blank = '<span class="blank"></span>';
    const boxes = Array.from({ length: sample }, (_, i) => `<div class="fill-box"><span>Bag ${i + 1}</span><b></b><i>%</i></div>`).join('');
    const html = `${VH.printHeader('Fill check sheet', `Printed for the gate · ${dOnly(new Date().toISOString())}`)}
      <table>
        <tr><th>Supplier</th><td>${sup.name ? esc(`${sup.code} · ${sup.name}`) : blank}</td><th>Vehicle</th><td>${o.vehicleNo ? esc(String(o.vehicleNo).toUpperCase()) : blank}</td></tr>
        <tr><th>Biomass</th><td>${o.biomassType ? esc(VH.typeLabel(o.biomassType)) : blank}</td><th>Date and time</th><td>${blank}</td></tr>
        <tr><th>Bags counted</th><td>${count || blank}</td><th>Sample (${esc(s.sampleSizePct)}% of the bags)</th><td>${count ? `${sample} bags` : blank}</td></tr>
      </table>
      <p class="meta">Empty each sample bag into the measuring drum and write the fill height as a percentage of the drum. ${count
        ? `Fill all ${sample} boxes: the app needs the whole ${esc(s.sampleSizePct)}% sample.`
        : `Fill one box for each sample bag: ${esc(s.sampleSizePct)}% of the bags, rounded up (for example 120 bags = 6 boxes). The app needs all of them.`}
        Full price (Rs ${esc(s.unitPrice)} a bag) only when the bags are 100% full. Below that, the part that is missing is taken off. The app works out the average.</p>
      <div class="fill-sheet">${boxes}</div>
      <div style="display:flex;gap:20mm;margin-top:10mm">
        <div class="sign">Measured by</div><div class="sign">Supplier or driver</div><div class="sign">Biomass supervisor</div>
      </div>`;
    UI.print(html, 'Fill check sheet');
  };

  /* ------------------------------ invoice ---------------------------- */
  /** One page for Head Office: what was bought, what is payable, and where to pay it. */
  App.printInvoice = function (id) {
    const d = Store.byId('deliveries', id);
    if (!d) return;
    if (d.status !== 'ACCEPTED') return UI.toast('The invoice is available once the load has been accepted', 'warn');
    const sup = Store.byId('suppliers', d.supplierId) || {};
    const p = VH.paymentFor(d.id) || {};
    const unit = (d.fillCheck && d.fillCheck.unitPrice) || p.unitPrice || Store.settings().unitPrice;
    const gross = D.round2((d.bagCount || 0) * unit);
    const deducted = Number(d.deductionAmount) || 0;
    const payable = VH.payable(d);
    const invNo = `INV-${String(d.receiptNo || '').replace(/^RC-/, '')}`;
    const full = d.fillCheck && d.fillCheck.fullPrice;
    // The invoice is the supplier's: it is issued in their name, to EnerFab.
    // EnerFab only prepares it for them, so there is no EnerFab letterhead.
    const st = Store.settings();
    const html = `<div class="row print-head inv-head">
        <div class="print-title">
          <div class="co">Invoice from</div>
          <h1>${esc(sup.name || '')}</h1>
          <div class="meta">${[esc(sup.address || ''), sup.phone ? `Tel ${esc(sup.phone)}` : '', sup.nic ? `NIC ${esc(sup.nic)}` : ''].filter(Boolean).join('<br/>')}</div>
        </div>
        <div style="text-align:right">
          <h1>INVOICE</h1>
          <div class="meta">No. <b>${esc(invNo)}</b><br/>Date ${esc(dOnly(d.acceptedAt || d.deliveredAt))}</div>
        </div></div><hr/>
      <div class="row" style="margin-bottom:4mm">
        <div><h2 style="margin-top:0">Bill to</h2>
          <p><b>EnerFab (Pvt) Ltd</b><br/>${esc(st.siteName || '')}<br/>${esc(st.siteLocation || '')}</p></div>
        <div><h2 style="margin-top:0">Supplier</h2>
          <p><b>${esc(sup.name || '')}</b><br/>Supplier code ${esc(sup.code || '')}</p></div>
        <div><h2 style="margin-top:0">Reference</h2>
          <p>Receipt ${esc(d.receiptNo || '')}<br/>${p.paymentNo ? `Payment ${esc(p.paymentNo)}<br/>` : ''}Weighbridge slip ${esc(d.weighbridgeSlip || '—')}</p></div>
      </div>
      <table>
        <thead><tr><th>Description</th><th class="num">Quantity</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>
          <tr><td>${esc(VH.typeLabel(d.biomassType))} biomass, ${kg(d.netKg)} net, vehicle ${esc(d.vehicleNo || '')}${d.fillCheck && d.fillCheck.avgFillPct !== null ? `<br/><span class="meta">Fill check: bags ${d.fillCheck.avgFillPct}% full on average${full && unit < full ? ` (old rule: lower rate, full rate ${money(full)})` : ''}</span>` : ''}</td>
            <td class="num">${(d.bagCount || 0).toLocaleString()} bags</td><td class="num">${money(unit)}</td><td class="num">${money(gross)}</td></tr>
          ${deducted ? `<tr><td>Taken off ${esc(d.deductionPct)}%${d.deductionReason ? `: ${esc(d.deductionReason)}` : ''}</td><td class="num"></td><td class="num"></td><td class="num">− ${money(deducted)}</td></tr>` : ''}
          <tr><th colspan="3">Amount payable</th><th class="num">${money(payable)}</th></tr>
        </tbody>
      </table>
      <h2>Please pay to</h2>
      <table>
        <tr><th>Account name</th><td>${esc(sup.bankAccountName || sup.name || '')}</td><th>Account number</th><td>${esc(sup.bankAccount || '')}</td></tr>
        <tr><th>Bank</th><td>${esc(sup.bankName || sup.bank || '')}</td><th>Branch</th><td>${esc(sup.bankBranch || '')}</td></tr>
      </table>
      ${VH.bankText(sup) === 'No bank details on file' ? '<p class="meta"><b>No bank details are on file for this supplier.</b> Add them before this is sent for payment.</p>' : ''}
      <div style="display:flex;gap:16mm;margin-top:14mm">
        <div class="sign">${esc(sup.name || 'Supplier')}<br/>Supplier's signature</div><div class="sign">Received by EnerFab<br/>Biomass supervisor</div><div class="sign">Approved for payment<br/>Head Office accounts</div>
      </div>
      <p class="meta" style="margin-top:8mm">Prepared by EnerFab (Pvt) Ltd for the supplier. Stored in: ${(d.allocations || []).map((a) => `${esc(a.bayCode)} (${a.bags})`).join(', ') || '—'}.</p>`;
    UI.print(html, `Invoice ${invNo}`);
    VH.audit('invoice.print', 'delivery', d.id, `${invNo} printed for ${sup.name || ''} · ${money(payable)}`);
  };

  /* ------------------------------ printing --------------------------- */
  App.printReceipt = function (id) {
    const d = Store.byId('deliveries', id);
    if (!d) return;
    const sup = Store.byId('suppliers', d.supplierId) || {};
    const p = VH.paymentFor(d.id);
    const html = `${VH.printHeader('Biomass receipt', `Receipt ${d.receiptNo} · ${dt(d.deliveredAt)}`)}
      <table>
        <tr><th>Supplier</th><td>${esc(sup.code)} · ${esc(sup.name)}</td><th>Vehicle</th><td>${esc(d.vehicleNo || '')}</td></tr>
        <tr><th>Driver</th><td>${esc(d.driverName || '')}</td><th>Weighbridge slip</th><td>${esc(d.weighbridgeSlip || '')}</td></tr>
        <tr><th>Biomass</th><td>${esc(typeLabel(d.biomassType))}</td><th>Bags</th><td>${d.bagCount}</td></tr>
        <tr><th>Gross</th><td>${kg(d.grossKg)}</td><th>Tare</th><td>${kg(d.tareKg)}</td></tr>
        <tr><th>Net weight</th><td>${kg(d.netKg)}</td><th>Average per bag</th><td>${d.avgBagKg || '—'} kg</td></tr>
        <tr><th>Fill check average</th><td>${d.fillCheck && d.fillCheck.avgFillPct !== null ? d.fillCheck.avgFillPct + '%' : 'not checked'}</td>
          <th>Price per bag (by fill)</th><td>${money(D.fillPayPerBag(d.fillCheck, Store.settings().unitPrice))}</td></tr>
        <tr><th>Moisture (from bag weight)</th><td>${d.avgBagKg ? D.moistureFromWeight(d.avgBagKg, Store.settings()) + '%' : '—'}</td>
          <th>Value of the load</th><td>${money((d.fillCheck && d.fillCheck.amount) || 0)}</td></tr>
        ${d.deductionPct ? `<tr><th>Taken off</th><td>${d.deductionPct}% · ${money(d.deductionAmount)}</td><th>Why</th><td>${esc(d.deductionReason || '')}</td></tr>` : ''}
        <tr><th>Payable</th><td colspan="3"><b>${d.status === 'ACCEPTED' ? money(VH.payable(d)) : 'Set when the supervisor accepts the load'}</b></td></tr>
        ${(d.allocations || []).length ? `<tr><th>Bays</th><td colspan="3">${d.allocations.map((a) => `${esc(a.bayCode)}: ${a.bags} bags`).join(' · ')}</td></tr>` : ''}
        <tr><th>Pay to</th><td colspan="3">${esc(VH.bankText(sup))}</td></tr>
      </table>
      <h2>Bag serials</h2>
      <p class="meta">${(d.serials || []).length ? `${d.serials.length} serials: ${esc(d.serials[0])} … ${esc(d.serials[d.serials.length - 1])}` : 'Serials to be captured at acceptance.'}</p>
      <p class="meta">${p ? `Payment ${esc(p.paymentNo)} · ${esc(D.PAYMENT_LABEL[p.status])} · ${money(p.netAmount)}` : 'Payment not yet generated.'}</p>
      <div style="display:flex;gap:20mm;margin-top:14mm">
        <div class="sign">Supplier signature</div><div class="sign">Store keeper</div><div class="sign">Biomass supervisor</div>
      </div>`;
    UI.print(html, `Receipt ${d.receiptNo}`);
    VH.audit('delivery.print', 'delivery', d.id, `${d.receiptNo} receipt printed`);
  };

  /** Sticker sheet: one label per bag, with the serial as a barcode. */
  /**
   * Bag labels, as agreed on site: the serial and its barcode, and a box
   * where the supplier writes their number by hand. Nothing else is printed,
   * so the same bag can go to a different supplier next round.
   */
  const LABELS_PER_PRINT = 1000;
  VH.printLabelSheet = function (serials, title) {
    const list = (serials || []).filter(Boolean);
    if (!list.length) { UI.toast('There are no bag serials to print', 'warn'); return false; }
    if (list.length > LABELS_PER_PRINT) {
      UI.toast(`${list.length.toLocaleString()} labels is too many for one print. Print them in parts of up to ${LABELS_PER_PRINT.toLocaleString()} (choose a range).`, 'warn', 7000);
      return false;
    }
    const sheet = list.map((sn) => `
      <div class="sticker">
        <div class="co"><img class="sticker-logo" src="assets/enerfab-logo.png" alt="" />EnerFab Biomass</div>
        <div class="serial">${esc(sn)}</div>
        ${D.code39SVG(String(sn).replace(/[^A-Z0-9-]/gi, ''), { height: 34, narrow: 1.6, quiet: 6 })}
        <div class="write">Supplier no: _______________________</div>
      </div>`).join('');
    UI.print(`<div class="sheet">${sheet}</div>`, title || 'Bag labels');
    return true;
  };

  /** Labels for the bags that came in on one load (only bags with serials). */
  App.printLabels = function (id) {
    const d = Store.byId('deliveries', id);
    if (!d) return;
    const serials = d.serials && d.serials.length ? d.serials : [];
    if (!serials.length) {
      UI.toast('This load was received without bag serials, so there are no labels to reprint. New labels are printed when bags are numbered (Bag registry → Number new bags).', 'warn', 8000);
      return;
    }
    if (VH.printLabelSheet(serials, `Bag labels ${d.receiptNo}`)) {
      VH.audit('delivery.labels', 'delivery', d.id, `${serials.length} bag labels printed`);
    }
  };

  /* ------------------------------- TRACE ----------------------------- */
  App.register('trace', {
    title: 'Trace a bag',
    render(view) {
      view.innerHTML = `
        <section class="nm-card pad">
          <h3>Trace a bag</h3>
          <p class="muted">Type the serial on the bag tag, or its last four digits.</p>
          <div class="trace-search">
            <input class="nm-input" id="trace-input" placeholder="EFPL-BG-000302" autocomplete="off" />
            <button class="nm-btn primary" id="trace-go">Trace</button>
          </div>
          <div id="trace-out" class="trace-out"></div>
        </section>`;
      const go = () => {
        const val = view.querySelector('#trace-input').value.trim();
        const out = view.querySelector('#trace-out');
        if (!val) return;
        const r = D.traceBag(Store, val);
        if (!r) { out.innerHTML = `<div class="banner banner-warn">No bag with that serial. Check the tag, or the bag may belong to a round not yet registered.</div>`; return; }
        const { bag } = r;
        out.innerHTML = `
          <div class="trace-card nm-inset">
            <div class="trace-head">
              <div class="bag-tag"><span>Bag</span><h2>${esc(bag.serial)}</h2></div>
              <div class="trace-badge">${badge(D.BAG_STATUS_LABEL[bag.status] || bag.status, UI.statusTone(bag.status))}</div>
            </div>
            <div class="trace-grid">
              <div><span class="muted small">Supplier</span><b>${r.supplier ? esc(`${r.supplier.code} · ${r.supplier.name}`) : '—'}</b></div>

              <div><span class="muted small">Issue round</span><b>${r.issue ? `Round ${r.issue.roundNo} · ${esc(dOnly(r.issue.issuedAt))}` : '—'}</b></div>
              <div><span class="muted small">Receipt</span><b>${r.delivery ? esc(r.delivery.receiptNo) : '—'}</b></div>
              <div><span class="muted small">Bay</span><b>${bag.bayCode ? esc(bag.bayCode) : '—'}</b></div>
              <div><span class="muted small">Net weight on truck</span><b>${r.delivery ? kg(r.delivery.netKg) : '—'}</b></div>
              <div><span class="muted small">Gasifier run</span><b>${r.usage ? `${esc(r.usage.id.slice(-5))} · ${r.usage.avgBagKg} kg avg` : 'not consumed'}</b></div>
              <div><span class="muted small">Payment</span><b>${r.payment ? `${esc(r.payment.paymentNo)} · ${esc(D.PAYMENT_LABEL[r.payment.status])}` : '—'}</b></div>
            </div>
            ${r.quality.length ? `<div class="trace-quality"><h4>Quality issues on this bag</h4>
              ${r.quality.map((q) => `<p>${badge(q.severity, q.severity === 'HIGH' ? 'danger' : 'warn')} ${esc(q.description)}<br/><span class="muted small">${esc(q.status)}</span></p>`).join('')}</div>` : ''}
            <ol class="trace-timeline">
              <li><b>Numbered</b><span>${esc(bag.serial)} printed and fixed to the bag before issue</span></li>
              <li><b>Issued to supplier</b><span>${r.issue ? `${dOnly(r.issue.issuedAt)} · round ${r.issue.roundNo}` : '—'}</span></li>
              <li><b>Delivered &amp; weighed</b><span>${r.delivery ? `${dOnly(r.delivery.deliveredAt)} · ${esc(r.delivery.receiptNo)}` : '—'}</span></li>
              <li><b>Stored in bay</b><span>${bag.bayCode ? esc(bag.bayCode) : '—'}</span></li>
              <li><b>Consumed</b><span>${r.usage ? `${dOnly(r.usage.consumedAt)} · moisture ${r.usage.moisturePct}%` : '—'}</span></li>
            </ol>
            ${Auth.can('quality.report') ? `<button class="nm-btn danger" id="raise-issue"><i class="i i-alert"></i>Report a problem with this bag</button>` : ''}
          </div>`;
        const btn = out.querySelector('#raise-issue');
        if (btn) btn.addEventListener('click', () => App.raiseQuality(bag.serial));
      };
      view.querySelector('#trace-go').addEventListener('click', go);
      view.querySelector('#trace-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      view.querySelector('#trace-input').focus();
    },
  });
})();
