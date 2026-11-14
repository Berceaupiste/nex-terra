"""Smoke tests for the NEX TERRA backend.

Run with: .venv/bin/python -m pytest test_api.py -q
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"


def _client():
    app = create_app()
    return TestClient(app)


def _seed_data():
    # regenerate the demo data files so tests are deterministic
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "field.json").write_text(
        json.dumps({
            "field_code": "SET-001", "name": "Demonstration field - Settat",
            "region": "Settat, Rabat-Salé-Kénitra, Morocco", "lat": 32.75,
            "lon": -8.05, "area_ha": 10.0, "terrain": "flat",
            "irrigation": "rainfed",
            "soil": {"soil_type": "loam", "sand_pct": 42.0, "silt_pct": 43.0,
                     "clay_pct": 15.0, "ph": 8.1, "organic_c_pct": 0.9,
                     "nacl_ppth": 6.0},
            "previous_crops": ["winter_wheat", "wheat"],
        }), encoding="utf-8")
    (DATA_DIR / "config.json").write_text(
        json.dumps({"scenarios": [
            {"id": "historical", "label": "Historical baseline",
             "temp_shift": 0.0, "precipitation": 1.0, "drought": 0.0},
            {"id": "mild_warming_wet", "label": "Mild warming + wetter",
             "temp_shift": 1.0, "precipitation": 1.05, "drought": 0.0},
            {"id": "severe_drying", "label": "Severe drying",
             "temp_shift": 1.8, "precipitation": 0.78, "drought": 0.35},
            {"id": "hot_wet", "label": "Hot + wet",
             "temp_shift": 2.2, "precipitation": 1.12, "drought": 0.10},
        ]}), encoding="utf-8")
    (DATA_DIR / "crops.json").write_text(
        json.dumps([
            {"code": "winter_wheat", "name": "Winter wheat", "family": "cereal",
             "water_hunger": 0.62, "stress_sensitivity": 0.35,
             "base_et_mm": 420.0, "soil_pref": 0.2, "econ_rev_mad": 18500.0,
             "econ_gwp_m3kg": 1350.0},
            {"code": "barley", "name": "Barley", "family": "cereal",
             "water_hunger": 0.55, "stress_sensitivity": 0.30,
             "base_et_mm": 390.0, "soil_pref": 0.3, "econ_rev_mad": 16500.0,
             "econ_gwp_m3kg": 1250.0},
            {"code": "faba_beans", "name": "Faba beans", "family": "legume",
             "water_hunger": 0.60, "stress_sensitivity": 0.30,
             "base_et_mm": 460.0, "soil_pref": -0.4, "econ_rev_mad": 21000.0,
             "econ_gwp_m3kg": 1100.0},
            {"code": "chickpeas", "name": "Chickpeas", "family": "legume",
             "water_hunger": 0.58, "stress_sensitivity": 0.33,
             "base_et_mm": 440.0, "soil_pref": -0.5, "econ_rev_mad": 25000.0,
             "econ_gwp_m3kg": 1150.0},
            {"code": "lentils", "name": "Lentils", "family": "legume",
             "water_hunger": 0.57, "stress_sensitivity": 0.34,
             "base_et_mm": 430.0, "soil_pref": -0.5, "econ_rev_mad": 26000.0,
             "econ_gwp_m3kg": 1200.0},
            {"code": "sunflower", "name": "Sunflower", "family": "oilseed",
             "water_hunger": 0.52, "stress_sensitivity": 0.28,
             "base_et_mm": 520.0, "soil_pref": 0.1, "econ_rev_mad": 20000.0,
             "econ_gwp_m3kg": 1400.0},
            {"code": "sugar_beet", "name": "Sugar beet", "family": "root",
             "water_hunger": 0.50, "stress_sensitivity": 0.30,
             "base_et_mm": 500.0, "soil_pref": -0.1, "econ_rev_mad": 23000.0,
             "econ_gwp_m3kg": 1300.0},
            {"code": "sweet_potato", "name": "Sweet potato", "family": "tuber",
             "water_hunger": 0.55, "stress_sensitivity": 0.35,
             "base_et_mm": 560.0, "soil_pref": 0.2, "econ_rev_mad": 15000.0,
             "econ_gwp_m3kg": 1500.0},
            {"code": "potato", "name": "Potato", "family": "tuber",
             "water_hunger": 0.50, "stress_sensitivity": 0.30,
             "base_et_mm": 480.0, "soil_pref": -0.2, "econ_rev_mad": 19000.0,
             "econ_gwp_m3kg": 1400.0},
            {"code": "tomato", "name": "Tomato", "family": "vegetable",
             "water_hunger": 0.48, "stress_sensitivity": 0.28,
             "base_et_mm": 520.0, "soil_pref": -0.1, "econ_rev_mad": 32000.0,
             "econ_gwp_m3kg": 1300.0},
            {"code": "onion", "name": "Onion", "family": "vegetable",
             "water_hunger": 0.45, "stress_sensitivity": 0.30,
             "base_et_mm": 400.0, "soil_pref": 0.3, "econ_rev_mad": 26000.0,
             "econ_gwp_m3kg": 1250.0},
            {"code": "carrot", "name": "Carrot", "family": "root",
             "water_hunger": 0.45, "stress_sensitivity": 0.30,
             "base_et_mm": 400.0, "soil_pref": 0.2, "econ_rev_mad": 22000.0,
             "econ_gwp_m3kg": 1250.0},
            {"code": "alfalfa", "name": "Alfalfa", "family": "cover",
             "water_hunger": 0.40, "stress_sensitivity": 0.50,
             "base_et_mm": 650.0, "soil_pref": -0.6, "econ_rev_mad": 12000.0,
             "econ_gwp_m3kg": 900.0},
            {"code": "clover", "name": "Clover", "family": "cover",
             "water_hunger": 0.40, "stress_sensitivity": 0.50,
             "base_et_mm": 600.0, "soil_pref": -0.6, "econ_rev_mad": 9000.0,
             "econ_gwp_m3kg": 850.0},
            {"code": "lettuce", "name": "Lettuce", "family": "vegetable",
             "water_hunger": 0.42, "stress_sensitivity": 0.25,
             "base_et_mm": 300.0, "soil_pref": 0.2, "econ_rev_mad": 24000.0,
             "econ_gwp_m3kg": 1500.0},
            {"code": "maize", "name": "Maize", "family": "cereal",
             "water_hunger": 0.58, "stress_sensitivity": 0.33,
             "base_et_mm": 560.0, "soil_pref": 0.1, "econ_rev_mad": 17000.0,
             "econ_gwp_m3kg": 1500.0},
            {"code": "sorghum", "name": "Sorghum", "family": "cereal",
             "water_hunger": 0.50, "stress_sensitivity": 0.30,
             "base_et_mm": 500.0, "soil_pref": 0.2, "econ_rev_mad": 13000.0,
             "econ_gwp_m3kg": 1300.0},
            {"code": "pulses", "name": "General pulses", "family": "legume",
             "water_hunger": 0.55, "stress_sensitivity": 0.30,
             "base_et_mm": 460.0, "soil_pref": -0.5, "econ_rev_mad": 21000.0,
             "econ_gwp_m3kg": 1150.0},
            {"code": "cereal_mix", "name": "Cereal mix", "family": "cereal",
             "water_hunger": 0.58, "stress_sensitivity": 0.32,
             "base_et_mm": 420.0, "soil_pref": 0.1, "econ_rev_mad": 17500.0,
             "econ_gwp_m3kg": 1300.0},
            {"code": "fallow", "name": "Fallow", "family": "fallow",
             "water_hunger": 0.0, "stress_sensitivity": 0.0,
             "base_et_mm": 0.0, "soil_pref": 0.0, "econ_rev_mad": 0.0,
             "econ_gwp_m3kg": 0.0},
        ]), encoding="utf-8")
    (DATA_DIR / "field.json").write_text(
        json.dumps({
            "field_code": "SET-001", "name": "Demonstration field - Settat",
            "region": "Settat, Rabat-Salé-Kénitra, Morocco", "lat": 32.75,
            "lon": -8.05, "area_ha": 10.0, "terrain": "flat",
            "irrigation": "rainfed",
            "soil": {"soil_type": "loam", "sand_pct": 42.0, "silt_pct": 43.0,
                     "clay_pct": 15.0, "ph": 8.1, "organic_c_pct": 0.9,
                     "nacl_ppth": 6.0},
            "previous_crops": ["winter_wheat", "wheat"],
        }), encoding="utf-8")


def test_health():
    client = _client()
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_field_endpoint():
    _seed_data()
    client = _client()
    r = client.get("/api/field")
    assert r.status_code == 200
    body = r.json()
    assert body["field_code"] == "SET-001"
    assert body["name"].startswith("Demonstration")
    assert body["lat"] == 32.75
    assert body["lon"] == -8.05
    assert body["area_ha"] == 10.0
    assert body["irrigation"] == "rainfed"


def test_soil_endpoint():
    _seed_data()
    client = _client()
    r = client.get("/api/soil")
    assert r.status_code == 200
    assert r.json()["soil_type"] == "loam"


def test_history_endpoint():
    _seed_data()
    client = _client()
    r = client.get("/api/history")
    assert r.status_code == 200
    assert len(r.json()) >= 3


def test_scenarios_endpoint():
    _seed_data()
    client = _client()
    r = client.get("/api/scenarios")
    assert r.status_code == 200
    assert len(r.json()["scenarios"]) == 4


def test_simulate_endpoint():
    _seed_data()
    client = _client()
    payload = {"crops": ["winter_wheat", "faba_beans", "winter_wheat"]}
    r = client.post("/api/simulate", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["rotation"] == ["winter_wheat", "faba_beans", "winter_wheat"]
    assert body["water_total_mm"] > 0
    assert "resilience_avg" in body
    assert body["score"] > 0


def test_compare_endpoint():
    _seed_data()
    client = _client()
    payload = {"crops": ["winter_wheat", "winter_wheat", "winter_wheat"]}
    r = client.post("/api/compare", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert len(body["comparison"]) == 4
    assert len(body["ranked"]) == 4
    assert body["climate_flip"]
    # the three demonstration rotations exist (keys are full names)
    names = body["rotation_names"]
    assert "A_continuous_cereal" in names
    assert "B_cereal_legume" in names
    assert "C_diversified" in names


def test_optimize_endpoint():
    _seed_data()
    client = _client()
    payload = {"crops": ["winter_wheat", "faba_beans", "winter_wheat"]}
    r = client.post("/api/optimize", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert "optimized_rotation" in body
    assert len(body["optimized_rotation"]) >= 1


def test_demo_seed_endpoint():
    _seed_data()
    client = _client()
    r = client.get("/api/demo/seed.json")
    assert r.status_code == 200
    body = r.json()
    assert "fields" in body
    assert "scenarios" in body
    assert "rotation_names" in body
