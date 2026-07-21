"""Optional FastAPI backend over the SQLite dataset.

Endpoints
---------
GET /health                      liveness + employer count
GET /search?q=&limit=            search employers by name
GET /employer/{slug}             full sponsorship profile

Run:  uvicorn api.main:app --reload
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException, Query

PROJECT_ROOT = Path(__file__).resolve().parents[1]

with (PROJECT_ROOT / "config.yaml").open("r", encoding="utf-8") as fh:
    _CFG = yaml.safe_load(fh)
DB_PATH = PROJECT_ROOT / _CFG["paths"]["db"]

app = FastAPI(
    title="SponsorScope API",
    version="0.1.0",
    description="U.S. visa-sponsorship intelligence from public DOL/USCIS data.",
)


def _connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise HTTPException(503, f"Dataset not built. Run the pipeline first ({DB_PATH} missing).")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/health")
def health() -> dict:
    if not DB_PATH.exists():
        return {"status": "no-data", "employers": 0}
    with _connect() as c:
        n = c.execute("SELECT COUNT(*) AS n FROM employers").fetchone()["n"]
    return {"status": "ok", "employers": n}


@app.get("/search")
def search(q: str = Query("", min_length=0), limit: int = Query(25, ge=1, le=100)) -> list[dict]:
    with _connect() as c:
        rows = c.execute(
            "SELECT slug, name, total, certified_pct, approval_rate FROM employers "
            "WHERE name LIKE ? ORDER BY total DESC LIMIT ?",
            (f"%{q}%", limit),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/employer/{slug}")
def employer(slug: str) -> dict:
    with _connect() as c:
        row = c.execute("SELECT profile FROM employers WHERE slug = ?", (slug,)).fetchone()
    if row is None:
        raise HTTPException(404, f"Employer '{slug}' not found.")
    return json.loads(row["profile"])
