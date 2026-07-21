"""Tests for the SponsorScope pipeline — pure helpers + an end-to-end build."""
from __future__ import annotations

import json

import pandas as pd
import pytest

from pipeline.build import (
    _annualize,
    _trend,
    build_profiles,
    normalize_name,
    slugify,
    write_outputs,
)


def test_normalize_name_strips_suffixes_and_punctuation():
    assert normalize_name("Globex Systems, Inc.") == "GLOBEX SYSTEMS"
    assert normalize_name("Initech Software LLC") == "INITECH SOFTWARE"
    assert normalize_name("The Hooli Corporation") == "HOOLI"
    # Two spellings of the same company collapse to one key.
    assert normalize_name("Acme Co.") == normalize_name("ACME COMPANY")


def test_slugify():
    assert slugify("GLOBEX SYSTEMS") == "globex-systems"
    assert slugify("") == "unknown"


def test_annualize_units():
    assert _annualize(100000, "Year") == 100000
    assert _annualize(50, "Hour") == 50 * 2080
    assert _annualize(10000, "Month") == 120000
    assert _annualize(None, "Year") is None


def test_trend_directions():
    assert _trend({2020: 10, 2021: 10, 2022: 10, 2023: 10, 2024: 20}, 5) == "up"
    assert _trend({2020: 20, 2021: 16, 2022: 12, 2023: 9, 2024: 5}, 5) == "down"
    assert _trend({2020: 10, 2021: 10, 2022: 10}, 5) == "flat"


def _write_sample_inputs(tmp_path):
    """A tiny LCA + USCIS pair with one qualifying employer."""
    rows = []
    for i in range(8):  # >= min_petitions
        rows.append({
            "EMPLOYER_NAME": "Globex Systems Inc",
            "JOB_TITLE": "Software Engineer",
            "SOC_TITLE": "Software Developers, Applications",
            "CASE_STATUS": "Certified" if i < 7 else "Denied",
            "VISA_CLASS": "H-1B",
            "WAGE_RATE_OF_PAY_FROM": 120000 + i * 1000,
            "WAGE_UNIT_OF_PAY": "Year",
            "PREVAILING_WAGE": 110000,
            "WORKSITE_STATE": "CA",
            "DECISION_DATE": f"202{i % 5}-06-15",
        })
    lca = tmp_path / "lca.csv"
    pd.DataFrame(rows).to_csv(lca, index=False)

    uscis = tmp_path / "uscis.csv"
    pd.DataFrame([{
        "Employer": "Globex Systems Inc", "Fiscal Year": 2024,
        "Initial Approval": 40, "Initial Denial": 2,
    }]).to_csv(uscis, index=False)
    return lca, uscis


def _cfg(tmp_path, lca, uscis):
    return {
        "data": {"lca_path": str(lca), "uscis_path": str(uscis)},
        "build": {"min_petitions": 5, "visa_classes": ["H-1B"], "trend_years": 5},
        "paths": {"db": str(tmp_path / "db.sqlite"), "web_data": str(tmp_path / "web")},
    }


def test_build_profiles_end_to_end(tmp_path):
    lca, uscis = _write_sample_inputs(tmp_path)
    cfg = _cfg(tmp_path, lca, uscis)

    profiles = build_profiles(cfg)
    assert len(profiles) == 1
    p = profiles[0]
    assert p["name"] == "Globex Systems Inc"
    assert p["slug"] == "globex-systems"
    assert p["lca"]["total"] == 8
    assert p["lca"]["certified"] == 7
    assert p["uscis"]["approval_rate"] == pytest.approx(40 / 42, rel=1e-3)
    assert p["wages"]["median_annual"] is not None
    assert p["top_titles"][0]["title"] == "Software Engineer"


def test_write_outputs_creates_site_json(tmp_path):
    lca, uscis = _write_sample_inputs(tmp_path)
    cfg = _cfg(tmp_path, lca, uscis)
    profiles = build_profiles(cfg)
    write_outputs(profiles, cfg)

    web = tmp_path / "web"
    employers = json.loads((web / "employers.json").read_text())
    index = json.loads((web / "index.json").read_text())
    assert "globex-systems" in employers
    assert index[0]["slug"] == "globex-systems"
    assert (tmp_path / "db.sqlite").exists()
