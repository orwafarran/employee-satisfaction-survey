'use strict';

/**
 * Local auth provider — a single admin account stored on THIS machine.
 *
 * Flow for the non-technical client:
 *   1. The app ships with a default login  ->  username "admin", password "admin".
 *   2. The admin signs in with that, opens Settings, and changes the username to
 *      their real (company / Microsoft) email and sets their own password.
 *   3. From then on, only the real email + password work; the default stops working.
 *
 * Source of truth (priority):
 *   1. Database settings  admin_username / admin_password_hash  (set in Settings)
 *   2. Environment vars   ADMIN_USERNAME + ADMIN_PASSWORD_HASH | ADMIN_PASSWORD
 *      (optional — advanced / cloud deployments)
 *   3. Built-in default   admin / admin
 */

const db = require('../db');
const { hashPassword, verifyPassword } = require('./hash');

const KEY_USER = 'admin_username';
const KEY_HASH = 'admin_password_hash';

const DEFAULT_USER = 'admin';
const DEFAULT_PASS = 'admin';

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
}

function buildLocalProvider() {
  const envUser = process.env.ADMIN_USERNAME || null;
  const envHash =
    process.env.ADMIN_PASSWORD_HASH ||
    (process.env.ADMIN_PASSWORD ? hashPassword(process.env.ADMIN_PASSWORD) : null);

  // Hash the built-in default once (scrypt is deliberately slow).
  const DEFAULT_HASH = hashPassword(DEFAULT_PASS);

  async function creds() {
    return {
      user: (await db.getSetting(KEY_USER, null)) || envUser || DEFAULT_USER,
      hash: (await db.getSetting(KEY_HASH, null)) || envHash || DEFAULT_HASH,
    };
  }

  return {
    name: 'local',

    /** Still on the built-in default login (admin/admin)? Used to nudge the
     *  admin to set a real one. */
    async isDefault() {
      return !(await db.getSetting(KEY_HASH, null)) && !envHash;
    },

    /**
     * Change the admin login (called from Settings, requires an active session).
     * @returns {Promise<{ok:true, user:object} | {ok:false, error:string}>}
     */
    async updateAccount(email, password) {
      const e = String(email || '').trim();
      const p = String(password || '');
      if (!looksLikeEmail(e)) return { ok: false, error: 'invalid_email' };
      if (p.length < 8) return { ok: false, error: 'weak_password' };
      await db.setSetting(KEY_USER, e);
      await db.setSetting(KEY_HASH, hashPassword(p));
      return { ok: true, user: { username: e, provider: 'local' } };
    },

    /** @returns {Promise<{ok: boolean, user?: object}>} */
    async verify(inputUsername, inputPassword) {
      const c = await creds();
      const userOk =
        typeof inputUsername === 'string' &&
        inputUsername.trim().toLowerCase() === String(c.user).toLowerCase();
      const passOk = verifyPassword(inputPassword || '', c.hash);
      // Evaluate both regardless to avoid a trivial username-timing oracle.
      if (userOk && passOk) return { ok: true, user: { username: c.user, provider: 'local' } };
      return { ok: false };
    },

    sso: null,
  };
}

module.exports = { buildLocalProvider };
