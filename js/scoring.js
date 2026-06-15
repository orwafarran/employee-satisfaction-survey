/**
 * Scoring engine — turns raw responses into every number the dashboard shows.
 *
 * Runs in the browser (window.Scoring) and under Node (module.exports) so the
 * same math powers the dashboard, the exports, the seed script, and the tests.
 *
 * HEADLINE FORMULA — matches the client's original Excel exactly:
 *   overall satisfaction % = (Agree + Strongly Agree answers) / (respondents × 35)
 *   On the client's real data this is 1300 / 1540 = 84.4%  ("positive rate").
 *
 * Also surfaced (secondary, clearly labelled):
 *   • satisfaction index = ((mean answer − 1) / 3) × 100   (spec §1 formula)
 *   • average rating out of 4
 *   • positive rate of answered (ignores the ×35 grid denominator)
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.Scoring = mod;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const SCALE = [1, 2, 3, 4]; // SD, D, A, SA
  const SHORT = ['SD', 'D', 'A', 'SA'];
  const LABELS = ['Strongly Disagree', 'Disagree', 'Agree', 'Strongly Agree'];

  function emptyCounts() {
    return [0, 0, 0, 0];
  }

  function statsFromCounts(counts) {
    const total = counts.reduce((a, b) => a + b, 0);
    const positive = counts[2] + counts[3];
    const sumValues = counts[0] * 1 + counts[1] * 2 + counts[2] * 3 + counts[3] * 4;
    const mean = total ? sumValues / total : 0;
    return {
      counts,
      total,
      positive,
      negative: counts[0] + counts[1],
      positiveRate: total ? (positive / total) * 100 : 0,
      avgRating: mean, // out of 4
      satisfactionIndex: total ? ((mean - 1) / 3) * 100 : 0,
    };
  }

  function flatQuestions(content) {
    const out = [];
    content.themes.forEach((theme) => {
      theme.questions.forEach((q) => out.push({ ...q, themeId: theme.id, themeTitle: theme.title }));
    });
    return out;
  }

  /**
   * @param {Array} responses  array of response objects
   * @param {Object} content   parsed survey-content.json
   */
  function compute(responses, content) {
    const questions = flatQuestions(content);
    const NUM_Q = questions.length; // 35
    const respondents = responses.length;

    // --- Per question --------------------------------------------------------
    const perQuestionMap = {};
    questions.forEach((q) => {
      perQuestionMap[q.id] = emptyCounts();
    });
    responses.forEach((r) => {
      questions.forEach((q) => {
        const v = Number(r.answers[q.id] ?? r.answers[String(q.id)]);
        if (v >= 1 && v <= 4) perQuestionMap[q.id][v - 1] += 1;
      });
    });
    const perQuestion = questions.map((q) => ({
      id: q.id,
      text: q.text,
      themeId: q.themeId,
      themeTitle: q.themeTitle,
      ...statsFromCounts(perQuestionMap[q.id]),
    }));

    // --- Per theme (rolled up) ----------------------------------------------
    const perTheme = content.themes.map((theme) => {
      const counts = emptyCounts();
      theme.questions.forEach((q) => {
        const c = perQuestionMap[q.id];
        for (let i = 0; i < 4; i++) counts[i] += c[i];
      });
      const ids = theme.questions.map((q) => q.id);
      return {
        id: theme.id,
        title: theme.title,
        range: [Math.min(...ids), Math.max(...ids)],
        questionCount: theme.questions.length,
        ...statsFromCounts(counts),
      };
    });

    // --- Overall -------------------------------------------------------------
    const overallCounts = emptyCounts();
    perQuestion.forEach((q) => {
      for (let i = 0; i < 4; i++) overallCounts[i] += q.counts[i];
    });
    const base = statsFromCounts(overallCounts);
    const gridDenominator = respondents * NUM_Q; // 44 × 35 = 1540 on real data
    const overall = {
      respondents,
      questionCount: NUM_Q,
      counts: overallCounts,
      totalAnswers: base.total,
      positiveCount: base.positive,
      // Client's headline method:
      clientPositiveRate: gridDenominator ? (base.positive / gridDenominator) * 100 : 0,
      // Alternatives (secondary):
      positiveRateOfAnswered: base.positiveRate,
      satisfactionIndex: base.satisfactionIndex,
      avgRating: base.avgRating,
    };
    // The number shown big on the dashboard:
    overall.headline = overall.clientPositiveRate;

    // --- Demographics --------------------------------------------------------
    const demographics = {};
    content.demographics.forEach((d) => {
      const counts = {};
      d.options.forEach((opt) => (counts[opt] = 0));
      let total = 0;
      responses.forEach((r) => {
        const val = r[d.key];
        if (val != null && Object.prototype.hasOwnProperty.call(counts, val)) {
          counts[val] += 1;
          total += 1;
        }
      });
      demographics[d.key] = { key: d.key, label: d.label, options: d.options, counts, total };
    });

    return { respondents, overall, perTheme, perQuestion, demographics };
  }

  function fmtPct(n, digits = 1) {
    if (n == null || isNaN(n)) return '—';
    return n.toFixed(digits) + '%';
  }

  return {
    SCALE,
    SHORT,
    LABELS,
    compute,
    statsFromCounts,
    flatQuestions,
    fmtPct,
  };
});
