'use strict';

/**
 * Employee Satisfaction Survey — web server (full / local app).
 *
 * Serves two surfaces from one deployment:
 *   • Public survey form  ->  /            (no login)
 *   • Admin dashboard     ->  /admin       (login required)
 *
 * Storage is local SQLite (node:sqlite). The same frontend in public/ is what
 * gets published as the static GitHub Pages demo (Phase 5) — there it runs in
 * "demo" mode against bundled sample data instead of this API.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const db = require('./db');
const { baseSurvey, buildEffective, SurveyConfig, validateResponse } = require('./survey');
const { provider, requireAdmin } = require('./auth');

// Effective survey content = base + any admin overrides persisted in the DB.
function effectiveSurvey() {
  return buildEffective(db.getOverrides());
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IS_PROD = process.env.NODE_ENV === 'production';

// --- Secrets: fail fast in production --------------------------------------
// Never boot a production deployment on the public dev default — refuse to
// start so a misconfigured deploy is an obvious error, not a silent auth hole.
const DEV_SESSION_SECRET = 'dev-only-insecure-secret-change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || DEV_SESSION_SECRET;
if (IS_PROD && SESSION_SECRET === DEV_SESSION_SECRET) {
  throw new Error(
    'Refusing to start: SESSION_SECRET is unset in production. Set it to a long random value.'
  );
}

app.set('trust proxy', 1); // honour X-Forwarded-* when behind a cloud proxy

// --- Security headers -------------------------------------------------------
// All scripts are served from 'self' (libraries are vendored in public/lib).
// 'unsafe-inline' is allowed for styles only (Chart.js injects styles + a few
// inline style attributes). No inline scripts are used.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '256kb' }));

// --- Sessions (admin only) --------------------------------------------------
app.use(
  session({
    name: 'ess.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// ===========================================================================
//  PUBLIC API
// ===========================================================================

// Survey content + current status (used by both the form and the dashboard).
app.get('/api/survey', (req, res) => {
  res.json({
    content: effectiveSurvey(),
    status: db.getSurveyStatus(),
    headcount: parseHeadcount(),
  });
});

// Submit a response.
app.post('/api/responses', (req, res) => {
  if (db.getSurveyStatus() === 'closed') {
    return res.status(409).json({ error: 'survey_closed' });
  }
  const result = validateResponse(req.body, effectiveSurvey());
  if (!result.ok) {
    return res.status(400).json({ error: 'validation_failed', details: result.errors });
  }
  const stored = db.insertResponse(result.value);
  res.status(201).json({ ok: true, id: stored.id, submitted_at: stored.submitted_at });
});

// ===========================================================================
//  ADMIN AUTH
// ===========================================================================

// Lightweight in-memory login throttle (no external dependency): N failed
// attempts per IP per window. Successful logins reset the counter. trust proxy
// is set above so req.ip is the real client behind a cloud proxy.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
const loginFails = new Map(); // ip -> { count, first }

function loginThrottle(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginFails.get(ip);
  if (rec && now - rec.first > LOGIN_WINDOW_MS) loginFails.delete(ip);
  const cur = loginFails.get(ip);
  if (cur && cur.count >= LOGIN_MAX_FAILS) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  next();
}

function recordLoginFail(ip) {
  const now = Date.now();
  const rec = loginFails.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) loginFails.set(ip, { count: 1, first: now });
  else rec.count += 1;
  // Bound the map so it can't grow unboundedly.
  if (loginFails.size > 5000) loginFails.clear();
}

app.post('/api/admin/login', loginThrottle, (req, res) => {
  const { username, password } = req.body || {};
  const result = provider.verify(username, password);
  if (!result.ok) {
    recordLoginFail(req.ip || 'unknown');
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  loginFails.delete(req.ip || 'unknown');
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'session_error' });
    req.session.admin = result.user;
    res.json({ ok: true, user: result.user });
  });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ess.sid');
    res.json({ ok: true });
  });
});

app.get('/api/admin/session', (req, res) => {
  const admin = req.session && req.session.admin;
  res.json({
    authenticated: Boolean(admin),
    user: admin || null,
    provider: provider.name,
  });
});

// ===========================================================================
//  ADMIN DATA  (all require login)
// ===========================================================================

// Lightweight summary for live polling.
app.get('/api/admin/summary', requireAdmin, (req, res) => {
  res.json({
    count: db.countResponses(),
    status: db.getSurveyStatus(),
    headcount: parseHeadcount(),
    last_submitted_at: db.lastSubmittedAt(),
  });
});

// Full list of raw responses — the dashboard computes all charts/scores from this.
app.get('/api/admin/responses', requireAdmin, (req, res) => {
  res.json({
    count: db.countResponses(),
    status: db.getSurveyStatus(),
    headcount: parseHeadcount(),
    responses: db.getAllResponses(),
  });
});

// Close / reopen the survey.
app.post('/api/admin/survey-status', requireAdmin, (req, res) => {
  const requested = (req.body && req.body.status) || '';
  if (requested !== 'open' && requested !== 'closed') {
    return res.status(400).json({ error: 'invalid_status' });
  }
  const status = db.setSurveyStatus(requested);
  res.json({ ok: true, status });
});

// --- Survey configuration: add/remove questions & departments --------------

app.post('/api/admin/questions', requireAdmin, (req, res) => {
  const { themeId, text } = req.body || {};
  if (!themeId || typeof text !== 'string' || text.trim().length < 3) {
    return res.status(400).json({ error: 'invalid_question' });
  }
  if (!baseSurvey.themes.some((t) => String(t.id) === String(themeId))) {
    return res.status(400).json({ error: 'unknown_theme' });
  }
  const { result, id } = SurveyConfig.addQuestion(baseSurvey, db.getOverrides(), themeId, text);
  db.saveOverrides(result);
  res.status(201).json({ ok: true, id });
});

app.delete('/api/admin/questions/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  const eff = effectiveSurvey();
  const count = eff.themes.reduce((n, t) => n + t.questions.length, 0);
  if (count <= 1) return res.status(400).json({ error: 'last_question' });
  db.saveOverrides(SurveyConfig.removeQuestion(baseSurvey, db.getOverrides(), id));
  res.json({ ok: true });
});

app.post('/api/admin/departments', requireAdmin, (req, res) => {
  const name = ((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'invalid_department' });
  db.saveOverrides(SurveyConfig.addDepartment(baseSurvey, db.getOverrides(), name));
  res.status(201).json({ ok: true });
});

app.delete('/api/admin/departments/:name', requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  db.saveOverrides(SurveyConfig.removeDepartment(baseSurvey, db.getOverrides(), name));
  res.json({ ok: true });
});

// ===========================================================================
//  STATIC FRONTEND
// ===========================================================================

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Fallbacks
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] error:', err);
  res.status(500).json({ error: 'server_error' });
});

function parseHeadcount() {
  const n = Number(process.env.SURVEY_HEADCOUNT);
  return Number.isInteger(n) && n > 0 ? n : null;
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Employee Satisfaction Survey running`);
    console.log(`  ─────────────────────────────────────`);
    console.log(`  Public survey form :  http://localhost:${PORT}/`);
    console.log(`  Admin dashboard    :  http://localhost:${PORT}/admin`);
    console.log(`  Auth provider      :  ${provider.name}`);
    console.log(`  Database           :  ${db.DB_PATH}\n`);
  });
}

module.exports = app;
