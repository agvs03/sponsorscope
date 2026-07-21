"""One command to get a working site with zero downloads:
generate synthetic input -> build profiles -> export web/data JSON.

    python scripts/build_sample_site.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def run(mod: str) -> None:
    print(f"\n$ python -m {mod}")
    subprocess.run([sys.executable, "-m", mod], cwd=PROJECT_ROOT, check=True)


if __name__ == "__main__":
    run("pipeline.sample_data")
    run("pipeline.build")
    print("\nDone. Serve the site locally with:\n"
          "    python -m http.server -d web 8080\n"
          "then open http://localhost:8080")
