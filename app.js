/**
 * SunApp — app.js
 * ================================================================
 * A fully client-side sun-times calculator.
 * Libraries used:
 *   • SunCalc  (bundled locally in suncalc.js) — astronomical math
 *   • Intl API (built-in)                     — timezone-aware formatting
 *
 * Key design decisions:
 *   1. All SunCalc calls return UTC Date objects — we then format
 *      them with Intl.DateTimeFormat using the TARGET timezone, so
 *      the times are always correct for the queried location, not
 *      the browser's local timezone.
 *   2. For cities we already have the IANA timezone ID embedded in
 *      the database. For raw GPS coords we resolve the timezone
 *      offline from the nearest known city, and for device coords we
 *      use the browser's own IANA zone. Nothing hits the network.
 *   3. Polar Night / Midnight Sun: SunCalc returns NaN Dates when
 *      the sun doesn't cross the horizon — we detect this and show
 *      a user-friendly label instead of crashing.
 * ================================================================
 */

'use strict';

/* ================================================================
   SECTION 1 — CITY DATABASE
   Format: { name, country, lat, lon, tz }
   Coverage: 25,007 cities worldwide, shared across every Labs app.
   Timezone IDs are IANA strings (used with Intl.DateTimeFormat).
================================================================ */
// The city catalogue lives in the shared cities.js, loaded by index.html
// before this file. Regenerate every app's copy with GitHub/update_cities.py.

/* ================================================================
   SECTION 2 — APP STATE
   A single object that tracks what's currently selected.
================================================================ */
const state = {
  tab: 'city',           // 'city' | 'gps' | 'device'
  city: null,            // Selected city object from CITIES array
  deviceLat: null,       // Latitude from device geolocation
  deviceLon: null,       // Longitude from device geolocation
  resolvedTz: null,      // IANA timezone resolved for GPS/device coords
};

/* ================================================================
   SECTION 3 — DOM REFERENCES
   Grab all elements we need once at startup.
================================================================ */
const $ = id => document.getElementById(id);

const els = {
  // Tabs
  tabCity:   $('tab-city'),
  tabGps:    $('tab-gps'),
  tabDevice: $('tab-device'),
  // Panels
  panelCity:   $('panel-city'),
  panelGps:    $('panel-gps'),
  panelDevice: $('panel-device'),
  // City search
  citySearch:   $('city-search'),
  cityDropdown: $('city-dropdown'),
  citySelected: $('city-selected'),
  citySelectedText: $('city-selected-text'),
  cityClearBtn: $('city-clear-btn'),
  // GPS inputs
  latInput: $('lat-input'),
  lonInput: $('lon-input'),
  // Device panel
  getLocationBtn: $('get-location-btn'),
  deviceCoords:   $('device-coords'),
  // Date
  dateInput: $('date-input'),
  // Calculate
  calculateBtn: $('calculate-btn'),
  errorMsg:     $('error-msg'),
  // Results
  resultsCard:    $('results-card'),
  resCoords:  $('res-coords'),
  resDate:    $('res-date'),
  resTz:      $('res-tz'),
  
  // Golden Hour UI
  liveCountdown: $('live-countdown'),
  resMorningWindow: $('res-morning-window'),
  resEveningWindow: $('res-evening-window'),
  addToCalendarBtn: $('add-to-calendar-btn'),

  // Loading
  loadingOverlay: $('loading-overlay'),
};

/* ================================================================
   SECTION 4 — INITIALISE UI
================================================================ */
let countdownInterval = null;
let currentEventTarget = null; // Next date object for countdown

function init() {
  els.dateInput.value = getTodayString();

  [els.tabCity, els.tabGps, els.tabDevice].forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  els.citySearch.addEventListener('input', onCityInput);
  els.citySearch.addEventListener('keydown', onCityKeydown);
  els.cityClearBtn.addEventListener('click', clearCity);

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrapper')) closeDropdown();
  });

  els.getLocationBtn.addEventListener('click', requestDeviceLocation);
  els.calculateBtn.addEventListener('click', onCalculate);
}

