/* =====================================================================
   app.js — shell, router, sign-in screen and the subscription gate.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG;
  const Store = window.Store;
  const Auth = window.Auth;
  const Sync = window.Sync;
  const UI = window.UI;
  const D = window.Domain;
  const esc = UI.esc;

  const NAV = [
    { group: 'Operations', items: [
      { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: 'home' },
      { id: 'intake', label: 'Receive biomass', short: 'Receive', icon: 'truckIn', perm: 'delivery.create' },
      { id: 'deliveries', label: 'Deliveries', short: 'Deliveries', icon: 'list' },
      { id: 'bays', label: 'Bays & stock', short: 'Stock', icon: 'warehouse' },
      { id: 'gasifier', label: 'Gasifier issue', short: 'Gasifier', icon: 'flame' },
    ] },
    { group: 'Traceability', items: [
      { id: 'bags', label: 'Bag registry', short: 'Bags', icon: 'tag' },
      { id: 'trace', label: 'Trace a bag', short: 'Trace', icon: 'search' },
      { id: 'quality', label: 'Quality issues', short: 'Quality', icon: 'alert' },
      { id: 'returns', label: 'Bag returns', short: 'Returns', icon: 'returns' },
    ] },
    { group: 'Money', items: [
      { id: 'payments', label: 'Payments', short: 'Payments', icon: 'wallet' },
      { id: 'suppliers', label: 'Suppliers', short: 'Suppliers', icon: 'truck' },
      { id: 'farmers', label: 'Farmers', short: 'Farmers', icon: 'leaf' },
    ] },
    { group: 'Insight', items: [
      { id: 'reports', label: 'Reports', short: 'Reports', icon: 'chart', perm: 'report.read' },
      { id: 'admin', label: 'Administration', short: 'Admin', icon: 'settings' },
    ] },
  ];
  const NAV_ITEMS = NAV.flatMap((g) => g.items);
  const ico = UI.icon;
  /** Phones get a bottom tab bar; anything else lives under "More". */
  // Screen-size query, guarded for browsers (and test runners) without matchMedia.
  const phoneQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 760px)') : null;
  const PHONE = () => !!(phoneQuery && phoneQuery.matches);
  const routeFromHash = () => (location.hash || '').replace(/^#\/?/, '') || 'dashboard';

  const App = {
    route: 'dashboard',
    routes: {},
    stack: [],            // in-app page history, used by the top-bar back button
    _afterMount: null,

    /* ------------------------------- boot ---------------------------- */
    boot() {
      Store.init();
      Store.purgeDemo();                       // demo records never belong in the live store
      const resumingDemo = Auth.init() && (Auth.current() || {}).mode === 'preview';
      if (resumingDemo) { Store.useSpace('demo'); window.Seed.ensure(); }

      Auth.onChange((e) => {
        if (e.type === 'signed-out') { this.stack = []; this.render(); }
      });
      Sync.onChange(() => this.paintSyncChip());
      window.addEventListener('efpl:subscription-changed', () => this.render());
      // The single source of truth for page changes: the URL hash. Links,
      // the tab bar, the top-bar back button and the phone's own back
      // gesture all end up here, so they always agree.
      window.addEventListener('hashchange', () => this.go(routeFromHash()));
      const onResize = () => { if (Auth.current()) this.render(); };
      if (phoneQuery && phoneQuery.addEventListener) phoneQuery.addEventListener('change', onResize);
      else if (phoneQuery && phoneQuery.addListener) phoneQuery.addListener(onResize);   // Safari < 14

      const saved = Auth.restore();
      this.route = this.routes[routeFromHash()] ? routeFromHash() : 'dashboard';
      this.stack = [this.route];
      this.render();
      if (saved && saved.mode !== 'preview') Sync.start();
    },

    register(id, def) { this.routes[id] = def; },

    can(perm) { return !perm || Auth.can(perm); },

    /** Go to a page. `after` runs once the page has been drawn. */
    navigate(id, after) {
      if (!this.routes[id]) id = 'dashboard';
      this._afterMount = after || null;
      UI.whenSettled(() => {
        if (routeFromHash() === id && this.route === id) { this.mountView(); return; }
        if (routeFromHash() === id) { this.go(id); return; }
        // Add a history entry and switch page right away. The phone's back
        // gesture later fires hashchange, which brings us back through go().
        try { history.pushState(null, '', `#/${id}`); } catch { location.hash = `#/${id}`; return; }
        this.go(id);
      });
    },

    /** Switch page without rebuilding the frame around it. */
    go(id) {
      if (!this.routes[id]) id = 'dashboard';
      UI.closeAllLayers();
      const prev = this.stack[this.stack.length - 2];
      if (prev === id) this.stack.pop();
      else if (this.stack[this.stack.length - 1] !== id) this.stack.push(id);
      if (this.stack.length > 30) this.stack.splice(0, this.stack.length - 30);
      this.route = id;
      if (!document.querySelector('.app-shell')) { this.render(); return; }
      this.paintChrome();
      this.mountView();
      window.scrollTo(0, 0);
    },

    /** First screen after signing in (no extra history entry). */
    enter(id) {
      const r = id || routeFromHash();
      this.route = this.routes[r] ? r : 'dashboard';
      try { history.replaceState(null, '', `#/${this.route}`); } catch { /* sandboxed */ }
      this.stack = [this.route];
      this.render();
    },

    back() {
      if (this.stack.length > 1) history.back();
      else this.navigate('dashboard');
    },

    tabs() {
      const want = ['dashboard', this.can('delivery.create') ? 'intake' : 'deliveries', 'bays', 'payments'];
      return want.map((id) => NAV_ITEMS.find((i) => i.id === id)).filter((i) => i && this.can(i.perm));
    },
    isTabRoot(id) { return id === 'dashboard' || this.tabs().some((t) => t.id === id); },

    /* ----------------------------- render ---------------------------- */
    render() {
      const root = document.getElementById('app');
      const user = Auth.current();

      // 1. Subscription gate — only the owner can switch this on, and it
      //    never appears by itself (no date-based expiry anywhere).
      const sub = Store.subscription();
      if (user && sub.status === 'SUSPENDED' && !Auth.isSuper(user)) {
        root.innerHTML = this.suspendedScreen(sub);
        this.wireSuspended(root);
        return;
      }

      if (!user) { root.innerHTML = this.loginScreen(); this.wireLogin(root); return; }

      // 2. Signed in but the owner has not assigned a role yet.
      if (Auth.isPending(user)) { root.innerHTML = this.pendingScreen(); this.wirePending(root); return; }

      root.innerHTML = this.shell();
      this.paintChrome();
      this.paintSyncChip();
      this.mountView();
    },

    shell() {
      const user = Auth.current();
      const role = Auth.role();
      const nav = NAV.map((g) => {
        const items = g.items.filter((i) => this.can(i.perm));
        if (!items.length) return '';
        return `<div class="nav-group">
          <span class="nav-group-label">${esc(g.group)}</span>
          ${items.map((i) => `<button class="nav-item" data-nav="${i.id}" title="${esc(i.label)}">
            ${ico(i.icon, 'nav-ico')}<span class="nav-label">${esc(i.label)}</span><span class="nav-short">${esc(i.short)}</span>
          </button>`).join('')}
        </div>`;
      }).join('');

      const tabs = this.tabs().map((t) => `<button class="tab" data-nav="${t.id}">
          ${ico(t.icon)}<span>${esc(t.short)}</span></button>`).join('');

      const announcement = (Store.data.config.remote || {}).announcement;
      const initial = esc((user.name || user.email).slice(0, 1).toUpperCase());

      return `
      <div class="app-shell">
        <aside class="sidebar" id="sidebar">
          <div class="brand">
            <img class="brand-logo" src="assets/enerfab-logo.png" alt="EnerFab" />
            <div class="brand-text">
              <strong>EnerFab</strong>
              <span>Biomass Storage</span>
            </div>
          </div>
          <nav class="nav" aria-label="Main">${nav}</nav>
          <div class="sidebar-foot">
            <div class="version">v${esc(CFG.version)}</div>
          </div>
        </aside>

        <div class="main">
          <header class="topbar">
            <button class="icon-btn back-btn" id="back-btn" aria-label="Back" hidden>${ico('back')}</button>
            <img class="topbar-logo" src="assets/enerfab-logo.png" alt="" />
            <div class="topbar-title">
              <h1 id="page-title"></h1>
              <span class="crumb">${esc(Store.settings().siteName)} · ${esc(Store.settings().siteLocation)}</span>
            </div>
            <div class="topbar-actions">
              <button class="sync-chip" id="sync-chip" title="Cloud sync status">
                <span class="sync-dot"></span><span class="sync-text">…</span>
              </button>
              <div class="user-menu">
                <button class="user-btn" id="user-btn" aria-haspopup="menu" aria-label="Account">
                  <span class="avatar">${initial}</span>
                  <span class="user-meta">
                    <strong>${esc(user.name || user.email)}</strong>
                    <small>${esc(D.ROLE_LABEL[role] || role)}</small>
                  </span>
                </button>
                <div class="dropdown" id="user-dropdown" role="menu" hidden>
                  <div class="dropdown-head">${esc(user.email)}</div>
                  <button data-menu="settings">${ico('settings')} Settings</button>
                  <button data-menu="backup">${ico('download')} Backup data</button>
                  <button data-menu="logout" class="danger-text">${ico('logout')} Sign out</button>
                </div>
              </div>
            </div>
          </header>

          ${announcement ? `<div class="banner banner-info"><span>${esc(announcement)}</span></div>` : ''}
          ${user.mode === 'preview' ? `<div class="banner banner-warn">
            <span><b>Demo session.</b> You are viewing the system as an Administrator with sample records. Nothing here reaches the live database.</span></div>` : ''}
          ${Store.persistence === 'memory' ? `<div class="banner banner-warn">
            <span><b>Limited storage:</b> this window cannot save to the device, so changes last only until it is closed.</span></div>` : ''}
          <main id="view" class="view" tabindex="-1"></main>
          <footer class="app-foot">
            <span>EnerFab (Pvt) Ltd · Green Engineering</span>
            <span>Works offline · syncs automatically when online</span>
          </footer>
        </div>

        <nav class="tabbar" aria-label="Main">
          ${tabs}
          <button class="tab" id="more-btn" aria-label="More">${ico('grid')}<span>More</span></button>
        </nav>
      </div>`;
    },

    /** Title, active states and back button for the current page. */
    paintChrome() {
      const def = this.routes[this.route] || {};
      const title = def.title || 'Dashboard';
      const h = document.getElementById('page-title');
      if (h) h.textContent = title;
      document.title = `${title} · EnerFab Biomass`;
      UI.$$('[data-nav]').forEach((b) => {
        const on = b.dataset.nav === this.route;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      const more = document.getElementById('more-btn');
      if (more) more.classList.toggle('active', !this.tabs().some((t) => t.id === this.route));
      const back = document.getElementById('back-btn');
      const root = this.isTabRoot(this.route);
      if (back) back.hidden = root;
      const bar = document.querySelector('.topbar');
      if (bar) bar.classList.toggle('is-root', root);
    },

    mountView() {
      const view = document.getElementById('view');
      if (!view) return;
      const def = this.routes[this.route] || this.routes.dashboard;
      if (!def) { view.innerHTML = UI.empty('Nothing here yet'); return; }
      if (def.perm && !Auth.can(def.perm)) {
        view.innerHTML = UI.empty('Not available for your role', 'Ask an administrator if you need access to this section.');
        return;
      }
      view.innerHTML = '';
      view.classList.remove('view-enter');
      void view.offsetWidth;
      view.classList.add('view-enter');
      try {
        def.render(view, this);
        const after = this._afterMount; this._afterMount = null;
        if (after) setTimeout(after, 0);
      } catch (err) {
        console.error(err);
        view.innerHTML = `<div class="banner banner-danger">Something went wrong drawing this page: ${esc(err.message)}</div>`;
      }
    },

    /** Re-render the current page (cheap, all views are pure renders). */
    refresh() {
      this.paintSyncChip();
      this.mountView();
    },

    paintSyncChip() {
      const chip = document.getElementById('sync-chip');
      const sub = Store.subscription();
      if (sub.status === 'SUSPENDED' && !Auth.isSuper(Auth.current())) { this.render(); return; }
      if (!chip) return;
      const s = Sync.state;
      chip.dataset.phase = s.phase;
      const pending = (Store.data.outbox || []).length;
      const isDemo = (Auth.current() || {}).mode === 'preview';
      chip.querySelector('.sync-text').textContent = isDemo ? 'Demo data' : (pending ? `${pending} pending` : Sync.label());
      chip.title = isDemo ? 'Demo session — sample records are not sent to the live database' : [Sync.label(), s.lastSyncAt ? `Last sync ${D.dt(s.lastSyncAt)}` : 'Not synced yet', s.lastError || ''].filter(Boolean).join(' · ');
    },

    /* ---------------------------- sign in ---------------------------- */
    loginScreen() {
      return `
      <div class="auth-wrap">
        <div class="auth-card nm-card">
          <div class="auth-brand">
            <img src="assets/enerfab-logo.png" alt="" class="auth-logo" />
            <div>
              <h1>Biomass Storage</h1>
              <p class="muted">EnerFab (Pvt) Ltd · Green Engineering</p>
            </div>
          </div>

          <form id="login-form" class="auth-form" autocomplete="on">
            <div class="form-errors" role="alert"></div>
            ${CFG.allowGoogleSignIn ? `<button type="button" class="nm-btn google block" id="google-btn">
              <svg class="g-icon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12c-.2 2-1.5 5-4.4 7l6.7 5.2c4-3.7 6.8-9.1 6.8-15.8z"/><path fill="#34A853" d="M24 46c5.7 0 10.5-1.9 14-5.1l-6.7-5.2c-1.8 1.3-4.3 2.2-7.3 2.2-5.6 0-10.4-3.7-12.1-8.8l-7 5.4C8.3 41 15.5 46 24 46z"/><path fill="#FBBC05" d="M11.9 29.1c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1l-7-5.4C3.4 18.3 2.6 21 2.6 24s.8 5.7 2.3 8.5l7-5.4z"/><path fill="#EA4335" d="M24 10.2c3.2 0 5.9 1.1 8.1 3.2l6-6C34.5 3.9 29.7 2 24 2 15.5 2 8.3 7 4.9 14.5l7 5.4C13.6 13.9 18.4 10.2 24 10.2z"/></svg>
              <span>Continue with Google</span>
            </button>
            <div class="or-sep"><span>or use your email and password</span></div>` : ''}
            ${UI.field('Email', UI.input('email', { type: 'email', placeholder: 'name@efpl.org', autocomplete: 'username', required: true }))}
            ${UI.field('Password', `<div class="pw-wrap">
                ${UI.input('password', { type: 'password', placeholder: '••••••••', autocomplete: 'current-password', required: true })}
                <button type="button" class="pw-toggle" id="pw-toggle" aria-label="Show password"><i class="i i-eye"></i></button>
              </div>`)}
            <label class="check">
              <input type="checkbox" name="remember" checked />
              <span>Keep me signed in on this device (recommended for site tablets)</span>
            </label>
            <button class="nm-btn primary block" type="submit">Sign in</button>
            <div class="auth-links">
              <button type="button" class="link" id="forgot">Forgot password</button>
              <span class="dot-sep">·</span>
              ${CFG.allowSelfRegistration ? '<button type="button" class="link" id="create-account">Create an account</button>' : ''}
            </div>
            ${CFG.allowLocalPreview ? `<div class="preview-row">
              <button type="button" class="nm-btn block" id="preview-btn"><i class="i i-play"></i>Preview with demo data (no sign-in)</button>
              <p class="muted small">Opens the system as an Administrator with sample records. Nothing you change here is saved to the live database.</p>
            </div>` : ''}
          </form>
        </div>
        <p class="auth-foot">© EnerFab (Pvt) Ltd · No. 115/3 Rampart Road, Sri Jayawardanapura Kotte</p>
      </div>`;
    },

    wireLogin(root) {
      const form = root.querySelector('#login-form');
      const toggle = root.querySelector('#pw-toggle');
      if (toggle) toggle.addEventListener('click', () => {
        const pw = form.querySelector('[name=password]');
        pw.type = pw.type === 'password' ? 'text' : 'password';
      });
      root.querySelector('#forgot').addEventListener('click', async () => {
        const email = (form.querySelector('[name=email]').value || '').trim();
        if (!email) return UI.toast('Type your email first, then press Forgot password', 'warn');
        try {
          await Auth.resetPassword(email);
          UI.toast('Password reset email sent — check the inbox.', 'ok');
          UI.modal({
            title: 'Check your email',
            body: `<p>Firebase has sent a password reset link to <b>${esc(email)}</b>. Set a new password there, then come back and sign in.</p>
                   <p class="muted small">No connection? Ask the administrator to reset it from the Firebase console.</p>`,
          });
        } catch (e) {
          UI.toast(e.message || 'Could not send the reset email', 'danger');
        }
      });

      const googleBtn = root.querySelector('#google-btn');
      if (googleBtn) googleBtn.addEventListener('click', async () => {
        googleBtn.disabled = true;
        const label = googleBtn.querySelector('span');
        const original = label.textContent;
        label.textContent = 'Opening Google…';
        UI.showErrors(form, []);
        const res = await Auth.googleSignIn();
        googleBtn.disabled = false;
        label.textContent = original;
        if (!res.ok) { UI.showErrors(form, [res.error]); return; }
        UI.toast(Auth.isPending(res.user) ? 'Signed in — waiting for the owner to assign your role' : 'Welcome', Auth.isPending(res.user) ? 'warn' : 'ok', 5000);
        this.enter();
        if (!Auth.isPending()) Sync.start();
      });

      const createBtn = root.querySelector('#create-account');
      if (createBtn) createBtn.addEventListener('click', () => this.registerFlow());

      const previewBtn = root.querySelector('#preview-btn');
      if (previewBtn) previewBtn.addEventListener('click', () => {
        try {
          Auth.previewSignIn();
          UI.toast('Demo session — sample data only', 'warn', 5000);
          this.enter('dashboard');
        } catch (e) { UI.toast(e.message, 'danger'); }
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = UI.formData(form);
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Signing in…';
        UI.showErrors(form, []);
        const res = await Auth.login(data.email, data.password, { remember: data.remember !== false });
        btn.disabled = false;
        btn.textContent = 'Sign in';
        if (!res.ok) {
          UI.showErrors(form, [res.error]);
          UI.toast(res.offline ? 'No connection — used the offline profile check' : 'Sign-in failed', 'danger');
          return;
        }
        UI.toast(res.mode === 'offline' ? 'Signed in offline — changes will sync later' : 'Welcome back', 'ok');
        this.enter();
        Sync.start();
      });
    },

    /* ------------------------- awaiting approval --------------------- */
    pendingScreen() {
      const user = Auth.current();
      return `
      <div class="auth-wrap">
        <div class="auth-card nm-card pending">
          <img src="assets/enerfab-logo.png" alt="" class="auth-logo" />
          <h1>Waiting for approval</h1>
          <p>You are signed in as <b>${esc(user.email)}</b>, but your role has not been set yet.</p>
          <p class="muted small">The owner or an administrator gives you a role in
            <b>Administration → Users &amp; roles</b>. Until then you can see nothing and change nothing — this page will let you in as soon as the role appears.</p>
          <div class="row-actions" style="justify-content:center">
            <button class="nm-btn primary" id="pending-check">Check again</button>
            <button class="nm-btn" id="pending-signout">Sign out</button>
          </div>
          <p class="muted small" id="pending-status" style="margin-top:12px"></p>
        </div>
      </div>`;
    },

    wirePending(root) {
      const status = root.querySelector('#pending-status');
      const signOut = root.querySelector('#pending-signout');
      if (signOut) signOut.addEventListener('click', () => { Auth.logout(); this.render(); });

      const check = async () => {
        if (status) status.textContent = 'Checking…';
        await Sync.now('pending-check');
        const user = Auth.current();
        if (user && !Auth.isPending(user)) {
          UI.toast('Your role has been set — welcome aboard', 'ok');
          this.render();
          Sync.start();
          return;
        }
        if (status) status.textContent = navigator.onLine
          ? `No change yet — last checked ${new Date().toLocaleTimeString()}`
          : 'Still offline; we will check as soon as there is a connection.';
      };
      const btn = root.querySelector('#pending-check');
      if (btn) btn.addEventListener('click', check);
      clearInterval(this._pendingTimer);
      this._pendingTimer = setInterval(check, 25000);
      if (navigator.onLine) check();
    },

    /** Self-service account creation (email + password), lands in "pending". */
    registerFlow() {
      UI.modal({
        title: 'Create a staff account',
        body: `<p class="muted">Your account is created instantly and waits for the owner to give it a role. Choose a password you have not used elsewhere — it will also let you sign in on this device with no signal.</p>
          <div class="form-errors" role="alert"></div>
          ${UI.field('Full name', UI.input('name', { placeholder: 'Nimal Silva' }))}
          ${UI.field('Work email', UI.input('email', { type: 'email', placeholder: 'name@efpl.org', autocomplete: 'username' }))}
          ${UI.field('Password', UI.input('password', { type: 'password', autocomplete: 'new-password', placeholder: 'at least 8 characters' }))}
          ${UI.field('Confirm password', UI.input('password2', { type: 'password', autocomplete: 'new-password' }))}`,
        footer: '<button class="nm-btn" data-close>Cancel</button><button class="nm-btn primary" data-act="create">Create account</button>',
        onMount(el, close) {
          el.querySelector('[data-act=create]').addEventListener('click', async () => {
            const f = UI.formData(el.querySelector('.modal-body'));
            const box = el.querySelector('.form-errors');
            const errors = [];
            if (!f.email) errors.push('Email is required');
            if (!f.password || f.password.length < 8) errors.push('Password must be at least 8 characters');
            if (f.password !== f.password2) errors.push('The two passwords do not match');
            if (errors.length) { box.classList.add('show'); box.innerHTML = `<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`; return; }
            const btn = el.querySelector('[data-act=create]');
            btn.disabled = true; btn.textContent = 'Creating…';
            const res = await Auth.registerAccount(f.email, f.password, f.name);
            btn.disabled = false; btn.textContent = 'Create account';
            if (!res.ok) { box.classList.add('show'); box.innerHTML = `<ul><li>${esc(res.error)}</li></ul>`; return; }
            close();
            UI.toast('Account created — waiting for the owner to approve it', 'warn', 6000);
            this.render();
          });
        },
      });
    },

    /* --------------------------- suspended --------------------------- */
    suspendedScreen(sub) {
      return `
      <div class="auth-wrap">
        <div class="auth-card nm-card suspended">
          <img src="assets/enerfab-logo.png" alt="" class="auth-logo" />
          <h1>Service paused</h1>
          <p>${esc(sub.message || 'This subscription has been paused by EnerFab management. Please contact your account manager to restore access.')}</p>
          ${sub.updatedAt ? `<p class="muted small">Paused ${esc(D.dt(sub.updatedAt))}${sub.updatedBy ? ` by ${esc(sub.updatedBy)}` : ''}</p>` : ''}
          <div class="divider"></div>
          <p class="muted small">Your data has not been deleted. Everything recorded on this device is intact and will be here when access resumes.</p>
          <button class="nm-btn block" id="susp-logout">Sign out</button>
        </div>
      </div>`;
    },

    wireSuspended(root) {
      const b = root.querySelector('#susp-logout');
      if (b) b.addEventListener('click', () => { Auth.logout(); this.render(); });
    },

    wireShell() {
      const root = document.getElementById('app');
      if (!root || !root.querySelector('.app-shell')) return;

      UI.$$('[data-nav]', root).forEach((b) => b.addEventListener('click', () => this.navigate(b.dataset.nav)));

      const back = document.getElementById('back-btn');
      if (back) back.addEventListener('click', () => this.back());

      const more = document.getElementById('more-btn');
      if (more) more.addEventListener('click', () => this.openMore());

      const userBtn = document.getElementById('user-btn');
      const dropdown = document.getElementById('user-dropdown');
      if (userBtn && dropdown) {
        userBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (PHONE()) { dropdown.hidden = true; this.openMore(); return; }
          dropdown.hidden = !dropdown.hidden;
        });
        UI.$$('[data-menu]', dropdown).forEach((b) => b.addEventListener('click', () => {
          dropdown.hidden = true;
          this.menuAction(b.dataset.menu);
        }));
      }

      const chip = document.getElementById('sync-chip');
      if (chip) chip.addEventListener('click', async () => {
        if ((Auth.current() || {}).mode === 'preview') { UI.toast('Demo session — sample records are not sent anywhere'); return; }
        UI.toast('Syncing…');
        await Sync.now('manual');
        const s = Sync.state;
        if (s.phase === 'blocked') UI.toast(s.lastError || 'Cloud access blocked', 'danger', 7000);
        else if (s.phase === 'offline') UI.toast('Still offline — everything is saved on this device', 'warn');
        else UI.toast('Sync complete', 'ok');
        this.refresh();
      });
    },

    menuAction(what) {
      if (what === 'logout') {
        UI.whenSettled(() => { Sync.stop(); Auth.logout(); this.render(); });
        return;
      }
      if (what === 'settings') { this.navigate('admin'); return; }
      if (what === 'backup') {
        UI.download(`enerfab-biomass-backup-${D.todayISO()}.json`, JSON.stringify(Store.exportJSON(), null, 2));
        UI.toast('Backup downloaded', 'ok');
      }
    },

    /** Phone "More" sheet: every section plus the account actions. */
    openMore() {
      const user = Auth.current();
      const role = Auth.role();
      const groups = NAV.map((g) => {
        const items = g.items.filter((i) => this.can(i.perm));
        if (!items.length) return '';
        return `<section class="more-group">
          <h4>${esc(g.group)}</h4>
          <div class="more-grid">${items.map((i) => `<button class="more-item ${i.id === this.route ? 'active' : ''}" data-go="${i.id}">
            <span class="more-ico">${ico(i.icon)}</span><span>${esc(i.label)}</span></button>`).join('')}</div>
        </section>`;
      }).join('');
      UI.modal({
        title: 'Menu',
        size: 'sheet',
        body: `
          <div class="more-account">
            <span class="avatar lg">${esc((user.name || user.email).slice(0, 1).toUpperCase())}</span>
            <div><strong>${esc(user.name || user.email)}</strong><small>${esc(D.ROLE_LABEL[role] || role)} · ${esc(user.email)}</small></div>
          </div>
          ${groups}
          <div class="more-actions">
            <button class="nm-btn block" data-act="backup">${ico('download')} Backup data</button>
            <button class="nm-btn block danger-ghost" data-act="logout">${ico('logout')} Sign out</button>
          </div>`,
        onMount: (el, close) => {
          UI.$$('[data-go]', el).forEach((b) => b.addEventListener('click', () => { close(); this.navigate(b.dataset.go); }));
          UI.$$('[data-act]', el).forEach((b) => b.addEventListener('click', () => { close(); this.menuAction(b.dataset.act); }));
        },
      });
    },
  };

  window.App = App;

  // One document-level listener closes the account dropdown on any outside tap.
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('user-dropdown');
    if (dd && !dd.hidden && !e.target.closest('.user-menu')) dd.hidden = true;
  });

  // Re-wire shell controls after every render.
  const _render = App.render.bind(App);
  App.render = function () {
    _render();
    App.wireShell();
  };
})();
