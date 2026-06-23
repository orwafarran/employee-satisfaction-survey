'use strict';

/**
 * Storage layer — a single relational store for survey responses.
 *
 * Uses Node's built-in SQLite (node:sqlite, stable in Node 22.5+/24+). This
 * keeps Phases 1–5 free of any external service or native build step. At
 * Phase 6 the same SQL shape ports to a managed database (e.g. Azure SQL /
 * PostgreSQL) — only this file changes.
 *
 * Anonymity (spec §3): we store the 35 ratings, an optional comment, and the
 * four demographic fields. We deliberately store NO name, NO email, NO IP.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { QUESTION_IDS, DEMOGRAPHIC_KEYS } = require('./survey');

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'survey.db');

// Ensure the data directory exists.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS responses (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_at       TEXT NOT NULL,
    answers_json       TEXT NOT NULL,      -- {"1":4,"2":3,...} the 35 ratings
    comment            TEXT,               -- nullable free text
    department         TEXT NOT NULL,
    length_of_service  TEXT NOT NULL,
    age_band           TEXT NOT NULL,
    gender             TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
`);

// --- Settings (survey status, headcount) ------------------------------------

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

// Seed default status once.
if (getSetting('survey_status') === null) {
  setSetting('survey_status', 'open');
}

function getSurveyStatus() {
  return getSetting('survey_status', 'open') === 'closed' ? 'closed' : 'open';
}

function setSurveyStatus(status) {
  const normalized = status === 'closed' ? 'closed' : 'open';
  setSetting('survey_status', normalized);
  return normalized;
}

// --- Survey config overrides (admin-added/removed questions, departments) ---
// Stored as one JSON blob in settings. Shape matches public/js/survey-config.js.

function getOverrides() {
  const raw = getSetting('survey_overrides', null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function saveOverrides(overrides) {
  setSetting('survey_overrides', JSON.stringify(overrides || {}));
  return overrides;
}

// --- Session secret ---------------------------------------------------------
// Generate a per-machine random session secret on first run and persist it, so
// the local app is secure out of the box with no configuration, and sessions
// survive restarts. (An explicit SESSION_SECRET env var still takes priority.)
function getOrCreateSessionSecret() {
  let secret = getSetting('session_secret', null);
  if (!secret) {
    secret = require('crypto').randomBytes(32).toString('hex');
    setSetting('session_secret', secret);
  }
  return secret;
}

// --- Responses --------------------------------------------------------------

const insertStmt = db.prepare(`
  INSERT INTO responses
    (submitted_at, answers_json, comment, department, length_of_service, age_band, gender)
  VALUES
    (?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Insert a validated response. `value` is the object returned by
 * survey.validateResponse().value.
 * @returns {object} the stored row (shaped for the API)
 */
function insertResponse(value) {
  const submittedAt = new Date().toISOString();
  const answersJson = JSON.stringify(value.answers);
  const info = insertStmt.run(
    submittedAt,
    answersJson,
    value.comment,
    value.department,
    value.length_of_service,
    value.age_band,
    value.gender
  );
  return getResponseById(Number(info.lastInsertRowid));
}

function rowToResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    submitted_at: row.submitted_at,
    answers: JSON.parse(row.answers_json),
    comment: row.comment,
    department: row.department,
    length_of_service: row.length_of_service,
    age_band: row.age_band,
    gender: row.gender,
  };
}

function getResponseById(id) {
  return rowToResponse(
    db.prepare('SELECT * FROM responses WHERE id = ?').get(id)
  );
}

function getAllResponses() {
  return db
    .prepare('SELECT * FROM responses ORDER BY id ASC')
    .all()
    .map(rowToResponse);
}

function countResponses() {
  return db.prepare('SELECT COUNT(*) AS n FROM responses').get().n;
}

function lastSubmittedAt() {
  const row = db
    .prepare('SELECT submitted_at FROM responses ORDER BY id DESC LIMIT 1')
    .get();
  return row ? row.submitted_at : null;
}

function clearResponses() {
  db.exec('DELETE FROM responses;');
  db.exec("DELETE FROM sqlite_sequence WHERE name='responses';");
}

module.exports = {
  db,
  DB_PATH,
  QUESTION_IDS,
  DEMOGRAPHIC_KEYS,
  // settings
  getSetting,
  setSetting,
  getSurveyStatus,
  setSurveyStatus,
  getOverrides,
  saveOverrides,
  getOrCreateSessionSecret,
  // responses
  insertResponse,
  getResponseById,
  getAllResponses,
  countResponses,
  lastSubmittedAt,
  clearResponses,
};
