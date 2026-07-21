# SponsorScope

**Which U.S. employers actually sponsor visas — from public government data, not guesswork.**

SponsorScope turns free, public-domain U.S. Department of Labor and USCIS
disclosure data into a searchable per-employer profile: how many H-1B filings a
company makes, its certified rate, whether sponsorship is **rising or declining**,
its USCIS approval rate, and the **offered-wage range** for the roles it sponsors.
It's a static website anyone can visit — no login, no scraping, no server bills.

> **Honest scope.** This is an aggregation of public disclosure data, not a
> predictor of your personal chances. Historical sponsorship is **not** a
> guarantee for any future role. It is **not** legal or immigration advice.

---

## Why this exists

International students burn applications on companies that don't sponsor. The
raw answer is buried in giant government spreadsheets. SponsorScope makes it
searchable and adds the signal that matters most — **the trend** (a company
whose sponsorship is declining is a very different bet from one ramping up).

## What's real vs. what isn't (by design)

This project only ships numbers it can source honestly:

| Feature | Status | Basis |
|---|---|---|
| Sponsorship volume, certified %, **trend** | ✅ Real | DOL LCA disclosures (a transparent aggregation) |
| USCIS approval rate | ✅ Real | USCIS H-1B Employer Data Hub |
| Offered-wage range | ✅ Real | DOL LCA offered wages (skews toward the prevailing-wage floor — disclosed in-app) |
| "Interview probability" | ❌ **Not built** | No public ground-truth data exists — any such number would be fabricated |
| Recruiter scraping / auto-outreach | ❌ **Not built** | Scraping LinkedIn/etc. and mass cold-email are ToS/CAN-SPAM/GDPR violations |

## Data sources (all free, public domain — 17 U.S.C. §105)

- **DOL OFLC LCA Disclosure Data** — <https://www.dol.gov/agencies/eta/foreign-labor/performance>
- **USCIS H-1B Employer Data Hub** — <https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub>

Nothing is scraped. Run `python -m pipeline.sources` to print the exact files to download.

---

## Architecture

```
DOL LCA .xlsx  ┐
               ├─►  pipeline/build.py  ─►  data/sponsorscope.db (SQLite, full)
USCIS Hub .csv ┘        (normalize,          web/data/employers.json  ┐
                         join, aggregate)     web/data/index.json      ├─► static site
                                                                       ┘   (web/)
```

- **`pipeline/`** — ingest → normalize employer names → aggregate → export.
- **`web/`** — a dependency-free static site that reads the exported JSON entirely client-side. Deploys to GitHub Pages for free.
- **`api/`** — *optional* FastAPI over the SQLite DB, for when the employer set is too big to ship as static JSON.

## Quick start (no downloads)

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Generate synthetic data + build the site (metrics are fake, wiring is real)
python scripts/build_sample_site.py

# Serve it
python -m http.server -d web 8080     # open http://localhost:8080
```

The sample site shows a visible **"demo data"** banner so it can never be mistaken for real figures.

## Going live with real data

```bash
# 1. Download the two files (see links above) into data/:
#      data/lca.xlsx        (DOL LCA disclosure)
#      data/uscis_hub.csv   (USCIS Employer Data Hub)
python -m pipeline.sources          # prints exactly what to download

# 2. Build real profiles
python -m pipeline.build

# 3. Commit the built site data so GitHub Pages serves it (it's git-ignored by default)
git add -f web/data/employers.json web/data/index.json
git commit -m "Refresh sponsorship data (<quarter>)"
git push
```

The `deploy.yml` workflow publishes `web/` to GitHub Pages on every push. Enable
Pages once under **Settings → Pages → Source: GitHub Actions**.

## The "living data" reality — read this

The auto-refresh honesty: **DOL/USCIS release new files on their own schedule
(roughly quarterly), in formats that occasionally change.** So the refresh is a
**periodic re-run**, not a magic 6-hour cron — re-download, `python -m
pipeline.build`, commit. `pipeline/build.py` already handles common column-name
variations across years, but a new DOL schema may need a tweak to `LCA_ALIASES`.
Automating the download fully requires a stable direct URL, which DOL doesn't
reliably provide — that's a deliberate future enhancement, not a shipped promise.

## Tests & CI

```bash
pytest
```

`ci.yml` builds the site from synthetic data and runs the tests on every push —
proving the whole pipeline works end-to-end on a clean machine.

## License

MIT (see `LICENSE`). The government data is public domain; this project's code
is yours to use. Employer names are used as factual public-record references.
