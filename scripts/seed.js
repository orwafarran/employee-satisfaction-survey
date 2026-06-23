#!/usr/bin/env node
'use strict';

/**
 * Seed the database for testing the full app.
 *
 *   node scripts/seed.js            clear + insert the 44-respondent real sample
 *   node scripts/seed.js --reset    clear all responses (no insert)
 *   node scripts/seed.js --append   insert the sample without clearing first
 *
 * Works against whichever database is configured (SQLite locally, or Postgres
 * if DATABASE_URL is set). The sample reproduces the client's real Excel
 * distributions (headline 84.4%).
 */

const db = require('../server/db');
const { generate } = require('./lib/sample-generator');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const append = args.includes('--append');

(async () => {
  await db.init();

  if (!append) {
    await db.clearResponses();
    console.log('Cleared existing responses.');
  }

  if (reset) {
    console.log('Reset complete.');
    process.exit(0);
  }

  const { responses } = generate();
  for (const r of responses) {
    await db.insertResponse({
      submitted_at: r.submitted_at,
      answers: r.answers,
      comment: r.comment,
      department: r.department,
      length_of_service: r.length_of_service,
      age_band: r.age_band,
      gender: r.gender,
    });
  }
  await db.setSurveyStatus('open');

  console.log(`Seeded ${responses.length} responses. Survey status: open.`);
  console.log('Start the app with:  npm start   then open http://localhost:3000/admin');
  process.exit(0);
})().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