/* ================================================================
   SECTION 5 — TAB SWITCHING
================================================================ */
function switchTab(tab) {
  state.tab = tab;
  [els.tabCity, els.tabGps, els.tabDevice].forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  els.panelCity.hidden   = (tab !== 'city');
  els.panelGps.hidden    = (tab !== 'gps');
  els.panelDevice.hidden = (tab !== 'device');
}

/* ================================================================
   SECTION 6 — CITY SEARCH & DROPDOWN
================================================================ */
let highlightIndex = -1;

function onCityInput() {
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
  const startsWith = [], contains = [];
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
    li.dataset.index = i;
    li.innerHTML = `<span class="city-name">${city.name}</span><span class="city-country">${city.country}</span>`;
    li.addEventListener('click', () => selectCity(city));
    li.addEventListener('mouseenter', () => setHighlight(i));
    els.cityDropdown.appendChild(li);
  });

  els.cityDropdown._matches = matches;
  els.cityDropdown.removeAttribute('hidden');
  els.citySearch.setAttribute('aria-expanded', 'true');
}

function onCityKeydown(e) {
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
      selectCity(els.cityDropdown._matches[highlightIndex]);
    }
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
}

function setHighlight(index) {
  const items = els.cityDropdown.querySelectorAll('li');
  items.forEach((li, i) => li.classList.toggle('highlighted', i === index));
  highlightIndex = index;
}

function selectCity(city) {
  state.city = city;
  els.citySearch.value = '';
  closeDropdown();
  els.citySelectedText.textContent = `${city.name}, ${city.country} (${city.tz})`;
  els.citySelected.removeAttribute('hidden');
}

function clearCity() {
  state.city = null;
  els.citySelected.setAttribute('hidden', '');
  els.citySearch.value = '';
  els.citySearch.focus();
}

function closeDropdown() {
  els.cityDropdown.setAttribute('hidden', '');
  els.citySearch.setAttribute('aria-expanded', 'false');
  els.cityDropdown.innerHTML = '';
}

/* ================================================================
   SECTION 7 — DEVICE GEOLOCATION
================================================================ */
function requestDeviceLocation() {
  if (!('geolocation' in navigator)) {
    showError('Geolocation is not supported by this browser.');
    return;
  }
  els.getLocationBtn.disabled = true;
  els.getLocationBtn.textContent = 'Requesting…';
  navigator.geolocation.getCurrentPosition(
    position => {
      state.deviceLat = position.coords.latitude;
      state.deviceLon = position.coords.longitude;
      state.resolvedTz = null;
      els.deviceCoords.textContent = `📍 ${state.deviceLat.toFixed(5)}°, ${state.deviceLon.toFixed(5)}°`;
      els.deviceCoords.removeAttribute('hidden');
      els.getLocationBtn.disabled = false;
      els.getLocationBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg> Location Retrieved ✓`;
    },
    err => {
      els.getLocationBtn.disabled = false;
      els.getLocationBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg> Get My Location`;
      showError('Could not read location.');
    },
    { timeout: 10000, maximumAge: 60000 }
  );
}

