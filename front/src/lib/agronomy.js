// Browser port of back/app/simulator/agronomy.py.
//
// Same relationships, same coefficients (AGRO comes from
// back/data/agronomy.json via agronomy.data.js):
//   ETc     = Kc_season x ET0_season        (FAO-56)
//   Pe      = USDA-SCS effective rainfall
//   deficit = max(0, ETc - Pe)              (simplified seasonal balance)
//
// The deficit is not an irrigation schedule: soil water storage, irrigation
// efficiency, runoff, capillary rise and leaching are not modelled.

import { AGRO } from './agronomy.data.js'

export const CROPS = AGRO.crops

// Reference supplemental-water demand (mm per season) at which the water
// component reaches zero.
export const WATER_DEFICIT_REFERENCE_MM = 600.0
// Evaporative-demand response to warming (~2-4%/degC in FAO-56/IPCC literature).
export const ET0_TEMP_SENSITIVITY_PER_C = 0.03
export const FALLBACK_ET0_MM_DAY = 4.0
// ECe (dS/m) ~= 1.8 x NaCl concentration (g/L).
export const SALINITY_TO_ECE = 1.8

export function cropAgronomy(code) {
  return CROPS[code] ?? null
}

export function kcSeason(code) {
  const crop = cropAgronomy(code)
  if (!crop) return null
  const days = crop.stages_days
  const span = days.ini + days.dev + days.mid + days.late
  if (span <= 0) return null
  const weighted =
    crop.kc_ini * days.ini +
    ((crop.kc_ini + crop.kc_mid) / 2.0) * days.dev +
    crop.kc_mid * days.mid +
    crop.kc_end * days.late
  return roundHalfEven(weighted / span, 4)
}

export function roundHalfEven(value, digits) {
  const factor = 10 ** digits
  const scaled = value * factor
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  let rounded
  if (Math.abs(diff - 0.5) < 1e-9) {
    rounded = floor % 2 === 0 ? floor : floor + 1
  } else {
    rounded = Math.round(scaled)
  }
  return rounded / factor
}

function trapezoid(value, low, high, absLow, absHigh) {
  if (value < absLow || value > absHigh) return 0.0
  if (low <= value && value <= high) return 1.0
  if (value < low) {
    return low > absLow ? (value - absLow) / (low - absLow) : 0.0
  }
  return absHigh > high ? (absHigh - value) / (absHigh - high) : 0.0
}

export function temperatureSuitability(code, meanTempC) {
  const crop = cropAgronomy(code)
  if (!crop || meanTempC === null || meanTempC === undefined) return null
  return roundHalfEven(
    trapezoid(meanTempC, crop.t_opt[0], crop.t_opt[1], crop.t_abs[0], crop.t_abs[1]),
    3,
  )
}

export function phSuitability(code, ph) {
  const crop = cropAgronomy(code)
  if (!crop) return null
  const [low, high] = crop.ph_range
  if (ph >= low && ph <= high) return 1.0
  const distance = ph < low ? low - ph : ph - high
  return roundHalfEven(Math.max(0.0, 1.0 - distance / 1.5), 3)
}

export function salinityYieldFactor(code, eceDsM) {
  const crop = cropAgronomy(code)
  if (!crop) return null
  if (eceDsM <= crop.ec_threshold_ds_m) return 1.0
  const decline = crop.ec_decline_per_ds_m * (eceDsM - crop.ec_threshold_ds_m)
  return roundHalfEven(Math.max(0.0, 1.0 - decline), 3)
}

export function effectiveRainfall(mm) {
  if (mm <= 0.0) return 0.0
  if (mm <= 250.0) return Math.max(0.0, (mm * (125.0 - 0.2 * mm)) / 125.0)
  return 125.0 + 0.1 * mm
}

