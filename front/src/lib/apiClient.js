/**
 * API client with a static fallback.
 *
 * In development the Vite server proxies `/api` to the FastAPI backend. The
 * published GitHub Pages build sets `VITE_STATIC=1`, so every request is
 * answered from the baked `public/api/*.json` payloads plus the browser engine.
 * With `VITE_API_BASE_URL` pointing at a deployed backend, the real service is
 * used instead.
 */

import { apiUrl } from './dataSource.js'
import { buildRecommendations } from './engine.js'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') || ''
export const STATIC_MODE = import.meta.env.VITE_STATIC === '1'
  || (API_BASE_URL === '' && import.meta.env.PROD)

const jsonCache = new Map()

async function loadJson(name) {
  if (!jsonCache.has(name)) {
    jsonCache.set(name, fetch(apiUrl(name)).then(res => {
      if (!res.ok) throw new Error(`Could not load ${name} (${res.status})`)
      return res.json()
    }))
  }
  return jsonCache.get(name)
}

// ------------------------------------------------------------- geolocation ---
// Port of `_ring_contains` / `region_codes_for_point` from back/app/regions.py.
const TOLERANCE = 1e-10

function pointOnSegment(lon, lat, start, end) {
  const [x1, y1] = start
  const [x2, y2] = end
  const cross = (lon - x1) * (y2 - y1) - (lat - y1) * (x2 - x1)
  if (Math.abs(cross) > TOLERANCE) return false
  return (
    Math.min(x1, x2) - TOLERANCE <= lon && lon <= Math.max(x1, x2) + TOLERANCE &&
    Math.min(y1, y2) - TOLERANCE <= lat && lat <= Math.max(y1, y2) + TOLERANCE
  )
}

function pointOnRing(lon, lat, ring) {
  for (let i = 0; i < ring.length - 1; i += 1) {
    if (pointOnSegment(lon, lat, ring[i], ring[i + 1])) return true
  }
  return false
}

function ringContains(lon, lat, ring) {
  let inside = false
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    if (pointOnSegment(lon, lat, ring[i], ring[i + 1])) return true
    if ((y1 > lat) !== (y2 > lat)) {
      const crossingLon = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)
      if (lon < crossingLon) inside = !inside
    }
  }
  return inside
}

function polygonContains(lon, lat, rings) {
  if (!rings || rings.length === 0 || !ringContains(lon, lat, rings[0])) return false
  for (const hole of rings.slice(1)) {
    if (pointOnRing(lon, lat, hole)) return true
    if (ringContains(lon, lat, hole)) return false
  }
  return true
}

function regionCodesForPoint(boundaries, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
  const matches = new Set()
  for (const feature of boundaries.features) {
    const geometry = feature.geometry
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    if (polygons.some(polygon => polygonContains(lon, lat, polygon))) {
      matches.add(feature.properties.region_code)
    }
  }
  return [...matches]
}

/** Nearest region centroid, used to select the baked NASA POWER payload. */
function nearestRegion(centroids, lat, lon) {
  let best = null
  for (const [code, point] of Object.entries(centroids)) {
    const distance = (point.lat - lat) ** 2 + (point.lon - lon) ** 2
    if (!best || distance < best.distance) best = { code, distance }
  }
  return best
}

async function nasaFor(lat, lon) {
  const data = await loadJson('nasa.json')
  const nearest = nearestRegion(data.centroids, lat, lon)
  const payload = data.by_region[nearest.code]
  if (!payload) throw new Error('NASA POWER context is unavailable for this region')
  return {
    ...payload,
    lat,
    lon,
    region_code: nearest.code,
    source_note: `${payload.source_note || ''} Published demo build: these are the NASA POWER composite values for the ${nearest.code} region centroid.`.trim(),
  }
}

/** Nominatim reverse geocoding, called directly (CORS-enabled) in static mode. */
async function reverseGeocode(lat, lon) {
  if (lat < 20 || lat > 37 || lon < -18 || lon > 0) return { place_name: null }
  try {
    const params = new URLSearchParams({
      lat: String(lat), lon: String(lon), format: 'jsonv2', addressdetails: '1', zoom: '14',
    })
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { place_name: null }
    const data = await res.json()
    const address = data.address || {}
    const placeName = data.name
      || address.village || address.town || address.city || address.hamlet || null
    const context = address.province || address.state || address.county || null
    return {
      place_name: placeName,
      context: [context, address.country].filter(Boolean).join(', ') || null,
      attribution_url: 'https://www.openstreetmap.org/copyright',
    }
  } catch (_) {
    return { place_name: null }
  }
}

// -------------------------------------------------------------- static mode ---
async function staticRequest(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase()
  const [rawPath, queryString = ''] = path.split('?')
  const query = new URLSearchParams(queryString)
  const route = rawPath.replace(/^\/api/, '')

  if (method === 'GET') {
    switch (route) {
      case '/regions':
        return loadJson('regions.json')
      case '/regions/boundaries':
        return loadJson('boundaries.json')
      case '/regions/locate': {
        const lat = Number(query.get('lat'))
        const lon = Number(query.get('lon'))
        const [boundaries, regions] = await Promise.all([
          loadJson('boundaries.json'),
          loadJson('regions.json'),
        ])
        const codes = regionCodesForPoint(boundaries, lat, lon)
        if (codes.length === 0) {
          throw new Error('Coordinates do not fall within a mapped Moroccan administrative region')
        }
        const order = regions.regions.map(region => region.code)
        const sorted = codes.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b))
        return {
          region_codes: sorted,
          regions: regions.regions.filter(region => sorted.includes(region.code)),
          boundary_source: regions.boundary_source,
        }
      }
      case '/places/reverse':
        return reverseGeocode(Number(query.get('lat')), Number(query.get('lon')))
      case '/crops':
        return loadJson('crops.json')
      case '/demo/seed.json':
        return loadJson('demo-seed.json')
      case '/field':
        return loadJson('field.json')
      case '/soil':
        return loadJson('soil.json')
      case '/scenarios':
        return { scenarios: (await loadJson('demo-seed.json')).scenarios }
      case '/nasa':
        return nasaFor(Number(query.get('lat')), Number(query.get('lon')))
      default:
        throw new Error(`No static data for ${path}`)
    }
  }

  if (method === 'POST' && route === '/recommendations') {
    const payload = JSON.parse(opts.body || '{}')
    const [nasa, catalog] = await Promise.all([
      nasaFor(payload.field?.lat, payload.field?.lon),
      loadJson('crops.json'),
    ])
    return buildRecommendations(payload, nasa, catalog)
  }

  throw new Error(`The published demo supports read-only simulation requests (${method} ${route})`)
}

// ------------------------------------------------------------------ client ---
export async function apiRequest(path, opts = {}) {
  if (STATIC_MODE) return staticRequest(path, opts)

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, opts)
    if (!res.ok) {
      let message = `Request failed: ${res.status}`
      try {
        message = (await res.json()).detail || message
      } catch (_) {
        /* keep the status message */
      }
      throw new Error(message)
    }
    return res.json()
  } catch (error) {
    // Without a reachable backend (e.g. `npm run preview`), fall back to the
    // baked payloads so the interface still works.
    try {
      return await staticRequest(path, opts)
    } catch (_) {
      throw error
    }
  }
}
