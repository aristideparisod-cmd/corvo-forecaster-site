/* Panel renderers. Every colour comes from window.Scales; nothing here invents
 * an encoding, and every nested payload field is guarded.
 * resolve() looks an element up by id and falls back to a selector. It exists
 * because index.html once carried a duplicate id on the hero heading (only the
 * first of which a browser keeps); that is fixed, and the fallback is kept as
 * cheap insurance against the markup drifting again.
 */
window.Panels = (function () {
  'use strict';
  const S = window.Scales;
  const byId = (id) => document.getElementById(id);
  const resolve = (id, sel) => byId(id) || (sel ? document.querySelector(sel) : null);
  /* For any caller building HTML; the renderers set textContent instead. */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const clear = (n) => { while (n && n.firstChild) n.removeChild(n.firstChild); };
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  const pct  = (v) => (isNum(v) ? S.fmtPct(v) : null);        // 1 decimal, unsigned
  const frac = (v) => (isNum(v) ? v.toFixed(2) : null);       // 2 decimals
  const ms   = (v) => (isNum(v) ? S.fmtMs(v) : null);         // signed, 1 decimal
  const sgn3 = (v) => (isNum(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : null);
  const thou = (v) => (isNum(v) ? Number(v).toLocaleString('en-US') : null);
  const cssPct = (v) => (isNum(v) ? (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%' : '0%');
  function utc(iso) {
    if (!iso || typeof iso !== 'string') return null;
    const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(iso, opts) {
    const d = utc(iso);
    return d ? d.toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, opts)) : null;
  }
  const shortDate  = (iso) => fmtDate(iso, { day: 'numeric', month: 'short' });              // 9 Oct
  const dayNoMonth = (iso) => fmtDate(iso, { weekday: 'short', day: 'numeric' });            // Sat 10
  const dayMonth   = (iso) => fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  /* "mid-October" — the slice of the month climatology is quoted for. */
  function monthPhase(iso) {
    const d = utc(iso);
    if (!d) return 'this time of year';
    const dom = d.getUTCDate();
    return (dom <= 7 ? 'early' : dom <= 22 ? 'mid' : 'late') + '-'
      + d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  }
  const DIRS = {
    above: { cls: 'up',   arrow: '\u2191', word: 'above' },
    near:  { cls: 'flat', arrow: '\u2194', word: 'from normal' },
    below: { cls: 'down', arrow: '\u2193', word: 'below' },
  };
  function metric(label, value, sub) {
    const t = el('div', 'metric');
    t.appendChild(el('div', 'm-label', label));
    t.appendChild(el('div', 'm-value', value));
    if (sub) t.appendChild(el('div', 'm-sub', sub));
    return t;
  }
  function swatch(parent, hex, label, extraCls) {
    const item = el('span', 'legend-item');
    const sw = el('span', extraCls ? 'sw ' + extraCls : 'sw');
    sw.style.background = hex;
    item.appendChild(sw);
    if (label) item.appendChild(el('span', 'sw-label', label));
    parent.appendChild(item);
  }

  /* ---------- hero: the one probability, read against climatology ---------- */
  function renderHero(fc) {
    fc = fc || {};
    const qn = resolve('question', '.q');
    const probN = byId('prob'), cmpN = byId('cmp'), winN = byId('window');
    const gauge = byId('gauge'), climN = byId('gauge-clim'), wrap = byId('gauge-wrap');
    if (qn) qn.textContent = fc.question || '\u00a0';
    if (cmpN) cmpN.textContent = '';   // also drops nodes set via innerHTML below
    const prov = fc.provenance || {};
    const ok = !prov.build_status || prov.build_status === 'OK';
    const p = isNum(fc.probability) ? fc.probability : null;
    if (!ok || p === null) {                       // failed build: no figure, no gauge
      if (probN) {
        probN.textContent = '--';
        probN.style.color = '';           // pas de chiffre, pas de couleur
        probN.removeAttribute('title');
      }
      if (gauge) gauge.style.width = '0%';
      if (wrap) { wrap.hidden = true; wrap.style.display = 'none'; }
      if (winN) {
        const err = fc.error || {};
        winN.textContent = err.meaning
          || (err.build_status || prov.build_status
                ? 'Build status: ' + (err.build_status || prov.build_status)
                : 'No forecast is available for this cycle.');
      }
      return;
    }
    if (wrap) { wrap.hidden = false; wrap.style.display = ''; }
    if (probN) {
      probN.textContent = pct(p);
      // La couleur EST l'indice de lecture rapide ; le chiffre reste à côté,
      // donc elle ne porte jamais seule l'information.
      probN.style.color = S.probColor(p);
      probN.title = 'probability: ' + S.probBand(p);
    }
    if (gauge) {
      gauge.style.width = cssPct(p);
      // La jauge montre la même quantité : même couleur, sinon deux
      // encodages concurrents pour un seul nombre.
      gauge.style.background = S.probColor(p);
    }
    if (climN && isNum(fc.climatology)) climN.style.left = cssPct(fc.climatology);
    if (cmpN) {   // "Normal for mid-October is 51.4% - this is (up) 18.0 points above."
      const an = fc.anomaly || {};
      const delta = isNum(an.delta) ? an.delta
        : (isNum(fc.climatology) ? p - fc.climatology : null);
      const dir = DIRS[an.direction] || (isNum(delta)
        ? (delta > 0.02 ? DIRS.above : delta < -0.02 ? DIRS.below : DIRS.near) : DIRS.near);
      const cl = isNum(fc.climatology) ? pct(fc.climatology) : null;
      const lead = cl
        ? 'Normal for ' + monthPhase(fc.issue_date) + ' is ' + cl + '% \u2014 this is '
        : 'Compared with ' + monthPhase(fc.issue_date) + ' normal: ';
      const amount = delta === null ? 'not comparable'
        : pct(Math.abs(delta)) + ' points ' + dir.word;
      cmpN.innerHTML = esc(lead) + '<strong class="' + esc(dir.cls) + '">'
        + '<span class="arrow">' + esc(dir.arrow) + '</span> '
        + esc(amount) + '</strong>.';
    }
    if (winN) {
      const w = fc.window || {};
      const a = dayNoMonth(w.start), b = dayMonth(w.end);
      const nd = isNum(w.days) ? w.days : null;
      winN.textContent = (a && b)
        ? 'Window: ' + a + ' \u2014 ' + b
            + (nd ? ' (' + nd + ' day' + (nd === 1 ? '' : 's') + ')' : '')
        : 'Window dates are not recorded for this cycle.';
    }
  }

  /* ---------- corridor strip: three metrics x four days, as a heatmap ---------- */
  const ROWS = [
    { key: 'continuity', label: 'Continuity', unit: '0-1', kind: 'frac' },
    { key: 'bottleneck', label: 'Bottleneck', unit: 'm/s', kind: 'ms' },
    { key: 'vertical',   label: 'Vertical',   unit: '0-1', kind: 'frac' },
  ];
  function bestRoutes(dayObj) {
    const rs = dayObj && Array.isArray(dayObj.routes) ? dayObj.routes : [];
    const names = rs.filter((r) => r && r.ever_best).map((r) => r.route).filter(Boolean);
    return names.length ? names.join(', ') : null;
  }
  function renderStrip(corridor) {
    const host = byId('strip');
    if (!host) return;
    clear(host);
    corridor = corridor || {};
    const issue = corridor.issue_date;
    const arr = Array.isArray(corridor.days) ? corridor.days : [];
    const slots = [1, 2, 3, 4].map((d) => arr.find((x) => x && x.day === d) || null);
    const dayName = (i) => (issue ? S.dayLabel(issue, i + 1) : 'Day ' + (i + 1));
    // DOM order is load-bearing for the CSS grid:
    // corner, 4 column heads, then (row head + 4 cells) x 3.
    host.appendChild(el('div', ''));
    slots.forEach((d, i) => {
      const n = el('div', 'strip-col-head', dayName(i));
      n.title = 'Day ' + (i + 1) + ' \u2014 ' + dayName(i);
      host.appendChild(n);
    });
    const meaning = corridor.feature_meaning || {};
    ROWS.forEach((row) => {
      const head = el('div', 'strip-row-head', row.label);
      head.appendChild(el('small', '', row.unit));
      if (meaning[row.key]) head.title = String(meaning[row.key]);
      host.appendChild(head);
      slots.forEach((dayObj, i) => {
        const v = dayObj && isNum(dayObj[row.key]) ? dayObj[row.key] : null;
        const hex = row.kind === 'ms' ? S.tailwindColor(v) : S.fractionColor(v);
        const text = v === null ? '\u2014' : (row.kind === 'ms' ? ms(v) : frac(v));
        const over = row.kind === 'ms' && v !== null && v >= S.TAILWIND_THRESHOLD;
        const cell = el('div', 'strip-cell', text);
        cell.style.background = hex;
        cell.style.color = S.inkOn(hex);
        if (over) cell.classList.add('ring');       // threshold, not by colour alone
        const best = bestRoutes(dayObj);
        cell.title = row.label + ' \u2014 ' + dayName(i) + ': '
          + (v === null ? 'no value' : text + (row.kind === 'ms' ? ' m/s' : ''))
          + ' \u00b7 best route: ' + (best || 'not recorded')
          + (over ? ' \u00b7 at or over the ' + S.TAILWIND_THRESHOLD.toFixed(0) + ' m/s threshold' : '');
        host.appendChild(cell);
      });
    });
    stripLegend();
  }

  /* ---------- strip legend: both ramps, plus the non-colour threshold ---------- */
  function stripLegend() {
    const host = byId('strip-legend');
    if (!host) return;
    clear(host);

    const a = el('div', 'legend-row');
    a.appendChild(el('span', 'legend-title', 'Continuity / vertical'));
    a.appendChild(el('span', 'sw-label', '0'));
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => swatch(a, S.fractionColor(f), ''));
    a.appendChild(el('span', 'sw-label', '1'));
    a.appendChild(el('span', 'sw-label',
      '— fraction of the route carrying usable tailwind'));
    host.appendChild(a);

    const b = el('div', 'legend-row');
    b.appendChild(el('span', 'legend-title', 'Bottleneck'));
    swatch(b, S.HEADWIND, 'headwind');
    (S.TAILWIND_STOPS || []).forEach((stop, i, all) => {
      const hi = all[i + 1] ? all[i + 1][0] : null;
      swatch(b, S.tailwindColor(stop[0]), hi === null ? stop[0] + '+' : stop[0] + '\u2013' + hi);
    });
    b.appendChild(el('span', 'sw-label', 'm/s — the route\u2019s weakest link'));
    host.appendChild(b);

    const note = el('div', 'legend-note');
    note.textContent =
      'A ringed cell is at or over ' + S.TAILWIND_THRESHOLD.toFixed(0)
      + ' m/s, the threshold the corridor feature keys on. Day 1 is tomorrow. '
      + 'These twelve numbers are the model\u2019s entire input.';
    host.appendChild(note);
  }



  /* ---------- season: one bar per issued cycle, clickable and focusable ---------- */
  function outcomeWord(e) {
    if (!e || !e.outcome) return 'not scored';
    return (e.outcome === 'pending' || e.outcome === 'unverifiable')
      ? e.outcome + (e.unverifiable_reason ? ' (' + e.unverifiable_reason + ')' : '')
      : e.outcome;
  }
  /* A bar is labelled by the window it FORECASTS, not the cycle that produced
   * it: "19-22" is the span of days the probability is about. The issue date
   * is an implementation detail of when the model ran, and putting it on the
   * axis invited reading each bar as a statement about that day. The run date
   * stays in the tooltip, where provenance belongs. */
  function windowLabel(e) {
    const a = dayNum(e.window_start), b = dayNum(e.window_end);
    if (a === null || b === null) return shortDate(e.issue_date) || '—';
    return a + '–' + b;                      // en dash
  }
  const dayNum = (iso) => {
    const d = utc(iso);
    return d ? d.getUTCDate() : null;
  };
  const monShort = (iso) => fmtDate(iso, { month: 'short' });

  function windowPhrase(e) {
    if (!e.window_start || !e.window_end) return null;
    return shortDate(e.window_start) + ' – ' + shortDate(e.window_end);
  }

  /* Per-day series.
   *
   * The model emits ONE probability per 4-day window, and consecutive cycles
   * produce windows that overlap three days out of four. Drawn as one bar per
   * window they pile up and no calendar day can be read off the axis. So the
   * axis here is the calendar: every day appears exactly once.
   *
   * What a day's bar shows is the window probability of the most recent cycle
   * covering that day -- the shortest lead, so the sharpest statement
   * available about it. The range mark above it spans the min and max across
   * ALL cycles that covered the day, which turns the overlap from a nuisance
   * into the interesting part: 11 October climbed from 43% to 73% as it came
   * closer.
   *
   * The honesty caveat, stated in the legend and every tooltip: this is a
   * WINDOW probability attributed to the days it covers, not P(this day).
   * The model never says "day D has x% chance" -- it says "at least one day
   * in these four does".
   */
  function buildDayIndex(series) {
    const days = new Map();
    (Array.isArray(series) ? series : []).forEach((e) => {
      if (!e || !e.window_start || !e.window_end) return;
      if (e.build_status && e.build_status !== 'OK') return;
      if (!isNum(e.probability)) return;
      const a = utc(e.window_start), b = utc(e.window_end);
      if (!a || !b) return;
      for (const d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if (!days.has(key)) days.set(key, []);
        days.get(key).push(e);
      }
    });
    // Most recent cycle first, so [0] is the sharpest forecast for that day.
    days.forEach((v) => v.sort((x, y) => (x.issue_date < y.issue_date ? 1 : -1)));
    return days;
  }


  /* ---------- today's figure, from the windows that cover today ----------
   *
   * Asked for directly: the four-day window says nothing about THIS day, and
   * that is the first thing a reader wants on opening the page.
   *
   * What this shows is the window probability of the most recent cycle whose
   * window covers today, with the span across every cycle that covered it.
   * Exactly the treatment the season axis already uses, and reusing
   * buildDayIndex rather than recomputing it keeps the two from drifting
   * apart.
   *
   * WHAT IT IS NOT, and the caption says so on the page: a per-day
   * probability. The model emits P(at least one day in four reaches three
   * birds). Turning that into P(this day) would need either an independence
   * assumption that is plainly false -- arrivals cluster, that is the whole
   * phenomenon -- or a model retrained on a per-day target. Neither is
   * smuggled in here.
   */
  function renderToday(daily, dateIso, observed) {
    const n = byId('prob-today'), lab = byId('today-label'), note = byId('today-note');
    if (!n) return;
    const realToday = new Date().toISOString().slice(0, 10);
    const today = dateIso || realToday;
    // The label has to say WHICH day, or selecting a past run leaves a figure
    // captioned "today" that is about something else entirely.
    if (lab) {
      lab.textContent = (today === realToday ? 'Today, ' : '')
        + fmtDate(today, { day: 'numeric', month: 'long' });
    }

    if (!daily || !isNum(daily.probability)) {
      n.textContent = '--';
      n.style.color = '';
      n.removeAttribute('title');
      if (note) note.textContent = 'No daily forecast covers today.';
      return;
    }
    const p = daily.probability;
    n.textContent = pct(p);
    // Daily scale, not the 0-100 one: see Scales.dailyColor. The window
    // figure below keeps probColor, because that is the range it lives in.
    n.style.color = S.dailyColor(p, daily.climatology);
    n.title = S.dailyBand(p, daily.climatology) + ' for a single day'
      + ' — daily model, issued ' + daily.issue_date
      + ' (d+' + daily.lead_days + ')';

    if (note) {
      clear(note);
      const cl = daily.climatology;
      const ratio = isNum(cl) && cl > 0 ? p / cl : null;
      const bits = [];
      bits.push('P(this day reaches 3 new Nearctic landbirds). Daily '
                + 'normal ' + pct(cl) + '%'
                + (ratio ? ' — ' + (ratio >= 1 ? '×' + ratio.toFixed(1)
                                               : '÷' + (1 / ratio).toFixed(1)) : '')
                + '.');
      if (daily.n_cycles > 1 && (daily.p_max - daily.p_min) > 0.005) {
        bits.push(daily.n_cycles + ' cycles covered it, from '
                  + pct(daily.p_min) + ' to ' + pct(daily.p_max) + '%.');
      }
      // For a past day we know the answer, and withholding it would make the
      // panel useless exactly where it can be checked.
      if (observed && isNum(observed.new_landbirds_min)) {
        const k = observed.new_landbirds_min;
        bits.push('Observed that day: ' + k + ' new Nearctic landbird'
                  + (k === 1 ? '' : 's')
                  + (k >= 3 ? ' — threshold met.' : '.'));
      }
      note.appendChild(document.createTextNode(bits.join(' ')));
    }
  }

  /* ---------- the four days ahead, one probability each ----------
   *
   * The window answers "is this period worth anything". This answers "which
   * day". On 13 October the window read 47.8% while the four days read 12.2,
   * 9.8, 7.0 and 19.6: the 16th is nearly dead and the 17th is the pick, and
   * the window figure could not say so.
   *
   * Bars are scaled against the DAILY climatology rather than against each
   * other, so a flat quiet week looks flat instead of being stretched to
   * fill the axis. The climatology line is drawn, so "above normal" is read
   * off the chart rather than computed by the reader.
   */
  function renderDaysAhead(days, climatology) {
    const host = byId('days-ahead');
    if (!host) return;
    clear(host);
    const list = (days || []).filter((d) => isNum(d.probability));
    if (!list.length) return;

    const cl = isNum(climatology) ? climatology
      : (isNum(list[0].climatology) ? list[0].climatology : null);
    // Full height = twice climatology, floored so a single high day cannot
    // flatten the rest. 40% is the practical ceiling of this model.
    const top = Math.max(0.40, ...list.map((d) => d.probability)) * 1.05;

    const row = el('div', 'da-row');
    list.forEach((d) => {
      const cell = el('div', 'da-cell');
      cell.appendChild(el('div', 'da-day', dayNoMonth(d.target_date)));
      const track = el('div', 'da-track');
      const fill = el('div', 'da-fill');
      fill.style.height = Math.round(d.probability / top * 100) + '%';
      fill.style.background = S.dailyColor(d.probability, cl);
      track.appendChild(fill);
      if (isNum(cl)) {
        const line = el('div', 'da-clim');
        line.style.bottom = Math.round(cl / top * 100) + '%';
        track.appendChild(line);
      }
      cell.appendChild(track);
      const v = el('div', 'da-val', pct(d.probability));
      v.style.color = S.dailyColor(d.probability, cl);
      cell.appendChild(v);
      cell.title = d.target_date + ' : ' + pct(d.probability)
        + '% (daily normal ' + (isNum(cl) ? pct(cl) : '?') + '%)'
        + ', forecast at d+' + d.best_lead;
      row.appendChild(cell);
    });
    host.appendChild(row);
    const note = el('p', 'fig-note');
    note.textContent = 'Per-day probability (daily model), '
      + 'line = normal ' + (isNum(cl) ? pct(cl) + '%' : '')
      + '. Not comparable with the window figure above: different '
      + 'question, different normal.';
    host.appendChild(note);
  }

  /* The season axis, now driven by the DAILY model.
   *
   * It used to draw the window probability attributed to each covered day,
   * and that attribution inverted the season's own story: 8-10 October read
   * 43-70 % while nothing arrived, and the peak landed on the 11th when the
   * fall came on the 12th. The daily model puts 8-10 October at 9-13 % and
   * lifts the 11th and 12th together to 35 %.
   *
   * Scale: bars are measured against a fixed daily ceiling rather than 0-100,
   * because this model's practical range is roughly 0-40 % and a 0-100 axis
   * would flatten every day into the floor. The climatology line is drawn on
   * every bar, so "above normal" stays readable whatever the ceiling.
   *
   * A day with no daily row -- cycles published before v6 existed -- falls
   * back to the window figure and SAYS SO in its tooltip, rather than
   * silently mixing two quantities on one axis.
   */
  function renderSeason(series, activeDate, onSelect, observed, daily,
                        observedFlores) {
    const host = byId('season');
    if (!host) return;
    clear(host);
    const days = buildDayIndex(series);
    const dly = {};
    (daily || []).forEach((d) => { if (d && d.target_date) dly[d.target_date] = d; });
    const obs = {};
    (observed || []).forEach((o) => { if (o && o.date) obs[o.date] = o; });
    /* Flores, 25 km south, under the same weather and watched by the
     * observer himself. It carries no forecast -- there is no model for it --
     * but its arrivals are independent evidence about the same flow: on
     * 12 October it logged a Red-eyed Vireo the same day Corvo had its
     * four-bird fall, on the same west wind. Two islands, two detections,
     * one airstream. */
    const obsF = {};
    (observedFlores || []).forEach((o) => { if (o && o.date) obsF[o.date] = o; });
    const hasFlores = Object.keys(obsF).length > 0;
    const keys = [...days.keys()].sort();
    if (!keys.length) {
      host.appendChild(el('p', 'hint', 'No forecast windows yet.'));
      seasonLegend(false);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    let lastMonth = null;
    // Ceiling for the daily axis: never below 0.40, so one exceptional day
    // cannot squash a quiet week into the baseline.
    const dvals = keys.map((k) => dly[k] && dly[k].probability).filter(isNum);
    const dTop = Math.max(0.40, ...(dvals.length ? dvals : [0.40])) * 1.05;
    const dClim = (() => {
      for (const k of keys) if (dly[k] && isNum(dly[k].climatology)) return dly[k].climatology;
      return null;
    })();

    keys.forEach((key) => {
      const covering = days.get(key);
      const latest = covering[0];
      const dd = dly[key];
      const isDaily = !!(dd && isNum(dd.probability));

      // Daily where we have it, window attribution otherwise. The two are
      // scaled differently because they ARE different quantities.
      const p  = isDaily ? dd.probability : latest.probability;
      const lo = isDaily ? (isNum(dd.p_min) ? dd.p_min : p)
                         : Math.min(...covering.map((c) => c.probability));
      const hi = isDaily ? (isNum(dd.p_max) ? dd.p_max : p)
                         : Math.max(...covering.map((c) => c.probability));
      const nCyc = isDaily ? (dd.n_cycles || 1) : covering.length;
      const clim = isDaily ? dd.climatology : latest.climatology;
      const scale = (v) => cssPct(isDaily ? Math.min(1, v / dTop) : v);

      const bar = el('div', 'day-bar');
      if (!isDaily) bar.classList.add('is-window-fallback');
      const track = el('div', 'sb-track');

      const fill = el('div', 'sb-fill');
      fill.style.height = scale(p);
      // Daily bands where the figure is daily, window bands where it is not:
      // the same colour must not mean two different things on one axis.
      fill.style.background = isDaily ? S.dailyColor(p, clim) : S.BLUE[400];
      track.appendChild(fill);

      // How far this day's forecast travelled across the cycles that saw it.
      if (nCyc > 1 && hi - lo > 0.015) {
        const rng = el('div', 'sb-range');
        rng.style.bottom = scale(lo);
        rng.style.height = scale(hi - lo);
        rng.style.background = S.BLUE[100];     // pale: must read ON the fill
        track.appendChild(rng);
      }
      if (isNum(clim)) {
        const cl = el('div', 'sb-clim');
        cl.style.bottom = scale(clim);
        track.appendChild(cl);
      }
      if (key === today) bar.classList.add('is-today');
      if (key > today) bar.classList.add('is-future');

      const d = utc(key);
      bar.title =
        dayMonth(key) + ' — ' + pct(p) + ' %'
        + (isNum(clim) ? ' (normal ' + pct(clim) + '%)' : '')
        + (isDaily
            ? '\nP(this day reaches 3 new Nearctic landbirds), daily model'
              + ' — ' + S.dailyBand(p, clim)
              + (isNum(clim) && clim > 0 ? ' (×' + (p / clim).toFixed(1)
                                            + ' normal)' : '')
              + ', forecast at d+' + (dd.best_lead || '?')
            : '\nNo daily model for this cycle: the WINDOW probability for '
              + shortDate(latest.window_start) + '–'
              + shortDate(latest.window_end) + ', attributed to this day')
        + '\n' + nCyc + ' cycle(s) covered this day'
        + (nCyc > 1 && hi - lo > 0.005
            ? ', from ' + pct(lo) + ' to ' + pct(hi) + '%' : '');

      bar.appendChild(track);

      /* What actually happened that day, under the forecast for it.
       *
       * The model's target is "at least 3 new Nearctic landbirds", so the
       * strip has to distinguish four states, not two: the threshold was
       * met, some birds arrived but fewer than three, nothing arrived AND
       * coverage was good enough for that to mean something, or nothing can
       * be concluded. The last two look identical in a raw count and are
       * opposite in evidential value -- a zero from a day nobody could bird
       * is not a zero. */
      const o = obs[key];
      const sc = el('div', 'sb-obs');
      if (!o || o.new_landbirds_min === null || o.new_landbirds_min === undefined) {
        sc.classList.add('no-label');
        sc.textContent = '\u00b7';
        sc.title = dayMonth(key) + ' — not labelled yet';
      } else {
        const n = o.new_landbirds_min;
        const reliable = !!o.zero_reliable
          || (isNum(o.effort_score) && o.effort_score >= 0.70);
        sc.textContent = String(n);
        if (n >= 3) sc.classList.add('event');
        else if (n > 0) sc.classList.add('some');
        else if (reliable) sc.classList.add('zero');
        else sc.classList.add('weak');
        sc.title = dayMonth(key) + ' — ' + n + ' new Nearctic landbird(s)'
          + (isNum(o.new_landbirds_best) && o.new_landbirds_best !== n
             ? ' (up to ' + o.new_landbirds_best + ')' : '')
          + '\nstatus ' + (o.status || '?')
          + ', effort ' + (isNum(o.effort_score) ? o.effort_score.toFixed(2) : '?')
          + (reliable ? '' : ' — below 0.70, this zero proves nothing')
          + (o.species_new ? '\n' + o.species_new : '');
      }
      bar.appendChild(sc);

      // Flores sits directly under Corvo's cell, so the two islands are read
      // on one vertical. A day Flores never covered stays blank rather than
      // drawing a zero, which would claim an absence nobody checked.
      if (hasFlores) {
        const fo = obsF[key];
        // Classe distincte, pas 'sb-obs' : une cellule Flores n'est pas une
        // cellule Corvo, et les confondre fausserait tout comptage.
        const fc = el('div', 'sb-flores');
        if (!fo || fo.new_landbirds_min === null
            || fo.new_landbirds_min === undefined) {
          fc.classList.add('absent');
          fc.textContent = '\u00a0';
          fc.title = dayMonth(key) + ' — Flores: no record';
        } else {
          const n = fo.new_landbirds_min;
          const rel = !!fo.zero_reliable
            || (isNum(fo.effort_score) && fo.effort_score >= 0.70);
          fc.textContent = String(n);
          if (n >= 3) fc.classList.add('event');
          else if (n > 0) fc.classList.add('some');
          else if (rel) fc.classList.add('zero');
          else fc.classList.add('weak');
          fc.title = dayMonth(key) + ' — Flores: ' + n
            + ' new Nearctic landbird(s)'
            + (fo.species_new ? '\n' + fo.species_new : '')
            + '\neffort ' + (isNum(fo.effort_score)
                              ? fo.effort_score.toFixed(2) : '?');
        }
        bar.appendChild(fc);
      }

      bar.appendChild(el('div', 'sb-day', String(d ? d.getUTCDate() : '?')));
      const mon = monShort(key);
      bar.appendChild(el('div', 'sb-mon', mon && mon !== lastMonth ? mon : '\u00a0'));
      if (mon) lastMonth = mon;

      // The active cycle covers four days, so ringing each of them would make
      // one selection look like four. Underline the span instead, and keep a
      // single ring for the day the window opens.
      if (latest.issue_date === activeDate) {
        bar.classList.add('in-window');
        if (key === latest.window_start) bar.classList.add('active');
      }
      bar.tabIndex = 0;
      bar.setAttribute('role', 'button');
      bar.setAttribute('aria-label', bar.title);
      if (typeof onSelect === 'function') {
        // The clicked DAY travels with the run id. Without it the hero's
        // daily figure has no way to know which day was selected and
        // silently stays on today while everything else moves back.
        const pick = () => onSelect(latest.issue_date, key);
        bar.addEventListener('click', pick);
        bar.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
            ev.preventDefault(); pick();
          }
        });
      }
      host.appendChild(bar);
    });
    seasonLegend(hasFlores);
  }

  function seasonLegend(withFlores) {
    const host = byId('season-legend');
    if (!host) return;
    clear(host);

    // The bands, in the order a reader meets them on the bars.
    // Bands are multiples of the DAILY normal, not of 100 %. Their observed
    // event rates, out of sample, are printed in the note below.
    const r1 = el('div', 'legend-row');
    r1.appendChild(el('span', 'legend-title', 'Daily probability'));
    swatch(r1, S.STATUS.critical, 'below 0.75× normal');
    swatch(r1, S.STATUS.warning, '0.75 to 1.5×');
    swatch(r1, S.STATUS.good, 'above 1.5×');
    swatch(r1, S.BLUE[100], 'spread across cycles', 'sb-range-sw');
    swatch(r1, S.INK.secondary, 'daily normal', 'sb-clim-sw');
    host.appendChild(r1);

    const r2 = el('div', 'legend-row');
    r2.appendChild(el('span', 'legend-title', 'Observed at Corvo (under the bar)'));
    swatch(r2, S.BLUE[400], '3+ : threshold met', 'obs-event');
    swatch(r2, S.BLUE[600], '1–2 arrivals');
    swatch(r2, S.INK.grid, '0, coverage sufficient');
    swatch(r2, S.INK.grid, '0 but effort < 0.70 : proves nothing', 'obs-weak');
    host.appendChild(r2);

    // Explicit flag rather than sniffing the DOM: the row is only legended
    // when it was actually drawn.
    if (withFlores) {
      const r3 = el('div', 'legend-row');
      r3.appendChild(el('span', 'legend-title', 'Flores (second row)'));
      r3.appendChild(el('span', 'hint',
        'same codes; a blank cell is a day not covered, not a zero. '
        + 'Flores has no model, only observations — and they are the most '
        + 'reliable records in the project.'));
      host.appendChild(r3);
    }

    const note = el('div', 'legend-note');
    note.textContent =
      'Each bar is one day, and its height is P(that day reaches 3 new '
      + 'Nearctic landbirds) from the daily model — not the 4-day window '
      + 'forecast, which could not tell the days apart. The line marks the '
      + 'daily normal of 16.3%, and the scale tops out at 40%: this model '
      + 'practically never goes higher. Four cycles see each day, and the '
      + 'spread mark shows how far their answers moved. Cycles older than the '
      + 'daily model keep their window figure, and their tooltip says so.'
      + '\n\nThe three colour bands are multiples of that normal, and they '
      + 'separate genuinely different days: out of sample over 2005-2024 the '
      + 'threshold is met 8.4% of the time in the low band, 17.9% in the '
      + 'middle and 28.5% in the high one. There is no fourth band because it '
      + 'would not be monotone — the days this model ranks highest meet the '
      + 'threshold less often than the band just below them.';
    host.appendChild(note);
  }


  /* ---------- skill: the registered validation record and its caveat ---------- */
  const SINGLE_MEMBER_NOTE =
    'The model is single-member (c00) by design: a 5-member ensemble scored worse.';
  function renderSkill(fc) {
    fc = fc || {};
    const host = byId('skill');
    const sk = fc.skill;
    if (host) {
      clear(host);
      if (!sk) {
        host.appendChild(el('div', 'muted',
          'No validation record is registered for this model.'));
      } else {
        if (isNum(sk.auc)) host.appendChild(metric('AUC', sk.auc.toFixed(3), sk.protocol_label || null));
        if (isNum(sk.bss)) host.appendChild(metric('Brier skill score', sgn3(sk.bss), 'vs climatology'));
        if (isNum(sk.brier)) host.appendChild(metric('Brier score', sk.brier.toFixed(3),
          isNum(sk.brier_clim) ? 'climatology ' + sk.brier_clim.toFixed(3) : null));
        if (isNum(sk.n)) host.appendChild(metric('Forecasts scored', thou(sk.n), sk.bootstrap || null));
        if (Array.isArray(sk.bss_ci) && isNum(sk.bss_ci[0]) && isNum(sk.bss_ci[1])) {
          host.appendChild(metric('BSS 95% interval',
            sgn3(sk.bss_ci[0]) + ' to ' + sgn3(sk.bss_ci[1]),
            isNum(sk.p_better)
              ? 'P(better than climatology) ' + (sk.p_better * 100).toFixed(1) + '%' : null));
        }
        const cav = el('div', 'caveat');
        if (sk.caveat) cav.appendChild(el('p', '', sk.caveat));
        cav.appendChild(el('p', '', SINGLE_MEMBER_NOTE));
        host.appendChild(cav);
      }
    }
    renderProv(fc);
  }

  /* ---------- provenance rows: exactly what built this number ---------- */
  function renderProv(fc) {
    const host = byId('prov');
    if (!host) return;
    clear(host);
    const m = fc.model || {}, p = fc.provenance || {}, sk = fc.skill || {};
    [['Model', m.id],
     ['Training years', m.train_years],
     ['Frozen spec', m.frozen_doc],
     ['Protocol', m.protocol || sk.protocol_label],
     ['GEFS cycle', p.gefs_cycle],
     ['Build status', p.build_status],
     ['Code commit', p.code_commit],
     ['Bundle sha256', p.bundle_sha256],
     ['Computed at', p.computed_at],
    ].forEach((kv) => {
      if (kv[1] === null || kv[1] === undefined || kv[1] === '') return;
      const r = el('div', 'prov-row');
      r.appendChild(el('span', 'prov-k', kv[0]));
      r.appendChild(el('span', 'prov-v', kv[1]));
      host.appendChild(r);
    });
  }

  /* ---------- header + footer: which cycle, how old, how much data ---------- */
  function renderBar(fc, status) {
    fc = fc || {};
    const meta = byId('bar-meta');
    if (meta) {
      clear(meta);
      const p = fc.provenance || {}, fr = fc.freshness || {}, m = fc.model || {};
      const bits = [];
      const cyc = utc(p.gefs_cycle);
      if (cyc) {
        bits.push('GEFS ' + String(cyc.getUTCHours()).padStart(2, '0') + 'Z '
          + cyc.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
      } else if (fc.issue_date) {
        bits.push('Cycle ' + (shortDate(fc.issue_date) || fc.issue_date));
      }
      if (m.member) bits.push(String(m.member));
      if (isNum(fr.cycle_age_hours)) bits.push(Math.round(fr.cycle_age_hours) + 'h old');
      meta.appendChild(document.createTextNode(bits.join(' \u00b7 ')));
      if (fr.stale === true) {
        const w = el('span', 'stale', 'stale \u2014 this cycle is over 36 h old');
        w.title = 'No fresher GEFS cycle has been ingested, so this forecast may not '
          + 'reflect current weather.';
        meta.appendChild(document.createTextNode(' '));
        meta.appendChild(w);
      }
    }
    const foot = byId('foot');
    if (foot) {
      clear(foot);
      const st = status || {};
      const bits = [];
      if (isNum(st.runs_current)) {
        bits.push(thou(st.runs_current) + ' cycle' + (st.runs_current === 1 ? '' : 's'));
      }
      if (isNum(st.wind_frames)) bits.push(thou(st.wind_frames) + ' wind frames');
      if (isNum(st.corridor_points)) bits.push(thou(st.corridor_points) + ' corridor points');
      foot.textContent = bits.length ? bits.join(' \u00b7 ') : 'Provenance unavailable.';
    }
  }

  /* ---------- verification note: say plainly what has and has not been scored ---------- */
  const EFFORT_NOTE = 'A day with insufficient observer effort is recorded as '
    + 'unverifiable, never as a miss.';
  function renderVerifNote(series) {
    const host = byId('verif-note');
    if (!host) return;
    clear(host);
    const rows = (Array.isArray(series) ? series : []).filter(Boolean);
    const total = rows.length;
    if (!total) {
      host.textContent = 'No issued forecasts are registered for this season yet. ' + EFFORT_NOTE;
      return;
    }
    let scored = 0, hits = 0, open = 0, noLabel = 0, weakEffort = 0, other = 0;
    rows.forEach((e) => {
      const o = e.outcome;
      if (o && o !== 'pending' && o !== 'unverifiable') {
        scored += 1;
        if (o === 'hit') hits += 1;
        return;
      }
      const why = e.unverifiable_reason;
      if (why === 'window_open') open += 1;
      else if (why === 'no_label') noLabel += 1;
      // The commonest reason by far, and the one worth naming: the window
      // held no qualifying day, but some day in it was birded too thinly for
      // that absence to count as evidence.
      else if (why === 'zero_not_reliable') weakEffort += 1;
      else other += 1;
    });
    const parts = [];
    if (open) parts.push(open + (open === 1 ? ' window is' : ' windows are') + ' still open');
    if (noLabel) parts.push(noLabel + (noLabel === 1 ? ' is' : ' are') + ' awaiting curated labels');
    if (weakEffort) parts.push(weakEffort + ' had a day birded too thinly for its '
      + 'absence to count');
    if (other) parts.push(other + ' ' + (other === 1 ? 'has' : 'have')
      + ' no recorded verification reason');
    const breakdown = !parts.length ? ''
      : parts.length === 1 ? parts[0]
      : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    let sentence;
    if (scored === 0) {
      sentence = 'None of these ' + total + ' forecasts has been scored yet'
        + (breakdown ? ': ' + breakdown + '.' : '.');
    } else if (scored === total) {
      sentence = 'All ' + total + ' of these forecasts have been scored.';
    } else {
      sentence = scored + ' of ' + total + ' forecasts '
        + (scored === 1 ? 'has' : 'have') + ' been scored so far — '
        + hits + ' window' + (hits === 1 ? '' : 's') + ' met the threshold, '
        + (scored - hits) + ' did not'
        + (breakdown ? '; of the rest, ' + breakdown + '.' : '.')
        + ' The skill figures above come from the sealed back-test, not from these '
        + 'cycles: every scored window here falls inside one or two arrival events, '
        + 'and adjacent days of one arrival are not independent.';
    }
    host.textContent = sentence + ' ' + EFFORT_NOTE;
  }
  return {
    renderHero, renderToday, renderDaysAhead, renderStrip, renderSeason,
    renderSkill,
    renderBar, renderVerifNote, stripLegend, seasonLegend,
  };
})();