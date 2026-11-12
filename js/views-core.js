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
      Store.add('audit', {
        at: new Date().toISOString(),
        by: (Auth.current() || {}).email || 'system',
        action, entity, entityId, detail: String(detail || '').slice(0, 500),
        device: Store.data.meta.deviceId,
      }, 'audit');
    },
    supplierOptions() {
      return Store.where('suppliers', (s) => !s.deleted && s.status !== 'INACTIVE')
        .slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }));
    },
    farmerOptions(supplierId) {
      return Store.where('farmers', (f) => !f.deleted && (!supplierId || f.supplierId === supplierId))
        .slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ value: f.id, label: `${f.code} · ${f.name} (${f.village})` }));
    },
    bayOptions() {
      return Store.where('bays', (b) => !b.deleted).map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
    },
    bagsInBay(bayId) { return Store.where('bags', (b) => b.bayId === bayId && b.status === 'STORED').length; },
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
        Store.patchSettings({ biomassTypes: list, biomassTypesRev: 2 });
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
      return `<div class="row"><div>
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
      const stored = bags.filter((b) => b.status === 'STORED');
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
      const bagStore = bags.filter((b) => b.status === 'IN_STOCK').length;
      const damaged = bags.filter((b) => b.status === 'DAMAGED').length;

      const bays = Store.where('bays', (b) => !b.deleted).map((b) => ({ ...b, count: VH.bagsInBay(b.id) }));

      const alerts = [];
      if (awaiting.length) alerts.push({ tone: 'warn', text: `${awaiting.length} ${awaiting.length === 1 ? 'truck is' : 'trucks are'} waiting to be accepted and allocated a bay`, nav: 'deliveries' });
      if (pendingUsage.length) alerts.push({ tone: 'warn', text: `${pendingUsage.length} gasifier issue ${pendingUsage.length === 1 ? 'request needs' : 'requests need'} supervisor approval`, nav: 'gasifier' });
      if (pendingPay.length) alerts.push({ tone: 'info', text: `${pendingPay.length} ${pendingPay.length === 1 ? 'payment' : 'payments'} in the pipeline, worth ${money(pendingValue)}`, nav: 'payments' });
      if (openQuality.length) alerts.push({ tone: 'danger', text: `${openQuality.length} open quality ${openQuality.length === 1 ? 'issue' : 'issues'} traced to suppliers and farmers`, nav: 'quality' });
      if (bagStore < 50) alerts.push({ tone: 'danger', text: `Only ${bagStore} empty bags left in the bag store — order replacements`, nav: 'returns' });
      if (damaged) alerts.push({ tone: 'warn', text: `${damaged} damaged ${damaged === 1 ? 'bag' : 'bags'} awaiting repair or write-off`, nav: 'returns' });

      const capacity = bays.reduce((a, b) => a + (b.capacityBags || 0), 0);
      const yardPct = capacity ? Math.min(100, Math.round((stored.length / capacity) * 100)) : 0;

      view.innerHTML = `
        <section class="hero nm-card">
          <div class="hero-main">
            <p class="hero-date">${esc(dOnly(new Date().toISOString()))}, ${esc(Store.settings().siteLocation)}</p>
            <h2>${esc(greeting())}, ${esc((Auth.current().name || '').split(' ')[0] || 'team')}</h2>
            <div class="hero-actions">
              ${Auth.can('delivery.create') ? '<button class="nm-btn primary" data-quick="intake"><i class="i i-plus"></i>Receive biomass</button>' : ''}
              ${Auth.can('usage.approve') ? '<button class="nm-btn" data-quick="gasifier"><i class="i i-flame"></i>Approve bay issue</button>' : ''}
              ${Auth.can('report.read') ? '<button class="nm-btn" data-quick="reports"><i class="i i-chart"></i>Reports</button>' : ''}
            </div>
          </div>
          <div class="hero-yard">
            <span class="hero-yard-label">In the yard now</span>
            <strong class="hero-yard-value">${stored.length.toLocaleString()}<small>bags</small></strong>
            <div class="meter on-dark"><span style="width:${yardPct}%"></span></div>
            <span class="hero-yard-sub">${yardPct}% of ${capacity.toLocaleString()} bag capacity, ${bays.filter((b) => b.count > 0).length} of ${bays.length} bays in use</span>
          </div>
        </section>

        ${alerts.length ? `<section class="alerts">${alerts.map((a) => `
          <button class="alert-chip nm-card tone-${a.tone}" data-quick="${a.nav}">
            <span class="alert-dot"></span><span>${esc(a.text)}</span>${UI.icon('chevron', 'chev')}
          </button>`).join('')}</section>` : ''}

        <section class="stats">
          ${UI.stat('Received, last 30 days', `${(netIn / 1000).toFixed(1)} t`, `${bagsIn.toLocaleString()} bags accepted`)}
          ${UI.stat('Into the gasifier, last 7 days', `${(kgOut / 1000).toFixed(2)} t`, `${bagsOut} bags weighed out`)}
          ${UI.stat('Payments in progress', money(pendingValue), `${pendingPay.length} awaiting action`, pendingPay.length ? 'warn' : null)}
          ${UI.stat('Empty bags in store', bagStore.toLocaleString(), `${damaged} damaged`, bagStore < 50 ? 'danger' : null)}
        </section>

        <section class="cols-2">
          <div class="nm-card pad">
            <div class="card-head"><h3>Stock by bay</h3><button class="link" data-quick="bays">Manage bays</button></div>
            ${bays.map((b) => {
              const pctFull = Math.min(100, Math.round((b.count / (b.capacityBags || 900)) * 100));
              return `<div class="bay-row">
                <div class="bay-row-head"><b>${esc(b.code)}</b><span class="muted">${b.count.toLocaleString()} / ${(b.capacityBags || 0).toLocaleString()} bags</span></div>
                <div class="meter"><span style="width:${pctFull}%"></span></div>
              </div>`;
            }).join('') || '<p class="muted">No bays configured.</p>'}
          </div>

          <div class="nm-card pad">
            <div class="card-head"><h3>Latest movements</h3><button class="link" data-quick="deliveries">All deliveries</button></div>
            <ul class="timeline">
              ${movements().map((m) => `<li>
                <span class="tl-dot tone-${m.tone}"></span>
                <div><b>${esc(m.title)}</b><div class="muted small">${esc(m.sub)}</div></div>
                <span class="muted small">${esc(m.when)}</span>
              </li>`).join('') || '<li class="muted">No movements yet.</li>'}
            </ul>
          </div>
        </section>

        <section class="nm-card pad quick-trace">
          <div>
            <h3>Trace a bag</h3>
            <p class="muted">Type the number on the tag to see its supplier, farmer, bay and gasifier run.</p>
          </div>
          <form class="trace-search" id="dash-trace">
            <input class="nm-input" id="dash-trace-input" placeholder="${esc(Store.settings().bagSerialPrefix)}-000302" autocomplete="off" aria-label="Bag serial" />
            <button class="nm-btn primary" type="submit">Trace</button>
          </form>
        </section>`;

      UI.$$('[data-quick]', view).forEach((b) => b.addEventListener('click', () => App.navigate(b.dataset.quick)));
      view.querySelector('#dash-trace').addEventListener('submit', (e) => {
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
  const STATUS_LABEL = { AWAITING_ACCEPTANCE: 'Awaiting acceptance', ACCEPTED: 'Accepted', REJECTED: 'Sent back (old record)' };
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
              <p class="muted small">Supplier and vehicle details. Farmers are attached to the supplier, not to the truck.</p></div></div>
            <div class="grid-3">
              ${UI.field('Supplier', UI.select('supplierId', VH.supplierOptions(), { required: true, placeholder: 'Select supplier…' }))}
              ${UI.field('Biomass type', UI.select('biomassType', VH.biomassTypes().map((t) => ({ value: t.id, label: t.label })), { required: true }),
                Auth.can('settings.write') ? '<button type="button" class="link" id="add-type"><i class="i i-plus"></i>Add another type</button>' : '')}
              ${UI.field('Vehicle number', UI.input('vehicleNo', { placeholder: 'WP LH-4521', required: true }))}
              ${UI.field('Driver name', UI.input('driverName', { placeholder: 'Full name', required: true }))}
              ${UI.field('Driver NIC', UI.input('driverNic', { placeholder: '781234567V' }))}
              ${UI.field('Weighbridge slip no.', UI.input('weighbridgeSlip', { placeholder: 'WB-8893' }))}
            </div>
          </section>

          <section class="nm-card pad">
            <div class="step-head"><span class="step-no">2</span><div><h3>Weighing and bag count</h3>
              <p class="muted small">Count the bags and enter the weighbridge readings. The average bag weight gives the moisture.</p></div></div>
            <div class="grid-4">
              ${UI.field('Gross weight (kg)', UI.input('grossKg', { type: 'number', min: 0, step: '0.01', required: true }))}
              ${UI.field('Tare weight (kg)', UI.input('tareKg', { type: 'number', min: 0, step: '0.01', required: true }))}
              ${UI.field('Net weight (kg)', UI.input('netKg', { readonly: true, value: '' }))}
              ${UI.field('Bags counted', UI.input('bagCount', { type: 'number', min: 1, max: s.maxBagsPerDelivery, required: true }))}
            </div>
            <div class="weigh-out" id="weigh-out"></div>
          </section>

          <section class="nm-card pad">
            <div class="step-head"><span class="step-no">3</span><div><h3>Random fill check</h3>
              <p class="muted small">Empty the sampled bags into the measuring drum and type each fill height as a % of the drum. The agreement is ${s.fillThresholdPct}% average.</p></div></div>
            <div class="fill-check">
              <div class="fill-inputs" id="fill-inputs"></div>
              <div class="fill-result nm-inset" id="fill-result"></div>
            </div>
            <div class="grid-2" style="margin-top:12px">
              ${UI.field('Supervisor decision', UI.select('outcome', [
                { value: 'AUTO', label: 'Apply the agreement automatically' },
                { value: 'OVERRIDE_FULL_PRICE', label: 'Pay the full price anyway (reason required)' },
              ], { value: 'AUTO' }))}
              ${UI.field('Reason or remarks', UI.input('fillNote', { placeholder: 'Optional unless paying full price anyway' }))}
            </div>
            <p class="muted small">No load is turned away. If the supplier re-fills the bags, count and sample them again before registering. Wet or poor loads are received and a percentage is deducted when the supervisor accepts them.</p>
          </section>

          <section class="nm-card pad">
            <div class="step-head"><span class="step-no">4</span><div><h3>Bag serials (optional at the gate)</h3>
              <p class="muted small">Scan or paste the serials on the bags. Ranges work: <code>EFPL-BG-000301-000480</code>. Leave empty to capture them during acceptance.</p></div></div>
            ${UI.field('Serials on this truck', UI.textarea('serialsText', { rows: 3, placeholder: 'EFPL-BG-000301-000480   (or one serial per line)' }))}
            <div id="serial-preview" class="calc-strip"></div>
            ${UI.field('Notes', UI.textarea('notes', { rows: 2, placeholder: 'Anything the supervisor should know' }))}
          </section>

          <div class="intake-actions">
            <button type="button" class="nm-btn" id="cancel-intake">Clear</button>
            <button type="submit" class="nm-btn primary">Register delivery</button>
          </div>
        </form>`;

      const form = view.querySelector('#intake-form');
      const s2 = Store.settings();
      let fills = [];

      const bagCountEl = form.querySelector('[name=bagCount]');
      const grossEl = form.querySelector('[name=grossKg]');
      const tareEl = form.querySelector('[name=tareKg]');
      const netEl = form.querySelector('[name=netKg]');

      function renderFillInputs() {
        const count = Number(bagCountEl.value) || 0;
        const sample = D.sampleSizeFor(count || 1, s2);
        const wrap = form.querySelector('#fill-inputs');
        wrap.innerHTML = `<div class="fill-head">Sample size: <b>${sample}</b> bag(s)
            <span class="muted small">(${s2.sampleSizePct}% of ${count || 0}, minimum ${s2.minSampleSize})</span></div>
          <div class="fill-grid">${Array.from({ length: Math.min(sample, 20) }, (_, i) => `
            <label class="fill-cell"><span>#${i + 1}</span>
              <input class="nm-input" type="number" min="0" max="150" step="0.1" data-fill="${i}"
                value="${fills[i] !== undefined ? fills[i] : ''}" placeholder="%" /></label>`).join('')}</div>`;
        wrap.querySelectorAll('[data-fill]').forEach((el) => el.addEventListener('input', () => {
          fills[Number(el.dataset.fill)] = el.value === '' ? undefined : Number(el.value);
          updateFill();
        }));
      }

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
        const tone = r.decision === 'NOT_CHECKED' ? 'muted' : r.decision === 'PASS' || r.decision === 'PASS_MARGINAL' ? 'ok' : 'warn';
        box.innerHTML = `
          <div class="fill-big ${tone}">${r.avgFillPct === null ? '—' : `${r.avgFillPct}%`}</div>
          <div class="muted small">average fill of ${valid.length} sample bag(s)</div>
          <div class="fill-table">
            <div><span>Unit price</span><b>${money(r.unitPrice)}</b></div>
            <div><span>Contract price</span><b>${money(r.fullPrice)}</b></div>
            <div><span>Batch value</span><b>${money(r.amount)}</b></div>
            <div><span>Spread of readings</span><b>${r.spread === null ? '—' : `${r.spread.toFixed(1)}%`}</b></div>
          </div>
          <p class="fill-action tone-${tone}">${esc(r.action)}</p>`;
      }

      function updateSerials() {
        const prefix = Store.settings().bagSerialPrefix;
        const list = VH.parseSerials(form.querySelector('[name=serialsText]').value, prefix);
        const count = Number(bagCountEl.value) || 0;
        const box = form.querySelector('#serial-preview');
        if (!list.length) { box.innerHTML = '<span class="muted">No serials captured — you can capture them at acceptance.</span>'; return; }
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

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = UI.formData(form);
        const errors = [];
        if (!data.supplierId) errors.push({ field: 'Supplier', msg: 'Choose who delivered the biomass' });
        if (!data.vehicleNo) errors.push({ field: 'Vehicle', msg: 'Required' });
        if (!data.driverName) errors.push({ field: 'Driver', msg: 'Required' });
        const w = D.weighTruck(data.grossKg, data.tareKg);
        if (!w.ok) errors.push({ field: 'Weight', msg: w.msg });
        if (!data.bagCount || data.bagCount < 1) errors.push({ field: 'Bags', msg: 'Enter the number of bags counted' });
        if (data.bagCount > Store.settings().maxBagsPerDelivery) errors.push({ field: 'Bags', msg: `More than ${Store.settings().maxBagsPerDelivery} bags — split the delivery` });
        if (data.outcome === 'OVERRIDE_FULL_PRICE' && !data.fillNote) errors.push({ field: 'Reason', msg: 'A written reason is required to override the price' });
        UI.showErrors(form, errors);
        if (errors.length) { UI.toast(errors[0].msg, 'danger'); return; }

        const validFills = fills.filter((n) => Number.isFinite(n));
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
          fillCheck, serials, allocations: [], farmerSplit: [],
          status: 'AWAITING_ACCEPTANCE',
          deliveredAt: new Date().toISOString(),
          receivedBy: Auth.current().email,
          notes: data.notes || '', fillNote: data.fillNote || '',
        }, 'delivery-create');

        VH.audit('delivery.create', 'delivery', delivery.id, `${receiptNo} · ${data.bagCount} bags · ${supplierName(delivery.supplierId)}`);
        UI.toast(`Delivery ${receiptNo} registered`, 'ok');
        App.navigate('deliveries');
        setTimeout(() => App.openDelivery(delivery.id), 120);
      });
    },
  });

  /* ============================= DELIVERIES ========================== */
  App.register('deliveries', {
    title: 'Deliveries',
    render(view) {
      const rows = Store.all('deliveries').slice().sort((a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt));
      const pending = rows.filter((r) => r.status === 'AWAITING_ACCEPTANCE');

      view.innerHTML = `
        <div class="toolbar">
          <div class="seg" role="tablist">
            ${['All', 'Awaiting acceptance', 'Accepted'].map((t, i) => {
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
    const tone = f.decision === 'PASS' || f.decision === 'PASS_MARGINAL' ? 'ok' : 'warn';
    const word = { PASS: 'full price', PASS_MARGINAL: 'full price', REDUCED_PRICE: 'reduced price', OVERRIDDEN: 'full price, by decision' }[f.decision] || 'reduced price';
    return `${badge(`${f.avgFillPct}%`, tone)}<div class="muted small">${esc(word)}</div>`;
  }

  /* ---------------------- delivery detail + actions ------------------ */
  App.openDelivery = function (id) {
    const d = Store.byId('deliveries', id);
    if (!d) return UI.toast('Delivery not found', 'danger');
    const sup = Store.byId('suppliers', d.supplierId) || {};
    const p = VH.paymentFor(d.id);
    const allocRows = (d.allocations || []).map((a) => `<tr><td>${esc(a.bayCode)}</td><td class="num">${a.bags}</td></tr>`).join('');
    const splitRows = (d.farmerSplit || []).map((f) => `<tr><td>${esc(f.code)}</td><td>${esc(f.name)}</td><td class="num">${f.bags}</td></tr>`).join('');
    const splitTotal = (d.farmerSplit || []).reduce((a, f) => a + Number(f.bags || 0), 0);

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
              <p>Unit price <b>${money(d.fillCheck.unitPrice)}</b> per bag<br/>Batch value <b>${money(d.fillCheck.amount)}</b></p>` : '<p class="muted">Not checked.</p>'}
            ${d.deductionPct ? `<p class="t-danger">Deducted <b>${d.deductionPct}%</b> (${money(d.deductionAmount)})<br/><span class="muted">${esc(d.deductionReason || '')}</span></p>
              <p>Payable <b>${money(VH.payable(d))}</b></p>` : ''}
          </div>
          <div class="nm-inset pad-sm">
            <h4>Allocation</h4>
            ${allocRows ? `<table class="mini"><thead><tr><th>Bay</th><th class="num">Bags</th></tr></thead><tbody>${allocRows}</tbody></table>` : '<p class="muted">No bay allocated yet.</p>'}
            <h4 style="margin-top:8px">Farmer split</h4>
            ${splitRows ? `<table class="mini"><thead><tr><th>Code</th><th>Farmer</th><th class="num">Bags</th></tr></thead><tbody>${splitRows}</tbody></table>
              <p class="small ${splitTotal === d.bagCount ? 't-ok' : 't-warn'}">${splitTotal} of ${d.bagCount} bags declared${splitTotal === d.bagCount ? ' ✓' : ' — complete before release'}</p>` : '<p class="muted">Not declared yet (required before payment release).</p>'}
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
        ${d.status === 'ACCEPTED' && Auth.can('payment.split') ? '<button class="nm-btn" data-act="split">Declare farmer split</button>' : ''}
      `,
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          if (!btn) return;
          const act = btn.dataset.act;
          if (act === 'print') return App.printReceipt(d.id);
          if (act === 'labels') return App.printLabels(d.id);
          if (act === 'accept') { close(); return App.acceptFlow(d.id); }
          if (act === 'split') { close(); return App.farmerSplitFlow(d.id); }
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
    const unitPrice = d.fillCheck ? d.fillCheck.unitPrice : s.unitPrice;
    const moisture = d.avgBagKg ? D.moistureFromWeight(d.avgBagKg, s) : null;
    const suggest = D.suggestedDeduction(moisture, s);

    UI.modal({
      title: `Accept ${d.receiptNo}`,
      size: 'lg',
      body: `
        <div class="form-errors" role="alert" id="accept-errors"></div>
        <p class="muted">Allocate ${d.bagCount} bags across the bays. The bags per bay must add up exactly.</p>
        <div class="nm-inset pad-sm">
          <table class="mini" id="alloc-table">
            <thead><tr><th>Bay</th><th>Bags in bay</th><th>Currently holds</th><th></th></tr></thead>
            <tbody>
              ${bays.map((b, i) => `<tr>
                <td>${esc(b.code)}</td>
                <td><input class="nm-input tiny-input" type="number" min="0" step="1" data-bay="${b.id}" value="${i === 0 ? d.bagCount : 0}" /></td>
                <td class="muted">${VH.bagsInBay(b.id).toLocaleString()} bags</td>
                <td class="muted small">cap. ${(b.capacityBags || 0).toLocaleString()}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr><th>Total</th><th id="alloc-total">${d.bagCount}</th><th colspan="2" id="alloc-hint" class="muted"></th></tr></tfoot>
          </table>
        </div>
        <h4>Deduction</h4>
        <p class="muted small">Every load is received. If this one is wet or below standard, take a percentage off its value here instead of sending it back.</p>
        ${d.avgBagKg ? VH.moistureScale(d.avgBagKg, { compact: true }) : ''}
        <div class="grid-2" style="margin-top:12px">
          ${UI.field('Deduct from this batch (%)', UI.input('deductionPct', { type: 'number', min: 0, max: 100, step: '0.5', value: suggest.pct }),
            suggest.pct ? `Suggested ${suggest.pct}% because the load reads ${esc(D.MOISTURE_LABEL[suggest.band])}. Change it, or set 0 for no deduction.` : 'No deduction suggested: the load reads dry enough.')}
          ${UI.field('Reason for the deduction', UI.input('deductionReason', { value: suggest.reason, placeholder: 'Wet load, foreign material…' }))}
        </div>
        <div class="calc-strip" id="deduct-out"></div>
        <div class="grid-2" style="margin-top:12px">
          ${UI.field('Bag serials on this truck', UI.textarea('serials', { rows: 3, value: (d.serials || []).join(' '), placeholder: 'EFPL-BG-000301-000480' }))}
          ${UI.field('Supervisor note', UI.textarea('acceptNote', { rows: 3, placeholder: 'Count verified, bags checked for damage…' }))}
        </div>
        <p class="small muted">Only serials already in the bag registry are attached. A serial that is unknown, or already sitting in a bay, is skipped and reported.</p>`,
      footer: `<button class="nm-btn" data-close>Cancel</button>
               <button class="nm-btn primary" data-act="accept">Accept and create payment</button>`,
      onMount(el, close) {
        const totalEl = el.querySelector('#alloc-total');
        const hintEl = el.querySelector('#alloc-hint');
        const recalc = () => {
          const total = UI.$$('[data-bay]', el).reduce((a, i) => a + (Number(i.value) || 0), 0);
          totalEl.textContent = total;
          const diff = total - d.bagCount;
          hintEl.textContent = diff === 0 ? 'balanced ✓' : `${diff > 0 ? '+' : ''}${diff} bags`;
          hintEl.className = diff === 0 ? 't-ok' : 't-warn';
        };
        UI.$$('[data-bay]', el).forEach((i) => i.addEventListener('input', recalc));
        recalc();

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
          for (const a of allocs) {
            const existing = VH.bagsInBay(a.bayId);
            const bay = Store.byId('bays', a.bayId);
            if (bay && bay.capacityBags && existing + a.bags > bay.capacityBags) {
              errors.push({ field: bay.code, msg: `Only ${bay.capacityBags - existing} bags of space left` });
            }
          }
          const m = money$();
          const rawPct = Number(pctEl.value);
          const deductionReason = el.querySelector('[name=deductionReason]').value.trim();
          if (pctEl.value !== '' && (!Number.isFinite(rawPct) || rawPct < 0 || rawPct > 100)) errors.push({ field: 'Deduction', msg: 'Enter a percentage between 0 and 100' });
          if (m.deductionPct > 0 && !deductionReason) errors.push({ field: 'Deduction', msg: 'Write the reason for the deduction — the supplier will see it on the payment slip' });

          const serials = VH.parseSerials(el.querySelector('[name=serials]').value, prefix);
          if (serials.length > d.bagCount) errors.push({ field: 'Serials', msg: `${serials.length} serials entered but only ${d.bagCount} bags were counted` });

          UI.showErrors(el.querySelector('#accept-errors').parentNode, errors);
          if (errors.length) { el.querySelector('.modal-body').scrollTop = 0; return; }

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
              status: 'STORED', supplierId: d.supplierId, deliveryId: d.id, farmerId: null, usageId: null,
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
            status: 'DRAFT', createdAt: now,
            history: [{ at: now, by: Auth.current().email, action: 'CREATED',
              note: `Generated on acceptance of ${d.receiptNo}${m.deductionPct ? ` · ${m.deductionPct}% deducted: ${deductionReason}` : ''}` }],
          }, 'payment-create');

          const splitTotal = (d.farmerSplit || []).reduce((a, f) => a + Number(f.bags || 0), 0);
          if (splitTotal === d.bagCount) {
            Store.update('payments', payment.id, { status: 'PENDING_SUPERVISOR' }, 'payment-submit');
          }

          Store.update('deliveries', d.id, {
            status: 'ACCEPTED', acceptedAt: new Date().toISOString(), acceptedBy: Auth.current().email,
            allocations: allocs, serials: taken, acceptNote: el.querySelector('[name=acceptNote]').value.trim(),
            deductionPct: m.deductionPct, deductionReason: m.deductionPct ? deductionReason : '',
            deductionAmount: m.deductions, payableAmount: m.netAmount, rejectedReason: null,
          }, 'delivery-accept');

          VH.audit('delivery.accept', 'delivery', d.id,
            `${d.receiptNo} accepted · ${d.bagCount} bags · ${allocs.map((a) => `${a.bayCode}:${a.bags}`).join(', ')} · ${money(payment.netAmount)}${m.deductionPct ? ` · ${m.deductionPct}% deducted (${deductionReason})` : ''}`);
          VH.audit('payment.create', 'payment', payment.id, `${paymentNo} created for ${sup.name} · ${money(payment.netAmount)}`);

          UI.toast(`Accepted. ${attached} bag serials stored, payment ${paymentNo} created`, 'ok', 5000);
          if (unknown.length) UI.toast(`${unknown.length} serial(s) are not in the bag registry and were skipped`, 'warn', 6000);
          if (busy.length) UI.toast(`${busy.length} serial(s) are already in a bay or in use and were skipped (first: ${busy[0]})`, 'warn', 7000);
          close();
          App.refresh();
        });
      },
    });
  };

  /* --------------------------- farmer split -------------------------- */
  App.farmerSplitFlow = function (id) {
    const d = Store.byId('deliveries', id);
    if (!d) return;
    const sup = Store.byId('suppliers', d.supplierId) || {};
    const farmers = Store.where('farmers', (f) => !f.deleted && (f.supplierId === d.supplierId || (sup.isFarmer && sup.farmerId && f.id === sup.farmerId)));
    const current = {};
    for (const f of d.farmerSplit || []) current[f.farmerId] = f.bags;

    UI.modal({
      title: `Farmer declaration · ${d.receiptNo}`,
      size: 'lg',
      body: `<p class="muted">The supplier declares how many bags came from each farmer before the payment can move. The total must equal <b>${d.bagCount}</b> bags.</p>
        ${sup.isFarmer ? `<p class="small">${esc(sup.name)} is registered as a farmer as well, so he can appear in this list.</p>` : ''}
        <div class="form-errors" role="alert" id="split-errors"></div>
        <div class="nm-inset pad-sm">
          <table class="mini"><thead><tr><th>Code</th><th>Farmer</th><th>Village</th><th class="num">Bags</th></tr></thead>
          <tbody>${farmers.map((f) => `<tr>
            <td>${esc(f.code)}</td><td>${esc(f.name)}</td><td class="muted">${esc(f.village || '')}</td>
            <td class="num"><input class="nm-input tiny-input" type="number" min="0" step="1" data-farmer="${f.id}" value="${current[f.id] || 0}" /></td>
          </tr>`).join('') || '<tr><td colspan="4" class="muted">No farmers registered under this supplier.</td></tr>'}</tbody>
          <tfoot><tr><th colspan="3">Total</th><th class="num" id="split-total">0</th></tr></tfoot></table>
        </div>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save declaration</button>',
      onMount(el, close) {
        const recalc = () => {
          const total = UI.$$('[data-farmer]', el).reduce((a, i) => a + (Number(i.value) || 0), 0);
          const t = el.querySelector('#split-total');
          t.textContent = total;
          t.className = total === d.bagCount ? 'num t-ok' : 'num t-warn';
        };
        UI.$$('[data-farmer]', el).forEach((i) => i.addEventListener('input', recalc));
        recalc();
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const splits = UI.$$('[data-farmer]', el).map((i) => {
            const f = Store.byId('farmers', i.dataset.farmer);
            return { farmerId: i.dataset.farmer, code: f.code, name: f.name, bags: Number(i.value) || 0 };
          }).filter((s) => s.bags > 0);
          const total = splits.reduce((a, s) => a + s.bags, 0);
          if (total !== d.bagCount) {
            UI.showErrors(el, [`Declared ${total} bags but ${d.bagCount} were delivered.`]);
            return;
          }
          Store.update('deliveries', d.id, { farmerSplit: splits }, 'farmer-split');
          // allocate farmer ownership onto the bag records where we know the serials
          const bags = Store.where('bags', (b) => b.deliveryId === d.id);
          let idx = 0;
          for (const s of splits) {
            for (let i = 0; i < s.bags && idx < bags.length; i++, idx++) {
              bags[idx].farmerId = s.farmerId;
              bags[idx].updatedAt = new Date().toISOString();
              Store.markDirty('bags', bags[idx].id);
            }
          }
          const p = VH.paymentFor(d.id);
          if (p && p.status === 'DRAFT') Store.update('payments', p.id, { status: 'PENDING_SUPERVISOR' }, 'payment-submit');
          VH.audit('payment.split', 'delivery', d.id, `Farmer split declared · ${splits.map((s) => `${s.code}:${s.bags}`).join(', ')}`);
          UI.toast('Farmer declaration saved' + (p && p.status === 'DRAFT' ? ' — payment sent for authorisation' : ''), 'ok');
          close(); App.refresh();
        });
      },
    });
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
          <th>Unit price</th><td>${money((d.fillCheck && d.fillCheck.unitPrice) || Store.settings().unitPrice)}</td></tr>
        <tr><th>Moisture (from bag weight)</th><td>${d.avgBagKg ? D.moistureFromWeight(d.avgBagKg, Store.settings()) + '%' : '—'}</td>
          <th>Batch value</th><td>${money((d.fillCheck && d.fillCheck.amount) || 0)}</td></tr>
        ${d.deductionPct ? `<tr><th>Deduction</th><td>${d.deductionPct}% · ${money(d.deductionAmount)}</td><th>Reason</th><td>${esc(d.deductionReason || '')}</td></tr>` : ''}
        <tr><th>Payable</th><td colspan="3"><b>${d.status === 'ACCEPTED' ? money(VH.payable(d)) : 'Set when the supervisor accepts the load'}</b></td></tr>
        ${(d.allocations || []).length ? `<tr><th>Bays</th><td colspan="3">${d.allocations.map((a) => `${esc(a.bayCode)}: ${a.bags} bags`).join(' · ')}</td></tr>` : ''}
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

  /** Sticker sheet — req 12/13 plus the WhatsApp tag decision. */
  App.printLabels = function (id) {
    const d = Store.byId('deliveries', id);
    if (!d) return;
    const sup = Store.byId('suppliers', d.supplierId) || {};
    const s = Store.settings();
    let serials = d.serials && d.serials.length ? d.serials : [];
    if (!serials.length) {
      serials = Array.from({ length: Math.min(d.bagCount || 12, 48) }, (_, i) => `${s.bagSerialPrefix}-(new ${i + 1})`);
    }
    const sheet = serials.slice(0, 96).map((sn) => `
      <div class="sticker">
        <div class="co">EnerFab Biomass</div>
        <div class="serial">${esc(String(sn).replace('(new ', '').replace(')', ''))}</div>
        ${D.code39SVG(String(sn).replace(/[^A-Z0-9-]/gi, ''), { height: 34, narrow: 1.6, quiet: 6 })}
        <div class="sub">Supplier: <b>${esc(sup.code || '')}</b></div>
        <div class="sub">Receipt: <b>${esc(d.receiptNo)}</b></div>
        <div class="write">Farmer reg. no: ______________________<br/>Supplier no: _______________________</div>
      </div>`).join('');
    UI.print(`<div class="sheet">${sheet}</div>`, `Bag labels ${d.receiptNo}`);
    VH.audit('delivery.labels', 'delivery', d.id, `${serials.length} bag labels printed`);
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
              <div><span class="muted small">Farmer</span><b>${r.farmer ? esc(`${r.farmer.code} · ${r.farmer.name}`) : 'not declared'}</b></div>
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
