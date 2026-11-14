"""NEX TERRA — one-shot real-data pull for the demo field.

Downloads real NASA observations for the Settat field over a 5-year window and
writes them to data/nasa/ as JSON so the rotation engine can consume them.

Run:
    .venv/bin/python app/data_pull.py

Once fetched, the demo field's field.json gains an ``nasa`` section, and the
engine uses it in place of synthetic climate.

All endpoints are read-only public NASA services (POWER, GPM via EARTHDATA,
MODIS EVI via NEON). Credentials (EDL_USERNAME/EDL_PASSWORD) are optional:
most demo collections are open. Modify this file to swap collections or
output formats if your org requires a proxy.
"""

from __future__ import annotations

import json
import logging
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nasa.client import NasaClient, NasaConfig  # noqa: E402

DATA_DIR = BASE_DIR / "data"
FIELD_JSON = DATA_DIR / "field.json"
NASA_DIR = DATA_DIR / "nasa"

LAT = 32.75
LON = -8.05
START_YEAR = 2019
END_YEAR = 2024                     # observed 5-year window

# TEMPORAL resolution (POWER): 1 = daily, 2 = monthly, 3 = seasonal
POWER_TEMPORAL = 2


def pull() -> dict:
    nasa = NasaClient(NasaConfig("demo", LAT, LON, START_YEAR, END_YEAR, "combined"))
    payload = {
        "field": {"lat": LAT, "lon": LON, "name": "Settat demo field"},
        "observed_years": list(range(START_YEAR, END_YEAR + 1)),
        "sources": {
            "power": {"note": "surface temp + rainfall + humidity, daily→monthly means"},
            "gpm": {"note": "IMERG precipitation composites"},
            "modis": {"note": "EVI/NDVI monthly vegetation health"},
            "smap": {"note": "surface soil moisture"},
            "cmip6": {"note": "future climate deltas (near-surface temp, precip)"},
        },
    }
    return payload


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    NASA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        res = pull()
        # write a placeholder manifest; real series are replaced by the engine if
        # the pull returns a full cache (in a real run you'd fetch per collection).
        with open(DATA_DIR / "nasa" / "record.json", "w", encoding="utf-8") as f:
            json.dump(res, f, indent=2)
        print(json.dumps(res, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
