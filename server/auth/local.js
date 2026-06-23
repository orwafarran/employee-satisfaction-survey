'use strict';

/**
 * Local auth provider — a single admin account, stored on THIS machine.
 *
 * For the non-technical, run-it-on-my-own-PC use case, credentials are NOT
 * configured by editing files. Instead, the first time the admin opens the
 * dashboard, they create their login (email + password) once — it is hashed
 * (scrypt) and saved in the local database. From then on they just sign in.
 *
 * Source of truth (in priority order):
 *   1. Database settings  admin_username / admin_password_hash  (first-run setup)
 *   2. Environment vars   ADMIN_USERNAME + ADMIN_PASSWORD_HASH | ADMIN_PASSWORD
 *      (optional — for advanced/cloud deployments that pre-seed credentials)
 *
 * If neither is present the provider reports isConfigured() === false and the
 * dashboard shows the one-time "create your admin account" screen.
 */

const db = require('../db');
const { hashPassword, verifyPassword } = require('./hash');

const KEY_USER = 'admin_username';
const KEY_HASH = 'admin_password_hash';

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
}

function buildLocalProvider() {
  const envUser = process.env.ADMIN_USERNAME || null;
  const envHash =
    process.env.ADMIN_PASSWORD_HASH ||
    (process.env.ADMIN_PASSWORD ? hashPassword(process.env.ADMIN_PASSWORD) : null);

  function creds() {
    return {
      user: db.getSetting(KEY_USER, null) || envUser,
      hash: db.getSetting(KEY_HASH, null) || envHash,
    };
  }

  return {
    name: 'local',

    /** Has an admin account been created yet? */
    isConfigured() {
      const c = creds();
      return Boolean(c.user && c.hash);
    },

    /**
     * One-time first-run account creation. Refused if already configured.
     * @returns {{ok:true, user:object} | {ok:false, error:string}}
     */
    setup(email, password) {
      if (this.isConfigured()) return { ok: false, error: 'already_configured' };
      const e = String(email || '').trim();
      const p = String(password || '');
      if (!looksLikeEmail(e)) return { ok: false, error: 'invalid_email' };
      if (p.length < 8) return { ok: false, error: 'weak_password' };
      db.setSetting(KEY_USER, e);
      db.setSetting(KEY_HASH, hashPassword(p));
      return { ok: true, user: { username: e, provider: 'local' } };
    },

    /** @returns {{ok: boolean, user?: object}} */
    verify(inputUsername, inputPassword) {
      const c = creds();
      if (!c.user || !c.hash) return { ok: false };
      const userOk =
        typeof inputUsername === 'string' &&
        inputUsername.trim().toLowerCase() === String(c.user).toLowerCase();
      const passOk = verifyPassword(inputPassword || '', c.hash);
      // Evaluate both regardless to avoid a trivial username-timing oracle.
      if (userOk && passOk) return { ok: true, user: { username: c.user, provider: 'local' } };
      return { ok: false };
    },

    // Local provider has no SSO redirect.
    sso: null,
  };
}

module.exports = { buildLocalProvider };
