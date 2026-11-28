/* Wiring: the map, the route overlay, the controls, and the data flow.
 *
 * One idea organises this file: the time slider is the single source of
 * truth. Moving it changes the wind frame AND the corridor day drawn on the
 * routes, because they are the same instant seen two ways -- the field, and
 * what the field does along the three candidate flight paths. Decoupling
 * them would let the map show hour 60 while the routes showed day 1.
 */
(function () {
  const S = window.Scales;

  const state = {
    date: null,          // issue_date currently displayed
    level: 925,
    offsets: [],
    hourIdx: 0,
    frames: {},
    playing: false,
    showRoutes: true,
    showParticles: true,
    windIndex: null,
    geomCache: new Map(),
    routeLayer: null,
    timer: null,
  };

  /* ------------------------------------------------------------ map */

  /* Framed on the basin the corridor actually crosses -- Newfoundland to
   * Iberia, Caribbean to Iceland -- rather than the whole world. Everything
   * east of about 5 W is scenery here: no route touches it, and the wind
   * export does not even cover it. */
  const FRAME = L.latLngBounds([[22, -88], [60, -8]]);
  const map = L.map('map', {
    center: [42, -48], zoom: 3, minZoom: 3, maxZoom: 7,
    worldCopyJump: false, zoomControl: true, attributionControl: true,
    maxBounds: L.latLngBounds([[5, -115], [75, 15]]),
    maxBoundsViscosity: 0.7,
  });
  map.fitBounds(FRAME, { padding: [8, 8] });

  // Bundled public-domain vectors, not a tile service — see js/basemap.js.
  // Awaited nowhere: the wind layer and the routes do not depend on it, so
  // let the land arrive whenever it arrives rather than gate the forecast on
  // it. A failure here costs the coastlines, not the dashboard.
  window.Basemap.add(map).catch(function (e) {
    console.warn('basemap unavailable:', e.message,
                 '- run: python -I tools/build_basemap.py .download_ne');
  });

  const canvas = document.getElementById('wind-canvas');
  window.WindLayer.init(map, canvas, document.getElementById('speed-canvas'));

  // Corvo itself, so the target is never ambiguous.
  L.circleMarker([39.699, -31.111], {
    radius: 5, color: S.INK.primary, weight: 2, fillColor: S.INK.plane,
    fillOpacity: 1, interactive: true,
  }).addTo(map).bindTooltip('Corvo', { direction: 'right' });

  /* ------------------------------------------------- route overlay */

  function routeStyle(f) {
    const best = f.properties.is_best;
    return {
      color: best ? S.INK.primary : S.INK.muted,
      weight: best ? 3 : 1.5,
      opacity: best ? 0.95 : 0.55,
      dashArray: best ? null : '4 4',
    };
  }

  async function drawRoutes() {
    if (state.routeLayer) { map.removeLayer(state.routeLayer); state.routeLayer = null; }
    if (!state.showRoutes || !state.date) return;

    const fh = state.offsets[state.hourIdx] || 0;
    // The corridor features only exist for the forecast window: the model
    // measures days 1-4 ahead and nothing behind. So for a past hour the
    // routes are drawn as geometry only, with their points left neutral --
    // colouring them with day 1's tailwind would attach a forecast
    // measurement to an hour it never covered.
    const past = fh < 0;
    const day = Math.min(4, Math.max(1, Math.ceil(fh / 24) || 1));
    const key = `${state.date}|${day}|${state.level}`;

    let geo = state.geomCache.get(key);
    if (!geo) {
      try {
        geo = await window.API.geometry(state.date, day, state.level);
        state.geomCache.set(key, geo);
      } catch (e) {
        note(`No corridor diagnostics for day ${day}. ` +
             `Run: python publish/diagnostics.py`);
        return;
      }
    }

    state.routeLayer = L.geoJSON(geo, {
      style: routeStyle,
      pointToLayer: (f, latlng) => {
        const p = f.properties;
        if (p.kind === 'target') return L.circleMarker(latlng, { radius: 0, opacity: 0 });
        const t = p.tailwind;
        return L.circleMarker(latlng, {
          radius: past ? 3 : 5,
          fillColor: past ? S.INK.muted : S.tailwindColor(t),
          fillOpacity: past ? 0.5 : 0.95,
          // The 8 m/s threshold the feature definition keys on gets a ring,
          // so it is not carried by colour alone.
          // A dark rim on every point, not just those over threshold: the
          // filled speed field behind them is bright, and without it the
          // tailwind colours disappear into the yellows and greens.
          color: (!past && p.above_threshold) ? S.INK.primary : S.INK.plane,
          weight: (!past && p.above_threshold) ? 2 : 1.5,
          opacity: past ? 0.5 : 0.9,
        });
      },
      onEachFeature: (f, layer) => {
        const p = f.properties;
        if (p.kind === 'route') {
          layer.bindTooltip(
            `<b>${p.route}</b> route — ${p.origin}<br>` +
            `continuity ≥8 m/s: ${(p.continuity8 ?? 0).toFixed(2)}<br>` +
            `bottleneck: ${S.fmtMs(p.bottleneck ?? 0)} m/s` +
            (p.is_best ? '<br><i>best route this day</i>' : ''),
            { sticky: true });
        } else if (p.kind === 'route_point') {
          layer.bindTooltip(
            `${p.route} · point ${p.point_index}<br>` +
            `along-route wind: <b>${t2(p.tailwind)}</b> m/s` +
            (p.above_threshold ? ' ✓ ≥8' : ''),
            { sticky: true });
        }
      },
    }).addTo(map);

    document.getElementById('map-sub').textContent =
      `cycle GEFS ${state.date} · membre c00 · ${state.level} hPa · ` +
      (past
        ? 'before the cycle: what actually happened, routes carry no corridor measure'
        : `routes coloured for day ${day}`);
  }
  const t2 = (v) => (v === null || v === undefined ? '—' : S.fmtMs(v));

  /* --------------------------------------------------- wind frames */

  const frameCache = new Map();

  async function loadFrame() {
    if (!state.offsets.length) return;
    const hr = state.offsets[state.hourIdx];
    const key = `${state.date}|${state.level}|${hr}`;
    let frame = frameCache.get(key);
    if (!frame) {
      try {
        frame = await window.API.windFrame(state.date, state.level, hr);
        if (frameCache.size > 40) frameCache.clear();   // keep memory bounded
        frameCache.set(key, frame);
      } catch (e) {
        note('No wind field exported for this cycle. ' +
             'Run: python publish/export_wind.py');
        return;
      }
    }
    window.WindLayer.setFrame(frame);
    updateTimeLabels();
  }

  function updateTimeLabels() {
    const hr = state.offsets[state.hourIdx];
    const d = new Date(state.date + 'T00:00:00Z');
    d.setUTCHours(d.getUTCHours() + hr);
    const meta = state.frames[hr + '|' + state.level];
    const past = hr < 0;
    const lead = meta ? meta.lead_h : null;

    const lab = document.getElementById('hour-label');
    lab.textContent = (hr >= 0 ? '+' : '') + hr + ' h';
    lab.className = past ? 'is-past' : '';

    // Say what the frame IS. Before the cycle the map shows what happened,
    // not what was predicted -- but only the 00Z frames are true analyses,
    // because this project fetches no other cycle, and claiming otherwise
    // would be the sort of quiet overstatement the rest of this app avoids.
    let kind = '';
    if (past) {
      kind = lead === 0 ? ' · analyse'
           : ' · observed (lead ' + lead + ' h du cycle '
             + (meta ? meta.source_issue_date.slice(5) : '?') + ')';
    }
    document.getElementById('valid-label').textContent =
      'valide ' + d.toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      }) + ' UTC' + kind;
  }

  /* ------------------------------------------------------ controls */

  const hourInput = document.getElementById('hour');

  hourInput.addEventListener('input', () => {
    state.hourIdx = +hourInput.value;
    loadFrame();
    drawRoutes();
  });

  document.querySelectorAll('.seg [data-level]').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.seg [data-level]')
        .forEach((x) => x.classList.toggle('on', x === b));
      state.level = +b.dataset.level;
      loadFrame();
      drawRoutes();
    });
  });

  const playBtn = document.getElementById('play');
  playBtn.addEventListener('click', () => setPlaying(!state.playing));

  function setPlaying(on) {
    state.playing = on;
    playBtn.textContent = on ? 'Pause' : 'Play';
    clearInterval(state.timer);
    if (!on) return;
    state.timer = setInterval(() => {
      state.hourIdx = (state.hourIdx + 1) % state.offsets.length;
      hourInput.value = state.hourIdx;
      loadFrame();
      drawRoutes();
    }, 900);
  }

  document.getElementById('routes-on').addEventListener('change', (e) => {
    state.showRoutes = e.target.checked;
    drawRoutes();
  });

  document.getElementById('particles-on').addEventListener('change', (e) => {
    state.showParticles = e.target.checked;
    window.WindLayer.setEnabled(e.target.checked);
  });

  /* ------------------------------------------- hover wind readout */

  const readout = document.getElementById('readout');
  map.on('mousemove', (e) => {
    const s = window.WindLayer.sampleAt(e.latlng);
    if (!s) { readout.hidden = true; return; }
    readout.hidden = false;
    readout.innerHTML =
      `<b>${s.speed.toFixed(1)} m/s</b> from ${Math.round(s.dir)}°<br>` +
      `${e.latlng.lat.toFixed(1)}°, ${e.latlng.lng.toFixed(1)}° · ${state.level} hPa`;
  });
  map.on('mouseout', () => { readout.hidden = true; });

  /* --------------------------------------------------- map legend */

  function mapLegend() {
    const sw = (c) => `<span class="sw" style="background:${c}"></span>`;
    // The filled field is the thing you read first, so it leads the legend,
    // with its steps labelled in m/s and the 8 m/s corridor threshold called
    // out: that is where the model stops counting wind as usable.
    const field = (S.SPEED_FIELD || [])
      .filter(([, c]) => c)
      .map(([v, c]) => `<span class="sw" style="background:${c}" title="${v} m/s"></span>`)
      .join('');
    const speed = S.SPEED_STOPS.map(([v, c]) => sw(c)).join('');
    const tw = S.TAILWIND_STOPS.map(([v, c]) => sw(c)).join('');
    document.getElementById('map-legend').innerHTML = `
      <div class="legend-row"><span>vitesse du vent</span>${field}
        <span class="muted">4 → 45 m/s · 3ᵉ pas = seuil 8 m/s</span></div>
      <div class="legend-row"><span>particules</span>${speed}
        <span class="muted">same scale, lighter = faster</span></div>
      <div class="legend-row"><span>along-route</span>${tw}
        <span class="muted">0 → 22+ m/s</span></div>
      <div class="legend-row">${sw(S.HEADWIND)}
        <span class="muted">headwind (not helping)</span></div>
      <div class="legend-row"><span class="sw ring-sw"></span>
        <span class="muted">ring = ≥ 8 m/s threshold</span></div>`;
  }

  function note(msg) {
    const el = document.getElementById('map-note');
    el.hidden = false;
    el.textContent = msg;
  }

  /* ------------------------------------------------------ loading */

  /* The daily figure comes from its own model and its own endpoint, so it
   * is fetched independently of the window series. A failure there must not
   * take the rest of the hero down with it. */
  async function loadToday(dateIso) {
    const d = dateIso || new Date().toISOString().slice(0, 10);
    const obs = (state.observed || []).find((o) => o && o.date === d) || null;
    try {
      window.Panels.renderToday(await window.API.daily(d), d, obs);
    } catch (e) {
      window.Panels.renderToday(null, d, obs);
    }
  }

  /* The four days of the run currently on screen, each with its own daily
   * probability. Follows the selected run rather than the clock, so going
   * back to an old cycle shows what THAT cycle said about its four days. */
  async function loadDaysAhead(fc) {
    const w = (fc && fc.window) || {};
    if (!w.start || !w.end) { window.Panels.renderDaysAhead([], null); return; }
    try {
      const r = await window.API.dailyRange(w.start, w.end);
      window.Panels.renderDaysAhead(r.days || [], (r.days || [])[0]
        && (r.days || [])[0].climatology);
    } catch (e) {
      window.Panels.renderDaysAhead([], null);
    }
  }

  async function showRun(date) {
    state.date = date;
    state.geomCache.clear();

    const fc = date === 'current'
      ? await window.API.current()
      : await window.API.at(date);
    state.date = fc.issue_date;

    window.Panels.renderHero(fc);
    window.Panels.renderSkill(fc);

    try {
      window.Panels.renderStrip(await window.API.corridor(state.date));
    } catch (e) {
      document.getElementById('strip').innerHTML =
        '<p class="hint">No corridor detail for this cycle.</p>';
    }

    try {
      state.windIndex = await window.API.windIndex(state.date);
      state.offsets = state.windIndex.offsets || [];
      // lead_h per (offset, level), so the caption can say whether a past
      // frame is a true analysis or a short-lead stand-in for one.
      state.frames = {};
      (state.windIndex.frames || []).forEach((f) => {
        state.frames[f.offset_h + '|' + f.level_hpa] = f;
      });
      const levels = state.windIndex.levels || [925];
      if (!levels.includes(state.level)) state.level = levels[0];
      hourInput.max = String(state.offsets.length - 1);
      // Open on +24 h: the first full day of the window, which is what the
      // forecast is actually about, rather than the analysis hour.
      const i = state.offsets.indexOf(24);
      state.hourIdx = i >= 0 ? i : 0;
      hourInput.value = state.hourIdx;
      document.getElementById('map-note').hidden = true;
      await loadFrame();
    } catch (e) {
      note('No wind field exported for this cycle yet. ' +
           'Run: python publish/export_wind.py');
      state.offsets = [];
    }

    await drawRoutes();
    return fc;
  }

  // Re-select the season bar without rebuilding the click handler chain.
  async function selectRun(date, series, day) {
    setPlaying(false);
    const fc = await showRun(date);
    loadToday(day);          // the CLICKED day, not today's date
    loadDaysAhead(fc);
    window.Panels.renderSeason(series, state.date, (d, k) => selectRun(d, series, k),
                               state.observed, state.daily, state.observedFlores);
  }

  async function boot() {
    mapLegend();
    let status = {};
    try { status = await window.API.status(); } catch (_) {}

    let fc;
    try {
      fc = await showRun('current');
    } catch (e) {
      const d = (e.detail && (e.detail.hint || e.detail.error)) || e.message;
      document.getElementById('question').textContent = 'No forecast published yet.';
      document.getElementById('window').textContent = String(d);
      return;
    }
    window.Panels.renderBar(fc, status);

    try {
      const s = (await window.API.series()).series;
      let obs = [];
      try { obs = (await window.API.observations()).observations || []; } catch (_) {}
      state.observed = obs;
      try {
        state.observedFlores =
          (await window.API.siteObservations('flores')).observations || [];
      } catch (_) { state.observedFlores = []; }
      try { state.daily = (await window.API.dailySeries()).days || []; }
      catch (_) { state.daily = []; }
      window.Panels.renderSeason(s, state.date, (d, k) => selectRun(d, s, k), obs,
                                 state.daily, state.observedFlores);
      loadToday();       // the BOOT path: without it the day figure only
      loadDaysAhead(fc); // appears after a click on the season bar.
      window.Panels.renderVerifNote(s);
      const first = s[0], last = s[s.length - 1];
      const a = first.window_start || first.issue_date;
      const b = last.window_end || last.issue_date;
      const nDays = Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
      document.getElementById('season-meta').textContent =
        `${nDays} days from ${s.length} cycles · ${a} → ${b}`;
    } catch (_) {}

    /* The historical record. Independent of the forecast, so a failure here
     * costs the archive and not the morning number. */
    const seasonHost = document.getElementById('seasons');
    const calHost = document.getElementById('calendars');
    const detail = document.getElementById('day-detail');

    async function loadRegister(site) {
      try {
        const seasons = (await window.API.siteSeasons(site)).seasons || [];
        const latest = seasons.length ? seasons[seasons.length - 1].year : null;
        const pick = (year) => {
          window.History.renderSeasons(seasonHost, seasons, year, pick);
          window.History.renderYear(calHost, detail, site, year);
        };
        if (detail) { detail.hidden = true; }
        if (latest) pick(latest);
        const totDays = seasons.reduce((a, b) => a + (b.days || 0), 0);
        const totSp = seasons.reduce((a, b) => a + (b.days_with_species || 0), 0);
        const span = seasons.length
          ? `${seasons[0].year}–${seasons[seasons.length - 1].year}` : '';
        document.getElementById('hist-meta').textContent =
          `${span} · ${seasons.length} autumns · ${totDays} documented days`
          + ` · ${totSp} with species`
          + (site === 'flores'
              ? ' · arrival reports: no zeros, a missing day was not covered'
              : '');
      } catch (_) { /* archive is optional */ }
    }

    // Same segmented-control convention as the rest of the page: `.seg
    // button` with `.on` for the selected one. My first version invented
    // `.seg-btn` / `.active`, which had no styling at all -- the switch
    // worked and looked like nothing was selected.
    document.querySelectorAll('.seg button[data-site]').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.seg button[data-site]')
          .forEach((o) => o.classList.toggle('on', o === b));
        loadRegister(b.dataset.site);
      });
    });
    await loadRegister('corvo');

    // What this very date has produced across the years. Driven by today's
    // date, so it answers itself on every refresh.
    try {
      await window.History.renderOnThisDate(
        document.getElementById('on-this-date'), window.API.SITE, new Date());
    } catch (_) {}
  }

  // No resize listener here on purpose: WindLayer.init registers its own, and
  // a second one would just run an idempotent resize twice per event.
  boot();
})();
