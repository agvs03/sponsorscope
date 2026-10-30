# Turning on login + daily job alerts — step by step

Total time: about 40 minutes. Everything is free. Do the parts in order.

## What is safe to share with Claude

| Value | Where it's from | Share in chat? |
|---|---|---|
| Supabase **Project URL** | Supabase → Project Settings → API | ✅ Yes (public) |
| Supabase **anon public** key | Supabase → Project Settings → API | ✅ Yes (public by design) |
| Supabase **service_role** key | Supabase → Project Settings → API | ❌ NO — only into GitHub secrets |
| Supabase **database password** | You choose it in Part A | ❌ NO — keep it in your password manager |
| **Resend API key** | Resend → API Keys | ❌ NO — only into Supabase SMTP + GitHub secrets |
| **Google Client Secret** | Google Cloud → Credentials | ❌ NO — only into Supabase |

---

## Part A — Create the database (Supabase) · 10 min

1. Open **https://supabase.com** → **Start your project** → **Continue with GitHub** (use your agvs03 account).
2. If asked, create an organization: name `agvs03`, plan **Free**.
3. Click **New project**:
   - Name: `sponsorpilot`
   - Database password: click **Generate a password**, then copy it into your password manager.
   - Region: **East US (North Virginia)**
   - Click **Create new project**. Wait about 2 minutes until the dashboard loads.
4. Left sidebar → **SQL Editor** → **+ New query**.
5. On your laptop, open `C:\Personal\Projects\sponsorscope\supabase\schema.sql` in Notepad → **Ctrl+A**, **Ctrl+C**.
6. Paste it into the SQL Editor → click **Run** (bottom right).
   ✅ Expected: "Success. No rows returned".
   If it asks to confirm "destructive operation", click **Run this query** (it only drops and re-creates the policies it owns).
7. Left sidebar → **Authentication** → **URL Configuration**:
   - **Site URL**: `https://jobs.arikatla.dev` → **Save**
   - **Redirect URLs** → **Add URL** → `https://jobs.arikatla.dev` → **Save URLs**
8. Left sidebar → **Project Settings** (gear icon) → **API** (it may be named **Data API** or **API Keys**). Copy:
   - **Project URL**: looks like `https://abcdefgh.supabase.co`
   - **anon public** key: a long string starting with `eyJ`

➡️ **Send those two values to Claude.** Claude turns on login on the site and tests email sign-in.
(Email sign-in already works at this point, but Supabase's built-in sender only allows a few emails per hour. Part C fixes that.)

---

## Part B — Email sending (Resend) · 10 min + DNS wait

1. Open **https://resend.com** → **Sign up** (GitHub or email).
2. Left menu → **Domains** → **+ Add Domain** → type `arikatla.dev` → Region **North Virginia (us-east-1)** → **Add**.
3. Resend shows about 3–4 DNS records (an MX record and TXT records such as `resend._domainkey` and one for `send`). Keep this tab open.
4. In a new tab, open **Squarespace** → **Domains** → **arikatla.dev** → **DNS** (or **DNS Settings**) → **Add record**. Add each record from Resend exactly:
   - **Type**: same as Resend (MX or TXT)
   - **Host**: what Resend shows in "Name". If Resend shows `send.arikatla.dev`, enter just `send`.
   - **Data/Value**: copy and paste from Resend
   - For MX: **Priority** is the number Resend shows (usually 10)
   - **Save** each one.
   ⚠️ Don't change or delete your existing records (the `@` GitHub records or `jobs` CNAME).
5. Back in Resend → click **Verify DNS Records**. It can take 5 minutes to a few hours. Wait until the status shows **Verified** ✅.
6. Resend left menu → **API Keys** → **+ Create API Key**:
   - Name `sponsorpilot`, Permission **Sending access**, Domain `arikatla.dev` → **Add**
   - **Copy the key now** (it starts with `re_`; it's shown only once). Put it in your password manager. ❌ Don't send it to Claude.

## Part C — Make Supabase use Resend for sign-in emails · 3 min

1. Supabase → **Authentication** → **Emails** (or **Settings → SMTP**) → **SMTP Settings** → turn on **Enable custom SMTP**.
2. Fill in:
   - Sender email: `login@arikatla.dev`
   - Sender name: `SponsorPilot`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: your Resend API key (`re_...`)
3. **Save**.

---

## Part D — "Continue with Google" button · 15 min

1. Open **https://console.cloud.google.com** → top bar project picker → **New Project** → name `SponsorPilot` → **Create** → select it.
2. Menu ☰ → **APIs & Services** → **OAuth consent screen** (may be called **Google Auth Platform → Branding**):
   - **Get started** / User type: **External**
   - App name `SponsorPilot`, User support email: your email
   - Authorized domains: add `arikatla.dev` and `supabase.co`
   - Developer contact email: your email → **Save / Create**
   - **Audience** (or Publishing status) → **Publish app** → confirm. Basic email sign-in doesn't need Google review.
3. ☰ → **APIs & Services** → **Credentials** (or **Clients**) → **+ Create credentials** → **OAuth client ID**:
   - Application type: **Web application**, Name `SponsorPilot web`
   - **Authorized JavaScript origins** → Add: `https://jobs.arikatla.dev`
   - **Authorized redirect URIs** → Add: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
     (use your Project URL from Part A step 8 + `/auth/v1/callback`)
   - **Create**. Copy the **Client ID** and **Client Secret**.
4. Supabase → **Authentication** → **Sign In / Providers** (or **Providers**) → **Google** → **Enable** → paste the Client ID and Client Secret → **Save**.

---

## Part E — Let the nightly job send alert emails (GitHub secrets) · 5 min

1. Open **https://github.com/agvs03/sponsorscope** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add these 4, one at a time (Name exactly as written, then paste the value):

| Name | Value |
|---|---|
| `SUPABASE_URL` | your Project URL (`https://….supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** → Reveal → copy |
| `RESEND_API_KEY` | your Resend key (`re_...`) |
| `ALERT_FROM` | `SponsorPilot <alerts@arikatla.dev>` |

2. Tell Claude "secrets added". Nothing else to run: the 2 AM job picks them up automatically.

---

## Part F — Try it yourself (after Claude switches login on)

1. Open **https://jobs.arikatla.dev** → top right **Sign in** → **Continue with Google** (or enter your email → **Email me a sign-in link** → click the link in your inbox).
2. **Resume Builder** → **Upload resume** → check the skills → **Save** (it should say "Saved to your account").
3. **Find Jobs** → type `java`, location `MN` or `remote` → **🔔 Alert me** (it should show "✓ Alert saved").
4. Open the site on your phone and sign in: your resume and tracker should be there.
5. The next morning after 2 AM, you get one email with the new matching jobs (only if new ones were posted).
