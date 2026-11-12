/* =====================================================================
   firebase.js — a very small Firebase client built on plain fetch.
   ---------------------------------------------------------------------
   We do not load the Firebase SDK: the app must start instantly on a
   site-office tablet with a weak connection, and every kilobyte of the
   SDK is a kilobyte that cannot be cached. These are the four endpoints
   the app actually needs (sign in, refresh, read, write) called directly.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.EFPL_CONFIG.firebase;
  const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';
  const SECURE_TOKEN = 'https://securetoken.googleapis.com/v1/token';

  class FBError extends Error {
    constructor(message, code, status) {
      super(message);
      this.name = 'FBError';
      this.code = code;
      this.status = status;
    }
  }

  const FRIENDLY = {
    EMAIL_NOT_FOUND: 'That email is not registered in the EnerFab project.',
    INVALID_PASSWORD: 'Wrong password. Please try again.',
    INVALID_LOGIN_CREDENTIALS: 'Email or password is incorrect.',
    INVALID_EMAIL: 'That email address is not valid.',
    USER_DISABLED: 'This account has been disabled by an administrator.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Wait a few minutes and try again.',
    OPERATION_NOT_ALLOWED: 'Email/password sign-in is switched off in the Firebase console.',
    MISSING_PASSWORD: 'Please enter your password.',
    WEAK_PASSWORD: 'Password is too weak — use at least 8 characters.',
    EMAIL_EXISTS: 'An account already exists with that email. Try signing in instead.',
    OPERATION_NOT_ALLOWED_: 'Email/password sign-in is switched off for this project.',
    NETWORK: 'No connection to Firebase — working offline.',
    PERMISSION_DENIED: 'The database rules do not allow this yet. Apply firebase.rules.json.',
    UNAUTHORIZED: 'Session expired — sign in again.',
  };

  async function request(url, options = {}, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
      if (!res.ok) {
        const fbCode = body && body.error && body.error.message
          ? String(body.error.message).replace(/^(EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|USER_DISABLED|TOO_MANY_ATTEMPTS_TRY_LATER)\s*:\s*/, (m, p) => { body.error.message = p; return ''; })
          : (res.status === 401 ? 'UNAUTHORIZED' : 'PERMISSION_DENIED');
        const code = (body && body.error && body.error.message) || (res.status === 401 ? 'UNAUTHORIZED' : 'PERMISSION_DENIED');
        throw new FBError(FRIENDLY[code] || `Firebase error (${res.status})`, code, res.status);
      }
      return body;
    } catch (e) {
      if (e instanceof FBError) throw e;
      if (e.name === 'AbortError' || e.name === 'TypeError') throw new FBError(FRIENDLY.NETWORK, 'NETWORK', 0);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const FB = {
    FBError,

    /* ------------------------- Authentication ------------------------ */
    async signInWithPassword(email, password) {
      const data = await request(
        `${IDENTITY}:signInWithPassword?key=${CFG.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        },
      );
      return {
        uid: data.localId,
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        email: data.email,
        expiresAt: Date.now() + (Number(data.expiresIn) || 3600) * 1000,
      };
    },

    async signUp(email, password) {
      const data = await request(
        `${IDENTITY}:signUp?key=${CFG.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        },
      );
      return {
        uid: data.localId,
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        email: data.email,
        expiresAt: Date.now() + (Number(data.expiresIn) || 3600) * 1000,
      };
    },

    async refresh(idToken, refreshToken) {
      const url = SECURE_TOKEN.includes('?') ? SECURE_TOKEN : `${SECURE_TOKEN}?key=${CFG.apiKey}`;
      const data = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      });
      return {
        uid: data.user_id,
        idToken: data.id_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      };
    },

    async sendPasswordReset(email) {
      return request(`${IDENTITY}:sendOobCode?key=${CFG.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      });
    },

    /* --------------------- Realtime Database (REST) ------------------ */
    url(path, authToken, query) {
      const base = CFG.databaseURL.replace(/\/$/, '');
      const clean = String(path).replace(/^\/+/, '');
      const qs = new URLSearchParams(query || {});
      if (authToken) qs.set('auth', authToken);
      const q = qs.toString();
      return `${base}/${clean}.json${q ? `?${q}` : ''}`;
    },

    async get(path, authToken, query) {
      return request(this.url(path, authToken, query), { method: 'GET', cache: 'no-store' });
    },

    async put(path, value, authToken) {
      return request(this.url(path, authToken), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    },

    async patch(path, value, authToken) {
      return request(this.url(path, authToken), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    },

    /* --------------------------- helpers ---------------------------- */
    friendly(code, fallback) { return FRIENDLY[code] || fallback || code; },

    /** Reachability probe — resolves fast and never throws. */
    async online() {
      try {
        await request(this.url('.json', null, { shallow: 'true', timeout: '2000' }), { method: 'GET', cache: 'no-store' }, 4000);
        return true;
      } catch { return navigator.onLine !== false; }
    },
  };

  window.FB = FB;
})();
