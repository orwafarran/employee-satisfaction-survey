# Employee Satisfaction Survey — Web App

A web app to run a 35-question employee satisfaction survey. Two surfaces, one
codebase:

- **Public survey form** (`/`) — what employees open from a shared link. No
  login, mobile-first, anonymous. They fill it in, hit submit, their answers are
  stored.
- **Private admin dashboard** (`/admin`) — login-protected. Live respondent
  count, donut charts per question and per theme, the 8 theme scores and a
  headline overall-satisfaction %, demographic breakdowns, per-response
  drill-down, and one-click export to Excel / PDF.

Built in the phases described in `EmployeeSurvey_BuildSpec_for_CD.md`. **Phases
1–5 are complete and run locally with zero external services.** Phase 6
(production deploy to the client's Microsoft cloud) is intentionally deferred
until the host is confirmed — see [`docs/IT-DEPLOYMENT-GUIDE.md`](docs/IT-DEPLOYMENT-GUIDE.md).

---

## The three deliverables (don't conflate them)

1. **Source code** (this repo) — the owned copy.
2. **GitHub Pages demo** (`/demo`) — a clickable preview with **fake sample
   data** to show the client "here's your webapp." Not the live tool; collects
   no real responses.
3. **Production deployment** in the client's Microsoft cloud — the real system,
   reached by a real link. **Deferred** (needs the confirmed host).

---

## Run it for real on a Windows PC (the client setup — no command line)

For the client running the app on their own PC:

1. Install **Node.js** once — <https://nodejs.org> → green **LTS** button → Next / Next / Install.
2. Double-click **`start.bat`** in this folder. A window opens; the dashboard opens in the browser.
3. **First run:** create your admin login (your email + a password). It's hashed and saved locally — no config files, no default password.
4. Click **Copy survey link** and email it to staff. The app starts **empty** and fills in **live** as answers arrive.

Step-by-step guides for the (non-technical) client are in the folder:
**`START-HERE.txt`** and **`Survey App - Setup Guide (Windows).docx`**.

> **Network reality:** running on a local PC means staff reach the survey over the
> **office network/Wi-Fi** while the PC is on. For staff outside the office, host it
> online instead — see [`docs/IT-DEPLOYMENT-GUIDE.md`](docs/IT-DEPLOYMENT-GUIDE.md).

---

## Quick start (full local app)

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite` — no native build
step, no database server to install).

```bash
npm install
npm run seed       # loads 44 sample responses (the client's real distribution)
npm start          # http://localhost:3000/  and  http://localhost:3000/admin
```

**Admin login** — the first time you open `/admin`, you create your own login
(email + password). It's hashed with scrypt and stored in the local database;
there is no default password and no config file to edit. After that, you just
sign in. (Advanced/cloud deploys can still pre-seed `ADMIN_USERNAME` +
`ADMIN_PASSWORD_HASH` — see [Admin authentication](#admin-authentication).)

### Verify it works
- Open `http://localhost:3000/` — fill the survey, submit, see the thank-you.
- Open `http://localhost:3000/admin` — log in. You'll see 45 responses (44
  seeded + your submission), the **84.4%** headline, charts, drill-down, and
  working Excel/PDF export.
- Click **Close survey**, then try to submit on the form → it's blocked with a
  "survey is now closed" message. **Reopen** to allow submissions again.

---

## The GitHub Pages demo (`/demo`)

The demo is the **same frontend** switched to "demo" mode: it uses bundled
sample data + your browser's localStorage instead of a server.

```bash
npm run build:demo            # writes the static site to /demo
node scripts/serve-demo.js    # preview at http://localhost:4000/  (and /admin.html)
```

The demo dashboard shows the client's **real results** (headline 84.4%, real
per-question distributions) so it looks convincing — but it is clearly labelled
as a demo and stores nothing on any server.

**To publish** to the operator's GitHub Pages account (when you're ready):
push this repo, then in GitHub **Settings → Pages** set the source to the
`/demo` folder on `main` (or push `/demo` to a `gh-pages` branch). The result is
a public `https://<operator>.github.io/<repo>/` link.
> Not done automatically — publishing is an outward-facing step left to the operator.

---

## How the overall % is calculated (matches the client's Excel)

The client's original spreadsheet ("Employee Satisfaction Results.xlsx") reports
an **84.4%** overall figure. We reverse-engineered the exact method:

```
overall satisfaction % = (Agree + Strongly Agree answers) / (respondents × 35)
```

On the real data that's `1300 / (44 × 35) = 1300 / 1540 = 84.4%` — a **positive
rate**. This is the headline number on the dashboard, so it matches what the
client already knows.

