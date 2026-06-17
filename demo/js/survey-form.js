/**
 * Public survey form — renders the 35 questions + demographics from the survey
 * content, validates client-side, and submits through the data layer.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = window.DataAPI;
  let content = null;
  let scale = [];

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    renderDemoRibbon();
    try {
      const data = await api.getSurvey();
      content = data.content;
      scale = content.scale;

      setStatusChip(data.status);

      if (data.status === 'closed') {
        $('loading').hidden = true;
        $('closed-state').hidden = false;
        return;
      }

      buildForm();
      $('loading').hidden = true;
      $('survey-form').hidden = false;
      $('submitbar').hidden = false;
      updateProgress();
    } catch (err) {
      $('loading').innerHTML =
        '<div class="big">⚠️</div><p>Sorry — the survey could not be loaded. Please refresh.</p>';
      console.error(err);
    }
  }

  function renderDemoRibbon() {
    if (!api.isDemo) return;
    $('demo-ribbon').innerHTML =
      '<div class="demo-ribbon">🎭 <strong>Demo preview</strong> — sample data only. Submissions here are <strong>not stored</strong> on any server.</div>';
  }

  function setStatusChip(status) {
    $('status-chip').textContent = status === 'closed' ? 'Closed' : '';
  }

  function buildForm() {
    $('survey-title').textContent = content.title;
    $('survey-intro').textContent = content.intro;

    const container = $('questions');
    container.innerHTML = '';

    content.themes.forEach((theme) => {
      const head = document.createElement('div');
      head.className = 'theme-head';
      head.innerHTML =
        `<span class="theme-num">${theme.id}</span><h2>${escapeHtml(theme.title)}</h2>`;
      container.appendChild(head);

      const card = document.createElement('section');
      card.className = 'card';

      theme.questions.forEach((q) => {
        card.appendChild(buildQuestion(q));
      });
      container.appendChild(card);
    });

    buildDemographics();

    $('survey-form').addEventListener('change', onChange);
    $('survey-form').addEventListener('submit', onSubmit);
  }

  function buildQuestion(q) {
    const wrap = document.createElement('div');
    wrap.className = 'q';
    wrap.dataset.qid = q.id;

    const text = document.createElement('div');
    text.className = 'q-text';
    text.id = `qlabel-${q.id}`;
    text.innerHTML = `<span class="qn">${q.id}.</span><span>${escapeHtml(q.text)}</span>`;
    wrap.appendChild(text);

    const scaleEl = document.createElement('div');
    scaleEl.className = 'scale';
    scaleEl.setAttribute('role', 'radiogroup');
    // Announce the full question text (not just the number) to screen readers.
    scaleEl.setAttribute('aria-labelledby', `qlabel-${q.id}`);

    scale.forEach((s) => {
      const opt = document.createElement('div');
      opt.className = 'opt';
      const inputId = `q${q.id}_v${s.value}`;
      opt.innerHTML =
        `<input type="radio" id="${inputId}" name="q${q.id}" value="${s.value}" />` +
        `<label for="${inputId}"><span class="dot"></span>${escapeHtml(s.label)}</label>`;
      scaleEl.appendChild(opt);
    });
    wrap.appendChild(scaleEl);
    return wrap;
  }

  function buildDemographics() {
    const grid = $('demographics');
    grid.innerHTML = '';
    content.demographics.forEach((d) => {
      const field = document.createElement('div');
      field.className = 'field';
      const optionsHtml = ['<option value="">Select…</option>']
        .concat(d.options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`))
        .join('');
      field.innerHTML =
        `<label for="demo_${d.key}">${escapeHtml(d.label)} <span class="req">*</span></label>` +
        `<select id="demo_${d.key}" name="${d.key}" required>${optionsHtml}</select>`;
      grid.appendChild(field);
    });
  }

  function onChange() {
    updateProgress();
  }

  function answeredCount() {
    let n = 0;
    content.themes.forEach((t) =>
      t.questions.forEach((q) => {
        if (document.querySelector(`input[name="q${q.id}"]:checked`)) n++;
      })
    );
    return n;
  }

  function totalQuestions() {
    let n = 0;
    content.themes.forEach((t) => (n += t.questions.length));
    return n;
  }

  function updateProgress() {
    const total = totalQuestions() || 1;
    const n = answeredCount();
    const pct = Math.round((n / total) * 100);
    $('progress-fill').style.width = pct + '%';
    $('progress-label').textContent = `${n} / ${total}`;
  }

  function collect() {
    const answers = {};
    const missing = [];
    content.themes.forEach((t) =>
      t.questions.forEach((q) => {
        const checked = document.querySelector(`input[name="q${q.id}"]:checked`);
        if (checked) answers[q.id] = Number(checked.value);
        else missing.push(q.id);
      })
    );
    const payload = { answers, comment: $('comment').value };
    const missingDemo = [];
    content.demographics.forEach((d) => {
      const val = $(`demo_${d.key}`).value;
      payload[d.key] = val;
      if (!val) missingDemo.push(d.label);
    });
    return { payload, missing, missingDemo };
  }

  function clearMissingMarks() {
    document.querySelectorAll('.q.missing').forEach((el) => el.classList.remove('missing'));
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearMissingMarks();
    const banner = $('error-banner');
    banner.hidden = true;

    const { payload, missing, missingDemo } = collect();

    if (missing.length || missingDemo.length) {
      missing.forEach((qid) => {
        const el = document.querySelector(`.q[data-qid="${qid}"]`);
        if (el) el.classList.add('missing');
      });
      const parts = [];
      if (missing.length) parts.push(`${missing.length} unanswered question${missing.length > 1 ? 's' : ''}`);
      if (missingDemo.length) parts.push(`${missingDemo.join(', ')}`);
      banner.textContent = `Please complete: ${parts.join(' · ')}.`;
      banner.hidden = false;
      // Scroll to the first missing question.
      const first = missing.length
        ? document.querySelector(`.q[data-qid="${missing[0]}"]`)
        : $('demographics');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const btn = $('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      const result = await api.submitResponse(payload);
      if (result.closed) {
        showClosed();
        return;
      }
      if (!result.ok) {
        banner.textContent = 'Submission failed: ' + (result.errors || ['please try again']).join('; ');
        banner.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Submit';
        return;
      }
      showThankYou(result.demo);
    } catch (err) {
      console.error(err);
      banner.textContent = 'Could not reach the server. Please check your connection and try again.';
      banner.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
  }

  function showThankYou(isDemo) {
    $('survey-form').hidden = true;
    $('submitbar').hidden = true;
    $('thankyou').hidden = false;
    if (isDemo) {
      const note = $('thankyou-demo-note');
      note.innerHTML =
        '<span class="confidential">🎭 Demo — this response was kept only in your browser.</span>';
      note.hidden = false;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showClosed() {
    $('survey-form').hidden = true;
    $('submitbar').hidden = true;
    $('closed-state').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
})();
