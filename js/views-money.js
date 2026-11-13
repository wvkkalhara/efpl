/* =====================================================================
   views-money.js — payments, suppliers, quality, returns,
   reports and administration (including the owner's kill switch).
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG, Store = window.Store, Auth = window.Auth,
    UI = window.UI, D = window.Domain, App = window.App, VH = window.VH, Sync = window.Sync;
  const { esc, money, kg, dt, dOnly, badge } = UI;

  const supplierName = (id) => (Store.byId('suppliers', id) || {}).name || '—';


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
          ${UI.stat('Not paid yet', money(sum(pipeline)), `${pipeline.length} payment(s)`, pipeline.length ? 'warn' : null)}
          ${UI.stat('Waiting for the supervisor', money(sum(bucket(['PENDING_SUPERVISOR']))), 'to approve', 'warn')}
          ${UI.stat('With Head Office', money(sum(bucket(['SENT_TO_HEAD_OFFICE']))), 'sent for payment')}
          ${UI.stat('Paid to date', money(sum(bucket(['PAID']))), `${bucket(['PAID']).length} paid`, 'ok')}
        </section>

        <div class="toolbar">
          <div class="seg">
            ${['All', 'Draft', 'Waiting for supervisor', 'Approved', 'With Head Office', 'Paid'].map((t, i) => {
              const map = ['ALL', 'DRAFT', 'PENDING_SUPERVISOR', 'APPROVED', 'SENT_TO_HEAD_OFFICE', 'PAID'];
              return `<button class="seg-btn ${i === 0 ? 'active' : ''}" data-pfilter="${map[i]}">${t}</button>`;
            }).join('')}
          </div>
        </div>
        <div id="payment-table"></div>
        <p class="muted small">A payment is made when a truck is accepted. The supervisor approves it, it goes to Head Office, then it is marked paid. Open one to see the bank details.</p>`;

      const draw = (filter) => {
        const list = filter === 'ALL' ? payments : payments.filter((p) => p.status === filter);
        view.querySelector('#payment-table').innerHTML = UI.table({
          rows: list, empty: 'No payments in this state.',
          rowKey: (p) => p.id,
          columns: [
            { label: 'Payment', render: (p) => `<b>${esc(p.paymentNo)}</b><div class="muted small">${esc(dOnly(p.createdAt))}</div>` },
            { label: 'Supplier', render: (p) => `${esc(p.supplierName || supplierName(p.supplierId))}<div class="muted small">${esc(p.supplierCode || '')}</div>` },
            { label: 'Bags', cls: 'num', render: (p) => (p.bags || 0).toLocaleString() },
            { label: 'Price per bag', cls: 'num', render: (p) => money(p.unitPrice) },
            { label: 'Taken off', cls: 'num', render: (p) => (p.deductions ? `<span class="t-danger">${p.deductionPct ? `${p.deductionPct}% · ` : ''}${money(p.deductions)}</span>` : '<span class="muted">—</span>') },
            { label: 'To pay', cls: 'num', render: (p) => `<b>${money(p.netAmount)}</b>` },
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
    const sup = Store.byId('suppliers', p.supplierId) || {};
    // "Draft" only exists on payments made before the farmer step was removed
    const canApprove = Auth.can('payment.approve') && ['PENDING_SUPERVISOR', 'DRAFT'].includes(p.status);
    const canRelease = Auth.can('payment.release') && p.status === 'APPROVED';
    const canPay = Auth.can('payment.pay') && p.status === 'SENT_TO_HEAD_OFFICE';

    // The deduction can be corrected by the supervisor until the payment is authorised.
    const canDeduct = Auth.can('payment.approve') && ['DRAFT', 'PENDING_SUPERVISOR'].includes(p.status);

    UI.modal({
      title: `Payment ${p.paymentNo}`,
      size: 'lg',
      body: `
        <div class="detail-grid">
          <div class="nm-inset pad-sm">
            <h4>Supplier</h4>
            <p><b>${esc(p.supplierName || supplierName(p.supplierId))}</b><br/><span class="muted">${esc(p.supplierCode || '')}</span></p>
            <h4>Truck</h4>
            <p>${d ? esc(d.receiptNo) : '—'}<br/><span class="muted">${d ? `${esc(d.bagCount)} bags · ${kg(d.netKg)} net` : ''}</span></p>
          </div>
          <div class="nm-inset pad-sm">
            <h4>How it is worked out</h4>
            <table class="mini">
              <tr><td>Bags</td><td class="num">${p.bags}</td></tr>
              <tr><td>Price per bag</td><td class="num">${money(p.unitPrice)}</td></tr>
              <tr><td>Value</td><td class="num">${money(p.grossAmount)}</td></tr>
              <tr><td>Taken off${p.deductionPct ? ` (${p.deductionPct}%)` : ''}</td><td class="num ${p.deductions ? 't-danger' : ''}">${p.deductions ? '− ' : ''}${money(p.deductions || 0)}</td></tr>
              <tr><th>To pay</th><th class="num">${money(p.netAmount)}</th></tr>
            </table>
            ${p.deductionReason ? `<p class="small muted">Reason: ${esc(p.deductionReason)}</p>` : ''}
          </div>
          <div class="nm-inset pad-sm">
            <h4>Pay to</h4>
            ${p.status === 'PAID' ? VH.bankHtml(sup) : VH.bankEditor(sup, { saveButton: true })}
            ${d && (d.allocations || []).length ? `<h4>Put in bays</h4><p>${d.allocations.map((a) => `${esc(a.bayCode)} (${a.bags})`).join(', ')}</p>` : ''}
          </div>
          <div class="nm-inset pad-sm">
            <h4>Status</h4>
            <p>${badge(D.PAYMENT_LABEL[p.status] || p.status, UI.statusTone(p.status))}</p>
            <h4>History</h4>
            <ul class="mini-timeline">
              ${(p.history || []).map((h) => `<li><b>${esc(D.paymentActionLabel(h.action))}</b><span class="muted small">${esc(dt(h.at))} · ${esc(h.by)}</span>${h.note ? `<div class="small">${esc(h.note)}</div>` : ''}</li>`).join('') || '<li class="muted">No history.</li>'}
            </ul>
          </div>
        </div>`,
      footer: `
        <button class="nm-btn" data-act="slip"><i class="i i-printer"></i>Payment slip</button>
        ${d && d.status === 'ACCEPTED' ? '<button class="nm-btn" data-act="invoice"><i class="i i-printer"></i>Invoice</button>' : ''}
        ${canDeduct ? '<button class="nm-btn" data-act="deduct">Change amount taken off</button>' : ''}
        ${canApprove ? '<button class="nm-btn primary" data-act="approve">Approve</button>' : ''}
        ${canRelease ? '<button class="nm-btn primary" data-act="release">Send to Head Office</button>' : ''}
        ${canPay ? '<button class="nm-btn primary" data-act="paid">Mark as paid</button>' : ''}`,
      onMount(el, close) {
        const readBank = VH.wireBankEditor(el);
        // Save typed bank details; false if they are not right yet.
        const saveBank = () => {
          const b = readBank();
          if (!b) return true;
          if (b.error) { UI.toast(b.error, 'warn'); return false; }
          VH.saveBank(p.supplierId, b, `on payment ${p.paymentNo}`);
          return true;
        };
        const sb = el.querySelector('[data-bank-save]');
        if (sb) sb.addEventListener('click', () => {
          if (!readBank()) return;
          if (!saveBank()) return;
          UI.toast('Bank details saved for this supplier', 'ok');
          close(); App.refresh(); App.openPayment(p.id);
        });
        el.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          if (!btn) return;
          const act = btn.dataset.act;
          if (act === 'slip') return App.printPaymentSlip(p.id);
          if (['approve', 'release', 'paid'].includes(act)) {
            if (!saveBank()) return;
            if (!VH.bankReady(Store.byId('suppliers', p.supplierId))) return UI.toast('Add the supplier\'s bank details first (bank and account number)', 'warn');
          }
          if (act === 'invoice') return App.printInvoice(p.deliveryId);
          if (act === 'deduct') { close(); return App.deductionFlow(p.id); }
          const now = new Date().toISOString();
          const who = Auth.current().email;
          const push = (action, note, patch) => {
            const history = (p.history || []).concat([{ at: now, by: who, action, note }]);
            Store.update('payments', p.id, Object.assign({ history }, patch), 'payment-' + act);
            VH.audit('payment.' + action.toLowerCase(), 'payment', p.id, `${p.paymentNo} · ${money(p.netAmount)}${note ? ' · ' + note : ''}`);
          };
          if (act === 'approve') {

            push('APPROVED', el.querySelector('[name=approveNote]') ? el.querySelector('[name=approveNote]').value : 'Verified', { status: 'APPROVED', approvedBy: who, approvedAt: now });
            UI.toast('Payment approved', 'ok');
          }
          if (act === 'release') {
            push('SENT_TO_HEAD_OFFICE', 'Sent to Head Office', { status: 'SENT_TO_HEAD_OFFICE', sentBy: who, sentAt: now });
            UI.toast('Sent to Head Office', 'ok');
          }
          if (act === 'paid') {
            push('PAID', 'Paid', { status: 'PAID', paidAt: now, paidBy: who });
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
      return UI.toast('The amount taken off can only be changed before the payment is approved', 'warn');
    }
    const d = Store.byId('deliveries', p.deliveryId);
    UI.modal({
      title: `Amount taken off ${p.paymentNo}`,
      body: `<div class="form-errors" role="alert"></div>
        <p class="muted">Take a percent off this payment, for example when the bags were not filled fully.</p>
        ${d && d.fillCheck && d.fillCheck.avgFillPct !== null && d.fillCheck.avgFillPct !== undefined ? `<div class="fill-note ${d.fillCheck.avgFillPct < 100 ? 'is-low' : ''}">Fill check: bags <b>${esc(d.fillCheck.avgFillPct)}%</b> full on average${d.fillCheck.cutPct ? `, so ${d.fillCheck.cutPct}% off` : ''}. Full price ${money(p.unitPrice)} a bag.</div>` : ''}
        <div class="grid-2" style="margin-top:12px">
          ${UI.field('Take off (%)', UI.input('deductionPct', { type: 'number', min: 0, max: 100, step: '0.5', value: p.deductionPct || 0 }))}
          ${UI.field('Why', UI.input('deductionReason', { value: p.deductionReason || Store.settings().defaultDeductionReason || 'Bags are not filled fully', placeholder: 'Bags are not filled fully' }))}
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
    const html = `${VH.printHeader('Payment authorisation', `${p.paymentNo} · ${D.PAYMENT_LABEL[p.status]}`)}
      <table>
        <tr><th>Supplier</th><td>${esc(f.code || '')} · ${esc(f.name || '')}</td><th>Delivery</th><td>${d ? esc(d.receiptNo) : '—'}</td></tr>
        <tr><th>Bags</th><td>${p.bags}</td><th>Unit price</th><td>${money(p.unitPrice)}</td></tr>
        <tr><th>Gross value</th><td>${money(p.grossAmount)}</td><th>Deducted${p.deductionPct ? ` (${p.deductionPct}%)` : ''}</th><td>${money(p.deductions || 0)}</td></tr>
        ${p.deductionReason ? `<tr><th>Reason for deduction</th><td colspan="3">${esc(p.deductionReason)}</td></tr>` : ''}
        <tr><th>To pay</th><td colspan="3"><b>${money(p.netAmount)}</b></td></tr>
      </table>
      <h2>Pay to</h2>
      <table>
        <tr><th>Account name</th><td>${esc(f.bankAccountName || f.name || '')}</td><th>Account number</th><td>${esc(f.bankAccount || '')}</td></tr>
        <tr><th>Bank</th><td>${esc(f.bankName || f.bank || '')}</td><th>Branch</th><td>${esc(f.bankBranch || '')}</td></tr>
      </table>
      <h2>Authorisation trail</h2>
      <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Note</th></tr></thead>
        <tbody>${(p.history || []).map((h) => `<tr><td>${esc(dt(h.at))}</td><td>${esc(h.by)}</td><td>${esc(D.paymentActionLabel(h.action))}</td><td>${esc(h.note || '')}</td></tr>`).join('')}</tbody></table>
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
          <div class="toolbar-left"><input class="nm-input search" id="sup-search" type="search" placeholder="Search name, code, phone, village or account" /></div>
          <div class="toolbar-right">${Auth.can('supplier.write') ? '<button class="nm-btn primary" id="add-sup"><i class="i i-plus"></i>Add supplier</button>' : ''}</div>
        </div>
        <div id="sup-table"></div>`;

      const draw = (q) => {
        let list = suppliers;
        if (q) {
          const s = q.toLowerCase();
          list = list.filter((x) => `${x.name} ${x.code} ${x.address || ''} ${x.phone || ''} ${x.nic || ''} ${x.bankAccount || ''} ${x.bank || ''}`.toLowerCase().includes(s));
        }
        view.querySelector('#sup-table').innerHTML = UI.table({
          rows: list, empty: 'No suppliers yet.', rowKey: (r) => r.id,
          columns: [
            { label: 'Code', render: (r) => `<b class="mono">${esc(r.code)}</b>` },
            { label: 'Supplier', render: (r) => `${esc(r.name)}<div class="muted small">${esc(r.address || '')}</div>` },
            { label: 'Contact', render: (r) => `${esc(r.phone || '—')}<div class="muted small">${esc(r.nic || '')}</div>` },
            { label: 'Bank', render: (r) => (VH.hasBank(r) ? `<span class="small">${esc(r.bankName || r.bank || '')}</span><div class="muted small mono">${esc(r.bankAccount || '')}</div>` : '<span class="t-warn small">not on file</span>') },
            { label: 'Bags, last 30 days', cls: 'num', render: (r) => Store.where('deliveries', (d) => d.supplierId === r.id && d.status === 'ACCEPTED' && Date.now() - Date.parse(d.acceptedAt || 0) < 30 * 864e5).reduce((a, d) => a + d.bagCount, 0).toLocaleString() },
            { label: 'Status', render: (r) => badge((r.status || 'ACTIVE') === 'ACTIVE' ? 'Active' : 'Not active', (r.status || 'ACTIVE') === 'ACTIVE' ? 'ok' : 'muted') },
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

  /** Add or edit a supplier. With onSaved, the caller is told instead of the screen being redrawn. */
  App.editSupplier = function (id, onSaved) {
    const s = id ? Store.byId('suppliers', id) : null;
    UI.modal({
      title: s ? `Edit ${s.name}` : 'Add a supplier',
      body: `<div class="form-errors" role="alert"></div>
        <div class="grid-2">
          ${UI.field('Name', UI.input('name', { value: s ? s.name : '', required: true }))}
          ${UI.field('NIC / registration', UI.input('nic', { value: s ? s.nic : '', placeholder: '781234567V' }))}
          ${UI.field('Phone', UI.input('phone', { value: s ? s.phone : '', placeholder: '077 123 4567' }))}
          ${UI.field('Address / village', UI.input('address', { value: s ? s.address : '' }))}
          ${UI.field('Status', UI.select('status', [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }], { value: s ? s.status : 'ACTIVE' }))}
        </div>
        <h4>Bank details for payment</h4>
        <div class="grid-2">
          ${UI.field('Bank', UI.input('bankName', { value: s ? (s.bankName || s.bank || '') : '', placeholder: 'Bank of Ceylon', list: 'bank-list' }))}
          ${UI.field('Branch', UI.input('bankBranch', { value: s ? (s.bankBranch || '') : '', placeholder: 'Balangoda' }))}
          ${UI.field('Account number', UI.input('bankAccount', { value: s ? (s.bankAccount || '') : '', placeholder: '0071234567' }))}
          ${UI.field('Account name', UI.input('bankAccountName', { value: s ? (s.bankAccountName || '') : '', placeholder: 'As printed on the passbook' }), 'Leave empty if it is the supplier name.')}
        </div>
        <datalist id="bank-list">${['Bank of Ceylon', 'People\'s Bank', 'Commercial Bank', 'Hatton National Bank', 'Sampath Bank', 'Seylan Bank', 'National Savings Bank', 'Nations Trust Bank', 'DFCC Bank', 'Regional Development Bank', 'Sanasa Development Bank'].map((b) => `<option value="${esc(b)}"></option>`).join('')}</datalist>`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save supplier</button>',
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const f = UI.formData(el.querySelector('.modal-body'));
          const errors = [];
          if (!f.name) errors.push('Enter the supplier name');
          const dupe = f.name && Store.where('suppliers', (x) => !x.deleted && (!s || x.id !== s.id) && x.name.trim().toLowerCase() === f.name.toLowerCase())[0];
          if (dupe) errors.push(`${dupe.code} is already called ${dupe.name}. Open that supplier instead, or change the name.`);
          if (f.bankAccount && !f.bankName) errors.push('Enter the bank for that account number');
          UI.showErrors(el, errors);
          if (errors.length) return;
          const payload = {
            name: f.name, nic: f.nic, phone: f.phone, address: f.address, status: f.status,
            bankName: f.bankName, bankBranch: f.bankBranch, bankAccount: f.bankAccount, bankAccountName: f.bankAccountName,
            bank: [f.bankName, f.bankAccount].filter(Boolean).join(' · '),
          };
          let rec = s;
          if (s) {
            Store.update('suppliers', s.id, payload, 'supplier-update');
            VH.audit('supplier.update', 'supplier', s.id, s.name);
          } else {
            rec = Store.add('suppliers', Object.assign({
              code: 'SUP-' + String(Store.nextSeq('supplier', 1)).padStart(4, '0'),
            }, payload), 'supplier-create');
            VH.audit('supplier.create', 'supplier', rec.id, `${rec.code} · ${rec.name}`);
          }
          UI.toast(`${rec.code} ${rec.name} saved`, 'ok');
          close();
          if (onSaved) onSaved(rec); else App.refresh();
        });
      },
    });
  };

  App.openSupplier = function (id) {
    const s = Store.byId('suppliers', id);
    if (!s) return;
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
            <h4>Score</h4>
            <p>Avg fill <b>${avgFill === null ? '—' : `${avgFill}%`}</b><br/>
               Quality issues <b>${issues.length}</b> (${issues.filter((i) => i.status === 'OPEN').length} open)</p>
          </div>
          <div class="nm-inset pad-sm">
            <h4>Bank details for payment</h4>
            ${VH.bankHtml(s)}
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
      <p class="meta">${esc([s.address, s.phone, s.nic ? `NIC ${s.nic}` : ''].filter(Boolean).join(' · '))}<br/>Pay to: ${esc(VH.bankText(s))}</p>
      <table><thead><tr><th>Receipt</th><th>Date</th><th>Bags</th><th>Net kg</th><th>Fill</th><th>Unit price</th><th>Deducted</th><th>Payable</th></tr></thead>
        <tbody>${deliveries.map((d) => `<tr><td>${esc(d.receiptNo)}</td><td>${esc(dOnly(d.deliveredAt))}</td><td>${d.bagCount}</td><td>${d.netKg}</td>
          <td>${d.fillCheck && d.fillCheck.avgFillPct !== null ? d.fillCheck.avgFillPct + '%' : '—'}</td><td>${money(D.fillPayPerBag(d.fillCheck))}</td>
          <td>${d.deductionPct ? `${d.deductionPct}%` : '—'}</td><td>${money(VH.payable(d))}</td></tr>`).join('')}</tbody></table>
      <h2>Payments</h2>
      <table><thead><tr><th>Payment</th><th>Status</th><th>Net</th><th>Date</th></tr></thead>
        <tbody>${payments.map((p) => `<tr><td>${esc(p.paymentNo)}</td><td>${esc(D.PAYMENT_LABEL[p.status])}</td><td>${money(p.netAmount)}</td><td>${esc(dOnly(p.createdAt))}</td></tr>`).join('')}</tbody></table>`;
    UI.print(html, `Statement ${s.code}`);
  };

  /* ============================ QUALITY ISSUES ======================= */
  const SEVERITY = { LOW: 'Small', MEDIUM: 'Medium', HIGH: 'Serious' };

  App.register('quality', {
    title: 'Quality issues',
    render(view) {
      const issues = Store.all('qualityIssues').slice().sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt));
      view.innerHTML = `
        <section class="nm-card pad">
          <div class="card-head"><h3>Problems traced to the supplier</h3>
            ${Auth.can('quality.report') ? '<button class="nm-btn primary" id="new-issue"><i class="i i-plus"></i>Report an issue</button>' : ''}</div>
          <p class="muted">When biomass causes trouble at the gasifier, the bag serial (or, for bags without one, the gasifier issue and the load it came from) leads to the supplier who delivered it, so the corrective action reaches the right person.</p>
        </section>
        ${UI.table({
          rows: issues, empty: 'No quality issues reported.', rowKey: (r) => r.id,
          columns: [
            { label: 'Issue', render: (r) => `<b>${esc(r.issueNo)}</b><div class="muted small">${esc(dOnly(r.reportedAt))}</div>` },
            { label: 'Bag or load', render: (r) => (r.bagSerial ? `<span class="mono">${esc(r.bagSerial)}</span>`
              : `<span>${esc((Store.byId('deliveries', r.deliveryId) || {}).receiptNo || '—')}</span>${r.usageId ? `<div class="muted small">${esc((Store.byId('usageRequests', r.usageId) || {}).requestNo || '')}</div>` : ''}`) },
            { label: 'Supplier', render: (r) => esc(r.supplierName || supplierName(r.supplierId)) },
            { label: 'Category', render: (r) => esc((r.category || '').replace(/_/g, ' ').toLowerCase()) },
            { label: 'How serious', render: (r) => badge(SEVERITY[r.severity] || r.severity, r.severity === 'HIGH' ? 'danger' : r.severity === 'MEDIUM' ? 'warn' : 'muted') },
            { label: 'Status', render: (r) => badge(r.status === 'OPEN' ? 'Open' : 'Closed', r.status === 'OPEN' ? 'warn' : 'ok') },
            { label: '', cls: 'actions', render: (r) => `<button class="nm-btn tiny" data-qi="${r.id}">Open</button>` },
          ],
        })}`;
      const nw = view.querySelector('#new-issue');
      if (nw) nw.addEventListener('click', () => App.raiseQuality(null));
      UI.$$('[data-qi]', view).forEach((b) => b.addEventListener('click', () => App.openQuality(b.dataset.qi)));
    },
  });

  /**
   * Report a problem with the biomass. Either from a bag serial (the bag
   * tells the supplier), or — for bags without serials — from a gasifier
   * issue: the load(s) its bags came from are offered, oldest first.
   */
  App.raiseQuality = function (serial, opts) {
    const o = opts || {};
    const serials = Store.where('bags', (b) => ['STORED', 'CONSUMED'].includes(b.status)).slice(-400).reverse();
    const usage = o.usageId ? Store.byId('usageRequests', o.usageId) : null;
    const loads = usage ? (usage.fromLoads || []).filter((l) => l && l.deliveryId) : [];
    UI.modal({
      title: 'Report a quality issue',
      size: 'md',
      body: `<p class="muted">${usage
        ? `From gasifier issue <b>${esc(usage.requestNo)}</b> (${esc(usage.bayCode || '')}). Choose the load the problem came from; a bag serial is only needed if the bags carry one.`
        : 'Enter the serial from the bag tag. The supplier is filled in automatically from the bag number.'}</p>
        <div class="form-errors" role="alert"></div>
        ${usage ? UI.field('Load', UI.select('loadId', loads.length
          ? loads.map((l) => ({ value: l.deliveryId, label: `${l.receiptNo} · ${(Store.byId('suppliers', l.supplierId) || {}).name || ''} · ${l.bags} bags` }))
          : [{ value: '', label: 'Not known' }])) : ''}
        ${UI.field(usage ? 'Bag serial (if the bag has one)' : 'Bag serial', UI.input('serial', { value: serial || '', placeholder: 'EFPL-BG-000302', list: 'serial-list' }))}
        ${!usage ? (() => {
          const recentUse = Store.where('usageRequests', (u) => !u.deleted && u.status === 'CONSUMED')
            .sort((a, b) => String(b.consumedAt || '').localeCompare(String(a.consumedAt || ''))).slice(0, 25);
          return recentUse.length ? UI.field('No serial on the bag? Choose the gasifier issue instead', UI.select('fromUsage', [{ value: '', label: 'Choose a gasifier issue…' }]
            .concat(recentUse.map((u) => ({ value: u.id, label: `${u.requestNo} · ${u.bayCode || ''} · ${u.bags} bags · ${dOnly(u.consumedAt)}` }))))) : '';
        })() : ''}
        <datalist id="serial-list">${serials.slice(0, 200).map((b) => `<option value="${esc(b.serial)}"></option>`).join('')}</datalist>
        <div id="qi-trace" class="calc-strip"></div>
        <div class="grid-2">
          ${UI.field('Category', UI.select('category', [
            { value: 'UNDERFILLED', label: 'Bags not full (capacity)' }, { value: 'FOREIGN_MATERIAL', label: 'Stones or other material' },
            { value: 'SPECIES', label: 'Wrong kind of biomass' },
            { value: 'DAMAGED_BAG', label: 'Damaged bag' }, { value: 'OTHER', label: 'Other' },
          ]))}
          ${UI.field('How serious', UI.select('severity', [
            { value: 'LOW', label: 'Small' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HIGH', label: 'Serious' },
          ], { value: 'MEDIUM' }))}
        </div>
        ${UI.field('What happened?', UI.textarea('description', { rows: 3, placeholder: 'Gasifier flame unstable, bag weight 30 kg at consumption…' }))}
        ${UI.field('What will be done about it', UI.textarea('correctiveAction', { rows: 2, placeholder: 'Supplier to dry before bagging; mix 1:2 with a drier bay.' }))}
        ${UI.field('How was the supplier told?', UI.input('notifiedVia', { placeholder: 'Phone call to the supplier' }))}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save</button>',
      onMount(el, close) {
        const input = el.querySelector('[name=serial]');
        const trace = () => {
          const v = input.value.trim();
          const box = el.querySelector('#qi-trace');
          if (!v) { box.innerHTML = usage ? '' : '<span class="muted">Enter a serial to see who supplied the bag.</span>'; return; }
          const r = D.traceBag(Store, v);
          if (!r) { box.innerHTML = '<span class="t-warn">Serial not found in the registry</span>'; return; }
          box.innerHTML = `<div><span class="muted small">Supplier</span><b>${esc(r.supplier ? r.supplier.name : '—')}</b></div>

            <div><span class="muted small">Bay</span><b>${esc(r.bag.bayCode || '—')}</b></div>
            <div><span class="muted small">Status</span><b>${esc(D.BAG_STATUS_LABEL[r.bag.status] || r.bag.status)}</b></div>`;
        };
        input.addEventListener('input', UI.debounce(trace, 220));
        trace();
        const fromUsage = el.querySelector('[name=fromUsage]');
        if (fromUsage) fromUsage.addEventListener('change', () => {
          if (!fromUsage.value) return;
          const id = fromUsage.value;
          close();
          setTimeout(() => App.raiseQuality(null, { usageId: id }), 260);
        });

        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const data = UI.formData(el.querySelector('.modal-body'));
          const r = data.serial ? D.traceBag(Store, data.serial) : null;
          if (data.serial && !r) return UI.toast('That bag serial is not in the registry', 'warn');
          if (!r && !usage) return UI.toast('Enter a valid bag serial', 'warn');
          if (!data.description) return UI.toast('Describe what happened', 'warn');
          // from the bag if it has a serial, otherwise from the load chosen
          const load = !r && data.loadId ? Store.byId('deliveries', data.loadId) : null;
          const supplierId = r ? (r.bag.supplierId || null) : (load ? load.supplierId : null);
          const supplier = supplierId ? Store.byId('suppliers', supplierId) : null;
          const rec = Store.add('qualityIssues', {
            issueNo: 'QI-' + String(Store.nextSeq('quality', 1)).padStart(4, '0'),
            bagSerial: r ? r.bag.serial : '', deliveryId: r ? (r.bag.deliveryId || null) : (load ? load.id : null),
            supplierId, supplierName: supplier ? supplier.name : null,
            category: data.category, severity: data.severity, description: data.description,
            correctiveAction: data.correctiveAction || '', status: 'OPEN',
            reportedBy: Auth.current().email, reportedAt: new Date().toISOString(),
            notifiedVia: data.notifiedVia || '', notifiedAt: data.notifiedVia ? new Date().toISOString() : null,
            usageId: usage ? usage.id : (r && r.usage ? r.usage.id : null),
          }, 'quality-create');
          VH.audit('quality.report', 'quality', rec.id, `${rec.issueNo} · ${rec.bagSerial || (load ? load.receiptNo : usage.requestNo)} · ${rec.severity}`);
          UI.toast(`Issue ${rec.issueNo} recorded and traced`, 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  App.openQuality = function (id) {
    const q = Store.byId('qualityIssues', id);
    if (!q) return;
    const r = q.bagSerial ? D.traceBag(Store, q.bagSerial) : null;
    const load = r && r.delivery ? r.delivery : (q.deliveryId ? Store.byId('deliveries', q.deliveryId) : null);
    const use = q.usageId ? Store.byId('usageRequests', q.usageId) : null;
    UI.modal({
      title: `${q.issueNo} · ${q.bagSerial || (load ? load.receiptNo : (use ? use.requestNo : ''))}`,
      size: 'md',
      body: `<p>${badge(SEVERITY[q.severity] || q.severity, q.severity === 'HIGH' ? 'danger' : q.severity === 'MEDIUM' ? 'warn' : 'muted')} ${badge(q.status === 'OPEN' ? 'Open' : 'Closed', q.status === 'OPEN' ? 'warn' : 'ok')}</p>
        <div class="detail-grid">
          <div class="nm-inset pad-sm"><h4>Traced to</h4>
            <p>Supplier: <b>${esc(q.supplierName || '—')}</b><br/>
            Bay: <b>${esc(r && r.bag.bayCode ? r.bag.bayCode : (use ? use.bayCode : '—'))}</b><br/>
            Receipt: <b>${esc(load ? load.receiptNo : '—')}</b>${use ? `<br/>Gasifier issue: <b>${esc(use.requestNo)}</b>` : ''}</p></div>
          <div class="nm-inset pad-sm"><h4>Reported</h4>
            <p>${esc(dt(q.reportedAt))}<br/><span class="muted">by ${esc(q.reportedBy)}</span><br/>
            Notified: ${esc(q.notifiedVia || 'not yet')}${q.notifiedAt ? `<br/><span class="muted">${esc(dt(q.notifiedAt))}</span>` : ''}</p></div>
        </div>
        <h4>Description</h4><p>${esc(q.description)}</p>
        <h4>What will be done about it</h4><p>${esc(q.correctiveAction || '—')}</p>
        ${q.status === 'RESOLVED' ? `<p class="small t-ok">Resolved ${esc(dt(q.resolvedAt))} by ${esc(q.resolvedBy || '')}</p>` : ''}`,
      footer: q.status === 'OPEN' && Auth.can('quality.resolve')
        ? '<button class="nm-btn" data-act="notify">Supplier has been told</button><button class="nm-btn primary" data-act="resolve">Close the problem</button>' : '',
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          if (b.dataset.act === 'notify') {
            Store.update('qualityIssues', q.id, { notifiedAt: new Date().toISOString(), notifiedVia: 'Supplier informed by the supervisor' }, 'quality-notify');
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

  /* ============================= BAG STORE ==========================
     The empty bags, by count. Two shelves: NEW (bought in) and USED
     (emptied at the gasifier and still good). Rounds go out to suppliers
     from the used shelf first, topped up with new; torn bags are thrown
     away; a stock-take corrects the shelves to what is really there.
     (The route keeps its old id, "returns", so links keep working.)
     ==================================================================== */
  App.register('returns', {
    title: 'Bag store',
    render(view) {
      const st = VH.bagStore();
      const sups = VH.supplierBags().filter((x) => x.given || x.back);
      const canStore = Auth.can('returns.write');
      const canIssue = Auth.can('bag.issue');
      const KIND = { PURCHASE: ['New bags in', 'ok'], DISCARD: ['Thrown away', 'danger'], COUNT: ['Counted', 'info'], ISSUE: ['To supplier', 'warn'], GASIFIER: ['Back from the gasifier', 'ok'], OLD: ['Earlier record', 'muted'] };
      const signed = (v) => (v > 0 ? `+${v.toLocaleString()}` : v < 0 ? `−${Math.abs(v).toLocaleString()}` : '');

      view.innerHTML = `
        ${!st.started ? `<div class="banner banner-info"><span><b>Start the bag store:</b> count the empty bags on the shelves now (new and used) with <b>Count the store</b>. From then on the app keeps the figures up to date by itself.</span></div>` : ''}
        ${st.started && st.low ? `<div class="banner banner-warn"><span><b>Order new bags:</b> only ${Math.max(0, st.new).toLocaleString()} new bags left (the warning level is ${st.reorderLevel.toLocaleString()}). Torn bags are replaced from this shelf.</span></div>` : ''}
        <section class="stats stats-4">
          ${UI.stat('Used bags in the store', Math.max(0, st.used).toLocaleString(), 'given out first', st.used < 0 ? 'danger' : null)}
          ${UI.stat('New bags in the store', Math.max(0, st.new).toLocaleString(), `warning at ${st.reorderLevel.toLocaleString()}`, st.low ? 'danger' : null)}
          ${UI.stat('With suppliers', st.withSuppliers.toLocaleString(), 'given out, not back yet')}
          ${UI.stat('Thrown away, 30 days', st.discarded30.toLocaleString(), `${st.discarded.toLocaleString()} in all`, st.discarded30 ? 'warn' : null)}
        </section>
        <p class="muted small bag-where">Where every bag is: <b>${Math.max(0, st.used).toLocaleString()}</b> used and <b>${Math.max(0, st.new).toLocaleString()}</b> new in the store, <b>${st.withSuppliers.toLocaleString()}</b> with suppliers, <b>${st.inBays.toLocaleString()}</b> full in the bays.</p>
        ${st.used < 0 || st.new < 0 ? '<div class="banner banner-warn"><span>A shelf shows fewer than zero bags: more went out than the app knew were there. Count the store to put it right.</span></div>' : ''}
        <div class="toolbar">
          <div class="toolbar-left"></div>
          <div class="toolbar-right">
            ${canStore ? '<button class="nm-btn" id="bs-count">Count the store</button>' : ''}
            ${canStore ? '<button class="nm-btn" id="bs-torn">Record torn bags</button>' : ''}
            ${canStore ? '<button class="nm-btn" id="bs-new"><i class="i i-plus"></i>Receive new bags</button>' : ''}
            ${canIssue ? '<button class="nm-btn primary" id="bs-issue">Issue bags to a supplier</button>' : ''}
          </div>
        </div>

        <section class="nm-card pad">
          <div class="card-head"><h3>Bags with suppliers</h3></div>
          ${UI.table({
            rows: sups, empty: 'No bags given to suppliers yet.',
            columns: [
              { label: 'Supplier', render: (r) => `<b>${esc(r.supplier.name || '—')}</b><div class="muted small">${esc(r.supplier.code || '')}</div>` },
              { label: 'Given', cls: 'num', render: (r) => r.given.toLocaleString() },
              { label: 'Brought back full', cls: 'num', render: (r) => r.back.toLocaleString() },
              { label: 'Holding now', cls: 'num', render: (r) => (r.holding >= 0 ? `<b>${r.holding.toLocaleString()}</b>` : `0<div class="muted small">used ${Math.abs(r.holding).toLocaleString()} of their own</div>`) },
              { label: 'Last round', render: (r) => `<span class="muted small">${esc(r.last ? dOnly(r.last) : '—')}</span>` },
              { label: '', cls: 'actions', render: (r) => (canIssue ? `<button class="nm-btn tiny" data-issue-to="${esc(r.supplierId)}">Issue</button>` : '') },
            ],
          })}
        </section>

        <section class="nm-card pad">
          <div class="card-head"><h3>Movements</h3></div>
          ${UI.table({
            rows: st.moves.slice(0, 150), empty: 'Nothing has moved yet.',
            columns: [
              { label: 'When', render: (m) => `${esc(dOnly(m.at))}<div class="muted small">${esc(String(dt(m.at)).split(', ').pop() || '')}</div>` },
              { label: 'What', render: (m) => `${badge(KIND[m.kind][0], KIND[m.kind][1])}<div class="small">${esc(m.what)}</div>` },
              { label: 'Used', cls: 'num', render: (m) => `<span class="${m.usedD < 0 ? 't-danger' : m.usedD > 0 ? 't-ok' : ''}">${signed(m.usedD)}</span>` },
              { label: 'New', cls: 'num', render: (m) => `<span class="${m.newD < 0 ? 't-danger' : m.newD > 0 ? 't-ok' : ''}">${signed(m.newD)}</span>` },
              { label: 'Reference', render: (m) => `<b>${esc(m.ref || '')}</b><div class="muted small">${esc(m.note || '')}</div>` },
              { label: 'Who', render: (m) => `<span class="small">${esc(m.by || '')}</span>` },
            ],
          })}
          <p class="small muted">Empty bags come back from the gasifier: the good ones go on the used shelf and the torn ones are thrown away. Rounds go out from the used shelf first, then new bags.</p>
        </section>`;

      const on = (id, fn) => { const b = view.querySelector(id); if (b) b.addEventListener('click', fn); };
      on('#bs-new', () => App.receiveNewBags());
      on('#bs-torn', () => App.discardBags());
      on('#bs-count', () => App.countBagStore());
      on('#bs-issue', () => App.issueBags());
      UI.$$('[data-issue-to]', view).forEach((b) => b.addEventListener('click', () => App.issueBags(b.dataset.issueTo)));
    },
  });

  const storeRecordNo = () => 'BS-' + String(Store.nextSeq('bagReturn', 1)).padStart(4, '0');

  /** New bags bought in: they go on the new shelf. */
  App.receiveNewBags = function () {
    if (!Auth.can('returns.write')) return UI.toast('Your role cannot change the bag store', 'danger');
    UI.modal({
      title: 'Receive new bags',
      size: 'sm',
      body: `<div class="form-errors" role="alert"></div>
        ${UI.field('How many new bags?', UI.input('newQty', { type: 'number', min: 1, value: 1000 }))}
        ${UI.field('From (bag seller)', UI.input('vendor', { placeholder: 'Bag seller or invoice number' }))}
        ${UI.field('Note', UI.input('note', { placeholder: 'Optional' }))}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Add to the store</button>',
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const f = UI.formData(el.querySelector('.modal-body'));
          const q = Math.round(Number(f.newQty) || 0);
          if (q < 1) return UI.showErrors(el, ['Enter how many new bags came in']);
          const rec = Store.add('bagReturns', {
            kind: 'PURCHASE', returnNo: storeRecordNo(), newQty: q, vendor: f.vendor || '', note: f.note || '',
            at: new Date().toISOString(), returnedAt: new Date().toISOString(), recordedBy: Auth.current().email,
          }, 'bags-purchase');
          VH.audit('bags.purchase', 'bagReturn', rec.id, `${q} new bags received${f.vendor ? ` from ${f.vendor}` : ''}`);
          UI.toast(`${q.toLocaleString()} new bags added to the store`, 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  /** Torn bags found in the store (not at the gasifier): thrown away. */
  App.discardBags = function () {
    if (!Auth.can('returns.write')) return UI.toast('Your role cannot change the bag store', 'danger');
    const st = VH.bagStore();
    UI.modal({
      title: 'Record torn bags',
      size: 'sm',
      body: `<div class="form-errors" role="alert"></div>
        <p class="muted small">For bags found torn or spoiled in the store. (Bags torn at the gasifier are recorded there.) They are thrown away; new bags make up the numbers when rounds go out.</p>
        ${UI.field('From which shelf?', UI.select('shelf', [
          { value: 'USED', label: `Used bags (${Math.max(0, st.used)} in the store)` },
          { value: 'NEW', label: `New bags (${Math.max(0, st.new)} in the store)` },
        ]))}
        ${UI.field('How many?', UI.input('qty', { type: 'number', min: 1, value: 1 }))}
        ${UI.field('Why?', UI.select('reason', ['Torn', 'Rotten or mouldy', 'Burnt', 'Rats', 'Lost', 'Other'].map((x) => ({ value: x, label: x }))))}
        ${UI.field('Note', UI.input('note', { placeholder: 'Optional' }))}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn danger" data-act="save">Throw away</button>',
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const f = UI.formData(el.querySelector('.modal-body'));
          const q = Math.round(Number(f.qty) || 0);
          const have = Math.max(0, f.shelf === 'NEW' ? st.new : st.used);
          const errors = [];
          if (q < 1) errors.push('Enter how many bags');
          if (q > have) errors.push(`Only ${have} ${f.shelf === 'NEW' ? 'new' : 'used'} bags are in the store. If that is wrong, count the store first.`);
          UI.showErrors(el, errors);
          if (errors.length) return;
          const rec = Store.add('bagReturns', {
            kind: 'DISCARD', returnNo: storeRecordNo(), shelf: f.shelf, qty: q, reason: [f.reason, f.note].filter(Boolean).join(': '),
            at: new Date().toISOString(), returnedAt: new Date().toISOString(), recordedBy: Auth.current().email,
          }, 'bags-discard');
          VH.audit('bags.discard', 'bagReturn', rec.id, `${q} ${f.shelf === 'NEW' ? 'new' : 'used'} bags thrown away (${f.reason})`);
          UI.toast(`${q} bags thrown away`, 'ok');
          close(); App.refresh();
        });
      },
    });
  };

  /** Stock-take: type what is really on the shelves; the app corrects itself. */
  App.countBagStore = function () {
    if (!Auth.can('returns.write')) return UI.toast('Your role cannot change the bag store', 'danger');
    const st = VH.bagStore();
    UI.modal({
      title: 'Count the store',
      size: 'sm',
      body: `<div class="form-errors" role="alert"></div>
        <p class="muted small">Count the empty bags on the shelves and type the numbers. The app's figures are set to them, and the difference is kept in the movements.</p>
        <div class="grid-2">
          ${UI.field('Used bags counted', UI.input('usedCounted', { type: 'number', min: 0, value: Math.max(0, st.used) }), `App says ${st.used.toLocaleString()}`)}
          ${UI.field('New bags counted', UI.input('newCounted', { type: 'number', min: 0, value: Math.max(0, st.new) }), `App says ${st.new.toLocaleString()}`)}
        </div>
        ${UI.field('Note', UI.input('note', { placeholder: 'Monthly count, counted by…' }))}`,
      footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="save">Save the count</button>',
      onMount(el, close) {
        el.querySelector('[data-act=save]').addEventListener('click', () => {
          const f = UI.formData(el.querySelector('.modal-body'));
          const u = Math.round(Number(f.usedCounted)), nw = Math.round(Number(f.newCounted));
          if (!Number.isFinite(u) || !Number.isFinite(nw) || u < 0 || nw < 0) return UI.showErrors(el, ['Enter both counts (0 or more)']);
          const now = VH.bagStore();   // figures at this moment, in case something moved meanwhile
          const rec = Store.add('bagReturns', {
            kind: 'COUNT', returnNo: storeRecordNo(), usedCounted: u, newCounted: nw,
            usedDelta: u - now.used, newDelta: nw - now.new, note: f.note || '',
            at: new Date().toISOString(), returnedAt: new Date().toISOString(), recordedBy: Auth.current().email,
          }, 'bags-count');
          VH.audit('bags.count', 'bagReturn', rec.id, `Store counted: ${u} used (${signedText(u - now.used)}), ${nw} new (${signedText(nw - now.new)})`);
          UI.toast('Count saved. The store figures now match the shelves.', 'ok');
          close(); App.refresh();
        });
      },
    });
  };
  const signedText = (v) => (v > 0 ? `+${v}` : `${v}`);

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
        const reduced = deliveries.filter((d) => d.fillCheck && (d.fillCheck.decision === 'REDUCED_PRICE' || d.fillCheck.decision === 'SHORT')).length;
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

        /* ---- how the weight goes off: from real weighings only ---- */
        const s = Store.settings();
        const allBays = Store.where('bays', (b) => !b.deleted).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
        const periodDays = Math.max(1, Math.round(((Number.isFinite(end) ? Math.min(end, Date.now()) : Date.now()) - (Number.isFinite(start) ? start : first)) / dayMs));
        const dryRows = [];
        const AGE = [[0, 7, '0–7 days'], [8, 14, '8–14 days'], [15, 30, '15–30 days'], [31, 60, '31–60 days'], [61, 1e9, 'Over 60 days']];
        const ageRows = AGE.map(([lo, hi, label]) => ({ label, lo, hi, n: 0, kg: 0 }));
        const checkRows = [];
        for (const b of allBays) {
          const all = VH.bayReadings(b.id);
          // a reading's age: days since the last load came into that bay before it
          let lastIn = null;
          for (const p of all) {
            if (p.kind === 'in') { lastIn = p.at; continue; }
            if (!lastIn || !inRange(p.at)) continue;
            const age = Math.floor((Date.parse(p.at) - Date.parse(lastIn)) / dayMs);
            const g = ageRows.find((x) => age >= x.lo && age <= x.hi);
            if (g) { g.n++; g.kg += p.kg; }
          }
          const pts = all.filter((p) => inRange(p.at));
          if (pts.length >= 2) {
            const a = pts[0], z = pts[pts.length - 1];
            const span = Math.max(1, (Date.parse(z.at) - Date.parse(a.at)) / dayMs);
            dryRows.push({ code: b.code, name: b.name, n: pts.length, fromKg: a.kg, toKg: z.kg, fromM: a.moisture, toM: z.moisture,
              days: Math.round(span), perDay: D.round2((a.kg - z.kg) / span), nowM: (VH.bayNow(b) || {}).moisture });
          }
          if (VH.bagsInBay(b.id) > 0 || VH.bayChecks(b.id).some((c) => inRange(c.at))) {
            const checks = VH.bayChecks(b.id).filter((c) => inRange(c.at));
            const daysChecked = new Set(checks.map((c) => new Date(c.at).toDateString())).size;
            const lastC = VH.bayChecks(b.id).slice(-1)[0];
            // count only the days the bay had stock: from the first load in (or the period start)
            const firstIn = all.find((p) => p.kind === 'in');
            const from = Math.max(Number.isFinite(start) ? start : -Infinity, firstIn ? Date.parse(firstIn.at) : -Infinity);
            const to = Number.isFinite(end) ? Math.min(end, Date.now()) : Date.now();
            const daysOpen = Number.isFinite(from) ? Math.max(1, Math.ceil((to - from) / dayMs)) : periodDays;
            checkRows.push({ code: b.code, checks: checks.length, daysChecked, daysOpen, pct: Math.min(100, Math.round((daysChecked / daysOpen) * 100)), last: lastC ? lastC.at : null, lastKg: lastC ? lastC.kg : null });
          }
        }
        for (const g of ageRows) g.avg = g.n ? D.round2(g.kg / g.n) : null;

        // gasifier weighing, by biomass type (one bag weighed × number of bags)
        const gasType = {};
        for (const u of usages) {
          const tw = (u.typeWeights || []).length ? u.typeWeights : [{ type: '—', label: 'Not split by type', bags: u.bags, kg: u.avgBagKg }];
          for (const x of tw) {
            const k = x.type || x.label;
            const g = gasType[k] = gasType[k] || { label: x.label || VH.typeLabel(k), batches: 0, bags: 0, kg: 0 };
            g.batches++; g.bags += Number(x.bags) || 0; g.kg += Number(x.totalKg) || (Number(x.bags) || 0) * (Number(x.kg) || 0);
          }
        }
        const gasTypeRows = Object.values(gasType).map((g) => Object.assign(g, { avg: g.bags ? D.round2(g.kg / g.bags) : null })).sort((a, b) => b.kg - a.kg);

        // fill % and what it did to the pay
        const FILL = [[100, 1e9, '100% or more (full pay)'], [90, 99.99, '90–99%'], [80, 89.99, '80–89%'], [0, 79.99, 'Under 80%']];
        const fillRows = FILL.map(([lo, hi, label]) => ({ label, lo, hi, loads: 0, bags: 0, gross: 0, paid: 0 }));
        let noFill = 0;
        for (const d of deliveries) {
          const f = d.fillCheck && d.fillCheck.avgFillPct;
          if (f === null || f === undefined) { noFill++; continue; }
          const g = fillRows.find((x) => f >= x.lo && f <= x.hi);
          if (!g) continue;
          const full = Number(d.fillCheck.fullPrice || d.fillCheck.unitPrice) || 0;
          g.loads++; g.bags += d.bagCount || 0; g.gross += (d.bagCount || 0) * full; g.paid += VH.payable(d);
        }

        // month by month
        const months = {};
        for (const d of deliveries) {
          const m = String(d.acceptedAt || d.deliveredAt).slice(0, 7);
          const g = months[m] = months[m] || { m, loads: 0, bagsIn: 0, kgIn: 0, bagsOut: 0, kgOut: 0, payable: 0 };
          g.loads++; g.bagsIn += d.bagCount || 0; g.kgIn += d.netKg || 0; g.payable += VH.payable(d);
        }
        for (const u of usages) {
          const m = String(u.consumedAt).slice(0, 7);
          const g = months[m] = months[m] || { m, loads: 0, bagsIn: 0, kgIn: 0, bagsOut: 0, kgOut: 0, payable: 0 };
          g.bagsOut += u.bags || 0; g.kgOut += u.totalKg || 0;
        }
        const monthRows = Object.values(months).sort((a, b) => b.m.localeCompare(a.m));

        return { deliveries, usages, payments, bagsIn, kgIn, bagsOut, kgOut, payable, deducted, gross, reduced, withDeduction,
          avgKgIn, avgKgOut, payRows, supplierRows, typeRows, bayRows, buckets, step, filtered,
          dryRows, ageRows, checkRows, gasTypeRows, fillRows, noFill, monthRows, periodDays, s };
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
            <p class="small muted">In: the weight from the weighbridge. Out: one bag weighed per type at the gasifier, times the bags. If bags going out are lighter than bags coming in, the biomass dried in the bay.</p>
          </section>

          <section class="nm-card pad">
            <div class="card-head"><h3>How the weight goes down in each bay</h3><button class="link" id="csv-drying"><i class="i i-download"></i>CSV</button></div>
            ${UI.table({
              rows: r.dryRows, empty: 'A bay needs at least two weighings in this period (a load coming in, a daily check, a test bag or the gasifier).',
              columns: [
                { label: 'Bay', render: (x) => `<b>${esc(x.code)}</b>` },
                { label: 'Weighings', cls: 'num', render: (x) => x.n },
                { label: 'First → latest bag', cls: 'num', render: (x) => `${x.fromKg} → ${x.toKg} kg` },
                { label: 'Moisture', cls: 'num', render: (x) => `${x.fromM}% → ${x.toM}%` },
                { label: 'Over', cls: 'num', render: (x) => `${x.days} day${x.days === 1 ? '' : 's'}` },
                { label: 'Lost a day, per bag', cls: 'num', render: (x) => `<b class="${x.perDay < 0 ? 't-warn' : ''}">${x.perDay} kg</b>` },
              ],
            })}
            <p class="small muted">Read from real weighings, not the estimate. The app assumes ${r.s.dryingKgPerDay ?? 0.6} kg a day (Business settings). If these figures differ a lot, change that number. A minus figure means the bags got heavier: a new load or rain.</p>
          </section>

          <section class="cols-2">
            <div class="nm-card pad">
              <div class="card-head"><h3>Bag weight by days in the bay</h3><button class="link" id="csv-age"><i class="i i-download"></i>CSV</button></div>
              <table class="mini"><thead><tr><th>Days since the load came in</th><th class="num">Weighings</th><th class="num">Average bag</th><th class="num">Moisture</th></tr></thead>
                <tbody>${r.ageRows.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${g.n}</td><td class="num">${g.avg ? `${g.avg} kg` : '—'}</td><td class="num">${g.avg ? `${D.moistureFromWeight(g.avg, r.s)}%` : '—'}</td></tr>`).join('')}</tbody></table>
              <p class="small muted">Daily checks, test bags and gasifier weighings, grouped by how long the bags had been in the bay. The longer they wait, the lighter and drier they should be.</p>
            </div>
            <div class="nm-card pad">
              <div class="card-head"><h3>Daily bay checks</h3><button class="link" id="csv-checks"><i class="i i-download"></i>CSV</button></div>
              <table class="mini"><thead><tr><th>Bay</th><th class="num">Checks</th><th class="num">Days checked (of days with stock)</th><th class="num">Last check</th></tr></thead>
                <tbody>${r.checkRows.map((c) => `<tr><td>${esc(c.code)}</td><td class="num">${c.checks}</td><td class="num">${c.daysChecked} of ${c.daysOpen} <span class="muted small">(${c.pct}%)</span></td><td class="num">${c.last ? `${esc(dOnly(c.last))}, ${c.lastKg} kg` : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No bays with stock.</td></tr>'}</tbody></table>
              <p class="small muted">A missed day is fine. More checks give a truer drying figure.</p>
            </div>
          </section>

          <section class="cols-2">
            <div class="nm-card pad">
              <div class="card-head"><h3>Gasifier weighing by type</h3><button class="link" id="csv-gastype"><i class="i i-download"></i>CSV</button></div>
              <table class="mini"><thead><tr><th>Type</th><th class="num">Batches</th><th class="num">Bags</th><th class="num">Average bag</th><th class="num">Total weighed</th></tr></thead>
                <tbody>${r.gasTypeRows.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${g.batches}</td><td class="num">${g.bags.toLocaleString()}</td><td class="num">${g.avg ? `${g.avg} kg` : '—'}</td><td class="num">${kg(Math.round(g.kg))}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing went to the gasifier in this period.</td></tr>'}</tbody></table>
            </div>
            <div class="nm-card pad">
              <div class="card-head"><h3>Bag fill and pay</h3><button class="link" id="csv-fill"><i class="i i-download"></i>CSV</button></div>
              <table class="mini"><thead><tr><th>Bags filled</th><th class="num">Loads</th><th class="num">Bags</th><th class="num">Paid</th><th class="num">Taken off</th></tr></thead>
                <tbody>${r.fillRows.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${g.loads}</td><td class="num">${g.bags.toLocaleString()}</td><td class="num">${money(g.paid)}</td><td class="num ${g.gross - g.paid > 0 ? 't-danger' : ''}">${g.gross - g.paid > 0 ? `− ${money(g.gross - g.paid)}` : '—'}</td></tr>`).join('')}</tbody></table>
              <p class="small muted">100% full gets the full price. Less than 100% is paid less. More than 100% is never paid more.${r.noFill ? ` ${r.noFill} load(s) had no fill check.` : ''}</p>
            </div>
          </section>

          <section class="nm-card pad">
            <div class="card-head"><h3>Month by month</h3><button class="link" id="csv-months"><i class="i i-download"></i>CSV</button></div>
            ${UI.table({
              rows: r.monthRows, empty: 'Nothing in this period.',
              columns: [
                { label: 'Month', render: (x) => `<b>${esc(new Date(`${x.m}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</b>` },
                { label: 'Loads', cls: 'num', render: (x) => x.loads },
                { label: 'Bags in', cls: 'num', render: (x) => x.bagsIn.toLocaleString() },
                { label: 'Weight in', cls: 'num', render: (x) => kg(Math.round(x.kgIn)) },
                { label: 'Bag in, avg', cls: 'num', render: (x) => (x.bagsIn ? `${D.round2(x.kgIn / x.bagsIn)} kg` : '—') },
                { label: 'Bags out', cls: 'num', render: (x) => x.bagsOut.toLocaleString() },
                { label: 'Bag out, avg', cls: 'num', render: (x) => (x.bagsOut ? `${D.round2(x.kgOut / x.bagsOut)} kg` : '—') },
                { label: 'Payable', cls: 'num', render: (x) => money(x.payable) },
              ],
            })}
          </section>

          <section class="cols-2">
            <div class="nm-card pad">
              <div class="card-head"><h3>Money</h3><button class="link" id="csv-payments"><i class="i i-download"></i>CSV</button></div>
              <table class="mini">
                <tr><th>Value at the agreed price</th><td class="num">${money(r.gross)}</td></tr>
                <tr><th>Loads with bags not 100% full</th><td class="num">${r.reduced}</td></tr>
                <tr><th>Taken off (bags not filled fully, other reasons)</th><td class="num ${r.deducted ? 't-danger' : ''}">${r.deducted ? '− ' : ''}${money(r.deducted)}</td></tr>
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
          fillPct: d.fillCheck && d.fillCheck.avgFillPct !== null ? d.fillCheck.avgFillPct : '', unitPrice: d.fillCheck ? D.fillPayPerBag(d.fillCheck) : '',
          deductionPct: d.deductionPct || 0, deductionReason: d.deductionReason || '', payable: VH.payable(d),
        }))) || 'No deliveries in this period', 'text/csv'));
        body.querySelector('#csv-payments').addEventListener('click', () => UI.download(`payments-${tag}.csv`, UI.toCSV(r.payments.map((p) => ({
          payment: p.paymentNo, date: dOnly(p.createdAt), supplier: p.supplierName || supplierName(p.supplierId), bags: p.bags, unitPrice: p.unitPrice,
          gross: p.grossAmount, deductionPct: p.deductionPct || 0, deducted: p.deductions || 0, payable: p.netAmount, stage: D.PAYMENT_LABEL[p.status] || p.status,
        }))) || 'No payments in this period', 'text/csv'));
        body.querySelector('#csv-stock').addEventListener('click', () => UI.download(`stock-${D.todayISO()}.csv`, UI.toCSV(r.bayRows), 'text/csv'));
        const csv = (id, name, rows) => body.querySelector(id).addEventListener('click', () => UI.download(`${name}-${tag}.csv`, UI.toCSV(rows) || 'Nothing in this period', 'text/csv'));
        csv('#csv-drying', 'bay-drying', r.dryRows.map((x) => ({ bay: x.code, weighings: x.n, firstKg: x.fromKg, latestKg: x.toKg, firstMoisture: x.fromM, latestMoisture: x.toM, days: x.days, kgLostPerDay: x.perDay })));
        csv('#csv-age', 'weight-by-age', r.ageRows.map((g) => ({ daysInBay: g.label, weighings: g.n, avgBagKg: g.avg || '', moisturePct: g.avg ? D.moistureFromWeight(g.avg, r.s) : '' })));
        csv('#csv-checks', 'bay-checks', r.checkRows.map((c) => ({ bay: c.code, checks: c.checks, daysChecked: c.daysChecked, daysWithStock: c.daysOpen, lastCheck: c.last || '', lastKg: c.lastKg || '' })));
        csv('#csv-gastype', 'gasifier-by-type', r.gasTypeRows.map((g) => ({ type: g.label, batches: g.batches, bags: g.bags, avgBagKg: g.avg || '', totalKg: Math.round(g.kg) })));
        csv('#csv-fill', 'fill-and-pay', r.fillRows.map((g) => ({ filled: g.label, loads: g.loads, bags: g.bags, paid: g.paid, takenOff: D.round2(g.gross - g.paid) })));
        csv('#csv-months', 'by-month', r.monthRows.map((x) => ({ month: x.m, loads: x.loads, bagsIn: x.bagsIn, kgIn: Math.round(x.kgIn), bagsOut: x.bagsOut, kgOut: Math.round(x.kgOut), payable: x.payable })));
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
        r.payRows.map((p) => `${p.count}:${p.value}`).join(), r.bayRows.map((b) => b.bags).join(),
        r.checkRows.map((c) => c.checks).join(), r.dryRows.map((x) => `${x.n}:${x.toKg}`).join()].join('|');
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

      /* Staff log (administrators): everything every person did, with
         filters by person, area and time, and a summary per person. */
      const AREA = { auth: 'Sign-in', delivery: 'Loads', payment: 'Payments', invoice: 'Invoices', bay: 'Bays', bag: 'Bag serials', bags: 'Bag store',
        usage: 'Gasifier', supplier: 'Suppliers', quality: 'Quality', user: 'Staff', settings: 'Settings', subscription: 'Subscription', data: 'Data', report: 'Reports' };
      const areaOf = (a) => String(a.action || '').split('.')[0];
      const areaLabel = (k) => AREA[k] || (k ? k[0].toUpperCase() + k.slice(1) : 'Other');
      const staffF = { who: '', area: '', days: '30', q: '', limit: 100 };
      const staffAll = () => Store.all('audit').filter((a) => a && a.by && !Auth.isOwnerEmail(a.by));
      const staffFiltered = () => {
        const since = staffF.days === 'all' ? 0 : Date.now() - Number(staffF.days) * 864e5;
        const q = staffF.q.trim().toLowerCase();
        return staffAll().filter((a) => (!staffF.who || a.by === staffF.who) && (!staffF.area || areaOf(a) === staffF.area)
          && (Date.parse(a.at) || 0) >= since
          && (!q || `${a.action} ${a.detail} ${a.entityId} ${a.name}`.toLowerCase().includes(q)))
          .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      };
      const staffResults = () => {
        const rows = staffFiltered();
        const people = new Map();
        for (const a of rows) {
          const p = people.get(a.by) || { by: a.by, name: a.name || '', role: a.role, n: 0, last: a.at, first: a.at, days: new Set(), devices: new Set(), areas: new Map() };
          p.n++; if (a.at > p.last) p.last = a.at; if (a.at < p.first) p.first = a.at;
          p.days.add(String(a.at).slice(0, 10)); if (a.device) p.devices.add(a.device);
          const ar = areaOf(a); p.areas.set(ar, (p.areas.get(ar) || 0) + 1);
          if (!p.name && a.name) p.name = a.name;
          people.set(a.by, p);
        }
        const summary = Array.from(people.values()).sort((a, b) => b.n - a.n);
        const byDay = new Map();
        for (const a of rows) { const d = String(a.at).slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + 1); }
        const busiest = Array.from(byDay.entries()).sort((a, b) => b[1] - a[1])[0];
        return `
          <section class="stats stats-4">
            ${UI.stat('Actions', rows.length.toLocaleString(), staffF.days === 'all' ? 'all time' : `last ${staffF.days} days`)}
            ${UI.stat('People', `${summary.length}`, 'did something')}
            ${UI.stat('Busiest day', busiest ? esc(dOnly(busiest[0])) : '—', busiest ? `${busiest[1]} actions` : '')}
            ${UI.stat('Devices', `${new Set(rows.map((a) => a.device).filter(Boolean)).size}`, 'phones, tablets, computers')}
          </section>
          <section class="nm-card pad">
            <div class="card-head"><h3>By person</h3></div>
            ${UI.table({
              rows: summary, empty: 'Nobody did anything in this period.',
              columns: [
                { label: 'Person', render: (p) => `<button class="link-btn" data-staff-who="${esc(p.by)}">${esc(p.name || p.by)}</button><div class="muted small">${esc(p.name ? p.by : '')}${p.role ? ` · ${esc(D.ROLE_LABEL[p.role] || p.role)}` : ''}</div>` },
                { label: 'Actions', cls: 'num', render: (p) => p.n.toLocaleString() },
                { label: 'Days active', cls: 'num', render: (p) => `${p.days.size}` },
                { label: 'Mostly', render: (p) => `<span class="small">${Array.from(p.areas.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${esc(areaLabel(k))} ${n}`).join(' · ')}</span>` },
                { label: 'Devices', cls: 'num', render: (p) => `${p.devices.size}` },
                { label: 'Last active', render: (p) => `<span class="small">${esc(dt(p.last))}</span>` },
              ],
            })}
          </section>
          <section class="nm-card pad">
            <div class="card-head"><h3>Everything, newest first</h3><span class="muted small">${Math.min(rows.length, staffF.limit).toLocaleString()} of ${rows.length.toLocaleString()}</span></div>
            ${UI.table({
              rows: rows.slice(0, staffF.limit), empty: 'Nothing matches these filters.',
              columns: [
                { label: 'When', render: (a) => `<span class="small">${esc(dt(a.at))}</span>` },
                { label: 'Who', render: (a) => `${esc(a.name || a.by)}<div class="muted small">${a.role ? esc(D.ROLE_LABEL[a.role] || a.role) : ''}</div>` },
                { label: 'Area', render: (a) => badge(areaLabel(areaOf(a)), 'muted') },
                { label: 'What', render: (a) => `<span class="small">${esc(a.detail || a.action)}</span><div class="muted small mono">${esc(a.action)}${a.entityId ? ` · ${esc(a.entityId)}` : ''}</div>` },
                { label: 'Device', render: (a) => `<span class="muted small mono">${esc(String(a.device || '').slice(-6))}</span>` },
              ],
            })}
            ${rows.length > staffF.limit ? '<div class="row-actions"><button class="nm-btn" id="staff-more">Show more</button></div>' : ''}
          </section>`;
      };

      // Each tab is gated by its own permission: a supervisor can read the
      // audit trail without being able to touch users or settings.
      const TAB_DEFS = [
        { id: 'users', label: 'Users &amp; roles', ok: Auth.can('user.manage') },
        { id: 'sub', label: 'Subscription', ok: isSuper },
        { id: 'settings', label: 'Business settings', ok: Auth.can('settings.write') },
        { id: 'audit', label: 'Activity log', ok: Auth.can('audit.read') },
        { id: 'staff', label: 'Staff log', ok: Auth.can('user.manage') },
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
                { label: '', cls: 'actions', render: (u) => `<button class="nm-btn tiny" data-reset="${esc(u.email)}">Reset password</button>${Auth.isSuper(u) || (Auth.current() || {}).email === u.email ? '' : ` <button class="nm-btn tiny danger-ghost" data-remove-user="${esc(u.id)}">Remove</button>`}` },
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
              ${UI.field('Sample size (% of bags)', UI.input('sampleSizePct', { type: 'number', min: 1, max: 100, value: s.sampleSizePct }))}
              ${UI.field('Minimum sample bags', UI.input('minSampleSize', { type: 'number', min: 1, max: 50, value: s.minSampleSize }))}
              ${UI.field('Bag serial prefix', UI.input('bagSerialPrefix', { value: s.bagSerialPrefix }))}
              ${UI.field('Maximum bags per delivery', UI.input('maxBagsPerDelivery', { type: 'number', min: 1, value: s.maxBagsPerDelivery }))}
              ${UI.field('Warn when new bags fall to', UI.input('bagReorderLevel', { type: 'number', min: 0, value: s.bagReorderLevel ?? 500 }), 'Bag store: time to order more')}
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
              ${UI.field('Wet from (%)', UI.input('moistureHighPct', { type: 'number', min: 1, max: 99, value: D.moistureHighPct(s) }), 'Shown in blue on the bays. Used for drying, not for the price.')}
            </div>
            <p class="small muted">Wetness is shown for drying the bays. It never cuts the price: only bags not filled fully do.</p>
            <div id="cal-preview"></div>
            <div class="row-actions"><button class="nm-btn primary" id="save-settings">Save settings</button></div>
          </section>`,

        audit: () => { const audit = auditRows(); return `
          <section class="nm-card pad">
            <div class="card-head"><h3>Activity log</h3><span class="muted small" id="audit-count">${audit.length} most recent actions, from every device${Sync.state.live ? ', updating live' : ''}</span></div>
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

        staff: () => {
          const people = new Map();
          for (const a of staffAll()) if (!people.has(a.by)) people.set(a.by, a.name || a.by);
          const areas = Array.from(new Set(staffAll().map(areaOf))).filter(Boolean).sort((a, b) => areaLabel(a).localeCompare(areaLabel(b)));
          return `
          <section class="nm-card pad">
            <div class="card-head"><h3>Staff log</h3><span class="muted small" id="staff-count">Everything every staff member did, from every device${Sync.state.live ? ', updating live' : ''}</span></div>
            <p class="muted small">For administrators. Pick a person, an area or a period. Nothing here can be edited.</p>
            <div class="grid-4 staff-filters">
              ${UI.field('Person', UI.select('staffWho', [{ value: '', label: 'Everyone' }].concat(Array.from(people.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([v, l]) => ({ value: v, label: l }))), { value: staffF.who }))}
              ${UI.field('Area', UI.select('staffArea', [{ value: '', label: 'Everything' }].concat(areas.map((k) => ({ value: k, label: areaLabel(k) }))), { value: staffF.area }))}
              ${UI.field('Period', UI.select('staffDays', [{ value: '1', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: 'all', label: 'All time' }], { value: staffF.days }))}
              ${UI.field('Search', UI.input('staffQ', { value: staffF.q, placeholder: 'Receipt no., bay, name…' }))}
            </div>
            <div class="row-actions"><button class="nm-btn" id="staff-csv"><i class="i i-download"></i>Download CSV</button></div>
          </section>
          <div id="staff-results">${staffResults()}</div>`;
        },

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
              <div class="card-head"><h3>Load a backup</h3></div>
              <p class="muted small">Load a backup file. For each record, the newest copy is kept.</p>
              <input type="file" id="import-file" accept="application/json" class="nm-input" />
              <div class="row-actions">
                <button class="nm-btn" id="import-merge">Load backup</button>
              </div>
              <div class="divider"></div>
              <h4>Fix this device</h4>
              <p class="muted small">Throws away this device's copy and downloads it again from the cloud. <b>Nothing is deleted</b> anywhere. Use it if this device shows something different from the others.</p>
              <div class="row-actions">
                <button class="nm-btn" id="redownload">Re-download this device</button>
              </div>
              <div class="divider"></div>
              <div class="danger-zone">
                <p class="small t-danger"><b>Danger zone</b></p>
                ${Auth.isSuper(Auth.current()) && (Auth.current() || {}).mode !== 'preview' ? `
                  <p class="small">Delete <b>every record</b> in the cloud and on <b>every device</b>: deliveries, payments, bags, suppliers, gasifier issues, quality issues and returns. Kept: staff accounts, business settings (prices, moisture), the list of bays (they become empty) and the activity log. A backup file is downloaded first. This cannot be undone.</p>
                  <div class="row-actions"><button class="nm-btn danger" id="wipe-all">Delete all records everywhere</button></div>`
                  : '<p class="muted small">Deleting all records is kept for the owner of the system.</p>'}
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
        if ((tab === 'audit' || tab === 'staff') && !fromSync) {
          Sync.pullAudit().then((res) => {
            if (current !== tab || !view.isConnected) return;
            if (res && res.added) { if (tab === 'staff' && view._staffRedraw) view._staffRedraw(); else show('audit', true); }
            else if (res && res.refused) {
              const c = view.querySelector('#audit-count');
              if (c) c.textContent = 'Showing this device only. Publish the latest firebase.rules.json to see every device.';
            }
          });
        }
      };

      const wire = (tab) => {
        const body = view.querySelector('#admin-body');

        if (tab === 'staff') {
          const redraw = () => { body.querySelector('#staff-results').innerHTML = staffResults(); wireStaffResults(); };
          const wireStaffResults = () => {
            const more = body.querySelector('#staff-more');
            if (more) more.addEventListener('click', () => { staffF.limit += 200; redraw(); });
            UI.$$('[data-staff-who]', body).forEach((b) => b.addEventListener('click', () => {
              staffF.who = b.dataset.staffWho; staffF.limit = 100;
              body.querySelector('[name=staffWho]').value = staffF.who; redraw();
            }));
          };
          const bind = (name, key, ev) => body.querySelector(`[name=${name}]`).addEventListener(ev, (e) => { staffF[key] = e.target.value; staffF.limit = 100; redraw(); });
          bind('staffWho', 'who', 'change'); bind('staffArea', 'area', 'change'); bind('staffDays', 'days', 'change');
          body.querySelector('[name=staffQ]').addEventListener('input', UI.debounce((e) => { staffF.q = e.target.value; staffF.limit = 100; redraw(); }, 250));
          body.querySelector('#staff-csv').addEventListener('click', () => {
            const rows = staffFiltered().map((a) => ({ when: a.at, email: a.by, name: a.name || '', role: a.role || '', area: areaLabel(areaOf(a)), action: a.action, record: a.entityId || '', detail: a.detail || '', device: a.device || '' }));
            if (!rows.length) return UI.toast('Nothing to download', 'warn');
            UI.download(`staff-log-${new Date().toISOString().slice(0, 10)}.csv`, UI.toCSV(rows), 'text/csv');
          });
          wireStaffResults();
          view._staffRedraw = redraw;
        }

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
          UI.$$('[data-remove-user]', body).forEach((btn) => btn.addEventListener('click', async () => {
            const u = Store.byId('users', btn.dataset.removeUser);
            if (!u) return;
            const ok = await UI.confirm({
              title: `Remove ${u.name || u.email}?`, confirmText: 'Remove account',
              message: `${u.email} is signed out on every device and can no longer open the app. What they did stays in the records and the activity log. You can add the same email again later.`,
            });
            if (!ok) return;
            try {
              Auth.removeUser(u.id);
              VH.audit('user.remove', 'user', u.email, `${u.email} removed`);
              UI.toast(`${u.name || u.email} removed`, 'ok');
              Sync.now('user-remove');
              show('users');
            } catch (e) { UI.toast(e.message, 'danger'); }
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
          const NUM_FIELDS = ['unitPrice', 'sampleSizePct', 'minSampleSize',
            'moistureCalKg1', 'moistureCalPct1', 'moistureCalKg2', 'moistureCalPct2',
            'moistureWarnPct', 'moistureHighPct', 'maxBagsPerDelivery', 'bagReorderLevel'];
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
            patch.bagSerialPrefix = String(f.bagSerialPrefix || 'EFPL-BG').toUpperCase().replace(/[^A-Z0-9-]/g, '');
            patch.siteName = f.siteName; patch.siteLocation = f.siteLocation; patch.headOfficeEmail = f.headOfficeEmail;
            Store.patchSettings(patch);
            VH.audit('settings.update', 'settings', 'singleton', `full price ${patch.unitPrice} a bag at 100% fill, moisture line ${patch.moistureCalKg1}kg=${patch.moistureCalPct1}% to ${patch.moistureCalKg2}kg=${patch.moistureCalPct2}%`);
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

          body.querySelector('#redownload').addEventListener('click', async (e) => {
            if ((Auth.current() || {}).mode === 'preview') return UI.toast('Not in the demo', 'warn');
            const ok = await UI.confirm({
              title: 'Re-download this device?',
              message: 'This device\'s copy is replaced with the one in the cloud. Nothing is deleted anywhere.',
              confirmText: 'Re-download', tone: 'primary',
            });
            if (!ok) return;
            const btn = e.target.closest('button');
            btn.disabled = true; btn.textContent = 'Downloading…';
            try {
              const phase = await Sync.redownload();
              UI.toast(phase === 'ok' ? 'This device is up to date with the cloud' : 'Cleared. It downloads again as soon as there is a connection', phase === 'ok' ? 'ok' : 'warn', 6000);
            } catch (err) { UI.toast(err.message, 'danger', 7000); }
            App.refresh();
          });

          const wipe = body.querySelector('#wipe-all');
          if (wipe) wipe.addEventListener('click', async () => {
            const counts = ['deliveries', 'payments', 'bags', 'suppliers'].map((c) => `${Store.all(c).length} ${c}`).join(', ');
            const ok = await UI.confirm({
              title: 'Delete all records everywhere?',
              message: `This deletes ${counts} and everything else recorded, in the cloud and on every phone, tablet and computer. Staff, settings, the bay list and the activity log are kept. A backup file is downloaded first. It cannot be undone.`,
              confirmText: 'Delete everything', requireText: 'DELETE EVERYTHING',
            });
            if (!ok) return;
            // a copy first, always
            UI.download(`enerfab-biomass-backup-before-delete-${D.todayISO()}.json`, JSON.stringify(App.exportData(), null, 2));
            wipe.disabled = true; wipe.textContent = 'Deleting…';
            try {
              const res = await Sync.wipeEverywhere();
              VH.audit('data.wipe', 'data', 'all', `All records deleted everywhere (${res.removed} on this device). Backup downloaded first.`);
              UI.toast('All records deleted, here and on every device. A backup was downloaded first.', 'ok', 7000);
            } catch (err) {
              UI.toast(err.message, 'danger', 9000);
            }
            App.refresh();
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
        if (current === 'staff') {
          Sync.pullAudit().then(() => {
            if (current !== 'staff' || !view.isConnected) return;
            const n = Store.all('audit').length;
            if (n !== lastAuditCount && view._staffRedraw) { lastAuditCount = n; const y = window.scrollY; view._staffRedraw(); window.scrollTo(0, y); }
          });
        } else if (current === 'audit') {
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
