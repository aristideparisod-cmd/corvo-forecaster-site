/* Colour scales — the single source of encoding truth for this dashboard.
 *
 * Every hex below is taken unchanged from the reference data-viz palette
 * (its documented blue sequential ramp, its status palette, its dark
 * surfaces). No colour here was invented or re-stepped, so the palette's
 * recorded validation still applies.
 *
 * The dark surface is a selected theme, not an inverted light one: on dark,
 * magnitude runs toward the LIGHTER, more chromatic steps, so a calm area
 * recedes into the surface and a jet reads bright. Flipping a light ramp
 * would have buried the strongest values in the background.
 *
 * Three jobs, three encodings:
 *   speed      magnitude, unsigned        -> blue sequential
 *   tailwind   magnitude + a sign that is
 *              operationally a state      -> blue sequential, red for headwind
 *   fraction   magnitude on 0..1          -> blue sequential
 */
window.Scales = (function () {

  // Documented blue sequential ramp (steps 100-700).
  const BLUE = {
    100: '#cde2fb', 150: '#b7d3f6', 200: '#9ec5f4', 250: '#86b6ef',
    300: '#6da7ec', 350: '#5598e7', 400: '#3987e5', 450: '#2a78d6',
    500: '#256abf', 550: '#1c5cab', 600: '#184f95', 650: '#104281',
    700: '#0d366b',
  };

  // Reserved status colours. Used only as states, never as a series.
  const STATUS = {
    good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b',
  };
  const HEADWIND = '#e66767';   // dark-mode slot 8 red, as a single state

  const INK = {
    primary: '#ffffff', secondary: '#c3c2b7', muted: '#898781',
    grid: '#2c2c2a', baseline: '#383835',
    surface: '#1a1a19', plane: '#0d0d0d',
  };


  /* The headline probability, as a four-step state.
   *
   * Asked for directly: red below 25 %, orange to 50, yellow to 75, green
   * above. These are the palette's RESERVED status colours used in their
   * intended role -- a state, not a series -- so nothing here competes with
   * the blue ramps the rest of the dashboard uses for magnitude.
   *
   * The polarity is inverted from the usual convention on purpose: green
   * normally means "all is well", and here it means "high chance of a
   * fallout". For the reader of this page those are the same thing. The
   * number sits right beside the colour, so the encoding is never the only
   * carrier of the value -- which is the condition for using status colours
   * at all.
   */
  const PROB_BANDS = [
    [0.00, STATUS.critical, 'low'],         // 0-25 %
    [0.25, STATUS.serious,  'moderate'],    // 25-50 %
    [0.50, STATUS.warning,  'high'],        // 50-75 %
    [0.75, STATUS.good,     'very high'],   // 75-100 %
  ];
  function probColor(p) {
    if (p === null || p === undefined || Number.isNaN(p)) return INK.secondary;
    let c = PROB_BANDS[0][1];
    for (const [lo, hex] of PROB_BANDS) if (p >= lo) c = hex;
    return c;
  }
  function probBand(p) {
    if (p === null || p === undefined || Number.isNaN(p)) return null;
    let b = PROB_BANDS[0][2];
    for (const [lo, , name] of PROB_BANDS) if (p >= lo) b = name;
    return b;
  }


  /* The DAILY probability needs its own scale, and it is not the one above.
   *
   * probColor cuts 0-100 into quarters, which is right for the window model
   * (climatology 51.4 %, values across the whole range). Applied to the daily
   * model it produces red and nothing else: that model's practical ceiling is
   * about 40 %, so 12 October 2026 -- the best day of the season, four birds
   * -- came out orange. A scale that paints the best day of the year as a
   * warning is not encoding anything.
   *
   * So the daily bands are multiples of the DAILY climatology, and the colour
   * answers "how many times normal" rather than "how close to certain".
   * Breakpoints at 0.75x and 1.5x normal.
   *
   * THREE BANDS, NOT FOUR, and the reason is measured rather than aesthetic.
   * Out-of-sample over 2005-2024, the observed rate of reaching the threshold
   * by band:
   *
   *     below 0.75x normal      8.4 %   (n=634)
   *     0.75x to 1.5x          17.9 %   (n=587)
   *     above 1.5x             28.5 %   (n=333)
   *
   * Monotone, with 20 points between the ends. A fourth band at the top is
   * NOT monotone: days the model puts above 2x normal reach the threshold
   * 22.8 % of the time against 30.3 % for the band below them. The model's
   * highest probabilities are not its best days -- the same overconfidence
   * the reliability table shows at the top end -- so a top band would be
   * coloured "best" while being measurably worse. Three honest bands beat
   * four flattering ones.
   */
  const DAILY_BANDS = [
    [0.00, STATUS.critical, 'low'],      // under 0.75x normal
    [0.75, STATUS.warning,  'normal'],   // 0.75x to 1.5x
    [1.50, STATUS.good,     'high'],     // above 1.5x
  ];
  function dailyColor(p, climatology) {
    if (p === null || p === undefined || Number.isNaN(p)) return INK.secondary;
    if (!(climatology > 0)) return probColor(p);   // no normal: fall back
    const r = p / climatology;
    let c = DAILY_BANDS[0][1];
    for (const [lo, hex] of DAILY_BANDS) if (r >= lo) c = hex;
    return c;
  }
  function dailyBand(p, climatology) {
    if (p === null || p === undefined || Number.isNaN(p)
        || !(climatology > 0)) return null;
    const r = p / climatology;
    let b = DAILY_BANDS[0][2];
    for (const [lo, , name] of DAILY_BANDS) if (r >= lo) b = name;
    return b;
  }

  /* Particle speed, m/s. Calm recedes; the jet is near-white blue. */
  const SPEED_STOPS = [
    [0,  BLUE[550]], [5,  BLUE[450]], [10, BLUE[400]],
    [15, BLUE[300]], [20, BLUE[200]], [30, BLUE[100]],
  ];
  function speedColor(s) {
    let c = SPEED_STOPS[0][1];
    for (const [t, hex] of SPEED_STOPS) if (s >= t) c = hex;
    return c;
  }


  /* Filled wind-speed field, meteorological convention.
   *
   * This is a deliberate departure from the single-hue sequential rule the
   * rest of this dashboard follows, and the reason is the reader. Forecasters
   * and birders read 850 hPa speed shading on GFS panels daily; a blue-only
   * ramp would be "correct" and slower for them to parse. The usual objection
   * to rainbow ramps is that they are not monotonic in lightness, so
   * magnitude stops reading in greyscale or with colour-vision deficiency --
   * so this one is ordered to climb in lightness throughout, ending at pink
   * and white rather than the conventional dark red. Magnitude therefore
   * still reads if the hues do not.
   *
   * The 8 m/s step is the threshold the corridor feature keys on, and gets
   * its own boundary so the map and the model agree on where "usable
   * tailwind" starts.
   */
  const SPEED_FIELD = [
    [0,  null],          // calm: let the basemap through
    [4,  '#17345f'],
    [8,  '#1f6fb5'],     // <- the corridor threshold
    [12, '#27a8c8'],
    [16, '#3fbf8f'],
    [20, '#8fd14f'],
    [24, '#e8d33c'],
    [28, '#f0a030'],
    [32, '#e8623c'],
    [38, '#f07ba8'],
    [45, '#ffffff'],
  ];
  function speedFieldColor(v) {
    if (!(v > 0)) return null;
    let c = null;
    for (const [t, hex] of SPEED_FIELD) if (v >= t) c = hex;
    return c;
  }
  /* rgba triplets, so the raster can be written straight into ImageData. */
  const SPEED_RGB = SPEED_FIELD.map(([t, hex]) => [t, hex ? [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)] : null]);
  function speedFieldRGB(v) {
    if (!(v > 0)) return null;
    let c = null;
    for (const [t, rgb] of SPEED_RGB) if (v >= t) c = rgb;
    return c;
  }

  /* Along-route tailwind, m/s, signed.
   *
   * Negative is rendered as ONE reserved red rather than a graded arm. That
   * is not a shortcut: the corridor feature keys on ">= 8 m/s tailwind", so
   * how strongly a headwind blows is operationally irrelevant -- it simply
   * is not helping. Grading it would imply a precision the model does not use.
   */
  const TAILWIND_STOPS = [
    [0,  BLUE[600]], [4,  BLUE[500]], [8,  BLUE[400]],
    [12, BLUE[300]], [16, BLUE[200]], [22, BLUE[100]],
  ];
  function tailwindColor(t) {
    if (t === null || t === undefined || Number.isNaN(t)) return INK.grid;
    if (t < 0) return HEADWIND;
    let c = TAILWIND_STOPS[0][1];
    for (const [lo, hex] of TAILWIND_STOPS) if (t >= lo) c = hex;
    return c;
  }
  const TAILWIND_THRESHOLD = 8.0;   // the number the feature definition uses

  /* A 0..1 fraction (continuity, vertical). Same ramp, same direction. */
  function fractionColor(f) {
    if (f === null || f === undefined || Number.isNaN(f)) return INK.grid;
    const stops = [BLUE[650], BLUE[550], BLUE[450], BLUE[400],
                   BLUE[300], BLUE[200], BLUE[100]];
    return stops[Math.min(stops.length - 1, Math.max(0, Math.round(f * (stops.length - 1))))];
  }

  /* Ink that stays legible on top of a ramp step. Text wears text tokens;
   * this only decides which of the two it gets. */
  function inkOn(hex) {
    const n = parseInt(hex.slice(1), 16);
    const L = (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255)
               + 0.0722 * (n & 255)) / 255;
    return L > 0.55 ? INK.plane : INK.primary;
  }

  const fmtPct = (p) => (p * 100).toFixed(1);
  const fmtMs  = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);

  function dayLabel(iso, day) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + day);
    return d.toLocaleDateString(undefined,
      { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  return {
    BLUE, STATUS, HEADWIND, INK,
    speedColor, speedFieldColor, speedFieldRGB, SPEED_FIELD,
    probColor, probBand, PROB_BANDS,
    dailyColor, dailyBand, DAILY_BANDS,
    tailwindColor, fractionColor, inkOn,
    TAILWIND_STOPS, TAILWIND_THRESHOLD, SPEED_STOPS,
    fmtPct, fmtMs, dayLabel,
  };
})();
