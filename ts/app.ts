/*! PhotoTimer: app.js is compiled from ts/app.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the .ts, never the .js: the build
    refuses to overwrite a hand edit, and its check mode fails on one. */

/**
 * PhotoTimer: ts/app.ts (it began as a copy of SunApp's app.js)
 * ================================================================
 * A fully client-side golden-hour calculator.
 * Libraries used:
 *   • SunCalc  (bundled locally in suncalc.js): astronomical maths
 *   • Intl API (built-in): timezone-aware formatting
 *
 * A classic script, not a module: index.html loads suncalc.js in the head, then cities.js (the
 * shared Labs city catalogue) and app.js at the end of the body, and all three share one global
 * scope. SunCalc, CITIES and foldQuery are typed in ts/suncalc.d.ts and ts/cities.d.ts, and the
 * dropdown's _matches expando in ts/app-dom.d.ts (all three SunApp's files). This file has no
 * import or export, so tsc compiles it to a plain script at the same path (app.js). It keeps
 * nothing in localStorage, and the page has no first-run notice.
 *
 * Key design decisions:
 *   1. All SunCalc calls return UTC Date objects: we then format
 *      them with Intl.DateTimeFormat using the TARGET timezone, so
 *      the times are always correct for the queried location, not
 *      the browser's local timezone.
 *   2. For cities we already have the IANA timezone ID embedded in
 *      the database. For typed coordinates we resolve the timezone
 *      offline from the nearest known city. Nothing hits the network.
 *      There is no device-location option: the stormberry.as zone
 *      sends Permissions-Policy geolocation=(), which blocks it on
 *      every Labs host, so it was removed on 2026-10-02.
 *   3. Polar Night / Midnight Sun: SunCalc returns NaN Dates when
 *      the sun doesn't cross the horizon: we detect this and show
 *      a user-friendly label instead of crashing.
 * ================================================================
 */

/* ================================================================
   SECTION 1: CITY DATABASE
   Format: { name, country, lat, lon, tz }
   Coverage: 25,007 cities worldwide, shared across every Labs app.
   Timezone IDs are IANA strings (used with Intl.DateTimeFormat).
================================================================ */
// The city catalogue lives in the shared cities.js, loaded by index.html
// before this file. Regenerate every app's copy with GitHub/update_cities.py.

/* ================================================================
   SECTION 2: APP STATE
   A single object that tracks what's currently selected.
================================================================ */
const state: { tab: string; city: City | null } = {
  tab: 'city',           // 'city' | 'gps' (the data-tab of the tab buttons)
  city: null,            // Selected city object from CITIES array
};

/* ================================================================
   SECTION 3: DOM REFERENCES
   Grab all elements we need once at startup.
================================================================ */
/** The element with this id, of this kind; the page always has it, so a miss is a broken page. */
function byId<T extends HTMLElement>(id: string, kind: { new (): T; prototype: T }): T {
  const el = document.getElementById(id);
  if (!(el instanceof kind)) throw new Error(`PhotoTimer: #${id} is missing from the page`);
  return el;
}

const els = {
  // Tabs
  tabCity:   byId('tab-city', HTMLButtonElement),
  tabGps:    byId('tab-gps', HTMLButtonElement),
  // Panels
  panelCity:   byId('panel-city', HTMLElement),
  panelGps:    byId('panel-gps', HTMLElement),
  // City search
  citySearch:   byId('city-search', HTMLInputElement),
  cityDropdown: byId('city-dropdown', HTMLUListElement),
  citySelected: byId('city-selected', HTMLElement),
  citySelectedText: byId('city-selected-text', HTMLElement),
  cityClearBtn: byId('city-clear-btn', HTMLButtonElement),
  // GPS inputs
  latInput: byId('lat-input', HTMLInputElement),
  lonInput: byId('lon-input', HTMLInputElement),
  latError: byId('lat-error', HTMLElement),
  lonError: byId('lon-error', HTMLElement),
  gpsEcho:  byId('gps-echo', HTMLElement),
  // Date
  dateInput: byId('date-input', HTMLInputElement),
  // Calculate
  calculateBtn: byId('calculate-btn', HTMLButtonElement),
  errorMsg:     byId('error-msg', HTMLElement),
  // Results
  resultsCard:    byId('results-card', HTMLElement),
  resCoords:  byId('res-coords', HTMLElement),
  resDate:    byId('res-date', HTMLElement),
  resTz:      byId('res-tz', HTMLElement),

  // Golden Hour UI
  liveCountdown: byId('live-countdown', HTMLElement),
  resMorningWindow: byId('res-morning-window', HTMLElement),
  resEveningWindow: byId('res-evening-window', HTMLElement),
  addToCalendarBtn: byId('add-to-calendar-btn', HTMLButtonElement),

  // Loading
  loadingOverlay: byId('loading-overlay', HTMLElement),
};

