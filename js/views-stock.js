/* =====================================================================
   views-stock.js — bag registry, bays, and the gasifier issue cycle.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG, Store = window.Store, Auth = window.Auth,
    UI = window.UI, D = window.Domain, App = window.App, VH = window.VH;
  const { esc, money, kg, dt, dOnly, badge } = UI;

  const supplierName = (id) => (Store.byId('suppliers', id) || {}).name || '—';

  /** Average arrival weight per bag for the bags now in a bay (weighted by bag). */
  function bayAvgKg(bags) {
    let sum = 0, n = 0;
    const cache = {};
    for (const b of bags) {
      if (!b.deliveryId) continue;
      if (!(b.deliveryId in cache)) cache[b.deliveryId] = (Store.byId('deliveries', b.deliveryId) || {}).avgBagKg || null;
      if (cache[b.deliveryId]) { sum += cache[b.deliveryId]; n++; }
    }
    return n ? D.round2(sum / n) : null;
  }

  /* ============================ BAG REGISTRY ========================= */
  App.register('bags', {
    title: 'Bag registry',
    render(view) {
      const s = Store.settings();
      const bags = Store.all('bags');
      const counts = {};
      for (const b of bags) counts[b.status] = (counts[b.status] || 0) + 1;

      view.innerHTML = `
        <section class="stats stats-4">
          ${UI.stat('Numbered bags in store', (counts.IN_STOCK || 0).toLocaleString(), 'ready to issue')}
          ${UI.stat('With suppliers', (counts.ISSUED || 0).toLocaleString(), 'out on a filling round', counts.ISSUED ? 'warn' : null)}
          ${UI.stat('In bays', (counts.STORED || 0).toLocaleString(), 'filled and stored')}
          ${UI.stat('Emptied, awaiting check', `${((counts.CONSUMED || 0) + (counts.RETURNED || 0)).toLocaleString()}`, `${counts.DAMAGED || 0} damaged`, counts.DAMAGED ? 'warn' : null)}
        </section>

        <div class="toolbar">
          <div class="toolbar-left">
            <input class="nm-input search" id="bag-search" placeholder="Search a serial or farmer…" />
            ${UI.select('bagStatus', [
              { value: '', label: 'All statuses' },
              ...Object.keys(D.BAG_STATUS).map((k) => ({ value: k, label: D.BAG_STATUS_LABEL[k] })),
            ], { id: 'bag-status' })}
          </div>
          <div class="toolbar-right">
            ${Auth.can('bag.generate') ? '<button class="nm-btn" id="gen-bags"><i class="i i-plus"></i>Number new bags</button>' : ''}
            ${Auth.can('bag.issue') ? '<button class="nm-btn primary" id="issue-bags">Issue to supplier</button>' : ''}
          </div>
        </div>
        <div id="bag-table"></div>
        <p class="muted small">Showing the first 200 matches. Use the search box to narrow the list — the registry holds ${bags.length.toLocaleString()} serials.</p>`;

      let filterStatus = '';
      let query = '';

      const draw = () => {
        let list = bags;
        if (filterStatus) list = list.filter((b) => b.status === filterStatus);
        if (query) {
          const q = query.toLowerCase();
          list = list.filter((b) => String(b.serial).toLowerCase().includes(q)
            || (b.farmerId && ((Store.byId('farmers', b.farmerId) || {}).name || '').toLowerCase().includes(q))
            || (b.supplierId && supplierName(b.supplierId).toLowerCase().includes(q)));
        }
        const shown = list.slice(0, 200);
        view.querySelector('#bag-table').innerHTML = UI.table({
          rows: shown,
          empty: 'No bags match that search.',
          rowKey: (r) => r.serial,
          columns: [
            { label: 'Serial', render: (r) => `<b class="mono">${esc(r.serial)}</b>` },
            { label: 'Status', render: (r) => badge(D.BAG_STATUS_LABEL[r.status] || r.status, UI.statusTone(r.status)) },
            { label: 'Supplier', render: (r) => esc(r.supplierId ? supplierName(r.supplierId) : '—') },
            { label: 'Farmer', render: (r) => esc(r.farmerId ? ((Store.byId('farmers', r.farmerId) || {}).name || '—') : '—') },
            { label: 'Bay', render: (r) => esc(r.bayCode || '—') },
            { label: 'Updated', render: (r) => `<span class="muted small">${esc(dOnly(r.updatedAt))}</span>` },
            { label: '', cls: 'actions', render: (r) => `<button class="nm-btn tiny" data-trace="${esc(r.serial)}">Trace</button>` },
          ],
        });
        UI.$$('[data-trace]', view).forEach((b) => b.addEventListener('click', () => {
          App.navigate('trace', () => {
            const inp = document.getElementById('trace-input');
            if (inp) { inp.value = b.dataset.trace; document.getElementById('trace-go').click(); }
          });
        }));
      };
      draw();

      view.querySelector('#bag-search').addEventListener('input', UI.debounce((e) => { query = e.target.value.trim(); draw(); }, 200));
      view.querySelector('#bag-status').addEventListener('change', (e) => { filterStatus = e.target.value; draw(); });

      const gen = view.querySelector('#gen-bags');
      if (gen) gen.addEventListener('click', () => App.generateBags());
      const issue = view.querySelector('#issue-bags');
      if (issue) issue.addEventListener('click', () => App.issueBags());
    },
  });

  /* ---------------------------- numbering ---------------------------- */
  App.generateBags = function () {
    const s = Store.settings();
    const bags = Store.all('bags');
    const maxN = bags.reduce((a, b) => Math.max(a, D.parseSerialNumber(b.serial, s.bagSerialPrefix) || 0), 0);

    UI.modal({
      title: 'Number a batch of bags',
      body: `<p class="muted">The supplier's bags are printed and tagged <b>before</b> they leave the store — that is what makes the number on the tag reliable.</p>
        ${UI.field('How many bags?', UI.input('qty', { type: 'number', min: 1, max: 20000, value: 5000 }), `Next serial will be <b>${esc(D.bagSerial(s.bagSerialPrefix, maxN + 1))}</b>`)}
        ${UI.field('Serial prefix', UI.input('prefix', { value: s.bagSerialPrefix }))}
        <div class="calc-strip" id="gen-preview"></div>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="gen">Number the bags</button>',
      onMount(el, close) {
        const qtyEl = el.querySelector('[name=qty]');
        const prefixEl = el.querySelector('[name=prefix]');
        const preview = () => {
          const qty = Math.max(1, Math.min(20000, Number(qtyEl.value) || 0));
          const prefix = (prefixEl.value || s.bagSerialPrefix).toUpperCase();
          el.querySelector('#gen-preview').innerHTML = `
            <div><span class="muted small">First</span><b>${esc(D.bagSerial(prefix, maxN + 1))}</b></div>
            <div><span class="muted small">Last</span><b>${esc(D.bagSerial(prefix, maxN + qty))}</b></div>
            <div><span class="muted small">Total after</span><b>${(bags.length + qty).toLocaleString()}</b></div>`;
        };
        qtyEl.addEventListener('input', preview); prefixEl.addEventListener('input', preview); preview();

        el.querySelector('[data-act=gen]').addEventListener('click', () => {
          const qty = Math.max(1, Math.min(20000, Number(qtyEl.value) || 0));
          const prefix = (prefixEl.value || s.bagSerialPrefix).toUpperCase().replace(/[^A-Z0-9-]/g, '');
          const existing = new Set(bags.map((b) => b.serial));
          const records = [];
          for (let i = 1; i <= qty; i++) {
            const serial = D.bagSerial(prefix, maxN + i);
            if (existing.has(serial)) continue;
            records.push({ serial, status: 'IN_STOCK', condition: 'GOOD', batchStart: D.bagSerial(prefix, maxN + 1) });
          }
          Store.bulkAdd('bags', records, 'bag-generate');
          VH.audit('bag.generate', 'bags', 'batch', `${records.length} bags numbered ${records[0].serial} … ${records[records.length - 1].serial}`);
          UI.toast(`${records.length.toLocaleString()} bags numbered`, 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  /* ------------------------- issue to supplier ----------------------- */
  App.issueBags = function () {
    const s = Store.settings();
    const available = Store.where('bags', (b) => b.status === 'IN_STOCK');
    const lastRound = Store.all('bagIssues').reduce((a, i) => Math.max(a, i.roundNo || 0), 0);

    UI.modal({
      title: 'Issue numbered bags to a supplier',
      size: 'md',
      body: `<p class="muted">A bag round is the same numbered bags travelling out and coming back filled. The supplier writes his number and the farmer's registration number on the tag before delivering.</p>
        ${UI.field('Supplier', UI.select('supplierId', VH.supplierOptions(), { required: true, placeholder: 'Select supplier…' }))}
        <div class="grid-2">
          ${UI.field('Round number', UI.input('roundNo', { type: 'number', min: 1, value: lastRound + 1 }))}
          ${UI.field('How many bags?', UI.input('qty', { type: 'number', min: 1, max: 5000, value: Math.min(300, available.length) }), `${available.length.toLocaleString()} numbered bags available`)}
        </div>
        ${UI.field('How is the number shared?', UI.select('sharedWith', [
          { value: 'Printed allocation slip', label: 'Printed allocation slip' },
          { value: 'Printed allocation slip + WhatsApp', label: 'Printed allocation slip + WhatsApp' },
          { value: 'WhatsApp list only', label: 'WhatsApp list only' },
        ]))}
        <div class="nm-card pad-sm tip">
          <b>Why a serial only?</b>
          <p class="small muted">As agreed on site: a bag carries one serial number and nothing else. Farmer and supplier numbers are written in the blank box on the sticker at delivery, so a bag can move between farmers in the second round without a reprint.</p>
        </div>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="issue">Issue bags</button>',
      onMount(el, close) {
        el.querySelector('[data-act=issue]').addEventListener('click', () => {
          const supplierId = el.querySelector('[name=supplierId]').value;
          const qty = Number(el.querySelector('[name=qty]').value) || 0;
          const roundNo = Number(el.querySelector('[name=roundNo]').value) || lastRound + 1;
          const sharedWith = el.querySelector('[name=sharedWith]').value;
          if (!supplierId) return UI.toast('Choose a supplier', 'warn');
          if (qty < 1) return UI.toast('Enter how many bags', 'warn');
          const pool = Store.where('bags', (b) => b.status === 'IN_STOCK').slice(0, qty);
          if (!pool.length) return UI.toast('No numbered bags left in the store — number a new batch first', 'danger');

          const now = new Date().toISOString();
          for (const b of pool) {
            Object.assign(b, { status: 'ISSUED', supplierId, supplierCode: (Store.byId('suppliers', supplierId) || {}).code, issuedAt: now, roundNo, updatedAt: now });
            Store.markDirty('bags', b.id);
          }
          const issue = Store.add('bagIssues', {
            roundNo, supplierId, qty: pool.length, mode: 'SERIAL_ONLY',
            serials: pool.map((b) => b.serial), issuedAt: now, issuedBy: Auth.current().email, sharedWith,
          }, 'bag-issue');
          for (const b of pool) { b.bagIssueId = issue.id; Store.markDirty('bags', b.id); }
          Store.save('bag-issue');

          VH.audit('bag.issue', 'bagIssue', issue.id, `Round ${roundNo} · ${pool.length} bags to ${supplierName(supplierId)} (${pool[0].serial} … ${pool[pool.length - 1].serial})`);
          UI.toast(`${pool.length} bags issued to ${supplierName(supplierId)}`, 'ok');
          close();
          App.refresh();
          App.printAllocationSlip(issue.id);
        });
      },
    });
  };

  App.printAllocationSlip = function (issueId) {
    const issue = Store.byId('bagIssues', issueId);
    if (!issue) return;
    const sup = Store.byId('suppliers', issue.supplierId) || {};
    const farmers = Store.where('farmers', (f) => f.supplierId === issue.supplierId);
    const list = issue.serials;
    const html = `${VH.printHeader('Bag allocation slip', `Round ${issue.roundNo} · ${sup.code} ${sup.name} · ${dt(issue.issuedAt)}`)}
      <p class="meta">${list.length} numbered bags issued. Every bag carries the serial below. Please write the <b>farmer registration number</b> and your <b>supplier number</b> in the box on the bag tag before delivering.</p>
      <table><thead><tr><th>#</th><th>Serial</th><th>Farmer reg. no (write on tag)</th><th>#</th><th>Serial</th><th>Farmer reg. no</th></tr></thead>
        <tbody>${Array.from({ length: Math.ceil(Math.min(list.length, 240) / 2) }, (_, i) => `
          <tr><td>${i + 1}</td><td class="mono">${esc(list[i])}</td><td></td>
              <td>${i + 1 + Math.ceil(Math.min(list.length, 240) / 2)}</td>
              <td class="mono">${esc(list[i + Math.ceil(Math.min(list.length, 240) / 2)] || '')}</td><td></td></tr>`).join('')}
        </tbody></table>
      <h2>Farmer reference (${farmers.length})</h2>
      <p class="meta">${farmers.map((f) => `${esc(f.code)} · ${esc(f.farmerNo || '')} · ${esc(f.name)}`).join(' &nbsp;|&nbsp; ')}</p>
      <div class="sign">Supplier acknowledgement</div>`;
    UI.print(html, `Allocation slip round ${issue.roundNo}`);
    VH.audit('bag.issue.print', 'bagIssue', issue.id, `Allocation slip for round ${issue.roundNo} printed`);
  };

  /* ================================ BAYS ============================= */
  App.register('bays', {
    title: 'Bays & stock',
    render(view) {
      const s = Store.settings();
      const bays = Store.where('bays', (b) => !b.deleted);
      const stock = bays.map((b) => {
        const bags = Store.where('bags', (x) => x.bayId === b.id && x.status === 'STORED');
        return { bay: b, bags };
      });

      view.innerHTML = `
        <div class="toolbar">
          <p class="muted">Stock is counted from the bag serials in each bay, so it updates every time a bag moves.</p>
          <div class="toolbar-right">${Auth.can('bay.allocate') ? '<button class="nm-btn" id="add-bay"><i class="i i-plus"></i>Add bay</button>' : ''}</div>
        </div>
        <div class="bay-grid">
          ${stock.map(({ bay, bags }) => {
            const pctFull = Math.min(100, Math.round((bags.length / (bay.capacityBags || 1)) * 100));
            const byType = {};
            for (const bag of bags) {
              const d = Store.byId('deliveries', bag.deliveryId);
              const t = d ? d.biomassType : 'UNKNOWN';
              byType[t] = (byType[t] || 0) + 1;
            }
            const oldest = bags.slice().sort((a, b) => Date.parse(a.deliveredAt || 0) - Date.parse(b.deliveredAt || 0))[0];
            const avgKg = bayAvgKg(bags);
            return `<div class="nm-card pad bay-card">
              <div class="bay-head"><div><h3>${esc(bay.code)}</h3><span class="muted small">${esc(bay.name || '')}</span></div>
                ${badge(`${bags.length.toLocaleString()} bags`, bags.length ? 'ok' : 'muted')}</div>
              <div class="meter big"><span style="width:${pctFull}%"></span></div>
              <p class="muted small">${pctFull}% of ${(bay.capacityBags || 0).toLocaleString()} bag capacity${oldest && oldest.deliveredAt ? `, oldest from ${dOnly(oldest.deliveredAt)}` : ''}</p>
              ${avgKg ? `<p class="small">${VH.moistureBadge(D.moistureFromWeight(avgKg, s))} <span class="muted">at ${avgKg} kg per bag on arrival</span></p>` : ''}
              <div class="chips">${Object.entries(byType).map(([t, n]) => `<span class="chip">${esc(VH.typeLabel(t))} · ${n}</span>`).join('') || '<span class="muted small">Empty</span>'}</div>
              <div class="bay-actions">
                ${Auth.can('usage.request') ? `<button class="nm-btn tiny" data-issue="${bay.id}" ${bags.length ? '' : 'disabled'}><i class="i i-flame"></i>Request issue</button>` : ''}
                <button class="nm-btn tiny" data-view="${bay.id}">View bags</button>
              </div>
            </div>`;
          }).join('')}
        </div>`;

      UI.$$('[data-issue]', view).forEach((b) => b.addEventListener('click', () => App.requestUsage(b.dataset.issue)));
      UI.$$('[data-view]', view).forEach((b) => b.addEventListener('click', () => {
        const bay = Store.byId('bays', b.dataset.view);
        const bags = Store.where('bags', (x) => x.bayId === bay.id && x.status === 'STORED').slice(0, 100);
        UI.modal({
          title: `${bay.code} — ${bags.length} bags shown`,
          size: 'md',
          body: UI.table({
            rows: bags, rowKey: (r) => r.serial,
            columns: [
              { label: 'Serial', render: (r) => `<span class="mono">${esc(r.serial)}</span>` },
              { label: 'Supplier', render: (r) => esc(supplierName(r.supplierId)) },
              { label: 'Farmer', render: (r) => esc((Store.byId('farmers', r.farmerId) || {}).name || '—') },
              { label: 'Received', render: (r) => `<span class="muted small">${esc(dOnly(r.deliveredAt))}</span>` },
            ],
          }),
        });
      }));

      const addBay = view.querySelector('#add-bay');
      if (addBay) addBay.addEventListener('click', () => {
        UI.modal({
          title: 'Add a bay',
          size: 'sm',
          body: `<div class="form-errors" role="alert"></div>
            ${UI.field('Bay code', UI.input('code', { value: `BAY-${bays.length + 1}`, required: true }))}
            ${UI.field('Name', UI.input('name', { value: `Bay ${bays.length + 1}` }))}
            ${UI.field('Capacity (bags)', UI.input('capacityBags', { type: 'number', min: 1, value: 600, required: true }))}`,
          footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Add bay</button>',
          onMount(el, close) {
            el.querySelector('[data-act=save]').addEventListener('click', () => {
              const f = UI.formData(el.querySelector('.modal-body'));
              const code = String(f.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
              const cap = Number(f.capacityBags) || 0;
              const errors = [];
              if (!code) errors.push('Enter a bay code');
              if (bays.some((b) => b.code === code)) errors.push(`${code} already exists`);
              if (cap < 1) errors.push('Enter the capacity in bags');
              UI.showErrors(el, errors);
              if (errors.length) return;
              Store.add('bays', { code, name: f.name || code, capacityBags: cap }, 'bay-create');
              VH.audit('bay.create', 'bay', code, `Capacity ${cap} bags`);
              UI.toast('Bay added', 'ok');
              close(); App.refresh();
            });
          },
        });
      });
    },
  });

  /* ============================== GASIFIER =========================== */
  App.register('gasifier', {
    title: 'Gasifier issue',
    render(view) {
      const s = Store.settings();
      const requests = Store.all('usageRequests').slice().sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
      const open = requests.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED');
      const bays = Store.where('bays', (b) => !b.deleted).map((b) => {
        const bags = Store.where('bags', (x) => x.bayId === b.id && x.status === 'STORED');
        return { bay: b, count: bags.length, avgKg: bayAvgKg(bags) };
      });

      view.innerHTML = `
        <section class="nm-card pad">
          <div class="card-head"><h3>Which bay to draw from</h3>
            ${Auth.can('usage.request') ? '<button class="nm-btn primary" id="new-usage"><i class="i i-plus"></i>New issue request</button>' : ''}</div>
          <p class="muted">The supervisor picks the bay after weighing a bag: the heavier the bag, the wetter the biomass. Wet stock is left to dry or mixed with a drier bay.</p>
          <div class="bay-grid tight">
            ${bays.map(({ bay, count, avgKg }) => {
              const moisture = avgKg ? D.moistureFromWeight(avgKg, s) : null;
              const band = D.moistureBand(moisture, s);
              return `<div class="nm-inset pad-sm bay-mini">
                <div class="bay-head"><b>${esc(bay.code)}</b>${badge(`${count} bags`, count ? 'ok' : 'muted')}</div>
                <div class="bay-mini-row"><span class="muted small">Average bag</span><b>${avgKg ? `${avgKg} kg` : '—'}</b></div>
                <div class="bay-mini-row"><span class="muted small">Moisture</span><b class="t-${D.moistureTone(band)}">${moisture === null ? '—' : `${moisture}% · ${D.MOISTURE_LABEL[band]}`}</b></div>
              </div>`;
            }).join('')}
          </div>
        </section>

        ${open.length ? `<section class="nm-card pad">
          <h3>Open requests (${open.length})</h3>
          <div class="request-list">${open.map((r) => `
            <div class="request-row">
              <div><b>${esc(r.requestNo)}</b>, ${esc(r.bayCode)}, ${r.bags} bags ${badge(r.status === 'PENDING' ? 'Waiting for the supervisor' : 'Approved, ready to weigh', r.status === 'PENDING' ? 'warn' : 'ok')}
                <div class="muted small">requested by ${esc(r.requestedBy)}, ${esc(dt(r.requestedAt))}</div>
                ${r.note ? `<div class="small">“${esc(r.note)}”</div>` : ''}
                ${r.approvedNote ? `<div class="small">Supervisor: ${esc(r.approvedNote)}</div>` : ''}</div>
              <div class="request-actions">
                ${r.status === 'PENDING' && Auth.can('usage.approve') ? `<button class="nm-btn tiny primary" data-approve="${r.id}">Approve and choose bay</button>` : ''}
                ${r.status === 'APPROVED' && Auth.can('usage.consume') ? `<button class="nm-btn tiny primary" data-consume="${r.id}">Weigh and consume</button>` : ''}
              </div>
            </div>`).join('')}</div>
        </section>` : ''}

        <section class="nm-card pad">
          <h3>Issue history</h3>
          ${UI.table({
            rows: requests.filter((r) => r.status === 'CONSUMED').slice(0, 40),
            empty: 'Nothing issued to the gasifier yet.',
            rowKey: (r) => r.id,
            columns: [
              { label: 'Request', render: (r) => `<b>${esc(r.requestNo)}</b><div class="muted small">${esc(dOnly(r.consumedAt || r.requestedAt))}</div>` },
              { label: 'Bay', render: (r) => esc(r.bayCode) },
              { label: 'Bags', cls: 'num', render: (r) => r.bags },
              { label: 'Sample weights', render: (r) => esc((r.sampleBags || []).join(' / ') || '—') },
              { label: 'Avg bag', cls: 'num', render: (r) => (r.avgBagKg ? `${r.avgBagKg} kg` : '—') },
              { label: 'Moisture', render: (r) => VH.moistureBadge(r.avgBagKg ? D.moistureFromWeight(r.avgBagKg, s) : null) },
              { label: 'Out weight', cls: 'num', render: (r) => (r.totalKg ? kg(r.totalKg) : '—') },
            ],
          })}
        </section>`;

      const nw = view.querySelector('#new-usage');
      if (nw) nw.addEventListener('click', () => App.requestUsage(null));
      UI.$$('[data-approve]', view).forEach((b) => b.addEventListener('click', () => App.approveUsage(b.dataset.approve)));
      UI.$$('[data-consume]', view).forEach((b) => b.addEventListener('click', () => App.consumeUsage(b.dataset.consume)));
    },
  });

  App.requestUsage = function (bayId) {
    const bays = Store.where('bays', (b) => !b.deleted)
      .filter((b) => VH.bagsInBay(b.id) > 0)
      .map((b) => ({ value: b.id, label: `${b.code} — ${VH.bagsInBay(b.id)} bags` }));
    if (!bays.length) return UI.toast('No bay has stock to issue', 'warn');
    UI.modal({
      title: 'Request biomass for the gasifier',
      body: `${UI.field('Bay requested', UI.select('bayId', bays, { value: bayId || bays[0].value, required: true }))}
        ${UI.field('Number of bags', UI.input('bags', { type: 'number', min: 1, value: 30, required: true }))}
        ${UI.field('Note for the supervisor', UI.input('note', { placeholder: 'Night shift requirement…' }))}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Send for approval</button>',
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const bayIdv = el.querySelector('[name=bayId]').value;
          const bay = Store.byId('bays', bayIdv);
          const bags = Number(el.querySelector('[name=bags]').value) || 0;
          if (bags < 1) return UI.toast('Enter a bag count', 'warn');
          if (bags > VH.bagsInBay(bayIdv)) return UI.toast(`Only ${VH.bagsInBay(bayIdv)} bags in ${bay.code}`, 'danger');
          const rec = Store.add('usageRequests', {
            requestNo: 'USE-' + String(Store.nextSeq('usage', 1)).padStart(4, '0'),
            bayId: bayIdv, bayCode: bay.code, bags,
            requestedBy: Auth.current().email, requestedAt: new Date().toISOString(),
            status: 'PENDING', note: el.querySelector('[name=note]').value.trim(),
          }, 'usage-request');
          VH.audit('usage.request', 'usage', rec.id, `${rec.requestNo} · ${bags} bags from ${bay.code}`);
          UI.toast('Request sent to the supervisor', 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  App.approveUsage = function (id) {
    const r = Store.byId('usageRequests', id);
    if (!r) return;
    const s = Store.settings();
    const bays = Store.where('bays', (b) => !b.deleted).map((b) => {
      const count = VH.bagsInBay(b.id);
      const bags = Store.where('bags', (x) => x.bayId === b.id && x.status === 'STORED');
      const avg = bayAvgKg(bags);
      return { bay: b, count, avg, moisture: avg ? D.moistureFromWeight(avg, s) : null };
    });

    UI.modal({
      title: `Approve ${r.requestNo}`,
      size: 'lg',
      body: `<p class="muted">Weigh a bag from each candidate bay and pick the driest suitable stock. The operator's request was for <b>${r.bags} bags</b> from ${esc(r.bayCode)}.</p>
        <div class="nm-inset pad-sm">
          <table class="mini"><thead><tr><th>Use</th><th>Bay</th><th class="num">Bags</th><th class="num">Avg bag</th><th>Moisture</th><th>Test bag weight (kg)</th></tr></thead>
          <tbody>${bays.map((b) => {
            const band = D.moistureBand(b.moisture, s);
            return `<tr>
              <td><input type="radio" name="pick" value="${b.bay.id}" ${b.bay.id === r.bayId ? 'checked' : ''} ${b.count ? '' : 'disabled'} /></td>
              <td><b>${esc(b.bay.code)}</b></td>
              <td class="num">${b.count}</td>
              <td class="num">${b.avg ? `${b.avg} kg` : '—'}</td>
              <td data-moist="${b.bay.id}">${VH.moistureBadge(b.moisture)}</td>
              <td><input class="nm-input tiny-input" type="number" step="0.01" min="0" data-test="${b.bay.id}" placeholder="kg" /></td>
            </tr>`;
          }).join('')}</tbody></table>
        </div>
        <p class="small muted">Type a test bag weight and the moisture for that bay updates from it (18 kg is 20%, 36 kg is 60%).</p>
        ${UI.field('Supervisor note', UI.textarea('note', { rows: 2, placeholder: 'Bay 1 is drier; mix 1:2 with Bay 4…' }))}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="ok">Approve</button>',
      onMount(el, close) {
        UI.$$('[data-test]', el).forEach((inp) => inp.addEventListener('input', () => {
          const b = bays.find((x) => x.bay.id === inp.dataset.test);
          const w = Number(inp.value);
          const cell = el.querySelector(`[data-moist="${inp.dataset.test}"]`);
          if (cell) cell.innerHTML = VH.moistureBadge(w > 0 ? D.moistureFromWeight(w, s) : (b ? b.moisture : null));
        }));
        el.querySelector('[data-act=ok]').addEventListener('click', () => {
          const picked = el.querySelector('[name=pick]:checked');
          if (!picked) return UI.toast('Choose a bay', 'warn');
          const bay = Store.byId('bays', picked.value);
          const testWeight = Number((el.querySelector(`[data-test="${picked.value}"]`) || {}).value) || null;
          if (r.bags > VH.bagsInBay(bay.id)) return UI.toast(`Only ${VH.bagsInBay(bay.id)} bags in ${bay.code}`, 'danger');
          Store.update('usageRequests', r.id, {
            status: 'APPROVED', bayId: bay.id, bayCode: bay.code,
            approvedBy: Auth.current().email, approvedAt: new Date().toISOString(),
            approvedNote: el.querySelector('[name=note]').value.trim(),
            testBagKg: testWeight,
            testMoisturePct: testWeight ? D.moistureFromWeight(testWeight, s) : null,
          }, 'usage-approve');
          VH.audit('usage.approve', 'usage', r.id, `${r.requestNo} approved from ${bay.code}${testWeight ? ` · test bag ${testWeight} kg` : ''}`);
          UI.toast('Approved — the operator can now draw the bags', 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  App.consumeUsage = function (id) {
    const r = Store.byId('usageRequests', id);
    if (!r) return;
    if (r.status === 'PENDING') return UI.toast('The supervisor has to approve the bay first', 'warn');
    const s = Store.settings();
    const bayBags = Store.where('bags', (b) => b.bayId === r.bayId && b.status === 'STORED');
    const take = Math.min(r.bags, bayBags.length);

    UI.modal({
      title: `Weigh and consume ${r.requestNo}`,
      body: `<p class="muted">Weigh three bags as they go into the gasifier. Their average is applied to the whole issue to give the outgoing weight.</p>
        <div class="grid-3">
          ${UI.field('Bag 1 (kg)', UI.input('w1', { type: 'number', step: '0.01', min: 0, required: true }))}
          ${UI.field('Bag 2 (kg)', UI.input('w2', { type: 'number', step: '0.01', min: 0, required: true }))}
          ${UI.field('Bag 3 (kg)', UI.input('w3', { type: 'number', step: '0.01', min: 0, required: true }))}
        </div>
        <div id="consume-out"></div>
        <p class="small muted">${take} bags leave ${esc(r.bayCode)}. The empty bags then wait under Bag returns to be checked.</p>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="ok">Record consumption</button>',
      onMount(el, close) {
        const recalc = () => {
          const ws = ['w1', 'w2', 'w3'].map((n) => Number(el.querySelector(`[name=${n}]`).value)).filter((n) => n > 0);
          const box = el.querySelector('#consume-out');
          if (ws.length < 1) { box.innerHTML = VH.moistureScale(null); return; }
          const avg = D.round2(ws.reduce((a, b) => a + b, 0) / ws.length);
          box.innerHTML = `
            <div class="calc-strip">
              <div><span class="muted small">Average bag</span><b>${avg} kg</b></div>
              <div><span class="muted small">Bags leaving</span><b>${take}</b></div>
              <div><span class="muted small">Outgoing weight</span><b>${kg(D.round2(avg * take))}</b></div>
            </div>
            ${VH.moistureScale(avg)}`;
        };
        ['w1', 'w2', 'w3'].forEach((n) => el.querySelector(`[name=${n}]`).addEventListener('input', recalc));
        recalc();

        el.querySelector('[data-act=ok]').addEventListener('click', () => {
          const ws = ['w1', 'w2', 'w3'].map((n) => Number(el.querySelector(`[name=${n}]`).value)).filter((n) => n > 0);
          if (!ws.length) return UI.toast('Enter at least one bag weight', 'warn');
          const avg = D.round2(ws.reduce((a, b) => a + b, 0) / ws.length);
          const moisture = D.moistureFromWeight(avg, s);
          const now = new Date().toISOString();
          const consumed = bayBags.slice(0, take);

          for (const b of consumed) {
            Object.assign(b, { status: 'CONSUMED', consumedAt: now, usageId: r.id, updatedAt: now });
            Store.markDirty('bags', b.id);
          }
          // The same bag record stays with its serial: the empty bag now waits
          // under Bag returns to be checked and re-issued (req 14).

          Store.update('usageRequests', r.id, {
            status: 'CONSUMED', sampleBags: ws, avgBagKg: avg, moisturePct: moisture,
            totalKg: D.round2(avg * take), consumedAt: now, consumedBy: Auth.current().email,
            bagSerials: consumed.map((b) => b.serial),
          }, 'usage-consume');

          VH.audit('usage.consume', 'usage', r.id, `${take} bags from ${r.bayCode} · avg ${avg} kg · moisture ${moisture}% · ${D.round2(avg * take)} kg`);
          if (D.moistureBand(moisture, s) !== 'OK') {
            UI.toast(`Moisture ${moisture}% is high. Consider raising a quality issue against this batch`, 'warn', 6500);
          }
          UI.toast(`${take} bags consumed, ${kg(D.round2(avg * take))} out`, 'ok');
          close(); App.refresh();
        });
      },
    });
  };
})();
