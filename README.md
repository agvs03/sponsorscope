# SponsorPilot

**End-to-end job hunting for people who need visa sponsorship.**

Build your resume, search **real jobs at U.S. employers that actually sponsor**,
see your fit to each role, get a tailored application draft, and track it all —
in one free site, no login. Sponsorship signals come from public government
disclosure data; jobs come from employers' own public career-board APIs.

> **Honest scope.** Sponsorship history is public fact, not a promise for any
> future role. Fit scores are a keyword-overlap guide, not a prediction. It is
> **not** legal or immigration advice. Drafts are yours to review and send —
> the app never sends anything on your behalf.

---

## What it does (end to end)

1. **Resume Builder** — a clean, ATS-friendly resume in the browser. Live
   preview, one-click print/PDF, saved locally (never uploaded).
2. **Find Jobs** — search any role/location; results are **filtered to employers
   with sponsorship history** and ranked by your resume fit + sponsorship
   strength (rising / steady / declining).
3. **Fit + Draft** — each job shows your skill match, the company's sponsorship
   track record, typical wage, and a **tailored application note you edit and
   send yourself**.
4. **Tracker** — save jobs and move them through Saved → Applied → Interviewing →
   Offer, stored privately in your browser.

## What's real vs. what isn't (by design)

| Feature | Status | Basis |
|---|---|---|
| Sponsorship history, trend, approval rate, wages | ✅ Real | Public DOL LCA + USCIS Employer Data Hub |
| Job listings | ✅ Real | Employers' official ATS APIs (Greenhouse/Lever/Ashby) — **no scraping** |
| Resume ↔ job fit | ✅ Honest heuristic | Transparent keyword overlap, labeled as a guide |
| Application drafts | ✅ You send them | Generated draft; **never auto-sent** (auto-emailing recruiters is illegal spam) |
| "Interview probability" | ❌ Not built | No public ground-truth data exists — it would be fabricated |
| Recruiter scraping / auto-outreach | ❌ Not built | ToS / CAN-SPAM / GDPR violations |

## Architecture

```
DOL LCA + USCIS ┐                         ┌─ web/data/employers.json (sponsorship)
                ├─► pipeline/build.py ─────┤
ATS job boards ─┘   pipeline/jobs.py       └─ web/data/jobs.json (sponsor-friendly jobs)
  (Greenhouse/Lever/Ashby, official APIs)                   │
                                                            ▼
                              web/  — static client-side app (resume + search +
                                       fit + tracker). No backend, no login,
                                       free on GitHub Pages.
```

The whole app is client-side: the resume and tracker live in your browser
(`localStorage`), and the job/sponsorship data is pre-built JSON. That's why it
hosts free and works for anyone with just a URL.

## Data sources (free, public domain — 17 U.S.C. §105)

- **DOL OFLC LCA Disclosure Data** — <https://www.dol.gov/agencies/eta/foreign-labor/performance>
- **USCIS H-1B Employer Data Hub** — <https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub>
- **Jobs** — employers' public ATS boards (Greenhouse/Lever/Ashby). Run `python -m pipeline.sources` for details.

## Quick start (no downloads)

```bash
pip install -r requirements.txt
python scripts/build_sample_site.py     # build sponsorship data from synthetic input
python -m http.server -d web 8080       # open http://localhost:8080
```

The site ships with sample jobs + a visible **"sample data"** banner so nothing
is mistaken for real figures until you connect real sources.

## Roadmap

- [x] Resume builder, sponsor-filtered job search, fit scoring, drafts, tracker (this MVP)
- [x] `pipeline/jobs.py` — live ingestion of sponsoring companies' ATS boards (Greenhouse/Lever/Ashby) into `web/data/jobs.json` (seed list in `pipeline/companies.yaml`)
- [x] Optional **AI layer** (Claude API, bring-your-own-key): resume-tailored drafts + honest fit explanations (⚙ AI menu)
- [ ] Saved-search **agent**: notify you when new sponsor-friendly jobs match
- [x] Nightly live feed: `.github/workflows/nightly.yml` scans 400+ sponsoring employers' boards (Greenhouse/Lever/Ashby/Workday/iCIMS) with the career-ops scanner and redeploys
- [x] Resume upload (PDF/DOCX/TXT, parsed in the browser) → skill extraction → fit ranking
- [ ] Accounts: saved resume + tracker across devices, daily "new matches" email

### Using the AI features

The site works fully without AI. To enable Claude-powered draft tailoring and fit
explanations, open the **⚙ AI** menu and paste your own
[Anthropic API key](https://console.anthropic.com/settings/keys). It's stored only in
your browser and used only for your own calls (you pay Anthropic for usage) — nothing
is sent to us. This keeps the site free to host with no shared API costs.

### The nightly feed

`.github/workflows/nightly.yml` runs at 07:00 UTC (2 AM CDT) and on demand (Actions → Nightly job feed → Run workflow):

1. Checks out the [career-ops](https://github.com/career-ops-hq/career-ops) scanner (MIT, pinned commit) and scans every board in `feed/portals.yml`.
2. `scripts/build-feed.mjs` fetches each *new* posting's description from the ATS's public API (cached in `feed/jd-cache.json`), tags skills (`web/data/skills.json`) and flags postings whose text says no sponsorship / US citizenship / clearance.
3. Joins DOL/USCIS sponsorship stats from `feed/sponsors.json`, writes `web/data/jobs.json` + `meta.json`, commits, and deploys Pages.

`feed/portals.yml` and `feed/sponsors.json` are generated locally by `scripts/export-companies.mjs` from a career-ops install plus the DOL LCA / USCIS data — re-run it to add employers or refresh sponsorship numbers.

### Custom domain

Settings → Pages → Source: **GitHub Actions**; Custom domain: `jobs.arikatla.dev`, Enforce HTTPS. At the DNS host add `CNAME jobs → agvs03.github.io`.

### Fetching real jobs (legacy Python path)

```bash
pip install -r requirements.txt
python -m pipeline.jobs        # pulls live roles from pipeline/companies.yaml's ATS boards
```
This writes `web/data/jobs.json`, which the site loads in preference to the bundled
sample. Grow `pipeline/companies.yaml` with more sponsoring companies + their ATS slugs.

## Tests & CI

```bash
pytest
```

`ci.yml` builds the sponsorship data from synthetic input and runs the tests on
every push. `deploy.yml` publishes `web/` to GitHub Pages.

## License

MIT. Government data is public domain; employer names are factual public-record references.
