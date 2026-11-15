/**
 * Browser port of the NEX TERRA rotation engine.
 *
 * Mirrors `back/app/simulator/engine.py` (Crop, SoilProfile, score_rotation,
 * recommend_rotations) and the `/api/recommendations` assembly in
 * `back/app/routes.py`, so the GitHub Pages build can score rotations without
 * a server. The Python service stays the reference implementation: run
 * `node scripts/check-engine.mjs` after changing either side.
 */

import { apiUrl } from './dataSource.js'
import {
  WATER_DEFICIT_REFERENCE_MM,
  SALINITY_TO_ECE,
  phSuitability,
  roundHalfEven,
  salinityYieldFactor,
  temperatureSuitability,
  waterBudget,
  waterComponent,
} from './agronomy.js'

// Re-exported so the results panel can describe the coincidence window and
// coefficients without importing the agronomy module directly.
export { kcSeason, SALINITY_TO_ECE, WATER_DEFICIT_REFERENCE_MM } from './agronomy.js'

export const DEFAULT_PRIORITY_WEIGHTS = {
  water: 0.2,
  nitrogen: 0.15,
  resilience: 0.25,
  soil: 0.2,
  economy: 0.2,
}

export const SCENARIOS = [
  { id: 'historical', label: 'Historical baseline', temp_shift: 0.0, precipitation: 1.0, drought: 0.0 },
  { id: 'mild_warming_wet', label: 'Mild warming + wetter', temp_shift: 1.0, precipitation: 1.05, drought: 0.0 },
  { id: 'severe_drying', label: 'Severe drying', temp_shift: 1.8, precipitation: 0.78, drought: 0.35 },
  { id: 'hot_wet', label: 'Hot + wet', temp_shift: 2.2, precipitation: 1.12, drought: 0.1 },
]

// Rotation compatibility matrix (transition probability 0..1).
const DEFAULT_COMPAT = {
  'cereal>cereal': 0.3,
  'cereal>legume': 0.85,
  'legume>cereal': 0.82,
  'legume>legume': 0.45,
  'cereal>oilseed': 0.6,
  'oilseed>cereal': 0.65,
  'cereal>root': 0.55,
  'root>cereal': 0.5,
  'cereal>tuber': 0.55,
  'tuber>cereal': 0.5,
  'cereal>vegetable': 0.6,
  'vegetable>cereal': 0.55,
  'cereal>cover': 0.7,
  'cover>cereal': 0.65,
  'legume>cover': 0.7,
  'cover>legume': 0.65,
  'cereal>maize': 0.55,
  'maize>cereal': 0.5,
  'cereal>sorghum': 0.7,
  'sorghum>cereal': 0.65,
  'cereal>fallow': 0.6,
  'fallow>cereal': 0.55,
}

const DEFAULT_SOIL = {
  soil_type: 'loam',
  sand_pct: 40.0,
  silt_pct: 40.0,
  clay_pct: 20.0,
  ph: 8.0,
  organic_c_pct: 0.9,
  nacl_ppth: 5.0,
  bulk_density_g_cm3: 1.35,
  active_carbon_mg_kg: 120.0,
  nitrogen_total_mg_kg: 0.9,
}

let cache = null

async function loadJson(name) {
  const res = await fetch(apiUrl(name))
  if (!res.ok) throw new Error(`Could not load ${name} (${res.status})`)
  return res.json()
}

/** Inject data directly (used by scripts/check-engine.mjs). */
export function useEngineData(crops, soil = {}) {
  cache = { byCode: new Map(crops.map(row => [row.code, row])), soil: { ...DEFAULT_SOIL, ...soil } }
  return cache
}

/** Load the crop coefficients and the default soil profile once. */
export async function initEngine() {
  if (!cache) {
    const [crops, soil] = await Promise.all([
      loadJson('crops-engine.json'),
      loadJson('soil.json').catch(() => ({})),
    ])
    useEngineData(crops, soil)
  }
  return cache
}

