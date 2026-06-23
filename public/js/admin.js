/**
 * Admin dashboard controller.
 * Auth flow → load responses → compute scores → render charts/scores/tables →
 * live-poll for new submissions. Works against the API (full app) or the demo
 * backend (static build) with no code changes.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = window.DataAPI;

  const state = {
    content: null,
    payload: null,    // { count, status, headcount, responses }
    scores: null,
    charts: [],
    lastSig: '',      // count+status signature to detect changes
    pollTimer: null,
    questionIndex: {}, // id -> {text, themeId}
    activeTab: 'themes',
    renderedTabs: new Set(),
    // History (archived survey rounds)
    rounds: [],
    viewingRound: null, // when set, the dashboard shows an archived round
    histChart: null,
    histYear: '',
  };

  let tabs = []; // populated in wireStaticUi

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    renderDemoRibbon();
    wireStaticUi();
    const session = await api.getSession();
    state.usingDefault = !!session.usingDefault;
    state.adminUser = session.user && session.user.username;
    if (session.authenticated) {
      await enterDashboard();
    } else {
      showLogin();
    }
  }

  function renderDemoRibbon() {
    if (!api.isDemo) return;
    $('demo-ribbon').innerHTML =
      '<div class="demo-ribbon">🎭 <strong>Demo dashboard</strong> — showing bundled sample data. Not the live production system.</div>';
  }

  // -------------------------------------------------------------------------
  //  Login
  // -------------------------------------------------------------------------
  function showLogin() {
    $('login-view').hidden = false;
    $('dash-view').hidden = true;
    $('admin-actions').hidden = true;
    const box = $('demo-creds');
    if (api.isDemo) {
      box.hidden = false;
      box.innerHTML =
        '🎭 <strong>Demo</strong> — sign in with anything, e.g. <code>admin</code> / <code>demo</code>.';
    } else if (state.usingDefault) {
      box.hidden = false;
      box.innerHTML =
        '👋 <strong>First time?</strong> Sign in with <code>admin</code> / <code>admin</code>, then open <strong>⚙ Settings</strong> to set your own email &amp; password.';
    }
    $('login-form').addEventListener('submit', handleLogin);
  }

  async function handleLogin(e) {
    e.preventDefault();
    $('login-error').hidden = true;
    const btn = $('login-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    const result = await api.login($('username').value.trim(), $('password').value);
    if (result.ok) {
      state.adminUser = result.user && result.user.username;
      $('login-view').hidden = true;
      await enterDashboard();
    } else {
      $('login-error').hidden = false;
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  // -------------------------------------------------------------------------
  //  Dashboard
  // -------------------------------------------------------------------------
  async function enterDashboard() {
    $('dash-view').hidden = false;
    $('admin-actions').hidden = false;
    $('default-login-banner').hidden = !state.usingDefault;

    const survey = await api.getSurvey();
    state.content = survey.content;
    state.networkUrl = survey.networkUrl || null;
    Scoring.flatQuestions(state.content).forEach((q) => {
      state.questionIndex[q.id] = { text: q.text, themeId: q.themeId };
    });

    renderLegend();
    await loadAndRender(true);
    startPolling();
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(async () => {
      try {
        const summary = await api.getSummary();
        if (summary.unauthorized) return stopPolling();
        const sig = summary.count + '|' + summary.status;
        if (sig !== state.lastSig) {
          await loadAndRender(false);
        }
      } catch (_) { /* transient */ }
    }, 5000);
  }
  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function loadAndRender(initial) {
    if (state.viewingRound) return; // viewing an archived round — don't clobber it
    const payload = await api.getResponses();
    if (payload.unauthorized) {
      stopPolling();
      return showLogin(api.isDemo ? 'demo' : 'local');
    }
    state.payload = payload;
    state.lastSig = payload.count + '|' + payload.status;
    state.scores = Scoring.compute(payload.responses, state.content);

    renderLiveRow();
    renderStatusControls();

    destroyCharts();
    $('theme-grid').innerHTML = '';
    $('question-groups').innerHTML = '';
    $('demo-charts').innerHTML = '';
    $('responses-tbody').innerHTML = '';
    $('no-responses').hidden = true;
    state.renderedTabs.clear();

    if (payload.count === 0) {
      $('kpis').innerHTML = '';
    } else {
      renderKpis();
    }
    // Empty-state only for a current-round DATA tab with no responses.
    $('empty-state').hidden = !(payload.count === 0 && state.activeTab !== 'history');
    renderTab(state.activeTab);
  }

  function activateTab(tab) {
    tabs.forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    const name = tab.dataset.tab;
    $('tab-' + name).classList.add('active');
    $('legend').style.display = name === 'themes' || name === 'questions' ? '' : 'none';
    state.activeTab = name;
    const noData = state.payload && state.payload.count === 0 && !state.viewingRound;
    $('empty-state').hidden = !(noData && name !== 'history');
    renderTab(name);
  }

  // Render the charts/content for a single tab (idempotent per data load).
  function renderTab(tab) {
    if (tab === 'history') return renderHistory(); // independent of current-round data
    if (!state.scores || !state.payload || state.payload.count === 0) return;
    if (state.renderedTabs.has(tab)) return;
    if (tab === 'themes') renderThemes();
    else if (tab === 'questions') renderQuestions();
    else if (tab === 'demographics') renderDemographics();
    else if (tab === 'responses') renderResponses();
    state.renderedTabs.add(tab);
  }

  function renderLiveRow() {
    const { count, headcount, status } = state.payload;
    $('live-n').textContent = headcount ? `${count} / ${headcount}` : count;
    $('live-lbl').textContent = count === 1 ? 'response so far' : 'responses so far';
    const chip = $('status-chip');
    chip.textContent = status === 'closed' ? 'Closed' : 'Open';
    chip.className = 'chip ' + (status === 'closed' ? 'chip-closed' : 'chip-open');
    $('closed-banner').hidden = status !== 'closed';
    $('updated-at').textContent =
      'Refreshed ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderStatusControls() {
    const btn = $('toggle-status-btn');
    const closed = state.payload.status === 'closed';
    btn.textContent = closed ? 'Reopen survey' : 'Close survey';
    btn.classList.toggle('btn-danger', !closed);
  }

  function renderKpis() {
    const o = state.scores.overall;
    const themesSorted = [...state.scores.perTheme].sort((a, b) => b.positiveRate - a.positiveRate);
    const top = themesSorted[0];
    const bottom = themesSorted[themesSorted.length - 1];
    $('kpis').innerHTML = `
      <div class="kpi hero">
        <div class="val">${Scoring.fmtPct(o.headline)}</div>
        <div class="k-label">Overall satisfaction</div>
        <div class="k-sub">Agree + Strongly Agree across all answers</div>
      </div>
      <div class="kpi">
        <div class="val">${o.avgRating.toFixed(2)}<span style="font-size:16px;color:var(--muted)"> / 4</span></div>
        <div class="k-label">Average rating</div>
        <div class="k-sub">Satisfaction index ${Scoring.fmtPct(o.satisfactionIndex)}</div>
      </div>
      <div class="kpi">
        <div class="val" style="color:var(--ok)">${escapeHtml(top.id)}</div>
        <div class="k-label">Highest theme</div>
        <div class="k-sub">${escapeHtml(top.title)} · ${Scoring.fmtPct(top.positiveRate)}</div>
      </div>
      <div class="kpi">
        <div class="val" style="color:var(--warn)">${escapeHtml(bottom.id)}</div>
        <div class="k-label">Lowest theme</div>
        <div class="k-sub">${escapeHtml(bottom.title)} · ${Scoring.fmtPct(bottom.positiveRate)}</div>
      </div>`;
  }

  function renderLegend() {
    $('legend').innerHTML = Charts.SCALE_LABELS.map(
      (lbl, i) =>
        `<span class="item"><span class="sw" style="background:${Charts.SCALE_COLORS[i]}"></span>${lbl}</span>`
    ).join('');
  }

  function destroyCharts() {
    state.charts.forEach((c) => {
      try { c.destroy(); } catch (_) {}
    });
    state.charts = [];
  }

  function renderThemes() {
    const grid = $('theme-grid');
    grid.innerHTML = '';
    state.scores.perTheme.forEach((t) => {
      const card = document.createElement('div');
      card.className = 'donut-card theme-card';
      card.innerHTML = `
        <div class="title"><span class="theme-id">${escapeHtml(t.id)}.</span>${escapeHtml(t.title)}</div>
        <div class="donut-wrap">
          <canvas></canvas>
          <div class="donut-center"><div class="pct">${Scoring.fmtPct(t.positiveRate, 0)}</div><div class="pl">positive</div></div>
        </div>
        <div class="posbar"><span style="width:${t.positiveRate}%"></span></div>
        <div class="donut-meta"><span>Q${t.range[0]}–${t.range[1]}</span><span>avg ${t.avgRating.toFixed(2)}/4</span></div>`;
      grid.appendChild(card);
      state.charts.push(Charts.distributionDonut(card.querySelector('canvas'), t.counts));
    });
  }

  function renderQuestions() {
    const wrap = $('question-groups');
    wrap.innerHTML = '';
    state.content.themes.forEach((theme) => {
      const head = document.createElement('div');
      head.className = 'section-head';
      head.style.marginTop = '18px';
      head.innerHTML = `<h2 style="font-size:15px"><span style="color:var(--brand)">${theme.id}.</span> ${escapeHtml(theme.title)}</h2>`;
      wrap.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'donut-grid';
      theme.questions.forEach((q) => {
        const qs = state.scores.perQuestion.find((x) => x.id === q.id);
        if (!qs) return; // archived round may not contain a later-added question
        const card = document.createElement('div');
        card.className = 'donut-card';
        card.innerHTML = `
          <div class="title"><span class="qn">Q${q.id}.</span> ${escapeHtml(q.text)}</div>
          <div class="donut-wrap">
            <canvas></canvas>
            <div class="donut-center"><div class="pct" style="font-size:18px">${Scoring.fmtPct(qs.positiveRate, 0)}</div><div class="pl">positive</div></div>
          </div>
          <div class="donut-meta"><span>${qs.total} answers</span><span>avg ${qs.avgRating.toFixed(2)}/4</span></div>`;
        grid.appendChild(card);
        state.charts.push(Charts.distributionDonut(card.querySelector('canvas'), qs.counts));
      });
      wrap.appendChild(grid);
    });
  }

  function renderDemographics() {
    const wrap = $('demo-charts');
    wrap.innerHTML = '';
    Object.values(state.scores.demographics).forEach((d) => {
      const labels = d.options.filter((o) => d.counts[o] > 0);
      const values = labels.map((o) => d.counts[o]);
      const card = document.createElement('div');
      card.className = 'donut-card';
      const legend = labels
        .map(
          (o, i) =>
            `<span class="item"><span class="sw" style="background:${Charts.CAT_COLORS[i % Charts.CAT_COLORS.length]}"></span>${escapeHtml(o)} (${d.counts[o]})</span>`
        )
        .join('');
      card.innerHTML = `
        <div class="title">${escapeHtml(d.label)}</div>
        <div class="donut-wrap"><canvas></canvas></div>
        <div class="legend" style="margin:8px 0 0">${legend || '<span style="color:var(--muted)">No data</span>'}</div>`;
      wrap.appendChild(card);
      if (values.length) {
        state.charts.push(Charts.categoryDonut(card.querySelector('canvas'), labels, values));
      }
    });
  }

  function renderResponses() {
    const tbody = $('responses-tbody');
    const rows = state.payload.responses;
    $('no-responses').hidden = rows.length > 0;
    tbody.innerHTML = '';
    // newest first
    [...rows].reverse().forEach((r) => {
      const s = Scoring.statsFromCounts(countsFor(r));
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `Open response ${r.id} — ${r.department}, ${Scoring.fmtPct(s.positiveRate, 0)} positive`);
      tr.innerHTML = `
        <td>#${r.id}</td>
        <td>${fmtDate(r.submitted_at)}</td>
        <td>${escapeHtml(r.department)}</td>
        <td>${escapeHtml(r.length_of_service)}</td>
        <td>${escapeHtml(r.age_band)}</td>
        <td>${escapeHtml(r.gender)}</td>
        <td>${miniBar(s.counts)} <span class="pos-pill">${Scoring.fmtPct(s.positiveRate, 0)}</span></td>
        <td>${r.comment ? '💬' : ''}</td>`;
      tr.addEventListener('click', () => openModal(r));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModal(r);
        }
      });
      tbody.appendChild(tr);
    });
  }

  function countsFor(r) {
    const counts = [0, 0, 0, 0];
    Object.keys(state.questionIndex).forEach((qid) => {
      const v = Number(r.answers[qid] ?? r.answers[String(qid)]);
      if (v >= 1 && v <= 4) counts[v - 1] += 1;
    });
    return counts;
  }

  function miniBar(counts) {
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const segs = counts
      .map((c, i) => `<span style="width:${(c / total) * 100}%;background:${Charts.SCALE_COLORS[i]}"></span>`)
      .join('');
    return `<span class="mini-bar">${segs}</span>`;
  }

  // -------------------------------------------------------------------------
  //  Drill-down modal
  // -------------------------------------------------------------------------
  function openModal(r) {
    $('modal-title').textContent = `Response #${r.id}`;
    const badge = (v) => {
      const i = v - 1;
      const c = Charts.SCALE_COLORS[i];
      // Dark, readable text on a tinted chip; the colored swatch carries identity
      // (keeps WCAG-AA contrast — colored-text-on-tint failed for amber/sky).
      return `<span class="ans-badge" style="background:${c}1f;color:var(--ink-2);border:1px solid ${c}80"><span class="ans-dot" style="background:${c}"></span>${Charts.SCALE_LABELS[i]}</span>`;
    };
    const chips = `
      <div class="meta-chips">
        <span class="mc">🏢 ${escapeHtml(r.department)}</span>
        <span class="mc">⏳ ${escapeHtml(r.length_of_service)}</span>
        <span class="mc">🎂 ${escapeHtml(r.age_band)}</span>
        <span class="mc">👤 ${escapeHtml(r.gender)}</span>
        <span class="mc">🕒 ${fmtDate(r.submitted_at)}</span>
      </div>`;
    const comment = r.comment
      ? `<div class="comment-box">💬 ${escapeHtml(r.comment)}</div>`
      : '';
    const answers = state.content.themes
      .map((theme) => {
        const qs = theme.questions
          .map((q) => {
            const v = Number(r.answers[q.id] ?? r.answers[String(q.id)]);
            return `<div class="ans-row"><span class="qn">${q.id}</span><span class="qt">${escapeHtml(q.text)}</span>${v ? badge(v) : '<span class="ans-badge" style="background:#eee;color:#888">—</span>'}</div>`;
          })
          .join('');
        return `<div style="margin-top:14px;font-weight:700;font-size:13px;color:var(--brand-700)">${theme.id}. ${escapeHtml(theme.title)}</div>${qs}`;
      })
      .join('');
    $('modal-body').innerHTML = chips + comment + answers;
    state.modalReturnFocus = document.activeElement;
    $('modal-backdrop').classList.add('open');
    $('modal-close').focus();
  }

  function closeModal() {
    if (!$('modal-backdrop').classList.contains('open')) return;
    $('modal-backdrop').classList.remove('open');
    // Restore focus to the row (or control) that opened the modal.
    if (state.modalReturnFocus && state.modalReturnFocus.focus) {
      state.modalReturnFocus.focus();
      state.modalReturnFocus = null;
    }
  }

  // Keep Tab focus inside whichever dialog is open.
  function trapModalFocus(e) {
    if (e.key !== 'Tab') return;
    const open = document.querySelector('.modal-backdrop.open');
    if (!open) return;
    const focusables = open.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // -------------------------------------------------------------------------
  //  Manage survey configuration (add / remove questions & departments)
  // -------------------------------------------------------------------------

  // Re-fetch the (possibly edited) survey content, rebuild the question index,
  // and recompute every chart/score so edits show up live on the dashboard.
  async function reloadSurveyContent() {
    const survey = await api.getSurvey();
    state.content = survey.content;
    state.questionIndex = {};
    Scoring.flatQuestions(state.content).forEach((q) => {
      state.questionIndex[q.id] = { text: q.text, themeId: q.themeId };
    });
    await loadAndRender(false);
  }

  function openManageModal(title) {
    $('manage-title').textContent = title;
    state.manageReturnFocus = document.activeElement;
    $('manage-backdrop').classList.add('open');
    $('manage-close').focus();
  }

  function closeManageModal() {
    if (!$('manage-backdrop').classList.contains('open')) return;
    $('manage-backdrop').classList.remove('open');
    if (state.manageReturnFocus && state.manageReturnFocus.focus) {
      state.manageReturnFocus.focus();
      state.manageReturnFocus = null;
    }
  }

  // ---- Questions ----------------------------------------------------------
  function renderManageQuestions() {
    const themeOpts = state.content.themes
      .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.id)}. ${escapeHtml(t.title)}</option>`)
      .join('');

    let total = 0;
    const groups = state.content.themes
      .map((theme) => {
        const rows = theme.questions
          .map((q) => {
            total++;
            const tag = q.custom ? '<span class="mr-tag">added</span>' : '';
            return `<li class="manage-row">
              <span class="mr-id">Q${q.id}</span>
              <span class="mr-text">${escapeHtml(q.text)} ${tag}</span>
              <button class="mr-del" data-del-q="${q.id}" aria-label="Delete question ${q.id}">Delete</button>
            </li>`;
          })
          .join('');
        return `<div class="manage-group">${escapeHtml(theme.id)}. ${escapeHtml(theme.title)}</div><ul class="manage-list">${rows}</ul>`;
      })
      .join('');

    $('manage-body').innerHTML = `
      <p class="manage-intro">Add a question to any theme, or remove one. Changes apply to the employee form and the dashboard right away. <strong>${total}</strong> questions currently.</p>
      <div class="manage-add">
        <select id="mq-theme" class="grow" aria-label="Theme">${themeOpts}</select>
        <textarea id="mq-text" class="grow" placeholder="Type the new question…" maxlength="300"></textarea>
        <button class="btn btn-primary" id="mq-add">Add question</button>
      </div>
      <div class="manage-err" id="mq-err" hidden></div>
      ${groups}`;

    $('mq-add').addEventListener('click', addQuestionFromForm);
    $('manage-body')
      .querySelectorAll('[data-del-q]')
      .forEach((btn) => btn.addEventListener('click', () => deleteQuestionById(btn.getAttribute('data-del-q'))));
  }

  async function addQuestionFromForm() {
    const themeId = $('mq-theme').value;
    const text = $('mq-text').value.trim();
    const err = $('mq-err');
    if (text.length < 5) {
      err.textContent = 'Please type a question (at least 5 characters).';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    const btn = $('mq-add');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    const r = await api.addQuestion({ themeId, text });
    if (!r.ok) {
      err.textContent = 'Could not add the question. Please try again.';
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Add question';
      return;
    }
    await reloadSurveyContent();
    renderManageQuestions();
  }

  async function deleteQuestionById(id) {
    if (Scoring.flatQuestions(state.content).length <= 1) {
      window.alert('At least one question is required.');
      return;
    }
    if (!window.confirm('Remove this question? It will disappear from the employee form.')) return;
    await api.deleteQuestion(id);
    await reloadSurveyContent();
    renderManageQuestions();
  }

  // ---- Departments --------------------------------------------------------
  function deptField() {
    return state.content.demographics.find((d) => d.key === 'department');
  }

  function renderManageDepartments() {
    const dept = deptField();
    const list = dept ? dept.options : [];
    const rows =
      list
        .map(
          (name) => `<li class="manage-row">
            <span class="mr-text">${escapeHtml(name)}</span>
            <button class="mr-del" data-del-d="${escapeHtml(name)}" aria-label="Delete ${escapeHtml(name)}">Delete</button>
          </li>`
        )
        .join('') || '<li class="manage-empty">No departments yet — add the first one above.</li>';

    $('manage-body').innerHTML = `
      <p class="manage-intro">These are the departments employees can pick on the form. <strong>${list.length}</strong> currently.</p>
      <div class="manage-add">
        <input type="text" id="md-name" class="grow" placeholder="New department name…" maxlength="60" />
        <button class="btn btn-primary" id="md-add">Add department</button>
      </div>
      <div class="manage-err" id="md-err" hidden></div>
      <ul class="manage-list">${rows}</ul>`;

    $('md-add').addEventListener('click', addDepartmentFromForm);
    $('md-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addDepartmentFromForm();
      }
    });
    $('manage-body')
      .querySelectorAll('[data-del-d]')
      .forEach((btn) => btn.addEventListener('click', () => deleteDepartmentByName(btn.getAttribute('data-del-d'))));
  }

  async function addDepartmentFromForm() {
    const name = $('md-name').value.trim();
    const err = $('md-err');
    if (!name) {
      err.textContent = 'Please type a department name.';
      err.hidden = false;
      return;
    }
    const dept = deptField();
    if (dept && dept.options.some((o) => o.toLowerCase() === name.toLowerCase())) {
      err.textContent = 'That department already exists.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    await api.addDepartment(name);
    await reloadSurveyContent();
    renderManageDepartments();
  }

  async function deleteDepartmentByName(name) {
    if (!window.confirm(`Remove "${name}" from the department list?`)) return;
    await api.deleteDepartment(name);
    await reloadSurveyContent();
    renderManageDepartments();
  }

  // ---- Account (admin login) ---------------------------------------------
  function renderAccountSettings() {
    const demoNote = api.isDemo
      ? '<p class="manage-intro">🎭 Demo — changes here are not saved.</p>'
      : '';
    const warn =
      !api.isDemo && state.usingDefault
        ? '<div class="manage-err" style="margin:0 0 14px">You are signed in with the default login (admin / admin). Set your own below.</div>'
        : '';
    $('manage-body').innerHTML = `
      ${demoNote}
      <p class="manage-intro">Set the email and password you'll use to sign in to this dashboard. Use your company (Microsoft) email — staff will recognise the survey you send them.</p>
      ${warn}
      <div class="field">
        <label for="acc-email">Your email <span style="color:var(--muted);font-weight:500">(this becomes your username)</span></label>
        <input type="email" id="acc-email" autocomplete="username" placeholder="you@company.com" />
      </div>
      <div class="field">
        <label for="acc-pw">New password <span style="color:var(--muted);font-weight:500">(at least 8 characters)</span></label>
        <input type="password" id="acc-pw" autocomplete="new-password" />
      </div>
      <div class="field">
        <label for="acc-pw2">Confirm new password</label>
        <input type="password" id="acc-pw2" autocomplete="new-password" />
      </div>
      <button class="btn btn-primary" id="acc-save">Save my login</button>
      <span id="acc-feedback" style="margin-left:12px;font-weight:600"></span>
      <div class="manage-err" id="acc-err" hidden></div>`;
    if (state.adminUser && state.adminUser !== 'admin') $('acc-email').value = state.adminUser;
    $('acc-save').addEventListener('click', handleSaveAccount);
  }

  async function handleSaveAccount() {
    const email = $('acc-email').value.trim();
    const pw = $('acc-pw').value;
    const pw2 = $('acc-pw2').value;
    const err = $('acc-err');
    const fb = $('acc-feedback');
    err.hidden = true;
    fb.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      err.textContent = 'Please enter a valid email address.';
      err.hidden = false;
      return;
    }
    if (pw.length < 8) {
      err.textContent = 'Password must be at least 8 characters.';
      err.hidden = false;
      return;
    }
    if (pw !== pw2) {
      err.textContent = 'The two passwords do not match.';
      err.hidden = false;
      return;
    }
    const btn = $('acc-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const r = await api.updateAccount(email, pw);
    btn.disabled = false;
    btn.textContent = 'Save my login';
    if (!r.ok) {
      err.textContent =
        r.error === 'invalid_email'
          ? 'Please enter a valid email address.'
          : r.error === 'weak_password'
          ? 'Password must be at least 8 characters.'
          : 'Could not save. Please try again.';
      err.hidden = false;
      return;
    }
    state.adminUser = r.user && r.user.username;
    if (!r.demo) {
      state.usingDefault = false;
      $('default-login-banner').hidden = true;
    }
    fb.style.color = 'var(--ok)';
    fb.textContent = r.demo ? '✓ (demo — not saved)' : '✓ Saved — use this next time you sign in.';
  }

  // -------------------------------------------------------------------------
  //  History (archived survey rounds)
  // -------------------------------------------------------------------------
  function defaultRoundLabel() {
    return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  function fmtRoundDate(iso) {
    return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function histMsg(text, isError) {
    const el = $('archive-msg');
    el.textContent = text;
    el.style.color = isError ? 'var(--bad)' : 'var(--ok)';
  }
  function yearOf(s) {
    return new Date(s.date).getFullYear();
  }

  function buildSeries(rounds) {
    const series = rounds.map((r) => ({
      id: r.id, label: r.label, date: r.archived_at,
      respondents: r.respondents, summary: r.summary, live: false,
    }));
    if (!state.viewingRound && state.payload && state.payload.count > 0 && state.scores) {
      series.push({
        id: 'current', label: 'Current (live)', date: new Date().toISOString(),
        respondents: state.payload.count, summary: state.scores, live: true,
      });
    }
    return series;
  }

  async function renderHistory() {
    const rounds = (await api.getRounds()) || [];
    state.rounds = rounds;
    const series = buildSeries(rounds);
    populateYearFilter(series);
    const shown = filterByYear(series);
    renderTrendChart(shown);
    renderComparisonTable(shown);
    renderRoundList(series);
  }

  function populateYearFilter(series) {
    const sel = $('hist-year');
    const years = [...new Set(series.map(yearOf))].sort();
    const want =
      '<option value="">All years</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join('');
    if (sel.innerHTML !== want) sel.innerHTML = want;
    sel.value = state.histYear || '';
  }
  function filterByYear(series) {
    if (!state.histYear) return series;
    return series.filter((s) => String(yearOf(s)) === String(state.histYear) || s.live);
  }

  function renderTrendChart(series) {
    if (state.histChart) {
      try { state.histChart.destroy(); } catch (_) {}
      state.histChart = null;
    }
    const canvas = $('hist-trend-canvas');
    if (!series.length || typeof Chart === 'undefined') return;
    state.histChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.map((s) => s.label),
        datasets: [{
          label: 'Overall satisfaction %',
          data: series.map((s) => Math.round(s.summary.overall.headline * 10) / 10),
          borderColor: '#0d7d72',
          backgroundColor: 'rgba(13,125,114,0.12)',
          fill: true, tension: 0.3, pointRadius: 5, pointBackgroundColor: '#0d7d72',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.y + '%' } } },
      },
    });
  }

  function cmpCell(v, prev) {
    if (v == null) return '<td class="val">—</td>';
    const cur = Math.round(v);
    let delta = '';
    if (prev != null) {
      const diff = cur - Math.round(prev);
      if (diff > 0) delta = ` <span class="delta-up">▲${diff}</span>`;
      else if (diff < 0) delta = ` <span class="delta-down">▼${Math.abs(diff)}</span>`;
    }
    return `<td class="val">${cur}%${delta}</td>`;
  }

  function renderComparisonTable(series) {
    const table = $('hist-compare');
    if (!series.length) {
      table.innerHTML = '<tbody><tr><td class="hist-empty">No rounds yet.</td></tr></tbody>';
      return;
    }
    const themes = series[series.length - 1].summary.perTheme;
    const head = '<tr><th>Theme</th>' + series.map((s) => `<th>${escapeHtml(s.label)}</th>`).join('') + '</tr>';
    let body = '<tr class="overall-row"><td>Overall satisfaction</td>';
    series.forEach((s, j) => {
      body += cmpCell(s.summary.overall.headline, j > 0 ? series[j - 1].summary.overall.headline : null);
    });
    body += '</tr>';
    themes.forEach((t) => {
      body += `<tr><td>${escapeHtml(t.id)}. ${escapeHtml(t.title)}</td>`;
      series.forEach((s, j) => {
        const cur = s.summary.perTheme.find((x) => x.id === t.id);
        const prev = j > 0 ? series[j - 1].summary.perTheme.find((x) => x.id === t.id) : null;
        body += cmpCell(cur ? cur.positiveRate : null, prev ? prev.positiveRate : null);
      });
      body += '</tr>';
    });
    table.innerHTML = '<thead>' + head + '</thead><tbody>' + body + '</tbody>';
  }

  function renderRoundList(series) {
    const wrap = $('hist-rounds');
    if (!series.length) {
      wrap.innerHTML = '<div class="hist-empty">No rounds yet. Archive the current round to begin building history.</div>';
      return;
    }
    wrap.innerHTML = '';
    [...series].reverse().forEach((s) => {
      const row = document.createElement('div');
      row.className = 'hist-round-row';
      row.innerHTML =
        `<span class="hr-when">${escapeHtml(s.label)} ${s.live ? '<span class="hr-live">LIVE</span>' : ''}</span>` +
        `<span class="hr-date">${s.live ? 'now' : fmtRoundDate(s.date)}</span>` +
        `<span class="hr-n">${s.respondents} responses</span>` +
        `<span class="hr-pct">${Scoring.fmtPct(s.summary.overall.headline, 0)}</span>`;
      if (!s.live) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm';
        btn.style.marginLeft = '12px';
        btn.textContent = 'View';
        btn.addEventListener('click', () => enterRoundView(s));
        row.appendChild(btn);
      }
      wrap.appendChild(row);
    });
  }

  async function archiveCurrentRound() {
    if (state.viewingRound) return;
    if (!state.payload || state.payload.count === 0) {
      histMsg('Nothing to archive — the current round has no responses yet.', true);
      return;
    }
    const label = window.prompt(
      'Name this survey round (e.g. a month/period). It is saved to History and the current round resets for the next period.',
      defaultRoundLabel()
    );
    if (label === null) return;
    const btn = $('archive-round-btn');
    btn.disabled = true;
    btn.textContent = 'Archiving…';
    const r = await api.archiveRound((label || '').trim());
    btn.disabled = false;
    btn.textContent = '📦 Archive current round & start new';
    if (!r.ok) {
      histMsg('Could not archive: ' + (r.error || 'please try again'), true);
      return;
    }
    histMsg('Saved “' + (r.label || label) + '” to History. The current round is reset for the next period.', false);
    await loadAndRender(false);
    renderHistory();
  }

  function enterRoundView(item) {
    stopPolling();
    destroyCharts();
    state.viewingRound = item;
    state.scores = item.summary;
    state.payload = { count: item.respondents, status: 'archived', headcount: null, responses: [] };
    state.renderedTabs.clear();
    $('round-view-label').textContent = item.label;
    $('round-view-banner').hidden = false;
    $('tab-btn-responses').style.display = 'none'; // no individual records for archived rounds
    $('empty-state').hidden = true;
    $('live-n').textContent = item.respondents;
    $('live-lbl').textContent = 'responses in this round';
    const chip = $('status-chip');
    chip.textContent = 'Archived';
    chip.className = 'chip';
    $('updated-at').textContent = fmtRoundDate(item.date);
    renderKpis();
    activateTab($('tab-btn-themes'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function exitRoundView() {
    state.viewingRound = null;
    $('round-view-banner').hidden = true;
    $('tab-btn-responses').style.display = '';
    await loadAndRender(false);
    startPolling();
    activateTab($('tab-btn-history'));
  }

  // -------------------------------------------------------------------------
  //  Static UI wiring (tabs, buttons, modal)
  // -------------------------------------------------------------------------
  function wireStaticUi() {
    tabs = [...document.querySelectorAll('.tab')];
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => activateTab(tab));
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(i + dir + tabs.length) % tabs.length];
        next.focus();
        activateTab(next);
      });
    });

    // History controls.
    $('archive-round-btn').addEventListener('click', archiveCurrentRound);
    $('round-view-back').addEventListener('click', exitRoundView);
    $('hist-year').addEventListener('change', () => {
      state.histYear = $('hist-year').value;
      renderHistory();
    });

    $('modal-close').addEventListener('click', closeModal);
    $('modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('modal-backdrop')) closeModal();
    });

    // Manage (questions / departments) modal.
    $('manage-questions-btn').addEventListener('click', () => {
      openManageModal('Add / remove questions');
      renderManageQuestions();
    });
    $('manage-depts-btn').addEventListener('click', () => {
      openManageModal('Add / remove departments');
      renderManageDepartments();
    });
    $('settings-btn').addEventListener('click', () => {
      openManageModal('Settings — your admin login');
      renderAccountSettings();
    });
    $('manage-close').addEventListener('click', closeManageModal);
    $('manage-backdrop').addEventListener('click', (e) => {
      if (e.target === $('manage-backdrop')) closeManageModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        closeManageModal();
      } else {
        trapModalFocus(e);
      }
    });

    $('logout-btn').addEventListener('click', async () => {
      stopPolling();
      await api.logout();
      location.reload();
    });

    $('copy-link-btn').addEventListener('click', copyLink);
    $('toggle-status-btn').addEventListener('click', toggleStatus);
    $('export-xlsx-btn').addEventListener('click', () => {
      Exporter.toXlsx(state.content, state.payload, state.scores);
    });
    $('export-pdf-btn').addEventListener('click', () => {
      Exporter.toPdf(state.content, state.payload, state.scores);
    });
  }

  function surveyFormUrl() {
    // Prefer the LAN URL the server detected, so the copied link works for
    // staff on the office network (not "localhost", which only works on the PC).
    if (state.networkUrl) return state.networkUrl.replace(/\/+$/, '') + '/';
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.pathname = u.pathname.replace(/admin(\.html)?$/, '') || '/';
    return u.toString();
  }

  async function copyLink() {
    const url = surveyFormUrl();
    const btn = $('copy-link-btn');
    try {
      await navigator.clipboard.writeText(url);
      flash(btn, '✓ Copied!');
    } catch (_) {
      window.prompt('Copy the survey link:', url);
    }
  }

  async function toggleStatus() {
    const next = state.payload.status === 'closed' ? 'open' : 'closed';
    if (next === 'closed' && !confirm('Close the survey? Employees will no longer be able to submit responses.')) {
      return;
    }
    const result = await api.setSurveyStatus(next);
    if (result.ok) await loadAndRender(false);
  }

  function flash(btn, text) {
    const orig = btn.textContent;
    btn.textContent = text;
    setTimeout(() => (btn.textContent = orig), 1500);
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
})();
