// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: cyan; icon-glyph: plane;

/*
 * FlightBuddy widget for Scriptable (iOS / iPadOS)
 *
 * Sizes: small, medium, large, extra large (iPad) and the lock-screen
 * accessories (inline, rectangular, circular).
 *
 * Setup: FlightBuddy → Settings → Widget → "Copy script" fills in URL and token.
 * Alternatively paste a token (fbw_…) into the widget's "Parameter" field.
 * Appearance and visible fields are set in FlightBuddy and apply on the next
 * refresh — no need to paste the script again.
 */

const CONFIG = {
  url: "__FLIGHTBUDDY_URL__",
  token: "__FLIGHTBUDDY_TOKEN__",
  // null uses the setting from FlightBuddy; "auto", "dark" or "light" overrides it here.
  appearance: null,
};

const DEFAULT_OPTIONS = { appearance: "auto", showSeat: true, showTelemetry: true, nextFlights: 3, includeDaily: true };
let OPTIONS = Object.assign({}, DEFAULT_OPTIONS);
let APPEARANCE = CONFIG.appearance || "auto";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const FM = FileManager.local();
const CACHE_DIR = FM.joinPath(FM.cacheDirectory(), "flightbuddy");
if (!FM.fileExists(CACHE_DIR)) FM.createDirectory(CACHE_DIR, true);
const FEED_CACHE = FM.joinPath(CACHE_DIR, "feed.json");
const LOGO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function widgetToken() {
  const param = String(args.widgetParameter || "").trim();
  if (param.startsWith("fbw_")) return param;
  return CONFIG.token.startsWith("fbw_") ? CONFIG.token : "";
}

function baseUrl() {
  return CONFIG.url.includes("__FLIGHTBUDDY") ? "" : CONFIG.url.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

function col(light, dark, alpha) {
  const a = alpha == null ? 1 : alpha;
  if (APPEARANCE === "dark") return new Color(dark, a);
  if (APPEARANCE === "light") return new Color(light, a);
  return Color.dynamic(new Color(light, a), new Color(dark, a));
}

function palette() {
  return {
    bg: col("#F2F2F7", "#101318"),
    text: col("#000000", "#FFFFFF"),
    muted: col("#6C6C70", "#9A9DA3"),
    hairline: col("#000000", "#FFFFFF", 0.12),
    track: col("#000000", "#FFFFFF", 0.14),
    logoTile: new Color("#FFFFFF"),
    logoInitials: new Color("#3A3A3C"),
  };
}

let C = palette();

/** Applies the options delivered with the feed (FlightBuddy → Settings → Widget). */
function applyOptions(options) {
  OPTIONS = Object.assign({}, DEFAULT_OPTIONS, options || {});
  APPEARANCE = CONFIG.appearance || OPTIONS.appearance || "auto";
  C = palette();
}

const TONE = {
  live: ["#0077B6", "#3DDCFF"],
  ok: ["#248A3D", "#30D158"],
  warn: ["#C93400", "#FF9F0A"],
  bad: ["#D70015", "#FF453A"],
  neutral: ["#6C6C70", "#9A9DA3"],
};

function tone(name, alpha) {
  const pair = TONE[name] || TONE.neutral;
  return col(pair[0], pair[1], alpha);
}

// ---------------------------------------------------------------------------
// Localisation & formatting
// ---------------------------------------------------------------------------

const STRINGS = {
  de: {
    left: "noch {t}",
    departsIn: "Abflug in {t}",
    departs: "Abflug",
    arrives: "Ankunft",
    landedAt: "Gelandet {t}",
    altitude: "Höhe",
    remaining: "Restzeit",
    next: "Nächste Flüge",
    seat: "Sitz",
    gate: "Gate",
    asOf: "Stand {t}",
    offline: "Offline · Stand {t}",
    empty: "Keine anstehenden Flüge",
    emptyHint: "Füge in FlightBuddy einen Flug hinzu.",
    noSetup: "Widget einrichten",
    noSetupHint: "FlightBuddy → Einstellungen → Widget → Skript kopieren.",
    badToken: "Token ungültig",
    badTokenHint: "In FlightBuddy → Einstellungen → Widget neu erstellen.",
    network: "Keine Verbindung",
    min: "Min.",
    hours: "Std.",
    preview: "Vorschau",
    sizes: ["Klein", "Mittel", "Groß", "Extra groß (iPad)", "Sperrbildschirm rechteckig", "Sperrbildschirm rund", "Sperrbildschirm Zeile"],
    cancel: "Abbrechen",
  },
  en: {
    left: "{t} left",
    departsIn: "Departs in {t}",
    departs: "Departure",
    arrives: "Arrival",
    landedAt: "Landed {t}",
    altitude: "Altitude",
    remaining: "Remaining",
    next: "Next flights",
    seat: "Seat",
    gate: "Gate",
    asOf: "As of {t}",
    offline: "Offline · as of {t}",
    empty: "No upcoming flights",
    emptyHint: "Add a flight in FlightBuddy.",
    noSetup: "Set up the widget",
    noSetupHint: "FlightBuddy → Settings → Widget → Copy script.",
    badToken: "Invalid token",
    badTokenHint: "Create a new one in FlightBuddy → Settings → Widget.",
    network: "No connection",
    min: "min",
    hours: "h",
    preview: "Preview",
    sizes: ["Small", "Medium", "Large", "Extra large (iPad)", "Lock screen rectangular", "Lock screen circular", "Lock screen inline"],
    cancel: "Cancel",
  },
};

let LOCALE = String(Device.language() || "de").startsWith("de") ? "de" : "en";
let UNITS = "metric";

function s(key, vars) {
  let out = (STRINGS[LOCALE] || STRINGS.en)[key] || key;
  if (vars) for (const k of Object.keys(vars)) out = out.replace("{" + k + "}", vars[k]);
  return out;
}

function intlLocale() {
  return LOCALE === "de" ? "de-CH" : "en-GB";
}

function fmtTime(iso, timeZone) {
  if (!iso) return "—";
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat(intlLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timeZone || undefined,
    }).format(d);
  } catch (e) {
    const f = new DateFormatter();
    f.dateFormat = "HH:mm";
    return f.string(d);
  }
}

