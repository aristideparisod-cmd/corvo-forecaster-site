/* API client. One place that knows endpoint shapes -- and the one place that
 * knows there are two ways to serve them.
 *
 * LIVE      talks to the FastAPI server at /v1/...
 * STATIC    reads a snapshot of those same responses as files, for a public
 *           site. The API is read-only and the data changes once a day, so a
 *           server buys nothing: ~2 MB of JSON a day serves the whole thing.
 *
 * The only shape a static host cannot serve is a query string -- `a.json?x=1`
 * just returns `a.json`. So in static mode a path carrying a query is rewritten
 * deterministically into a file path:
 *
 *   /v1/sites/corvo/daily?from=A&to=B  ->  api/v1/sites/corvo/daily/from=A,to=B.json
 *   /v1/sites/corvo/daily              ->  api/v1/sites/corvo/daily.json
 *
 * publish/export_static.py writes exactly those paths. Switched on by the
 * exporter injecting `window.API_BASE = 'api'` before this file loads;
 * absent, the client is live and nothing changes.
 */
window.API = (function () {
  const SITE = 'corvo';
  const BASE = (typeof window !== 'undefined' && window.API_BASE) || '';

  function u(path) {
    if (!BASE) return path;
    const [p, q] = path.split('?');
    return BASE + p + (q ? '/' + q.replace(/&/g, ',') : '') + '.json';
  }

  async function get(path) {
    const r = await fetch(u(path), { headers: { accept: 'application/json' } });
    if (!r.ok) {
      let detail = null;
      try { detail = await r.json(); } catch (_) { /* non-JSON error body */ }
      const e = new Error(`${r.status} ${r.statusText}`);
      e.status = r.status;
      e.detail = detail && detail.detail !== undefined ? detail.detail : detail;
      throw e;
    }
    return r.json();
  }

  const base = (d) => `/v1/sites/${SITE}/forecast/${d}`;

  return {
    SITE, url: u,
    status:      ()        => get('/v1/status'),
    current:     ()        => get(base('current')),
    at:          (d)       => get(base(d)),
    series:      ()        => get(`/v1/sites/${SITE}/forecasts`),
    daily:       (d)       => get(`/v1/sites/${SITE}/daily/${d}`),
    dailySeries: ()        => get(`/v1/sites/${SITE}/daily`),
    dailyRange:  (a, b)    => get(`/v1/sites/${SITE}/daily?from=${a}&to=${b}`),
    corridor:    (d)       => get(`${base(d)}/corridor`),
    geometry:    (d, day, level) =>
                   get(`${base(d)}/corridor/geometry?day=${day}&level=${level}`),
    windIndex:   (d)       => get(`${base(d)}/wind`),   // -48h .. +96h
    // Returned as a URL, not fetched here, so it needs the same mapping.
    windFrameUrl:(d, lvl, off) => u(`${base(d)}/wind/${lvl}/${off}`),
    windFrame:   (d, lvl, off) => get(`${base(d)}/wind/${lvl}/${off}`),
    seasons:     ()        => get(`/v1/sites/${SITE}/seasons`),
    siteSeasons: (site)    => get(`/v1/sites/${site}/seasons`),
    season:      (site, y) => get(`/v1/sites/${site}/seasons/${y}`),
    onThisDate:  (site, m, d) => get(`/v1/sites/${site}/on-this-date/${m}/${d}`),
    observations:(from, to) => get(
      `/v1/sites/${SITE}/observations${from ? `?from=${from}&to=${to}` : ''}`),
    // Flores has labels but no model (site.has_model = 0), so it is only ever
    // asked for observations -- never for a forecast.
    siteObservations: (site, from, to) => get(
      `/v1/sites/${site}/observations${from ? `?from=${from}&to=${to}` : ''}`),
  };
})();
