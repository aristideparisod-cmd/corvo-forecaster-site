/* Animated wind-particle overlay for the Leaflet map.
 *
 * Reads the de-facto grib2json payload: two records, U and V, located by
 * `parameterNumber` (2 = U eastward, 3 = V northward) and never by position,
 * because the encoder's ordering is not contractual.
 *
 * The one structural idea to know up front: the wind field is cached in SCREEN
 * space, not geographic space. Inverse-projecting every particle every frame
 * would mean ~500 containerPointToLatLng calls at 60 Hz; instead we project a
 * coarse 6 px lattice once per view change, and the animation loop then does
 * nothing but array reads and line strokes. */
window.WindLayer = (function () {
  'use strict';

  const STEP        = 6;      // CSS px between cached field samples
  const SEG_WIDTH   = 1.4;    // px, particle trail stroke
  const MAX_JUMP    = 8;      // px per frame a particle may travel
  const BASE_SCALE  = 0.16;   // px per (m/s) per frame at zoom 3
  const FADE_ALPHA  = 0.90;   // destination-in multiplier -> ~10-frame trails
  const COS_FLOOR   = 0.30;   // caps the Mercator stretch near the poles

  let map = null, canvas = null, ctx = null;
  let speedCanvas = null, sctx = null, raster = null;
  let grid = null;            // {nx, ny, lo1, la1, dx, dy, u, v}
  let field = null;           // Float32Array, 4 floats per cell
  let fCols = 0, fRows = 0, cssW = 0, cssH = 0, dpr = 1, particles = [];
  let rafId = null, enabled = true, needsField = true, inited = false;

  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  /* Validate a frame. Anything malformed leaves the previous grid in place --
   * a bad fetch should degrade to a stale field, not a throw. */
  function parseFrame(frame) {
    const bad = (m) => (console.warn('WindLayer: ' + m), null);
    if (!Array.isArray(frame) || frame.length < 2) return bad('frame is not an array of two records');
    let uRec = null, vRec = null;
    for (const rec of frame) {                   // by parameterNumber, not order
      const p = rec && rec.header && rec.header.parameterNumber;
      if (p === 2) uRec = rec; else if (p === 3) vRec = rec;
    }
    if (!uRec || !vRec) return bad('missing U (parameterNumber 2) or V (3)');
    const h = uRec.header, hv = vRec.header;
    const nx = h.nx | 0, ny = h.ny | 0, n = nx * ny;
    if (!(nx > 1 && ny > 1)) return bad('bad grid dimensions ' + h.nx + 'x' + h.ny);
    if ((hv.nx | 0) !== nx || (hv.ny | 0) !== ny) return bad('U and V grids differ in size');
    if (!Array.isArray(uRec.data) || !Array.isArray(vRec.data) ||
        uRec.data.length !== n || vRec.data.length !== n) return bad('data length != nx*ny (' + n + ')');
    if (![h.lo1, h.la1, h.dx, h.dy].every(Number.isFinite) || !h.dx || !h.dy)
      return bad('bad lo1/la1/dx/dy');
    return {
      nx: nx, ny: ny,
      lo1: h.lo1, la1: h.la1,            // NW corner; lo1 is degrees east 0..360
      dx: Math.abs(h.dx), dy: Math.abs(h.dy),
      u: uRec.data, v: vRec.data,
      refTime: h.refTime, forecastTime: h.forecastTime,
    };
  }

  /* Bilinear (u,v) at a geographic point, or null.
   *
   * `data` is row-major from the NORTH-WEST corner: index j*nx + i walks EAST
   * along row j, and j itself steps SOUTH. So longitude grows with i while
   * latitude DECREASES with j -- hence `la1 - lat` below, not `lat - la1`. */
  function lookup(lat, lon) {
    if (!grid || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const g = grid;
    // The grid speaks 0..360 east; the map hands us -180..180.
    const lon360 = ((lon % 360) + 360) % 360;
    const fi = (((lon360 - g.lo1) % 360 + 360) % 360) / g.dx;
    const fj = (g.la1 - lat) / g.dy;
    if (fi > g.nx - 1 || fj < 0 || fj > g.ny - 1) return null;
    const i0 = Math.floor(fi), j0 = Math.floor(fj), ri = fi - i0, rj = fj - j0;
    const i1 = Math.min(i0 + 1, g.nx - 1), j1 = Math.min(j0 + 1, g.ny - 1);
    const a = j0 * g.nx + i0, b = j0 * g.nx + i1, c = j1 * g.nx + i0, d = j1 * g.nx + i1;
    const ua = g.u[a], ub = g.u[b], uc = g.u[c], ud = g.u[d];
    const va = g.v[a], vb = g.v[b], vc = g.v[c], vd = g.v[d];
    // One null corner makes the whole interpolation meaningless.
    if (ua == null || ub == null || uc == null || ud == null ||
        va == null || vb == null || vc == null || vd == null) return null;
    const w00 = (1 - ri) * (1 - rj), w10 = ri * (1 - rj);
    const w01 = (1 - ri) * rj,       w11 = ri * rj;
    return [
      ua * w00 + ub * w10 + uc * w01 + ud * w11,
      va * w00 + vb * w10 + vc * w01 + vd * w11,
    ];
  }

  /* Rebuild the screen-space lattice: one projection call per cell, none per
   * particle per frame.
   *
   * Web Mercator is conformal, so the local metres-to-pixels ratio is equal in
   * x and y at a given latitude -- one factor k serves both components. It
   * grows as 1/cos(lat) (floored, so a high-latitude cell cannot explode) and
   * doubles per zoom level, so the same wind reads as the same wind as you
   * zoom. BASE_SCALE is frank exaggeration: true wind covers a small fraction
   * of a pixel per frame at these zooms. */
  function buildField() {
    needsField = false;
    if (!map || !ctx || cssW <= 0 || cssH <= 0) { field = null; return; }
    fCols = Math.ceil(cssW / STEP) + 1;
    fRows = Math.ceil(cssH / STEP) + 1;
    const out = new Float32Array(fCols * fRows * 4);
    if (!grid) { out.fill(NaN); field = out; return; }
    const scale = BASE_SCALE * Math.pow(2, map.getZoom() - 3);
    const half = STEP / 2;
    for (let r = 0; r < fRows; r++) {
      for (let c = 0; c < fCols; c++) {
        const o = (r * fCols + c) * 4;
        const ll = map.containerPointToLatLng(
          L.point(c * STEP + half, r * STEP + half));
        const uv = lookup(ll.lat, ll.lng);
        if (!uv) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = NaN; continue; }
        const k = scale / Math.max(COS_FLOOR, Math.cos(ll.lat * Math.PI / 180));
        let vx = uv[0] * k, vy = -uv[1] * k;   // canvas y grows downward
        const len = Math.hypot(vx, vy);        // cap the step: no teleporting
        if (len > MAX_JUMP) { const s = MAX_JUMP / len; vx *= s; vy *= s; }
        out[o] = uv[0]; out[o + 1] = uv[1]; out[o + 2] = vx; out[o + 3] = vy;
      }
    }
    field = out;
    paintSpeed();
  }


  /* ------------------------------------------------------- speed raster */

  /* Paint the wind-speed field underneath the particles.
   *
   * It reuses the screen-space field that already exists for the particles,
   * so there is no extra projection work: one ImageData at field resolution
   * (one pixel per 6 px cell), then drawImage scales it up with the browser's
   * own bilinear smoothing. Painting at full canvas resolution would be
   * ~40x the pixels for a field that is smooth by nature.
   */
  function paintSpeed() {
    if (!sctx || !field || !fCols || !fRows) return;
    if (!raster || raster.width !== fCols || raster.height !== fRows) {
      raster = document.createElement('canvas');
      raster.width = fCols; raster.height = fRows;
    }
    const rc = raster.getContext('2d');
    const img = rc.createImageData(fCols, fRows);
    const px = img.data;

    /* The exported grid is a rectangle (100W-1W, 70N-20N) and without this
     * it ends in a hard edge straight across the ocean, which reads as a
     * feature of the weather rather than of the download. Fade the alpha over
     * the last few cells before any no-data neighbour, so the field dissolves
     * instead of being cut. */
    const FADE = 9;   // ~54 CSS px: a soft dissolve, not a visible seam
    const hasData = new Uint8Array(fCols * fRows);
    for (let i = 0, n = fCols * fRows; i < n; i++) {
      hasData[i] = Number.isNaN(field[i * 4]) ? 0 : 1;
    }
    function edgeAlpha(c, r) {
      let d = FADE;
      for (let dr = -FADE; dr <= FADE && d > 0; dr++) {
        for (let dc = -FADE; dc <= FADE; dc++) {
          const rr = r + dr, cc = c + dc;
          const out = rr < 0 || cc < 0 || rr >= fRows || cc >= fCols
                      || !hasData[rr * fCols + cc];
          if (out) {
            const dist = Math.max(Math.abs(dr), Math.abs(dc));
            if (dist < d) d = dist;
          }
        }
      }
      return Math.max(0, Math.min(1, d / FADE));
    }

    for (let r = 0; r < fRows; r++) {
      for (let c = 0; c < fCols; c++) {
        const i = r * fCols + c;
        const o = i * 4, q = i * 4;
        const u = field[o], v = field[o + 1];
        let rgb = null;
        if (!Number.isNaN(u)) rgb = window.Scales.speedFieldRGB(Math.hypot(u, v));
        if (rgb) {
          px[q] = rgb[0]; px[q + 1] = rgb[1]; px[q + 2] = rgb[2];
          px[q + 3] = Math.round(255 * edgeAlpha(c, r));
        } else {
          px[q + 3] = 0;                     // calm or no data: fully clear
        }
      }
    }
    rc.putImageData(img, 0, 0);

    sctx.clearRect(0, 0, cssW, cssH);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    // The field samples cell CENTRES, so the raster is offset by half a cell.
    sctx.drawImage(raster, -STEP / 2, -STEP / 2, fCols * STEP, fRows * STEP);
  }

  function ensureField() { if (needsField) buildField(); }

  // Nearest cached cell for a canvas point; -1 when off-canvas or no field.
  function cellAt(x, y) {
    if (!field || x < 0 || y < 0 || x >= cssW || y >= cssH) return -1;
    const c = Math.min(fCols - 1, (x / STEP) | 0);
    const r = Math.min(fRows - 1, (y / STEP) | 0);
    return (r * fCols + c) * 4;
  }

  // ~1 particle per 900 px^2 of canvas, clamped either side.
  function particleCount() { return Math.max(250, Math.min(1400, Math.round(cssW * cssH / 900))); }

  function respawn(p) {
    p.age = 0;
    p.maxAge = 90 + Math.random() * 50;   // randomised: no lockstep respawning
    for (let t = 0; t < 8; t++) {         // retry onto a cell that has wind
      const x = Math.random() * cssW, y = Math.random() * cssH;
      const o = cellAt(x, y);
      if (o >= 0 && !Number.isNaN(field[o])) { p.x = x; p.y = y; return true; }
    }
    p.x = -1; p.y = -1;                   // parked; retried next frame
    return false;
  }

  function seedParticles() {
    // Seed against a CURRENT field: respawning onto a stale one parks every
    // particle, so the first tick would respawn them all at once and undo the
    // staggered ages set below.
    ensureField();
    const n = particleCount();
    particles = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = { x: -1, y: -1, age: 0, maxAge: 0 };
      respawn(p);                        // gives it a randomised maxAge
      p.age = Math.random() * p.maxAge;  // stagger: no synchronised first wave
      particles[i] = p;
    }
  }

  /* Fade by multiplying existing alpha rather than painting the surface
   * colour: this canvas sits ON TOP of the basemap, so an opaque fill would
   * blot the map out. destination-in at 0.90 leaves 0.9^n of a trail after n
   * frames -- legible for ~10, gone soon after. */
  function fade() {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,' + FADE_ALPHA + ')';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.globalCompositeOperation = 'source-over';
  }

  function clear() { if (ctx) ctx.clearRect(0, 0, cssW, cssH); }

  // Bucketed by colour: one path per shade, so a frame costs a few dozen
  // stroke() calls instead of one per particle.
  function strokeBuckets(buckets) {
    ctx.lineWidth = SEG_WIDTH;
    ctx.lineCap = 'round';
    for (const colour in buckets) {
      const segs = buckets[colour];  ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) {
        ctx.moveTo(segs[i], segs[i + 1]);
        ctx.lineTo(segs[i + 2], segs[i + 3]);
      }
      ctx.strokeStyle = colour;
      ctx.stroke();
    }
  }

  function tick() {
    if (!enabled || !inited) { rafId = null; return; }
    rafId = window.requestAnimationFrame(tick);
    if (needsField) { buildField(); clear(); }
    if (!field) return;
    fade();
    const buckets = Object.create(null);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const o = cellAt(p.x, p.y);
      if (o < 0 || Number.isNaN(field[o]) || ++p.age > p.maxAge) {
        respawn(p); continue;
      }
      const nx2 = p.x + field[o + 2], ny2 = p.y + field[o + 3];
      if (nx2 < 0 || ny2 < 0 || nx2 >= cssW || ny2 >= cssH) { respawn(p); continue; }
      const colour = window.Scales.speedColor(Math.hypot(field[o], field[o + 1]));
      (buckets[colour] || (buckets[colour] = [])).push(p.x, p.y, nx2, ny2);
      p.x = nx2; p.y = ny2;
    }
    strokeBuckets(buckets);
  }

  /* One still frame for prefers-reduced-motion: short streaks on a sparse
   * lattice, integrated through the same cached field, then nothing moves. */
  function drawStatic() {
    if (!ctx) return;
    clear();
    ensureField();
    if (!field) return;
    const spacing = 22, steps = 7, buckets = Object.create(null);
    for (let y = spacing / 2; y < cssH; y += spacing) {
      for (let x = spacing / 2; x < cssW; x += spacing) {
        let px = x, py = y;
        const o0 = cellAt(px, py);
        if (o0 < 0 || Number.isNaN(field[o0])) continue;
        const colour = window.Scales.speedColor(Math.hypot(field[o0], field[o0 + 1]));
        const segs = buckets[colour] || (buckets[colour] = []);
        for (let s = 0; s < steps; s++) {
          const o = cellAt(px, py);
          if (o < 0 || Number.isNaN(field[o])) break;
          const qx = px + field[o + 2] * 0.8, qy = py + field[o + 3] * 0.8;  // 0.8: keep streaks short
          segs.push(px, py, qx, qy);
          px = qx; py = qy;
        }
      }
    }
    strokeBuckets(buckets);
  }

  function start() {
    if (rafId !== null || !enabled || !inited) return;   // never two loops
    rafId = window.requestAnimationFrame(tick);
  }

  function stop() { if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; } }

  function render() {
    if (!inited || !enabled) return;
    if (reduceMotion.matches) { stop(); drawStatic(); } else { start(); }
  }

  function resize() {
    if (!canvas || !ctx) return;
    if (speedCanvas) {
      const b = speedCanvas.getBoundingClientRect();
      speedCanvas.width = Math.round((b.width || speedCanvas.clientWidth)
                                     * (window.devicePixelRatio || 1));
      speedCanvas.height = Math.round((b.height || speedCanvas.clientHeight)
                                      * (window.devicePixelRatio || 1));
      sctx = speedCanvas.getContext('2d');
      sctx.setTransform(window.devicePixelRatio || 1, 0, 0,
                        window.devicePixelRatio || 1, 0, 0);
    }
    dpr = window.devicePixelRatio || 1;
    // CSS size comes from the layout box; we only own the backing store.
    const box = canvas.getBoundingClientRect();
    cssW = Math.max(0, Math.round(box.width || canvas.clientWidth));
    cssH = Math.max(0, Math.round(box.height || canvas.clientHeight));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // draw in CSS px throughout
    needsField = true;
    if (particles.length !== particleCount()) seedParticles();
    clear();
    render();
  }

  /* Suspend while the view is in motion.
   *
   * `move` fires once per frame during a drag and each one invalidates the
   * screen field. Rebuilding on all of them would run fCols*fRows
   * containerPointToLatLng calls per frame -- about 20k at a desktop size --
   * and visibly stutter the pan. So drop the layer for the duration of the
   * gesture and rebuild once, at the end. Particles disappearing mid-drag is
   * what every map wind layer does, and it costs nothing: there is no
   * meaningful animation to watch while the ground is sliding. */
  function onViewStart() {
    stop();
    clear();
    if (sctx) sctx.clearRect(0, 0, cssW, cssH);   // raster would smear mid-pan
    needsField = true;
  }

  // One rebuild once the gesture settles.
  function onView() {
    needsField = true;
    if (!enabled) return;
    if (reduceMotion.matches) {
      if (rafId === null) rafId = window.requestAnimationFrame(function () {
        rafId = null; drawStatic();
      });
    } else { clear(); start(); }
  }

  return {
    init(m, cv, sc) {
      if (inited) this.destroy();
      map = m; canvas = cv;
      speedCanvas = sc || document.getElementById('speed-canvas');
      ctx = canvas.getContext('2d');
      inited = true; enabled = true;
      map.on('movestart zoomstart', onViewStart);
      map.on('moveend zoomend viewreset', onView);
      map.on('resize', resize);
      window.addEventListener('resize', resize);
      resize();        // sizes the canvas, seeds particles, starts rendering
    },

    setFrame(frame) {
      const parsed = parseFrame(frame);
      if (!parsed) return;            // malformed: keep whatever we had
      grid = parsed;
      needsField = true;
      clear();
      if (inited) { seedParticles(); render(); }
    },

    setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        stop(); clear();
        if (sctx) sctx.clearRect(0, 0, cssW, cssH);
      } else { needsField = true; render(); paintSpeed(); }
    },

    sampleAt(latlng) {
      if (!latlng) return null;
      const uv = lookup(latlng.lat, latlng.lng);
      if (!uv) return null;
      const u = uv[0], v = uv[1];
      // Meteorological convention: the direction the wind blows FROM.
      const dir = ((270 - Math.atan2(v, u) * 180 / Math.PI) % 360 + 360) % 360;
      return { u: u, v: v, speed: Math.hypot(u, v), dir: dir };
    },

    resize: resize,

    destroy() {
      stop();
      if (map) {
        map.off('movestart zoomstart', onViewStart);
        map.off('moveend zoomend viewreset', onView);
        map.off('resize', resize);
      }
      window.removeEventListener('resize', resize);
      clear();
      inited = false; enabled = true; field = null; particles = [];
      map = null; canvas = null; ctx = null;
    },
  };
})();
