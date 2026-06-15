'use strict';

/**
 * Deterministic sample-data generator.
 *
 * Produces 44 anonymous respondents whose per-question answer distributions
 * EXACTLY reproduce the client's real Excel results, so the demo dashboard
 * shows the client's own numbers — including the headline 84.4% overall
 * satisfaction (1300 positive answers / (44 × 35) grid).
 *
 * Real per-question counts [SD, D, A, SA] are embedded below. Questions that
 * had fewer than 44 answers in the source are padded up to 44 with "Disagree"
 * so every respondent has all 35 answers (the live form requires all 35) while
 * keeping the positive total — and therefore the 84.4% headline — unchanged.
 *
 * Demographics: Gender and Length-of-Service use the real complete
 * distributions (39M/5F; 9/12/12/2/9). Department and Age were only partially
 * filled in the source spreadsheet, so they are completed with a plausible,
 * deterministic spread across all 44 respondents.
 *
 * Fully deterministic (seeded PRNG + fixed base date) so repeated builds are
 * byte-identical and don't churn git.
 */

// Real per-question counts: [Strongly Disagree, Disagree, Agree, Strongly Agree]
const REAL_COUNTS = [
  [0, 0, 24, 20], [0, 0, 20, 23], [0, 1, 15, 28], [0, 2, 14, 28], [0, 1, 11, 31],
  [0, 1, 17, 26], [1, 0, 17, 26], [0, 2, 18, 24], [2, 0, 12, 30], [1, 3, 23, 16],
  [4, 4, 19, 17], [7, 9, 17, 11], [1, 4, 23, 16], [1, 1, 16, 26], [3, 6, 18, 17],
  [0, 0, 15, 29], [1, 2, 15, 25], [0, 0, 12, 32], [0, 2, 14, 28], [0, 2, 15, 27],
  [0, 2, 18, 24], [0, 3, 16, 25], [0, 4, 19, 21], [1, 2, 17, 24], [0, 2, 14, 28],
  [16, 17, 7, 4], [19, 11, 7, 4], [5, 10, 20, 8], [7, 13, 16, 6], [5, 10, 16, 12],
  [14, 2, 16, 12], [5, 7, 16, 15], [3, 4, 21, 15], [1, 2, 17, 24], [0, 1, 12, 31],
];

const RESPONDENTS = 44;

// Complete demographic distributions for the 44 respondents.
const DEMO_DIST = {
  department: { Production: 10, 'QA/QC': 6, Planning: 4, Design: 8, Erection: 7, Maintenance: 5, 'Service & Control': 4 },
  length_of_service: { 'Less than a year': 9, '1-2 Years': 12, '3-5 Years': 12, '5-10 Years': 2, 'Above 10 Years': 9 },
  age_band: { '20-25': 3, '26-30': 11, '31-35': 8, '36-40': 8, 'Above 40': 14 },
  gender: { Male: 39, Female: 5 },
};

const COMMENTS = [
  'Great place to work. I appreciate the supportive team and my supervisor.',
  'Salary increments are slow and do not keep up with the workload. Please review the pay structure.',
  'We need more structured training opportunities, especially for new tools.',
  'Communication between departments could be improved.',
  'Proud to be part of the company. Management really listens.',
  'Transportation allowance is not enough for those of us living far from the site.',
  'More recognition for good work would boost morale.',
  'I would like clearer advancement opportunities and a career path.',
  'Medical insurance coverage should include dependents.',
  'Overall satisfied, but the workload during peak season is heavy.',
  'My supervisor is excellent and always available to help.',
  'Welfare activities are good — keep them going!',
];

// --- Seeded PRNG (mulberry32) ----------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Expand a {value: count} distribution into a flat array of `total` values.
function expand(dist, total) {
  const out = [];
  Object.entries(dist).forEach(([val, count]) => {
    for (let i = 0; i < count; i++) out.push(val);
  });
  while (out.length < total) out.push(Object.keys(dist)[0]); // safety pad
  return out.slice(0, total);
}

function generate(opts) {
  opts = opts || {};
  const rnd = mulberry32(opts.seed || 20260610);
  const baseDate = new Date('2026-06-10T09:00:00Z').getTime();

  // For each question, build a 44-length column of answer values matching the
  // real distribution (padding short questions with Disagree), then shuffle.
  const columns = REAL_COUNTS.map((counts, qi) => {
    const col = [];
    for (let lvl = 0; lvl < 4; lvl++) {
      for (let k = 0; k < counts[lvl]; k++) col.push(lvl + 1);
    }
    while (col.length < RESPONDENTS) col.push(2); // pad with Disagree
    return shuffle(col, mulberry32((opts.seed || 20260610) + qi * 101));
  });

  // Demographic columns (shuffled independently).
  const demoCols = {};
  Object.keys(DEMO_DIST).forEach((key, ki) => {
    demoCols[key] = shuffle(expand(DEMO_DIST[key], RESPONDENTS), mulberry32(777 + ki * 13));
  });

  // Assign comments to a deterministic subset of respondents.
  const commentSlots = shuffle(
    Array.from({ length: RESPONDENTS }, (_, i) => i),
    mulberry32(424242)
  ).slice(0, COMMENTS.length);
  const commentMap = {};
  commentSlots.forEach((respIdx, ci) => (commentMap[respIdx] = COMMENTS[ci]));

  const responses = [];
  for (let i = 0; i < RESPONDENTS; i++) {
    const answers = {};
    for (let q = 0; q < 35; q++) answers[q + 1] = columns[q][i];
    responses.push({
      id: i + 1,
      submitted_at: new Date(baseDate + i * 3.6e6 + Math.floor(rnd() * 1.8e6)).toISOString(),
      answers,
      comment: commentMap[i] || null,
      department: demoCols.department[i],
      length_of_service: demoCols.length_of_service[i],
      age_band: demoCols.age_band[i],
      gender: demoCols.gender[i],
    });
  }

  return { responses, headcount: 52, respondents: RESPONDENTS };
}

module.exports = { generate, REAL_COUNTS, RESPONDENTS, DEMO_DIST };
