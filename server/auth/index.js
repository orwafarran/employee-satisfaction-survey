'use strict';

/**
 * Auth facade — selects a provider via AUTH_PROVIDER and exposes the pieces
 * the server needs: the active provider and a `requireAdmin` middleware.
 *
 * Adding a new provider = add a file and a case here. The session shape
 * ({ admin: { username, provider } }) is provider-independent.
 */

const { buildLocalProvider } = require('./local');
const { buildEntraProvider } = require('./entra');

function buildProvider() {
  const choice = (process.env.AUTH_PROVIDER || 'local').toLowerCase();
  switch (choice) {
    case 'entra':
      return buildEntraProvider();
    case 'local':
    default:
      return buildLocalProvider();
  }
}

const provider = buildProvider();

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required.' });
}

module.exports = { provider, requireAdmin };