function fmtDayTime(iso, timeZone) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(intlLocale(), {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timeZone || undefined,
    }).format(new Date(iso));
  } catch (e) {
    return fmtTime(iso, timeZone);
  }
}

function fmtDuration(min) {
  if (min == null) return "—";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return m + " " + s("min");
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? h + " " + s("hours") + " " + rest + " " + s("min") : h + " " + s("hours");
}

function fmtNumber(n) {
  return new Intl.NumberFormat(intlLocale()).format(n);
}

function fmtAltitude(ft) {
  if (ft == null) return null;
  if (UNITS === "imperial") return fmtNumber(Math.round(ft / 100) * 100) + " ft";
  return fmtNumber(Math.round((ft * 0.3048) / 10) * 10) + " m";
}

function fmtSpeed(kts) {
  if (kts == null) return null;
  if (UNITS === "imperial") return fmtNumber(Math.round(kts)) + " kt";
  return fmtNumber(Math.round(kts * 1.852)) + " km/h";
}

function best(leg) {
  return leg.actual || leg.estimated || leg.scheduled;
}

/** Scheduled time when the best-known time differs from it by a minute or more. */
function originalTime(leg) {
  const b = best(leg);
  if (!b || !leg.scheduled) return null;
  return Math.abs(Date.parse(b) - Date.parse(leg.scheduled)) >= 60000 ? leg.scheduled : null;
}

function isLive(f) {
  return f.status === "EN_ROUTE" || f.status === "DEPARTED" || f.status === "BOARDING";
}

function isAirborne(f) {
  return f.status === "EN_ROUTE" || f.status === "DEPARTED";
}

/** Server progress; between refreshes a live flight is advanced along its schedule. */
function progressOf(f, feed) {
  let p = f.progress || 0;
  if (!isAirborne(f)) return Math.min(1, Math.max(0, p));
  const dep = Date.parse(best(f.departure) || "");
  const arr = Date.parse(best(f.arrival) || "");
  const age = Date.now() - Date.parse(feed.generatedAt);
  if (age > 60000 && dep && arr && arr > dep) {
    p = Math.max(p, (Date.now() - dep) / (arr - dep));
  }
  return Math.min(1, Math.max(0, p));
}

