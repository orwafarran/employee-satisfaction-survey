# Install Guide — Employee Satisfaction Survey (Microsoft Azure)

This guide deploys the app **online on Microsoft Azure** so any employee can open
the survey from anywhere, any time — nothing runs on anyone's PC, and it's always
on. Follow it once; after that the admin just uses a web link.

> **Who should do this:** someone comfortable signing in to the Azure portal
> (the company's IT, or whoever manages their Microsoft 365 / Azure). It takes
> about 30–45 minutes. You do **not** need anyone's Microsoft password — you sign
> in with your own Azure access.

**What you end up with:** a link like `https://yourcompany-survey.azurewebsites.net`
— the admin opens `/admin`, signs in, and emails the survey link to staff.

---

## Before you start — what you need

1. **An Azure subscription.** You sign in to Azure with your normal **Microsoft 365
   account** (the same email you use for Outlook). If the company has never used
   Azure, the first time you'll be asked to **create a subscription** — this needs a
   payment method, because Azure is pay-as-you-go. A small survey costs roughly
   **$20–30 / month** (the web app + the database).
2. **This code** — this folder (you'll upload it in Part D), or its GitHub repository.
3. **About 30–45 minutes**, and some comfort with the Azure portal. **If that's not
   you, hand this guide to whoever manages the company's Microsoft 365 / IT** — or
   ask Orwa to do it with you. (It is a one-time setup; after it, the admin only ever
   opens a web link.)

The app needs two Azure pieces: a **database** (stores the answers) and a **web app**
(runs the survey). You create both, then connect them.

---

## Part A — Create the database (Azure Database for PostgreSQL)

1. In the [Azure portal](https://portal.azure.com): **Create a resource** →
   search **Azure Database for PostgreSQL** → choose **Flexible server** →
   **Create**.
2. Fill in:
   - **Server name:** e.g. `yourcompany-survey-db` (must be globally unique)
   - **Region:** the one closest to the company
   - **Workload type:** *Development* (cheapest — fine for a survey)
   - **Authentication:** PostgreSQL authentication
   - **Admin username** and **password** — **write these down**.
3. **Next: Networking** →
   - **Public access (allowed IP addresses)**
   - Tick **Allow public access to this resource through the internet using a
     firewall**, and tick **Allow Azure services… to access this server**.
   - (Optional, for testing from your own PC: **Add current client IP address**.)
4. **Review + create** → **Create**. Wait a few minutes.
5. Open the new server → **Databases** → **Add** → create one named **`survey`**.

**Your connection string** (you'll paste this in Part C) looks like:

```
postgresql://ADMINUSER:PASSWORD@SERVERNAME.postgres.database.azure.com:5432/survey?sslmode=require
```

Replace `ADMINUSER`, `PASSWORD`, and `SERVERNAME` with your values. If the
password has special characters (`@ : / ? #`), URL-encode them (e.g. `@` → `%40`).

---

## Part B — Create the web app (Azure App Service)

1. **Create a resource** → **Web App** → **Create**.
2. Fill in:
   - **Name:** e.g. `yourcompany-survey` → this becomes the link
     `https://yourcompany-survey.azurewebsites.net`
   - **Publish:** **Code**
   - **Runtime stack:** **Node 22 LTS** (or Node 20 LTS)
   - **Operating System:** **Linux**
   - **Region:** same as the database
   - **Pricing plan:** **Basic B1** (always on). Avoid Free/F1 for real use — it
     sleeps.
3. **Review + create** → **Create**.

---

## Part C — Connect the web app to the database

1. Open the Web App → **Settings** → **Environment variables** (a.k.a.
   **Configuration** → **Application settings**).
2. Add these settings (**+ Add** for each), then **Apply**/**Save**:

   | Name | Value |
   |------|-------|
   | `DATABASE_URL` | the connection string from Part A |
   | `NODE_ENV` | `production` |
   | `PUBLIC_URL` | `https://yourcompany-survey.azurewebsites.net` (your app's URL) |

   That's all that's required. (The app creates its own tables on first start
   and generates its session secret automatically.)

---

## Part D — Put the code on the web app

Pick **one** of these.

**Option 1 — from this folder, no GitHub needed (ZIP upload):**

1. Make a **ZIP of this folder** — but **delete the `node_modules` folder first**
   (Azure rebuilds it; it just makes the upload huge).
2. In a browser, go to **`https://<your-app-name>.scm.azurewebsites.net/ZipDeployUI`**
   (your Part B app name, with `.scm` in the middle) and sign in with your Microsoft
   account.
3. **Drag the ZIP** onto that page. Azure installs and starts the app (a few minutes).

**Option 2 — from GitHub (auto-updates on future changes):**

1. Put the code in a GitHub repository (or ask Orwa to share the existing one).
2. Web App → **Deployment** → **Deployment Center** → **Source: GitHub** → authorize →
   pick the repo and the **`main`** branch → **Save**.
3. Azure builds (`npm install`) and starts it automatically. Wait a few minutes.

> If the app doesn't respond after deploying, open Web App → **Settings →
> Configuration → General settings**, set **Startup Command** to
> `node server/server.js`, and **Restart**.

---

## Part E — First sign-in (one time)

1. Open **`https://yourcompany-survey.azurewebsites.net/admin`**.
2. Sign in with the default login: **`admin`** / **`admin`**.
3. Click **⚙ Settings** at the top → enter the admin's real **company (Microsoft)
   email** and a password → **Save**. The default `admin/admin` stops working.

---

## Part F — Send it to staff

In the dashboard, click **Copy survey link**, paste it into an Outlook email, and
send it to staff. Anyone can open it from anywhere. The dashboard fills in live as
answers arrive — charts, theme scores, the overall %, and the per-department
breakdowns all update automatically. Use **Excel** / **PDF** to download reports.

---

## Troubleshooting

- **Page shows an error / won't load:** open Web App → **Log stream** and look at
  the latest lines. The most common cause is a wrong `DATABASE_URL` (check the
  password and that the database name `survey` exists).
- **Database connection refused:** in the PostgreSQL server → **Networking**,
  confirm **Allow Azure services… to access this server** is ticked.
- **Certificate error connecting to the database:** add an app setting
  `DATABASE_SSL` = `no-verify` and restart. (The connection stays encrypted; it
  just skips certificate verification.)
- **"Copy survey link" shows the wrong address:** set `PUBLIC_URL` (Part C) to the
  app's real `https://…azurewebsites.net` URL and restart.

---

## Appendix — Run it locally to test first (optional)

You can run the whole thing on a PC before deploying, with the built-in file
database (no Postgres needed):

```bash
npm install
npm start
```

Then open `http://localhost:3000/admin` and sign in with `admin` / `admin`.
(See `START-HERE.txt` for the non-technical, double-click version.)
