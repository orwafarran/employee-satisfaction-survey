'use strict';

/**
 * PostgreSQL storage driver (node-postgres / pg).
 *
 * Used for the online / Azure deployment: a managed Azure Database for
 * PostgreSQL. Selected automatically when DATABASE_URL is set. Same async
 * interface as the SQLite driver, so the rest of the app is unchanged.
 *
 * Azure Database for PostgreSQL requires TLS, so SSL is on (and the server
 * certificate is verified) by default. DATABASE_SSL options:
 *   • unset / "verify"  -> TLS + verify cert against the system CA bundle (Azure)
 *   • "no-verify"       -> TLS but skip cert verification (escape hatch)
 *   • "disable"         -> no TLS (plain local Postgres while testing)
 */

const { Pool } = require('pg');

function buildSsl() {
  const mode = process.env.DATABASE_SSL;
  if (mode === 'disable') return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  // Default: verify the server certificate. Azure's Postgres cert chains to a
  // well-known CA already in Node's trust store, so this validates cleanly.
  return { rejectUnauthorized: true };
}

const ssl = buildSsl();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: Number(process.env.PGPOOL_MAX) || 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id                 BIGSERIAL PRIMARY KEY,
      submitted_at       TEXT NOT NULL,
      answers_json       TEXT NOT NULL,
      comment            TEXT,
      department         TEXT NOT NULL,
      length_of_service  TEXT NOT NULL,
      age_band           TEXT NOT NULL,
      gender             TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    )
  `);
}

async function getSetting(key, fallback = null) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : fallback;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
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
  const { rows } = await pool.query(
    `INSERT INTO responses
       (submitted_at, answers_json, comment, department, length_of_service, age_band, gender)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      submittedAt,
      JSON.stringify(value.answers),
      value.comment,
      value.department,
      value.length_of_service,
      value.age_band,
      value.gender,
    ]
  );
  return shape(rows[0]);
}

async function getAllResponses() {
  const { rows } = await pool.query('SELECT * FROM responses ORDER BY id ASC');
  return rows.map(shape);
}

async function countResponses() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM responses');
  return rows[0].n;
}

async function lastSubmittedAt() {
  const { rows } = await pool.query('SELECT submitted_at FROM responses ORDER BY id DESC LIMIT 1');
  return rows.length ? rows[0].submitted_at : null;
}

async function clearResponses() {
  await pool.query('TRUNCATE responses RESTART IDENTITY');
}

module.exports = {
  label: 'PostgreSQL (Azure)',
  pool,
  init,
  getSetting,
  setSetting,
  insertResponse,
  getAllResponses,
  countResponses,
  lastSubmittedAt,
  clearResponses,
};
