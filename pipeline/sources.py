"""Pointers to the official public data sources.

We deliberately do NOT scrape anything. These are the government bulk-download
pages; the actual file URLs change each release, so the pipeline expects you to
drop the current files into data/ (or wire an official direct link here).

    DOL OFLC disclosure data (LCA / PERM / prevailing wage):
        https://www.dol.gov/agencies/eta/foreign-labor/performance
        -> download the latest "LCA Programs (H-1B, H-1B1, E-3)" Disclosure file
           and save it as data/lca.xlsx (or .csv). Public domain (17 U.S.C. 105).

    USCIS H-1B Employer Data Hub:
        https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub
        -> export the employer file and save it as data/uscis_hub.csv.
           Public domain.
"""
from __future__ import annotations

SOURCES = {
    "dol_lca": {
        "name": "DOL OFLC LCA Disclosure Data",
        "page": "https://www.dol.gov/agencies/eta/foreign-labor/performance",
        "expected_file": "data/lca.xlsx",
        "license": "US Government Work — public domain (17 U.S.C. §105)",
    },
    "uscis_hub": {
        "name": "USCIS H-1B Employer Data Hub",
        "page": "https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub",
        "expected_file": "data/uscis_hub.csv",
        "license": "US Government Work — public domain",
    },
}


def print_instructions() -> None:
    print("SponsorScope data sources (all free, public domain):\n")
    for key, s in SOURCES.items():
        print(f"- {s['name']}")
        print(f"    page:     {s['page']}")
        print(f"    save as:  {s['expected_file']}")
        print(f"    license:  {s['license']}\n")
    print("No account or scraping required. Then run: python -m pipeline.build")


if __name__ == "__main__":
    print_instructions()
