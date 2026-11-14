/* Bundled vector basemap — no tile service, no third-party request.
 *
 * Why not tiles: a hosted basemap (CARTO, Mapbox, even OSM's own tile
 * servers) is a commercial or foundation-run service with its own terms and
 * availability, and ~20 HTTP requests per view. This map needs coastlines, a
 * few borders and a graticule at zoom 2-7 over one ocean. Natural Earth is
 * public domain and the whole thing fits in one 640 KB file (218 KB gzipped,
 * cached once) built by tools/build_basemap.py. The dashboard then works with
 * no connectivity at all, which matters on Corvo.
 *
 * Rendering notes:
 *  - Everything goes on its own `basemap` pane below the overlay pane, so the
 *    corridor routes always draw on top of the land.
 *  - It uses Leaflet's SVG renderer on that pane. The canvas renderer was the
 *    first choice -- 39k points across ~540 shapes is a lot of <path> elements
 *    -- but a canvas renderer bound to a CUSTOM pane silently never paints:
 *    the layers report onMap=true with 300 clipped parts and nothing appears.
 *    SVG on the same custom pane renders correctly, and costs little here
 *    because the basemap is static: panning only translates the SVG container,
 *    and a reprojection happens just on zoom.
 *  - Nothing here is interactive, so there is no hit-testing cost either.
 */
window.Basemap = (function () {
  'use strict';

  const S = window.Scales;
  let layers = [];

  /* Natural Earth gives [lon, lat]; Leaflet wants [lat, lon]. */
  function toLatLngs(ring) {
    const out = new Array(ring.length);
    for (let i = 0; i < ring.length; i++) out[i] = [ring[i][1], ring[i][0]];
    return out;
  }

  /* Each ring must be wrapped in its own array before it reaches L.polygon.
   *
   * This is not ceremony. Leaflet reads nesting depth to decide what it was
   * given: a flat LatLng[] is one simple polygon, LatLng[][] is ONE polygon
   * whose first ring is the outline and whose remaining rings are HOLES, and
   * only LatLng[][][] is a multi-polygon. Handing it the 310 land rings as
   * LatLng[][] renders North America as the outline with every other
   * landmass punched out of it as a hole -- verified against Leaflet 1.9.4,
   * which reports exactly that. So: one array per ring, giving a true
   * multi-polygon.
   *
   * Holes are not needed anyway. build_basemap.py keeps exterior rings only
   * and lakes come from their own layer, drawn in the ocean colour.
   */
  function toMultiPolygon(rings) {
    return (rings || []).map(function (r) { return [toLatLngs(r)]; });
  }

  /* A 10-degree graticule, generated rather than stored — it is just numbers,
   * and shipping coordinates for straight lines would be silly. Meridians are
   * drawn with intermediate points so they curve correctly under reprojection
   * at high latitude. */
  function graticule(domain, step) {
    const out = [];
    const { west, east, south, north } = domain;
    for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
      const row = [];
      for (let lon = west; lon <= east; lon += 5) row.push([lat, lon]);
      out.push(row);
    }
    for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) {
      const col = [];
      for (let lat = south; lat <= north; lat += 5) col.push([lat, lon]);
      out.push(col);
    }
    return out;
  }

  async function add(map, url) {
    const res = await fetch(url || 'data/basemap.json');
    if (!res.ok) throw new Error('basemap ' + res.status);
    const b = await res.json();

    // Below overlayPane (400) so routes and markers stay above the land.
    if (!map.getPane('basemap')) {
      map.createPane('basemap');
      map.getPane('basemap').style.zIndex = 200;
    }
    const renderer = L.svg({ pane: 'basemap', padding: 0.3 });
    const base = { renderer: renderer, pane: 'basemap', interactive: false };

    const grat = L.polyline(
      graticule(b.meta.domain, 10),
      Object.assign({}, base, {
        color: S.INK.baseline, weight: 1, opacity: 0.7, dashArray: '2 6',
      })).addTo(map);

    const landStyle = Object.assign({}, base, {
      color: S.INK.muted, weight: 0.7, opacity: 0.7,
      fillColor: S.INK.surface, fillOpacity: 1,
    });

    const land = L.polygon(toMultiPolygon(b.land), landStyle).addTo(map);

    // The archipelago at 10m. Separate layer, slightly brighter edge: these
    // nine islands are the subject of the forecast, not scenery.
    const azores = L.polygon(toMultiPolygon(b.azores),
      Object.assign({}, base, {
        color: S.INK.secondary, weight: 1.2, opacity: 1,
        fillColor: S.INK.baseline, fillOpacity: 1,
      })).addTo(map);

    // Lakes punched back out in the ocean colour — the Great Lakes are a
    // strong visual anchor for where the central and southern routes start.
    const lakes = L.polygon(toMultiPolygon(b.lakes),
      Object.assign({}, base, {
        color: S.INK.muted, weight: 0.6, opacity: 0.45,
        fillColor: S.INK.plane, fillOpacity: 1,
      })).addTo(map);

    const borders = L.polyline((b.borders || []).map(toLatLngs),
      Object.assign({}, base, {
        color: S.INK.grid, weight: 0.8, opacity: 0.9,
      })).addTo(map);

    layers = [grat, land, lakes, azores, borders];


    if (map.attributionControl) {
      map.attributionControl.addAttribution(
        'coastlines: <a href="https://www.naturalearthdata.com/" ' +
        'target="_blank" rel="noopener">Natural Earth</a> (public domain)');
    }
    return b.meta;
  }

  function remove(map) {
    layers.forEach(function (l) { map.removeLayer(l); });
    layers = [];
  }

  return { add: add, remove: remove, graticule: graticule };
})();
