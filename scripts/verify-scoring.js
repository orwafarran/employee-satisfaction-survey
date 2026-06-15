#!/usr/bin/env node
'use strict';

/**
 * Verifies the scoring engine reproduces the client's real Excel numbers.
 * Run:  node scripts/verify-scoring.js
 */

const fs = require('fs');
const path = require('path');
const Scoring = require('../public/js/scoring');
const { generate } = require('./lib/sample-generator');

const content = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'survey-content.json'), 'utf8')
);

const { responses } = generate();
const s = Scoring.compute(responses, content);
const o = s.overall;

let pass = true;
function check(name, actual, expected, tol = 0.05) {
  const ok = Math.abs(actual - expected) <= tol;
  pass = pass && ok;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${actual.toFixed(2)} (expected ~${expected})`);
}

console.log('Scoring verification against client Excel\n');
check('Respondents', o.respondents, 44, 0);
check('Total answers (44×35)', o.totalAnswers, 1540, 0);
check('Positive answers (A+SA)', o.positiveCount, 1300, 0);
check('Overall satisfaction % (client headline)', o.headline, 84.42, 0.05);

console.log('\nPer-theme positive rates:');
s.perTheme.forEach((t) => {
  console.log(`  ${t.id.padEnd(4)} ${Scoring.fmtPct(t.positiveRate, 1).padStart(6)}  ${t.title}`);
});

console.log('\nDemographic totals (should each be 44):');
Object.values(s.demographics).forEach((d) => {
  console.log(`  ${d.label.padEnd(20)} ${d.total}`);
});

console.log('\n' + (pass ? '✅ ALL CHECKS PASSED' : '❌ CHECKS FAILED'));
process.exit(pass ? 0 : 1);
