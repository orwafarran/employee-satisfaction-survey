/**
 * Survey configuration overlay — shared by the browser (form + admin) and the
 * Node server, so "add/remove question" and "add/remove department" behave
 * identically in the static demo and the full app.
 *
 * The base survey lives in survey-content.json. Admin edits are stored as a
 * small "overrides" delta that is applied on top of the base:
 *
 *   {
 *     customQuestions:    [ { id, themeId, text } ],  // admin-added questions
 *     removedQuestionIds: [ id, ... ],                // questions hidden/removed
 *     departments:        [ "..." ] | null            // full managed list, or null = use base
 *   }
 *
 * apply(base, overrides) returns a NEW effective content object (base is never
 * mutated). Question ids are unique and monotonic so historical responses keep
 * pointing at the right question.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.SurveyConfig = mod;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function normalize(o) {
    o = o || {};
    return {
      customQuestions: Array.isArray(o.customQuestions)
        ? o.customQuestions
            .filter((q) => q && q.text != null && q.themeId != null)
            .map((q) => ({ id: Number(q.id), themeId: String(q.themeId), text: String(q.text) }))
        : [],
      removedQuestionIds: Array.isArray(o.removedQuestionIds)
        ? o.removedQuestionIds.map(Number)
        : [],
      departments: Array.isArray(o.departments) ? o.departments.map(String) : null,
    };
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  /** Return effective content with overrides applied (does not mutate base). */
  function apply(base, overrides) {
    const o = normalize(overrides);
    const removed = new Set(o.removedQuestionIds.map(Number));
    const content = clone(base);

    content.themes = content.themes.map((theme) => {
      const questions = theme.questions.filter((q) => !removed.has(Number(q.id)));
      o.customQuestions
        .filter((cq) => String(cq.themeId) === String(theme.id) && !removed.has(Number(cq.id)))
        .forEach((cq) => questions.push({ id: Number(cq.id), text: String(cq.text), custom: true }));
      return Object.assign({}, theme, { questions });
    });

    if (o.departments) {
      content.demographics = content.demographics.map((d) =>
        d.key === 'department' ? Object.assign({}, d, { options: o.departments.slice() }) : d
      );
    }
    return content;
  }

  /** All question ids in the BASE plus any custom ids — to mint the next one. */
  function nextQuestionId(base, overrides) {
    const o = normalize(overrides);
    let max = 0;
    base.themes.forEach((t) =>
      t.questions.forEach((q) => {
        if (Number(q.id) > max) max = Number(q.id);
      })
    );
    o.customQuestions.forEach((q) => {
      if (Number(q.id) > max) max = Number(q.id);
    });
    return max + 1;
  }

  /** Effective department list (override list if set, otherwise the base list). */
  function departmentsOf(base, overrides) {
    const o = normalize(overrides);
    if (o.departments) return o.departments.slice();
    const dept = base.demographics.find((d) => d.key === 'department');
    return dept ? dept.options.slice() : [];
  }

  /** Is an id one of the base (built-in) questions? (vs an admin-added one) */
  function isBaseQuestion(base, id) {
    return base.themes.some((t) => t.questions.some((q) => Number(q.id) === Number(id)));
  }

  // --- Pure mutators on an overrides object (return a NEW overrides) ----------

  function addQuestion(base, overrides, themeId, text) {
    const o = normalize(overrides);
    const id = nextQuestionId(base, o);
    o.customQuestions.push({ id, themeId: String(themeId), text: String(text).trim() });
    return { result: o, id };
  }

  function removeQuestion(base, overrides, id) {
    const o = normalize(overrides);
    id = Number(id);
    if (isBaseQuestion(base, id)) {
      if (!o.removedQuestionIds.includes(id)) o.removedQuestionIds.push(id);
    } else {
      o.customQuestions = o.customQuestions.filter((q) => Number(q.id) !== id);
      o.removedQuestionIds = o.removedQuestionIds.filter((x) => Number(x) !== id);
    }
    return o;
  }

  function addDepartment(base, overrides, name) {
    const o = normalize(overrides);
    const list = departmentsOf(base, o);
    const clean = String(name).trim();
    if (clean && !list.some((d) => d.toLowerCase() === clean.toLowerCase())) list.push(clean);
    o.departments = list;
    return o;
  }

  function removeDepartment(base, overrides, name) {
    const o = normalize(overrides);
    const list = departmentsOf(base, o).filter((d) => d !== name);
    o.departments = list;
    return o;
  }

  return {
    apply,
    normalize,
    nextQuestionId,
    departmentsOf,
    isBaseQuestion,
    addQuestion,
    removeQuestion,
    addDepartment,
    removeDepartment,
  };
});
