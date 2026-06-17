/**
 * Data-access layer.
 *
 * One interface, two backends:
 *   • ApiBackend  — fetches the Express API (full app).
 *   • DemoBackend — bundled sample data + localStorage (static demo). No server.
 *
 * Every method returns the same shapes regardless of backend, so the survey
 * form and the admin dashboard are written once and work in both modes.
 *
 * Response shape:
 *   { id, submitted_at, answers:{1..35}, comment, department,
 *     length_of_service, age_band, gender }
 */
(function () {
  'use strict';

  const MODE = (window.APP_CONFIG && window.APP_CONFIG.mode) || 'api';

  async function jsonFetch(url, options) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    });
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      /* no body */
    }
    return { ok: res.ok, status: res.status, body };
  }

  // -------------------------------------------------------------------------
  //  API backend (full app)
  // -------------------------------------------------------------------------
  const ApiBackend = {
    mode: 'api',

    async getSurvey() {
      const { ok, body } = await jsonFetch('/api/survey', { method: 'GET' });
      if (!ok) throw new Error('Could not load survey.');
      return body; // { content, status, headcount }
    },

    async submitResponse(payload) {
      const { ok, status, body } = await jsonFetch('/api/responses', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (status === 409) return { ok: false, closed: true };
      if (!ok) return { ok: false, errors: (body && body.details) || ['Submission failed.'] };
      return { ok: true, id: body.id };
    },

    async login(username, password) {
      const { ok, body } = await jsonFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      return ok ? { ok: true, user: body.user } : { ok: false };
    },

    async logout() {
      await jsonFetch('/api/admin/logout', { method: 'POST' });
      return { ok: true };
    },

    async getSession() {
      const { body } = await jsonFetch('/api/admin/session', { method: 'GET' });
      return body || { authenticated: false };
    },

    async getSummary() {
      const { ok, status, body } = await jsonFetch('/api/admin/summary', { method: 'GET' });
      if (status === 401) return { unauthorized: true };
      if (!ok) throw new Error('Could not load summary.');
      return body;
    },

    async getResponses() {
      const { ok, status, body } = await jsonFetch('/api/admin/responses', { method: 'GET' });
      if (status === 401) return { unauthorized: true };
      if (!ok) throw new Error('Could not load responses.');
      return body; // { count, status, headcount, responses }
    },

    async setSurveyStatus(newStatus) {
      const { ok, body } = await jsonFetch('/api/admin/survey-status', {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      });
      return ok ? { ok: true, status: body.status } : { ok: false };
    },

    // --- Survey configuration (admin) -------------------------------------
    async addQuestion({ themeId, text }) {
      const { ok, body } = await jsonFetch('/api/admin/questions', {
        method: 'POST',
        body: JSON.stringify({ themeId, text }),
      });
      return ok ? { ok: true, id: body.id } : { ok: false, error: body && body.error };
    },

    async deleteQuestion(id) {
      const { ok } = await jsonFetch('/api/admin/questions/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
      return { ok };
    },

    async addDepartment(name) {
      const { ok, body } = await jsonFetch('/api/admin/departments', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      return ok ? { ok: true } : { ok: false, error: body && body.error };
    },

    async deleteDepartment(name) {
      const { ok } = await jsonFetch('/api/admin/departments/' + encodeURIComponent(name), {
        method: 'DELETE',
      });
      return { ok };
    },
  };

  // -------------------------------------------------------------------------
  //  Demo backend (static, no server)
  // -------------------------------------------------------------------------
  const LS_KEYS = {
    extra: 'ess_demo_extra_responses',
    status: 'ess_demo_status',
    overrides: 'ess_survey_overrides',
  };

  const DemoBackend = {
    mode: 'demo',

    _content: null,

    async _loadContent() {
      if (this._content) return this._content;
      const res = await fetch('survey-content.json');
      this._content = await res.json();
      return this._content;
    },

    _extra() {
      try {
        return JSON.parse(localStorage.getItem(LS_KEYS.extra) || '[]');
      } catch (_) {
        return [];
      }
    },

    _saveExtra(list) {
      localStorage.setItem(LS_KEYS.extra, JSON.stringify(list));
    },

    _status() {
      return localStorage.getItem(LS_KEYS.status) === 'closed' ? 'closed' : 'open';
    },

    _overrides() {
      try {
        return JSON.parse(localStorage.getItem(LS_KEYS.overrides) || 'null');
      } catch (_) {
        return null;
      }
    },

    _saveOverrides(o) {
      localStorage.setItem(LS_KEYS.overrides, JSON.stringify(o));
    },

    _allResponses() {
      const base = (window.DEMO_SAMPLE && window.DEMO_SAMPLE.responses) || [];
      return base.concat(this._extra());
    },

    async getSurvey() {
      const base = await this._loadContent();
      const content =
        window.SurveyConfig ? window.SurveyConfig.apply(base, this._overrides()) : base;
      const headcount = (window.DEMO_SAMPLE && window.DEMO_SAMPLE.headcount) || null;
      return { content, status: this._status(), headcount };
    },

    // --- Survey configuration (admin) — persisted in localStorage ---------
    async addQuestion({ themeId, text }) {
      const base = await this._loadContent();
      const { result, id } = window.SurveyConfig.addQuestion(base, this._overrides(), themeId, text);
      this._saveOverrides(result);
      return { ok: true, id };
    },

    async deleteQuestion(id) {
      const base = await this._loadContent();
      this._saveOverrides(window.SurveyConfig.removeQuestion(base, this._overrides(), id));
      return { ok: true };
    },

    async addDepartment(name) {
      const base = await this._loadContent();
      this._saveOverrides(window.SurveyConfig.addDepartment(base, this._overrides(), name));
      return { ok: true };
    },

    async deleteDepartment(name) {
      const base = await this._loadContent();
      this._saveOverrides(window.SurveyConfig.removeDepartment(base, this._overrides(), name));
      return { ok: true };
    },

    async submitResponse(payload) {
      if (this._status() === 'closed') return { ok: false, closed: true };
      // Demo: persist to localStorage only so the live count ticks during a demo.
      const extra = this._extra();
      const id = 100000 + extra.length + 1;
      extra.push({ id, submitted_at: new Date().toISOString(), ...payload });
      this._saveExtra(extra);
      return { ok: true, id, demo: true };
    },

    // Demo login is intentionally permissive (clearly labelled on screen).
    async login(username, password) {
      return { ok: true, user: { username: username || 'admin', provider: 'demo' } };
    },

    async logout() {
      sessionStorage.removeItem('ess_demo_auth');
      return { ok: true };
    },

    async getSession() {
      return { authenticated: sessionStorage.getItem('ess_demo_auth') === '1', provider: 'demo' };
    },

    _markAuthed() {
      sessionStorage.setItem('ess_demo_auth', '1');
    },

    async getSummary() {
      const responses = this._allResponses();
      const last = responses.length ? responses[responses.length - 1].submitted_at : null;
      return {
        count: responses.length,
        status: this._status(),
        headcount: (window.DEMO_SAMPLE && window.DEMO_SAMPLE.headcount) || null,
        last_submitted_at: last,
      };
    },

    async getResponses() {
      const responses = this._allResponses();
      return {
        count: responses.length,
        status: this._status(),
        headcount: (window.DEMO_SAMPLE && window.DEMO_SAMPLE.headcount) || null,
        responses,
      };
    },

    async setSurveyStatus(newStatus) {
      localStorage.setItem(LS_KEYS.status, newStatus === 'closed' ? 'closed' : 'open');
      return { ok: true, status: this._status() };
    },

    // Demo-only helper: clear local additions / reset status.
    resetDemo() {
      localStorage.removeItem(LS_KEYS.extra);
      localStorage.removeItem(LS_KEYS.status);
      localStorage.removeItem(LS_KEYS.overrides);
    },
  };

  // Demo login wrapper marks the session as authed.
  const _demoLogin = DemoBackend.login.bind(DemoBackend);
  DemoBackend.login = async function (u, p) {
    const r = await _demoLogin(u, p);
    if (r.ok) DemoBackend._markAuthed();
    return r;
  };

  window.DataAPI = MODE === 'demo' ? DemoBackend : ApiBackend;
  window.DataAPI.isDemo = MODE === 'demo';
})();
