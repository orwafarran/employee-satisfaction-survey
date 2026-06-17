'use strict';

/**
 * Survey definition loader + response validator.
 *
 * The base survey content lives in ONE place — public/survey-content.json — so
 * the browser form and the server validate against an identical definition.
 * Admin edits (added/removed questions, departments) are stored as an overrides
 * delta (see public/js/survey-config.js) and applied on top of the base to get
 * the EFFECTIVE survey. Validation always runs against the effective survey, so
 * a freshly added question is required and a removed one is rejected.
 */

const fs = require('fs');
const path = require('path');
const SurveyConfig = require('../public/js/survey-config.js');

const CONTENT_PATH = path.join(__dirname, '..', 'public', 'survey-content.json');

const baseSurvey = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));

// Base flat list of question ids (db.js re-exports these; per-request the
// effective list is recomputed from the current overrides).
const QUESTION_IDS = baseSurvey.themes.flatMap((t) => t.questions.map((q) => q.id));
const DEMOGRAPHIC_KEYS = baseSurvey.demographics.map((d) => d.key);

const COMMENT_MAX = 4000;

/** Effective survey content = base + admin overrides. */
function buildEffective(overrides) {
  return SurveyConfig.apply(baseSurvey, overrides);
}

/**
 * Validate a submitted response payload against the effective survey.
 * Default policy (spec §4): all ratings required, all demographics required,
 * comment optional.
 *
 * @param {object} payload
 * @param {object} [effective]  effective survey content (defaults to base)
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
function validateResponse(payload, effective) {
  const content = effective || baseSurvey;

  const questionIds = [];
  content.themes.forEach((t) => t.questions.forEach((q) => questionIds.push(Number(q.id))));
  const questionIdSet = new Set(questionIds);
  const scaleValues = new Set(content.scale.map((s) => s.value));
  const demographicKeys = content.demographics.map((d) => d.key);
  const demographicOptions = Object.fromEntries(
    content.demographics.map((d) => [d.key, new Set(d.options)])
  );

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
    for (const qid of questionIds) {
      const raw = answers[qid] ?? answers[String(qid)];
      const val = Number(raw);
      if (raw === undefined || raw === null || raw === '') {
        errors.push(`Question ${qid} is unanswered.`);
      } else if (!Number.isInteger(val) || !scaleValues.has(val)) {
        errors.push(`Question ${qid} has an invalid answer.`);
      } else {
        cleanAnswers[qid] = val;
      }
    }
    // Reject unknown question ids (defensive).
    for (const key of Object.keys(answers)) {
      if (!questionIdSet.has(Number(key))) {
        errors.push(`Unknown question "${key}".`);
      }
    }
  }

  // --- Demographics (all required) ------------------------------------------
  const demographics = {};
  for (const key of demographicKeys) {
    const val = payload[key];
    if (val === undefined || val === null || val === '') {
      errors.push(`Demographic "${key}" is required.`);
    } else if (!demographicOptions[key].has(val)) {
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
  survey: baseSurvey, // back-compat alias
  baseSurvey,
  buildEffective,
  SurveyConfig,
  QUESTION_IDS,
  DEMOGRAPHIC_KEYS,
  validateResponse,
};
