"""Build per-employer sponsorship profiles from DOL LCA + USCIS data.

Pipeline
--------
1. Load the DOL OFLC LCA disclosure file (.xlsx/.csv) and the USCIS H-1B
   Employer Data Hub file (.csv).
2. Normalize employer names so the two sources join and duplicates collapse.
3. Aggregate per employer: filing volume, certified rate, yearly trend,
   annualized wage distribution, top titles/states, and (from USCIS) the
   petition approval rate.
4. Keep employers with >= ``min_petitions`` cases and write:
     - a SQLite DB (full dataset, for the optional API), and
     - web/data/employers.json + web/data/index.json (what the static site loads).

Everything is a transparent aggregation ("groupby") over public data — no
model, no inference. Run:  python -m pipeline.build
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# ---- column aliases: map real-world DOL header variants -> canonical names ---
LCA_ALIASES = {
    "EMPLOYER_NAME": ["EMPLOYER_NAME", "LCA_CASE_EMPLOYER_NAME", "EMPLOYER_BUSINESS_DBA"],
    "JOB_TITLE": ["JOB_TITLE", "LCA_CASE_JOB_TITLE", "PW_JOB_TITLE_9089"],
    "SOC_TITLE": ["SOC_TITLE", "LCA_CASE_SOC_NAME", "OES_JOB_TITLE"],
    "CASE_STATUS": ["CASE_STATUS", "STATUS"],
    "VISA_CLASS": ["VISA_CLASS", "PROGRAM"],
    "WAGE_RATE_OF_PAY_FROM": ["WAGE_RATE_OF_PAY_FROM", "WAGE_RATE_OF_PAY_FROM_1", "LCA_CASE_WAGE_RATE_FROM"],
    "WAGE_UNIT_OF_PAY": ["WAGE_UNIT_OF_PAY", "WAGE_UNIT_OF_PAY_1", "LCA_CASE_WAGE_RATE_UNIT"],
    "PREVAILING_WAGE": ["PREVAILING_WAGE", "PREVAILING_WAGE_1", "PW_WAGE"],
    "WORKSITE_STATE": ["WORKSITE_STATE", "WORKSITE_STATE_1", "WORKLOC1_STATE", "EMPLOYER_STATE"],
    "DECISION_DATE": ["DECISION_DATE", "Decision_Date"],
}

WAGE_UNIT_MULT = {"year": 1, "hour": 2080, "month": 12, "bi-weekly": 26, "week": 52, "day": 260}


def load_config(path: str | None = None) -> dict:
    p = PROJECT_ROOT / (path or "config.yaml")
    with p.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def normalize_name(name: str) -> str:
    """Canonicalize an employer name for joining/dedup: upper, strip suffixes."""
    if not isinstance(name, str):
        return ""
    s = name.upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\b(INCORPORATED|INC|LLC|LLP|LP|CORPORATION|CORP|LTD|CO|COMPANY|THE|USA|US)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def slugify(norm_name: str) -> str:
    return re.sub(r"\s+", "-", norm_name.lower()).strip("-") or "unknown"


def _read_any(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Either download the real file (see README) or "
            "run `python -m pipeline.sample_data` to generate synthetic input."
        )
    if path.suffix.lower() in (".xlsx", ".xls"):
        return pd.read_excel(path)
    return pd.read_csv(path, low_memory=False)


def _canonicalize(df: pd.DataFrame, aliases: dict) -> pd.DataFrame:
    rename = {}
    for canon, variants in aliases.items():
        for v in variants:
            if v in df.columns:
                rename[v] = canon
                break
    return df.rename(columns=rename)


def _annualize(amount: float, unit: object) -> float | None:
    if amount is None or (isinstance(amount, float) and np.isnan(amount)):
        return None
    mult = WAGE_UNIT_MULT.get(str(unit).strip().lower(), 1)
    try:
        return float(amount) * mult
    except (TypeError, ValueError):
        return None


def load_lca(path: Path, visa_classes: list[str]) -> pd.DataFrame:
    df = _canonicalize(_read_any(path), LCA_ALIASES)
    if "EMPLOYER_NAME" not in df.columns:
        raise ValueError("LCA file has no recognizable EMPLOYER_NAME column.")
    df = df[df.get("VISA_CLASS", "H-1B").isin(visa_classes)] if "VISA_CLASS" in df else df
    df = df.copy()
    df["norm"] = df["EMPLOYER_NAME"].map(normalize_name)
    df = df[df["norm"] != ""]
    df["year"] = pd.to_datetime(df.get("DECISION_DATE"), errors="coerce").dt.year
    df["wage_annual"] = [
        _annualize(a, u)
        for a, u in zip(df.get("WAGE_RATE_OF_PAY_FROM"), df.get("WAGE_UNIT_OF_PAY", "Year"))
    ]
    df["certified"] = df.get("CASE_STATUS", "").astype(str).str.upper().str.startswith("CERTIFIED")
    return df


def load_uscis(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["norm", "approvals", "denials"])
    df = _read_any(path)
    df = df.rename(columns={c: c.strip() for c in df.columns})
    name_col = next((c for c in df.columns if c.lower() in ("employer", "employer_name")), None)
    if name_col is None:
        return pd.DataFrame(columns=["norm", "approvals", "denials"])
    df["norm"] = df[name_col].map(normalize_name)
    appr = pd.to_numeric(df.get("Initial Approval"), errors="coerce").fillna(0)
    den = pd.to_numeric(df.get("Initial Denial"), errors="coerce").fillna(0)
    g = df.assign(approvals=appr, denials=den).groupby("norm", as_index=False)[["approvals", "denials"]].sum()
    return g


def _trend(by_year: dict[int, int], trend_years: int) -> str:
    """Compare the two most recent years vs. the prior window: up/down/flat."""
    if len(by_year) < 2:
        return "flat"
    years = sorted(by_year)[-trend_years:]
    if len(years) < 2:
        return "flat"
    recent = by_year[years[-1]]
    prior = np.mean([by_year[y] for y in years[:-1]])
    if prior == 0:
        return "up" if recent > 0 else "flat"
    change = (recent - prior) / prior
    return "up" if change > 0.15 else "down" if change < -0.15 else "flat"


def build_profiles(cfg: dict) -> list[dict]:
    b = cfg["build"]
    lca = load_lca(PROJECT_ROOT / cfg["data"]["lca_path"], b["visa_classes"])
    uscis = load_uscis(PROJECT_ROOT / cfg["data"]["uscis_path"]).set_index("norm")

    profiles: list[dict] = []
    for norm, grp in lca.groupby("norm"):
        total = len(grp)
        if total < b["min_petitions"]:
            continue
        display = grp["EMPLOYER_NAME"].mode().iloc[0]
        cert = int(grp["certified"].sum())
        by_year = grp[grp["year"].notna()].groupby("year").size().astype(int).to_dict()
        by_year = {int(k): int(v) for k, v in by_year.items()}
        wages = grp.loc[grp["certified"], "wage_annual"].dropna()
        titles = grp["JOB_TITLE"].value_counts().head(5) if "JOB_TITLE" in grp else pd.Series(dtype=int)
        states = grp["WORKSITE_STATE"].value_counts().head(5) if "WORKSITE_STATE" in grp else pd.Series(dtype=int)

        u = uscis.loc[norm] if norm in uscis.index else None
        approvals = float(u["approvals"]) if u is not None else 0.0
        denials = float(u["denials"]) if u is not None else 0.0
        approval_rate = round(approvals / (approvals + denials), 3) if (approvals + denials) else None

        profiles.append({
            "slug": slugify(norm),
            "name": display,
            "lca": {
                "total": total,
                "certified": cert,
                "certified_pct": round(100 * cert / total, 1),
                "by_year": by_year,
                "trend": _trend(by_year, b["trend_years"]),
            },
            "wages": {
                "median_annual": int(wages.median()) if len(wages) else None,
                "p25_annual": int(wages.quantile(0.25)) if len(wages) else None,
                "p75_annual": int(wages.quantile(0.75)) if len(wages) else None,
            },
            "uscis": None if u is None else {
                "initial_approval": int(approvals),
                "initial_denial": int(denials),
                "approval_rate": approval_rate,
            },
            "top_titles": [{"title": t, "count": int(c)} for t, c in titles.items()],
            "top_states": [{"state": s, "count": int(c)} for s, c in states.items()],
        })
    profiles.sort(key=lambda p: p["lca"]["total"], reverse=True)
    return profiles


def write_outputs(profiles: list[dict], cfg: dict) -> None:
    # SQLite (full dataset, one row per employer, profile stored as JSON)
    db_path = PROJECT_ROOT / cfg["paths"]["db"]
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("DROP TABLE IF EXISTS employers")
    conn.execute(
        "CREATE TABLE employers (slug TEXT PRIMARY KEY, name TEXT, "
        "total INTEGER, certified_pct REAL, approval_rate REAL, profile JSON)"
    )
    conn.executemany(
        "INSERT INTO employers VALUES (?,?,?,?,?,?)",
        [(p["slug"], p["name"], p["lca"]["total"], p["lca"]["certified_pct"],
          (p["uscis"] or {}).get("approval_rate"), json.dumps(p)) for p in profiles],
    )
    conn.commit()
    conn.close()

    # Static JSON for the site: full profiles + a light search index
    web_data = PROJECT_ROOT / cfg["paths"]["web_data"]
    web_data.mkdir(parents=True, exist_ok=True)
    employers = {p["slug"]: p for p in profiles}
    index = [
        {"slug": p["slug"], "name": p["name"], "total": p["lca"]["total"],
         "certified_pct": p["lca"]["certified_pct"], "trend": p["lca"]["trend"]}
        for p in profiles
    ]
    (web_data / "employers.json").write_text(json.dumps(employers), encoding="utf-8")
    (web_data / "index.json").write_text(json.dumps(index), encoding="utf-8")


def main() -> None:
    cfg = load_config()
    profiles = build_profiles(cfg)
    write_outputs(profiles, cfg)
    print(f"built {len(profiles):,} employer profiles")
    if profiles:
        top = profiles[0]
        print(f"  largest: {top['name']} — {top['lca']['total']} cases, "
              f"{top['lca']['certified_pct']}% certified, trend {top['lca']['trend']}")


if __name__ == "__main__":
    main()
