'use strict';

/**
 * Employee Satisfaction Survey — web server (full app).
 *
 * Serves two surfaces from one deployment:
 *   • Public survey form  ->  /            (no login)
 *   • Admin dashboard     ->  /admin       (login required)
 *
 * Storage is pluggable (see db.js): SQLite locally, PostgreSQL on Azure. The DB
 * layer is async, so route handlers await it and the server boots inside an
 * async start() once the database is ready and the session secret is loaded.
 */

const path = require('path');
const os = require('os');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const db = require('./db');
const { baseSurvey, buildEffective, SurveyConfig, validateResponse } = require('./survey');
const { provider, requireAdmin } = require('./auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IS_PROD = process.env.NODE_ENV === 'production';

// Effective survey content = base + any admin overrides persisted in the DB.
async function effectiveSurvey() {
  return buildEffective(await db.getOverrides());
}

// Wrap async route handlers so a rejected promise reaches the error middleware
// (Express 4 does not do this automatically) instead of hanging the request.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// LAN addresses of this machine, so we can hand staff a clickable link locally.
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
  // Hosted online: prefer an explicit public URL; otherwise let the browser use
  // its own origin (the real https domain) — never a private container IP.
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  if (IS_PROD) return null;
  return lanUrls(PORT)[0] || null;
}

function parseHeadcount() {
  const n = Number(process.env.SURVEY_HEADCOUNT);
  return Number.isInteger(n) && n > 0 ? n : null;
}

app.set('trust proxy', 1); // honour X-Forwarded-* when behind a cloud proxy

// --- Security headers -------------------------------------------------------
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

// --- Admin login throttle (in-memory) ---------------------------------------
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
  if (loginFails.size > 5000) loginFails.clear();
}

