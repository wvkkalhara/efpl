/* =====================================================================
   ui.js — small rendering toolkit (no framework, no build step).
   Every string that reaches the DOM goes through esc() first, so a farmer
   called "<script>" can never run code in the supervisor's browser.
   ===================================================================== */
(function () {
  'use strict';

  const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const attr = (v) => esc(v).replace(/`/g, '&#96;');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ------------------------------ toasts ----------------------------- */
  function stack() {
    let el = $('#toast-stack');
    if (!el) { el = document.createElement('div'); el.id = 'toast-stack'; el.className = 'toast-stack'; document.body.appendChild(el); }
    return el;
  }

  function toast(message, tone = 'info', ms = 3800) {
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-dot"></span><span>${esc(message)}</span>`;
    stack().appendChild(el);
    setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 320); }, ms);
  }

  /* ------------------------------ modal ------------------------------ */
  function modal({ title, body, footer, size = 'md', onMount, dismissible = true }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${attr(title)}">
        <header class="modal-head">
          <h2>${esc(title)}</h2>
          ${dismissible ? '<button class="icon-btn" data-close aria-label="Close">✕</button>' : ''}
        </header>
        <div class="modal-body">${body || ''}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
      </div>`;
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    const close = () => {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 200);
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };
    document.addEventListener('keydown', onKey);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && dismissible) close();
      if (e.target.closest('[data-close]')) close();
    });

    if (onMount) onMount(backdrop, close);
    const first = backdrop.querySelector('input, select, textarea, button');
    if (first) setTimeout(() => first.focus(), 60);
    return { el: backdrop, close };
  }

  function confirm({ title = 'Are you sure?', message = '', confirmText = 'Confirm', tone = 'danger', requireText = null }) {
    return new Promise((resolve) => {
      let typedOk = !requireText;
      const m = modal({
        title,
        size: 'sm',
        body: `<p class="muted">${esc(message)}</p>
          ${requireText ? `<label class="field"><span>Type <b>${esc(requireText)}</b> to confirm</span>
            <input class="nm-input" id="confirm-typed" autocomplete="off" /></label>` : ''}`,
        footer: `<button class="nm-btn" data-cancel>Cancel</button>
                 <button class="nm-btn ${tone === 'danger' ? 'danger' : 'primary'}" data-ok ${requireText ? 'disabled' : ''}>${esc(confirmText)}</button>`,
        onMount(el, close) {
          const okBtn = el.querySelector('[data-ok]');
          if (requireText) {
            el.querySelector('#confirm-typed').addEventListener('input', (e) => {
              typedOk = e.target.value.trim().toUpperCase() === String(requireText).toUpperCase();
              okBtn.disabled = !typedOk;
            });
          }
          el.querySelector('[data-cancel]').addEventListener('click', () => { close(); resolve(false); });
          okBtn.addEventListener('click', () => { if (!typedOk) return; close(); resolve(true); });
        },
      });
      m.el.addEventListener('click', (e) => { if (e.target === m.el) resolve(false); });
    });
  }

  /* ------------------------------ pieces ----------------------------- */
  const badge = (text, tone = 'muted') => `<span class="badge badge-${tone}">${esc(text)}</span>`;

  const statusTone = (status) => ({
    IN_STOCK: 'info', ISSUED: 'warn', DELIVERED: 'info', STORED: 'ok', CONSUMED: 'muted',
    RETURNED: 'info', DAMAGED: 'danger', REPAIRED: 'ok', RETIRED: 'muted', LOST: 'danger',
    DRAFT: 'muted', PENDING_SUPERVISOR: 'warn', APPROVED: 'info', SENT_TO_HEAD_OFFICE: 'info',
    PAID: 'ok', PENDING: 'warn', APPROVED_: 'ok', CONSUMED_: 'muted', REJECTED: 'danger',
    OPEN: 'warn', RESOLVED: 'ok', ACTIVE: 'ok', SUSPENDED: 'danger',
  }[status] || 'muted');

  const stat = (label, value, sub, tone) => `
    <div class="stat nm-card">
      <span class="stat-label">${esc(label)}</span>
      <strong class="stat-value ${tone ? `t-${tone}` : ''}">${value}</strong>
      <span class="stat-sub">${sub || ''}</span>
    </div>`;

  function table({ columns, rows, empty = 'Nothing to show yet.', rowKey }) {
    if (!rows || !rows.length) return `<div class="empty nm-inset"><span>${esc(empty)}</span></div>`;
    return `<div class="table-wrap nm-inset">
      <table class="data-table">
        <thead><tr>${columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr ${rowKey ? `data-key="${attr(rowKey(r))}"` : ''}>${columns.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
  }

  const empty = (title, hint, action) => `
    <div class="empty-state nm-card">
      <div class="empty-ico">🌾</div>
      <h3>${esc(title)}</h3>
      <p class="muted">${esc(hint || '')}</p>
      ${action || ''}
    </div>`;

  const field = (label, inner, hint) => `
    <label class="field">
      <span>${esc(label)}</span>
      ${inner}
      ${hint ? `<small class="hint">${hint}</small>` : ''}
    </label>`;

  const input = (name, opts = {}) => `<input class="nm-input" name="${attr(name)}" id="${attr(opts.id || name)}"
    type="${attr(opts.type || 'text')}" value="${attr(opts.value ?? '')}"
    ${opts.placeholder ? `placeholder="${attr(opts.placeholder)}"` : ''}
    ${opts.min !== undefined ? `min="${attr(opts.min)}"` : ''}
    ${opts.max !== undefined ? `max="${attr(opts.max)}"` : ''}
    ${opts.step !== undefined ? `step="${attr(opts.step)}"` : ''}
    ${opts.required ? 'required' : ''} ${opts.autocomplete ? `autocomplete="${attr(opts.autocomplete)}"` : ''}
    ${opts.list ? `list="${attr(opts.list)}"` : ''} ${opts.readonly ? 'readonly' : ''} ${opts.disabled ? 'disabled' : ''}
    ${opts.pattern ? `pattern="${attr(opts.pattern)}"` : ''} />`;

  const select = (name, options, opts = {}) => `
    <select class="nm-input" name="${attr(name)}" id="${attr(opts.id || name)}" ${opts.required ? 'required' : ''}>
      ${opts.placeholder ? `<option value="">${esc(opts.placeholder)}</option>` : ''}
      ${options.map((o) => {
        const val = typeof o === 'object' ? o.value : o;
        const lab = typeof o === 'object' ? o.label : o;
        return `<option value="${attr(val)}" ${String(opts.value) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('')}
    </select>`;

  const textarea = (name, opts = {}) => `<textarea class="nm-input" name="${attr(name)}" id="${attr(opts.id || name)}" rows="${attr(opts.rows || 3)}"
    ${opts.placeholder ? `placeholder="${attr(opts.placeholder)}"` : ''}>${esc(opts.value || '')}</textarea>`;

  const money = (n) => window.Domain.money(n);
  const kg = (n) => window.Domain.kg(n);
  const dt = (n) => window.Domain.dt(n);
  const dOnly = (n) => window.Domain.dOnly(n);

  /* ------------------------------ forms ------------------------------ */
  /** Reads a <form> into a plain object, trimmed. */
  function formData(form) {
    const out = {};
    for (const el of Array.from(form.elements)) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'number') out[el.name] = el.value === '' ? '' : Number(el.value);
      else out[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
    }
    return out;
  }

  function showErrors(container, errors) {
    const box = container.querySelector('.form-errors');
    if (!box) return;
    const list = (errors || []).map((e) => `<li>${esc(typeof e === 'string' ? e : `${e.field ? e.field + ': ' : ''}${e.msg || e.message}`)}</li>`);
    box.innerHTML = list.length ? `<ul>${list.join('')}</ul>` : '';
    box.classList.toggle('show', list.length > 0);
  }

  /* ------------------------- files and printing ---------------------- */
  function download(filename, content, mime = 'application/json') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function toCSV(rows, headers) {
    if (!rows.length) return '';
    const cols = headers || Object.keys(rows[0]);
    const escapeCell = (v) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // formula-injection guard
      return `"${s.replace(/"/g, '""')}"`;
    };
    return [cols.join(','), ...rows.map((r) => cols.map((c) => escapeCell(r[c])).join(','))].join('\r\n');
  }

  /** Print an arbitrary HTML block using a hidden iframe (keeps the app state). */
  function print(html, title = 'Print') {
    const frame = document.createElement('iframe');
    frame.setAttribute('title', title);
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>
        @page { size: auto; margin: 10mm; }
        *{box-sizing:border-box}
        body{font-family:"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:0;padding:0;background:#fff}
        .sheet{display:flex;flex-wrap:wrap;gap:6mm}
        .sticker{width:70mm;border:1.2px solid #111;border-radius:3mm;padding:3mm;page-break-inside:avoid}
        .sticker h3{margin:0 0 1mm;font-size:11pt;letter-spacing:.5px}
        .sticker .serial{font-family:ui-monospace,Consolas,monospace;font-size:13pt;font-weight:700;letter-spacing:.5px}
        .sticker .sub{font-size:7.5pt;color:#333;margin:1mm 0}
        .sticker .write{border:1px dashed #555;border-radius:2mm;padding:2mm;margin-top:2mm;font-size:7pt;min-height:14mm}
        .sticker .co{font-size:7pt;text-transform:uppercase;letter-spacing:1px;color:#187800;font-weight:700}
        .sticker svg{display:block;margin:1mm 0}
        table{width:100%;border-collapse:collapse;font-size:9pt}
        th,td{border:1px solid #bbb;padding:1.5mm 2mm;text-align:left}
        h1{font-size:14pt;margin:0 0 2mm}h2{font-size:11pt;margin:3mm 0 1mm}
        .meta{font-size:9pt;color:#333}
        .row{display:flex;justify-content:space-between}
        .sign{margin-top:12mm;border-top:1px solid #111;width:60mm;font-size:8pt;padding-top:1mm}
      </style></head><body>${html}</body></html>`);
    doc.close();
    frame.contentWindow.focus();
    setTimeout(() => {
      try { frame.contentWindow.print(); } catch (e) { console.warn('Print blocked', e); }
      setTimeout(() => frame.remove(), 60000);
    }, 350);
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  window.UI = {
    esc, attr, $, $$, toast, modal, confirm, badge, statusTone, stat, table, empty,
    field, input, select, textarea, money, kg, dt, dOnly, formData, showErrors,
    download, toCSV, print, debounce,
  };
})();