function remainingMin(f, feed) {
  const arr = Date.parse(best(f.arrival) || "");
  if (arr) return Math.max(0, (arr - Date.now()) / 60000);
  if (f.remainingMin == null) return null;
  const age = (Date.now() - Date.parse(feed.generatedAt)) / 60000;
  return Math.max(0, f.remainingMin - age);
}

/** One-line summary under the progress bar. */
function timeline(f, feed) {
  if (isAirborne(f)) return s("left", { t: fmtDuration(remainingMin(f, feed)) });
  if (f.status === "LANDED") return s("landedAt", { t: fmtTime(best(f.arrival), f.to.timeZone) });
  if (f.status === "CANCELLED" || f.status === "DIVERTED") return f.statusLabel;
  const dep = Date.parse(best(f.departure) || "");
  if (!dep) return f.statusLabel;
  const until = (dep - Date.now()) / 60000;
  if (until > 0 && until < 24 * 60) return s("departsIn", { t: fmtDuration(until) });
  return fmtDayTime(best(f.departure), f.from.timeZone);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadFeed() {
  const token = widgetToken();
  if (!baseUrl() || !token) return { error: "setup" };

  const req = new Request(baseUrl() + "/api/widget");
  req.headers = { Authorization: "Bearer " + token, Accept: "application/json" };
  req.timeoutInterval = 15;
  try {
    const json = await req.loadJSON();
    const status = req.response ? req.response.statusCode : 200;
    if (status === 401) return { error: "token" };
    if (status >= 400 || !json || !Array.isArray(json.flights)) throw new Error("HTTP " + status);
    FM.writeString(FEED_CACHE, JSON.stringify(json));
    return { feed: json, fresh: true };
  } catch (e) {
    if (FM.fileExists(FEED_CACHE)) {
      try {
        return { feed: JSON.parse(FM.readString(FEED_CACHE)), fresh: false };
      } catch (_) {
        // corrupt cache — fall through
      }
    }
    return { error: "network" };
  }
}

async function loadLogo(flight) {
  const url = flight.airline && flight.airline.logoUrl;
  const code = (flight.airline && flight.airline.iata) || "";
  if (!url || !code) return null;
  const file = FM.joinPath(CACHE_DIR, "logo-" + code.toUpperCase() + ".png");
  if (FM.fileExists(file) && Date.now() - FM.modificationDate(file).getTime() < LOGO_MAX_AGE_MS) {
    return FM.readImage(file);
  }
  try {
    const img = await new Request(url).loadImage();
    FM.writeImage(file, img);
    return img;
  } catch (e) {
    return FM.fileExists(file) ? FM.readImage(file) : null;
  }
}

async function loadLogos(flights) {
  const logos = {};
  await Promise.all(
    flights.map(async (f) => {
      logos[f.id] = await loadLogo(f);
    }),
  );
  return logos;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/** The FlightBuddy plane from the app icon, drawn as a template image. */
function planeGlyph(size) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const k = size / 368; // glyph box: x 96–464, y 128–360
  const ox = -96 * k;
  const oy = (size - 232 * k) / 2 - 128 * k;
  const P = (x, y) => new Point(ox + x * k, oy + y * k);
  const p = new Path();
  p.move(P(96, 280));
  p.addCurve(P(328, 128), P(184, 256), P(248, 192));
  p.addLine(P(376, 144));
  p.addLine(P(344, 216));
  p.addCurve(P(464, 264), P(392, 224), P(432, 240));
  p.addCurve(P(328, 272), P(424, 256), P(376, 256));
  p.addLine(P(288, 360));
  p.addLine(P(248, 336));
  p.addLine(P(272, 256));
  p.addCurve(P(96, 280), P(200, 288), P(144, 312));
  p.closeSubpath();
  ctx.addPath(p);
  ctx.setFillColor(Color.black());
  ctx.fillPath();
  return ctx.getImage();
}

function text(stack, value, font, color, opts) {
  const t = stack.addText(String(value));
  t.font = font;
  t.textColor = color || C.text;
  t.lineLimit = (opts && opts.lines) || 1;
  t.minimumScaleFactor = (opts && opts.scale) || 0.7;
  return t;
}

function hstack(parent, spacing) {
  const st = parent.addStack();
  st.layoutHorizontally();
  st.centerAlignContent();
  if (spacing != null) st.spacing = spacing;
  return st;
}

function vstack(parent, spacing) {
  const st = parent.addStack();
  st.layoutVertically();
  if (spacing != null) st.spacing = spacing;
  return st;
}

function logoTile(parent, flight, logos, size) {
  const tile = parent.addStack();
  tile.size = new Size(size, size);
  tile.cornerRadius = size * 0.24;
  tile.backgroundColor = C.logoTile;
  tile.centerAlignContent();
  const img = logos[flight.id];
  if (img) {
    const pad = Math.round(size * 0.08);
    tile.setPadding(pad, pad, pad, pad);
    const wi = tile.addImage(img);
    wi.imageSize = new Size(size - pad * 2, size - pad * 2);
    wi.applyFittingContentMode();
  } else {
    const initials = ((flight.airline && flight.airline.iata) || flight.flightNumber || "?").slice(0, 2);
    text(tile, initials, Font.boldSystemFont(size * 0.38), C.logoInitials);
  }
}

function statusPill(parent, f, fontSize) {
  const pill = parent.addStack();
  pill.setPadding(2, 7, 2, 7);
  pill.cornerRadius = 9;
  pill.backgroundColor = tone(f.tone, 0.16);
  text(pill, f.statusLabel, Font.semiboldSystemFont(fontSize || 11), tone(f.tone), { scale: 0.6 });
}

/** Progress bar built from stacks so light/dark colours stay dynamic. */
function progressBar(parent, progress, width, color, trackColor) {
  const glyph = 14;
  const row = hstack(parent, 1);
  const usable = width - glyph - 2;
  const filled = Math.round(usable * progress);
  const bar = (w, c) => {
    const seg = row.addStack();
    seg.size = new Size(Math.max(1, w), 4);
    seg.cornerRadius = 2;
    seg.backgroundColor = c;
  };
  if (filled > 0) bar(filled, color);
  const plane = row.addImage(planeGlyph(glyph * 2));
  plane.imageSize = new Size(glyph, glyph);
  plane.tintColor = color;
  if (usable - filled > 0) bar(usable - filled, trackColor);
  return row;
}

function timeWithOriginal(parent, leg, timeZone, size, align) {
  const row = hstack(parent, 4);
  if (align === "right") row.addSpacer();
  const late = originalTime(leg);
  const lateMinutes = late ? (Date.parse(best(leg)) - Date.parse(late)) / 60000 : 0;
  text(row, fmtTime(best(leg), timeZone), Font.semiboldMonospacedSystemFont(size), lateMinutes >= 15 ? tone("warn") : C.text);
  if (late) text(row, fmtTime(late, timeZone), Font.regularMonospacedSystemFont(size - 2), C.muted);
  if (align !== "right") row.addSpacer();
}

function footer(w, feed, fresh) {
  const t = fmtTime(feed.generatedAt);
  text(w, fresh ? s("asOf", { t: t }) : s("offline", { t: t }), Font.systemFont(9), fresh ? C.muted : tone("warn"));
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function header(parent, f, logos, logoSize, withPill, subtitle) {
  const row = hstack(parent, 8);
  logoTile(row, f, logos, logoSize);
  const titles = vstack(row, 0);
  text(titles, f.flightNumber, Font.semiboldSystemFont(logoSize >= 30 ? 16 : 14));
  if (subtitle) text(titles, subtitle, Font.systemFont(11), C.muted);
  row.addSpacer();
  if (withPill) statusPill(row, f);
  return row;
}

function subtitleOf(f, withRegistration) {
  const parts = [f.airline && f.airline.name, f.aircraftType];
  if (withRegistration) parts.push(f.registration);
  return parts.filter(Boolean).join(" · ");
}

function small(w, f, feed, logos) {
  header(w, f, logos, 24, false);
  w.addSpacer();
  const route = hstack(w);
  text(route, f.from.iata || "—", Font.boldSystemFont(22));
  route.addSpacer();
  text(route, f.to.iata || "—", Font.boldSystemFont(22));
  w.addSpacer(6);
  progressBar(w, progressOf(f, feed), 124, tone(f.tone), C.track);
  w.addSpacer(6);
  const bottom = hstack(w);
  text(bottom, f.statusLabel, Font.semiboldSystemFont(11), tone(f.tone), { scale: 0.6 });
  bottom.addSpacer(4);
  text(bottom, timeline(f, feed), Font.systemFont(11), C.muted, { scale: 0.6 });
}

function medium(w, f, feed, logos) {
  header(w, f, logos, 28, true, subtitleOf(f, false));
  w.addSpacer();

  const mid = hstack(w, 10);
  const dep = vstack(mid, 1);
  text(dep, f.from.iata || "—", Font.boldSystemFont(22));
  timeWithOriginal(dep, f.departure, f.from.timeZone, 12);

  const center = vstack(mid, 5);
  progressBar(center, progressOf(f, feed), 128, tone(f.tone), C.track);
  const caption = hstack(center);
  caption.addSpacer();
  text(caption, isAirborne(f) ? Math.round(progressOf(f, feed) * 100) + " % · " + timeline(f, feed) : timeline(f, feed), Font.systemFont(10), C.muted, { scale: 0.6 });
  caption.addSpacer();

  const arr = vstack(mid, 1);
  const arrTop = hstack(arr);
  arrTop.addSpacer();
  text(arrTop, f.to.iata || "—", Font.boldSystemFont(22));
  timeWithOriginal(arr, f.arrival, f.to.timeZone, 12, "right");

  w.addSpacer();
  const meta = [];
  if (f.departure.gate || f.departure.terminal) {
    meta.push([f.departure.gate && s("gate") + " " + f.departure.gate, f.departure.terminal && "T" + f.departure.terminal].filter(Boolean).join(" · "));
  }
  const tel = [fmtAltitude(f.altitudeFt), fmtSpeed(f.speedKts)].filter(Boolean).join(" · ");
  if (OPTIONS.showTelemetry && isAirborne(f) && tel) meta.push(tel);
  if (OPTIONS.showSeat && f.seat) meta.push(s("seat") + " " + f.seat);
  if (meta.length) {
    const row = hstack(w);
    meta.forEach((m, i) => {
      if (i > 0) row.addSpacer();
      text(row, m, Font.systemFont(11), C.muted, { scale: 0.6 });
    });
  }
}

function mainBlock(w, f, feed, logos, barWidth) {
  header(w, f, logos, 32, true, subtitleOf(f, true));
  w.addSpacer(10);

  const route = hstack(w);
  const dep = vstack(route, 0);
  text(dep, f.from.iata || "—", Font.boldSystemFont(30));
  if (f.from.city) text(dep, f.from.city, Font.systemFont(11), C.muted);
  route.addSpacer();
  const arr = vstack(route, 0);
  const arrIata = hstack(arr);
  arrIata.addSpacer();
  text(arrIata, f.to.iata || "—", Font.boldSystemFont(30));
  if (f.to.city) {
    const arrCity = hstack(arr);
    arrCity.addSpacer();
    text(arrCity, f.to.city, Font.systemFont(11), C.muted);
  }

  w.addSpacer(8);
  progressBar(w, progressOf(f, feed), barWidth, tone(f.tone), C.track);
  w.addSpacer(10);

  const grid = hstack(w);
  const left = vstack(grid, 6);
  grid.addSpacer();
  const right = vstack(grid, 6);

  const cell = (st, label, value, alignRight) => {
    const c = vstack(st, 0);
    const l = hstack(c);
    if (alignRight) l.addSpacer();
    text(l, label, Font.systemFont(10), C.muted);
    const v = hstack(c);
    if (alignRight) v.addSpacer();
    text(v, value, Font.semiboldSystemFont(12));
  };

  const depGate = [fmtTime(best(f.departure), f.from.timeZone), f.departure.gate && s("gate") + " " + f.departure.gate].filter(Boolean).join(" · ");
  const arrGate = [fmtTime(best(f.arrival), f.to.timeZone), f.arrival.terminal && "T" + f.arrival.terminal, f.arrival.gate && s("gate") + " " + f.arrival.gate].filter(Boolean).join(" · ");
  cell(left, s("departs"), depGate);
  cell(right, s("arrives"), arrGate, true);
  if (isAirborne(f)) {
    if (OPTIONS.showTelemetry) cell(left, s("altitude"), fmtAltitude(f.altitudeFt) || "—");
    else if (OPTIONS.showSeat && f.seat) cell(left, s("seat"), f.seat);
    cell(right, s("remaining"), fmtDuration(remainingMin(f, feed)), true);
  } else {
    cell(left, f.statusLabel, timeline(f, feed));
    if (OPTIONS.showSeat && f.seat) cell(right, s("seat"), f.seat, true);
  }
}

function nextList(w, flights, feed, logos, max) {
  const rest = flights.slice(0, max);
  if (!rest.length) return;
  text(w, s("next"), Font.semiboldSystemFont(11), C.muted);
  w.addSpacer(6);
  rest.forEach((f, i) => {
    if (i > 0) w.addSpacer(6);
    const row = hstack(w, 8);
    logoTile(row, f, logos, 20);
    text(row, f.flightNumber + " · " + (f.from.iata || "—") + " → " + (f.to.iata || "—"), Font.systemFont(12), C.text, { scale: 0.6 });
    row.addSpacer();
    const late = f.delayMinutes && f.delayMinutes >= 5;
    text(
      row,
      late ? "+" + f.delayMinutes + " " + s("min") : f.tone === "bad" ? f.statusLabel : fmtDayTime(best(f.departure), f.from.timeZone),
      Font.systemFont(12),
      late ? tone("warn") : f.tone === "bad" ? tone("bad") : C.muted,
    );
  });
}

function divider(w, width) {
  const line = w.addStack();
  line.size = new Size(width, 0.5);
  line.backgroundColor = C.hairline;
}

function large(w, flights, feed, logos, fresh) {
  mainBlock(w, flights[0], feed, logos, 296);
  if (flights.length > 1 && OPTIONS.nextFlights > 0) {
    w.addSpacer(12);
    divider(w, 296);
    w.addSpacer(8);
    nextList(w, flights.slice(1), feed, logos, OPTIONS.nextFlights);
  }
  w.addSpacer();
  footer(w, feed, fresh);
}

function extraLarge(w, flights, feed, logos, fresh) {
  const cols = hstack(w, 24);
  cols.topAlignContent();
  const left = vstack(cols, 0);
  left.size = new Size(320, 0);
  mainBlock(left, flights[0], feed, logos, 316);
  const right = vstack(cols, 0);
  if (flights.length > 1 && OPTIONS.nextFlights > 0) nextList(right, flights.slice(1), feed, logos, OPTIONS.nextFlights);
  w.addSpacer();
  footer(w, feed, fresh);
}

function accessoryRectangular(w, f, feed) {
  w.addAccessoryWidgetBackground = false;
  text(w, f.flightNumber + " " + (f.from.iata || "") + "→" + (f.to.iata || ""), Font.semiboldSystemFont(13));
  w.addSpacer(3);
  progressBar(w, progressOf(f, feed), 140, Color.white(), new Color("#FFFFFF", 0.3));
  w.addSpacer(3);
  const line = isAirborne(f)
    ? s("arrives") + " " + fmtTime(best(f.arrival), f.to.timeZone)
    : timeline(f, feed);
  text(w, line, Font.systemFont(12), Color.white());
}

function ring(progress, size) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const r = size / 2 - 3;
  const c = size / 2;
  const arc = (from, to, color) => {
    const pts = [];
    const steps = Math.max(2, Math.round(72 * (to - from)));
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + 2 * Math.PI * (from + ((to - from) * i) / steps);
      pts.push(new Point(c + r * Math.cos(a), c + r * Math.sin(a)));
    }
    const p = new Path();
    p.addLines(pts);
    ctx.addPath(p);
    ctx.setStrokeColor(color);
    ctx.setLineWidth(4);
    ctx.strokePath();
  };
  arc(0, 1, new Color("#FFFFFF", 0.3));
  if (progress > 0) arc(0, progress, Color.white());
  return ctx.getImage();
}

