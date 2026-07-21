"""Put the repo root on sys.path so `pipeline` / `api` import under pytest."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
