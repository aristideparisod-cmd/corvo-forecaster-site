/* The historical record: 2005-2026, by season, by day, and by calendar date.
 *
 * Three views over one dataset, each answering a different question:
 *
 *   seasons   — which autumns were good, and how much of each is documented.
 *               Coverage runs from 7 days (2007) to 37 (2024), so the second
 *               number matters as much as the first: a thin season may be a
 *               quiet one or an unwatched one, and the bars say which.
 *   calendar  — September and October of one year, day by day. Click a day
 *               and it tells you what was found.
 *   on this date — the same calendar day across every documented year. The
 *               question a birder standing on Corvo actually asks: what has a
 *               13 October ever produced?
 *
 * Two species fields, never merged: `species_new` is what ARRIVED,
 * `species_present` is what was on the island without arriving ("still",
 * "relocated", "continuing"). The second is rendered in outline chips
 * under its own heading. Only the first feeds a count or the model.
 *
 * Years with no row are absent, never zero. Nobody recording is not the same
 * as nothing arriving, and the whole value of this record depends on not
 * blurring the two.
 */
window.History = (function () {
  'use strict';

  const S = window.Scales;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul',
                  'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function el(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined) n.textContent = txt;
    return n;
  }
  const clear = (n) => { while (n && n.firstChild) n.removeChild(n.firstChild); };
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* Species arrive as free text with ';' or ',' separators and counts baked
   * into the name ("Red-eyed Vireo x2"), because that is how they were
   * recorded. Split them for display but never try to parse the counts out:
   * the min/best columns are the counted quantity, these are the names. */
  function splitSpecies(txt) {
    if (!txt) return [];
    return String(txt).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  }


  /* Says when a species list names fewer birds than the count.
   *
   * The two come from different places and were never required to agree. 17
   * October 2018 reads 20 with two species named, because the count is a
   * stated total from a blog summary -- "37 present; 20 explicitly new
   * findings" -- while the list holds only the birds that summary named.
   * Showing the chips alone invites the reader to think two birds arrived.
   *
   * Neither number is wrong and neither is dropped: the count is the record,
   * the list is what the source chose to name, and the gap is stated. */
  function partialNote(d) {
    if (!d || !d.species_list_partial) return null;
    const n = el('span', 'sp-partial',
      d.species_named + ' of ' + d.new_landbirds_min + ' named');
    n.title = 'The count comes from the source\u2019s own total; the list '
      + 'holds only the species it named. The other '
      + (d.new_landbirds_min - d.species_named) + ' went unrecorded.';
    return n;
  }

  /* One day's severity, matching the forecast strip's four states. */
  function dayClass(d) {
    if (!d || d.new_landbirds_min === null || d.new_landbirds_min === undefined) {
      return 'no-label';
    }
    const n = d.new_landbirds_min;
    const reliable = !!d.zero_reliable
      || (isNum(d.effort_score) && d.effort_score >= 0.70);
    if (n >= 3) return 'event';
    if (n > 0) return 'some';
    return reliable ? 'zero' : 'weak';
  }

  function dayTitle(d) {
    const n = d.new_landbirds_min;
    const parts = [d.date + ' — ' + (n === null || n === undefined ? '?' : n)
                   + ' new Nearctic landbird(s)'];
    if (isNum(d.new_landbirds_best) && d.new_landbirds_best !== n) {
      parts[0] += ' (up to ' + d.new_landbirds_best + ')';
    }
    parts.push('status ' + (d.status || '?')
      + ', effort ' + (isNum(d.effort_score) ? d.effort_score.toFixed(2) : '?'));
    if (d.species_new) parts.push(d.species_new);
    if (d.species_present) parts.push('present: ' + d.species_present);
    if (d.audit_flag) parts.push('⚠ ' + d.audit_flag);
    if (d.source_primary) parts.push('source: ' + d.source_primary);
    return parts.join('\n');
  }

  /* ------------------------------------------------------- seasons bar */

  function renderSeasons(host, seasons, activeYear, onPick) {
    clear(host);
    const maxTotal = Math.max(1, ...seasons.map((s) => s.total_min || 0));
    seasons.forEach((s) => {
      const b = el('button', 'yr' + (s.year === activeYear ? ' active' : ''));
      b.type = 'button';
      const bar = el('div', 'yr-bar');
      const fill = el('div', 'yr-fill');
      fill.style.height = Math.round((s.total_min || 0) / maxTotal * 100) + '%';
      bar.appendChild(fill);
      b.appendChild(bar);
      b.appendChild(el('div', 'yr-y', String(s.year)));
      // How much of the autumn is on record, so a low bar is not misread.
      b.appendChild(el('div', 'yr-d', s.days + ' d'));
      b.title = `${s.year}: ${s.total_min} new Nearctic landbirds over `
        + `${s.days} documented days\n`
        + `best day ${s.best_day}, ${s.days_ge3} day(s) at the threshold of 3\n`
        + `${s.days_with_species} day(s) with species named\n`
        + `${s.first_date} → ${s.last_date}`;
      b.addEventListener('click', () => onPick(s.year));
      host.appendChild(b);
    });
  }

  /* ---------------------------------------------------- month calendar */

  function monthGrid(year, month, byDate) {
    const wrap = el('div', 'cal-month');
    wrap.appendChild(el('div', 'cal-title', MONTHS[month - 1] + ' ' + year));
    const grid = el('div', 'cal-grid');
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach((h) =>
      grid.appendChild(el('div', 'cal-dow', h)));

    const first = new Date(Date.UTC(year, month - 1, 1));
    // Monday-first, which is how a European birder reads a calendar.
    const lead = (first.getUTCDay() + 6) % 7;
    for (let i = 0; i < lead; i++) grid.appendChild(el('div', 'cal-pad'));

    const nDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= nDays; day++) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const d = byDate[iso];
      const cell = el('button', 'cal-day ' + (d ? dayClass(d) : 'absent'));
      cell.type = 'button';
      cell.appendChild(el('span', 'cal-n', String(day)));
      if (d && isNum(d.new_landbirds_min) && d.new_landbirds_min > 0) {
        cell.appendChild(el('span', 'cal-c', String(d.new_landbirds_min)));
      }
      if (d && d.species_new) cell.classList.add('has-sp');
      else if (d && d.species_present) cell.classList.add('has-pres');
      cell.title = d ? dayTitle(d) : iso + ' — no record for this day';
      if (d) cell.addEventListener('click', () => showDay(d));
      else cell.disabled = true;
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  let detailHost = null;

  function showDay(d) {
    if (!detailHost) return;
    clear(detailHost);
    detailHost.hidden = false;

    const head = el('div', 'dd-head');
    const dt = new Date(d.date + 'T00:00:00Z');
    head.appendChild(el('span', 'dd-date', dt.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'UTC' })));
    const n = d.new_landbirds_min;
    const badge = el('span', 'dd-n ' + dayClass(d),
      (n === null || n === undefined ? '?' : n) + ' nouveau'
      + (n === 1 ? '' : 'x'));
    head.appendChild(badge);
    detailHost.appendChild(head);

    const sp = splitSpecies(d.species_new);
    if (sp.length) {
      const list = el('div', 'dd-species');
      sp.forEach((name) => list.appendChild(el('span', 'dd-sp', name)));
      const pn = partialNote(d);
      if (pn) list.appendChild(pn);
      detailHost.appendChild(list);
    } else if (n > 0) {
      detailHost.appendChild(el('p', 'hint',
        'Count recorded; the source does not name the species.'));
    } else {
      detailHost.appendChild(el('p', 'hint',
        dayClass(d) === 'weak'
          ? 'No arrival recorded, but effort was insufficient: this zero proves nothing.'
          : 'No new arrival that day.'));
    }

    /* Birds present but not new -- "still", "relocated", "continuing". Shown
     * in their own block and in outline chips, because the one thing this
     * panel must never do is let a lingering bird read as an arrival. */
    const pres = splitSpecies(d.species_present);
    if (pres.length) {
      detailHost.appendChild(el('p', 'dd-sub',
        n > 0 ? 'Also present, not counted as new'
              : 'Present that day, no new arrival'));
      const pl = el('div', 'dd-species');
      pres.forEach((name) => pl.appendChild(el('span', 'dd-sp pres', name)));
      detailHost.appendChild(pl);
    }

    const meta = el('div', 'dd-meta');
    const add = (k, v) => { if (v !== null && v !== undefined && v !== '') {
      const r = el('span', 'dd-kv');
      r.appendChild(el('b', '', k));
      r.appendChild(document.createTextNode(' ' + v));
      meta.appendChild(r);
    } };
    add('statut', d.status);
    add('best', isNum(d.new_landbirds_best) ? d.new_landbirds_best : null);
    add('effort', isNum(d.effort_score) ? d.effort_score.toFixed(2) : null);
    add('source', d.source_primary);
    add('niveau', d.evidence_tier);
    detailHost.appendChild(meta);

    if (d.audit_flag) {
      // Surfaced, not hidden: these are the dates the two curations disagree
      // on, and the observer should see which rather than be handed a number.
      detailHost.appendChild(el('div', 'dd-flag', '⚠ ' + d.audit_flag));
    }
    if (d.notes) detailHost.appendChild(el('p', 'dd-notes', d.notes));
  }

  async function renderYear(host, detail, site, year) {
    detailHost = detail;
    clear(host);
    host.appendChild(el('p', 'hint', 'Chargement…'));
    let data;
    try {
      data = await window.API.season(site, year);
    } catch (e) {
      clear(host);
      host.appendChild(el('p', 'hint', 'No documented day for ' + year + '.'));
      return;
    }
    const byDate = {};
    (data.days || []).forEach((d) => { byDate[d.date] = d; });
    clear(host);
    [9, 10].forEach((m) => host.appendChild(monthGrid(year, m, byDate)));

    const sum = el('p', 'hint');
    sum.textContent = `${data.n} documented day(s) in ${year}, `
      + `${data.days_with_species} with species named.`;
    host.appendChild(sum);
    if (detail) { detail.hidden = true; clear(detail); }
  }

  /* --------------------------------------------------- on this date */

  async function renderOnThisDate(host, site, when) {
    clear(host);
    const d = when || new Date();
    const month = d.getMonth() + 1, day = d.getDate();
    let data;
    try {
      data = await window.API.onThisDate(site, month, day);
    } catch (e) {
      host.appendChild(el('p', 'hint', 'Record unavailable.'));
      return;
    }

    const head = el('div', 'otd-head');
    head.appendChild(el('h3', '', 'A ' + day + ' ' + MONTHS[month - 1]
      + ', historically'));
    const st = el('p', 'hint');
    st.textContent = data.years_documented
      ? `${data.years_documented} documented year(s) · median `
        + `${data.median_min} · record ${data.max_min} · `
        + `${data.years_at_threshold} year(s) at the threshold of 3`
      : 'No documented year for this date.';
    head.appendChild(st);
    host.appendChild(head);

    if (!data.records.length) return;

    const rows = el('div', 'otd-rows');
    data.records.forEach((r) => {
      const row = el('div', 'otd-row ' + dayClass(r));
      row.appendChild(el('span', 'otd-y', String(r.year)));
      const n = r.new_landbirds_min;
      row.appendChild(el('span', 'otd-n',
        (n === null || n === undefined) ? '?' : String(n)));
      const sp = splitSpecies(r.species_new);
      const names = el('span', 'otd-sp');
      if (sp.length) {
        sp.forEach((s) => names.appendChild(el('span', 'dd-sp', s)));
        const pn = partialNote(r);
        if (pn) names.appendChild(pn);
      } else if (r.species_present) {
        splitSpecies(r.species_present).forEach((x) =>
          names.appendChild(el('span', 'dd-sp pres', x)));
      } else {
        names.appendChild(el('span', 'hint',
          n > 0 ? 'species not detailed' : '—'));
      }
      row.appendChild(names);
      row.title = dayTitle(r);
      rows.appendChild(row);
    });
    host.appendChild(rows);

    const note = el('div', 'legend-note');
    note.textContent = 'Years with no row are absent, not zero: nobody was '
      + 'recording that day, which is not the same as nothing arriving. The '
      + 'median covers documented years only.';
    host.appendChild(note);
  }

  return { renderSeasons, renderYear, renderOnThisDate, showDay, splitSpecies };
})();
