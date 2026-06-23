# IT Deployment Guide — Employee Satisfaction Survey

> ⚠️ **Superseded:** the client chose **Azure**, and the step-by-step deploy
> guide now lives in **[`../INSTALL.md`](../INSTALL.md)** (Azure App Service +
> Azure Database for PostgreSQL). This file is kept for background only.

**Audience:** the client's IT person.
**Status:** background notes. The exact button-clicks depend on which host the
client uses (Azure App Service / Azure Static Web Apps + a small API / an
in-tenant option). The
steps below are written for **Azure App Service**, the most common choice, and
note where they differ.

> **This is a cloud deployment, not a desktop install.** Nothing runs on the
> admin's personal PC. The admin only uses the dashboard in a web browser. A
> shared survey link must be reachable on the internet at all times, which a
> personal PC cannot provide safely — hence the cloud.

---

## What you are deploying

One small Node.js web service that serves both:
- the **public survey form** (the link you send to staff), and
- the **private admin dashboard** (login-protected).

It stores anonymous responses in a database. No names, emails, or IP addresses
are collected.

**Requirements:** Node.js 22.5+ runtime, one small database, HTTPS (Azure
provides this automatically).

---

## Step 1 — Get the code

Clone or download the handover repository (the operator will share it). You need
the whole repo, not just a link.

```bash
git clone <handover-repo-url>
cd <repo>
```

## Step 2 — Deploy it to the client's Microsoft cloud

**Azure App Service (recommended):**
1. In the Azure Portal, create a **Web App** → runtime stack **Node 22 LTS**,
   OS **Linux**.
2. Deploy the repo to it (any one of):
   - **VS Code Azure extension** → "Deploy to Web App", or
   - **GitHub Actions** (connect the repo in the App Service "Deployment Center"), or
   - `az webapp up --runtime "NODE:22-lts"` from the repo folder.
3. App Service runs `npm install` then `npm start` automatically.

A container option is included (`Dockerfile`) if the client prefers Azure
Container Apps / App Service for Containers.

## Step 3 — Set up the database

For local/dev the app uses the built-in file database (`node:sqlite`). For
production, use a **managed** database so data is durable and backed up:

1. Create **Azure Database for PostgreSQL** (or Azure SQL).
2. Only one file needs to change to point at it: **`server/db.js`** (it isolates
   all SQL). Swap the `node:sqlite` calls for the managed-DB client and set the
   connection string as an app setting `DB_PATH` / `DATABASE_URL`.
3. The table shape is already defined in `server/db.js` (`responses`,
   `settings`) — create the equivalent tables in the managed DB.

> If you prefer the simplest possible Phase-6, App Service can also run with a
> persistent mounted file for `node:sqlite`, but a managed DB is the
> recommended, durable choice.

## Step 4 — Set the admin login (or connect Microsoft sign-in)

In the Web App **Configuration → Application settings**, add:

| Setting | Value |
|---|---|
| `SESSION_SECRET` | a long random string |
| `ADMIN_USERNAME` | the admin's username |
| `ADMIN_PASSWORD_HASH` | run `node scripts/hash-password.js "strong password"` and paste the output |
| `NODE_ENV` | `production` |
| `SURVEY_HEADCOUNT` | (optional) total staff count, to show "X of N" |

**To use Microsoft sign-in (Entra ID SSO) instead of a password:**
1. Register an app in the client's Entra tenant; note Tenant ID, Client ID,
   Client Secret, and the Redirect URI.
2. Set `AUTH_PROVIDER=entra` plus `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
   `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`.
3. Complete the integration in `server/auth/entra.js` (the file documents
   exactly what to fill in). The rest of the app already works against it.

## Step 5 — Get the links

After deployment Azure gives you a base URL, e.g.
`https://<app-name>.azurewebsites.net`.

- **Survey link (for staff):** `https://<app-name>.azurewebsites.net/`
- **Admin dashboard:** `https://<app-name>.azurewebsites.net/admin`

Optionally map a custom domain (e.g. `survey.company.com`) in App Service →
Custom domains.

## Step 6 — Send it to staff

The admin pastes the **survey link** into a normal Outlook email and sends it to
all staff. Employees click it, fill the form on their phone or computer, and
submit. The admin watches responses arrive live on the dashboard.

---

## Operating notes

- **HTTPS only:** the session cookie is marked `secure` when `NODE_ENV=production`
  — make sure the app is served over HTTPS (Azure does this by default).
- **Backups:** rely on the managed DB's automated backups.
- **Closing the survey:** the admin clicks "Close survey" in the dashboard; the
  public form then refuses new submissions. "Reopen survey" re-enables it.
- **Anonymity:** the data model stores no identifying fields. Keep it that way.
- **Scaling:** for more than one App Service instance, move the session store
  off the default in-memory store (e.g. to Redis) — single instance is fine for
  one admin.
