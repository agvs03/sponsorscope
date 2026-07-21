"""Optional FastAPI backend for serving the FULL dataset from SQLite.

The static site does not need this — it reads pre-built JSON. Use the API when
the employer set is too large to ship as static JSON and you want server-side
search. Deploy on any free tier (Render/Railway/Fly) or run locally.
"""
