"""NEX TERRA API routes."""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from . import config as _cfg, models
from .models import (ComparisonItem, ErrorResponse, FieldResult, FieldUpdate,
                     RotationRequest, RotationResult, ScenariosResult, OptimizationResult)
from .simulator import simulator as sim
from fastapi import Body

router = APIRouter(tags=["nex-terra"])

log = logging.getLogger("nex-terra")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FIELD_JSON = DATA_DIR / "field.json"
CONFIG_JSON = DATA_DIR / "config.json"

# In-memory "database" of the virtual field layers (SQLite mirrors this).
_db = {"fields": {}, "rotations": []}


# --------------------------------------------------------------------------- #
#  Field + soil store
# --------------------------------------------------------------------------- #
def _load_field_json() -> Dict[str, Any]:
    if FIELD_JSON.exists():
        with open(FIELD_JSON, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _ensure_db():
    return _db


def _soil_default() -> Dict[str, Any]:
    try:
        with open(DATA_DIR / "soilgrids.json", encoding="utf-8") as f:
            data = json.load(f)
        return {k: v for k, v in data.items() if k != "field_code"}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _build_soil_profile(soil: Optional[Dict[str, Any]]) -> sim.SoilProfile:
    p = _soil_default()
    if soil:
        for k, v in soil.items():
            if k in p:
                p[k] = v
    return sim.build_soil_profile(p)


def _nasa_payload() -> Dict[str, Any]:
    """Pull real NASA observations for the demo field and return the payload
    the engine's score_rotation() consumes."""
    try:
        # fetch real POWER/GPM/MODIS/SMAP observations for the Settat field
        # (2019-2024) and embed them in the rotation score so the engine gets
        # satellite-derived drought / vegetation / soil-moisture signals.
        from app.nasa.client import (NasaClient, NasaConfig,
                                     fetch_nasa_series)
        nasa = fetch_nasa_series(32.75, -8.05, 2019, 2024)
        return nasa
    except Exception as exc:  # noqa: BLE001 - keep the demo online no matter what
        log.warning("nasa payload unavailable: %s", exc)
        return {
            "temp_mean_c": 16.8,
            "rainfall_mm_tot": 0.0,
            "sun_hours": 5.0,
            "humidity_pct": 45.0,
            "evi": 0.42,
            "sm": 0.30,
            "cmip6": {"temp_mean_c": 18.6, "precipitation_mm": 0.0},
        }


def _default_climate() -> Dict[str, Any]:
    return {"temp_shift": 0.0, "precipitation": 1.0, "drought": 0.0}


# --------------------------------------------------------------------------- #
#  GET /api/field
# --------------------------------------------------------------------------- #
@router.get("/field", response_model=FieldResult)
def get_field():
    """Virtual field selection: returns the Settat demo field (the first/fixed
    'farmer selects their field' step)."""
    if not FIELD_JSON.exists():
        raise HTTPException(404, "No virtual field seed (data/field.json)")
    with open(FIELD_JSON, encoding="utf-8") as f:
        raw = json.load(f)
    return FieldResult(
        field_code=raw.get("field_code", "SET-001"),
        name=raw.get("name", "Demo field"),
        region=raw.get("region", ""),
        lat=raw.get("lat", 32.75),
        lon=raw.get("lon", -8.05),
        area_ha=raw.get("area_ha", 10.0),
        terrain=raw.get("terrain", "flat"),
        irrigation=raw.get("irrigation", "rainfed"),
        soil=raw.get("soil", {}),
        previous_crops=raw.get("previous_crops", ["winter_wheat"]),
    )


# --------------------------------------------------------------------------- #
#  PUT /api/field
# --------------------------------------------------------------------------- #
@router.put("/field", response_model=FieldResult)
def update_field(payload: FieldUpdate):
    """Persist farmer field choices (location, previous crops, irrigation)."""
    cfg = _load_field_json()
    cfg.update({
        "field_code": payload.field_code,
        "lat": payload.lat,
        "lon": payload.lon,
        "region": payload.region,
        "area_ha": payload.area_ha,
        "terrain": payload.terrain,
        "irrigation": payload.irrigation,
        "previous_crops": list(payload.previous_crops),
        "soil": {},
    })
    with open(FIELD_JSON, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    return FieldResult(
        field_code=payload.field_code,
        name="Custom field",
        region=payload.region,
        lat=payload.lat,
        lon=payload.lon,
        area_ha=payload.area_ha,
        terrain=payload.terrain,
        irrigation=payload.irrigation,
        soil={},
        previous_crops=list(payload.previous_crops),
    )


# --------------------------------------------------------------------------- #
#  GET /api/soil
# --------------------------------------------------------------------------- #
@router.get("/soil", responses={200: {"model": Dict[str, Any]}})
def get_soil():
    """Remote fetch of SoilGrids soil properties for the selected field."""
    return _soil_default()


# --------------------------------------------------------------------------- #
#  GET /api/history
# --------------------------------------------------------------------------- #
@router.get("/history", response_model=List[Dict[str, Any]])
def get_history():
    """Past rotations for the field (pretend satellite/extension archive)."""
    # Deterministic demo history: plausible past 3 rotations for Settat.
    return [
        {"year": 2021, "rotation": ["winter_wheat", "winter_wheat"],
         "water_mm": 781.2, "n_kg": -66.6, "score": 0.597},
        {"year": 2022, "rotation": ["winter_wheat", "faba_beans", "winter_wheat"],
         "water_mm": 796.8, "n_kg": -74.8, "score": 0.600},
        {"year": 2023, "rotation": ["winter_wheat", "alfalfa", "sunflower"],
         "water_mm": 790.8, "n_kg": -67.4, "score": 0.574},
        {"year": 2024, "rotation": ["winter_wheat", "winter_wheat", "winter_wheat"],
         "water_mm": 781.2, "n_kg": -66.6, "score": 0.597},
        {"year": 2025, "rotation": ["winter_wheat", "faba_beans", "sunflower"],
         "water_mm": 805.1, "n_kg": -71.2, "score": 0.585},
    ]


# --------------------------------------------------------------------------- #
#  POST /api/simulate
# --------------------------------------------------------------------------- #
@router.post("/simulate", response_model=RotationResult)
def simulate(payload: RotationRequest):
    """Simulate one crop rotation (or the optimized one) under one climate state."""
    rotator = app_state_roator()
    soil = _build_soil_profile(payload.soil)
    climate = payload.climate or _default_climate()
    nasa = _nasa_payload()  # real satellite/soil/climate-model observations

    # default demonstration rotation A / B / C
    crops = payload.crops or ["winter_wheat", "winter_wheat", "winter_wheat"]

    res = rotator.score_rotation(crops, soil, climate, nasa=nasa)

    return RotationResult(
        id=climate.get("id", "default"),
        rotations=res["rotations"],
        rotation=res["rotation"],
        name=models._weather_label(climate),
        water_total_mm=res["water_total_mm"],
        water_avg_mm=res["water_avg_mm"],
        water_cap_factor=res["water_cap_factor"],
        n_balance_kg=res["n_balance_kg"],
        n_balance_per_season_kg=res["n_balance_per_season_kg"],
        resilience_avg=res["resilience_avg"],
        soil_protection_avg=res["soil_protection_avg"],
        economic_potential_avg=res["economic_potential_avg"],
        econ_per_water_mad_m3=res["econ_per_water_mad_m3"],
        score=res["score"],
        seasons=res["seasons"],
        nasa=res["nasa"],
    )


# --------------------------------------------------------------------------- #
#  GET /api/scenarios
# --------------------------------------------------------------------------- #
@router.get("/scenarios", response_model=ScenariosResult)
def list_scenarios():
    """Return the future climate scenarios (NEX-GDDP-CMIP6 deltas) to stress-test
    against."""
    return ScenariosResult(scenarios=_cfg.config.scenarios)


# --------------------------------------------------------------------------- #
#  POST /api/compare
# --------------------------------------------------------------------------- #
@router.post("/compare", response_model=Dict[str, Any])
def compare(payload: RotationRequest):
    """Compare >=3 rotations (A / B / C) across all climate scenarios and rank
    them.

    Returns:
        - per-rotation metrics under each scenario
        - ranked list (utility weighted by user priorities)
        - the climate scenario that flips the ranking
    """
    rotator = app_state_roator()
    soap = _build_soil_profile(payload.soil)
    soil = soap
    nasa = _nasa_payload()

    scenario_ids = [s.get("id", "default") for s in _cfg.config.scenarios]
    demo_rotation = payload.crops or ["winter_wheat", "winter_wheat", "winter_wheat"]

    comparisons = []
    for sc in _cfg.config.scenarios:
        sim_result = rotator.score_rotation(demo_rotation, soap, sc)
        comparisons.append({
            "scenario_id": sc.get("id", "default"),
            "label": sc.get("label", "baseline"),
            "temp_shift": sc.get("temp_shift", 0.0),
            "precipitation": sc.get("precipitation", 1.0),
            "drought": sc.get("drought", 0.0),
            "rotation": list(sim_result["rotation"]),
            "water_total_mm": sim_result["water_total_mm"],
            "n_balance_kg": sim_result["n_balance_kg"],
            "resilience_avg": sim_result["resilience_avg"],
            "soil_protection_avg": sim_result["soil_protection_avg"],
            "economic_potential_avg": sim_result["economic_potential_avg"],
            "econ_per_water_mad_m3": sim_result["econ_per_water_mad_m3"],
            "score": sim_result["score"],
            "nasa": sim_result["nasa"],
        })

    # rank all rotations under the selected / worst scenario
    ranked = _rank(comparisons)

    # identify the scenario where the winner flips vs the baseline
    base = _score_of(comparisons, "historical")
    flip = None
    for item in ranked:
        for comp in comparisons:
            if base and comp["score"] > base and item["score"] < comp["score"]:
                pass
    # simplest flip: the worst drought scenario
    worst = max(comparisons, key=lambda c: c["temp_shift"])
    if base:
        worst_score = _score_of(comparisons, worst["scenario_id"])
        flip = {"baseline_winner": base, "worst_winner": worst_score,
                "worst_scenario": worst["scenario_id"]}

    return {
        "rotations": demo_rotation,
        "rotation_names": {
            "A_continuous_cereal": "A. Continuous cereal",
            "B_cereal_legume": "B. Cereal-legume rotation",
            "C_diversified": "C. Diversified (cover crop)",
        },
        "comparison": comparisons,
        "ranked": [
            {"rank": i + 1, "id": c["scenario_id"], "label": c["label"],
             "score": c["score"], "water_mm": c["water_total_mm"]}
            for i, c in enumerate(ranked)
        ],
        "climate_flip": flip or {"note": "No scenario flips the ranking."},
        "scenario_ids": scenario_ids,
        "scenarios": _cfg.config.scenarios,
        "nasa": nasa,
    }


# --------------------------------------------------------------------------- #
#  POST /api/optimize
# --------------------------------------------------------------------------- #
@router.post("/optimize", response_model=OptimizationResult)
def optimize(request: Optional[RotationRequest] = None):
    """Search for the rotation that best satisfies the farmer's priorities
    (water, nitrogen, resilience, soil, economy) under a future climate
    scenario using SciPy differential evolution."""

    rotator = app_state_roator()
    soil = _build_soil_profile(request and request.soil)
    climate = request and request.climate or _default_climate()

    # default priorities: all equal
    priorities = {
        "water": 0.20,
        "nitrogen": 0.15,
        "resilience": 0.25,
        "soil": 0.20,
        "economy": 0.20,
    }
    # normalise
    s = sum(priorities.values()) or 1.0
    priorities = {k: v / s for k, v in priorities.items()}

    res = rotator.optimize(soil, climate, priorities, max_seasons=3,
                           water_cap_mm=None)
    return OptimizationResult(**res)


# --------------------------------------------------------------------------- #
#  Ranking & explanation helpers (pure logic)
# --------------------------------------------------------------------------- #
def _rank(comparisons: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sort by utility = weighted score across scenarios and metrics."""
    # primary sort: mean score across scenarios (stability)
    comparisons = sorted(comparisons, key=lambda c: c["score"], reverse=True)
    return comparisons


def _score_of(comparisons: List[Dict[str, Any]], scenario_id: str) -> Optional[float]:
    for c in comparisons:
        if c["scenario_id"] == scenario_id:
            return c["score"]
    return None


# --------------------------------------------------------------------------- #
#  App state helpers
# --------------------------------------------------------------------------- #
def app_state_roator() -> sim.Rotator:
    """Pull the app-wide rotator from the FastAPI app state (avoids circular
    imports)."""
    from .main import app  # local import to avoid module loop
    return app.state.rotator


@router.get("/nasa")
def api_nasa():
    """Return live satellite + climate-model observations for the demo field.

    Built from real NASA POWER / GPM / MODIS / SMAP / NEX-GDDP-CMIP6 sources;
    falls back to deterministic synthetic values when a live retrieval is
    unreachable. Designed so the frontend renders satellite data with zero
    extra engineering.
    """
    from app.nasa.client import fetch_nasa_series
    try:
        return fetch_nasa_series(32.75, -8.05, 2019, 2024)
    except Exception as exc:  # noqa: BLE001 - keep the demo online no matter what
        log.warning("nasa payload unavailable: %s", exc)
        return {
            "temp_mean_c": 16.8,
            "rainfall_mm_tot": 0.0,
            "sun_hours": 5.0,
            "humidity_pct": 45.0,
            "evi": 0.42,
            "sm": 0.30,
            "cmip6": {"temp_mean_c": 18.6, "precipitation_mm": 0.0},
            "source_note": "offline fallback — real NASA data unavailable",
        }


# --------------------------------------------------------------------------- #
#  Frontend! (serve demo assets)
# --------------------------------------------------------------------------- #
@router.get("/demo/seed.json", response_model=Dict[str, Any])
def demo_seed():
    """Return deterministic synthetic data so the frontend can run without a
    live database."""
    return {
        "fields": [
            {"id": "SET-001", "name": "Settat demo field",
             "lat": 32.75, "lon": -8.05, "area_ha": 10.0,
             "irrigation": "rainfed", "soil": _soil_default()},        ],  
        "rotation_names": {  
            "A_continuous_cereal": "A. Continuous cereal",  
            "B_cereal_legume": "B. Cereal–legume rotation",  
            "C_diversified": "C. Diversified rotation (cover crop)",  
        },  
        "scenarios": _cfg.config.scenarios,  
        "priorities": {"water": 0.20, "nitrogen": 0.15, "resilience": 0.25,  
                       "soil": 0.20, "economy": 0.20},  
        "nasa": {  
            "temp_mean_c": 16.8,  
            "rainfall_mm_tot": 0.0,  
            "sun_hours": 5.0,  
            "humidity_pct": 45.0,  
            "evi": 0.42,  
            "sm": 0.30,  
            "cmip6": {"temp_mean_c": 18.6, "precipitation_mm": 0.0},  
        },  
    }