/* ================================================================
   SECTION 4: INITIALISE UI
================================================================ */
let countdownInterval: number | null = null;

function init(): void {
  els.dateInput.value = getTodayString();

  [els.tabCity, els.tabGps].forEach(btn => {
    // Both buttons carry data-tab, so the fallback never runs.
    btn.addEventListener('click', () => switchTab(btn.dataset['tab'] ?? ''));
  });

  els.citySearch.addEventListener('input', onCityInput);
  els.citySearch.addEventListener('keydown', onCityKeydown);
  els.cityClearBtn.addEventListener('click', clearCity);

  document.addEventListener('click', e => {
    // A click on the page always targets an element.
    const target = e.target;
    if (!(target instanceof Element) || !target.closest('.search-wrapper')) closeDropdown();
  });

  // Editing a coordinate clears its error and the "Using ..." line, which
  // described the previous value, until the next Calculate.
  els.latInput.addEventListener('input', () => { setFieldError(els.latInput, els.latError, null); setEcho(null); });
  els.lonInput.addEventListener('input', () => { setFieldError(els.lonInput, els.lonError, null); setEcho(null); });

  els.calculateBtn.addEventListener('click', onCalculate);
}

/* ================================================================
   SECTION 5: TAB SWITCHING
================================================================ */
function switchTab(tab: string): void {
  state.tab = tab;
  [els.tabCity, els.tabGps].forEach(btn => {
    const isActive = btn.dataset['tab'] === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  els.panelCity.hidden = (tab !== 'city');
  els.panelGps.hidden  = (tab !== 'gps');
}

/* ================================================================
   SECTION 6: CITY SEARCH & DROPDOWN
================================================================ */
let highlightIndex = -1;

function onCityInput(): void {
  const query = els.citySearch.value.trim().toLowerCase();
  highlightIndex = -1;

  if (query.length < 1) {
    closeDropdown();
    return;
  }

  const qf = foldQuery(query);
  // Prefix matches first. With 25,000 cities a bare substring filter
  // buries the obvious answer: "erdal" returned Cloverdale, South
  // Riverdale and Terdal ahead of Erdal, and with only 8 rows shown the
  // city being typed could fall off the list entirely.
  const startsWith: City[] = [], contains: City[] = [];
  for (const c of CITIES) {
    // c.alt is the folded English exonym where GeoNames stores the local
    // name, so "gothenburg" finds Goteborg and "cologne" finds Koeln.
    if (c.fold.startsWith(qf) || c.alt.startsWith(qf)) startsWith.push(c);
    else if (c.fold.includes(qf) || c.alt.includes(qf) || c.cfold.includes(qf)) contains.push(c);
  }
  const matches = startsWith.concat(contains).slice(0, 8);

  if (matches.length === 0) {
    closeDropdown();
    return;
  }

  els.cityDropdown.innerHTML = '';
  matches.forEach((city, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.dataset['index'] = String(i);
    li.innerHTML = `<span class="city-name">${city.name}</span><span class="city-country">${city.country}</span>`;
    li.addEventListener('click', () => selectCity(city));
    li.addEventListener('mouseenter', () => setHighlight(i));
    els.cityDropdown.appendChild(li);
  });

  els.cityDropdown._matches = matches;
  els.cityDropdown.removeAttribute('hidden');
  els.citySearch.setAttribute('aria-expanded', 'true');
}

function onCityKeydown(e: KeyboardEvent): void {
  const items = els.cityDropdown.querySelectorAll('li');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setHighlight(Math.min(highlightIndex + 1, items.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setHighlight(Math.max(highlightIndex - 1, 0));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (highlightIndex >= 0 && els.cityDropdown._matches) {
      /* highlightIndex points at a row of the list _matches was made for, so the element is
         always there (the same cast as SunApp's). */
      selectCity(els.cityDropdown._matches[highlightIndex] as City);
    }
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
}

function setHighlight(index: number): void {
  const items = els.cityDropdown.querySelectorAll('li');
  items.forEach((li, i) => li.classList.toggle('highlighted', i === index));
  highlightIndex = index;
}

function selectCity(city: City): void {
  state.city = city;
  els.citySearch.value = '';
  closeDropdown();
  els.citySelectedText.textContent = `${city.name}, ${city.country} (${city.tz})`;
  els.citySelected.removeAttribute('hidden');
}

function clearCity(): void {
  state.city = null;
  els.citySelected.setAttribute('hidden', '');
  els.citySearch.value = '';
  els.citySearch.focus();
}

function closeDropdown(): void {
  els.cityDropdown.setAttribute('hidden', '');
  els.citySearch.setAttribute('aria-expanded', 'false');
  els.cityDropdown.innerHTML = '';
}

/* ================================================================
   SECTION 7: TYPED NUMBERS
================================================================ */
// Shared Labs parser: accepts "60,39" and a Unicode minus, rejects anything else or out of range (null).
function parseDecimal(text: string | null | undefined, min: number, max: number): number | null {
  if (text == null) return null;
  let s = String(text).trim().replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-').replace(/\s+/g, '');
  if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Show (msg) or clear (null) the inline message under one coordinate field. */
function setFieldError(input: HTMLInputElement, errorEl: HTMLElement, msg: string | null): void {
  if (msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  } else {
    errorEl.textContent = '';
    errorEl.hidden = true;
    input.removeAttribute('aria-invalid');
  }
}

/** Show (text) or clear (null) the "Using ..." line. Cleared text, not just
 *  hidden: aria-describedby still reads a hidden element it points at. */
function setEcho(text: string | null): void {
  els.gpsEcho.textContent = text || '';
  els.gpsEcho.hidden = !text;
}

/* ================================================================
   SECTION 8: TIMEZONE RESOLUTION
   Fully offline. City zones come straight from the bundled city
   database, and typed coordinates resolve to the nearest known
   city's zone. Nothing here hits the network.
================================================================ */
interface TzInfo { ianaId: string; abbreviation: string }

function nearestCityTimezone(lat: number, lon: number): string {
  // Timezones are large political regions and the bundled city list is dense
  // near populated areas, so the nearest city's zone is the correct one in
  // practice. Equirectangular distance is plenty for a nearest-neighbour pick.
  let best: City | null = null, bestDist = Infinity;
  for (const c of CITIES) {
    let dLon = Math.abs(c.lon - lon);
    if (dLon > 180) dLon = 360 - dLon;
    const dLat = c.lat - lat;
    const x = dLon * Math.cos(((lat + c.lat) / 2) * Math.PI / 180);
    const dist = x * x + dLat * dLat;
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  return best ? best.tz : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
}

function resolveTimezone(lat: number, lon: number): TzInfo {
  const ianaId = nearestCityTimezone(lat, lon);
  return { ianaId, abbreviation: getTimezoneAbbreviation(ianaId, els.dateInput.value) };
}

/* ================================================================
   SECTION 9: CALCULATE & CALENDAR LOGIC
================================================================ */

/** The two windows of the last result, for the .ics export (null where a window is missing). */
interface CalEvents {
  morningStart: Date | null;
  morningEnd: Date | null;
  eveningStart: Date | null;
  eveningEnd: Date | null;
  locationName: string;
}

// Store raw JS Date objects to generate ICS file later. Set by every result before the
// calendar button is wired; this empty value would export an empty calendar, as {} did.
let calEvents: CalEvents = { morningStart: null, morningEnd: null, eveningStart: null, eveningEnd: null, locationName: '' };

async function onCalculate(): Promise<void> {
  clearError();
  let lat: number, lon: number, tzInfo: TzInfo;
  let city: City | null = null;

  if (state.tab === 'city') {
    if (!state.city) { showError('Please select a city first.'); return; }
    city = state.city;
    lat = city.lat; lon = city.lon;
    tzInfo = { ianaId: city.tz, abbreviation: getTimezoneAbbreviation(city.tz, els.dateInput.value) };
  } else if (state.tab === 'gps') {
    const latVal = parseDecimal(els.latInput.value, -90, 90);
    const lonVal = parseDecimal(els.lonInput.value, -180, 180);

    setFieldError(els.latInput, els.latError,
      latVal === null ? 'Enter a latitude between -90 and 90, such as 60.39 or 60,39.' : null);
    setFieldError(els.lonInput, els.lonError,
      lonVal === null ? 'Enter a longitude between -180 and 180, such as 5.32 or 5,32.' : null);

    if (latVal === null || lonVal === null) {
      // Do not compute, and do not leave an older result showing under the error.
      setEcho(null);
      hideResults();
      (latVal === null ? els.latInput : els.lonInput).focus();
      return;
    }

    lat = latVal; lon = lonVal;
    // Echo the numbers actually used, so "6,5" visibly became 6.5.
    setEcho(`Using ${lat}, ${lon}`);
    showLoading(true);
    try { tzInfo = await resolveTimezone(lat, lon); } catch (err) { showLoading(false); showError(err instanceof Error ? err.message : String(err)); return; }
    showLoading(false);
  } else {
    // The two tab buttons are the only callers of switchTab, with 'city' and 'gps'.
    throw new Error(`PhotoTimer: unknown tab ${state.tab}`);
  }

  const [year, month, day] = els.dateInput.value.split('-').map(Number);
  if (!year || !month || !day) { showError('Please select a valid date.'); return; }

  const dateForCalc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const times = SunCalc.getTimes(dateForCalc, lat, lon);

  // Extract golden hour boundaries
  const tMorningStart = times.sunrise;      // Sun appears
  const tMorningEnd   = times.goldenHourEnd;// Sun hits ~6 degree elev

  const tEveningStart = times.goldenHour;   // Sun drops to ~6 degree elev
  const tEveningEnd   = times.sunset;       // Sun disappears

  const isValidMorning = isValidDate(tMorningStart) && isValidDate(tMorningEnd);
  const isValidEvening = isValidDate(tEveningStart) && isValidDate(tEveningEnd);

  // Determine timezone context
  const tz = tzInfo.ianaId;

  // Build display strings
  const morningStr = isValidMorning ? `${formatTime(tMorningStart, tz)} – ${formatTime(tMorningEnd, tz)}` : 'Polar/Missing';
  const eveningStr = isValidEvening ? `${formatTime(tEveningStart, tz)} – ${formatTime(tEveningEnd, tz)}` : 'Polar/Missing';

  // Store globally for calendar export
  calEvents = {
    morningStart: isValidMorning ? tMorningStart : null,
    morningEnd:   isValidMorning ? tMorningEnd : null,
    eveningStart: isValidEvening ? tEveningStart : null,
    eveningEnd:   isValidEvening ? tEveningEnd : null,
    locationName: city ? `${city.name}, ${city.country}` : `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`
  };

  // Wire up the calendar button
  els.addToCalendarBtn.onclick = () => generateICS(calEvents);

  // Setup Live Countdown
  setupLiveCountdown([tMorningStart, tMorningEnd, tEveningStart, tEveningEnd].filter(d => isValidDate(d)));

  // Render
  els.resCoords.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
  els.resDate.textContent   = formatDate(dateForCalc);
  els.resTz.textContent     = tzInfo.abbreviation ? `${tzInfo.abbreviation} / ${tz}` : tz;

  els.resMorningWindow.textContent = morningStr;
  els.resEveningWindow.textContent = eveningStr;

  els.resultsCard.removeAttribute('hidden');
  setTimeout(() => els.resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

/* ================================================================
   SECTION 10: LIVE COUNTDOWN
================================================================ */
/** The label above the countdown (in the same banner). */
function countdownLabel(): Element {
  const label = els.liveCountdown.parentElement?.querySelector('.countdown-label');
  if (!label) throw new Error('PhotoTimer: the countdown label is missing from the page');
  return label;
}

function setupLiveCountdown(validDates: Date[]): void {
  if (countdownInterval) clearInterval(countdownInterval);

  // Find the next upcoming event from 'now'
  const now = Date.now();
  const futureDates = validDates.filter(d => d.getTime() > now).sort((a,b) => a.getTime() - b.getTime());
  const next = futureDates[0];

  if (!next) {
    // Two hyphen-minus signs, a colon, and so on: written as escapes.
    els.liveCountdown.textContent = '\u002d\u002d:\u002d\u002d:\u002d\u002d';
    els.liveCountdown.classList.remove('urgent');
    countdownLabel().textContent = 'No More Golden Hours Today';
    return;
  }

  const target = next.getTime();
  countdownLabel().textContent = 'Next Golden Hour Event In:';

  countdownInterval = setInterval(() => {
    const diff = target - Date.now();
    if (diff <= 0) {
      // Event reached; recalculate next
      setupLiveCountdown(validDates);
      return;
    }

    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff / (1000 * 60)) % 60);
    const s = Math.floor((diff / 1000) % 60);

    els.liveCountdown.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

    if (diff < 3600000) { // Under 1 hour
      els.liveCountdown.classList.add('urgent');
    } else {
      els.liveCountdown.classList.remove('urgent');
    }
  }, 1000);
}

/* ================================================================
   SECTION 11: HELPER FUNCTIONS
================================================================ */
function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}

function formatTime(date: Date, tzId: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour:   '2-digit', minute: '2-digit', hour12: false, timeZone: tzId,
  }).format(date);
}

function formatDate(date: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = months[date.getUTCMonth()];
  const y = date.getUTCFullYear();
  return `${d} ${m} ${y}`;
}

function getTimezoneAbbreviation(ianaId: string, dateStr: string): string {
  try {
    // A missing part is NaN, as undefined was in this arithmetic: an invalid date, so ''.
    const [y = NaN, mo = NaN, d = NaN] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ianaId, timeZoneName: 'short' }).formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : '';
  } catch { return ''; }
}

/* ================================================================
   SECTION 12: CALENDAR EXPORT (ICS)
================================================================ */
function generateICS(evs: CalEvents): void {
  let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Stormberry//PhotoTimer//EN\nCALSCALE:GREGORIAN\n";

  // split always gives a first element, so the fallback never runs.
  const toICSStr = (d: Date): string => (d.toISOString().replace(/[-:]/g, '').split('.')[0] ?? '') + 'Z';

  if (evs.morningStart && evs.morningEnd) {
    icsContent += "BEGIN:VEVENT\n";
    icsContent += "UID:" + Date.now() + "M@stormberry.as\n";
    icsContent += "DTSTAMP:" + toICSStr(new Date()) + "\n";
    icsContent += "DTSTART:" + toICSStr(evs.morningStart) + "\n";
    icsContent += "DTEND:" + toICSStr(evs.morningEnd) + "\n";
    icsContent += "SUMMARY:Morning Golden Hour (PhotoTimer)\n";
    icsContent += "DESCRIPTION:Perfect light for photography in " + evs.locationName + "\n";
    icsContent += "LOCATION:" + evs.locationName + "\n";
    icsContent += "END:VEVENT\n";
  }

  if (evs.eveningStart && evs.eveningEnd) {
    icsContent += "BEGIN:VEVENT\n";
    icsContent += "UID:" + Date.now() + "E@stormberry.as\n";
    icsContent += "DTSTAMP:" + toICSStr(new Date()) + "\n";
    icsContent += "DTSTART:" + toICSStr(evs.eveningStart) + "\n";
    icsContent += "DTEND:" + toICSStr(evs.eveningEnd) + "\n";
    icsContent += "SUMMARY:Evening Golden Hour (PhotoTimer)\n";
    icsContent += "DESCRIPTION:Perfect light for photography in " + evs.locationName + "\n";
    icsContent += "LOCATION:" + evs.locationName + "\n";
    icsContent += "END:VEVENT\n";
  }

  icsContent += "END:VCALENDAR";

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "Golden_Hour_Schedule.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ================================================================
   SECTION 13: UI STATE HELPERS
================================================================ */
/** Display an error message below the calculate button, and hide any
 *  earlier result so it cannot be read as the answer to the new input. */
function showError(msg: string): void { els.errorMsg.textContent = msg; els.errorMsg.removeAttribute('hidden'); hideResults(); }
function clearError(): void { els.errorMsg.setAttribute('hidden', ''); els.errorMsg.textContent = ''; }
function showLoading(show: boolean): void { els.loadingOverlay.hidden = !show; }
/** Hide the results card and stop its countdown, which would otherwise keep
 *  ticking towards a window that belongs to the previous input. */
function hideResults(): void {
  els.resultsCard.setAttribute('hidden', '');
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

/* ================================================================
   SECTION 14: BOOTSTRAP
================================================================ */
document.addEventListener('DOMContentLoaded', init);
