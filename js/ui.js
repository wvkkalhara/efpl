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


  /* ------------------------------ icons ------------------------------
     One consistent stroke-icon set (24px grid, 1.8 stroke) instead of
     unicode symbols, which render differently on every phone. */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
    truckIn: '<path d="M12 3v10"/><path d="m7.5 8.5 4.5 4.5 4.5-4.5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    list: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h10M7 17h6"/>',
    warehouse: '<path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8"/><path d="M7 17h10"/>',
    flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5.5C10 10 11 11 12 11c0-3-1-5.5 0-8Z"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5v.01"/>',
    returns: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M6 6V5a2 2 0 0 1 2-2h9"/>',
    truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15Z"/><path d="M5 19c3-4 6-6.5 10-9"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    cloud: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8H7Z"/>',
  };
  const icon = (name, cls = '') =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

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

  /* --------------------------- back button ---------------------------
     Every open dialog / sheet owns one browser-history entry, so the phone's
     back gesture (or the browser back button) closes the top dialog instead
     of leaving the page behind it. Closing a dialog with ✕ pops that entry.
     Navigation requested while a pop is in flight waits for it to finish. */
  const layers = [];
  let pendingPops = 0;
  const afterPop = [];
  window.addEventListener('popstate', () => {
    if (pendingPops > 0) {
      pendingPops--;
      if (!pendingPops) afterPop.splice(0).forEach((fn) => fn());
      return;
    }
    const top = layers[layers.length - 1];
    if (top) top.close(true);
  });
  function pushLayer(close) {
    const layer = { close };
    layers.push(layer);
    try { history.pushState({ efplLayer: layers.length }, '', location.href); } catch { /* sandboxed */ }
    return layer;
  }
  function dropLayer(layer, fromPop) {
    const i = layers.indexOf(layer);
    if (i < 0) return;
    layers.splice(i, 1);
    if (!fromPop) { pendingPops++; history.back(); }
  }
  /** Run fn once any history pops started by closing dialogs have landed. */
  function whenSettled(fn) { if (pendingPops) afterPop.push(fn); else fn(); }
  /** Close every open dialog (used when the page changes). */
  function closeAllLayers() { layers.slice().reverse().forEach((l) => l.close(true)); }

  /* ------------------------------ modal ------------------------------ */
  function modal({ title, body, footer, size = 'md', onMount, dismissible = true }) {
    const backdrop = document.createElement('div');
    backdrop.className = `modal-backdrop${size === 'sheet' ? ' is-sheet' : ''}`;
    backdrop.innerHTML = `
      <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${attr(title)}">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <header class="modal-head">
          <h2>${esc(title)}</h2>
          ${dismissible ? `<button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>` : ''}
        </header>
        <div class="modal-body">${body || ''}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
      </div>`;
    document.body.appendChild(backdrop);
    document.documentElement.classList.add('has-modal');
    requestAnimationFrame(() => backdrop.classList.add('open'));

    let closed = false;
    const close = (fromPop) => {
      if (closed) return;
      closed = true;
      dropLayer(layer, fromPop === true);
      backdrop.classList.remove('open');
      setTimeout(() => {
        backdrop.remove();
        if (!document.querySelector('.modal-backdrop')) document.documentElement.classList.remove('has-modal');
      }, 220);
      document.removeEventListener('keydown', onKey);
    };
    const layer = pushLayer(close);
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
        <tbody>${rows.map((r) => `<tr ${rowKey ? `data-key="${attr(rowKey(r))}"` : ''}>${columns.map((c) => `<td class="${c.cls || ''}" data-label="${attr(c.label)}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
  }

  const empty = (title, hint, action) => `
    <div class="empty-state nm-card">
      <div class="empty-ico">${icon('leaf')}</div>
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
    // Dialog bodies are plain <div>s, not <form>s, so they have no .elements.
    const fields = form.elements ? Array.from(form.elements) : Array.from(form.querySelectorAll('input, select, textarea'));
    for (const el of fields) {
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
        .stats{display:flex;flex-wrap:wrap;gap:4mm;margin-bottom:4mm}
        .stat{border:1px solid #bbb;padding:2mm 3mm;display:flex;flex-direction:column;font-size:9pt}
        .stat-value{font-size:13pt}
        button,.i{display:none}
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
    esc, attr, $, $$, icon, whenSettled, closeAllLayers, pushLayer, dropLayer, toast, modal, confirm, badge, statusTone, stat, table, empty,
    field, input, select, textarea, money, kg, dt, dOnly, formData, showErrors,
    download, toCSV, print, debounce,
  };
})();
