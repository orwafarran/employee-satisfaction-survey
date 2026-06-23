'use strict';

/**
 * SQLite storage driver (Node's built-in node:sqlite).
 *
 * Used for local / offline runs (the run-on-a-PC and company-server setups).
 * Zero external service, no native build step. The interface is async so it is
 * interchangeable with the Postgres driver used on Azure.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'survey.db');

let _db = null;
function conn() {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new DatabaseSync(DB_PATH);
    // WAL is fine on a local disk. (This driver is never used on Azure's network
    // file share — Azure uses the Postgres driver — so WAL is safe here.)
    _db.exec('PRAGMA journal_mode = WAL;');
    _db.exec('PRAGMA foreign_keys = ON;');
  }
  return _db;
}

async function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS responses (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      submitted_at       TEXT NOT NULL,
      answers_json       TEXT NOT NULL,
      comment            TEXT,
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
}

async function getSetting(key, fallback = null) {
  const row = conn().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  conn()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));
}

function shape(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    submitted_at: row.submitted_at,
    answers: JSON.parse(row.answers_json),
    comment: row.comment,
    department: row.department,
    length_of_service: row.length_of_service,
    age_band: row.age_band,
    gender: row.gender,
  };
}

async function insertResponse(value) {
  const submittedAt = value.submitted_at || new Date().toISOString();
  const info = conn()
    .prepare(
      `INSERT INTO responses
         (submitted_at, answers_json, comment, department, length_of_service, age_band, gender)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      submittedAt,
      JSON.stringify(value.answers),
      value.comment ?? null, // node:sqlite rejects undefined; match pg's undefined→NULL
      value.department,
      value.length_of_service,
      value.age_band,
      value.gender
    );
  // Return the stored row via a real round-trip so the shape/types match the
  // Postgres driver's RETURNING * exactly.
  return shape(
    conn().prepare('SELECT * FROM responses WHERE id = ?').get(Number(info.lastInsertRowid))
  );
}

async function getAllResponses() {
  return conn().prepare('SELECT * FROM responses ORDER BY id ASC').all().map(shape);
}

async function countResponses() {
  return conn().prepare('SELECT COUNT(*) AS n FROM responses').get().n;
}

async function lastSubmittedAt() {
  const row = conn().prepare('SELECT submitted_at FROM responses ORDER BY id DESC LIMIT 1').get();
  return row ? row.submitted_at : null;
}

async function clearResponses() {
  conn().exec('DELETE FROM responses;');
  conn().exec("DELETE FROM sqlite_sequence WHERE name='responses';");
}

module.exports = {
  label: `SQLite (${DB_PATH})`,
  init,
  getSetting,
  setSetting,
  insertResponse,
  getAllResponses,
  countResponses,
  lastSubmittedAt,
  clearResponses,
};
