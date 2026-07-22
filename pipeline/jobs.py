"""Aggregate live job postings from sponsoring companies' OFFICIAL ATS APIs.

Legal, no scraping: Greenhouse, Lever, and Ashby each publish a company's own
open roles through a public, documented, unauthenticated JSON endpoint intended
for third parties to list that company's jobs. We poll those, normalize to the
SponsorPilot job schema, join each company's sponsorship stats (from build.py's
employer profiles), and write ``web/data/jobs.json``.

Usage
-----
    python -m pipeline.jobs                 # uses pipeline/companies.yaml
    python -m pipeline.jobs --limit 40      # cap total jobs (keeps the static file small)

Requires network access (run locally / in CI, not in a sandbox). If a board is
unreachable it is skipped with a warning rather than failing the whole run.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import requests
import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TIMEOUT = 20

# A small, transparent tech-skill vocabulary used to tag each posting by
# keyword-matching its description. This is a heuristic, not NLP — same spirit
# as the fit score. Extend freely.
SKILL_VOCAB = [
    "Python", "Java", "Go", "Rust", "C++", "JavaScript", "TypeScript", "React",
    "Node.js", "SQL", "PostgreSQL", "MySQL", "Snowflake", "Spark", "Airflow",
    "dbt", "Kafka", "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform",
    "TensorFlow", "PyTorch", "scikit-learn", "Pandas", "NumPy", "Tableau",
    "Looker", "Power BI", "Excel", "Statistics", "Machine Learning", "NLP",
    "GraphQL", "REST", "gRPC", "Microservices", "CI/CD", "Git",
]


def _extract_skills(text: str, limit: int = 8) -> list[str]:
    if not text:
        return []
    low = text.lower()
    hits = []
    for skill in SKILL_VOCAB:
        # word-ish boundary match; keep skills like "C++"/"CI/CD" literal
        pat = re.escape(skill.lower())
        if re.search(rf"(?<![a-z0-9]){pat}(?![a-z0-9+.#])", low):
            hits.append(skill)
        if len(hits) >= limit:
            break
    return hits


def _clean(html: str) -> str:
    """Strip tags from an ATS description and trim to a short blurb."""
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:400]


# --------------------------------------------------------------------------- #
# Per-ATS fetchers -> list of raw {title, location, url, description}
# --------------------------------------------------------------------------- #
def fetch_greenhouse(token: str) -> list[dict]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
    data = requests.get(url, timeout=TIMEOUT).json()
    out = []
    for j in data.get("jobs", []):
        out.append({
            "title": j.get("title", ""),
            "location": (j.get("location") or {}).get("name", ""),
            "url": j.get("absolute_url", ""),
            "description": _clean(j.get("content", "")),
        })
    return out


def fetch_lever(token: str) -> list[dict]:
    url = f"https://api.lever.co/v0/postings/{token}?mode=json"
    data = requests.get(url, timeout=TIMEOUT).json()
    out = []
    for j in data:
        cats = j.get("categories") or {}
        out.append({
            "title": j.get("text", ""),
            "location": cats.get("location", ""),
            "url": j.get("hostedUrl", ""),
            "description": _clean(j.get("descriptionPlain") or j.get("description", "")),
        })
    return out


def fetch_ashby(token: str) -> list[dict]:
    url = f"https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true"
    data = requests.get(url, timeout=TIMEOUT).json()
    out = []
    for j in data.get("jobs", []):
        out.append({
            "title": j.get("title", ""),
            "location": j.get("location", ""),
            "url": j.get("jobUrl", ""),
            "description": _clean(j.get("descriptionPlain") or ""),
        })
    return out


FETCHERS = {"greenhouse": fetch_greenhouse, "lever": fetch_lever, "ashby": fetch_ashby}


def _load_sponsorship() -> dict[str, dict]:
    """Map lowercased employer name -> sponsorship summary, from build output."""
    for rel in ("web/data/employers.json", "web/data/sample.employers.json"):
        p = PROJECT_ROOT / rel
        if p.exists():
            employers = json.loads(p.read_text(encoding="utf-8"))
            out = {}
            for e in employers.values() if isinstance(employers, dict) else employers:
                out[e["name"].lower()] = {
                    "sponsors": True,
                    "trend": e.get("lca", {}).get("trend", "flat"),
                    "approval_rate": (e.get("uscis") or {}).get("approval_rate"),
                    "median_wage": (e.get("wages") or {}).get("median_annual"),
                }
            return out
    return {}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--companies", default="pipeline/companies.yaml")
    parser.add_argument("--out", default="web/data/jobs.json")
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()

    seed = yaml.safe_load((PROJECT_ROOT / args.companies).read_text(encoding="utf-8"))
    sponsorship = _load_sponsorship()

    jobs: list[dict] = []
    for co in seed.get("companies", []):
        name, ats, token = co["name"], co["ats"], co["token"]
        fetch = FETCHERS.get(ats)
        if not fetch:
            print(f"[warn] unknown ATS '{ats}' for {name}; skipping")
            continue
        try:
            raw = fetch(token)
        except Exception as exc:  # noqa: BLE001 - one bad board shouldn't fail the run
            print(f"[warn] {name} ({ats}:{token}) unreachable: {exc}")
            continue

        spon = sponsorship.get(name.lower(), {"sponsors": None, "trend": None,
                                              "approval_rate": None, "median_wage": None})
        for i, r in enumerate(raw):
            loc = r["location"]
            jobs.append({
                "id": f"{_slug(name)}-{i}",
                "title": r["title"],
                "company": name,
                "company_slug": _slug(name),
                "location": loc,
                "remote": "remote" in loc.lower(),
                "url": r["url"],
                "skills": _extract_skills(f"{r['title']} {r['description']}"),
                "description": r["description"],
                "sponsorship": spon,
            })
        print(f"[ok] {name}: {len(raw)} jobs")

    jobs = jobs[: args.limit]
    out_path = PROJECT_ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(jobs, indent=2), encoding="utf-8")
    print(f"\nWrote {len(jobs)} jobs -> {out_path}")
    if not jobs:
        print("[note] No jobs fetched (network blocked or tokens stale). The site "
              "falls back to web/data/sample.jobs.json.")


if __name__ == "__main__":
    main()