// ---------------------------------------------------------------- rounding ---
// Python's round() rounds the exact binary value of the double, half-to-even.
// Math.round() rounds half towards +Infinity, which differs on ties (Python
// gives -14.1 for round(-14.05, 1), JavaScript gives -14).
const round = (value, digits = 0) => {
  if (!Number.isFinite(value)) return value
  const negative = value < 0
  const magnitude = Math.abs(value)
  // 40 guard digits are exact for the magnitudes this engine produces.
  const exact = magnitude.toFixed(Math.min(100, digits + 40))
  const [intPart, fracPartRaw = ''] = exact.split('.')
  const fracPart = fracPartRaw.padEnd(digits, '0')
  const keptDigits = intPart + fracPart.slice(0, digits)
  const remainder = fracPart.slice(digits)
  const firstDigit = remainder.length > 0 ? Number(remainder[0]) : 0
  const beyondIsZero = /^0*$/.test(remainder.slice(1))

  let roundUp = false
  if (firstDigit > 5) roundUp = true
  else if (firstDigit === 5) {
    roundUp = !beyondIsZero || Number(keptDigits[keptDigits.length - 1] || '0') % 2 !== 0
  }

  let scaled = Number(keptDigits)
  if (roundUp) scaled += 1
  const result = scaled / 10 ** digits
  if (result === 0) return 0
  return negative ? -result : result
}

const clamp01 = value => Math.max(0.0, Math.min(1.0, value))

// ------------------------------------------------------------ soil profile ---
export class SoilProfile {
  constructor(payload = {}) {
    const p = { ...DEFAULT_SOIL, ...payload }
    this.soil_type = p.soil_type
    this.sand_pct = p.sand_pct
    this.silt_pct = p.silt_pct
    this.clay_pct = p.clay_pct
    this.ph = p.ph
    this.organic_c_pct = p.organic_c_pct
    this.nacl_ppth = p.nacl_ppth
    this.bulk_density_g_cm3 = p.bulk_density_g_cm3
    this.active_carbon_mg_kg = p.active_carbon_mg_kg
    this.nitrogen_total_mg_kg = p.nitrogen_total_mg_kg
  }

  get texture() {
    if (this.clay_pct >= 37.5 && this.sand_pct <= 45) return 'clay'
    if (this.sand_pct >= 70) return 'sand'
    if (this.clay_pct <= 20) return this.sand_pct >= 50 ? 'loamy_sand' : 'silt_loam'
    return 'loam'
  }

  get erodibility() {
    return this.silt_pct * 0.5 + (100.0 - this.clay_pct) * 0.2 + this.sand_pct * 0.1
  }

  get waterHoldingCapacity() {
    if (this.texture === 'sand') return 80.0
    if (this.texture === 'loam') return 150.0
    if (this.texture === 'clay') return 170.0
    return 140.0
  }

  get salinityRisk() {
    return this.nacl_ppth / 40.0
  }
}

// --------------------------------------------------------------------- crop ---
export class Crop {
  constructor(row) {
    this.code = row.code
    this.name = row.name ?? row.code
    this.family = row.family ?? 'cereal'
    this.water_hunger = row.water_hunger ?? 0.55
    this.nutrient_strategy = row.nutrient_strategy ?? 'mineral'
    this.stress_sensitivity = row.stress_sensitivity ?? 0.35
    this.base_et_mm = row.base_et_mm ?? 420.0
    this.soil_pref = row.soil_pref ?? 0.0
    this.econ_rev_mad = row.econ_rev_mad ?? 18500.0
    this.econ_gwp_m3kg = row.econ_gwp_m3kg ?? 1350.0
  }

  waterReqMm(scenario = 0.0, drought = 0.0) {
    let base = this.base_et_mm * (1.0 + 0.4 * scenario)
    base *= 1.0 + 0.25 * drought
    return base * this.water_hunger
  }

  nitrogenBalance(soil, prevCropCode = null, legumeFix = false) {
    const soilN = soil.nitrogen_total_mg_kg * 10.0
    let fix = 0.0
    if (legumeFix && this.family === 'legume') fix = 80.0
    else if (legumeFix) fix = 30.0
    const uptake = 40.0 * this.water_hunger
    const biomass = this.nutrient_strategy === 'biomass' ? 50.0 : 0.0
    return round(biomass + fix - uptake + this.soil_pref * 15 - soilN * 0.05, 1)
  }

  soilProtection(prevCrop, prevCropIsCover, soil) {
    const coverBonus = prevCropIsCover || this.family === 'cover' ? 0.35 : 0.0
    const legumeBonus = this.family === 'legume' ? 0.15 : 0.0
    const erosion = soil.erodibility / 200.0
    const residue = 0.5 + 0.3 * (this.family === 'cereal' ? 1 : 0)
    let score = 0.55 * residue - 0.15 * erosion + coverBonus + legumeBonus
    if (soil.nacl_ppth > 20) score -= 0.1
    if (soil.ph > 8.5 || soil.ph < 6.0) score -= 0.1
    return round(clamp01(score), 3)
  }

