"""NEX TERRA — NASA data integration.

Proxy + data-pulling logic for real satellite & climate data:
  * NASA POWER    (surface temp, rainfall, humidity, radiation)
  * NASA GPM      (IMERG precipitation)
  * NASA MODIS    (EVI/NDVI vegetation health)
  * NASA SMAP     (surface soil moisture)
  * NEX-GDDP-CMIP6 (future climate deltas)

All responses are cached as JSON under ``data/nasa/`` so the demo is
deterministic and fully offline-capable after the first pull.

Few/no new packages are required: data arrives over HTTPS as JSON (POWER) or
NetCDF/CSV, which we fetch and serialise for the demonstration.
"""

from __future__ import annotations

from .client import NasaClient, NasaConfig, fetch_nasa_series, pull_demo_field_data

__all__ = ["NasaClient", "NasaConfig", "fetch_nasa_series", "pull_demo_field_data"]