function accessoryCircular(w, f, feed) {
  w.addAccessoryWidgetBackground = true;
  const st = w.addStack();
  st.backgroundImage = ring(progressOf(f, feed), 60);
  st.size = new Size(60, 60);
  st.layoutVertically();
  st.centerAlignContent();
  st.addSpacer();
  const top = hstack(st);
  top.addSpacer();
  const plane = top.addImage(planeGlyph(28));
  plane.imageSize = new Size(14, 14);
  plane.tintColor = Color.white();
  top.addSpacer();
  const bottom = hstack(st);
  bottom.addSpacer();
  const mins = isAirborne(f) ? remainingMin(f, feed) : null;
  const label = mins != null ? (mins >= 60 ? Math.floor(mins / 60) + "h" + String(Math.round(mins % 60)).padStart(2, "0") : Math.round(mins) + "m") : f.to.iata || "—";
  text(bottom, label, Font.semiboldSystemFont(11), Color.white(), { scale: 0.5 });
  bottom.addSpacer();
  st.addSpacer();
}

function accessoryInline(w, f, feed) {
  text(w, "✈︎ " + f.flightNumber + " · " + timeline(f, feed), Font.systemFont(12));
}

function message(w, family, title, hint, color) {
  const accessory = String(family).startsWith("accessory");
  if (family === "accessoryInline") {
    text(w, "✈︎ " + title, Font.systemFont(12));
    return;
  }
  const row = hstack(w, 6);
  const plane = row.addImage(planeGlyph(40));
  plane.imageSize = new Size(18, 18);
  plane.tintColor = accessory ? Color.white() : color || tone("live");
  text(row, "FlightBuddy", Font.semiboldSystemFont(13), accessory ? Color.white() : C.text);
  if (family === "accessoryCircular") return;
  w.addSpacer();
  text(w, title, Font.semiboldSystemFont(accessory ? 13 : 15), accessory ? Color.white() : color || C.text, { lines: 2 });
  if (!accessory && family !== "small") {
    w.addSpacer(4);
    text(w, hint, Font.systemFont(12), C.muted, { lines: 3 });
  }
  if (!accessory) w.addSpacer();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function build(family) {
  const result = await loadFeed();
  if (result.feed) applyOptions(result.feed.options);

  const w = new ListWidget();
  const accessory = String(family).startsWith("accessory");
  if (!accessory) {
    w.backgroundColor = C.bg;
    w.setPadding(14, 14, 14, 14);
  }

  if (result.error) {
    if (result.error === "setup") message(w, family, s("noSetup"), s("noSetupHint"));
    else if (result.error === "token") message(w, family, s("badToken"), s("badTokenHint"), tone("bad"));
    else message(w, family, s("network"), "", tone("warn"));
    w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
    return w;
  }

  const feed = result.feed;
  if (feed.locale === "de" || feed.locale === "en") LOCALE = feed.locale;
  if (feed.units === "imperial" || feed.units === "metric") UNITS = feed.units;
  const flights = feed.flights || [];

  if (!flights.length) {
    message(w, family, s("empty"), s("emptyHint"));
    w.url = feed.appUrl;
    w.refreshAfterDate = new Date(Date.now() + 60 * 60000);
    return w;
  }

  const f = flights[0];
  w.url = f.url;
  const logos = accessory ? {} : await loadLogos(flights.slice(0, 4));

  if (family === "small") small(w, f, feed, logos);
  else if (family === "large") large(w, flights, feed, logos, result.fresh);
  else if (family === "extraLarge") extraLarge(w, flights, feed, logos, result.fresh);
  else if (family === "accessoryRectangular") accessoryRectangular(w, f, feed);
  else if (family === "accessoryCircular") accessoryCircular(w, f, feed);
  else if (family === "accessoryInline") accessoryInline(w, f, feed);
  else medium(w, f, feed, logos);

  w.refreshAfterDate = new Date(Date.now() + (isLive(f) ? 5 : 30) * 60000);
  return w;
}

const PREVIEW_FAMILIES = ["small", "medium", "large", "extraLarge", "accessoryRectangular", "accessoryCircular", "accessoryInline"];

if (config.runsInWidget) {
  Script.setWidget(await build(config.widgetFamily || "medium"));
} else {
  const alert = new Alert();
  alert.title = "FlightBuddy · " + s("preview");
  s("sizes").forEach((label) => alert.addAction(label));
  alert.addCancelAction(s("cancel"));
  const choice = await alert.presentSheet();
  if (choice >= 0) {
    const family = PREVIEW_FAMILIES[choice];
    const w = await build(family);
    if (family === "small") await w.presentSmall();
    else if (family === "large") await w.presentLarge();
    else if (family === "extraLarge") await w.presentExtraLarge();
    else if (family === "accessoryRectangular") await w.presentAccessoryRectangular();
    else if (family === "accessoryCircular") await w.presentAccessoryCircular();
    else if (family === "accessoryInline") await w.presentAccessoryInline();
    else await w.presentMedium();
  }
}
Script.complete();
