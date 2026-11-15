"""Tests for the agronomic layer that turns NASA POWER data into decisions.

These verify arithmetic and plumbing, not agronomic validity against field
observations. Unit conversions, band edges and the documented relationships
(ETc = Kc x ET0, deficit = max(0, ETc - effective rainfall)) are checked.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.config import config as cfg
from app.simulator import agronomy, engine as sim

BACK_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACK_DIR.parent
AGRO_JSON = BACK_DIR / "data" / "agronomy.json"
AGRO_JS = REPO_ROOT / "front" / "src" / "lib" / "agronomy.data.js"

SOIL = sim.SoilProfile(sand_pct=42.0, silt_pct=43.0, clay_pct=15.0, ph=8.1,
                       organic_c_pct=0.9, nacl_ppth=6.0)


def _series(et0_by_month, rain_by_month, temp_by_month, years=(2019, 2020)):
    """Build a NASA POWER-shaped monthly series for the given years."""
    series = {}
    for year in years:
        for month in range(1, 13):
            series[f"{year}-{month:02d}"] = {
                "temp_mean_c": temp_by_month.get(month, 18.0),
                "rainfall_mm": rain_by_month.get(month, 0.0),
                "et0_mm": et0_by_month.get(month, 100.0),
            }
    return {"series": series, "data_status": "partial"}


def _flat_series(et0_mm, rain_mm, temp_c=18.0):
    return _series({m: et0_mm for m in range(1, 13)},
                   {m: rain_mm for m in range(1, 13)},
                   {m: temp_c for m in range(1, 13)})


# --------------------------------------------------------------- arithmetic ---
def test_effective_rainfall_uses_usda_scs_curve():
    assert agronomy.effective_rainfall(0.0) == 0.0
    # 100 mm -> 100 * (125 - 20) / 125 = 84 mm
    assert agronomy.effective_rainfall(100.0) == pytest.approx(84.0)
    # Above 250 mm the second branch applies with a 0.1 factor
    assert agronomy.effective_rainfall(300.0) == pytest.approx(155.0)


def test_kc_season_matches_fao56_stage_weighting():
    # wheat: 25 d @0.40, 60 d @(0.40+1.15)/2, 75 d @1.15, 50 d @0.30
    expected = (0.40 * 25 + 0.775 * 60 + 1.15 * 75 + 0.30 * 50) / 210
    assert agronomy.kc_season("winter_wheat") == pytest.approx(expected, abs=1e-4)
    assert agronomy.kc_season("fallow") is None


def test_etc_is_kc_times_et0_over_the_crop_window():
    # Winter wheat window (Nov-Apr) = 6 months x 100 mm ET0 = 600 mm
    budget = agronomy.water_budget("winter_wheat", _flat_series(100.0, 0.0))
    assert budget["available"] is True
    assert budget["et0_mm"] == pytest.approx(600.0)
    assert budget["etc_mm"] == pytest.approx(
        agronomy.kc_season("winter_wheat") * 600.0, abs=0.1)


def test_deficit_subtracts_effective_rainfall_only():
    budget = agronomy.water_budget("winter_wheat", _flat_series(100.0, 20.0))
    # 6 winter months x Pe(20 mm) = 6 x 19.36 = 116.16 mm effective
    per_month = agronomy.effective_rainfall(20.0)
    assert budget["effective_rain_mm"] == pytest.approx(6 * per_month, abs=0.2)
    assert budget["deficit_mm"] == pytest.approx(
        max(0.0, budget["etc_mm"] - budget["effective_rain_mm"]), abs=0.2)


def test_wetter_series_reduces_deficit_and_raises_water_component():
    dry = sim.Rotator().score_rotation(
        ["carrot", "lentils", "lettuce"], SOIL, agronomy_climate(),
        nasa=_flat_series(100.0, 0.0), priority_weights=PRIORITIES)
    wet = sim.Rotator().score_rotation(
        ["carrot", "lentils", "lettuce"], SOIL, agronomy_climate(),
        nasa=_flat_series(100.0, 60.0), priority_weights=PRIORITIES)
    assert dry["water_budget"]["deficit_total_mm"] > wet["water_budget"]["deficit_total_mm"]
    assert wet["components"]["water"] > dry["components"]["water"]
    assert wet["score"] > dry["score"]


def agronomy_climate():
    return next(s for s in cfg.scenarios if s["id"] == "historical")


PRIORITIES = {"water": 0.2, "nitrogen": 0.15, "resilience": 0.25,
              "soil": 0.2, "economy": 0.2}


def test_water_budget_reports_unavailable_without_series():
    budget = agronomy.water_budget("winter_wheat", {"data_status": "synthetic"})
    assert budget["available"] is False
    assert "unavailable" in budget["reason"]


def test_missing_months_disqualify_the_window():
    partial = _flat_series(100.0, 0.0)
    for year in ("2019", "2020"):
        del partial["series"][f"{year}-03"]
    assert agronomy.water_budget("winter_wheat", partial)["available"] is False


# ------------------------------------------------------------- suitability ---
def test_temperature_suitability_is_one_inside_the_optimal_band():
    crop = agronomy.crop_agronomy("winter_wheat")
    inside = sum(crop["t_opt"]) / 2
    assert agronomy.temperature_suitability("winter_wheat", inside) == 1.0
    cold = crop["t_abs"][0] - 5
    assert agronomy.temperature_suitability("winter_wheat", cold) == 0.0
    assert agronomy.temperature_suitability("winter_wheat", None) is None


def test_ph_suitability_decays_outside_the_documented_band():
    assert agronomy.ph_suitability("potato", 6.0) == 1.0
    assert agronomy.ph_suitability("carrot", 8.1) == pytest.approx(0.6)
    assert agronomy.ph_suitability("carrot", 9.0) == 0.0


def test_salinity_is_reported_but_not_part_of_the_score():
    rotator = sim.Rotator()
    result = rotator.score_rotation(["carrot", "lentils", "lettuce"], SOIL,
                                    agronomy_climate(), nasa=_flat_series(100.0, 10.0),
                                    priority_weights=PRIORITIES)
    assert result["soil_suitability"]["ece_ds_m"] == pytest.approx(10.8)
    assert result["seasons"][0]["salinity_yield_factor"] == 0.0
    # Changing only salinity must not move the score: it is informational.
    low_salt = sim.SoilProfile(**{**SOIL.__dict__, "nacl_ppth": 0.1})
    low = rotator.score_rotation(["carrot", "lentils", "lettuce"], low_salt,
                                 agronomy_climate(), nasa=_flat_series(100.0, 10.0),
                                 priority_weights=PRIORITIES)
    assert low["score"] == result["score"]


# ---------------------------------------------------------------- decisions ---
def test_recommendations_respond_to_nasa_rainfall():
    """Real NASA rainfall must move rankings, not just the displayed numbers.

    With the default weights (water is 20% of the score) the same three crops
    can survive a rainfall change, so this test also checks the water-first
    case where the ranking must reorder.
    """
    rotator = sim.Rotator()
    dry_nasa = _flat_series(100.0, 2.0)     # 12 mm/year: effectively arid
    wet_nasa = _flat_series(100.0, 55.0)    # ~330 mm/year in winter windows
    water_first = {"water": 1.0}

    dry = rotator.recommend_rotations(SOIL, agronomy_climate(), water_first,
                                      nasa=dry_nasa, count=3)
    wet = rotator.recommend_rotations(SOIL, agronomy_climate(), water_first,
                                      nasa=wet_nasa, count=3)
    assert [r["rotation"] for r in dry] != [r["rotation"] for r in wet]
    assert dry[0]["water_budget"]["water_source"] == "nasa_power"
    assert wet[0]["components"]["water"] >= dry[0]["components"]["water"]

    # Same rotation, different NASA rainfall: the water component must respond.
    wheat = ["winter_wheat", "winter_wheat", "winter_wheat"]
    dry_score = rotator.score_rotation(wheat, SOIL, agronomy_climate(),
                                       nasa=dry_nasa, priority_weights=PRIORITIES)
    wet_score = rotator.score_rotation(wheat, SOIL, agronomy_climate(),
                                       nasa=wet_nasa, priority_weights=PRIORITIES)
    assert wet_score["water_budget"]["deficit_total_mm"] < \
        dry_score["water_budget"]["deficit_total_mm"]
    assert wet_score["components"]["water"] > dry_score["components"]["water"]


def test_hotter_nasa_temperature_lowers_thermal_suitability_for_cool_crops():
    rotator = sim.Rotator()
    cool = _flat_series(100.0, 10.0)
    hot = _series({m: 100.0 for m in range(1, 13)},
                  {m: 10.0 for m in range(1, 13)},
                  {m: 38.0 for m in range(1, 13)})
    a = rotator.score_rotation(["lettuce", "lentils", "carrot"], SOIL,
                               agronomy_climate(), nasa=cool,
                               priority_weights=PRIORITIES)
    b = rotator.score_rotation(["lettuce", "lentils", "carrot"], SOIL,
                               agronomy_climate(), nasa=hot,
                               priority_weights=PRIORITIES)
    assert a["seasons"][0]["climate_suitability"] == 1.0
    assert b["seasons"][0]["climate_suitability"] < 0.5
    assert b["components"]["resilience"] < a["components"]["resilience"]


def test_economics_per_cubic_metre_converts_mm_to_m3():
    result = sim.Rotator().score_rotation(["winter_wheat"] * 3, SOIL,
                                          agronomy_climate(),
                                          nasa=_flat_series(100.0, 10.0),
                                          priority_weights=PRIORITIES)
    revenue = 3 * sim.CropDatabase().crop("winter_wheat").econ_rev_mad
    expected = revenue / (result["water_total_mm"] * 10.0)
    assert result["econ_per_water_mad_m3"] == pytest.approx(expected, abs=0.05)


# ---------------------------------------------------------------- coherence ---
def test_browser_engine_coefficients_match_the_python_table():
    """The Pages build must use the same coefficients as the API."""
    assert AGRO_JS.exists(), "front/src/lib/agronomy.data.js is missing"
    text = AGRO_JS.read_text(encoding="utf-8")
    match = re.search(r"export const AGRO = (\{.*\})\s*$", text, re.S)
    assert match, "agronomy.data.js does not export AGRO"
    js_data = json.loads(match.group(1))
    py_data = json.loads(AGRO_JSON.read_text(encoding="utf-8"))
    assert js_data["crops"] == py_data["crops"]