  climateResilience(tempShift, precipDelta, drought, evi = null, sm = null) {
    const thermal = 1.0 - 0.04 * Math.abs(tempShift)
    const water = precipDelta * (1.0 - 0.2 * this.stress_sensitivity)
    const vegSound = evi === null || evi === undefined ? 0.7 : evi
    const soilWet = sm === null || sm === undefined ? 0.4 : sm
    const droughtPenalty =
      (1.0 - 0.35 * drought) * (0.7 + 0.3 * vegSound) * (0.8 + 0.2 * soilWet)
    return round(clamp01(thermal * water * droughtPenalty), 3)
  }

  economicPotential() {
    return round(Math.min(1.0, this.econ_rev_mad / 40000.0), 3)
  }
}

// ------------------------------------------------------------------ rotator ---
export function crop(code) {
  if (!cache) return null
  const row = cache.byCode.get(code)
  return row ? new Crop(row) : null
}

export function compat(prev, cur) {
  if (!prev || !cur) return 0.55
  const direct = DEFAULT_COMPAT[`${prev}>${cur}`]
  if (direct !== undefined) return direct
  const reverse = DEFAULT_COMPAT[`${cur}>${prev}`]
  if (reverse !== undefined) return reverse * 0.8
  return 0.45
}

export function legumeFixBenefit(code) {
  const c = code ? crop(code) : null
  if (c && c.family === 'legume') return 1.0
  if (c && c.family === 'cover') return 0.4
  return 0.0
}

export function normalizePriorities(weights = DEFAULT_PRIORITY_WEIGHTS) {
  const unknown = Object.keys(weights).filter(key => !(key in DEFAULT_PRIORITY_WEIGHTS))
  if (unknown.length > 0) {
    throw new Error(`Unknown priority keys: ${unknown.sort().join(', ')}`)
  }
  const normalized = {}
  for (const key of Object.keys(DEFAULT_PRIORITY_WEIGHTS)) {
    const value = Number(weights[key] ?? 0)
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Priority weights must be finite and non-negative')
    }
    normalized[key] = value
  }
  const total = Object.values(normalized).reduce((a, b) => a + b, 0)
  if (total <= 0) throw new Error('At least one priority weight must be greater than zero')
  for (const key of Object.keys(normalized)) normalized[key] /= total
  return normalized
}

