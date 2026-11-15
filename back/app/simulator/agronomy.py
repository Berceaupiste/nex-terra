"""Agronomic reference layer: crop coefficients, water balance, suitability.

This module turns NASA POWER monthly climate statistics into crop-level water
and suitability metrics. It is deliberately small and explicit so that every
number reported by the API can be traced to a documented relationship:

  ETc        = Kc_season x ET0_season          (FAO-56, Allen et al. 1998)
  Pe         = USDA-SCS effective rainfall     (simplified, monthly)
  deficit    = max(0, ETc - Pe)                (simplified seasonal balance)

``ETc`` is crop evapotranspiration demand. The deficit is the part of that
demand not met by effective rainfall *within the crop growing window*. It is
not an irrigation schedule: soil water storage, irrigation efficiency, runoff,
capillary rise and leaching are not modelled.

Kc, stage lengths, temperature/pH bands and salinity tolerance come from
``back/data/agronomy.json`` (identical file shipped to the browser engine).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

AGRO_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "agronomy.json"

with AGRO_PATH.open(encoding="utf-8") as _agro_file:
    AGRO: Dict[str, Any] = json.load(_agro_file)

CROPS: Dict[str, Dict[str, Any]] = AGRO["crops"]

# Reference supplemental-water demand (mm per season) at which the water
# component reaches zero. 600 mm/season is roughly the upper end of net
# irrigation demand for the field crops in this catalogue in Morocco.
WATER_DEFICIT_REFERENCE_MM = 600.0

# ET0 sensitivity to warming. FAO-56 and the IPCC literature put the
# evaporative demand response at roughly 2-4% per degree C; 3% is used here.
ET0_TEMP_SENSITIVITY_PER_C = 0.03

# Fallback reference ET0 when NASA POWER monthly series are unavailable.
FALLBACK_ET0_MM_DAY = 4.0

SALINITY_TO_ECE = 1.8  # ECe (dS/m) ~= 1.8 x NaCl concentration (g/L)


def crop_agronomy(code: str) -> Optional[Dict[str, Any]]:
    return CROPS.get(code)


def kc_season(code: str) -> Optional[float]:
    """Season-weighted single crop coefficient from FAO-56 stage lengths.

    The development stage coefficient is taken as the midpoint between the
    initial and mid-season values, which reproduces the linear FAO-56 curve
    closely enough for a seasonal mean.
    """
    crop = crop_agronomy(code)
    if crop is None:
        return None
    days = crop["stages_days"]
    span = sum(days.values())
    if span <= 0:
        return None
    weighted = (
        crop["kc_ini"] * days["ini"]
        + ((crop["kc_ini"] + crop["kc_mid"]) / 2.0) * days["dev"]
        + crop["kc_mid"] * days["mid"]
        + crop["kc_end"] * days["late"]
    )
    return round(weighted / span, 4)


def _trapezoid(value: float, low: float, high: float,
               abs_low: float, abs_high: float) -> float:
    """1.0 inside [low, high], falling linearly to 0 at the absolute limits."""
    if value < abs_low or value > abs_high:
        return 0.0
    if low <= value <= high:
        return 1.0
    if value < low:
        return (value - abs_low) / (low - abs_low) if low > abs_low else 0.0
    return (abs_high - value) / (abs_high - high) if abs_high > high else 0.0


def temperature_suitability(code: str, mean_temp_c: Optional[float]) -> Optional[float]:
    """0..1 suitability of the crop-window mean temperature (FAO EcoCrop bands)."""
    crop = crop_agronomy(code)
    if crop is None or mean_temp_c is None:
        return None
    return round(
        _trapezoid(mean_temp_c, crop["t_opt"][0], crop["t_opt"][1],
                   crop["t_abs"][0], crop["t_abs"][1]),
        3,
    )


def ph_suitability(code: str, ph: float) -> Optional[float]:
    """0..1 pH suitability: full credit inside the documented band, decaying outside."""
    crop = crop_agronomy(code)
    if crop is None:
        return None
    low, high = crop["ph_range"]
    if low <= ph <= high:
        return 1.0
    distance = low - ph if ph < low else ph - high
    return round(max(0.0, 1.0 - distance / 1.5), 3)


def salinity_yield_factor(code: str, ece_ds_m: float) -> Optional[float]:
    """FAO-29 relative yield under salinity (informational, not scored)."""
    crop = crop_agronomy(code)
    if crop is None:
        return None
    threshold = crop["ec_threshold_ds_m"]
    if ece_ds_m <= threshold:
        return 1.0
    decline = crop["ec_decline_per_ds_m"] * (ece_ds_m - threshold)
    return round(max(0.0, 1.0 - decline), 3)


def effective_rainfall(mm: float) -> float:
    """USDA-SCS monthly effective-rainfall approximation."""
    if mm <= 0.0:
        return 0.0
    if mm <= 250.0:
        return max(0.0, mm * (125.0 - 0.2 * mm) / 125.0)
    return 125.0 + 0.1 * mm


def _window_climate(nasa: Optional[dict], months: List[int]) -> Optional[Dict[str, Any]]:
    """Mean annual ET0/rainfall/temperature over the crop window.

    NASA POWER ``series`` holds monthly records keyed ``YYYY-MM``. For each year
    that has an ET0 value for every month in the window, we sum ET0 and
    rainfall and average temperature; results are then averaged across those
    years so that the seasonal totals represent one typical year.
    """
    if not nasa:
        return None
    series = nasa.get("series") or {}
    if not isinstance(series, dict) or not series:
        return None
    by_year: Dict[str, Dict[int, Dict[str, Any]]] = {}
    for key, row in series.items():
        if not isinstance(row, dict) or len(key) != 7 or key[4] != "-":
            continue
        try:
            year, month = key[:4], int(key[5:7])
        except ValueError:
            continue
        by_year.setdefault(year, {})[month] = row

    et0_totals, rain_totals, pe_totals, temp_means = [], [], [], []
    for months_by_index in by_year.values():
        if not all(month in months_by_index for month in months):
            continue
        if any(
            months_by_index[month].get("et0_mm") is None
            or months_by_index[month].get("rainfall_mm") is None
            for month in months
        ):
            continue
        et0_totals.append(sum(months_by_index[m]["et0_mm"] for m in months))
        rain_totals.append(sum(months_by_index[m]["rainfall_mm"] for m in months))
        # USDA-SCS is a monthly formula, so apply it month by month.
        pe_totals.append(sum(
            effective_rainfall(months_by_index[m]["rainfall_mm"]) for m in months
        ))
        temps = [
            months_by_index[m]["temp_mean_c"] for m in months
            if months_by_index[m].get("temp_mean_c") is not None
        ]
        if temps:
            temp_means.append(sum(temps) / len(temps))

    if not et0_totals:
        return None
    years = len(et0_totals)
    return {
        "years_used": years,
        "et0_mm": round(sum(et0_totals) / years, 1),
        "rainfall_mm": round(sum(rain_totals) / years, 1),
        "effective_rain_mm": round(sum(pe_totals) / years, 1),
        "temp_mean_c": (
            round(sum(temp_means) / len(temp_means), 2) if temp_means else None
        ),
    }


def water_budget(
    code: str,
    nasa: Optional[dict],
    climate: Optional[dict] = None,
    soil_ph: Optional[float] = None,
) -> Dict[str, Any]:
    """Seasonal ETc, effective rainfall and deficit for one crop.

    Returns ``available: False`` with an explicit reason when NASA POWER monthly
    series are missing, so callers can fall back to a labelled placeholder
    instead of silently inventing numbers.
    """
    climate = climate or {}
    crop = crop_agronomy(code)
    if crop is None:
        return {
            "available": False,
            "reason": "No agronomic coefficients for this crop (fallow or unsupported).",
        }
    months = crop["window_months"]
    window = _window_climate(nasa, months)
    if window is None:
        return {
            "available": False,
            "reason": (
                "NASA POWER monthly ET0/rainfall series are unavailable for this "
                "window; water demand falls back to a labelled estimate."
            ),
            "window_months": months,
        }

    temp_shift = float(climate.get("temp_shift", 0.0) or 0.0)
    precip_factor = float(climate.get("precipitation", 1.0) or 1.0)
    drought = float(climate.get("drought", 0.0) or 0.0)

    rain_factor = precip_factor * (1.0 - 0.5 * drought)
    et0_mm = window["et0_mm"] * (1.0 + ET0_TEMP_SENSITIVITY_PER_C * temp_shift)
    rain_mm = window["rainfall_mm"] * rain_factor
    kc = kc_season(code) or 1.0
    etc_mm = kc * et0_mm
    pe_mm = window["effective_rain_mm"] * rain_factor
    deficit_mm = max(0.0, etc_mm - pe_mm)

    return {
        "available": True,
        "source": "NASA POWER monthly series (T2M, PRECTOTCORR) + FAO-56 ET0",
        "window_months": months,
        "years_used": window["years_used"],
        "et0_mm": round(et0_mm, 1),
        "kc_season": kc,
        "etc_mm": round(etc_mm, 1),
        "rainfall_mm": round(rain_mm, 1),
        "effective_rain_mm": round(pe_mm, 1),
        "deficit_mm": round(deficit_mm, 1),
        "temp_mean_c": window["temp_mean_c"],
        "temp_window_c": (
            round(window["temp_mean_c"] + temp_shift, 2)
            if window["temp_mean_c"] is not None else None
        ),
        "scenario_adjustments": {
            "temp_shift_c": temp_shift,
            "precipitation_factor": precip_factor,
            "drought_index": drought,
        },
    }


def water_component(deficit_mm_total: float, seasons: int) -> float:
    """0..1 water suitability from the mean seasonal supplemental need."""
    if seasons <= 0:
        return 0.0
    per_season = deficit_mm_total / seasons
    return max(0.0, min(1.0, 1.0 - per_season / WATER_DEFICIT_REFERENCE_MM))
