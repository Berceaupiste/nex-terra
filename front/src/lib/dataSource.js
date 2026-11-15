/**
 * Static data access for the GitHub Pages build.
 *
 * `front/public/api/*.json` is generated from the FastAPI service, so the
 * published demo reads the same payloads the backend would return.
 */

/** Resolve a file inside `public/api/` against the configured Vite base URL. */
export function apiUrl(name) {
  const base = import.meta.env.BASE_URL || './'
  return `${base === './' ? '' : base}api/${name}`
}
