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
const os = require('os');
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

// --- Session secret ---------------------------------------------------------
// An explicit SESSION_SECRET wins (cloud deployments). Otherwise the app
// generates a strong random secret on first run and persists it in the local
// database — so the run-on-my-own-PC setup is secure with zero configuration.
const SESSION_SECRET = process.env.SESSION_SECRET || db.getOrCreateSessionSecret();

// LAN addresses of this machine, so we can hand staff a clickable link.
function lanUrls(port) {
  const urls = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${port}`);
    }
  }
  return urls;
}
function primaryNetworkUrl() {
  return lanUrls(PORT)[0] || null;
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
    networkUrl: primaryNetworkUrl(),
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

// First-run setup: create the single admin account (email + password). Only
// works while no account exists yet; afterwards it's a no-op (409).
app.post('/api/admin/setup', loginThrottle, (req, res) => {
  if (provider.name !== 'local' || typeof provider.setup !== 'function') {
    return res.status(400).json({ error: 'setup_unsupported' });
  }
  if (provider.isConfigured()) return res.status(409).json({ error: 'already_configured' });
  const { email, password } = req.body || {};
  const result = provider.setup(email, password);
  if (!result.ok) return res.status(400).json({ error: result.error });
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'session_error' });
    req.session.admin = result.user;
    res.status(201).json({ ok: true, user: result.user });
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
    configured: typeof provider.isConfigured === 'function' ? provider.isConfigured() : true,
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
    const net = lanUrls(PORT);
    console.log(`\n  ============================================================`);
    console.log(`   Employee Satisfaction Survey is RUNNING. Keep this window open.`);
    console.log(`  ============================================================\n`);
    console.log(`   YOU (admin) — open the dashboard on this PC:`);
    console.log(`       http://localhost:${PORT}/admin\n`);
    if (net.length) {
      console.log(`   STAFF — email them this survey link (same office network):`);
      net.forEach((u) => console.log(`       ${u}/`));
    } else {
      console.log(`   Survey link (no network detected):  http://localhost:${PORT}/`);
    }
    console.log(`\n   To stop the app: just close this window.`);
    console.log(`  ------------------------------------------------------------`);
    console.log(`   responses saved in: ${db.DB_PATH}\n`);
  });
}

module.exports = app;
