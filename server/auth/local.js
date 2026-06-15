'use strict';

/**
 * Local auth provider — a single admin account (username + scrypt-hashed
 * password). Credentials come from environment variables:
 *
 *   ADMIN_USERNAME        (default: "admin")
 *   ADMIN_PASSWORD_HASH   (preferred for production — a scrypt$... string)
 *   ADMIN_PASSWORD        (dev convenience — plain text, hashed on boot)
 *
 * If neither hash nor password is provided, a development default is used and
 * a loud warning is printed.
 */

const { hashPassword, verifyPassword } = require('./hash');

const DEV_DEFAULT_PASSWORD = 'survey-admin';

function buildLocalProvider() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  let passwordHash = process.env.ADMIN_PASSWORD_HASH || null;
  let usingDevDefault = false;

  if (!passwordHash) {
    if (process.env.ADMIN_PASSWORD) {
      passwordHash = hashPassword(process.env.ADMIN_PASSWORD);
    } else if (process.env.NODE_ENV === 'production') {
      // Never fall back to the public dev password in production.
      throw new Error(
        'Refusing to start: set ADMIN_PASSWORD_HASH (preferred) or ADMIN_PASSWORD in production.'
      );
    } else {
      passwordHash = hashPassword(DEV_DEFAULT_PASSWORD);
      usingDevDefault = true;
    }
  }

  if (usingDevDefault) {
    console.warn(
      '\n[auth] WARNING: no ADMIN_PASSWORD_HASH or ADMIN_PASSWORD set.\n' +
        `[auth] Using DEV default login  ->  username: "${username}"  password: "${DEV_DEFAULT_PASSWORD}"\n` +
        '[auth] Set a real password before any real use.\n'
    );
  }

  return {
    name: 'local',
    /** @returns {{ok: boolean, user?: object}} */
    verify(inputUsername, inputPassword) {
      const userOk = typeof inputUsername === 'string' && inputUsername === username;
      const passOk = verifyPassword(inputPassword || '', passwordHash);
      // Evaluate both regardless to avoid trivial username-timing oracle.
      if (userOk && passOk) {
        return { ok: true, user: { username, provider: 'local' } };
      }
      return { ok: false };
    },
    // Local provider has no SSO redirect.
    sso: null,
  };
}

module.exports = { buildLocalProvider };