/** Score one rotation against one climate state (mirrors score_rotation). */
export function scoreRotation(cropsCodes, soil, climate, nasa = null, priorityWeights = null) {
  if (!cropsCodes || cropsCodes.length === 0) {
    throw new Error('A rotation must contain at least one crop')
  }
  const unknown = cropsCodes.filter(code => crop(code) === null)
  if (unknown.length > 0) {
    throw new Error(`Unknown crop code(s): ${unknown.join(', ')}`)
  }
  const profile = soil instanceof SoilProfile ? soil : new SoilProfile(soil ?? {})

  const n = cropsCodes.length
  const seasons = []
  let totalWater = 0.0
  let totalDeficit = 0.0
  let totalN = 0.0
  let totalResilience = 0.0
  let totalSoil = 0.0
  let totalEcon = 0.0
  let totalPh = 0.0
  const budgetRows = []
  const waterSources = new Set()

  const observedTemp = nasa ? nullableNumber(nasa.temp_mean_c) : null
  const observedRain = nasa ? nullableNumber(nasa.rainfall_mm_tot) : null
  const observedHumidity = nasa ? nullableNumber(nasa.humidity_pct) : null
  const observedSolar = nasa ? nullableNumber(nasa.solar_radiation_mj_m2_day) : null
  const observedWind = nasa ? nullableNumber(nasa.wind_mean_ms) : null
  const et0MeanMmDay = nasa ? nullableNumber(nasa.et0_mean_mm_day) : null
  const evi = nasa ? (nasa.evi ?? 0.42) : 0.42
  const sm = nasa ? (nasa.sm ?? 0.30) : 0.30
  const cmip6TempShift = nasa ? (nasa.cmip6_temp_delta_c ?? 0.0) : 0.0
  const eceDsM = roundHalfEven(SALINITY_TO_ECE * profile.nacl_ppth, 2)
  const tempShift = climate.temp_shift ?? 0.0

  cropsCodes.forEach((code, i) => {
    const prev = i > 0 ? cropsCodes[i - 1] : null
    const cur = crop(code)
    const legumeFix = legumeFixBenefit(prev) > 0.0

    // --- water: ETc = Kc x ET0 over the crop window, deficit vs rainfall ---
    const budget = waterBudget(code, nasa, climate)
    let etcMm
    let deficitMm
    let waterSource
    let tempWindowC
    if (budget.available) {
      etcMm = budget.etc_mm
      deficitMm = budget.deficit_mm
      waterSource = 'nasa_power'
      tempWindowC = budget.temp_window_c
    } else {
      etcMm = round(cur.waterReqMm(tempShift, climate.drought ?? 0.0), 1)
      deficitMm = etcMm
      waterSource = 'prototype_estimate'
      tempWindowC = observedTemp !== null ? roundHalfEven(observedTemp + tempShift, 0) : null
    }
    waterSources.add(waterSource)

    const tempSuit = temperatureSuitability(code, tempWindowC)
    const phSuit = phSuitability(code, profile.ph)
    const saltYield = salinityYieldFactor(code, eceDsM)
    const resScenario = cur.climateResilience(
      tempShift,
      climate.precipitation ?? 1.0,
      climate.drought ?? 0.0,
      evi,
      sm,
    )
    // Resilience = scenario exposure x thermal suitability x how much of the
    // crop's water demand the rainfall covers (see the Python engine comment).
    const deficitShare = etcMm > 0 ? Math.min(1.0, deficitMm / etcMm) : 1.0
    const res = round(
      clamp01(resScenario * (tempSuit ?? 1.0) * (1.0 - 0.5 * deficitShare)),
      3,
    )
    const prevCover = i > 0 && crop(cropsCodes[i - 1]).family === 'cover'
    const soilProt = cur.soilProtection(prev, prevCover, profile)
    const soilScored = round(soilProt * (phSuit ?? 1.0), 3)
    const nb = cur.nitrogenBalance(profile, prev, legumeFix)
    seasons.push({
      index: i + 1,
      crop: code,
      water_mm: round(etcMm, 1),
      etc_mm: round(etcMm, 1),
      deficit_mm: round(deficitMm, 1),
      effective_rain_mm: budget.effective_rain_mm ?? null,
      kc_season: budget.kc_season ?? null,
      water_source: waterSource,
      temp_window_c: tempWindowC,
      climate_suitability: tempSuit,
      deficit_share: roundHalfEven(deficitShare, 3),
      ph_suitability: phSuit,
      salinity_yield_factor: saltYield,
      n_balance_kg: nb,
      resilience: res,
      soil_protection: soilScored,
      econom_inc: round(etcMm * 0.4 + cur.econ_rev_mad * 0.01, 1),
      nasa_temp_c: observedTemp !== null ? roundHalfEven(observedTemp, 2) : null,
      nasa_rain_mm: observedRain !== null ? roundHalfEven(observedRain, 1) : null,
      nasa_evi: round(evi, 3),
      nasa_sm: round(sm, 3),
    })
    budgetRows.push({ crop: code, ...budget })
    totalWater += etcMm
    totalDeficit += deficitMm
    totalN += nb
    totalResilience += res
    totalSoil += soilScored
    totalEcon += cur.econ_rev_mad
    totalPh += phSuit ?? 0.0
  })

  const avg = value => (n ? round(value / n, 3) : 0.0)
  // Gross revenue per cubic metre of crop water demand (1 mm over 1 ha = 10 m3).
  const econPerWater = totalWater > 0 ? round(totalEcon / (totalWater * 10.0), 1) : 0.0
  const weights = normalizePriorities(priorityWeights ?? DEFAULT_PRIORITY_WEIGHTS)

  // Rotation compatibility between consecutive botanical families.
  const familyPairs = []
  for (let i = 1; i < n; i += 1) {
    familyPairs.push(
      compat(crop(cropsCodes[i - 1]).family, crop(cropsCodes[i]).family),
    )
  }
  const compatAvg = familyPairs.length
    ? round(familyPairs.reduce((a, b) => a + b, 0) / familyPairs.length, 3)
    : 0.55
  const rotationFactor = roundHalfEven(0.85 + 0.15 * compatAvg, 4)

  const waterPenalty = Math.min(1.0, (totalDeficit / n) / WATER_DEFICIT_REFERENCE_MM)
  const components = {
    water: clamp01(waterComponent(totalDeficit, n)),
    nitrogen: clamp01(0.5 + 0.5 * (totalN / n / 100.0)),
    resilience: clamp01(totalResilience / n),
    soil: clamp01(totalSoil / n),
    economy: clamp01(totalEcon / n / 25000.0),
  }
  const weightedScore = Object.keys(weights).reduce(
    (sum, key) => sum + weights[key] * components[key],
    0,
  )
  const score = weightedScore * rotationFactor

  const drivers = Object.keys(weights)
    .map(key => [weights[key] * components[key], key])
    .sort((a, b) => (b[0] === a[0] ? (a[1] < b[1] ? -1 : 1) : b[0] - a[0]))
  const topDrivers = drivers.slice(0, 3).map(([contribution, key]) => ({
    component: key,
    weight: round(weights[key], 4),
    value: round(components[key], 3),
    contribution: round(contribution, 4),
  }))

  return {
    rotations: n,
    rotation: cropsCodes,
    water_total_mm: round(totalWater, 1),
    water_avg_mm: round(avg(totalWater), 1),
    n_balance_kg: round(totalN, 1),
    n_balance_per_season_kg: round(avg(totalN), 1),
    resilience_avg: round(totalResilience / n, 3),
    soil_protection_avg: round(totalSoil / n, 3),
    economic_potential_avg: round(totalEcon / n, 1),
    econ_per_water_mad_m3: econPerWater,
    score: round(score, 4),
    weighted_score_before_rotation: round(weightedScore, 4),
    rotation_compatibility: {
      compat_avg: compatAvg,
      factor: rotationFactor,
      note:
        'Family-transition compatibility multiplies the weighted score by ' +
        '0.85-1.00 so that agronomically poor sequences cannot win on climate ' +
        'or economics alone.',
    },
    priority_weights: Object.fromEntries(
      Object.entries(weights).map(([key, value]) => [key, round(value, 4)]),
    ),
    components: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [key, round(value, 3)]),
    ),
    drivers: topDrivers,
    water_budget: {
      water_source:
        waterSources.size === 1 && waterSources.has('nasa_power')
          ? 'nasa_power'
          : [...waterSources].sort()[0] ?? 'none',
      etc_total_mm: round(totalWater, 1),
      etc_avg_mm: round(avg(totalWater), 1),
      deficit_total_mm: round(totalDeficit, 1),
      deficit_avg_mm: round(avg(totalDeficit), 1),
      reference_deficit_mm: WATER_DEFICIT_REFERENCE_MM,
      method:
        'ETc = Kc_season x ET0_season over each crop window; ' +
        'deficit = max(0, ETc - USDA-SCS effective rainfall)',
      per_season: budgetRows,
    },
    soil_suitability: {
      ph: profile.ph,
      ph_component: n ? round(totalPh / n, 3) : null,
      ece_ds_m: eceDsM,
      ece_note:
        'ECe estimated as 1.8 x the field NaCl value; that NaCl value is a ' +
        'prototype default, so salinity yield factors are informational only ' +
        'and excluded from the score.',
    },
    limitations: [
      'Resilience and water partly overlap: a crop whose demand is unmet by ' +
        'rainfall loses both water and resilience points',
      'ETc = Kc x ET0 with tabulated FAO-56 coefficients, not locally calibrated',
      'Deficit = max(0, ETc - effective rainfall) ignores soil water storage, ' +
        'irrigation efficiency and leaching',
      'Optimal temperature and pH bands are broad literature ranges, not ' +
        'cultivar-specific responses',
      'Soil salinity is a prototype default (SoilGrids has no salinity product), ' +
        'so salinity stress is reported but not scored',
      'Pest, disease, labour, machinery and market constraints are not modelled',
    ],
    nasa: buildNasaBlock(
      nasa, observedTemp, observedRain, evi, sm, cmip6TempShift,
      { humidity: observedHumidity, solar: observedSolar, wind: observedWind, et0: et0MeanMmDay },
    ),
    seasons,
    water_cap_factor: waterPenalty,
  }
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildNasaBlock(nasa, observedTemp, observedRain, evi, sm, cmip6TempShift, extra = {}) {
  const roundOrNull = (value, digits) =>
    value === null || value === undefined ? null : roundHalfEven(value, digits)
  return {
    temp_mean_c: roundOrNull(observedTemp, 2),
    rainfall_mm_tot: roundOrNull(observedRain, 1),
    humidity_pct: roundOrNull(extra.humidity, 1),
    solar_radiation_mj_m2_day: roundOrNull(extra.solar, 2),
    wind_mean_ms: roundOrNull(extra.wind, 2),
    et0_mean_mm_day: roundOrNull(extra.et0, 2),
    evi: round(evi, 3),
    sm: round(sm, 3),
    cmip6_temp_delta_c: round(cmip6TempShift, 2),
    _synthetic: nasa ? Boolean(nasa._synthetic ?? true) : true,
    data_status: nasa ? (nasa.data_status ?? 'synthetic') : 'synthetic',
    source_status: nasa ? (nasa.source_status ?? {}) : {},
    lat: nasa ? (nasa.lat ?? null) : null,
    lon: nasa ? (nasa.lon ?? null) : null,
    observed_window_years: nasa ? (nasa.observed_window_years ?? null) : null,
    coverage: nasa ? (nasa.coverage ?? {}) : {},
    source_datasets: nasa ? (nasa.source_datasets ?? []) : [],
    source_note: nasa
      ? (nasa.source_note ?? 'NASA data provenance unavailable; treated as synthetic.')
      : 'Engine defaults are synthetic demonstration values.',
  }
}