// ===========================================================================
//  ROUTES  (registered after the session middleware, inside start())
// ===========================================================================
function registerRoutes() {
  // ---- Public API ----------------------------------------------------------

  // Survey content + current status (used by both the form and the dashboard).
  app.get(
    '/api/survey',
    ah(async (req, res) => {
      res.json({
        content: await effectiveSurvey(),
        status: await db.getSurveyStatus(),
        headcount: parseHeadcount(),
        networkUrl: primaryNetworkUrl(),
      });
    })
  );

  // Submit a response.
  app.post(
    '/api/responses',
    ah(async (req, res) => {
      if ((await db.getSurveyStatus()) === 'closed') {
        return res.status(409).json({ error: 'survey_closed' });
      }
      const result = validateResponse(req.body, await effectiveSurvey());
      if (!result.ok) {
        return res.status(400).json({ error: 'validation_failed', details: result.errors });
      }
      const stored = await db.insertResponse(result.value);
      res.status(201).json({ ok: true, id: stored.id, submitted_at: stored.submitted_at });
    })
  );

  // ---- Admin auth ----------------------------------------------------------

  app.post(
    '/api/admin/login',
    loginThrottle,
    ah(async (req, res) => {
      const { username, password } = req.body || {};
      const result = await provider.verify(username, password);
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
    })
  );

  app.post('/api/admin/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('ess.sid');
      res.json({ ok: true });
    });
  });

  app.get(
    '/api/admin/session',
    ah(async (req, res) => {
      const admin = req.session && req.session.admin;
      res.json({
        authenticated: Boolean(admin),
        user: admin || null,
        provider: provider.name,
        usingDefault: typeof provider.isDefault === 'function' ? await provider.isDefault() : false,
      });
    })
  );

  // ---- Admin data (require login) -----------------------------------------

  app.get(
    '/api/admin/summary',
    requireAdmin,
    ah(async (req, res) => {
      res.json({
        count: await db.countResponses(),
        status: await db.getSurveyStatus(),
        headcount: parseHeadcount(),
        last_submitted_at: await db.lastSubmittedAt(),
      });
    })
  );

  app.get(
    '/api/admin/responses',
    requireAdmin,
    ah(async (req, res) => {
      res.json({
        count: await db.countResponses(),
        status: await db.getSurveyStatus(),
        headcount: parseHeadcount(),
        responses: await db.getAllResponses(),
      });
    })
  );

  // Change the admin login (from Settings).
  app.post(
    '/api/admin/account',
    requireAdmin,
    ah(async (req, res) => {
      if (provider.name !== 'local' || typeof provider.updateAccount !== 'function') {
        return res.status(400).json({ error: 'unsupported' });
      }
      const { email, password } = req.body || {};
      const result = await provider.updateAccount(email, password);
      if (!result.ok) return res.status(400).json({ error: result.error });
      // Rotate the session id on a credential change (session-fixation
      // hardening), mirroring the login handler.
      req.session.regenerate((err) => {
        if (err) return res.status(500).json({ error: 'session_error' });
        req.session.admin = result.user;
        res.json({ ok: true, user: result.user });
      });
    })
  );

  // Close / reopen the survey.
  app.post(
    '/api/admin/survey-status',
    requireAdmin,
    ah(async (req, res) => {
      const requested = (req.body && req.body.status) || '';
      if (requested !== 'open' && requested !== 'closed') {
        return res.status(400).json({ error: 'invalid_status' });
      }
      const status = await db.setSurveyStatus(requested);
      res.json({ ok: true, status });
    })
  );

  // ---- Survey configuration: add/remove questions & departments -----------

  app.post(
    '/api/admin/questions',
    requireAdmin,
    ah(async (req, res) => {
      const { themeId, text } = req.body || {};
      if (!themeId || typeof text !== 'string' || text.trim().length < 3) {
        return res.status(400).json({ error: 'invalid_question' });
      }
      if (!baseSurvey.themes.some((t) => String(t.id) === String(themeId))) {
        return res.status(400).json({ error: 'unknown_theme' });
      }
      const { result, id } = SurveyConfig.addQuestion(baseSurvey, await db.getOverrides(), themeId, text);
      await db.saveOverrides(result);
      res.status(201).json({ ok: true, id });
    })
  );

  app.delete(
    '/api/admin/questions/:id',
    requireAdmin,
    ah(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
      const eff = await effectiveSurvey();
      const count = eff.themes.reduce((n, t) => n + t.questions.length, 0);
      if (count <= 1) return res.status(400).json({ error: 'last_question' });
      await db.saveOverrides(SurveyConfig.removeQuestion(baseSurvey, await db.getOverrides(), id));
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/admin/departments',
    requireAdmin,
    ah(async (req, res) => {
      const name = ((req.body && req.body.name) || '').trim();
      if (!name) return res.status(400).json({ error: 'invalid_department' });
      await db.saveOverrides(SurveyConfig.addDepartment(baseSurvey, await db.getOverrides(), name));
      res.status(201).json({ ok: true });
    })
  );

  app.delete(
    '/api/admin/departments/:name',
    requireAdmin,
    ah(async (req, res) => {
      const name = decodeURIComponent(req.params.name);
      await db.saveOverrides(SurveyConfig.removeDepartment(baseSurvey, await db.getOverrides(), name));
      res.json({ ok: true });
    })
  );

  // ---- Static frontend -----------------------------------------------------
  app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[server] error:', err);
    res.status(500).json({ error: 'server_error' });
  });
}

// ===========================================================================
//  BOOTSTRAP
// ===========================================================================
async function start({ listen = true } = {}) {
  // 1. Database ready (creates tables, seeds defaults).
  await db.init();

  // 2. Session middleware (needs the persisted secret).
  const sessionSecret = process.env.SESSION_SECRET || (await db.getOrCreateSessionSecret());
  app.use(
    session({
      name: 'ess.sid',
      secret: sessionSecret,
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

  // 3. Routes.
  registerRoutes();

  // 4. Listen.
  if (listen) {
    await new Promise((resolve) => app.listen(PORT, resolve));
    printBanner();
  }
  return app;
}

function printBanner() {
  if (IS_PROD) {
    console.log(`\n  Employee Satisfaction Survey — running ONLINE (production) on port ${PORT}.`);
    if (process.env.PUBLIC_URL) {
      console.log(`  Public link : ${process.env.PUBLIC_URL}`);
      console.log(`  Admin       : ${process.env.PUBLIC_URL.replace(/\/+$/, '')}/admin`);
    }
    console.log(`  Database    : ${db.label}\n`);
    return;
  }
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
  console.log(`   responses saved in: ${db.label}\n`);
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
}

module.exports = { app, start };
