#!/usr/bin/env node
'use strict';

/**
 * Seed the local database for testing the full app.
 *
 *   node scripts/seed.js            clear + insert the 44-respondent real sample
 *   node scripts/seed.js --reset    clear all responses (no insert)
 *   node scripts/seed.js --append   insert the sample without clearing first
 *
 * The sample reproduces the client's real Excel distributions (headline 84.4%).
 */

const db = require('../server/db');
const { generate } = require('./lib/sample-generator');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const append = args.includes('--append');

if (!append) {
  db.clearResponses();
  console.log('Cleared existing responses.');
}

if (reset) {
  console.log('Reset complete.');
  process.exit(0);
}

const { responses } = generate();

const stmt = db.db.prepare(`
  INSERT INTO responses
    (submitted_at, answers_json, comment, department, length_of_service, age_band, gender)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.db.exec('BEGIN');
try {
  for (const r of responses) {
    stmt.run(
      r.submitted_at,
      JSON.stringify(r.answers),
      r.comment,
      r.department,
      r.length_of_service,
      r.age_band,
      r.gender
    );
  }
  db.db.exec('COMMIT');
} catch (e) {
  db.db.exec('ROLLBACK');
  throw e;
}
db.setSurveyStatus('open');

console.log(`Seeded ${responses.length} responses. Survey status: open.`);
console.log('Start the app with:  npm start   then open http://localhost:3000/admin');
