'use strict';

/**
 * Survey definition loader + response validator.
 *
 * The survey content lives in ONE place — public/survey-content.json — so the
 * browser form and the server validate against an identical definition. This
 * module reads that file and exposes helpers used by the API routes.
 */

const fs = require('fs');
const path = require('path');

const CONTENT_PATH = path.join(__dirname, '..', 'public', 'survey-content.json');

const survey = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));

// Flat list of question ids, in order (1..35).
const QUESTION_IDS = survey.themes.flatMap((t) => t.questions.map((q) => q.id));
const QUESTION_ID_SET = new Set(QUESTION_IDS);
const SCALE_VALUES = new Set(survey.scale.map((s) => s.value));

// Allowed option values for each demographic field.
const DEMOGRAPHIC_OPTIONS = Object.fromEntries(
  survey.demographics.map((d) => [d.key, new Set(d.options)])
);
const DEMOGRAPHIC_KEYS = survey.demographics.map((d) => d.key);

const COMMENT_MAX = 4000;

/**
 * Validate a submitted response payload.
 * Default policy (per spec §4): all 35 ratings required, all demographics
 * required, comment optional.
 *
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
function validateResponse(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['Missing request body.'] };
  }

  // --- Ratings ---------------------------------------------------------------
  const answers = payload.answers;
  const cleanAnswers = {};
  if (!answers || typeof answers !== 'object') {
    errors.push('Missing "answers".');
  } else {
    for (const qid of QUESTION_IDS) {
      const raw = answers[qid] ?? answers[String(qid)];
      const val = Number(raw);
      if (raw === undefined || raw === null || raw === '') {
        errors.push(`Question ${qid} is unanswered.`);
      } else if (!Number.isInteger(val) || !SCALE_VALUES.has(val)) {
        errors.push(`Question ${qid} has an invalid answer.`);
      } else {
        cleanAnswers[qid] = val;
      }
    }
    // Reject unknown question ids (defensive).
    for (const key of Object.keys(answers)) {
      if (!QUESTION_ID_SET.has(Number(key))) {
        errors.push(`Unknown question "${key}".`);
      }
    }
  }

  // --- Demographics (all required) ------------------------------------------
  const demographics = {};
  for (const key of DEMOGRAPHIC_KEYS) {
    const val = payload[key];
    if (val === undefined || val === null || val === '') {
      errors.push(`Demographic "${key}" is required.`);
    } else if (!DEMOGRAPHIC_OPTIONS[key].has(val)) {
      errors.push(`Demographic "${key}" has an invalid value.`);
    } else {
      demographics[key] = val;
    }
  }

  // --- Comment (optional) ----------------------------------------------------
  let comment = payload.comment;
  if (comment === undefined || comment === null) {
    comment = null;
  } else if (typeof comment !== 'string') {
    errors.push('Comment must be text.');
  } else {
    comment = comment.trim();
    if (comment.length === 0) comment = null;
    else if (comment.length > COMMENT_MAX) {
      errors.push(`Comment must be ${COMMENT_MAX} characters or fewer.`);
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: { answers: cleanAnswers, comment, ...demographics },
  };
}

module.exports = {
  survey,
  QUESTION_IDS,
  DEMOGRAPHIC_KEYS,
  validateResponse,
};
