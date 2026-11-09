/* =====================================================================
   auth.js — sign-in, roles, and staying signed in.
   ---------------------------------------------------------------------
   Design notes
   * Firebase Authentication (email + password) is the identity provider
     when a connection exists; the ID token is what the Realtime Database
     rules check.
   * The session is stored locally with a long "remember this device"
     window (90 days, sliding) so a supervisor on the yard does not have
     to type a password every time the tablet sleeps. This is the
     "offline first, sign in once" requirement.
   * A PBKDF2-SHA256 hash of the last good password is cached per user so
     that a *cold start with no signal at all* can still sign that person
     in. It is only ever created after a real Firebase sign-in succeeds.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG;
  const Store = window.Store;
  const FB = window.FB;

  const CRED_KEY = 'efpl.offlinecred.v1';
  const ATTEMPT_KEY = 'efpl.loginattempts.v1';
  const PBKDF2_ITER = 210000;

  const isSuperEmail = (email) =>
    (CFG.superAdminEmails || []).map((e) => e.toLowerCase()).includes(String(email || '').toLowerCase());

  /* ----------------------------- crypto ------------------------------ */
  const subtle = (window.crypto && window.crypto.subtle) || null;

  function b64(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  }
  function unb64(s) {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  }

  async function pbkdf2(password, saltB64) {
    if (!subtle) throw new Error('This browser cannot hash passwords (no WebCrypto).');
    const enc = new TextEncoder();
    const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: unb64(saltB64), iterations: PBKDF2_ITER, hash: 'SHA-256' },
      key, 256,
    );
    return b64(bits);
  }

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
  }

  /* -------------------------- rate limiting -------------------------- */
  function attemptState(email) {
    const all = readJSON(ATTEMPT_KEY, {});
    const rec = all[String(email || '').toLowerCase()] || { fails: 0, lockedUntil: 0 };
    return rec;
  }
  function noteFailure(email) {
    const all = readJSON(ATTEMPT_KEY, {});
    const k = String(email || '').toLowerCase();
    const rec = all[k] || { fails: 0, lockedUntil: 0 };
    rec.fails += 1;
    if (rec.fails >= 5) {
      rec.lockedUntil = Date.now() + Math.min(15 * 60 * 1000, 30 * 1000 * Math.pow(2, rec.fails - 5));
    }
    rec.lastAt = Date.now();
    all[k] = rec;
    writeJSON(ATTEMPT_KEY, all);
    return rec;
  }
  function clearFailures(email) {
    const all = readJSON(ATTEMPT_KEY, {});
    delete all[String(email || '').toLowerCase()];
    writeJSON(ATTEMPT_KEY, all);
  }

  /* ------------------------------ state ------------------------------ */
  let session = null;
  let refreshTimer = null;
  const listeners = new Set();
  const emit = (e) => { for (const fn of listeners) { try { fn(e); } catch (err) { console.error(err); } } };

  const Auth = {
    /* --------------------------------------------------------------- */
    init() {
      // The owner account always exists locally, even on a brand-new device.
      for (const email of CFG.superAdminEmails) {
        const existing = Store.all('users').find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
        if (!existing) {
          Store.add('users', {
            email: email.toLowerCase(),
            name: 'W. V. K. Kalhara',
            role: 'super_admin',
            active: true,
            bootstrapped: true,
            createdAt: new Date().toISOString(),
          }, 'bootstrap');
        } else if (existing.role !== 'super_admin') {
          existing.role = 'super_admin';
          existing.active = true;
          Store.save('bootstrap-role');
        }
      }
      const saved = readJSON(CFG.sessionKey, null);
      if (saved && saved.email) {
        if (!saved.rememberUntil || Date.now() < new Date(saved.rememberUntil).getTime()) {
          session = saved;
        } else {
          try { localStorage.removeItem(CFG.sessionKey); } catch { /* ignore */ }
        }
      }
      return session;
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    current() { return session; },
    user() { return session; },
    isSuper(user) { return !!user && (user.role === 'super_admin' || isSuperEmail(user.email)); },

    /** Resolve a person's role from the local register, falling back safely. */
    roleOf(user) {
      if (!user) return null;
      if (Auth.isSuper(user)) return 'super_admin';
      const p = Store.all('users').find((u) => (u.email || '').toLowerCase() === String(user.email || '').toLowerCase());
      return (p && p.role) || user.role || 'pending';
    },

    /** Signed in, but the owner has not assigned a role yet. */
    isPending(user) {
      const u = user || session;
      if (!u) return false;
      const r = Auth.roleOf(u);
      return !r || r === 'pending';
    },

    /** The local profile record for the signed-in person. */
    profile() {
      if (!session) return null;
      return Store.all('users').find((u) => u.email.toLowerCase() === String(session.email).toLowerCase()) || null;
    },

    role() { return Auth.roleOf(session) || 'pending'; },

    can(permission) {
      if (!session) return false;
      return window.Domain.can({ role: Auth.role() }, permission);
    },

    /* ---------------------------- sign in --------------------------- */
    /**
     * @returns {Promise<{ok:boolean, mode?:string, error?:string, needsFirstLogin?:boolean}>}
     */
    async login(emailRaw, password, opts = {}) {
      const email = String(emailRaw || '').trim().toLowerCase();
      const remember = opts.remember !== false;
      const att = attemptState(email);
      if (att.lockedUntil && Date.now() < att.lockedUntil) {
        const secs = Math.ceil((att.lockedUntil - Date.now()) / 1000);
        return { ok: false, error: `Too many failed attempts. Try again in ${secs}s.` };
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
      if (!password || String(password).length < 6) return { ok: false, error: 'Enter your password (at least 6 characters).' };

      /* 1. Try the cloud first. */
      try {
        const tok = await FB.signInWithPassword(email, password);
        clearFailures(email);
        await cacheOfflineCredential(email, password);
        return await Auth._establish(tok, { remember, mode: 'online' });
      } catch (err) {
        if (err.code === 'NETWORK') {
          /* 2. No signal — fall back to the cached password hash. */
          const offline = await tryOffline(email, password);
          if (offline.ok) return await Auth._establish(offline.tok, { remember, mode: 'offline' });
          return {
            ok: false,
            offline: true,
            error: offline.reason || 'No connection, and this device has no offline profile for that account yet. The first sign-in needs a signal once.',
          };
        }
        noteFailure(email);
        return { ok: false, error: err.message || 'Sign-in failed.' };
      }
    },

    async _establish(tok, { remember, mode }) {
      const localUsers = Store.all('users');
      let profile = localUsers.find((u) => u.email.toLowerCase() === String(tok.email || '').toLowerCase());

      // Pull the authoritative role from the database when possible.
      let cloudProfile = null;
      if (tok.idToken && tok.uid) {
        try {
          cloudProfile = await FB.get(`users/${tok.uid}`, tok.idToken);
        } catch { /* rules may not allow yet — the local role stands */ }
      }

      const role = isSuperEmail(tok.email)
        ? 'super_admin'
        : (cloudProfile && cloudProfile.role) || (profile && profile.role) || 'pending';

      if (!profile) {
        profile = Store.add('users', {
          email: String(tok.email || '').toLowerCase(),
          name: (cloudProfile && cloudProfile.name) || (tok.email || '').split('@')[0],
          role,
          active: true,
          uid: tok.uid || null,
          pendingSince: role === 'pending' ? new Date().toISOString() : null,
          firstLoginAt: new Date().toISOString(),
        }, 'signup');
      } else {
        profile.role = role;
        profile.uid = tok.uid || profile.uid;
        profile.lastLoginAt = new Date().toISOString();
        Store.save('login');
      }

      if (profile.active === false) {
        return { ok: false, error: 'This account has been disabled. Ask the administrator.' };
      }

      const days = Number(CFG.sessionDays) || 90;
      session = {
        provider: mode === 'google' ? 'google' : (tok.refreshToken ? 'password' : 'offline'),
        uid: tok.uid || profile.id,
        email: profile.email,
        name: profile.name,
        role,
        mode,
        idToken: tok.idToken || null,
        refreshToken: tok.refreshToken || null,
        tokenExpiresAt: tok.expiresAt || 0,
        signedInAt: new Date().toISOString(),
        rememberUntil: remember ? new Date(Date.now() + days * 864e5).toISOString() : null,
      };
      persistSession();
      Auth.startTokenRefresh();
      emit({ type: 'signed-in', mode });
      return { ok: true, mode, user: session };
    },

    async _tokenRefresh() {
      if (session && (session.provider === 'google' || session.mode === 'google') && !session.refreshToken) {
        return refreshViaGoogleSdk();
      }
      if (!session || !session.refreshToken) return null;
      try {
        const tok = await FB.refresh(session.idToken || '', session.refreshToken);
        session.idToken = tok.idToken;
        session.refreshToken = tok.refreshToken;
        session.tokenExpiresAt = tok.expiresAt;
        persistSession();
        return tok.idToken;
      } catch (err) {
        if (err.code === 'NETWORK') return session.idToken; // keep using the old one offline
        emit({ type: 'token-expired' });
        return null;
      }
    },

    /** Always returns a usable ID token (refreshing when it is about to die). */
    async idToken() {
      if (!session) return null;
      if (session.idToken && Date.now() < (session.tokenExpiresAt || 0) - 60_000) return session.idToken;
      if (!navigator.onLine) return session.idToken || null;
      return (await Auth._tokenRefresh()) || session.idToken || null;
    },

    startTokenRefresh() {
      clearInterval(refreshTimer);
      refreshTimer = setInterval(async () => {
        if (!session) return;
        // Slide the "remember me" window while the person is actively using the app.
        if (session.rememberUntil) {
          const days = Number(CFG.sessionDays) || 90;
          session.rememberUntil = new Date(Date.now() + days * 864e5).toISOString();
          persistSession();
        }
        if (document.visibilityState === 'visible' && navigator.onLine) await Auth._tokenRefresh();
      }, 25 * 60 * 1000);
    },

    logout(reason) {
      clearInterval(refreshTimer);
      session = null;
      try { localStorage.removeItem(CFG.sessionKey); } catch { /* ignore */ }
      emit({ type: 'signed-out', reason });
    },

    /** Re-read the stored session after an app reload. */
    restore() {
      const saved = readJSON(CFG.sessionKey, null);
      if (!saved) return null;
      if (saved.rememberUntil && Date.now() > new Date(saved.rememberUntil).getTime()) return null;
      session = saved;
      Auth.startTokenRefresh();
      return session;
    },

    /**
     * Sign in with a Google account (enabled on the efpl-2feb8 project).
     * The Firebase SDK is loaded from Google's CDN *only* when this button is
     * pressed — the rest of the app stays self-hosted and offline-capable.
     * A first-time Google account lands in the "pending" role and the owner
     * approves it in Administration; nobody is created by hand.
     */
    async googleSignIn(opts = {}) {
      if (!CFG.allowGoogleSignIn) return { ok: false, error: 'Google sign-in is switched off in config.js' };
      if (navigator.onLine === false) {
        return { ok: false, error: 'Google sign-in needs a connection. If you have signed in on this device before, use your password instead.' };
      }
      let sdk;
      try {
        sdk = await loadGoogleSdk();
      } catch (e) {
        return { ok: false, error: 'Could not load the Google sign-in library. Check the connection and try again.' };
      }
      try {
        const { authMod, auth } = sdk;
        await authMod.setPersistence(auth, authMod.browserLocalPersistence);
        const provider = new authMod.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const cred = await authMod.signInWithPopup(auth, provider);
        const idToken = await cred.user.getIdToken();
        const tok = {
          uid: cred.user.uid,
          idToken,
          refreshToken: null,
          email: cred.user.email,
          expiresAt: Date.now() + 3300 * 1000,
        };
        return await Auth._establish(tok, { remember: opts.remember !== false, mode: 'google' });
      } catch (err) {
        const code = (err && err.code) || '';
        const map = {
          'auth/popup-closed-by-user': 'Sign-in was cancelled.',
          'auth/cancelled-popup-request': 'Sign-in was cancelled.',
          'auth/popup-blocked': 'The browser blocked the Google window — allow pop-ups for this site and try again.',
          'auth/unauthorized-domain': 'This web address is not in Firebase → Authentication → Settings → Authorized domains.',
          'auth/operation-not-allowed': 'Google sign-in is not enabled for this Firebase project.',
          'auth/network-request-failed': 'No connection to Google.',
          'auth/account-exists-with-different-credential': 'That email already has a password account. Sign in with the password instead.',
        };
        return { ok: false, error: map[code] || err.message || 'Google sign-in failed.' };
      }
    },

    /**
     * Create an email/password account without leaving the app. The new
     * account is signed in as "pending" — no permissions at all — so a
     * stranger who finds the URL can create nothing but a request to be
     * approved by the owner.
     */
    async registerAccount(emailRaw, password, name) {
      if (!CFG.allowSelfRegistration) return { ok: false, error: 'Self-registration is switched off — ask the owner to create your account.' };
      const email = String(emailRaw || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
      if (!password || String(password).length < 8) return { ok: false, error: 'Use a password of at least 8 characters.' };
      try {
        const tok = await FB.signUp(email, password);
        if (name) {
          const existing = Store.all('users').find((u) => (u.email || '').toLowerCase() === email);
          if (existing) Store.update('users', existing.id, { name }, 'signup-name');
        }
        await cacheOfflineCredential(email, password);
        return await Auth._establish(tok, { remember: true, mode: 'online' });
      } catch (err) {
        return { ok: false, error: err.code === 'NETWORK' ? 'No connection — creating an account needs the internet once.' : (err.message || 'Could not create the account.') };
      }
    },

    /**
     * Demonstration sign-in (as an Administrator). No network, no Firebase token:
     * used only when EFPL_CONFIG.allowLocalPreview is true (switch it off
     * for production) so the app can be shown on a device with no signal.
     */
    previewSignIn() {
      if (!CFG.allowLocalPreview) throw new Error('Preview sign-in is switched off');
      // The demo always opens as a normal Administrator — never as the owner —
      // so anyone shown the demo sees exactly what an admin would see.
      const profile = Store.all('users').find((u) => u.role === 'admin' && u.active !== false && !isSuperEmail(u.email));
      session = {
        uid: (profile && profile.uid) || 'preview-admin',
        email: (profile && profile.email) || 'admin.demo@efpl.org',
        name: (profile && profile.name) || 'Demo Administrator',
        role: 'admin',
        mode: 'preview',
        idToken: null,
        refreshToken: null,
        tokenExpiresAt: 0,
        signedInAt: new Date().toISOString(),
        rememberUntil: null,   // preview ends when the app is closed
      };
      persistSession();
      emit({ type: 'signed-in', mode: 'preview' });
      return session;
    },

    /* --------------------------- user admin ------------------------- */
    listUsers() { return Store.all('users').filter((u) => !u.deleted); },

    createUser({ email, name, role, active = true }) {
      if (!Auth.can('user.manage')) throw new Error('Not allowed');
      const clean = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('Invalid email');
      if (Store.all('users').some((u) => (u.email || '').toLowerCase() === clean)) throw new Error('That email already exists');
      if (isSuperEmail(clean)) throw new Error('The owner account is created automatically');
      const rec = Store.add('users', {
        email: clean, name: String(name || '').trim() || clean.split('@')[0],
        role: window.Domain.ROLES.includes(role) ? role : 'operator',
        active: active !== false, createdBy: session && session.email,
      }, 'user-create');
      return rec;
    },

    updateUser(id, patch) {
      if (!Auth.can('user.manage')) throw new Error('Not allowed');
      const target = Store.byId('users', id);
      if (!target) throw new Error('User not found');
      if (isSuperEmail(target.email) && patch.role && patch.role !== 'super_admin') {
        throw new Error('The owner account must stay Super Admin');
      }
      if (patch.role && !window.Domain.ROLES.includes(patch.role)) throw new Error('Unknown role');
      return Store.update('users', id, patch, 'user-update');
    },

    /* ----------------------- offline credential --------------------- */
    async cacheOfflineCredential(email, password) {
      if (!subtle) return;
      try {
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        const hash = await pbkdf2(password, salt);
        const all = readJSON(CRED_KEY, {});
        all[email] = { salt, hash, at: Date.now() };
        writeJSON(CRED_KEY, all);
      } catch (e) { console.warn('Could not cache offline credential', e); }
    },

    clearOfflineCredential(email) {
      const all = readJSON(CRED_KEY, {});
      delete all[String(email).toLowerCase()];
      writeJSON(CRED_KEY, all);
    },

    async resetPassword(email) {
      return FB.sendPasswordReset(String(email).trim().toLowerCase());
    },
  };

  async function tryOffline(email, password) {
    const all = readJSON(CRED_KEY, {});
    const rec = all[email];
    if (!rec) return { ok: false, reason: 'No offline profile on this device for that account. Connect once to sign in.' };
    try {
      const hash = await pbkdf2(password, rec.salt);
      if (hash !== rec.hash) { noteFailure(email); return { ok: false, reason: 'Email or password is incorrect (offline check).' }; }
      clearFailures(email);
      const profile = Store.all('users').find((u) => (u.email || '').toLowerCase() === email);
      if (profile && profile.active === false) return { ok: false, reason: 'This account has been disabled.' };
      return {
        ok: true,
        tok: {
          uid: (profile && profile.uid) || (profile && profile.id) || email,
          email,
          idToken: null,
          refreshToken: null,
          expiresAt: 0,
        },
      };
    } catch (e) {
      return { ok: false, reason: 'This browser cannot verify offline passwords.' };
    }
  }

  /* ---------------- Google sign-in SDK (lazy, network only) ------------- */
  let sdkPromise = null;

  function loadGoogleSdk() {
    if (sdkPromise) return sdkPromise;
    const v = CFG.googleSdkVersion || '10.12.2';
    sdkPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`),
    ]).then((mods) => {
      const [appMod, authMod] = mods;
      const app = appMod.getApps && appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(CFG.firebase);
      return { appMod, authMod, auth: authMod.getAuth(app) };
    }).catch((e) => {
      sdkPromise = null;
      throw e;
    });
    return sdkPromise;
  }

  /** A Google session has no refresh token on the client, so ask the SDK. */
  async function refreshViaGoogleSdk() {
    try {
      if (!navigator.onLine) return null;
      const { authMod, auth } = await loadGoogleSdk();
      const user = await new Promise((resolve) => {
        const unsub = authMod.onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
        setTimeout(() => resolve(null), 4000);
      });
      if (!user) return null;
      const idToken = await user.getIdToken(true);
      session.idToken = idToken;
      session.tokenExpiresAt = Date.now() + 3300 * 1000;
      persistSession();
      return idToken;
    } catch {
      return null;
    }
  }

  function persistSession() {
    if (!session) return;
    try { localStorage.setItem(CFG.sessionKey, JSON.stringify(session)); } catch { /* ignore */ }
  }

  window.Auth = Auth;
})();
