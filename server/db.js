'use strict';

/**
 * Storage facade.
 *
 * Picks a driver at startup:
 *   • DATABASE_URL set   ->  PostgreSQL   (online / Azure deployment)
 *   • otherwise          ->  SQLite       (local PC / company server / dev)
 *
 * Drivers implement the same async primitives (settings + responses). The
 * derived helpers below (survey status, config overrides, session secret) are
 * built on those primitives, so they are identical across both databases.
 *
 * Anonymity (spec §3): we store the ratings, an optional comment, and the four
 * demographic fields. We deliberately store NO name, NO email, NO IP.
 */

const crypto = require('crypto');

const USE_POSTGRES = !!process.env.DATABASE_URL;
const driver = USE_POSTGRES ? require('./db/postgres') : require('./db/sqlite');

let _initialized = false;

/** Create tables and seed defaults. Call once before serving. */
async function init() {
  if (_initialized) return;
  await driver.init();
  if ((await driver.getSetting('survey_status', null)) === null) {
    await driver.setSetting('survey_status', 'open');
  }
  _initialized = true;
}

// --- Survey status ----------------------------------------------------------
async function getSurveyStatus() {
  return (await driver.getSetting('survey_status', 'open')) === 'closed' ? 'closed' : 'open';
}

async function setSurveyStatus(status) {
  const normalized = status === 'closed' ? 'closed' : 'open';
  await driver.setSetting('survey_status', normalized);
  return normalized;
}

// --- Survey config overrides (admin-added/removed questions, departments) ----
async function getOverrides() {
  const raw = await driver.getSetting('survey_overrides', null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function saveOverrides(overrides) {
  await driver.setSetting('survey_overrides', JSON.stringify(overrides || {}));
  return overrides;
}

// --- Session secret ---------------------------------------------------------
// Persisted so sessions survive restarts. An explicit SESSION_SECRET env var
// still takes priority (set in server.js).
async function getOrCreateSessionSecret() {
  let secret = await driver.getSetting('session_secret', null);
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await driver.setSetting('session_secret', secret);
  }
  return secret;
}

module.exports = {
  driver,
  label: driver.label,
  usingPostgres: USE_POSTGRES,
  init,
  // settings primitives (async)
  getSetting: driver.getSetting,
  setSetting: driver.setSetting,
  // derived helpers
  getSurveyStatus,
  setSurveyStatus,
  getOverrides,
  saveOverrides,
  getOrCreateSessionSecret,
  // responses
  insertResponse: driver.insertResponse,
  getAllResponses: driver.getAllResponses,
  countResponses: driver.countResponses,
  lastSubmittedAt: driver.lastSubmittedAt,
  clearResponses: driver.clearResponses,
  // rounds (archived survey periods)
  listRounds: driver.listRounds,
  insertRound: driver.insertRound,
  countRounds: driver.countRounds,
};