/* ================================================================
   SECTION 8 — TIMEZONE RESOLUTION
   Fully offline. City zones come straight from the bundled city
   database. Typed coordinates resolve to the nearest known city's
   zone. Device geolocation uses the browser's own IANA zone.
   Nothing here hits the network.
================================================================ */
function nearestCityTimezone(lat, lon) {
  // Timezones are large political regions and the bundled city list is dense
  // near populated areas, so the nearest city's zone is the correct one in
  // practice. Equirectangular distance is plenty for a nearest-neighbour pick.
  let best = null, bestDist = Infinity;
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

function resolveTimezone(lat, lon) {
  const ianaId = (state.tab === 'device')
    ? (Intl.DateTimeFormat().resolvedOptions().timeZone || nearestCityTimezone(lat, lon))
    : nearestCityTimezone(lat, lon);
  return { ianaId, abbreviation: getTimezoneAbbreviation(ianaId, els.dateInput.value) };
}

/* ================================================================
   SECTION 9 — CALCULATE & CALENDAR LOGIC
================================================================ */

// Store raw JS Date objects to generate ICS file later
let calEvents = {};

async function onCalculate() {
  clearError();
  let lat, lon, tzInfo;

  if (state.tab === 'city') {
    if (!state.city) { showError('Please select a city first.'); return; }
    lat = state.city.lat; lon = state.city.lon;
    tzInfo = { ianaId: state.city.tz, abbreviation: getTimezoneAbbreviation(state.city.tz, els.dateInput.value) };
  } else if (state.tab === 'gps') {
    const latVal = parseFloat(els.latInput.value);
    const lonVal = parseFloat(els.lonInput.value);
    if (isNaN(latVal) || isNaN(lonVal)) { showError('Please enter valid numeric latitude and longitude values.'); return; }
    lat = latVal; lon = lonVal;
    showLoading(true);
    try { tzInfo = await resolveTimezone(lat, lon); } catch (err) { showLoading(false); showError(err.message); return; }
    showLoading(false);
  } else if (state.tab === 'device') {
    if (state.deviceLat === null) { showError('Please retrieve your device location first.'); return; }
    lat = state.deviceLat; lon = state.deviceLon;
    showLoading(true);
    try { tzInfo = await resolveTimezone(lat, lon); } catch (err) { showLoading(false); showError(err.message); return; }
    showLoading(false);
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
    locationName: state.tab === 'city' ? `${state.city.name}, ${state.city.country}` : `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`
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
   SECTION 10 — LIVE COUNTDOWN
================================================================ */
function setupLiveCountdown(validDates) {
  if (countdownInterval) clearInterval(countdownInterval);
  
  // Find the next upcoming event from 'now'
  const now = Date.now();
  const futureDates = validDates.filter(d => d.getTime() > now).sort((a,b) => a.getTime() - b.getTime());

  if (futureDates.length === 0) {
    els.liveCountdown.textContent = '--:--:--';
    els.liveCountdown.classList.remove('urgent');
    els.liveCountdown.parentElement.querySelector('.countdown-label').textContent = 'No More Golden Hours Today';
    return;
  }

  currentEventTarget = futureDates[0].getTime();
  els.liveCountdown.parentElement.querySelector('.countdown-label').textContent = 'Next Golden Hour Event In:';

  countdownInterval = setInterval(() => {
    const diff = currentEventTarget - Date.now();
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
   SECTION 11 — HELPER FUNCTIONS
================================================================ */
function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

function formatTime(date, tzId) {
  return new Intl.DateTimeFormat('en-GB', {
    hour:   '2-digit', minute: '2-digit', hour12: false, timeZone: tzId,
  }).format(date);
}

function formatDate(date) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = months[date.getUTCMonth()];
  const y = date.getUTCFullYear();
  return `${d} ${m} ${y}`;
}

function getTimezoneAbbreviation(ianaId, dateStr) {
  try {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ianaId, timeZoneName: 'short' }).formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : '';
  } catch { return ''; }
}

/* ================================================================
   SECTION 12 — CALENDAR EXPORT (ICS)
================================================================ */
function generateICS(evs) {
  let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Stormberry//PhotoTimer//EN\nCALSCALE:GREGORIAN\n";
  
  const toICSStr = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

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
   SECTION 13 — UI STATE HELPERS
================================================================ */
function showError(msg) { els.errorMsg.textContent = msg; els.errorMsg.removeAttribute('hidden'); }
function clearError() { els.errorMsg.setAttribute('hidden', ''); els.errorMsg.textContent = ''; }
function showLoading(show) { els.loadingOverlay.hidden = !show; }

/* ================================================================
   SECTION 14 — BOOTSTRAP
================================================================ */
document.addEventListener('DOMContentLoaded', init);