// ------------------------------------------------------------------- ranking ---
export function rank(comparisons) {
  const grouped = new Map()
  for (const item of comparisons) {
    if (!grouped.has(item.strategy_id)) grouped.set(item.strategy_id, [])
    grouped.get(item.strategy_id).push(item)
  }
  const ranked = []
  for (const [strategyId, rows] of grouped) {
    const scores = rows.map(item => item.score)
    ranked.push({
      id: strategyId,
      label: rows[0].strategy_label,
      rotation: rows[0].rotation,
      average_score: round(scores.reduce((a, b) => a + b, 0) / scores.length, 4),
      worst_case_score: round(Math.min(...scores), 4),
      water_mm: round(
        rows.reduce((sum, item) => sum + item.water_total_mm, 0) / rows.length,
        1,
      ),
    })
  }
  ranked.sort((a, b) => b.average_score - a.average_score)
  ranked.forEach((item, index) => {
    item.rank = index + 1
    item.score = item.average_score
  })
  return ranked
}

// ------------------------------------------------- recommend_rotations port ---
function compareRotations(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === right) continue
    if (right === undefined) return 1
    if (left === undefined) return -1
    return left < right ? -1 : 1
  }
  return 0
}

/**
 * Return diverse, score-ranked candidates from catalog crops that the
 * simulator supports (mirrors Rotator.recommend_rotations).
 */
