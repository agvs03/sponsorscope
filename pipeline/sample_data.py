"""Generate synthetic, schema-compatible LCA + USCIS files.

This lets the whole pipeline + site run end-to-end WITHOUT the ~150 MB
government downloads. The columns match the real DOL OFLC LCA disclosure and
USCIS H-1B Employer Data Hub schemas, but every number here is fabricated —
it is for wiring/tests/demo only and is NOT real sponsorship data.

    python -m pipeline.sample_data
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]

EMPLOYERS = [
    "Globex Systems Inc", "Initech Software LLC", "Umbrella Analytics Corp",
    "Hooli Inc", "Stark Industries", "Wayne Enterprises LLC", "Cyberdyne Labs",
    "Soylent Corp", "Wonka Technologies Inc", "Acme Robotics", "Massive Dynamic",
    "Pied Piper Inc", "Vehement Capital", "Gringotts Data Systems",
    "Nakatomi Trading Corp", "Tyrell Corporation", "Oscorp Industries",
    "Aperture Science LLC", "Black Mesa Research", "Sirius Cybernetics Corp",
]
TITLES = [
    ("Software Engineer", "Software Developers, Applications"),
    ("Senior Software Engineer", "Software Developers, Applications"),
    ("Data Scientist", "Data Scientists"),
    ("Machine Learning Engineer", "Data Scientists"),
    ("Data Engineer", "Database Architects"),
    ("Systems Analyst", "Computer Systems Analysts"),
    ("DevOps Engineer", "Software Developers, Systems Software"),
    ("Product Manager", "Software Developers, Applications"),
]
STATES = ["CA", "WA", "NY", "TX", "MA", "NJ", "IL", "GA", "VA", "NC"]
STATUSES = ["Certified", "Certified - Withdrawn", "Denied", "Withdrawn"]
STATUS_P = [0.86, 0.07, 0.04, 0.03]
YEARS = [2020, 2021, 2022, 2023, 2024]


def _lca_rows(rng: np.random.Generator) -> list[dict]:
    rows = []
    for i, emp in enumerate(EMPLOYERS):
        base = int(rng.integers(8, 120))            # petition volume varies
        wage_center = float(rng.uniform(95_000, 175_000))
        # a per-employer yearly trend multiplier (some grow, some decline)
        drift = rng.uniform(0.8, 1.25)
        for y_idx, year in enumerate(YEARS):
            n = max(1, int(base * (drift ** (y_idx - 2)) / len(YEARS)))
            for _ in range(n):
                title, soc = TITLES[rng.integers(0, len(TITLES))]
                status = rng.choice(STATUSES, p=STATUS_P)
                wage = max(60_000.0, rng.normal(wage_center, 15_000))
                prevailing = wage * rng.uniform(0.82, 0.98)
                month = int(rng.integers(1, 13))
                day = int(rng.integers(1, 28))
                rows.append({
                    "EMPLOYER_NAME": emp,
                    "JOB_TITLE": title,
                    "SOC_TITLE": soc,
                    "CASE_STATUS": status,
                    "VISA_CLASS": "H-1B",
                    "WAGE_RATE_OF_PAY_FROM": round(wage, 2),
                    "WAGE_UNIT_OF_PAY": "Year",
                    "PREVAILING_WAGE": round(prevailing, 2),
                    "PW_UNIT_OF_PAY": "Year",
                    "WORKSITE_STATE": STATES[rng.integers(0, len(STATES))],
                    "DECISION_DATE": f"{year}-{month:02d}-{day:02d}",
                })
    return rows


def _uscis_rows(rng: np.random.Generator) -> list[dict]:
    rows = []
    for emp in EMPLOYERS:
        for year in YEARS:
            approvals = int(rng.integers(3, 90))
            denials = int(rng.integers(0, max(1, approvals // 8)))
            rows.append({
                "Employer": emp,
                "Fiscal Year": year,
                "Initial Approval": approvals,
                "Initial Denial": denials,
                "Continuing Approval": int(rng.integers(0, approvals)),
                "Continuing Denial": int(rng.integers(0, max(1, denials))),
                "State": STATES[rng.integers(0, len(STATES))],
            })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--lca-out", default="data/lca.csv")
    parser.add_argument("--uscis-out", default="data/uscis_hub.csv")
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    lca = pd.DataFrame(_lca_rows(rng))
    uscis = pd.DataFrame(_uscis_rows(rng))

    for rel, df in [(args.lca_out, lca), (args.uscis_out, uscis)]:
        out = PROJECT_ROOT / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(out, index=False)
        print(f"wrote {len(df):,} rows -> {out}")


if __name__ == "__main__":
    main()