function windowClimate(nasa, months) {
  if (!nasa) return null
  const series = nasa.series
  if (!series || typeof series !== 'object') return null
  const byYear = {}
  for (const [key, row] of Object.entries(series)) {
    if (!row || typeof row !== 'object' || key.length !== 7 || key[4] !== '-') continue
    const year = key.slice(0, 4)
    const month = Number(key.slice(5, 7))
    if (!Number.isInteger(month)) continue
    byYear[year] = byYear[year] ?? {}
    byYear[year][month] = row
  }

  const et0Totals = []
  const rainTotals = []
  const peTotals = []
  const tempMeans = []
  for (const monthsByIndex of Object.values(byYear)) {
    const complete = months.every(
      month =>
        monthsByIndex[month] &&
        monthsByIndex[month].et0_mm !== null &&
        monthsByIndex[month].et0_mm !== undefined &&
        monthsByIndex[month].rainfall_mm !== null &&
        monthsByIndex[month].rainfall_mm !== undefined,
    )
    if (!complete) continue
    et0Totals.push(months.reduce((sum, m) => sum + monthsByIndex[m].et0_mm, 0))
    rainTotals.push(months.reduce((sum, m) => sum + monthsByIndex[m].rainfall_mm, 0))
    // USDA-SCS is a monthly formula, so apply it month by month.
    peTotals.push(
      months.reduce((sum, m) => sum + effectiveRainfall(monthsByIndex[m].rainfall_mm), 0),
    )
    const temps = months
      .map(m => monthsByIndex[m].temp_mean_c)
      .filter(t => t !== null && t !== undefined)
    if (temps.length > 0) tempMeans.push(temps.reduce((a, b) => a + b, 0) / temps.length)
  }
  if (et0Totals.length === 0) return null
  const years = et0Totals.length
  return {
    years_used: years,
    et0_mm: roundHalfEven(et0Totals.reduce((a, b) => a + b, 0) / years, 1),
    rainfall_mm: roundHalfEven(rainTotals.reduce((a, b) => a + b, 0) / years, 1),
    effective_rain_mm: roundHalfEven(peTotals.reduce((a, b) => a + b, 0) / years, 1),
    temp_mean_c:
      tempMeans.length > 0
        ? roundHalfEven(tempMeans.reduce((a, b) => a + b, 0) / tempMeans.length, 2)
        : null,
  }
}

/** Seasonal ETc, effective rainfall and deficit for one crop. */
export function waterBudget(code, nasa, climate = {}) {
  const crop = cropAgronomy(code)
  if (!crop) {
    return {
      available: false,
      reason: 'No agronomic coefficients for this crop (fallow or unsupported).',
    }
  }
  const months = crop.window_months
  const window = windowClimate(nasa, months)
  if (!window) {
    return {
      available: false,
      reason:
        'NASA POWER monthly ET0/rainfall series are unavailable for this window; ' +
        'water demand falls back to a labelled estimate.',
      window_months: months,
    }
  }
  const tempShift = Number(climate.temp_shift ?? 0.0) || 0.0
  const precipFactor = Number(climate.precipitation ?? 1.0) || 1.0
  const drought = Number(climate.drought ?? 0.0) || 0.0

  const rainFactor = precipFactor * (1.0 - 0.5 * drought)
  const et0Mm = window.et0_mm * (1.0 + ET0_TEMP_SENSITIVITY_PER_C * tempShift)
  const rainMm = window.rainfall_mm * rainFactor
  const kc = kcSeason(code) ?? 1.0
  const etcMm = kc * et0Mm
  const peMm = window.effective_rain_mm * rainFactor
  const deficitMm = Math.max(0.0, etcMm - peMm)

  return {
    available: true,
    source: 'NASA POWER monthly series (T2M, PRECTOTCORR) + FAO-56 ET0',
    window_months: months,
    years_used: window.years_used,
    et0_mm: roundHalfEven(et0Mm, 1),
    kc_season: kc,
    etc_mm: roundHalfEven(etcMm, 1),
    rainfall_mm: roundHalfEven(rainMm, 1),
    effective_rain_mm: roundHalfEven(peMm, 1),
    deficit_mm: roundHalfEven(deficitMm, 1),
    temp_mean_c: window.temp_mean_c,
    temp_window_c:
      window.temp_mean_c !== null ? roundHalfEven(window.temp_mean_c + tempShift, 2) : null,
    scenario_adjustments: {
      temp_shift_c: tempShift,
      precipitation_factor: precipFactor,
      drought_index: drought,
    },
  }
}

/** 0..1 water suitability from the mean seasonal supplemental need. */
export function waterComponent(deficitMmTotal, seasons) {
  if (seasons <= 0) return 0.0
  const perSeason = deficitMmTotal / seasons
  return Math.max(0.0, Math.min(1.0, 1.0 - perSeason / WATER_DEFICIT_REFERENCE_MM))
}
