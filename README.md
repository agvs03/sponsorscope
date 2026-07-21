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
- [ ] `pipeline/jobs.py` — live ingestion of sponsoring companies' ATS boards into `web/data/jobs.json`
- [ ] Optional **AI layer** (Claude API): resume-tailored bullets + smarter fit explanations
- [ ] Saved-search **agent**: notify you when new sponsor-friendly jobs match

## Tests & CI

```bash
pytest
```

`ci.yml` builds the sponsorship data from synthetic input and runs the tests on
every push. `deploy.yml` publishes `web/` to GitHub Pages.

## License

MIT. Government data is public domain; employer names are factual public-record references.