The spec also defined a *mean-based* index, `((mean − 1) / 3) × 100`, which gives
~75.6% on the same data. That's a different, stricter measure — we surface it as
a **secondary** stat ("Satisfaction index"), along with the average rating
(3.26 / 4), so nothing is hidden, but the **headline matches the client**.

`scripts/verify-scoring.js` asserts the engine reproduces the Excel numbers:

```bash
node scripts/verify-scoring.js   # ✅ overall 84.42%, 1300/1540, demographics = 44
```

---

## Decisions & defaults

Confirmed against the client's Excel; change only if the operator says so:

| Item | Setting | Source |
|---|---|---|
| Overall % method | Positive rate `(A+SA)/(N×35)` → 84.4% headline | Matches client Excel |
| Departments | Production, QA/QC, Planning, Design, Erection, Maintenance, Service & Control | Excel |
| Length of service | <1yr, 1–2, 3–5, 5–10, >10 years | Excel |
| Age bands | 20–25, 26–30, 31–35, 36–40, >40 | Excel |
| Gender | Male, Female | Excel |
| Validation | All 35 ratings required, all demographics required, comment optional | Spec default |
| Anonymity | No name / email / IP stored, ever | Spec |
| One shared link | Yes (not per-person links) | Spec |

**Still worth confirming with the operator** (sensible defaults are in place):
the survey question wording uses the spec's cleaned phrasing (the Excel had a few
typos); department list is editable; headcount `N` for "X of N" is configurable.

To edit the survey content, change **one file**:
[`public/survey-content.json`](public/survey-content.json) — the server and the
browser both read it.

---

## Admin authentication

Pluggable by design (`server/auth/`). Today: a single local admin (username +
**scrypt-hashed** password). Tomorrow: Microsoft Entra ID SSO drops in at
Phase 6 (`server/auth/entra.js` is the documented seam) by setting
`AUTH_PROVIDER=entra`.

Configure via environment (see `.env.example`):

```bash
ADMIN_USERNAME=admin
node scripts/hash-password.js "a strong password"   # prints a scrypt$ hash
ADMIN_PASSWORD_HASH=scrypt$...                       # set this in the host
SESSION_SECRET=<long random string>
```

The public survey form has **no** auth.

---

## Project structure

```
public/                  Frontend (served by the app AND published as the static demo)
  survey-content.json    THE survey: 35 questions, 8 themes, demographics (single source of truth)
  index.html             Public survey form
  admin.html             Admin dashboard
  js/
    config.js            Runtime mode flag (api | demo)
    data.js              Data layer — ApiBackend (server) + DemoBackend (static)
    survey-form.js       Form rendering, validation, submit
    scoring.js           Scoring engine (client's 84.4% method) — also runs in Node
    charts.js            Chart.js donut helpers
    admin.js             Dashboard controller (auth, live polling, render, drill-down)
    export.js            Excel + PDF export (client-side)
  css/                   styles.css (shared) + admin.css (dashboard)
server/
  server.js              Express app: API + static + sessions + security headers
  db.js                  Storage (node:sqlite); ports to a managed DB at Phase 6
  survey.js              Loads survey-content.json + validates submissions
  auth/                  Pluggable auth: index, local (scrypt), entra (Phase 6 seam), hash
scripts/
  seed.js                Seed the DB with the sample data
  build-demo.js          Build the static /demo
  serve-demo.js          Preview the static /demo locally
  verify-scoring.js      Assert scoring matches the client's Excel
  hash-password.js       Generate an admin password hash
  lib/sample-generator.js  Deterministic sample data (reproduces the real 84.4%)
docs/
  IT-DEPLOYMENT-GUIDE.md Phase 6 deployment steps (finalize once host is known)
Dockerfile               Host-agnostic container for Phase 6
```

---

## npm scripts

| Command | What it does |
|---|---|
| `npm start` | Run the full app (port 3000) |
| `npm run dev` | Run with auto-reload |
| `npm run seed` | Reset + load the 44-response sample |
| `npm run reset` | Clear all responses |
| `npm run build:demo` | Build the static `/demo` |
| `node scripts/verify-scoring.js` | Verify scoring vs. the client's Excel |

---

## Honest constraints

- GitHub Pages can't host the real backend or store confidential responses —
  that's why deliverable #2 is a demo and #3 is the real thing.
- Because the live form has no login and no name field, responses are genuinely
  anonymous — better than the old "email the Excel back" method.
- The only thing blocking production is the confirmed Microsoft host. Everything
  through Phase 5 is done and runs locally.
