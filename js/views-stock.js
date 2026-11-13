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
          ${UI.stat('Numbered bags in bays', (counts.STORED || 0).toLocaleString(), 'bags with a serial; the bays also hold bags without one')}
          ${UI.stat('Numbered bags thrown away', `${(counts.RETIRED || 0).toLocaleString()}`, 'torn or worn out')}
        </section>

        <div class="toolbar">
          <div class="toolbar-left">
            <input class="nm-input search" id="bag-search" placeholder="Search a serial or supplier…" />
            ${UI.select('bagStatus', [
              { value: '', label: 'All statuses' },
              ...Object.keys(D.BAG_STATUS).map((k) => ({ value: k, label: D.BAG_STATUS_LABEL[k] })),
            ], { id: 'bag-status' })}
          </div>
          <div class="toolbar-right">
            ${Auth.can('bag.generate') ? '<button class="nm-btn" id="gen-bags"><i class="i i-plus"></i>Number new bags</button>' : ''}
            ${(Auth.can('bag.generate') || Auth.can('bag.issue')) && bags.length ? '<button class="nm-btn" id="print-bag-labels"><i class="i i-printer"></i>Print labels</button>' : ''}
            ${Auth.can('bag.issue') ? '<button class="nm-btn primary" id="issue-bags">Issue bags to a supplier</button>' : ''}
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
      const lbl = view.querySelector('#print-bag-labels');
      if (lbl) lbl.addEventListener('click', () => App.printBagLabels());
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
          if (!records.length) { UI.toast('Those serials already exist', 'warn'); return; }
          Store.bulkAdd('bags', records, 'bag-generate');
          const first = records[0].serial;
          const last = records[records.length - 1].serial;
          VH.audit('bag.generate', 'bags', 'batch', `${records.length} bags numbered ${first} … ${last}`);
          UI.toast(`${records.length.toLocaleString()} bags numbered`, 'ok');
          close(); App.refresh();
          // the next job is the stickers: offer them straight away
          setTimeout(() => App.printBagLabels(first, last), 260);
        });
      },
    });
  };

  /**
   * Print the stickers for a run of serials (from … to). Opened after
   * numbering a batch, and from the Bag registry for a reprint.
   */
  App.printBagLabels = function (fromSerial, toSerial) {
    const s = Store.settings();
    const all = Store.all('bags').slice().sort((a, b) => (D.parseSerialNumber(a.serial) || 0) - (D.parseSerialNumber(b.serial) || 0));
    if (!all.length) return UI.toast('No bags are numbered yet', 'warn');
    const lastBatch = all[all.length - 1].batchStart || all[0].serial;
    const from0 = fromSerial || lastBatch;
    const to0 = toSerial || all[all.length - 1].serial;
    UI.modal({
      title: 'Print bag labels',
      size: 'sm',
      body: `<div class="form-errors" role="alert"></div>
        <p class="muted small">One sticker per bag: the serial, its barcode and a box for the supplier number. Up to ${(1000).toLocaleString()} labels per print.</p>
        <div class="grid-2">
          ${UI.field('From serial', UI.input('from', { value: from0 }))}
          ${UI.field('To serial', UI.input('to', { value: to0 }))}
        </div>
        <div class="calc-strip" id="lbl-count"></div>`,
      footer: '<button class="nm-btn" data-close>Later</button><button class="nm-btn primary" data-act="print"><i class="i i-printer"></i>Print labels</button>',
      onMount(el, close) {
        const pick = () => {
          const a = D.parseSerialNumber(String(el.querySelector('[name=from]').value).trim().toUpperCase(), s.bagSerialPrefix);
          const b = D.parseSerialNumber(String(el.querySelector('[name=to]').value).trim().toUpperCase(), s.bagSerialPrefix);
          if (!a || !b) return { list: [], err: 'Type two serials, for example ' + D.bagSerial(s.bagSerialPrefix, 1) };
          const lo = Math.min(a, b), hi = Math.max(a, b);
          return { list: all.filter((x) => { const n = D.parseSerialNumber(x.serial); return n >= lo && n <= hi; }).map((x) => x.serial) };
        };
        const show = () => {
          const r = pick();
          el.querySelector('#lbl-count').innerHTML = r.err ? `<span class="t-warn">${esc(r.err)}</span>`
            : `<div><span class="muted small">Labels</span><b>${r.list.length.toLocaleString()}</b></div>${r.list.length > 1000 ? '<div class="t-warn small">More than 1,000: print in parts</div>' : ''}`;
        };
        el.querySelectorAll('input').forEach((i) => i.addEventListener('input', show));
        show();
        el.querySelector('[data-act=print]').addEventListener('click', () => {
          const r = pick();
          if (r.err) return UI.showErrors(el, [r.err]);
          if (!r.list.length) return UI.showErrors(el, ['No numbered bags in that range']);
          close();
          setTimeout(() => {
            if (VH.printLabelSheet(r.list, `Bag labels ${r.list[0]} to ${r.list[r.list.length - 1]}`)) {
              VH.audit('bag.labels', 'bags', 'labels', `${r.list.length} labels printed ${r.list[0]} … ${r.list[r.list.length - 1]}`);
            }
          }, 260);
        });
      },
    });
  };

  /* ------------------------- issue to supplier -----------------------
     Bags go out from the bag store: the USED shelf first (they are already
     paid for), topped up from the NEW shelf. The split is suggested and can
     be changed. Numbered bags in the store are attached as well, if the site
     uses serials, so the slip can list them. */
  App.issueBags = function (supplierId) {
    if (!Auth.can('bag.issue')) return UI.toast('Your role cannot issue bags', 'danger');
    const st = VH.bagStore();
    const numbered = Store.where('bags', (b) => b.status === 'IN_STOCK');
    const lastRound = Store.all('bagIssues').reduce((a, i) => Math.max(a, i.roundNo || 0), 0);
    const holding = new Map(VH.supplierBags().map((x) => [x.supplierId, x.holding]));
    const start = Math.max(0, Math.min(300, st.total));

    UI.modal({
      title: 'Issue bags to a supplier',
      size: 'md',
      body: `<div class="form-errors" role="alert"></div>
        <div class="bag-shelves">
          <div><span class="muted small">Used bags in the store</span><b>${Math.max(0, st.used).toLocaleString()}</b></div>
          <div><span class="muted small">New bags in the store</span><b>${Math.max(0, st.new).toLocaleString()}</b></div>
        </div>
        ${UI.field('Supplier', UI.select('supplierId', VH.supplierOptions(), { required: true, placeholder: 'Select supplier…', value: supplierId || '' }), '<span id="sup-holding"></span>')}
        <div class="grid-3">
          ${UI.field('How many bags?', UI.input('qty', { type: 'number', min: 1, value: start }))}
          ${UI.field('From used bags', UI.input('usedQty', { type: 'number', min: 0, value: 0 }))}
          ${UI.field('From new bags', UI.input('newQty', { type: 'number', min: 0, value: 0 }))}
        </div>
        <p class="small muted" id="split-note">Used bags go first; new bags make up the rest.</p>
        <div class="grid-2">
          ${UI.field('Round number', UI.input('roundNo', { type: 'number', min: 1, value: lastRound + 1 }))}
          ${UI.field('How is it shared?', UI.select('sharedWith', [
            { value: 'Printed allocation slip', label: 'Printed allocation slip' },
            { value: 'Printed allocation slip + WhatsApp', label: 'Printed allocation slip + WhatsApp' },
            { value: 'WhatsApp only', label: 'WhatsApp only' },
          ]))}
        </div>
        ${numbered.length ? `<label class="check"><input type="checkbox" name="withSerials" checked /> Attach numbered bags from the store (${numbered.length.toLocaleString()} available), so the slip lists their serials</label>` : ''}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="issue">Issue bags</button>',
      onMount(el, close) {
        const q = (n) => el.querySelector(`[name=${n}]`);
        let manual = false;
        const suggest = () => {
          const qty = Math.max(0, Number(q('qty').value) || 0);
          const fromUsed = Math.min(qty, Math.max(0, st.used));
          q('usedQty').value = fromUsed;
          q('newQty').value = qty - fromUsed;
          note();
        };
        const note = () => {
          const u = Number(q('usedQty').value) || 0, nw = Number(q('newQty').value) || 0, qty = Number(q('qty').value) || 0;
          const msgs = [];
          if (u + nw !== qty) msgs.push(`<span class="t-warn">Used + new = ${u + nw}, not ${qty}</span>`);
          if (u > Math.max(0, st.used)) msgs.push(`<span class="t-warn">Only ${Math.max(0, st.used)} used bags in the store</span>`);
          if (nw > Math.max(0, st.new)) msgs.push(`<span class="t-warn">Only ${Math.max(0, st.new)} new bags in the store</span>`);
          if (!msgs.length) msgs.push(nw ? `${u} used bags first, then ${nw} new.` : `All ${u} from the used bags.`);
          el.querySelector('#split-note').innerHTML = msgs.join(' ');
          const sid = q('supplierId').value;
          const h = sid ? (holding.get(sid) || 0) : null;
          el.querySelector('#sup-holding').textContent = sid ? (h > 0 ? `Already holding ${h} of our bags` : 'Holding none of our bags') : '';
        };
        q('qty').addEventListener('input', () => { if (!manual) suggest(); else note(); });
        q('usedQty').addEventListener('input', () => { manual = true; q('newQty').value = Math.max(0, (Number(q('qty').value) || 0) - (Number(q('usedQty').value) || 0)); note(); });
        q('newQty').addEventListener('input', () => { manual = true; note(); });
        q('supplierId').addEventListener('change', note);
        suggest();

        el.querySelector('[data-act=issue]').addEventListener('click', () => {
          const sid = q('supplierId').value;
          const qty = Number(q('qty').value) || 0;
          const usedQty = Number(q('usedQty').value) || 0;
          const newQty = Number(q('newQty').value) || 0;
          const roundNo = Number(q('roundNo').value) || lastRound + 1;
          const errors = [];
          if (!sid) errors.push('Choose the supplier');
          if (qty < 1) errors.push('Enter how many bags');
          if (usedQty < 0 || newQty < 0) errors.push('Bag numbers cannot be below zero');
          if (usedQty + newQty !== qty) errors.push(`Used (${usedQty}) and new (${newQty}) must add up to ${qty}`);
          if (usedQty > Math.max(0, st.used)) errors.push(`Only ${Math.max(0, st.used)} used bags are in the store`);
          if (newQty > Math.max(0, st.new)) errors.push(`Only ${Math.max(0, st.new)} new bags are in the store. Receive new bags first, or count the store if the figure is wrong.`);
          UI.showErrors(el, errors);
          if (errors.length) return;

          const now = new Date().toISOString();
          const withSerials = !!(q('withSerials') && q('withSerials').checked);
          const pool = withSerials ? Store.where('bags', (b) => b.status === 'IN_STOCK').slice(0, qty) : [];
          const sup = Store.byId('suppliers', sid) || {};
          const issue = Store.add('bagIssues', {
            roundNo, supplierId: sid, qty, usedQty, newQty, mode: pool.length ? 'SERIAL_ONLY' : 'COUNT',
            serials: pool.map((b) => b.serial), issuedAt: now, issuedBy: Auth.current().email, sharedWith: q('sharedWith').value,
          }, 'bag-issue');
          for (const b of pool) {
            Object.assign(b, { status: 'ISSUED', supplierId: sid, supplierCode: sup.code, issuedAt: now, roundNo, bagIssueId: issue.id, updatedAt: now });
            Store.markDirty('bags', b.id);
          }
          Store.save('bag-issue');
          VH.audit('bag.issue', 'bagIssue', issue.id, `Round ${roundNo} · ${qty} bags to ${sup.name || ''} (${usedQty} used, ${newQty} new)${pool.length ? ` · serials ${pool[0].serial} … ${pool[pool.length - 1].serial}` : ''}`);
          UI.toast(`${qty} bags given to ${sup.name || 'the supplier'}: ${usedQty} used, ${newQty} new`, 'ok', 5000);
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
    const list = issue.serials || [];
    const counted = issue.usedQty !== undefined || issue.newQty !== undefined;
    const total = counted ? (Number(issue.usedQty) || 0) + (Number(issue.newQty) || 0) : list.length;
    // every numbered bag is listed, in two columns (left column first)
    const half = Math.ceil(list.length / 2);
    const html = `${VH.printHeader('Bag allocation slip', `Round ${issue.roundNo} · ${sup.code || ''} ${sup.name || ''} · ${dt(issue.issuedAt)}`)}
      <table>
        <tr><th>Supplier</th><td>${esc(`${sup.code || ''} · ${sup.name || ''}`)}</td><th>Bags given</th><td><b>${total}</b></td></tr>
        ${counted ? `<tr><th>Used bags</th><td>${Number(issue.usedQty) || 0}</td><th>New bags</th><td>${Number(issue.newQty) || 0}</td></tr>` : ''}
      </table>
      <p class="meta">Please bring these bags back filled. ${list.length ? 'Every bag carries the serial listed below; write your <b>supplier number</b> in the box on the bag tag before delivering.' : 'Bags that are torn are replaced at the store.'}</p>
      ${list.length ? `<table><thead><tr><th>#</th><th>Serial</th><th>Returned (tick)</th><th>#</th><th>Serial</th><th>Returned (tick)</th></tr></thead>
        <tbody>${Array.from({ length: half }, (_, i) => `
          <tr><td>${i + 1}</td><td class="mono">${esc(list[i])}</td><td></td>
              <td>${list[i + half] ? i + 1 + half : ''}</td>
              <td class="mono">${esc(list[i + half] || '')}</td><td></td></tr>`).join('')}
        </tbody></table>` : ''}
      <div style="display:flex;gap:20mm;margin-top:12mm"><div class="sign">Issued by (bag store)</div><div class="sign">Supplier acknowledgement</div></div>`;
    UI.print(html, `Allocation slip round ${issue.roundNo}`);
    VH.audit('bag.issue.print', 'bagIssue', issue.id, `Allocation slip for round ${issue.roundNo} printed`);
  };

  /* ================================ BAYS =============================
     The yard starts with 30 bays of 200 bags. Nothing about a bay is
     fixed: it can be renamed, resized, added or removed, and filling one
     past its size is allowed (it just shows as over size).

     A tile shows what is in the bay NOW, including how dry it is today.
     Tapping it opens the full picture; "History" from there shows every
     load that went in and every issue that came out, with the moisture
     each time.
     ==================================================================== */
  const BAY_SEED_STAMP = '2026-01-01T00:00:00.000Z';   // older than any real edit, so a real edit always wins a sync

  /** Create the starting bays once, on a yard that has none. */
  App.ensureBays = function () {
    if (Store.space !== 'live' || !Auth.current() || Auth.isPending()) return 0;
    if (Store.all('bays').length) return 0;
    if (!Auth.can('bay.allocate') && !Auth.can('delivery.accept')) return 0;
    const s = Store.settings();
    const n = Math.max(1, Math.min(200, Number(s.bayCount) || 30));
    const cap = Number(s.bayCapacityBags) || 200;
    // Fixed ids: if two devices both start an empty yard, they create the
    // same 30 bays, not 60.
    const recs = [];
    for (let i = 1; i <= n; i++) {
      recs.push({ id: `bay_${String(i).padStart(3, '0')}`, code: `BAY-${i}`, name: `Bay ${i}`, capacityBags: cap, createdAt: BAY_SEED_STAMP, updatedAt: BAY_SEED_STAMP });
    }
    Store.bulkAdd('bays', recs, 'bays-setup');
    return n;
  };

  const bayOrder = (a, b) => (D.parseSerialNumber(a.code) || 0) - (D.parseSerialNumber(b.code) || 0) || String(a.code).localeCompare(String(b.code));
  let bayFilter = 'ALL';

  App.register('bays', {
    title: 'Bays & stock',
    render(view) {
      App.ensureBays();
      const s = Store.settings();
      const all = Store.where('bays', (b) => !b.deleted).slice().sort(bayOrder).map((b) => VH.bayNow(b));
      const withStock = all.filter((x) => x.count > 0);
      const dry = all.filter((x) => x.ready);
      const empty = all.filter((x) => x.count === 0);
      const totalBags = all.reduce((a, x) => a + x.count, 0);
      const totalCap = all.reduce((a, x) => a + x.capacity, 0);
      const FILTERS = [['ALL', `All (${all.length})`], ['STOCK', `With stock (${withStock.length})`], ['DRY', `Dry, use first (${dry.length})`], ['EMPTY', `Empty (${empty.length})`]];
      if (!FILTERS.some((f) => f[0] === bayFilter)) bayFilter = 'ALL';
      const canCheck = VH.canBayCheck();
      const checkedN = withStock.filter((x) => VH.checkedToday(x.bay.id)).length;

      view.innerHTML = `
        <section class="stats stats-4">
          ${UI.stat('Bags in the yard', totalBags.toLocaleString(), `of ${totalCap.toLocaleString()} bag spaces`)}
          ${UI.stat('Bays in use', `${withStock.length}`, `${empty.length} empty`)}
          ${UI.stat('Dry, use first', `${dry.length}`, `at or below ${D.moistureReadyPct(s)}% moisture`, dry.length ? 'danger' : null)}
          ${UI.stat('Drying rate', `${s.dryingKgPerDay ?? 0.6} kg`, 'per bag, per day in the bay')}
        </section>
        <div class="toolbar">
          <div class="seg" id="bay-filters">
            ${FILTERS.map(([v, l]) => `<button class="seg-btn ${v === bayFilter ? 'active' : ''}" data-bfilter="${v}">${esc(l)}</button>`).join('')}
          </div>
          <div class="toolbar-right">
            ${canCheck && withStock.length ? `<button class="nm-btn primary" id="day-check"><i class="i i-tag"></i>Daily bay check (${checkedN}/${withStock.length} today)</button>` : ''}
            ${Auth.can('bay.allocate') ? '<button class="nm-btn" id="add-bay"><i class="i i-plus"></i>Add bay</button>' : ''}</div>
        </div>
        <p class="muted small bay-legend"><span class="key key-dry"></span>Dry, use first <span class="key key-damp"></span>Still damp <span class="key key-wet"></span>Wet <span class="key key-empty"></span>Empty. Moisture is today's estimate: a bag loses about ${s.dryingKgPerDay ?? 0.6} kg a day in the bay. Tap a bay for the details.</p>
        <div class="bay-tiles" id="bay-tiles"></div>`;

      const draw = () => {
        const list = bayFilter === 'STOCK' ? withStock : bayFilter === 'DRY' ? dry : bayFilter === 'EMPTY' ? empty : all;
        view.querySelector('#bay-tiles').innerHTML = list.map((x) => {
          const cls = x.count === 0 ? 'is-empty' : x.ready ? 'is-dry' : x.band === 'HIGH' ? 'is-wet' : x.band === 'WARN' ? 'is-damp' : 'is-ok';
          const state = x.count === 0 ? 'Empty' : x.ready ? 'Dry, use first' : x.moisture === null ? 'No weight on record' : D.MOISTURE_LABEL[x.band];
          const checked = VH.checkedToday(x.bay.id);
          return `<div class="bay-tile ${cls} ${x.over ? 'is-over' : ''}">
            <button class="bt-main" data-bay-open="${x.bay.id}" aria-label="${esc(x.bay.code)}: ${x.count} bags, ${esc(state)}">
              <span class="bt-head"><b>${esc(x.bay.code)}</b><span class="bt-moist">${x.moisture === null ? '' : `${x.moisture}%`}</span></span>
              <span class="meter"><span style="width:${Math.min(100, x.pctFull)}%"></span></span>
              <span class="bt-count">${x.count.toLocaleString()} / ${x.capacity.toLocaleString()} bags${x.over ? ', over size' : ''}</span>
              <span class="bt-state">${esc(state)}${x.count && x.oldestDays !== null ? `, ${x.oldestDays} day${x.oldestDays === 1 ? '' : 's'} in` : ''}</span>
              <span class="bt-spark">${VH.sparkline(VH.bayReadings(x.bay.id))}</span>
            </button>
            <span class="bt-foot">
              <span class="bt-check ${checked ? 'is-done' : ''}">${checked ? '✓ Checked today' : x.count ? 'Not checked today' : ''}</span>
              <button class="bt-more" data-bay-chart="${x.bay.id}">Show more</button>
            </span>
          </div>`;
        }).join('') || '<p class="muted">No bays match this filter.</p>';
        UI.$$('[data-bay-open]', view).forEach((b) => b.addEventListener('click', () => App.openBay(b.dataset.bayOpen)));
        UI.$$('[data-bay-chart]', view).forEach((b) => b.addEventListener('click', () => App.bayTrend(b.dataset.bayChart)));
      };
      draw();
      UI.$$('[data-bfilter]', view).forEach((b) => b.addEventListener('click', () => {
        bayFilter = b.dataset.bfilter;
        UI.$$('[data-bfilter]', view).forEach((x) => x.classList.toggle('active', x === b));
        draw();
      }));
      const addBay = view.querySelector('#add-bay');
      if (addBay) addBay.addEventListener('click', () => App.editBay(null));
      const dayCheck = view.querySelector('#day-check');
      if (dayCheck) dayCheck.addEventListener('click', () => App.dailyBayCheck());
    },
  });

  /**
   * The daily bay check: one bag weighed from each bay that has stock.
   * A bay left blank is simply skipped (a missed day is fine).
   */
  App.dailyBayCheck = function () {
    if (!VH.canBayCheck()) return UI.toast('Your role cannot record bay checks', 'danger');
    const s = Store.settings();
    const bays = Store.where('bays', (b) => !b.deleted).map((b) => VH.bayNow(b)).filter((x) => x.count > 0)
      .sort((a, b) => a.bay.code.localeCompare(b.bay.code, undefined, { numeric: true }));
    UI.modal({
      title: 'Daily bay check',
      size: 'lg',
      body: `<p class="muted small">Weigh one bag from each bay and type its weight. Leave a bay blank if it was not weighed today: that is fine.</p>
        <div class="table-wrap"><table class="data-table day-check">
          <thead><tr><th>Bay</th><th class="num">Bags</th><th class="num">Last weight</th><th>Today</th><th>Bag weight (kg)</th></tr></thead>
          <tbody>${bays.map((x) => {
            const last = VH.bayChecks(x.bay.id).slice(-1)[0];
            const done = VH.checkedToday(x.bay.id);
            return `<tr>
              <td data-label="Bay"><b>${esc(x.bay.code)}</b><div class="muted small">${esc(x.bay.name || '')}</div></td>
              <td data-label="Bags" class="num">${x.count.toLocaleString()}</td>
              <td data-label="Last weight" class="num">${last ? `${last.kg} kg<div class="muted small">${esc(dOnly(last.at))}</div>` : '—'}</td>
              <td data-label="Today">${done ? badge('Done', 'ok') : badge('Not yet', 'muted')}</td>
              <td data-label="Bag weight (kg)"><input class="nm-input" type="number" min="1" max="100" step="0.1" inputmode="decimal" name="chk_${x.bay.id}" placeholder="kg" aria-label="${esc(x.bay.code)} bag weight"></td>
            </tr>`;
          }).join('')}</tbody></table></div>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save checks</button>',
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          let n = 0, bad = '';
          for (const x of bays) {
            const raw = el.querySelector(`[name="chk_${x.bay.id}"]`).value;
            if (raw === '') continue;
            const w = Number(raw);
            if (!(w > 0 && w <= 100)) { bad = x.bay.code; break; }
          }
          if (bad) return UI.toast(`${bad}: enter a weight between 1 and 100 kg`, 'warn');
          for (const x of bays) {
            const raw = el.querySelector(`[name="chk_${x.bay.id}"]`).value;
            if (raw !== '' && VH.saveBayCheck(x.bay.id, Number(raw))) n++;
          }
          if (!n) return UI.toast('Type at least one bag weight', 'warn');
          UI.toast(`${n} bay check${n === 1 ? '' : 's'} saved`, 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  /** "Show more": the bay's moisture over time, with every reading. */
  App.bayTrend = function (bayId) {
    const bay = Store.byId('bays', bayId);
    if (!bay) return;
    const pts = VH.bayReadings(bayId);
    const checks = pts.filter((p) => p.kind === 'check');
    const first = pts[0], last = pts[pts.length - 1];
    const days = first && last ? Math.max(1, Math.round((Date.parse(last.at) - Date.parse(first.at)) / 864e5)) : 0;
    const perDay = first && last && days ? D.round2((first.kg - last.kg) / days) : null;
    const KIND = { in: ['Came in', 'ok'], check: ['Daily check', 'info'], test: ['Test bag', 'muted'], out: ['To the gasifier', 'warn'] };
    UI.modal({
      title: `${bay.code} weight and moisture`,
      size: 'lg',
      body: `
        <div class="calc-strip" style="margin-bottom:14px">
          <div><span class="muted small">Readings</span><b>${pts.length}</b><span class="muted small">${checks.length} daily check${checks.length === 1 ? '' : 's'}</span></div>
          <div><span class="muted small">First → latest bag</span><b>${first ? `${first.kg} → ${last.kg} kg` : '—'}</b></div>
          <div><span class="muted small">Weight lost a day</span><b>${perDay === null ? '—' : `${perDay} kg`}</b><span class="muted small">over ${days} day${days === 1 ? '' : 's'}</span></div>
          <div><span class="muted small">Moisture now</span><b>${last ? `${last.moisture}%` : '—'}</b></div>
        </div>
        ${VH.bayChart(pts)}
        ${UI.table({
          rows: pts.slice().reverse(), empty: 'No weights recorded yet.',
          columns: [
            { label: 'When', render: (p) => esc(dt(p.at)) },
            { label: 'What', render: (p) => badge((KIND[p.kind] || [p.kind])[0], (KIND[p.kind] || [0, 'muted'])[1]) },
            { label: 'Bag weight', cls: 'num', render: (p) => `${p.kg} kg` },
            { label: 'Moisture', render: (p) => VH.moistureBadge(p.moisture) },
            { label: 'Note', render: (p) => `<span class="small">${esc(p.label || '')}</span>` },
          ],
        })}`,
      footer: '<button class="nm-btn" data-act="open">Open bay</button><button class="nm-btn primary" data-close>Done</button>',
      onMount(el, close) {
        const o = el.querySelector('[data-act=open]');
        if (o) o.addEventListener('click', () => { close(); App.openBay(bayId); });
      },
    });
  };

  /** Everything about one bay, as it stands now. */
  App.openBay = function (bayId) {
    const x = VH.bayNow(bayId);
    if (!x) return UI.toast('Bay not found', 'danger');
    const s = Store.settings();
    const bay = x.bay;
    const state = x.count === 0 ? 'Empty' : x.ready ? 'Dry: use this bay first' : x.moisture === null ? 'No weight on record' : `Reads ${D.MOISTURE_LABEL[x.band]}`;
    UI.modal({
      title: `${bay.code}${bay.name && bay.name !== bay.code ? ` · ${bay.name}` : ''}`,
      size: 'lg',
      body: `
        <div class="bay-now ${x.ready ? 'is-dry' : ''}">
          <div><span class="muted small">In the bay now</span><b>${x.count.toLocaleString()} bags</b><span class="muted small">size ${x.capacity.toLocaleString()}${x.over ? ', over size' : `, room for ${Math.max(0, x.capacity - x.count).toLocaleString()}`}</span></div>
          <div><span class="muted small">Moisture today</span><b class="t-${x.ready ? 'danger' : D.moistureTone(x.band)}">${x.moisture === null ? '—' : `${x.moisture}%`}</b><span class="muted small">${esc(state)}</span></div>
          <div><span class="muted small">Bag weight today</span><b>${x.estKg ? `${x.estKg} kg` : '—'}</b><span class="muted small">${x.arrivalKg ? `came in at ${x.arrivalKg} kg` : 'no arrival weight'}</span></div>
          <div><span class="muted small">Oldest load</span><b>${x.oldestDays === null ? '—' : `${x.oldestDays} day${x.oldestDays === 1 ? '' : 's'}`}</b><span class="muted small">${x.measured ? `last weighed ${esc(dOnly(x.measured.at))}: ${x.measured.kg} kg` : 'never weighed in the bay'}</span></div>
        </div>
        ${x.estKg ? VH.moistureScale(x.estKg, { compact: true }) : ''}
        <h4>What is in it</h4>
        ${x.loads.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Load</th><th>Supplier</th><th>Type</th><th class="num">Bags</th><th>In the bay since</th><th class="num">On arrival</th><th class="num">Today</th></tr></thead>
          <tbody>${x.loads.map((l) => `<tr>
            <td data-label="Load"><b>${esc(l.delivery ? l.delivery.receiptNo : 'Not linked')}</b></td>
            <td data-label="Supplier">${esc(l.delivery ? supplierName(l.delivery.supplierId) : '—')}</td>
            <td data-label="Type">${esc(l.delivery ? VH.typeLabel(l.delivery.biomassType) : '—')}</td>
            <td data-label="Bags" class="num">${l.count.toLocaleString()}</td>
            <td data-label="In the bay since">${esc(dOnly(l.since))}<div class="muted small">${l.days === null ? '' : `${l.days} day${l.days === 1 ? '' : 's'}`}</div></td>
            <td data-label="On arrival" class="num">${l.startKg ? `${l.startKg} kg` : '—'}<div class="muted small">${l.startMoisture === null ? '' : `${l.startMoisture}%`}</div></td>
            <td data-label="Today" class="num">${l.estKg ? `${l.estKg} kg` : '—'}<div class="muted small">${l.moisture === null ? '' : `${l.moisture}%${l.measured ? ', from a weighing' : ''}`}</div></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing is stored in this bay.</p>'}
        <p class="small muted">Today's figures are worked out from the arrival weight, less ${s.dryingKgPerDay ?? 0.6} kg per bag for each day in the bay, down to ${s.driestBagKg ?? 18} kg. The daily check (one bag weighed) replaces the estimate with a real reading.</p>
        <h4>Daily check, last 14 days</h4>
        <div class="bay-weigh">
          <div style="flex:1 1 200px">${VH.sparkline(VH.bayReadings(bay.id), { w: 260, h: 40 })}</div>
          <button class="nm-btn" data-act="trend">Show more</button>
        </div>
        ${VH.canBayCheck() ? `<div class="bay-weigh">
          ${UI.field(VH.checkedToday(bay.id) ? 'Checked today. Weigh another bag (kg)' : 'Daily check: weigh one bag from this bay (kg)', UI.input('bayWeigh', { type: 'number', min: 1, max: 100, step: '0.1', placeholder: 'kg' }))}
          <button class="nm-btn" data-act="weigh" ${x.count ? '' : 'disabled'}>Save check</button>
        </div>` : ''}
        ${bay.note ? `<p class="small"><b>Note:</b> ${esc(bay.note)}</p>` : ''}`,
      footer: `
        <button class="nm-btn" data-act="history">History</button>
        ${Auth.can('bay.allocate') ? '<button class="nm-btn" data-act="edit">Edit bay</button>' : ''}
        ${Auth.can('usage.request') ? `<button class="nm-btn primary" data-act="issue" ${x.count ? '' : 'disabled'}><i class="i i-flame"></i>Ask for bags</button>` : ''}`,
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          if (!btn) return;
          const act = btn.dataset.act;
          if (act === 'history') return App.bayHistory(bay.id);
          if (act === 'trend') return App.bayTrend(bay.id);
          if (act === 'edit') { close(); return App.editBay(bay.id); }
          if (act === 'issue') { close(); return App.requestUsage(bay.id); }
          if (act === 'weigh') {
            const w = Number(el.querySelector('[name=bayWeigh]').value);
            if (!(w > 0 && w <= 100)) return UI.toast('Enter the bag weight in kg (1 to 100)', 'warn');
            VH.saveBayCheck(bay.id, w);
            UI.toast(`${bay.code}: ${w} kg, moisture ${D.moistureFromWeight(w, s)}%`, 'ok');
            close(); App.refresh(); App.openBay(bay.id);
          }
        });
      },
    });
  };

  /** What went in and what was taken out, newest first. */
  App.bayHistory = function (bayId) {
    const bay = Store.byId('bays', bayId);
    if (!bay) return;
    const rows = VH.bayHistory(bayId);
    const s = Store.settings();
    const KIND = { in: ['Came in', 'ok'], out: ['Taken out', 'info'], weigh: ['Weighed', 'muted'] };
    const totalIn = rows.filter((r) => r.kind === 'in').reduce((a, r) => a + (r.bags || 0), 0);
    const totalOut = rows.filter((r) => r.kind === 'out').reduce((a, r) => a + (r.bags || 0), 0);
    UI.modal({
      title: `${bay.code} history`,
      size: 'lg',
      body: `
        <div class="calc-strip" style="margin-bottom:14px">
          <div><span class="muted small">Bags in, all time</span><b>${totalIn.toLocaleString()}</b></div>
          <div><span class="muted small">Bags taken out</span><b>${totalOut.toLocaleString()}</b></div>
          <div><span class="muted small">In the bay now</span><b>${VH.bagsInBay(bayId).toLocaleString()}</b></div>
        </div>
        ${UI.table({
          rows, empty: 'Nothing has gone into or out of this bay yet.',
          columns: [
            { label: 'When', render: (r) => `${esc(dOnly(r.at))}<div class="muted small">${esc(String(dt(r.at)).split(', ').pop() || '')}</div>` },
            { label: 'What', render: (r) => badge(KIND[r.kind][0], KIND[r.kind][1]) },
            { label: 'Bags', cls: 'num', render: (r) => (r.bags === null ? '—' : `${r.kind === 'out' ? '− ' : r.kind === 'in' ? '+ ' : ''}${r.bags.toLocaleString()}`) },
            { label: 'Bag weight', cls: 'num', render: (r) => (r.kgPerBag ? `${r.kgPerBag} kg` : '—') },
            { label: 'Moisture', render: (r) => VH.moistureBadge(r.moisture) },
            { label: 'Reference', render: (r) => `<b>${esc(r.ref || '')}</b><div class="muted small">${esc(r.note || '')}</div>` },
            { label: 'Who', render: (r) => `<span class="small">${esc(r.who || '')}</span>` },
          ],
        })}
        <p class="small muted">Moisture is read from the bag weight each time: on the weighbridge when a load came in, and at the gasifier when bags were taken out. A bag loses about ${s.dryingKgPerDay ?? 0.6} kg a day in between.</p>`,
      footer: '<button class="nm-btn" data-act="print"><i class="i i-printer"></i>Print</button><button class="nm-btn primary" data-close>Done</button>',
      onMount(el) {
        el.querySelector('[data-act=print]').addEventListener('click', () => {
          UI.print(`${VH.printHeader(`${bay.code} history`, `${rows.length} entries`)}
            <table><thead><tr><th>When</th><th>What</th><th>Bags</th><th>Bag weight</th><th>Moisture</th><th>Reference</th><th>Who</th></tr></thead>
            <tbody>${rows.map((r) => `<tr><td>${esc(dt(r.at))}</td><td>${KIND[r.kind][0]}</td><td class="num">${r.bags === null ? '' : r.bags}</td><td class="num">${r.kgPerBag ? `${r.kgPerBag} kg` : ''}</td><td class="num">${r.moisture === null ? '' : `${r.moisture}%`}</td><td>${esc(r.ref || '')} ${esc(r.note || '')}</td><td>${esc(r.who || '')}</td></tr>`).join('')}</tbody></table>`, `${bay.code} history`);
        });
      },
    });
  };

  /** Add a bay, or change one: name, size, note. An empty bay can be removed. */
  App.editBay = function (bayId) {
    if (!Auth.can('bay.allocate')) return UI.toast('Your role cannot change bays', 'danger');
    const bay = bayId ? Store.byId('bays', bayId) : null;
    const bays = Store.where('bays', (b) => !b.deleted);
    const nextNo = bays.reduce((a, b) => Math.max(a, D.parseSerialNumber(b.code) || 0), 0) + 1;
    const holds = bay ? VH.bagsInBay(bay.id) : 0;
    UI.modal({
      title: bay ? `Edit ${bay.code}` : 'Add a bay',
      size: 'sm',
      body: `<div class="form-errors" role="alert"></div>
        ${UI.field('Bay code', UI.input('code', { value: bay ? bay.code : `BAY-${nextNo}`, required: true }))}
        ${UI.field('Name', UI.input('name', { value: bay ? (bay.name || '') : `Bay ${nextNo}` }))}
        ${UI.field('Size (bags)', UI.input('capacityBags', { type: 'number', min: 1, value: bay ? (bay.capacityBags || 200) : (Number(Store.settings().bayCapacityBags) || 200), required: true }),
          bay ? `Holds ${holds} bags now. The size is a guide: a bay can be filled past it.` : 'You can change this at any time.')}
        ${UI.field('Note', UI.input('note', { value: bay ? (bay.note || '') : '', placeholder: 'Under the roof, near the gasifier…' }))}`,
      footer: `${bay ? `<button class="nm-btn danger-ghost" data-act="remove" ${holds ? 'disabled title="Only an empty bay can be removed"' : ''}>Remove bay</button>` : ''}
        <button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">${bay ? 'Save bay' : 'Add bay'}</button>`,
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const f = UI.formData(el.querySelector('.modal-body'));
          const code = String(f.code || '').toUpperCase().trim().replace(/[^A-Z0-9-]/g, '');
          const cap = Math.round(Number(f.capacityBags) || 0);
          const errors = [];
          if (!code) errors.push('Enter a bay code');
          const others = bays.filter((b) => !bay || b.id !== bay.id);
          const sameName = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
          const nameV = String(f.name || '').trim().replace(/\s+/g, ' ') || code;
          if (others.some((b) => String(b.code || '').toUpperCase() === code)) errors.push(`${code} already exists. Every bay needs its own code.`);
          else if (others.some((b) => sameName(b.name || b.code) === sameName(nameV) || sameName(b.code) === sameName(nameV))) errors.push(`A bay called "${nameV}" already exists. Two bays cannot have the same name.`);
          if (cap < 1) errors.push('Enter the size in bags');
          UI.showErrors(el, errors);
          if (errors.length) return;
          const patch = { code, name: nameV, capacityBags: cap, note: f.note || '' };
          if (bay) {
            Store.update('bays', bay.id, patch, 'bay-update');
            if (code !== bay.code) {
              // keep the bay name on the bags that are in it
              for (const b of Store.where('bags', (x) => x.bayId === bay.id)) { b.bayCode = code; b.updatedAt = new Date().toISOString(); Store.markDirty('bags', b.id); }
              Store.save('bay-rename');
            }
            VH.audit('bay.update', 'bay', code, `${code} · size ${cap} bags`);
          } else {
            Store.add('bays', patch, 'bay-create');
            VH.audit('bay.create', 'bay', code, `Size ${cap} bags`);
          }
          UI.toast(bay ? 'Bay saved' : 'Bay added', 'ok');
          close(); App.refresh();
        });
        const rm = el.querySelector('[data-act=remove]');
        if (rm) rm.addEventListener('click', async () => {
          if (VH.bagsInBay(bay.id)) return UI.toast('Only an empty bay can be removed', 'warn');
          const ok = await UI.confirm({ title: `Remove ${bay.code}?`, message: 'The bay disappears from the yard. Its history stays on the deliveries and issues that used it.', confirmText: 'Remove bay' });
          if (!ok) return;
          Store.remove('bays', bay.id, 'bay-remove');
          VH.audit('bay.remove', 'bay', bay.code, `${bay.code} removed`);
          UI.toast(`${bay.code} removed`, 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  /* ============================== GASIFIER =========================== */
  App.register('gasifier', {
    title: 'Gasifier',
    render(view) {
      const s = Store.settings();
      const requests = Store.all('usageRequests').slice().sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
      const open = requests.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED');
      // Only bays with stock, driest first: that is the order to use them in.
      const bays = Store.where('bays', (b) => !b.deleted).map((b) => VH.bayNow(b)).filter((x) => x.count > 0)
        .sort((a, b) => (a.moisture === null ? 999 : a.moisture) - (b.moisture === null ? 999 : b.moisture));

      view.innerHTML = `
        <section class="nm-card pad">
          <div class="card-head"><h3>Which bay to use</h3>
            ${Auth.can('usage.request') ? '<button class="nm-btn primary" id="new-usage"><i class="i i-plus"></i>Ask for bags</button>' : ''}</div>
          <p class="muted">Bays with bags, driest first. Use the dry (red) bays first. The supervisor can weigh a bag to check.</p>
          <div class="bay-grid tight">
            ${bays.map((x) => `<button class="nm-inset pad-sm bay-mini ${x.ready ? 'is-dry' : ''}" data-bay-open="${x.bay.id}">
                <div class="bay-head"><b>${esc(x.bay.code)}</b>${badge(`${x.count} bags`, 'ok')}</div>
                <div class="bay-mini-row"><span class="muted small">Bag today</span><b>${x.estKg ? `${x.estKg} kg` : '—'}</b></div>
                <div class="bay-mini-row"><span class="muted small">Moisture</span><b class="t-${x.ready ? 'danger' : D.moistureTone(x.band)}">${x.moisture === null ? '—' : `${x.moisture}% · ${x.ready ? 'dry, use first' : D.MOISTURE_LABEL[x.band]}`}</b></div>
                <div class="bay-mini-row"><span class="muted small">In the bay</span><b>${x.oldestDays === null ? '—' : `${x.oldestDays} day${x.oldestDays === 1 ? '' : 's'}`}</b></div>
              </button>`).join('') || '<p class="muted">No bay has stock.</p>'}
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
                ${r.status === 'APPROVED' && Auth.can('usage.consume') ? `<button class="nm-btn tiny primary" data-consume="${r.id}">Weigh and feed</button>` : ''}
              </div>
            </div>`).join('')}</div>
        </section>` : ''}

        <section class="nm-card pad">
          <h3>What went to the gasifier</h3>
          ${UI.table({
            rows: requests.filter((r) => r.status === 'CONSUMED').slice(0, 40),
            empty: 'Nothing issued to the gasifier yet.',
            rowKey: (r) => r.id,
            columns: [
              { label: 'Request', render: (r) => `<b>${esc(r.requestNo)}</b><div class="muted small">${esc(dOnly(r.consumedAt || r.requestedAt))}</div>` },
              { label: 'Bay', render: (r) => esc(r.bayCode) },
              { label: 'Bags', cls: 'num', render: (r) => r.bags },
              { label: 'Weighed', render: (r) => ((r.typeWeights || []).length
                ? r.typeWeights.map((x) => `<div class="small">${esc(x.label)}: ${x.bags} × ${x.kg} kg</div>`).join('')
                : esc((r.sampleBags || []).join(' / ') || '—')) },
              { label: 'Avg bag', cls: 'num', render: (r) => (r.avgBagKg ? `${r.avgBagKg} kg` : '—') },
              { label: 'Moisture', render: (r) => VH.moistureBadge(r.avgBagKg ? D.moistureFromWeight(r.avgBagKg, s) : null) },
              { label: 'Out weight', cls: 'num', render: (r) => (r.totalKg ? kg(r.totalKg) : '—') },
            ],
          })}
        </section>`;

      const nw = view.querySelector('#new-usage');
      if (nw) nw.addEventListener('click', () => App.requestUsage(null));
      UI.$$('[data-approve]', view).forEach((b) => b.addEventListener('click', () => App.approveUsage(b.dataset.approve)));
      UI.$$('[data-bay-open]', view).forEach((b) => b.addEventListener('click', () => App.openBay(b.dataset.bayOpen)));
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
    // bays that hold something, driest first
    const bays = Store.where('bays', (b) => !b.deleted).map((b) => VH.bayNow(b)).filter((x) => x.count > 0 || x.bay.id === r.bayId)
      .sort((a, b) => (a.moisture === null ? 999 : a.moisture) - (b.moisture === null ? 999 : b.moisture))
      .map((x) => ({ bay: x.bay, count: x.count, avg: x.estKg, moisture: x.moisture, ready: x.ready, days: x.oldestDays }));

    UI.modal({
      title: `Approve ${r.requestNo}`,
      size: 'lg',
      body: `<p class="muted">Bays with stock, driest first. Pick the bay, and weigh a bag from it if you want a real reading. The operator asked for <b>${r.bags} bags</b> from ${esc(r.bayCode)}.</p>
        <div class="nm-inset pad-sm">
          <table class="mini"><thead><tr><th>Use</th><th>Bay</th><th class="num">Bags</th><th class="num">Bag today</th><th>Moisture today</th><th>Test bag weight (kg)</th></tr></thead>
          <tbody>${bays.map((b) => {
            const band = D.moistureBand(b.moisture, s);
            return `<tr>
              <td><input type="radio" name="pick" value="${b.bay.id}" ${b.bay.id === r.bayId ? 'checked' : ''} ${b.count ? '' : 'disabled'} /></td>
              <td><b>${esc(b.bay.code)}</b>${b.ready ? ' <span class="pill pill-dry">dry, use first</span>' : ''}${b.days === null || b.days === undefined ? '' : `<div class="muted small">${b.days} day${b.days === 1 ? '' : 's'} in the bay</div>`}</td>
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
          // a test bag is a real reading of the bay: the estimate starts again from it
          if (testWeight) Store.update('bays', bay.id, { lastWeighKg: testWeight, lastWeighAt: new Date().toISOString(), lastWeighBy: Auth.current().email }, 'bay-weigh');
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
    // The bags leave the bay's count whether or not they carry serials;
    // numbered bags in the bay (oldest first) are marked used as well.
    const take = Math.min(r.bags, VH.bagsInBay(r.bayId));
    const bayBags = Store.where('bags', (b) => b.bayId === r.bayId && b.status === 'STORED')
      .sort((a, b) => String(a.deliveredAt || '').localeCompare(String(b.deliveredAt || '')));
    // which loads these bags come from: the oldest in the bay first
    const fromLoads = [];
    let left = take;
    for (const l of VH.bayLayers(r.bayId)) {
      if (left <= 0) break;
      const n = Math.min(left, l.count);
      fromLoads.push({ deliveryId: l.deliveryId, receiptNo: l.delivery.receiptNo, supplierId: l.delivery.supplierId, bags: n });
      left -= n;
    }
    const loadsText = fromLoads.map((l) => `${l.receiptNo} (${(Store.byId('suppliers', l.supplierId) || {}).name || ''}, ${l.bags})`).join(', ');
    // One row per biomass type in this batch (Gliricidia, Cinnamon…): the
    // bags of that type and the weight of ONE bag of it. Total = bags x weight.
    const byType = new Map();
    for (const l of fromLoads) {
      const t = (Store.byId('deliveries', l.deliveryId) || {}).biomassType || 'OTHER';
      byType.set(t, (byType.get(t) || 0) + l.bags);
    }
    if (!byType.size) byType.set('OTHER', take);
    const types = [...byType.entries()].map(([type, bags]) => ({ type, label: VH.typeLabel(type), bags }));

    UI.modal({
      title: `Weigh and feed ${r.requestNo}`,
      body: `<div class="form-errors" role="alert"></div>
        <p class="muted">For each type, weigh <b>one bag</b> and type how many bags of that type go in. The app multiplies: bags × weight of one bag.</p>
        <div class="type-weigh">
          ${types.map((t, i) => `<div class="type-row">
            <b class="type-name">${esc(t.label)}</b>
            ${UI.field('Bags', UI.input('tb' + i, { type: 'number', min: 0, value: t.bags }))}
            ${UI.field('One bag (kg)', UI.input('tk' + i, { type: 'number', step: '0.01', min: 0 }))}
          </div>`).join('')}
        </div>
        <div id="consume-out"></div>
        <p class="small muted">${take} bags leave ${esc(r.bayCode)}${loadsText ? `, from ${esc(loadsText)}` : ''}.</p>
        <h4>The empty bags</h4>
        <p class="small muted">Count the bags as you empty them. Good ones go back to the bag store as used bags; torn ones are thrown away and replaced with new bags.</p>
        <div class="grid-2">
          ${UI.field('Good, back to the bag store', UI.input('bagsGood', { type: 'number', min: 0, value: take }))}
          ${UI.field('Torn or unusable', UI.input('bagsTorn', { type: 'number', min: 0, value: 0 }))}
        </div>
        <label class="check"><input type="checkbox" name="problem" /> Something was wrong (bags not full, stones, rot, wrong material): report it after saving</label>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="ok">Save</button>',
      onMount(el, close) {
        // rows as typed: bags and the weight of one bag, per type
        const rows = () => types.map((t, i) => ({
          type: t.type, label: t.label,
          bags: Math.max(0, Math.round(Number(el.querySelector(`[name=tb${i}]`).value) || 0)),
          kg: Number(el.querySelector(`[name=tk${i}]`).value) || 0,
        }));
        const recalc = () => {
          const rs = rows().filter((x) => x.bags > 0 && x.kg > 0);
          const box = el.querySelector('#consume-out');
          if (!rs.length) { box.innerHTML = VH.moistureScale(null); return; }
          const total = D.round2(rs.reduce((a, x) => a + x.bags * x.kg, 0));
          const nb = rs.reduce((a, x) => a + x.bags, 0);
          const avg = D.round2(total / nb);
          box.innerHTML = `
            <div class="calc-strip">
              <div><span class="muted small">Bags</span><b>${nb}</b></div>
              <div><span class="muted small">Weight into the gasifier</span><b>${kg(total)}</b></div>
              <div><span class="muted small">Average bag</span><b>${avg} kg</b></div>
            </div>
            ${VH.moistureScale(avg)}`;
        };
        UI.$$('.type-weigh input', el).forEach((inp) => inp.addEventListener('input', recalc));
        recalc();
        // torn bags typed in: the rest are good
        const good = el.querySelector('[name=bagsGood]');
        const torn = el.querySelector('[name=bagsTorn]');
        torn.addEventListener('input', () => { good.value = Math.max(0, take - (Number(torn.value) || 0)); });
        good.addEventListener('input', () => { torn.value = Math.max(0, take - (Number(good.value) || 0)); });

        el.querySelector('[data-act=ok]').addEventListener('click', () => {
          const rs = rows();
          const typeBags = rs.reduce((a, x) => a + x.bags, 0);
          const missingKg = rs.filter((x) => x.bags > 0 && !(x.kg > 0)).map((x) => x.label);
          if (missingKg.length) return UI.showErrors(el, [`Weigh one bag of: ${missingKg.join(', ')}`]);
          if (typeBags !== take) return UI.showErrors(el, [`The bags per type add up to ${typeBags}, but ${take} bags leave the bay`]);
          if (take < 1) return UI.toast(`${r.bayCode} is empty: there is nothing to issue`, 'danger');
          const bagsGood = Math.round(Number(good.value) || 0);
          const bagsTorn = Math.round(Number(torn.value) || 0);
          if (bagsGood < 0 || bagsTorn < 0 || bagsGood + bagsTorn !== take) {
            return UI.showErrors(el, [`Good (${bagsGood}) and torn (${bagsTorn}) must add up to the ${take} bags emptied`]);
          }
          const reportProblem = el.querySelector('[name=problem]').checked;
          const used = rs.filter((x) => x.bags > 0);
          const totalKg = D.round2(used.reduce((a, x) => a + x.bags * x.kg, 0));
          const avg = D.round2(totalKg / take);
          const moisture = D.moistureFromWeight(avg, s);
          const ws = used.map((x) => x.kg);
          const now = new Date().toISOString();
          const consumed = bayBags.slice(0, take);

          // Numbered bags among them go straight back to the bag store (good)
          // or are retired (torn), keeping their serials.
          const cleared = { supplierId: null, bayId: null, bayCode: null, deliveryId: null, bagIssueId: null };
          consumed.forEach((b, i) => {
            const ok = i < bagsGood;
            Object.assign(b, cleared, {
              status: ok ? 'IN_STOCK' : 'RETIRED', condition: ok ? 'USED' : 'TORN',
              consumedAt: now, usageId: r.id, returnedAt: now, updatedAt: now,
            });
            Store.markDirty('bags', b.id);
          });

          Store.update('usageRequests', r.id, {
            status: 'CONSUMED', bags: take, requestedBags: r.bags, sampleBags: ws, avgBagKg: avg, moisturePct: moisture,
            typeWeights: used.map((x) => ({ type: x.type, label: x.label, bags: x.bags, kg: x.kg })), totalKg, consumedAt: now, consumedBy: Auth.current().email,
            bagSerials: consumed.map((b) => b.serial), bagsGood, bagsTorn, fromLoads,
          }, 'usage-consume');
          // the bags just weighed are the newest reading of what is left in the bay
          if (Store.byId('bays', r.bayId)) Store.update('bays', r.bayId, { lastWeighKg: avg, lastWeighAt: now, lastWeighBy: Auth.current().email }, 'bay-weigh');

          VH.audit('usage.consume', 'usage', r.id, `${take} bags from ${r.bayCode} · ${used.map((x) => `${x.bags} ${x.label} x ${x.kg} kg`).join(' + ')} = ${totalKg} kg · moisture ${moisture}% · empty bags: ${bagsGood} good, ${bagsTorn} torn`);
          UI.toast(`${take} bags fed to the gasifier, ${kg(totalKg)}. ${bagsGood} empty bags back to the store${bagsTorn ? `, ${bagsTorn} torn` : ''}.`, 'ok', 5000);
          close(); App.refresh();
          if (reportProblem) setTimeout(() => App.raiseQuality(null, { usageId: r.id }), 280);
        });
      },
    });
  };
})();
