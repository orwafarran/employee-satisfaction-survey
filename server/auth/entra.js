'use strict';

/**
 * Microsoft Entra ID (Azure AD) SSO provider — PLUGGABLE SEAM for Phase 6.
 *
 * This is intentionally not wired by default. It documents exactly where the
 * client's tenant integration drops in, so swapping `AUTH_PROVIDER=entra`
 * later is a configuration change, not a rewrite. To complete it at Phase 6:
 *
 *   1. npm install @azure/msal-node
 *   2. Register an app in the client's Entra tenant; obtain:
 *        ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REDIRECT_URI
 *   3. Implement `sso.begin` (build the authorization URL + redirect) and
 *      `sso.callback` (exchange the code, validate the token, map to a user).
 *   4. Restrict to allowed admin groups/users as the client requires.
 *
 * The rest of the app (session handling, requireAdmin middleware, the dashboard)
 * already works against this interface — only the body below needs filling in.
 */

function buildEntraProvider() {
  const required = [
    'ENTRA_TENANT_ID',
    'ENTRA_CLIENT_ID',
    'ENTRA_CLIENT_SECRET',
    'ENTRA_REDIRECT_URI',
  ];
  const missing = required.filter((k) => !process.env[k]);

  return {
    name: 'entra',
    configured: missing.length === 0,
    missing,
    // Password verification is not used for SSO.
    verify() {
      return { ok: false, error: 'Entra provider uses SSO, not password login.' };
    },
    sso: {
      // GET /api/admin/sso/login -> redirect to Microsoft.
      begin() {
        throw new Error(
          'Entra SSO is a Phase 6 integration and is not configured. ' +
            'Missing: ' + (missing.join(', ') || '(none)') + '. See server/auth/entra.js.'
        );
      },
      // GET /api/admin/sso/callback -> exchange code, return { ok, user }.
      async callback() {
        throw new Error('Entra SSO callback not implemented (Phase 6).');
      },
    },
  };
}

module.exports = { buildEntraProvider };
