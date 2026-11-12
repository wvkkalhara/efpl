/* =====================================================================
   views-money.js — payments, suppliers, farmers, quality, returns,
   reports and administration (including the owner's kill switch).
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG, Store = window.Store, Auth = window.Auth,
    UI = window.UI, D = window.Domain, App = window.App, VH = window.VH, Sync = window.Sync;
  const { esc, money, kg, dt, dOnly, badge } = UI;

  const supplierName = (id) => (Store.byId('suppliers', id) || {}).name || '—';
  const farmerName = (id) => (Store.byId('farmers', id) || {}).name || '—';

  /* ============================== PAYMENTS =========================== */
  App.register('payments', {
    title: 'Payments',
    render(view) {
      const payments = Store.all('payments').slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const bucket = (statuses) => payments.filter((p) => statuses.includes(p.status));
      const pipeline = bucket(['DRAFT', 'PENDING_SUPERVISOR', 'APPROVED']);
      const sum = (list) => list.reduce((a, p) => a + (p.netAmount || 0), 0);

      view.innerHTML = `
        <section class="stats stats-4">
          ${UI.stat('In the pipeline', money(sum(pipeline)), `${pipeline.length} payment(s)`, pipeline.length ? 'warn' : null)}
          ${UI.stat('Awaiting authorisation', money(sum(bucket(['PENDING_SUPERVISOR']))), 'supervisor sign-off', 'warn')}
          ${UI.stat('With Head Office', money(sum(bucket(['SENT_TO_HEAD_OFFICE']))), 'released for payment')}
          ${UI.stat('Paid to date', money(sum(bucket(['PAID']))), `${bucket(['PAID']).length} settled`, 'ok')}
        </section>

        <div class="toolbar">
          <div class="seg">
            ${['All', 'Draft', 'Awaiting authorisation', 'Authorised', 'Sent to H.O.', 'Paid'].map((t, i) => {
              const map = ['ALL', 'DRAFT', 'PENDING_SUPERVISOR', 'APPROVED', 'SENT_TO_HEAD_OFFICE', 'PAID'];
              return `<button class="seg-btn ${i === 0 ? 'active' : ''}" data-pfilter="${map[i]}">${t}</button>`;
            }).join('')}
          </div>
        </div>
        <div id="payment-table"></div>
        <p class="muted small">A payment stays a draft until the supplier has declared which farmer each bag came from.</p>`;

      const draw = (filter) => {
        const list = filter === 'ALL' ? payments : payments.filter((p) => p.status === filter);
        view.querySelector('#payment-table').innerHTML = UI.table({
          rows: list, empty: 'No payments in this state.',
          rowKey: (p) => p.id,
          columns: [
            { label: 'Payment', render: (p) => `<b>${esc(p.paymentNo)}</b><div class="muted small">${esc(dOnly(p.createdAt))}</div>` },
            { label: 'Supplier', render: (p) => `${esc(p.supplierName || supplierName(p.supplierId))}<div class="muted small">${esc(p.supplierCode || '')}</div>` },
            { label: 'Bags', cls: 'num', render: (p) => (p.bags || 0).toLocaleString() },
            { label: 'Unit price', cls: 'num', render: (p) => money(p.unitPrice) },
            { label: 'Deducted', cls: 'num', render: (p) => (p.deductions ? `<span class="t-danger">${p.deductionPct ? `${p.deductionPct}% · ` : ''}${money(p.deductions)}</span>` : '<span class="muted">—</span>') },
            { label: 'Payable', cls: 'num', render: (p) => `<b>${money(p.netAmount)}</b>` },
            { label: 'Status', render: (p) => badge(D.PAYMENT_LABEL[p.status] || p.status, UI.statusTone(p.status)) },
            { label: '', cls: 'actions', render: (p) => `<button class="nm-btn tiny" data-pay="${p.id}">Open</button>` },
          ],
        });
        UI.$$('[data-pay]', view).forEach((b) => b.addEventListener('click', () => App.openPayment(b.dataset.pay)));
      };
      draw('ALL');
      UI.$$('[data-pfilter]', view).forEach((b) => b.addEventListener('click', () => {
        UI.$$('[data-pfilter]', view).forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        draw(b.dataset.pfilter);
      }));
    },
  });

  App.openPayment = function (id) {
    const p = Store.byId('payments', id);
    if (!p) return;
    const d = Store.byId('deliveries', p.deliveryId);
    const split = (d && d.farmerSplit) || [];
    const splitTotal = split.reduce((a, f) => a + Number(f.bags || 0), 0);
    const canApprove = Auth.can('payment.approve') && p.status === 'PENDING_SUPERVISOR';
    const canRelease = Auth.can('payment.release') && p.status === 'APPROVED';
    const canPay = Auth.can('payment.pay') && p.status === 'SENT_TO_HEAD_OFFICE';
    const canSplit = Auth.can('payment.split') && p.status === 'DRAFT';
    // The deduction can be corrected by the supervisor until the payment is authorised.
    const canDeduct = Auth.can('payment.approve') && ['DRAFT', 'PENDING_SUPERVISOR'].includes(p.status);

    UI.modal({
      title: `Payment ${p.paymentNo}`,
      size: 'lg',
      body: `
        <div class="detail-grid">
          <div class="nm-inset pad-sm">
            <h4>Payee</h4>
            <p><b>${esc(p.supplierName || supplierName(p.supplierId))}</b><br/><span class="muted">${esc(p.supplierCode || '')}</span></p>
            <h4>Against delivery</h4>
            <p>${d ? esc(d.receiptNo) : '—'}<br/><span class="muted">${d ? `${esc(d.bagCount)} bags · ${kg(d.netKg)} net` : ''}</span></p>
          </div>
          <div class="nm-inset pad-sm">
            <h4>Computation</h4>
            <table class="mini">
              <tr><td>Bags</td><td class="num">${p.bags}</td></tr>
              <tr><td>Unit price</td><td class="num">${money(p.unitPrice)}</td></tr>
              <tr><td>Gross</td><td class="num">${money(p.grossAmount)}</td></tr>
              <tr><td>Deducted${p.deductionPct ? ` (${p.deductionPct}%)` : ''}</td><td class="num ${p.deductions ? 't-danger' : ''}">${p.deductions ? '− ' : ''}${money(p.deductions || 0)}</td></tr>
              <tr><th>Net payable</th><th class="num">${money(p.netAmount)}</th></tr>
            </table>
            ${p.deductionReason ? `<p class="small muted">Reason: ${esc(p.deductionReason)}</p>` : ''}
          </div>
          <div class="nm-inset pad-sm">
            <h4>Farmer declaration</h4>
            ${split.length ? `<table class="mini"><thead><tr><th>Farmer</th><th class="num">Bags</th><th class="num">Share</th></tr></thead>
              <tbody>${split.map((f) => `<tr><td>${esc(f.code)} · ${esc(f.name)}</td><td class="num">${f.bags}</td>
                <td class="num">${money(D.round2(p.netAmount * (f.bags / (splitTotal || 1))))}</td></tr>`).join('')}</tbody></table>
              <p class="small ${splitTotal === p.bags ? 't-ok' : 't-warn'}">${splitTotal} of ${p.bags} bags declared</p>`
              : '<p class="muted">Not declared. Required before authorisation.</p>'}
          </div>
          <div class="nm-inset pad-sm">
            <h4>Status</h4>
            <p>${badge(D.PAYMENT_LABEL[p.status] || p.status, UI.statusTone(p.status))}</p>
            <h4>History</h4>
            <ul class="mini-timeline">
              ${(p.history || []).map((h) => `<li><b>${esc(h.action.replace(/_/g, ' '))}</b><span class="muted small">${esc(dt(h.at))} · ${esc(h.by)}</span>${h.note ? `<div class="small">${esc(h.note)}</div>` : ''}</li>`).join('') || '<li class="muted">No history.</li>'}
            </ul>
          </div>
        </div>`,
      footer: `
        <button class="nm-btn" data-act="slip"><i class="i i-printer"></i>Payment slip</button>
        ${canSplit ? '<button class="nm-btn" data-act="split">Declare farmer split</button>' : ''}
        ${canDeduct ? '<button class="nm-btn" data-act="deduct">Change deduction</button>' : ''}
        ${canApprove ? '<button class="nm-btn primary" data-act="approve">Authorise</button>' : ''}
        ${canRelease ? '<button class="nm-btn primary" data-act="release">Release to Head Office</button>' : ''}
        ${canPay ? '<button class="nm-btn primary" data-act="paid">Mark as paid</button>' : ''}`,
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          if (!btn) return;
          const act = btn.dataset.act;
          if (act === 'slip') return App.printPaymentSlip(p.id);
          if (act === 'split') { close(); return App.farmerSplitFlow(p.deliveryId); }
          if (act === 'deduct') { close(); return App.deductionFlow(p.id); }
          const now = new Date().toISOString();
          const who = Auth.current().email;
          const push = (action, note, patch) => {
            const history = (p.history || []).concat([{ at: now, by: who, action, note }]);
            Store.update('payments', p.id, Object.assign({ history }, patch), 'payment-' + act);
            VH.audit('payment.' + action.toLowerCase(), 'payment', p.id, `${p.paymentNo} · ${money(p.netAmount)}${note ? ' · ' + note : ''}`);
          };
          if (act === 'approve') {
            if (splitTotal !== p.bags) return UI.toast('The farmer declaration is incomplete', 'danger');
            push('APPROVED', el.querySelector('[name=approveNote]') ? el.querySelector('[name=approveNote]').value : 'Verified', { status: 'APPROVED', approvedBy: who, approvedAt: now });
            UI.toast('Payment authorised', 'ok');
          }
          if (act === 'release') {
            push('SENT_TO_HEAD_OFFICE', 'Released to Head Office', { status: 'SENT_TO_HEAD_OFFICE', sentBy: who, sentAt: now });
            UI.toast('Sent to Head Office', 'ok');
          }
          if (act === 'paid') {
            push('PAID', 'Settlement confirmed', { status: 'PAID', paidAt: now, paidBy: who });
            UI.toast('Marked as paid', 'ok');
          }
          close(); App.refresh();
        });
      },
    });
  };

  /** Set or correct the percentage taken off a batch (never a rejection). */
  App.deductionFlow = function (id) {
    const p = Store.byId('payments', id);
    if (!p) return;
    if (!Auth.can('payment.approve') || !['DRAFT', 'PENDING_SUPERVISOR'].includes(p.status)) {
      return UI.toast('The deduction can only be changed before the payment is authorised', 'warn');
    }
    const d = Store.byId('deliveries', p.deliveryId);
    UI.modal({
      title: `Deduction on ${p.paymentNo}`,
      body: `<div class="form-errors" role="alert"></div>
        <p class="muted">The load has been received. This takes a percentage off its value, for example for wet biomass.</p>
        ${d && d.avgBagKg ? VH.moistureScale(d.avgBagKg, { compact: true }) : ''}
        <div class="grid-2" style="margin-top:12px">
          ${UI.field('Deduct from this batch (%)', UI.input('deductionPct', { type: 'number', min: 0, max: 100, step: '0.5', value: p.deductionPct || 0 }))}
          ${UI.field('Reason for the deduction', UI.input('deductionReason', { value: p.deductionReason || '', placeholder: 'Wet load, foreign material…' }))}
        </div>
        <div class="calc-strip" id="deduct-out"></div>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save deduction</button>',
      onMount(el, close) {
        const pctEl = el.querySelector('[name=deductionPct]');
        const calc = () => D.applyDeduction(p.bags, p.unitPrice, pctEl.value);
        const paint = () => {
          const m = calc();
          el.querySelector('#deduct-out').innerHTML = `
            <div><span class="muted small">${p.bags} bags at ${money(p.unitPrice)}</span><b>${money(m.grossAmount)}</b></div>
            <div><span class="muted small">Deducted (${m.deductionPct}%)</span><b class="${m.deductions ? 't-danger' : ''}">${m.deductions ? '− ' : ''}${money(m.deductions)}</b></div>
            <div><span class="muted small">Payable to the supplier</span><b>${money(m.netAmount)}</b></div>`;
        };
        pctEl.addEventListener('input', paint);
        paint();
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const m = calc();
          const raw = Number(pctEl.value);
          const reason = el.querySelector('[name=deductionReason]').value.trim();
          const errors = [];
          if (pctEl.value !== '' && (!Number.isFinite(raw) || raw < 0 || raw > 100)) errors.push('Enter a percentage between 0 and 100');
          if (m.deductionPct > 0 && !reason) errors.push('Write the reason for the deduction');
          UI.showErrors(el, errors);
          if (errors.length) return;
          const now = new Date().toISOString();
          const note = m.deductionPct ? `${m.deductionPct}% deducted: ${reason}` : 'Deduction removed';
          Store.update('payments', p.id, {
            grossAmount: m.grossAmount, deductionPct: m.deductionPct, deductionReason: m.deductionPct ? reason : '',
            deductions: m.deductions, netAmount: m.netAmount,
            history: (p.history || []).concat([{ at: now, by: Auth.current().email, action: 'DEDUCTION_SET', note }]),
          }, 'payment-deduction');
          if (d) {
            Store.update('deliveries', d.id, {
              deductionPct: m.deductionPct, deductionReason: m.deductionPct ? reason : '',
              deductionAmount: m.deductions, payableAmount: m.netAmount,
            }, 'delivery-deduction');
          }
          VH.audit('payment.deduction', 'payment', p.id, `${p.paymentNo} · ${note} · payable ${money(m.netAmount)}`);
          UI.toast(m.deductionPct ? `${m.deductionPct}% deducted, ${money(m.netAmount)} payable` : 'Deduction removed', 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  App.printPaymentSlip = function (id) {
    const p = Store.byId('payments', id);
    if (!p) return;
    const d = Store.byId('deliveries', p.deliveryId);
    const f = (Store.byId('suppliers', p.supplierId) || {});
    const split = (d && d.farmerSplit) || [];
    const total = split.reduce((a, x) => a + Number(x.bags || 0), 0) || 1;
    const html = `${VH.printHeader('Payment authorisation', `${p.paymentNo} · ${D.PAYMENT_LABEL[p.status]}`)}
      <table>
        <tr><th>Supplier</th><td>${esc(f.code || '')} · ${esc(f.name || '')}</td><th>Delivery</th><td>${d ? esc(d.receiptNo) : '—'}</td></tr>
        <tr><th>Bags</th><td>${p.bags}</td><th>Unit price</th><td>${money(p.unitPrice)}</td></tr>
        <tr><th>Gross value</th><td>${money(p.grossAmount)}</td><th>Deducted${p.deductionPct ? ` (${p.deductionPct}%)` : ''}</th><td>${money(p.deductions || 0)}</td></tr>
        ${p.deductionReason ? `<tr><th>Reason for deduction</th><td colspan="3">${esc(p.deductionReason)}</td></tr>` : ''}
        <tr><th>Net payable</th><td colspan="3"><b>${money(p.netAmount)}</b></td></tr>
      </table>
      <h2>Farmer declaration</h2>
      <table><thead><tr><th>Code</th><th>Farmer</th><th>Bags</th><th>Value share</th></tr></thead>
        <tbody>${split.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${x.bags}</td><td>${money(D.round2(p.netAmount * (x.bags / total)))}</td></tr>`).join('')}</tbody></table>
      <h2>Authorisation trail</h2>
      <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Note</th></tr></thead>
        <tbody>${(p.history || []).map((h) => `<tr><td>${esc(dt(h.at))}</td><td>${esc(h.by)}</td><td>${esc(h.action)}</td><td>${esc(h.note || '')}</td></tr>`).join('')}</tbody></table>
      <div style="display:flex;gap:20mm;margin-top:14mm">
        <div class="sign">Prepared by</div><div class="sign">Biomass supervisor</div><div class="sign">Head Office accounts</div>
      </div>`;
    UI.print(html, p.paymentNo);
  };

  /* ============================== SUPPLIERS ========================== */
  App.register('suppliers', {
    title: 'Suppliers',
    render(view) {
      const suppliers = Store.where('suppliers', (s) => !s.deleted);
      view.innerHTML = `
        <div class="toolbar">
          <div class="toolbar-left"><input class="nm-input search" id="sup-search" placeholder="Search supplier, code, village…" /></div>
          <div class="toolbar-right">${Auth.can('supplier.write') ? '<button class="nm-btn primary" id="add-sup"><i class="i i-plus"></i>Add supplier</button>' : ''}</div>
        </div>
        <div id="sup-table"></div>`;

      const draw = (q) => {
        let list = suppliers;
        if (q) {
          const s = q.toLowerCase();
          list = list.filter((x) => `${x.name} ${x.code} ${x.address} ${x.phone}`.toLowerCase().includes(s));
        }
        view.querySelector('#sup-table').innerHTML = UI.table({
          rows: list, empty: 'No suppliers yet.', rowKey: (r) => r.id,
          columns: [
            { label: 'Code', render: (r) => `<b class="mono">${esc(r.code)}</b>` },
            { label: 'Supplier', render: (r) => `${esc(r.name)}${r.isFarmer ? ' <span class="pill">also a farmer</span>' : ''}<div class="muted small">${esc(r.address || '')}</div>` },
            { label: 'Contact', render: (r) => `${esc(r.phone || '—')}<div class="muted small">${esc(r.nic || '')}</div>` },
            { label: 'Farmers', cls: 'num', render: (r) => Store.where('farmers', (f) => f.supplierId === r.id && !f.deleted).length },
            { label: 'Bags (30d)', cls: 'num', render: (r) => Store.where('deliveries', (d) => d.supplierId === r.id && d.status === 'ACCEPTED' && Date.now() - Date.parse(d.acceptedAt || 0) < 30 * 864e5).reduce((a, d) => a + d.bagCount, 0).toLocaleString() },
            { label: 'Status', render: (r) => badge(r.status || 'ACTIVE', (r.status || 'ACTIVE') === 'ACTIVE' ? 'ok' : 'muted') },
            { label: '', cls: 'actions', render: (r) => `<button class="nm-btn tiny" data-sup="${r.id}">Open</button>` },
          ],
        });
        UI.$$('[data-sup]', view).forEach((b) => b.addEventListener('click', () => App.openSupplier(b.dataset.sup)));
      };
      draw('');
      view.querySelector('#sup-search').addEventListener('input', UI.debounce((e) => draw(e.target.value.trim()), 200));
      const add = view.querySelector('#add-sup');
      if (add) add.addEventListener('click', () => App.editSupplier(null));
    },
  });

  App.editSupplier = function (id) {
    const s = id ? Store.byId('suppliers', id) : null;
    UI.modal({
      title: s ? `Edit ${s.name}` : 'Add a supplier',
      body: `<div class="form-errors" role="alert"></div>
        <div class="grid-2">
          ${UI.field('Name', UI.input('name', { value: s ? s.name : '', required: true }))}
          ${UI.field('NIC / registration', UI.input('nic', { value: s ? s.nic : '', placeholder: '781234567V' }))}
          ${UI.field('Phone', UI.input('phone', { value: s ? s.phone : '', placeholder: '077 123 4567' }))}
          ${UI.field('Address / village', UI.input('address', { value: s ? s.address : '' }))}
          ${UI.field('Bank account', UI.input('bank', { value: s ? s.bank : '', placeholder: 'BOC · 0071234567' }))}
          ${UI.field('Status', UI.select('status', [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }], { value: s ? s.status : 'ACTIVE' }))}
        </div>
        <label class="check"><input type="checkbox" name="isFarmer" ${s && s.isFarmer ? 'checked' : ''} />
          <span>This supplier is also a registered farmer (requirement 10) — link to a farmer record</span></label>
        ${UI.field('Linked farmer', UI.select('farmerId', VH.farmerOptions(), { value: s && s.farmerId ? s.farmerId : '', placeholder: 'None' }))}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save supplier</button>',
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const f = UI.formData(el.querySelector('.modal-body'));
          if (!f.name) return UI.toast('Name is required', 'warn');
          const payload = {
            name: f.name, nic: f.nic, phone: f.phone, address: f.address, bank: f.bank,
            status: f.status, isFarmer: !!f.isFarmer, farmerId: f.farmerId || null,
          };
          if (s) {
            Store.update('suppliers', s.id, payload, 'supplier-update');
            VH.audit('supplier.update', 'supplier', s.id, s.name);
          } else {
            const rec = Store.add('suppliers', Object.assign({
              code: 'SUP-' + String(Store.nextSeq('supplier', 1)).padStart(4, '0'),
            }, payload), 'supplier-create');
            VH.audit('supplier.create', 'supplier', rec.id, `${rec.code} · ${rec.name}`);
          }
          UI.toast('Supplier saved', 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  App.openSupplier = function (id) {
    const s = Store.byId('suppliers', id);
    if (!s) return;
    const farmers = Store.where('farmers', (f) => f.supplierId === id && !f.deleted);
    const deliveries = Store.where('deliveries', (d) => d.supplierId === id).slice().sort((a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt));
    const payments = Store.where('payments', (p) => p.supplierId === id);
    const issues = Store.where('qualityIssues', (q) => q.supplierId === id);
    const avgFill = (() => {
      const withFill = deliveries.filter((d) => d.fillCheck && d.fillCheck.avgFillPct !== null);
      return withFill.length ? D.round2(withFill.reduce((a, d) => a + d.fillCheck.avgFillPct, 0) / withFill.length) : null;
    })();

    UI.modal({
      title: `${s.code} · ${s.name}`,
      size: 'lg',
      body: `
        <div class="detail-grid">
          <div class="nm-inset pad-sm">
            <h4>Contact</h4>
            <p>${esc(s.phone || '—')}<br/><span class="muted">${esc(s.address || '')}<br/>${esc(s.nic || '')}</span></p>
            <h4>Bank</h4><p>${esc(s.bank || '—')}</p>
            <h4>Score</h4>
            <p>Avg fill <b>${avgFill === null ? '—' : `${avgFill}%`}</b><br/>
               Quality issues <b>${issues.length}</b> (${issues.filter((i) => i.status === 'OPEN').length} open)</p>
          </div>
          <div class="nm-inset pad-sm">
            <h4>Farmers (${farmers.length})</h4>
            <ul class="plain-list">${farmers.slice(0, 12).map((f) => `<li>${esc(f.code)} · ${esc(f.name)} <span class="muted small">${esc(f.village || '')}</span></li>`).join('') || '<li class="muted">None registered.</li>'}</ul>
            ${Auth.can('farmer.write') ? '<button class="nm-btn tiny" data-act="addfarmer"><i class="i i-plus"></i>Add farmer</button>' : ''}
          </div>
          <div class="nm-inset pad-sm">
            <h4>Recent deliveries</h4>
            <ul class="plain-list">${deliveries.slice(0, 6).map((d) => `<li>${esc(d.receiptNo)} · ${d.bagCount} bags <span class="muted small">${esc(dOnly(d.deliveredAt))}</span></li>`).join('') || '<li class="muted">None.</li>'}</ul>
            <h4>Payments</h4>
            <ul class="plain-list">${payments.slice(0, 5).map((p) => `<li>${esc(p.paymentNo)} · ${money(p.netAmount)} <span class="muted small">${esc(D.PAYMENT_LABEL[p.status])}</span></li>`).join('') || '<li class="muted">None.</li>'}</ul>
          </div>
        </div>`,
      footer: `${Auth.can('supplier.write') ? '<button class="nm-btn" data-act="edit">Edit supplier</button>' : ''}
               <button class="nm-btn" data-act="stmt"><i class="i i-printer"></i>Statement</button>`,
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          if (b.dataset.act === 'edit') { close(); App.editSupplier(s.id); }
          if (b.dataset.act === 'addfarmer') { close(); App.editFarmer(null, s.id); }
          if (b.dataset.act === 'stmt') App.printSupplierStatement(s.id);
        });
      },
    });
  };

  App.printSupplierStatement = function (id) {
    const s = Store.byId('suppliers', id);
    const deliveries = Store.where('deliveries', (d) => d.supplierId === id && d.status === 'ACCEPTED');
    const payments = Store.where('payments', (p) => p.supplierId === id);
    const html = `${VH.printHeader('Supplier statement', `${s.code} · ${s.name}`)}
      <table><thead><tr><th>Receipt</th><th>Date</th><th>Bags</th><th>Net kg</th><th>Fill</th><th>Unit price</th><th>Deducted</th><th>Payable</th></tr></thead>
        <tbody>${deliveries.map((d) => `<tr><td>${esc(d.receiptNo)}</td><td>${esc(dOnly(d.deliveredAt))}</td><td>${d.bagCount}</td><td>${d.netKg}</td>
          <td>${d.fillCheck && d.fillCheck.avgFillPct !== null ? d.fillCheck.avgFillPct + '%' : '—'}</td><td>${money(d.fillCheck ? d.fillCheck.unitPrice : 0)}</td>
          <td>${d.deductionPct ? `${d.deductionPct}%` : '—'}</td><td>${money(VH.payable(d))}</td></tr>`).join('')}</tbody></table>
      <h2>Payments</h2>
      <table><thead><tr><th>Payment</th><th>Status</th><th>Net</th><th>Date</th></tr></thead>
        <tbody>${payments.map((p) => `<tr><td>${esc(p.paymentNo)}</td><td>${esc(D.PAYMENT_LABEL[p.status])}</td><td>${money(p.netAmount)}</td><td>${esc(dOnly(p.createdAt))}</td></tr>`).join('')}</tbody></table>`;
    UI.print(html, `Statement ${s.code}`);
  };

  /* =============================== FARMERS =========================== */
  App.register('farmers', {
    title: 'Farmers',
    render(view) {
      const farmers = Store.where('farmers', (f) => !f.deleted);
      view.innerHTML = `
        <div class="toolbar">
          <div class="toolbar-left">
            <input class="nm-input search" id="f-search" placeholder="Search farmer, code, village…" />
            ${UI.select('supFilter', [{ value: '', label: 'All suppliers' }, ...VH.supplierOptions()], { id: 'f-sup' })}
          </div>
          <div class="toolbar-right">${Auth.can('farmer.write') ? '<button class="nm-btn primary" id="add-farmer"><i class="i i-plus"></i>Add farmer</button>' : ''}</div>
        </div>
        <div id="f-table"></div>`;
      const draw = () => {
        const q = view.querySelector('#f-search').value.trim().toLowerCase();
        const sup = view.querySelector('#f-sup').value;
        let list = farmers;
        if (sup) list = list.filter((f) => f.supplierId === sup);
        if (q) list = list.filter((f) => `${f.name} ${f.code} ${f.village} ${f.farmerNo}`.toLowerCase().includes(q));
        view.querySelector('#f-table').innerHTML = UI.table({
          rows: list, empty: 'No farmers match.', rowKey: (r) => r.id,
          columns: [
            { label: 'Code', render: (r) => `<b class="mono">${esc(r.code)}</b>` },
            { label: 'Farmer', render: (r) => `${esc(r.name)}<div class="muted small">${esc(r.village || '')}${r.farmerNo ? ` · reg ${esc(r.farmerNo)}` : ''}</div>` },
            { label: 'Supplier', render: (r) => esc(r.supplierId ? supplierName(r.supplierId) : '—') },
            { label: 'Phone', render: (r) => esc(r.phone || '—') },
            { label: 'Bags (30d)', cls: 'num', render: (r) => Store.where('bags', (b) => b.farmerId === r.id && Date.now() - Date.parse(b.deliveredAt || 0) < 30 * 864e5).length.toLocaleString() },
            { label: '', cls: 'actions', render: (r) => `<button class="nm-btn tiny" data-farmer="${r.id}">Open</button>` },
          ],
        });
        UI.$$('[data-farmer]', view).forEach((b) => b.addEventListener('click', () => App.openFarmer(b.dataset.farmer)));
      };
      draw();
      view.querySelector('#f-search').addEventListener('input', UI.debounce(draw, 200));
      view.querySelector('#f-sup').addEventListener('change', draw);
      const add = view.querySelector('#add-farmer');
      if (add) add.addEventListener('click', () => App.editFarmer(null, null));
    },
  });

  App.editFarmer = function (id, presetSupplier) {
    const f = id ? Store.byId('farmers', id) : null;
    UI.modal({
      title: f ? `Edit ${f.name}` : 'Register a farmer',
      body: `<div class="form-errors" role="alert"></div>
        <div class="grid-2">
          ${UI.field('Name', UI.input('name', { value: f ? f.name : '', required: true }))}
          ${UI.field('Supplier', UI.select('supplierId', VH.supplierOptions(), { value: f ? f.supplierId : (presetSupplier || ''), placeholder: 'Select supplier…' }))}
          ${UI.field('Farmer registration no.', UI.input('farmerNo', { value: f ? f.farmerNo : '', placeholder: 'F12 / as used on the tag' }))}
          ${UI.field('Village', UI.input('village', { value: f ? f.village : '' }))}
          ${UI.field('NIC', UI.input('nic', { value: f ? f.nic : '' }))}
          ${UI.field('Phone', UI.input('phone', { value: f ? f.phone : '' }))}
          ${UI.field('Land (acres)', UI.input('landAcres', { type: 'number', min: 0, step: '0.1', value: f ? f.landAcres : '' }))}
          ${UI.field('Status', UI.select('status', [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }], { value: f ? f.status : 'ACTIVE' }))}
        </div>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save farmer</button>',
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const data = UI.formData(el.querySelector('.modal-body'));
          if (!data.name) return UI.toast('Name is required', 'warn');
          const payload = {
            name: data.name, supplierId: data.supplierId || null, farmerNo: data.farmerNo,
            village: data.village, nic: data.nic, phone: data.phone,
            landAcres: data.landAcres, status: data.status,
          };
          if (f) { Store.update('farmers', f.id, payload, 'farmer-update'); VH.audit('farmer.update', 'farmer', f.id, payload.name); }
          else {
            const rec = Store.add('farmers', Object.assign({ code: 'FRM-' + String(Store.nextSeq('farmer', 1)).padStart(4, '0') }, payload), 'farmer-create');
            VH.audit('farmer.create', 'farmer', rec.id, `${rec.code} · ${rec.name}`);
          }
          UI.toast('Farmer saved', 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  App.openFarmer = function (id) {
    const f = Store.byId('farmers', id);
    if (!f) return;
    const bags = Store.where('bags', (b) => b.farmerId === id);
    const issues = Store.where('qualityIssues', (q) => q.farmerId === id);
    UI.modal({
      title: `${f.code} · ${f.name}`,
      body: `<div class="detail-grid">
        <div class="nm-inset pad-sm">
          <h4>Details</h4>
          <p>${esc(f.village || '—')}<br/><span class="muted">${esc(f.phone || '')} · ${esc(f.nic || '')}</span><br/>
             Supplier: <b>${esc(f.supplierId ? supplierName(f.supplierId) : '—')}</b><br/>
             Registration: <b>${esc(f.farmerNo || '—')}</b></p>
        </div>
        <div class="nm-inset pad-sm">
          <h4>Supply record</h4>
          <p>Bags in system: <b>${bags.length}</b><br/>
             In bays: <b>${bags.filter((b) => b.status === 'STORED').length}</b><br/>
             Consumed: <b>${bags.filter((b) => b.status === 'CONSUMED').length}</b><br/>
             Quality issues: <b>${issues.length}</b> (${issues.filter((i) => i.status === 'OPEN').length} open)</p>
        </div>
      </div>
      ${issues.length ? `<h4>Issues traced to this farmer</h4><ul class="plain-list">${issues.map((i) => `<li>${esc(i.issueNo)} · ${esc(i.category)} <span class="muted small">${esc(i.status)}</span></li>`).join('')}</ul>` : ''}`,
      footer: Auth.can('farmer.write') ? '<button class="nm-btn" data-act="edit">Edit</button>' : '',
      onMount(el, close) {
        const b = el.querySelector('[data-act=edit]');
        if (b) b.addEventListener('click', () => { close(); App.editFarmer(f.id, null); });
      },
    });
  };

  /* ============================ QUALITY ISSUES ======================= */
  App.register('quality', {
    title: 'Quality issues',
    render(view) {
      const issues = Store.all('qualityIssues').slice().sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt));
      view.innerHTML = `
        <section class="nm-card pad">
          <div class="card-head"><h3>Problems traced to a supplier and a farmer</h3>
            ${Auth.can('quality.report') ? '<button class="nm-btn primary" id="new-issue"><i class="i i-plus"></i>Report an issue</button>' : ''}</div>
          <p class="muted">When biomass causes trouble at the gasifier, the bag serial leads to the supplier and the farmer, so the corrective action reaches the right people.</p>
        </section>
        ${UI.table({
          rows: issues, empty: 'No quality issues reported.', rowKey: (r) => r.id,
          columns: [
            { label: 'Issue', render: (r) => `<b>${esc(r.issueNo)}</b><div class="muted small">${esc(dOnly(r.reportedAt))}</div>` },
            { label: 'Bag', render: (r) => `<span class="mono">${esc(r.bagSerial || '—')}</span>` },
            { label: 'Supplier and farmer', render: (r) => `${esc(r.supplierName || supplierName(r.supplierId))}<div class="muted small">${esc(r.farmerName || farmerName(r.farmerId))}</div>` },
            { label: 'Category', render: (r) => esc((r.category || '').replace(/_/g, ' ').toLowerCase()) },
            { label: 'Severity', render: (r) => badge(r.severity, r.severity === 'HIGH' ? 'danger' : r.severity === 'MEDIUM' ? 'warn' : 'muted') },
            { label: 'Status', render: (r) => badge(r.status, r.status === 'OPEN' ? 'warn' : 'ok') },
            { label: '', cls: 'actions', render: (r) => `<button class="nm-btn tiny" data-qi="${r.id}">Open</button>` },
          ],
        })}`;
      const nw = view.querySelector('#new-issue');
      if (nw) nw.addEventListener('click', () => App.raiseQuality(null));
      UI.$$('[data-qi]', view).forEach((b) => b.addEventListener('click', () => App.openQuality(b.dataset.qi)));
    },
  });

  App.raiseQuality = function (serial) {
    const serials = Store.where('bags', (b) => ['STORED', 'CONSUMED'].includes(b.status)).slice(-400).reverse();
    UI.modal({
      title: 'Report a quality issue',
      size: 'md',
      body: `<p class="muted">Enter the serial from the bag tag. The supplier and farmer are filled in automatically — that is the whole point of numbering the bag.</p>
        <div class="form-errors" role="alert"></div>
        ${UI.field('Bag serial', UI.input('serial', { value: serial || '', placeholder: 'EFPL-BG-000302', list: 'serial-list' }))}
        <datalist id="serial-list">${serials.slice(0, 200).map((b) => `<option value="${esc(b.serial)}"></option>`).join('')}</datalist>
        <div id="qi-trace" class="calc-strip"></div>
        <div class="grid-2">
          ${UI.field('Category', UI.select('category', [
            { value: 'MOISTURE', label: 'High moisture' }, { value: 'FOREIGN_MATERIAL', label: 'Foreign material' },
            { value: 'UNDERFILLED', label: 'Under-filled bags' }, { value: 'SPECIES', label: 'Wrong species' },
            { value: 'DAMAGED_BAG', label: 'Damaged bag' }, { value: 'OTHER', label: 'Other' },
          ]))}
          ${UI.field('Severity', UI.select('severity', [
            { value: 'LOW', label: 'Low' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HIGH', label: 'High' },
          ], { value: 'MEDIUM' }))}
        </div>
        ${UI.field('What happened?', UI.textarea('description', { rows: 3, placeholder: 'Gasifier flame unstable, bag weight 30 kg at consumption…' }))}
        ${UI.field('Corrective action', UI.textarea('correctiveAction', { rows: 2, placeholder: 'Supplier to dry before bagging; mix 1:2 with a drier bay.' }))}
        ${UI.field('How were they informed?', UI.input('notifiedVia', { placeholder: 'Phone call to supplier + WhatsApp to farmer group' }))}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Record issue</button>',
      onMount(el, close) {
        const input = el.querySelector('[name=serial]');
        const trace = () => {
          const v = input.value.trim();
          const box = el.querySelector('#qi-trace');
          if (!v) { box.innerHTML = '<span class="muted">Enter a serial to see who supplied the bag.</span>'; return; }
          const r = D.traceBag(Store, v);
          if (!r) { box.innerHTML = '<span class="t-warn">Serial not found in the registry</span>'; return; }
          box.innerHTML = `<div><span class="muted small">Supplier</span><b>${esc(r.supplier ? r.supplier.name : '—')}</b></div>
            <div><span class="muted small">Farmer</span><b>${esc(r.farmer ? r.farmer.name : 'not declared')}</b></div>
            <div><span class="muted small">Bay</span><b>${esc(r.bag.bayCode || '—')}</b></div>
            <div><span class="muted small">Status</span><b>${esc(D.BAG_STATUS_LABEL[r.bag.status] || r.bag.status)}</b></div>`;
        };
        input.addEventListener('input', UI.debounce(trace, 220));
        trace();

        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const data = UI.formData(el.querySelector('.modal-body'));
          const r = D.traceBag(Store, data.serial);
          if (!data.serial || !r) return UI.toast('Enter a valid bag serial', 'warn');
          if (!data.description) return UI.toast('Describe what happened', 'warn');
          const rec = Store.add('qualityIssues', {
            issueNo: 'QI-' + String(Store.nextSeq('quality', 1)).padStart(4, '0'),
            bagSerial: r.bag.serial, deliveryId: r.bag.deliveryId || null,
            supplierId: r.bag.supplierId || null, supplierName: r.supplier ? r.supplier.name : null,
            farmerId: r.bag.farmerId || null, farmerName: r.farmer ? r.farmer.name : null,
            category: data.category, severity: data.severity, description: data.description,
            correctiveAction: data.correctiveAction || '', status: 'OPEN',
            reportedBy: Auth.current().email, reportedAt: new Date().toISOString(),
            notifiedVia: data.notifiedVia || '', notifiedAt: data.notifiedVia ? new Date().toISOString() : null,
            usageId: r.usage ? r.usage.id : null,
          }, 'quality-create');
          VH.audit('quality.report', 'quality', rec.id, `${rec.issueNo} · ${rec.bagSerial} · ${rec.severity}`);
          UI.toast(`Issue ${rec.issueNo} recorded and traced`, 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  App.openQuality = function (id) {
    const q = Store.byId('qualityIssues', id);
    if (!q) return;
    const r = D.traceBag(Store, q.bagSerial);
    UI.modal({
      title: `${q.issueNo} · ${q.bagSerial}`,
      size: 'md',
      body: `<p>${badge(q.severity, q.severity === 'HIGH' ? 'danger' : q.severity === 'MEDIUM' ? 'warn' : 'muted')} ${badge(q.status, q.status === 'OPEN' ? 'warn' : 'ok')}</p>
        <div class="detail-grid">
          <div class="nm-inset pad-sm"><h4>Traced to</h4>
            <p>Supplier: <b>${esc(q.supplierName || '—')}</b><br/>Farmer: <b>${esc(q.farmerName || '—')}</b><br/>
            Bay: <b>${esc(r && r.bag.bayCode ? r.bag.bayCode : '—')}</b><br/>
            Receipt: <b>${esc(r && r.delivery ? r.delivery.receiptNo : '—')}</b></p></div>
          <div class="nm-inset pad-sm"><h4>Reported</h4>
            <p>${esc(dt(q.reportedAt))}<br/><span class="muted">by ${esc(q.reportedBy)}</span><br/>
            Notified: ${esc(q.notifiedVia || 'not yet')}${q.notifiedAt ? `<br/><span class="muted">${esc(dt(q.notifiedAt))}</span>` : ''}</p></div>
        </div>
        <h4>Description</h4><p>${esc(q.description)}</p>
        <h4>Corrective action</h4><p>${esc(q.correctiveAction || '—')}</p>
        ${q.status === 'RESOLVED' ? `<p class="small t-ok">Resolved ${esc(dt(q.resolvedAt))} by ${esc(q.resolvedBy || '')}</p>` : ''}`,
      footer: q.status === 'OPEN' && Auth.can('quality.resolve')
        ? '<button class="nm-btn" data-act="notify">Mark supplier &amp; farmer notified</button><button class="nm-btn primary" data-act="resolve">Resolve</button>' : '',
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          if (b.dataset.act === 'notify') {
            Store.update('qualityIssues', q.id, { notifiedAt: new Date().toISOString(), notifiedVia: 'Supplier + farmer informed by supervisor' }, 'quality-notify');
            VH.audit('quality.notify', 'quality', q.id, `${q.issueNo} notified`);
            UI.toast('Notification recorded', 'ok'); close(); App.refresh();
          }
          if (b.dataset.act === 'resolve') {
            Store.update('qualityIssues', q.id, { status: 'RESOLVED', resolvedAt: new Date().toISOString(), resolvedBy: Auth.current().email }, 'quality-resolve');
            VH.audit('quality.resolve', 'quality', q.id, q.issueNo);
            UI.toast('Issue resolved', 'ok'); close(); App.refresh();
          }
        });
      },
    });
  };

  /* ============================ BAG RETURNS ========================= */
  App.register('returns', {
    title: 'Bag returns',
    render(view) {
      const bags = Store.all('bags');
      const returned = bags.filter((b) => b.status === 'CONSUMED' || b.status === 'RETURNED');
      const damaged = bags.filter((b) => b.status === 'DAMAGED');
      const returns = Store.all('bagReturns').slice().sort((a, b) => Date.parse(b.returnedAt) - Date.parse(a.returnedAt));
      const pendingReplacement = returns.reduce((a, r) => a + (r.replacementOrderQty || 0), 0);

      view.innerHTML = `
        <section class="stats stats-4">
          ${UI.stat('Empty bags to check', returned.length.toLocaleString(), 'emptied at the gasifier', returned.length ? 'warn' : null)}
          ${UI.stat('Being repaired', damaged.length.toLocaleString(), 'back to stock once fixed', damaged.length ? 'warn' : null)}
          ${UI.stat('Bags in store', bags.filter((b) => b.status === 'IN_STOCK').length.toLocaleString(), 'numbered and available')}
          ${UI.stat('Replacements ordered', pendingReplacement.toLocaleString(), 'across all returns')}
        </section>
        <div class="toolbar">
          <p class="muted">Empty bags come back to the bag area, are checked, repaired where possible, and replacements are ordered.</p>
          <div class="toolbar-right">
            ${Auth.can('returns.write') && damaged.length ? `<button class="nm-btn" id="repaired-back">Repaired bags back to stock (${damaged.length})</button>` : ''}
            ${Auth.can('returns.write') ? '<button class="nm-btn primary" id="new-return"><i class="i i-plus"></i>Record a return</button>' : ''}
          </div>
        </div>
        ${UI.table({
          rows: returns, empty: 'No returns recorded yet.',
          columns: [
            { label: 'Return', render: (r) => `<b>${esc(r.returnNo)}</b><div class="muted small">${esc(dOnly(r.returnedAt))}</div>` },
            { label: 'Returned', cls: 'num', render: (r) => r.returnedBags },
            { label: 'Good', cls: 'num', render: (r) => r.good },
            { label: 'For repair', cls: 'num', render: (r) => r.repairable },
            { label: 'Replaced', cls: 'num', render: (r) => r.replaced },
            { label: 'Order raised', render: (r) => (r.repairOrderRaised ? badge('repair order', 'ok') : '') + (r.replacementOrderQty ? ` ${badge(`${r.replacementOrderQty} new bags`, 'info')}` : '') },
            { label: 'Note', render: (r) => `<span class="muted small">${esc(r.note || '')}</span>` },
          ],
        })}`;
      const nr = view.querySelector('#new-return');
      if (nr) nr.addEventListener('click', () => App.recordReturn());
      const rb = view.querySelector('#repaired-back');
      if (rb) rb.addEventListener('click', async () => {
        const ok = await UI.confirm({
          title: 'Repaired bags back to stock?', tone: 'primary', confirmText: 'Back to stock',
          message: `${damaged.length} repaired bag(s) keep their serial numbers and become available to issue again.`,
        });
        if (!ok) return;
        const now = new Date().toISOString();
        for (const b of damaged) { Object.assign(b, { status: 'IN_STOCK', condition: 'REPAIRED', updatedAt: now }); Store.markDirty('bags', b.id); }
        Store.save('bag-repaired');
        VH.audit('returns.repaired', 'bags', 'batch', `${damaged.length} repaired bags returned to stock`);
        UI.toast(`${damaged.length} bags back in stock`, 'ok');
        App.refresh();
      });
    },
  });

  App.recordReturn = function () {
    const waiting = Store.where('bags', (b) => b.status === 'CONSUMED' || b.status === 'RETURNED').length;
    const start = Math.min(waiting, 50);
    UI.modal({
      title: 'Record a bag return',
      body: `<div class="form-errors" role="alert"></div>
        <p class="muted">${waiting.toLocaleString()} empty bag(s) are waiting to be checked. Sort the returned bags into the three groups below.</p>
        <div class="grid-3">
          ${UI.field('Bags returned', UI.input('returnedBags', { type: 'number', min: 1, value: start, required: true }))}
          ${UI.field('Good, back to stock', UI.input('good', { type: 'number', min: 0, value: start }))}
          ${UI.field('Can be repaired', UI.input('repairable', { type: 'number', min: 0, value: 0 }))}
        </div>
        <div class="grid-2">
          ${UI.field('Beyond repair (replace)', UI.input('replaced', { type: 'number', min: 0, value: 0 }))}
          ${UI.field('New bags to order', UI.input('replacementOrderQty', { type: 'number', min: 0, value: 0 }))}
        </div>
        ${UI.field('Note', UI.input('note', { placeholder: 'Stitching repaired in-house…' }))}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save</button>',
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const data = UI.formData(el.querySelector('.modal-body'));
          const total = Number(data.returnedBags) || 0;
          const good = Number(data.good) || 0, repairable = Number(data.repairable) || 0, replaced = Number(data.replaced) || 0;
          const errors = [];
          if (total < 1) errors.push('Enter how many bags were returned');
          if (good + repairable + replaced > total) errors.push('The three groups add up to more bags than were returned');
          UI.showErrors(el, errors);
          if (errors.length) return;
          const rec = Store.add('bagReturns', {
            returnNo: 'BR-' + String(Store.nextSeq('bagReturn', 1)).padStart(4, '0'),
            returnedBags: total, good, repairable, replaced, lost: Math.max(0, total - good - repairable - replaced),
            returnedAt: new Date().toISOString(), recordedBy: Auth.current().email,
            repairOrderRaised: repairable > 0, replacementOrderQty: Number(data.replacementOrderQty) || 0,
            replacementOrderedAt: Number(data.replacementOrderQty) ? new Date().toISOString() : null,
            note: data.note || '',
          }, 'bag-return-record');

          // Move the emptied bags on, oldest first. Each keeps its serial; the
          // links to the finished trip are cleared so the next round starts clean.
          const pool = Store.where('bags', (b) => b.status === 'CONSUMED' || b.status === 'RETURNED')
            .slice().sort((a, b) => Date.parse(a.consumedAt || a.updatedAt || 0) - Date.parse(b.consumedAt || b.updatedAt || 0));
          const now = new Date().toISOString();
          const cleared = { supplierId: null, farmerId: null, bayId: null, bayCode: null, deliveryId: null, usageId: null, bagIssueId: null, returnedAt: now, updatedAt: now };
          let i = 0;
          const move = (n, patch) => {
            for (let k = 0; k < n && i < pool.length; k++, i++) { Object.assign(pool[i], cleared, patch); Store.markDirty('bags', pool[i].id); }
          };
          move(good, { status: 'IN_STOCK', condition: 'GOOD' });
          move(repairable, { status: 'DAMAGED', condition: 'REPAIR' });
          move(replaced, { status: 'RETIRED', condition: 'BEYOND_REPAIR' });
          Store.save('bag-return-sync');

          VH.audit('returns.record', 'bagReturn', rec.id, `${total} bags · ${good} good · ${repairable} for repair · ${replaced} replaced`);
          UI.toast('Return recorded', 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  /* =============================== REPORTS ===========================
     A live view: pick any period, supplier or biomass type and every
     figure, chart and table follows at once. The choices are remembered
     while the app is open, and the page redraws when records arrive from
     another device. "Print" and "CSV" give the same figures on paper.
     ==================================================================== */
  const reportState = { preset: '30', from: '', to: '', supplier: '', type: '' };

  App.register('reports', {
    title: 'Reports',
    perm: 'report.read',
    render(view) {
      const st = reportState;
      const localISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const today = () => new Date();
      const setPreset = (p) => {
        st.preset = p;
        if (p === 'all') { st.from = ''; st.to = ''; }
        else if (p === 'month') { const t = today(); st.from = localISO(new Date(t.getFullYear(), t.getMonth(), 1)); st.to = localISO(t); }
        else if (p !== 'custom') { st.from = localISO(new Date(Date.now() - (Number(p) - 1) * 864e5)); st.to = localISO(today()); }
      };
      if (st.preset !== 'custom') setPreset(st.preset);   // "last 30 days" always ends today

      const PRESETS = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['month', 'This month'], ['all', 'All time']];

      view.innerHTML = `
        <section class="nm-card pad report-filters">
          <div class="seg" id="rp-presets">
            ${PRESETS.map(([v, l]) => `<button class="seg-btn" data-preset="${v}">${l}</button>`).join('')}
          </div>
          <div class="report-filter-row">
            ${UI.field('From', UI.input('rpFrom', { type: 'date', value: st.from }))}
            ${UI.field('To', UI.input('rpTo', { type: 'date', value: st.to }))}
            ${UI.field('Supplier', UI.select('rpSupplier', [{ value: '', label: 'All suppliers' }, ...VH.supplierOptions()], { value: st.supplier }))}
            ${UI.field('Biomass type', UI.select('rpType', [{ value: '', label: 'All types' }, ...VH.biomassTypes().map((t) => ({ value: t.id, label: t.label }))], { value: st.type }))}
            <div class="report-actions">
              <button class="nm-btn" id="print-report"><i class="i i-printer"></i>Print</button>
              <button class="nm-btn" id="full-backup"><i class="i i-download"></i>Backup</button>
            </div>
          </div>
        </section>
        <div id="report-body"></div>`;

      /* ------------------------------ figures -------------------------- */
      function compute() {
        const start = st.from ? Date.parse(`${st.from}T00:00:00`) : -Infinity;
        const end = st.to ? Date.parse(`${st.to}T23:59:59.999`) : Infinity;
        const inRange = (iso) => { const t = Date.parse(iso || 0); return Number.isFinite(t) && t >= start && t <= end; };
        const filtered = !!(st.supplier || st.type);

        const deliveries = Store.where('deliveries', (d) => !d.deleted && d.status === 'ACCEPTED' && inRange(d.acceptedAt || d.deliveredAt)
          && (!st.supplier || d.supplierId === st.supplier) && (!st.type || d.biomassType === st.type));
        const ids = new Set(deliveries.map((d) => d.id));

        // Gasifier issues are matched to the filter through the bags they consumed.
        let usages = Store.where('usageRequests', (u) => !u.deleted && u.status === 'CONSUMED' && inRange(u.consumedAt));
        if (filtered) {
          const bagDelivery = new Map(Store.all('bags').map((b) => [b.serial, b]));
          usages = usages.map((u) => {
            const serials = u.bagSerials || [];
            const mine = serials.filter((sn) => {
              const b = bagDelivery.get(sn);
              const d = b && b.deliveryId ? Store.byId('deliveries', b.deliveryId) : null;
              return b && b.usageId === u.id && d && (!st.supplier || d.supplierId === st.supplier) && (!st.type || d.biomassType === st.type);
            }).length;
            return mine ? Object.assign({}, u, { bags: mine, totalKg: D.round2((u.avgBagKg || 0) * mine) }) : null;
          }).filter(Boolean);
        }

        const sum = (list, f) => list.reduce((a, x) => a + (Number(f(x)) || 0), 0);
        const bagsIn = sum(deliveries, (d) => d.bagCount);
        const kgIn = sum(deliveries, (d) => d.netKg);
        const bagsOut = sum(usages, (u) => u.bags);
        const kgOut = sum(usages, (u) => u.totalKg);
        const payable = sum(deliveries, (d) => VH.payable(d));
        const deducted = sum(deliveries, (d) => d.deductionAmount);
        const gross = sum(deliveries, (d) => (d.fillCheck && d.fillCheck.amount));
        const reduced = deliveries.filter((d) => d.fillCheck && d.fillCheck.decision === 'REDUCED_PRICE').length;
        const withDeduction = deliveries.filter((d) => d.deductionPct > 0).length;
        const avgKgIn = bagsIn ? D.round2(kgIn / bagsIn) : null;
        const avgKgOut = bagsOut ? D.round2(kgOut / bagsOut) : null;

        const payments = Store.where('payments', (p) => !p.deleted && ids.has(p.deliveryId));
        const payRows = Object.keys(D.PAYMENT_FLOW).map((status) => {
          const list = payments.filter((p) => p.status === status);
          return { status, count: list.length, value: sum(list, (p) => p.netAmount) };
        });

        const group = (keyOf, labelOf) => {
          const map = {};
          for (const d of deliveries) {
            const k = keyOf(d) || '—';
            const g = map[k] = map[k] || { key: k, name: labelOf(k), loads: 0, bags: 0, kg: 0, value: 0, deducted: 0, fills: [], issues: 0 };
            g.loads++; g.bags += d.bagCount || 0; g.kg += d.netKg || 0; g.value += VH.payable(d); g.deducted += Number(d.deductionAmount) || 0;
            if (d.fillCheck && d.fillCheck.avgFillPct !== null && d.fillCheck.avgFillPct !== undefined) g.fills.push(d.fillCheck.avgFillPct);
          }
          return map;
        };
        const bySupplier = group((d) => d.supplierId, (k) => supplierName(k));
        for (const q of Store.all('qualityIssues')) if (inRange(q.reportedAt) && bySupplier[q.supplierId]) bySupplier[q.supplierId].issues++;
        const supplierRows = Object.values(bySupplier).sort((a, b) => b.bags - a.bags);
        const typeRows = Object.values(group((d) => d.biomassType, (k) => VH.typeLabel(k))).sort((a, b) => b.bags - a.bags);
        const bayRows = Store.where('bays', (b) => !b.deleted).map((b) => ({ code: b.code, bags: VH.bagsInBay(b.id), capacity: b.capacityBags || 0 }));

        /* in / out per day (or per week when the period is long) */
        const times = deliveries.map((d) => Date.parse(d.acceptedAt || d.deliveredAt)).concat(usages.map((u) => Date.parse(u.consumedAt))).filter(Number.isFinite);
        const dayMs = 864e5;
        const floor = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
        const first = Number.isFinite(start) ? floor(start) : (times.length ? floor(Math.min.apply(null, times)) : floor(Date.now()));
        const last = Number.isFinite(end) ? floor(Math.min(end, Date.now())) : floor(Date.now());
        const days = Math.max(1, Math.round((last - first) / dayMs) + 1);
        const step = days > 62 ? 7 : 1;
        const buckets = [];
        for (let t = first; t <= last; t += step * dayMs) buckets.push({ from: t, to: t + step * dayMs, inKg: 0, outKg: 0, inBags: 0, outBags: 0 });
        const put = (t, kgv, bagsv, key) => {
          const i = Math.floor((floor(t) - first) / (step * dayMs));
          if (buckets[i]) { buckets[i][`${key}Kg`] += Number(kgv) || 0; buckets[i][`${key}Bags`] += Number(bagsv) || 0; }
        };
        for (const d of deliveries) put(Date.parse(d.acceptedAt || d.deliveredAt), d.netKg, d.bagCount, 'in');
        for (const u of usages) put(Date.parse(u.consumedAt), u.totalKg, u.bags, 'out');

        return { deliveries, usages, payments, bagsIn, kgIn, bagsOut, kgOut, payable, deducted, gross, reduced, withDeduction,
          avgKgIn, avgKgOut, payRows, supplierRows, typeRows, bayRows, buckets, step, filtered };
      }

      /* ------------------------------- chart --------------------------- */
      /* Two series on one axis (kg). Identity is carried by position (in is
         always the left bar of a pair), the legend and the tooltip — not by
         colour alone — and the table beside it holds the same numbers. */
      function chart(r) {
        const b = r.buckets;
        const max = Math.max(1, ...b.map((x) => Math.max(x.inKg, x.outKg)));
        if (!b.some((x) => x.inKg || x.outKg)) return '<p class="muted">No movement in this period.</p>';
        const W = 720, H = 220, L = 44, R = 8, T = 10, B = 26;
        const slot = (W - L - R) / b.length;
        const bw = Math.max(1.5, Math.min(14, (slot - 4) / 2));
        const y = (v) => T + (H - T - B) * (1 - v / max);
        const nice = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} t` : `${Math.round(v)} kg`);
        const label = (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        const bar = (x, v, cls) => {
          if (!v) return '';
          const top = y(v), h = (H - B) - top, rr = Math.min(3, bw / 2, h);
          return `<path class="${cls}" d="M${x.toFixed(1)},${H - B} v${-(h - rr).toFixed(1)} q0,${-rr} ${rr},${-rr} h${(bw - 2 * rr).toFixed(1)} q${rr},0 ${rr},${rr} v${(h - rr).toFixed(1)} z"/>`;
        };
        const ticks = [0, 0.5, 1].map((f) => `<line class="rc-grid" x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="rc-axis" x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${nice(max * f)}</text>`).join('');
        const every = Math.max(1, Math.ceil(b.length / 8));
        const cols = b.map((x, i) => {
          const cx = L + slot * i + slot / 2;
          const tip = `${label(x.from)}${r.step > 1 ? ` – ${label(x.to - 864e5)}` : ''}: in ${nice(x.inKg)} (${x.inBags} bags), out ${nice(x.outKg)} (${x.outBags} bags)`;
          return `<g class="rc-col" tabindex="0" data-tip="${esc(tip)}">
            <rect class="rc-hit" x="${(L + slot * i).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}"/>
            ${bar(cx - bw - 1, x.inKg, 'rc-in')}${bar(cx + 1, x.outKg, 'rc-out')}
            ${i % every === 0 ? `<text class="rc-axis" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${label(x.from)}</text>` : ''}
          </g>`;
        }).join('');
        return `<div class="report-chart">
          <div class="rc-legend"><span><i class="rc-key rc-in"></i>In from suppliers</span><span><i class="rc-key rc-out"></i>Out to the gasifier</span><span class="muted small">${r.step > 1 ? 'per week' : 'per day'}, in kg</span></div>
          <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biomass in and out per ${r.step > 1 ? 'week' : 'day'}">${ticks}<line class="rc-base" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>${cols}</svg>
          <div class="rc-tip" id="rc-tip" role="status">Point at a bar to read its figures.</div>
        </div>`;
      }

      /* ------------------------------- draw ---------------------------- */
      function periodText() {
        if (!st.from && !st.to) return 'All time';
        const f = (v) => (v ? dOnly(`${v}T12:00:00`) : '…');
        return `${f(st.from)} to ${f(st.to)}`;
      }

      let last = null;
      function draw() {
        const r = last = compute();
        UI.$$('[data-preset]', view).forEach((b) => b.classList.toggle('active', b.dataset.preset === st.preset));
        const filterNote = [st.supplier ? supplierName(st.supplier) : '', st.type ? VH.typeLabel(st.type) : ''].filter(Boolean).join(', ');
        const loss = r.kgIn ? D.round2(((r.kgIn - r.kgOut) / r.kgIn) * 100) : null;

        view.querySelector('#report-body').innerHTML = `
          <p class="report-period">${Sync.state.live ? '<i class="live-dot" title="Updating live"></i>' : ''}<b>${esc(periodText())}</b>${filterNote ? `, ${esc(filterNote)}` : ''}<span class="muted">, ${r.deliveries.length} ${r.deliveries.length === 1 ? 'delivery' : 'deliveries'}</span></p>
          <section class="stats stats-4">
            ${UI.stat('Received', `${(r.kgIn / 1000).toFixed(2)} t`, `${r.bagsIn.toLocaleString()} bags${r.avgKgIn ? `, ${r.avgKgIn} kg each` : ''}`)}
            ${UI.stat('Fed to the gasifier', `${(r.kgOut / 1000).toFixed(2)} t`, `${r.bagsOut.toLocaleString()} bags${r.avgKgOut ? `, ${r.avgKgOut} kg each` : ''}`)}
            ${UI.stat('Payable to suppliers', money(r.payable), `${money(r.deducted)} deducted on ${r.withDeduction} load(s)`, 'ok')}
            ${UI.stat('Moisture on arrival', r.avgKgIn ? `${D.moistureFromWeight(r.avgKgIn, Store.settings())}%` : '—', r.avgKgIn ? `from ${r.avgKgIn} kg per bag` : 'no loads in this period')}
          </section>

          <section class="nm-card pad">
            <div class="card-head"><h3>In and out</h3><button class="link" id="csv-movement"><i class="i i-download"></i>CSV</button></div>
            <div class="report-split">
              ${chart(r)}
              <table class="mini">
                <thead><tr><th></th><th class="num">Bags</th><th class="num">Weight</th></tr></thead>
                <tr><th>In from suppliers</th><td class="num">${r.bagsIn.toLocaleString()}</td><td class="num">${kg(r.kgIn)}</td></tr>
                <tr><th>Out to the gasifier</th><td class="num">${r.bagsOut.toLocaleString()}</td><td class="num">${kg(r.kgOut)}</td></tr>
                <tr><th>Difference</th><td class="num">${(r.bagsIn - r.bagsOut).toLocaleString()}</td><td class="num">${kg(r.kgIn - r.kgOut)}</td></tr>
                <tr><th>Average bag in</th><td class="num">—</td><td class="num">${r.avgKgIn ? `${r.avgKgIn} kg` : '—'}</td></tr>
                <tr><th>Average bag out</th><td class="num">—</td><td class="num">${r.avgKgOut ? `${r.avgKgOut} kg` : '—'}</td></tr>
                ${r.avgKgIn && r.avgKgOut ? `<tr><th>Bag weight change in store</th><td class="num">—</td><td class="num">${D.round2(r.avgKgOut - r.avgKgIn)} kg</td></tr>` : ''}
              </table>
            </div>
            <p class="small muted">In is the weighbridge net at receiving. Out is the three-bag average applied to each issue. A lighter bag going out than coming in means the stock dried in the bay.</p>
          </section>

          <section class="cols-2">
            <div class="nm-card pad">
              <div class="card-head"><h3>Money</h3><button class="link" id="csv-payments"><i class="i i-download"></i>CSV</button></div>
              <table class="mini">
                <tr><th>Value at the agreed price</th><td class="num">${money(r.gross)}</td></tr>
                <tr><th>Loads paid at the reduced price</th><td class="num">${r.reduced}</td></tr>
                <tr><th>Deducted (wet or poor loads)</th><td class="num ${r.deducted ? 't-danger' : ''}">${r.deducted ? '− ' : ''}${money(r.deducted)}</td></tr>
                <tr><th>Payable to suppliers</th><th class="num">${money(r.payable)}</th></tr>
              </table>
              <h4>Payments by stage</h4>
              <table class="mini"><thead><tr><th>Stage</th><th class="num">Payments</th><th class="num">Value</th></tr></thead>
                <tbody>${r.payRows.map((p) => `<tr><td>${esc(D.PAYMENT_LABEL[p.status])}</td><td class="num">${p.count}</td><td class="num">${money(p.value)}</td></tr>`).join('')}</tbody></table>
            </div>
            <div class="nm-card pad">
              <div class="card-head"><h3>Stock by bay, now</h3><button class="link" id="csv-stock"><i class="i i-download"></i>CSV</button></div>
              <table class="mini"><thead><tr><th>Bay</th><th class="num">Bags</th><th class="num">Capacity</th><th class="num">Full</th></tr></thead>
                <tbody>${r.bayRows.map((b) => `<tr><td>${esc(b.code)}</td><td class="num">${b.bags.toLocaleString()}</td><td class="num">${b.capacity.toLocaleString()}</td><td class="num">${b.capacity ? Math.round((b.bags / b.capacity) * 100) : 0}%</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No bays yet.</td></tr>'}</tbody></table>
              <p class="small muted">Stock is what is in the bays at this moment. It does not change with the period above.</p>
              <h4>By biomass type</h4>
              <table class="mini"><thead><tr><th>Type</th><th class="num">Loads</th><th class="num">Bags</th><th class="num">Weight</th></tr></thead>
                <tbody>${r.typeRows.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.loads}</td><td class="num">${t.bags.toLocaleString()}</td><td class="num">${kg(Math.round(t.kg))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No loads in this period.</td></tr>'}</tbody></table>
            </div>
          </section>

          <section class="nm-card pad">
            <div class="card-head"><h3>Suppliers</h3><button class="link" id="csv-suppliers"><i class="i i-download"></i>CSV</button></div>
            ${UI.table({
              rows: r.supplierRows, empty: 'No accepted deliveries in this period.',
              columns: [
                { label: 'Supplier', render: (x) => esc(x.name) },
                { label: 'Loads', cls: 'num', render: (x) => x.loads },
                { label: 'Bags', cls: 'num', render: (x) => x.bags.toLocaleString() },
                { label: 'Net kg', cls: 'num', render: (x) => Math.round(x.kg).toLocaleString() },
                { label: 'Avg fill', cls: 'num', render: (x) => (x.fills.length ? `${D.round2(x.fills.reduce((a, b) => a + b, 0) / x.fills.length)}%` : '—') },
                { label: 'Moisture', render: (x) => VH.moistureBadge(x.bags ? D.moistureFromWeight(D.round2(x.kg / x.bags), Store.settings()) : null) },
                { label: 'Deducted', cls: 'num', render: (x) => (x.deducted ? `<span class="t-danger">${money(x.deducted)}</span>` : '—') },
                { label: 'Payable', cls: 'num', render: (x) => money(x.value) },
                { label: 'Quality issues', cls: 'num', render: (x) => `<span class="${x.issues ? 't-warn' : ''}">${x.issues}</span>` },
              ],
            })}
          </section>`;

        const body = view.querySelector('#report-body');
        const tip = body.querySelector('#rc-tip');
        if (tip) UI.$$('.rc-col', body).forEach((g) => {
          const show = () => { tip.textContent = g.dataset.tip; UI.$$('.rc-col.on', body).forEach((x) => x.classList.remove('on')); g.classList.add('on'); };
          g.addEventListener('mouseenter', show); g.addEventListener('focus', show); g.addEventListener('click', show);
        });

        const tag = `${st.from || 'start'}_${st.to || 'today'}`;
        body.querySelector('#csv-movement').addEventListener('click', () => UI.download(`deliveries-${tag}.csv`, UI.toCSV(r.deliveries.map((d) => ({
          receipt: d.receiptNo, date: dOnly(d.acceptedAt || d.deliveredAt), supplier: supplierName(d.supplierId), type: VH.typeLabel(d.biomassType),
          bags: d.bagCount, netKg: d.netKg, avgBagKg: d.avgBagKg || '', moisturePct: d.avgBagKg ? D.moistureFromWeight(d.avgBagKg, Store.settings()) : '',
          fillPct: d.fillCheck && d.fillCheck.avgFillPct !== null ? d.fillCheck.avgFillPct : '', unitPrice: d.fillCheck ? d.fillCheck.unitPrice : '',
          deductionPct: d.deductionPct || 0, deductionReason: d.deductionReason || '', payable: VH.payable(d),
        }))) || 'No deliveries in this period', 'text/csv'));
        body.querySelector('#csv-payments').addEventListener('click', () => UI.download(`payments-${tag}.csv`, UI.toCSV(r.payments.map((p) => ({
          payment: p.paymentNo, date: dOnly(p.createdAt), supplier: p.supplierName || supplierName(p.supplierId), bags: p.bags, unitPrice: p.unitPrice,
          gross: p.grossAmount, deductionPct: p.deductionPct || 0, deducted: p.deductions || 0, payable: p.netAmount, stage: D.PAYMENT_LABEL[p.status] || p.status,
        }))) || 'No payments in this period', 'text/csv'));
        body.querySelector('#csv-stock').addEventListener('click', () => UI.download(`stock-${D.todayISO()}.csv`, UI.toCSV(r.bayRows), 'text/csv'));
        body.querySelector('#csv-suppliers').addEventListener('click', () => UI.download(`suppliers-${tag}.csv`, UI.toCSV(r.supplierRows.map((x) => ({
          supplier: x.name, loads: x.loads, bags: x.bags, netKg: Math.round(x.kg), deducted: x.deducted, payable: x.value, qualityIssues: x.issues,
        }))) || 'No suppliers in this period', 'text/csv'));
      }

      /* ------------------------------ controls ------------------------- */
      const fromEl = view.querySelector('[name=rpFrom]'), toEl = view.querySelector('[name=rpTo]');
      UI.$$('[data-preset]', view).forEach((b) => b.addEventListener('click', () => {
        setPreset(b.dataset.preset); fromEl.value = st.from; toEl.value = st.to; draw();
      }));
      const onDates = () => {
        st.from = fromEl.value; st.to = toEl.value; st.preset = 'custom';
        if (st.from && st.to && st.from > st.to) { const t = st.from; st.from = st.to; st.to = t; fromEl.value = st.from; toEl.value = st.to; }
        draw();
      };
      fromEl.addEventListener('change', onDates); toEl.addEventListener('change', onDates);
      view.querySelector('[name=rpSupplier]').addEventListener('change', (e) => { st.supplier = e.target.value; draw(); });
      view.querySelector('[name=rpType]').addEventListener('change', (e) => { st.type = e.target.value; draw(); });
      view.querySelector('#print-report').addEventListener('click', () => {
        const filterNote = [st.supplier ? supplierName(st.supplier) : '', st.type ? VH.typeLabel(st.type) : ''].filter(Boolean).join(', ');
        UI.print(VH.printHeader('Biomass storage report', `${periodText()}${filterNote ? ` · ${filterNote}` : ''}`) + view.querySelector('#report-body').innerHTML, `Biomass report ${st.from || ''} ${st.to || ''}`.trim());
        VH.audit('report.print', 'report', 'summary', `Report printed for ${periodText()}`);
      });
      view.querySelector('#full-backup').addEventListener('click', () => {
        UI.download(`enerfab-biomass-backup-${D.todayISO()}.json`, JSON.stringify(App.exportData(), null, 2));
        UI.toast('Backup downloaded', 'ok');
      });
      draw();

      // Live: after every sync round the figures are worked out again, and the
      // page redraws only if something actually changed. The filters stay as set.
      const signature = (r) => [r.deliveries.length, r.usages.length, r.bagsIn, r.kgIn, r.bagsOut, r.kgOut, r.payable, r.deducted,
        r.payRows.map((p) => `${p.count}:${p.value}`).join(), r.bayRows.map((b) => b.bags).join()].join('|');
      let shown = signature(last);
      App._live = () => {
        if (!view.isConnected || document.querySelector('.modal-backdrop')) return;
        const a = document.activeElement;
        if (a && view.contains(a) && /^(INPUT|SELECT)$/.test(a.tagName)) return;
        if (st.preset !== 'custom' && st.preset !== 'all') { setPreset(st.preset); fromEl.value = st.from; toEl.value = st.to; }   // a new day has started
        const sig = signature(compute());
        if (sig === shown) return;
        shown = sig;
        const y = window.scrollY; draw(); window.scrollTo(0, y);
      };
    },
  });

  /* ============================ ADMINISTRATION ======================= */
  App.register('admin', {
    title: 'Administration',
    render(view) {
      const isSuper = Auth.isSuper(Auth.current());
      const sub = Store.subscription();
      const users = Auth.listUsers();
      const s = Store.settings();
      // Entries the owner made before this rule existed are never shown.
      const auditRows = () => Store.all('audit').filter((a) => a && !Auth.isOwnerEmail(a.by))
        .slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 300);

      // Each tab is gated by its own permission: a supervisor can read the
      // audit trail without being able to touch users or settings.
      const TAB_DEFS = [
        { id: 'users', label: 'Users &amp; roles', ok: Auth.can('user.manage') },
        { id: 'sub', label: 'Subscription', ok: isSuper },
        { id: 'settings', label: 'Business settings', ok: Auth.can('settings.write') },
        { id: 'audit', label: 'Audit trail', ok: Auth.can('audit.read') },
        { id: 'data', label: 'Data &amp; sync', ok: Auth.can('user.manage') },
      ];
      const allowed = TAB_DEFS.filter((t) => t.ok);
      if (!allowed.length) {
        view.innerHTML = UI.empty('Nothing here for your role', 'Ask an administrator if you need access to this section.');
        return;
      }
      view.innerHTML = `
        <div class="seg wide" id="admin-tabs">
          ${allowed.map((t, i) => `<button class="seg-btn ${i === 0 ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div id="admin-body"></div>`;

      const tabs = {
        users: () => {
          // Read the staff list fresh every time this tab is drawn. Reading it
          // once when the screen opened meant a person who signed in afterwards
          // never appeared until the administrator left the screen and came back.
          const users = Auth.listUsers();
          const pending = users.filter((u) => !Auth.isSuper(u) && Auth.roleOf(u) === 'pending');
          const sorted = users.slice().sort((a, b) => {
            const pa = Auth.roleOf(a) === 'pending' ? 0 : 1;
            const pb = Auth.roleOf(b) === 'pending' ? 0 : 1;
            return pa - pb || String(a.name || '').localeCompare(String(b.name || ''));
          });
          return `
          <section class="nm-card pad">
            <div class="card-head"><h3>Staff accounts</h3>
              <button class="nm-btn primary" id="add-user"><i class="i i-plus"></i>Add staff account</button></div>
            <p class="muted">People join themselves: they tap <b>Continue with Google</b> (or create an account) and appear below as
              <b>Awaiting approval</b>. You give them a role here and they are in, on every device.</p>
            ${pending.length ? `<div class="banner banner-warn" style="margin:0 0 12px">
              <span><b>${pending.length} account(s) waiting for a role:</b> ${pending.map((p) => esc(p.email)).join(', ')}</span></div>` : ''}
            ${UI.table({
              rows: sorted, rowKey: (u) => u.id,
              columns: [
                { label: 'Name', render: (u) => `<b>${esc(u.name || '')}</b><div class="muted small">${esc(u.email)}</div>` },
                { label: 'Role', render: (u) => {
                  if (Auth.isSuper(u) || u.role === 'super_admin') return badge('Super Admin · owner', 'ok');
                  const isPending = Auth.roleOf(u) === 'pending';
                  return `<select class="nm-input tiny-input ${isPending ? 'attention' : ''}" data-role="${u.id}">
                    ${isPending ? '<option value="" selected>Choose a role…</option>' : ''}
                    ${D.ASSIGNABLE_ROLES.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(D.ROLE_LABEL[r])}</option>`).join('')}
                  </select>`;
                } },
                { label: 'State', render: (u) => Auth.isSuper(u) ? badge('owner', 'ok')
                  : Auth.roleOf(u) === 'pending' ? badge('awaiting approval', 'warn')
                  : `<button class="switch ${u.active !== false ? 'on' : ''}" data-toggle="${u.id}" aria-pressed="${u.active !== false}" title="Enable / disable"></button>` },
                { label: 'Sign-in', render: (u) => `<span class="muted small">${esc(u.lastLoginAt ? dt(u.lastLoginAt) : (u.pendingSince ? 'just now' : 'never'))}</span>` },
                { label: '', cls: 'actions', render: (u) => `<button class="nm-btn tiny" data-reset="${esc(u.email)}">Reset password</button>` },
              ],
              empty: 'Nobody has joined yet. Ask staff to open the app and tap Continue with Google.',
            })}
          </section>
          <section class="nm-card pad">
            <div class="card-head"><h3>What each role can do</h3></div>
            <p class="muted">A person only sees the screens for their role. Pick the role that matches the job; you can change it at any time.</p>
            <div class="role-guide">
              ${D.ASSIGNABLE_ROLES.map((r) => `<div class="role-card">
                <b>${esc(D.ROLE_LABEL[r])}</b>
                <p>${esc(D.roleSummary(r))}</p>
                <small>Screens: ${esc(App.screensForRole(r).join(', '))}</small>
                ${Auth.can('settings.write') ? `<div class="row-actions"><button class="nm-btn tiny" data-edit-role="${r}">${D.EDITABLE_ROLES.includes(r) ? 'Edit name and jobs' : 'Rename'}</button></div>` : ''}
              </div>`).join('')}
            </div>
          </section>`;
        },

        sub: () => `
          <section class="nm-card pad ${sub.status === 'SUSPENDED' ? 'tone-danger-border' : ''}">
            <div class="card-head"><h3>Subscription control</h3>
              ${badge(sub.status, sub.status === 'ACTIVE' ? 'ok' : 'danger')}</div>
            <p class="muted">Only the owner account can use this switch. While the system is <b>Active</b> nobody sees any message about subscriptions — staff simply use the app. The paused screen appears only when you turn it on here.</p>
            <div class="notice">
              <b>How it behaves</b>
              <ul class="small">
                <li>It never switches itself on. There is no date-based expiry anywhere in the app.</li>
                <li>Turning it on blocks new entries on every device that syncs, and shows your message.</li>
                <li>No data is deleted or hidden from you — the moment you switch it back, everything carries on.</li>
                <li>You can still sign in and use the app while it is paused.</li>
              </ul>
            </div>
            ${UI.field('Message shown to the customer', UI.textarea('subMessage', { rows: 2, value: sub.message || 'This subscription has been paused by EnerFab management. Please contact your account manager to restore access.' }))}
            ${UI.field('Private note (not shown)', UI.input('subNote', { value: sub.note || '', placeholder: 'e.g. invoice 2026/114 unpaid since October' }))}
            <div class="row-actions">
              ${sub.status === 'ACTIVE'
                ? '<button class="nm-btn danger" data-act="suspend">Pause the service everywhere</button>'
                : '<button class="nm-btn primary" data-act="resume">Restore the service</button>'}
              <span class="muted small">${sub.updatedAt ? `Last changed ${esc(dt(sub.updatedAt))}${sub.updatedBy ? ` by ${esc(sub.updatedBy)}` : ''}` : 'Never changed — service is active by default.'}</span>
            </div>
            ${UI.field('Announcement banner (optional)', UI.input('announce', { value: (Store.data.config.remote || {}).announcement || '', placeholder: 'Shown as a banner to everyone, e.g. stock count on Friday' }))}
            <button class="nm-btn" data-act="announce">Save announcement</button>
          </section>
          <section class="nm-card pad">
            <div class="card-head"><h3>Demo mode</h3>
              ${badge((Store.data.config.remote || {}).demoMode ? 'Shown on sign-in screens' : 'Hidden', (Store.data.config.remote || {}).demoMode ? 'warn' : 'muted')}</div>
            <p class="muted">The demo opens the app with sample records, as an Administrator, without signing in. It is kept in its own space on each device: it cannot see real records and nothing done in it is uploaded. It is hidden unless you turn it on here.</p>
            <div class="row-actions">
              ${(Store.data.config.remote || {}).demoMode
                ? '<button class="nm-btn" data-act="demo-off">Hide the demo button everywhere</button>'
                : '<button class="nm-btn" data-act="demo-on">Show the demo button on sign-in screens</button>'}
              <button class="nm-btn primary" data-act="demo-open"><i class="i i-play"></i>Open the demo on this device</button>
            </div>
            <p class="muted small">"Open the demo" signs you out of the real system on this device first. A device picks up the show/hide choice the next time someone signs in on it.</p>
          </section>`,

        settings: () => `
          <section class="nm-card pad">
            <div class="card-head"><h3>Business settings</h3></div>
            <p class="muted">These numbers drive every price the app calculates. Change them only against a signed agreement with the suppliers.</p>
            <div class="grid-3">
              ${UI.field('Full unit price (Rs/bag)', UI.input('unitPrice', { type: 'number', min: 0, step: '0.01', value: s.unitPrice }))}
              ${UI.field('Reduced unit price (Rs/bag)', UI.input('reducedUnitPrice', { type: 'number', min: 0, step: '0.01', value: s.reducedUnitPrice }))}
              ${UI.field('Fill agreement (%)', UI.input('fillThresholdPct', { type: 'number', min: 50, max: 100, value: s.fillThresholdPct }))}
              ${UI.field('Sample size (% of bags)', UI.input('sampleSizePct', { type: 'number', min: 1, max: 100, value: s.sampleSizePct }))}
              ${UI.field('Minimum sample bags', UI.input('minSampleSize', { type: 'number', min: 1, max: 50, value: s.minSampleSize }))}
              ${UI.field('Bag serial prefix', UI.input('bagSerialPrefix', { value: s.bagSerialPrefix }))}
              ${UI.field('Maximum bags per delivery', UI.input('maxBagsPerDelivery', { type: 'number', min: 1, value: s.maxBagsPerDelivery }))}
              ${UI.field('Site name', UI.input('siteName', { value: s.siteName }))}
              ${UI.field('Site location', UI.input('siteLocation', { value: s.siteLocation }))}
              ${UI.field('Head Office email', UI.input('headOfficeEmail', { type: 'email', value: s.headOfficeEmail }))}
            </div>

            <h4>Biomass types</h4>
            <p class="muted">The kinds of biomass a supplier can deliver. They appear in the list on the Receive biomass screen.</p>
            <div class="type-list" id="type-list"></div>

            <h4>Moisture from bag weight</h4>
            <p class="muted">Moisture is read from the bag weight on a straight line through two weighed points. The site line is 18 kg = 20% and 36 kg = 60%, which is moisture % = (40 ÷ 18) × kg − 20.</p>
            <div class="grid-4">
              ${UI.field('Point A, bag weight (kg)', UI.input('moistureCalKg1', { type: 'number', min: 1, max: 200, step: '0.1', value: D.moistureCalibration(s).kg1 }))}
              ${UI.field('Point A, moisture (%)', UI.input('moistureCalPct1', { type: 'number', min: 0, max: 100, step: '0.1', value: D.moistureCalibration(s).pct1 }))}
              ${UI.field('Point B, bag weight (kg)', UI.input('moistureCalKg2', { type: 'number', min: 1, max: 200, step: '0.1', value: D.moistureCalibration(s).kg2 }))}
              ${UI.field('Point B, moisture (%)', UI.input('moistureCalPct2', { type: 'number', min: 0, max: 100, step: '0.1', value: D.moistureCalibration(s).pct2 }))}
            </div>
            <div class="grid-2">
              ${UI.field('Damp from (%)', UI.input('moistureWarnPct', { type: 'number', min: 1, max: 99, value: s.moistureWarnPct }), 'Shown in amber from this reading.')}
              ${UI.field('Wet from (%)', UI.input('moistureHighPct', { type: 'number', min: 1, max: 99, value: D.moistureHighPct(s) }), 'Shown in red. The load is still received; the supervisor decides the deduction.')}
            </div>
            <div class="grid-2">
              ${UI.field('Suggested deduction, damp load (%)', UI.input('deductDampPct', { type: 'number', min: 0, max: 100, step: '0.5', value: s.deductDampPct ?? 5 }), 'Filled in when the supervisor accepts a damp load. They can change it.')}
              ${UI.field('Suggested deduction, wet load (%)', UI.input('deductWetPct', { type: 'number', min: 0, max: 100, step: '0.5', value: s.deductWetPct ?? 10 }), 'Set both to 0 to turn suggestions off.')}
            </div>
            <div id="cal-preview"></div>
            <div class="row-actions"><button class="nm-btn primary" id="save-settings">Save settings</button></div>
          </section>`,

        audit: () => { const audit = auditRows(); return `
          <section class="nm-card pad">
            <div class="card-head"><h3>Audit trail</h3><span class="muted small" id="audit-count">${audit.length} most recent actions, from every device${Sync.state.live ? ', updating live' : ''}</span></div>
            <p class="muted">Every acceptance, deduction, payment step, bag movement and settings change by staff is recorded here with the person, the device and the time. Nothing in this list can be edited from the app.</p>
            ${UI.table({
              rows: audit,
              empty: 'Nothing has been recorded yet.',
              columns: [
                { label: 'When', render: (a) => `<span class="small">${esc(dt(a.at))}</span>` },
                { label: 'Who', render: (a) => `${esc(a.name || a.by)}<div class="muted small">${esc(a.name ? a.by : '')}${a.role ? ` · ${esc(D.ROLE_LABEL[a.role] || a.role)}` : ''}</div>` },
                { label: 'Action', render: (a) => `<span class="mono small">${esc(a.action)}</span>` },
                { label: 'Detail', render: (a) => `<span class="small">${esc(a.detail || '')}</span>` },
              ],
            })}
          </section>`; },

        data: () => `
          <section class="cols-2">
            <div class="nm-card pad">
              <div class="card-head"><h3>This device</h3></div>
              <table class="mini">
                <tr><th>Storage</th><td>${esc(Store.persistence)}${Store.persistence === 'memory' ? ' (changes will not survive a reload)' : ''}</td></tr>
                <tr><th>Database size</th><td>${(Store.stats().bytes / 1024).toFixed(0)} KB</td></tr>
                <tr><th>Bag serials</th><td>${Store.all('bags').length.toLocaleString()}</td></tr>
                <tr><th>Pending cloud writes</th><td>${(Store.data.outbox || []).length}</td></tr>
                <tr><th>Last sync</th><td>${Sync.state.lastSyncAt ? esc(dt(Sync.state.lastSyncAt)) : 'never'}</td></tr>
                <tr><th>Sync state</th><td>${esc(Sync.label())}</td></tr>
                <tr><th>Device id</th><td class="mono small">${esc(Store.stats().deviceId)}</td></tr>
              </table>
              ${Sync.state.lastError ? `<div class="banner banner-warn small">${esc(Sync.state.lastError)}</div>` : ''}
              <div class="row-actions">
                <button class="nm-btn" id="sync-now">Sync now</button>
                <button class="nm-btn" id="backup-now"><i class="i i-download"></i>Download backup</button>
              </div>
            </div>
            <div class="nm-card pad">
              <div class="card-head"><h3>Restore &amp; reset</h3></div>
              <p class="muted small">Import a backup file. Importing merges by newest change per record.</p>
              <input type="file" id="import-file" accept="application/json" class="nm-input" />
              <div class="row-actions">
                <button class="nm-btn" id="import-merge">Import (merge)</button>
              </div>
              <div class="divider"></div>
              <p class="small t-danger"><b>Danger zone.</b> These actions cannot be undone on this device.</p>
              <div class="row-actions">
                <button class="nm-btn danger" id="wipe-all">Reset this device</button>
              </div>
            </div>
          </section>`,
      };

      let current = null;
      const show = (tab, fromSync) => {
        current = tab;
        view.querySelector('#admin-body').innerHTML = tabs[tab]();
        wire(tab);
        // The log on screen is this device's copy; fetch what other devices recorded.
        if (tab === 'audit' && !fromSync) {
          Sync.pullAudit().then((res) => {
            if (current !== 'audit' || !view.isConnected) return;
            if (res && res.added) show('audit', true);
            else if (res && res.refused) {
              const c = view.querySelector('#audit-count');
              if (c) c.textContent = 'Showing this device only. Publish the latest firebase.rules.json to see every device.';
            }
          });
        }
      };

      const wire = (tab) => {
        const body = view.querySelector('#admin-body');

        if (tab === 'users') {
          const add = body.querySelector('#add-user');
          if (add) add.addEventListener('click', () => App.addUser());
          UI.$$('[data-edit-role]', body).forEach((b) => b.addEventListener('click', () => App.editRole(b.dataset.editRole, () => { App.render(); })));
          UI.$$('[data-role]', body).forEach((sel) => sel.addEventListener('change', () => {
            if (!sel.value) return;
            try {
              Auth.updateUser(sel.dataset.role, { role: sel.value });
              const who = Store.byId('users', sel.dataset.role) || {};
              VH.audit('user.role', 'user', who.email || sel.dataset.role, `${who.email || ''} is now ${D.ROLE_LABEL[sel.value] || sel.value}`);
              UI.toast(`${who.name || who.email || 'Account'} is now ${D.ROLE_LABEL[sel.value] || sel.value}`, 'ok');
              Sync.now('role-change');
              show('users');
            } catch (e) { UI.toast(e.message, 'danger'); }
          }));
          UI.$$('[data-toggle]', body).forEach((btn) => btn.addEventListener('click', () => {
            const u = Store.byId('users', btn.dataset.toggle);
            Auth.updateUser(u.id, { active: u.active === false });
            VH.audit('user.active', 'user', u.email, `${u.email} ${u.active === false ? 'switched off' : 'switched on'}`);
            Sync.now('user-active');
            UI.toast('Account updated', 'ok');
            show('users');
          }));
          UI.$$('[data-reset]', body).forEach((btn) => btn.addEventListener('click', async () => {
            try {
              await Auth.resetPassword(btn.dataset.reset);
              UI.toast('Password reset email sent', 'ok');
            } catch (e) { UI.toast(e.message || 'Could not send reset email', 'danger'); }
          }));
        }

        if (tab === 'sub' && !body._subWired) {
          // The tab body element is reused each time a tab is drawn, so this
          // listener is attached once and ignores clicks made on other tabs.
          body._subWired = true;
          body.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-act]');
            if (!btn || current !== 'sub' || !body.querySelector('[name=subMessage]')) return;
            const message = body.querySelector('[name=subMessage]').value.trim();
            const note = body.querySelector('[name=subNote]').value.trim();
            const ann = body.querySelector('[name=announce]').value.trim();

            if (btn.dataset.act === 'announce') {
              try { await Sync.pushRemote({ announcement: ann }); UI.toast('Announcement saved', 'ok'); }
              catch (err) { UI.toast(err.message, 'warn', 6000); }
              App.render();
              return;
            }
            if (btn.dataset.act === 'demo-on' || btn.dataset.act === 'demo-off') {
              const on = btn.dataset.act === 'demo-on';
              try { await Sync.pushRemote({ demoMode: on }); UI.toast(on ? 'The demo button is shown on sign-in screens' : 'The demo button is hidden', 'ok'); }
              catch (err) { UI.toast(err.message, 'warn', 6000); }
              show('sub');
              return;
            }
            if (btn.dataset.act === 'demo-open') {
              const ok = await UI.confirm({
                title: 'Open the demo?', tone: 'primary', confirmText: 'Open the demo',
                message: 'You will be signed out of the real system on this device and the demo will open with sample records. Sign out of the demo to come back.',
              });
              if (!ok) return;
              UI.whenSettled(() => {
                try {
                  Store.flush(); Sync.stop(); Auth.logout('demo');
                  Auth.previewSignIn(true);
                  UI.toast('Demo session. Sample data only', 'warn', 5000);
                  App.enter('dashboard');
                } catch (err) { UI.toast(err.message, 'danger'); App.render(); }
              });
              return;
            }

            const suspending = btn.dataset.act === 'suspend';
            const ok = await UI.confirm({
              title: suspending ? 'Pause the service for this customer?' : 'Restore the service?',
              message: suspending
                ? 'Staff on every device will see only the paused message. No data is deleted, and you keep full access.'
                : 'Everything returns to normal immediately. Nobody will see the paused screen again.',
              confirmText: suspending ? 'Pause everywhere' : 'Restore',
              tone: suspending ? 'danger' : 'primary',
              requireText: suspending ? 'PAUSE' : null,
            });
            if (!ok) return;
            try {
              await Sync.pushSubscription({
                status: suspending ? 'SUSPENDED' : 'ACTIVE',
                message: message || (suspending ? 'This subscription has been paused by EnerFab management.' : ''),
                note,
              });
              VH.audit('subscription.' + (suspending ? 'suspend' : 'resume'), 'config', 'subscription', note || message);
              UI.toast(suspending ? 'Service paused' : 'Service restored', 'ok');
            } catch (err) {
              // Still apply locally so the owner is not blocked offline.
              Store.data.config.subscription = Object.assign({}, Store.data.config.subscription, {
                status: suspending ? 'SUSPENDED' : 'ACTIVE', message, note,
                updatedAt: new Date().toISOString(), updatedBy: Auth.current().email,
              });
              Store.save('subscription-local');
              VH.audit('subscription.' + (suspending ? 'suspend' : 'resume') + '.local', 'config', 'subscription', note || message);
              UI.toast(err.message || 'Saved on this device only — it will reach other devices when online', 'warn', 6000);
            }
            App.render();
          });
        }

        if (tab === 'settings') {
          const NUM_FIELDS = ['unitPrice', 'reducedUnitPrice', 'fillThresholdPct', 'sampleSizePct', 'minSampleSize',
            'moistureCalKg1', 'moistureCalPct1', 'moistureCalKg2', 'moistureCalPct2',
            'moistureWarnPct', 'moistureHighPct', 'deductDampPct', 'deductWetPct', 'maxBagsPerDelivery'];
          const readNums = () => {
            const out = {};
            for (const k of NUM_FIELDS) out[k] = Number((body.querySelector(`[name=${k}]`) || {}).value);
            return out;
          };
          const preview = () => {
            const n = readNums();
            const c = D.moistureCalibration(n);
            body.querySelector('#cal-preview').innerHTML = `<div class="calc-strip">
              ${[15, 18, 22, 27, 36].map((w) => `<div><span class="muted small">${w} kg bag</span><b>${D.moistureFromWeight(w, n)}%</b></div>`).join('')}
              <div><span class="muted small">Formula</span><b>${D.round2(c.slope)} × kg ${c.offset < 0 ? '−' : '+'} ${D.round2(Math.abs(c.offset))}</b></div>
            </div>`;
          };
          UI.$$('[name^=moistureCal]', body).forEach((i) => i.addEventListener('input', preview));
          preview();

          const drawTypes = () => {
            const types = VH.biomassTypes();
            const inUse = (id) => Store.where('deliveries', (d) => d.biomassType === id).length;
            const box = body.querySelector('#type-list');
            box.innerHTML = types.map((t) => {
              const n = inUse(t.id);
              return `<span class="type-chip">${UI.icon('leaf')}<span><b>${esc(t.label)}</b><small>${n ? `${n} ${n === 1 ? 'delivery' : 'deliveries'}` : 'not used yet'}</small></span>
                ${types.length > 1 ? `<button type="button" class="type-x" data-rm-type="${esc(t.id)}" aria-label="Remove ${esc(t.label)}">${UI.icon('x')}</button>` : ''}</span>`;
            }).join('') + `<button type="button" class="type-chip type-add" id="type-add">${UI.icon('plus')}<span><b>Add a type</b></span></button>`;
            box.querySelector('#type-add').addEventListener('click', () => VH.addTypeDialog(drawTypes));
            UI.$$('[data-rm-type]', box).forEach((b) => b.addEventListener('click', async () => {
              const t = types.find((x) => x.id === b.dataset.rmType);
              const n = inUse(t.id);
              const ok = await UI.confirm({
                title: `Remove ${t.label}?`, confirmText: 'Remove',
                message: n ? `${n} past ${n === 1 ? 'delivery keeps' : 'deliveries keep'} this type on record. It just stops being offered for new trucks.`
                  : 'It will no longer be offered when a truck is received.',
              });
              if (!ok) return;
              const res = VH.removeBiomassType(t.id);
              if (res.error) UI.toast(res.error, 'warn'); else UI.toast(`${t.label} removed`, 'ok');
              drawTypes();
            }));
          };
          drawTypes();

          body.querySelector('#save-settings').addEventListener('click', () => {
            if (!Auth.can('settings.write')) return UI.toast('Only an administrator can change settings', 'danger');
            const f = UI.formData(body);
            const patch = readNums();
            if (NUM_FIELDS.some((k) => !Number.isFinite(patch[k]))) return UI.toast('Every number field needs a value', 'danger');
            if (patch.moistureCalKg1 === patch.moistureCalKg2) return UI.toast('The two moisture points need different bag weights', 'danger');
            if (patch.moistureWarnPct >= patch.moistureHighPct) return UI.toast('"Wet from" must be higher than "Damp from"', 'danger');
            if ([patch.deductDampPct, patch.deductWetPct].some((v) => v < 0 || v > 100)) return UI.toast('Suggested deductions must be between 0 and 100%', 'danger');
            if (patch.reducedUnitPrice > patch.unitPrice) return UI.toast('The reduced price cannot be above the full price', 'danger');
            patch.bagSerialPrefix = String(f.bagSerialPrefix || 'EFPL-BG').toUpperCase().replace(/[^A-Z0-9-]/g, '');
            patch.siteName = f.siteName; patch.siteLocation = f.siteLocation; patch.headOfficeEmail = f.headOfficeEmail;
            Store.patchSettings(patch);
            VH.audit('settings.update', 'settings', 'singleton', `unit price ${patch.unitPrice}/${patch.reducedUnitPrice}, fill ${patch.fillThresholdPct}%, moisture line ${patch.moistureCalKg1}kg=${patch.moistureCalPct1}% to ${patch.moistureCalKg2}kg=${patch.moistureCalPct2}%`);
            UI.toast('Settings saved', 'ok');
          });
        }

        if (tab === 'data') {
          body.querySelector('#sync-now').addEventListener('click', async () => {
            UI.toast('Syncing…');
            await Sync.now('manual');
            UI.toast(Sync.label(), Sync.state.phase === 'blocked' || Sync.state.phase === 'error' ? 'warn' : 'ok');
            show('data');
          });
          const backup = (id) => body.querySelector(id).addEventListener('click', () => {
            UI.download(`enerfab-biomass-backup-${D.todayISO()}.json`, JSON.stringify(App.exportData(), null, 2));
            UI.toast('Backup downloaded', 'ok');
          });
          backup('#backup-now');

          body.querySelector('#import-merge').addEventListener('click', () => {
            const file = body.querySelector('#import-file').files[0];
            if (!file) return UI.toast('Choose a backup file first', 'warn');
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const obj = JSON.parse(String(reader.result));
                Store.importJSON(obj, { merge: true });
                VH.audit('data.import', 'data', 'backup', `Imported ${file.name}`);
                UI.toast('Backup merged', 'ok');
                App.refresh();
                show('data');
              } catch (e) { UI.toast('That file is not a valid backup', 'danger'); }
            };
            reader.readAsText(file);
          });

          body.querySelector('#wipe-all').addEventListener('click', async () => {
            const ok = await UI.confirm({
              title: 'Reset this device?',
              message: 'Every record on this device is cleared. Staff accounts are kept. This cannot be undone — download a backup first if you are not sure.',
              confirmText: 'Reset device', requireText: 'RESET',
            });
            if (!ok) return;
            Store.resetAll({ keepUsers: true });
            UI.toast('This device has been reset', 'ok');
            App.refresh();
            show('data');
          });
        }
      };

      UI.$$('[data-tab]', view).forEach((b) => b.addEventListener('click', () => {
        UI.$$('[data-tab]', view).forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        show(b.dataset.tab);
      }));

      // Live: after every sync round, bring the open tab up to date — unless
      // someone is in the middle of typing or choosing something on it.
      let lastAuditCount = Store.all('audit').length;
      let lastUsersSig = '';
      const usersSig = () => Auth.listUsers().map((u) => `${u.id}:${u.role}:${u.active !== false}:${u.name}`).join('|');
      lastUsersSig = usersSig();
      App._live = () => {
        if (!view.isConnected || document.querySelector('.modal-backdrop')) return;
        const body = view.querySelector('#admin-body');
        const busy = body && body.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
        if (current === 'audit') {
          Sync.pullAudit().then(() => {
            if (current !== 'audit' || !view.isConnected) return;
            const n = Store.all('audit').length;
            if (n !== lastAuditCount) { lastAuditCount = n; const y = window.scrollY; show('audit', true); window.scrollTo(0, y); }
          });
        } else if (current === 'users' && !busy) {
          const sig = usersSig();
          if (sig !== lastUsersSig) { lastUsersSig = sig; show('users'); }
        } else if (current === 'data' && !busy) {
          show('data');
        }
      };
      show(allowed[0].id);
    },
  });

  /** Rename a role and choose its jobs. Saved with the shared settings. */
  App.editRole = function (role, onSaved) {
    if (!Auth.can('settings.write')) return UI.toast('Only an administrator can change roles', 'danger');
    const editable = D.EDITABLE_ROLES.includes(role);
    const mine = D.permissionsFor(role);
    const groups = {};
    for (const t of D.TASKS) (groups[t.group] = groups[t.group] || []).push(t);
    UI.modal({
      title: `Role: ${D.ROLE_LABEL[role]}`,
      size: 'lg',
      body: `<div class="form-errors" role="alert"></div>
        ${UI.field('Role name', UI.input('roleLabel', { value: D.ROLE_LABEL[role] }), `Shown everywhere instead of "${esc(D.DEFAULT_ROLE_LABEL[role])}".`)}
        ${editable ? `<h4>Jobs this role may do</h4>
          <p class="muted small">People with this role only see the screens for the jobs ticked here.</p>
          <div class="role-jobs">${Object.keys(groups).map((g) => `<fieldset><legend>${esc(g)}</legend>
            ${groups[g].map((t) => `<label class="check"><input type="checkbox" data-perm="${t.perm}" ${mine.includes(t.perm) ? 'checked' : ''} /><span>${esc(t.label)}</span></label>`).join('')}
          </fieldset>`).join('')}</div>`
          : `<p class="muted">${role === 'admin' ? 'An administrator always keeps every job, so the site can never be locked out of its own settings.' : 'This role always stays read-only.'} Only the name can be changed.</p>`}`,
      footer: `${editable ? '<button class="nm-btn" data-act="reset">Back to the original</button>' : ''}
        <button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save role</button>`,
      onMount(el, close) {
        const write = (def, note) => {
          const roles = Object.assign({}, Store.settings().roles || {});
          if (def) roles[role] = def; else delete roles[role];
          Store.patchSettings({ roles });
          VH.audit('settings.role', 'settings', role, note);
          Sync.now('role-edit');
          close();
          if (onSaved) onSaved();
        };
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const label = el.querySelector('[name=roleLabel]').value.trim().replace(/\s+/g, ' ').slice(0, 30);
          if (!label) { UI.showErrors(el, ['Give the role a name']); return; }
          const def = { label };
          if (editable) {
            def.perms = UI.$$('[data-perm]', el).filter((c) => c.checked).map((c) => c.dataset.perm);
            def.none = def.perms.length === 0;      // the cloud drops an empty list, so say it in words too
          }
          write(def, `${D.DEFAULT_ROLE_LABEL[role]} saved as "${label}"${editable ? ` with ${def.perms.length} job(s)` : ''}`);
          UI.toast('Role saved', 'ok');
        });
        const reset = el.querySelector('[data-act=reset]');
        if (reset) reset.addEventListener('click', () => { write(null, `${D.DEFAULT_ROLE_LABEL[role]} put back to the original`); UI.toast('Role put back to the original', 'ok'); });
      },
    });
  };

  App.addUser = function () {
    UI.modal({
      title: 'Add a staff account',
      body: `<p class="muted">Enter the email the person will sign in with and pick their role. When they first sign in with that email, this device passes the role on the next time it syncs, so keep it online.</p>
        <div class="form-errors" role="alert"></div>
        ${UI.field('Email they will sign in with', UI.input('email', { type: 'email', placeholder: 'name@gmail.com', required: true }))}
        ${UI.field('Full name', UI.input('name', { placeholder: 'Nimal Silva' }))}
        ${UI.field('Role', UI.select('role', D.ASSIGNABLE_ROLES.map((r) => ({ value: r, label: D.ROLE_LABEL[r] })), { value: 'storekeeper' }))}
        <div class="role-card" id="role-hint"></div>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Add account</button>',
      onMount(el, close) {
        const roleSel = el.querySelector('[name=role]');
        const hint = () => {
          const r = roleSel.value;
          el.querySelector('#role-hint').innerHTML = `<b>${esc(D.ROLE_LABEL[r])}</b><p>${esc(D.ROLE_INFO[r] || '')}</p><small>Screens: ${esc(App.screensForRole(r).join(', '))}</small>`;
        };
        roleSel.addEventListener('change', hint);
        hint();
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const f = UI.formData(el.querySelector('.modal-body'));
          try {
            const u = Auth.createUser({ email: f.email, name: f.name, role: f.role });
            VH.audit('user.create', 'user', u.email, `${u.email} added as ${D.ROLE_LABEL[u.role] || u.role}`);
            UI.toast('Account added. The person signs in with this email to start', 'ok', 6000);
            close(); App.refresh();
          } catch (e) { UI.toast(e.message, 'danger'); }
        });
      },
    });
  };
})();