export function recommendRotations(catalog, soil, climate, priorities, nasa, currentRotation, count = 3) {
  const profile = soil instanceof SoilProfile ? soil : new SoilProfile(soil ?? {})
  const pool = catalog.crops
    .filter(item => item.rotation_eligible && crop(item.code) !== null)
    .map(item => item.code)
  const familyByCode = Object.fromEntries(
    pool.map(code => [code, crop(code).family]),
  )

  const candidates = []
  for (const first of pool) {
    for (const second of pool) {
      for (const third of pool) {
        const rotation = [first, second, third]
        const families = new Set(rotation.map(code => familyByCode[code]))
        if (families.size !== 3) continue
        if (currentRotation && currentRotation.length > 0) {
          const currentSet = new Set(currentRotation)
          if (rotation.every(code => currentSet.has(code)) &&
              [...currentSet].every(code => rotation.includes(code))) {
            continue
          }
        }
        candidates.push(scoreRotation(rotation, profile, climate, nasa, priorities))
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return compareRotations(a.rotation, b.rotation)
  })

  const selected = []
  const selectedRotations = new Set()
  for (const maximumSharedCrops of [1, 2, 3]) {
    for (const candidate of candidates) {
      const key = candidate.rotation.join('>')
      if (selectedRotations.has(key)) continue
      const sharedTooMany = selected.some(previous => {
        const overlap = new Set(
          candidate.rotation.filter(code => previous.rotation.includes(code)),
        )
        return overlap.size > maximumSharedCrops
      })
      if (sharedTooMany) continue
      selected.push(candidate)
      selectedRotations.add(key)
      if (selected.length === count) return selected
    }
  }
  return selected
}

// ------------------------------------------------------ /api/recommendations ---
function strategyEvidence(rotation, field, catalogByCode) {
  const cropEvidence = rotation.map(code => {
    const item = catalogByCode.get(code)
    return {
      code,
      name: item.name,
      life_cycle: item.life_cycle,
      national_status: item.national_status,
      source_ids: item.source_ids,
      documented_regions: item.documented_regions,
      evidence_note: item.evidence_note,
    }
  })
  const unverified = [...new Set(
    cropEvidence
      .filter(item => item.national_status !== 'documented')
      .map(item => item.name),
  )].sort()
  const regionUnverified = [...new Set(
    cropEvidence
      .filter(item => !item.documented_regions.includes(field.region_code))
      .map(item => item.name),
  )].sort()

  const dataGaps = []
  if (unverified.length > 0) {
    dataGaps.push(
      `National crop-presence evidence is unverified or group-level for: ${unverified.join(', ')}.`,
    )
  }
  if (regionUnverified.length > 0) {
    dataGaps.push(
      `The cited sources do not document these crops in the selected administrative region: ${regionUnverified.join(', ')}. This is a data gap, not evidence of absence.`,
    )
  }
  return { crop_evidence: cropEvidence, data_gaps: dataGaps }
}

/** Build the full `/api/recommendations` response in the browser. */
export async function buildRecommendations(payload, nasa, catalog) {
  await initEngine()
  const field = payload.field
  if (!field) throw new Error('Select a Moroccan field location first')

  const scenarios = SCENARIOS
  const scenario = scenarios.find(item => item.id === payload.scenario_id)
  if (!scenario) throw new Error(`Unknown climate scenario: ${payload.scenario_id}`)

  const priorities = payload.priorities ?? DEFAULT_PRIORITY_WEIGHTS
  const soil = new SoilProfile(field.soil ?? {})
  const currentRotation = payload.current_rotation ?? []
  const catalogByCode = new Map(catalog.crops.map(item => [item.code, item]))

  const recommendations = recommendRotations(
    catalog, soil, scenario, priorities, nasa, currentRotation, 3,
  )
  if (recommendations.length < 3) {
    throw new Error('Not enough supported crop combinations to generate three diverse options')
  }

  const strategies = []
  if (currentRotation.length > 0) {
    strategies.push({
      id: 'current',
      label: 'Your current rotation (baseline)',
      rotation: currentRotation.slice(),
      rationale:
        'Entered by the farmer and included as a reference for comparing the generated options.',
      limitations: [
        'The current rotation and its outcomes are not independently validated.',
      ],
    })
  }

  recommendations.forEach((result, index0) => {
    const index = index0 + 1
    const label = index === 1
      ? 'Suggested option 1 — closest match to your priorities'
      : `Suggested option ${index} — alternative crop mix`
    const rationale = index === 1
      ? 'Highest prototype score for the selected climate scenario and priorities among supported sequences with three different simulator crop families.'
      : 'A high-scoring, diverse alternative selected so you can compare a different mix of crops.'
    strategies.push({
      id: `suggested_${index}`,
      label,
      rotation: result.rotation.slice(),
      rationale,
      limitations: [
        'Crop-family diversity is a prototype search rule, not proof of local suitability.',
        'Sequence positions are not a region-specific planting calendar.',
        'Pest, disease, labor, and market constraints are not modeled.',
      ],
    })
  })

  for (const strategy of strategies) {
    Object.assign(strategy, strategyEvidence(strategy.rotation, field, catalogByCode))
  }

  // Attach the water budget and score decomposition for the selected scenario.
  for (const strategy of strategies) {
    const scored = scoreRotation(strategy.rotation, soil, scenario, nasa, priorities)
    strategy.components = scored.components
    strategy.drivers = scored.drivers
    strategy.water_budget = scored.water_budget
    strategy.rotation_compatibility = scored.rotation_compatibility
    strategy.limitations = [...(strategy.limitations ?? []), ...scored.limitations]
    strategy.score = scored.score
    strategy.scenario_id = scenario.id
  }

  const comparisons = []
  for (const climateScenario of scenarios) {
    for (const strategy of strategies) {
      const result = scoreRotation(strategy.rotation, soil, climateScenario, nasa, priorities)
      comparisons.push({
        strategy_id: strategy.id,
        strategy_label: strategy.label,
        scenario_id: climateScenario.id,
        label: climateScenario.label,
        temp_shift: climateScenario.temp_shift,
        precipitation: climateScenario.precipitation,
        drought: climateScenario.drought,
        rotation: result.rotation.slice(),
        water_total_mm: result.water_total_mm,
        deficit_total_mm: result.water_budget.deficit_total_mm,
        effective_rain_total_mm: roundHalfEven(
          result.water_budget.per_season.reduce(
            (sum, row) => sum + (row.effective_rain_mm || 0), 0,
          ), 1,
        ),
        n_balance_kg: result.n_balance_kg,
        resilience_avg: result.resilience_avg,
        soil_protection_avg: result.soil_protection_avg,
        economic_potential_avg: result.economic_potential_avg,
        econ_per_water_mad_m3: result.econ_per_water_mad_m3,
        score: result.score,
        priority_weights: result.priority_weights,
      })
    }
  }

  const scenarioIds = scenarios.map(item => item.id)
  const scenarioWinners = []
  for (const scenarioId of scenarioIds) {
    const rows = comparisons.filter(item => item.scenario_id === scenarioId)
    if (rows.length > 0) {
      const winner = rows.reduce((best, item) => (item.score > best.score ? item : best))
      scenarioWinners.push({
        scenario_id: scenarioId,
        strategy_id: winner.strategy_id,
        strategy_label: winner.strategy_label,
        score: winner.score,
      })
    }
  }

  return {
    rotations: currentRotation,
    strategies,
    rotation_names: Object.fromEntries(strategies.map(item => [item.id, item.label])),
    comparison: comparisons,
    ranked: rank(comparisons),
    scenario_winners: scenarioWinners,
    scenario_ids: scenarioIds,
    scenarios,
    comparison_context: {
      score_status: 'illustrative prototype heuristic',
      field_soil_status: field.soil
        ? 'user-provided soil information; unspecified properties use prototype defaults'
        : 'prototype defaults; not measured',
      nasa_data_status: nasa?.data_status ?? 'synthetic',
      score_explanation:
        'Options are generated by searching supported three-crop sequences with different simulator crop families, then ranking them for the selected scenario and priorities. They are exploratory candidates, not validated recommendations.',
      score_inputs: [
        'NASA POWER monthly reference ET0 (FAO-56 Penman-Monteith from T2M_MIN/MAX, RH2M, WS2M, ALLSKY_SFC_SW_DWN, PS) and PRECTOTCORR rainfall over each crop growing window.',
        'FAO-56 single crop coefficients (Kc ini/mid/end) and stage lengths, giving ETc = Kc_season x ET0_season.',
        'Water deficit = max(0, ETc - USDA-SCS effective rainfall) per season; this drives the water component.',
        'Crop-window mean NASA POWER temperature against FAO EcoCrop optimal bands; this drives the thermal part of resilience.',
        'User-supplied soil measurements where present; otherwise prototype default soil values (pH affects soil suitability).',
        'The selected illustrative climate scenario and normalized priority weights.',
        'Botanical-family transition compatibility, applied as a 0.85-1.00 multiplier on the weighted score.',
        'Synthetic vegetation (EVI) and soil-moisture placeholders, labelled as synthetic in the data provenance block.',
      ],
      nasa_role:
        'NASA POWER is a decision input, not decoration: monthly ET0 and rainfall set each crop seasonal water deficit (the water component), and the crop-window mean temperature sets thermal suitability inside the resilience component. Uncertainties are that Kc is tabulated rather than locally calibrated, ET0 is gridded, and the deficit ignores soil water storage.',
      data_gaps: [
        'No verified crop calendar is available for the selected administrative region; growing windows are typical sowing-to-harvest months, not field-observed phenology.',
        'The water balance excludes soil water storage, irrigation efficiency, runoff, capillary rise and leaching, so the deficit is not an irrigation schedule.',
        'Soil salinity is a prototype default (SoilGrids publishes no salinity product); salinity yield factors are reported for information and excluded from the score.',
        "Crop presence may be unverified in the selected region; see each option's evidence and data gaps.",
        'Pest and disease cycles are not modeled.',
        'The economic component uses prototype revenue assumptions; market prices, input costs, and net margins are not modeled.',
        'The scores have not been calibrated against farm outcomes.',
      ],
    },
    nasa,
    field: {
      region_code: field.region_code,
      lat: field.lat,
      lon: field.lon,
      area_ha: field.area_ha,
      irrigation: field.irrigation ?? 'unknown',
      soil: field.soil ?? null,
    },
    scenario_id: payload.scenario_id,
  }
}
