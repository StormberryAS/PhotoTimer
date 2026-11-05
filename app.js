"use strict";
/*! PhotoTimer: app.js is compiled from ts/app.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the .ts, never the .js: the build
    refuses to overwrite a hand edit, and its check mode fails on one. */
const state = {
    tab: 'city',
    city: null,
};
function byId(id, kind) {
    const el = document.getElementById(id);
    if (!(el instanceof kind))
        throw new Error(`PhotoTimer: #${id} is missing from the page`);
    return el;
}
const els = {
    tabCity: byId('tab-city', HTMLButtonElement),
    tabGps: byId('tab-gps', HTMLButtonElement),
    panelCity: byId('panel-city', HTMLElement),
    panelGps: byId('panel-gps', HTMLElement),
    citySearch: byId('city-search', HTMLInputElement),
    cityDropdown: byId('city-dropdown', HTMLUListElement),
    citySelected: byId('city-selected', HTMLElement),
    citySelectedText: byId('city-selected-text', HTMLElement),
    cityClearBtn: byId('city-clear-btn', HTMLButtonElement),
    latInput: byId('lat-input', HTMLInputElement),
    lonInput: byId('lon-input', HTMLInputElement),
    latError: byId('lat-error', HTMLElement),
    lonError: byId('lon-error', HTMLElement),
    gpsEcho: byId('gps-echo', HTMLElement),
    dateInput: byId('date-input', HTMLInputElement),
    calculateBtn: byId('calculate-btn', HTMLButtonElement),
    errorMsg: byId('error-msg', HTMLElement),
    resultsCard: byId('results-card', HTMLElement),
    resCoords: byId('res-coords', HTMLElement),
    resDate: byId('res-date', HTMLElement),
    resTz: byId('res-tz', HTMLElement),
    liveCountdown: byId('live-countdown', HTMLElement),
    resMorningWindow: byId('res-morning-window', HTMLElement),
    resEveningWindow: byId('res-evening-window', HTMLElement),
    addToCalendarBtn: byId('add-to-calendar-btn', HTMLButtonElement),
    loadingOverlay: byId('loading-overlay', HTMLElement),
};
let countdownInterval = null;
function init() {
    els.dateInput.value = getTodayString();
    [els.tabCity, els.tabGps].forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset['tab'] ?? ''));
    });
    els.citySearch.addEventListener('input', onCityInput);
    els.citySearch.addEventListener('keydown', onCityKeydown);
    els.cityClearBtn.addEventListener('click', clearCity);
    document.addEventListener('click', e => {
        const target = e.target;
        if (!(target instanceof Element) || !target.closest('.search-wrapper'))
            closeDropdown();
    });
    els.latInput.addEventListener('input', () => { setFieldError(els.latInput, els.latError, null); setEcho(null); });
    els.lonInput.addEventListener('input', () => { setFieldError(els.lonInput, els.lonError, null); setEcho(null); });
    els.calculateBtn.addEventListener('click', onCalculate);
}
function switchTab(tab) {
    state.tab = tab;
    [els.tabCity, els.tabGps].forEach(btn => {
        const isActive = btn.dataset['tab'] === tab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });
    els.panelCity.hidden = (tab !== 'city');
    els.panelGps.hidden = (tab !== 'gps');
}
let highlightIndex = -1;
function onCityInput() {
    const query = els.citySearch.value.trim().toLowerCase();
    highlightIndex = -1;
    if (query.length < 1) {
        closeDropdown();
        return;
    }
    const qf = foldQuery(query);
    const startsWith = [], contains = [];
    for (const c of CITIES) {
        if (c.fold.startsWith(qf) || c.alt.startsWith(qf))
            startsWith.push(c);
        else if (c.fold.includes(qf) || c.alt.includes(qf) || c.cfold.includes(qf))
            contains.push(c);
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
function onCityKeydown(e) {
    const items = els.cityDropdown.querySelectorAll('li');
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight(Math.min(highlightIndex + 1, items.length - 1));
    }
    else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight(Math.max(highlightIndex - 1, 0));
    }
    else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIndex >= 0 && els.cityDropdown._matches) {
            selectCity(els.cityDropdown._matches[highlightIndex]);
        }
    }
    else if (e.key === 'Escape') {
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
function parseDecimal(text, min, max) {
    if (text == null)
        return null;
    let s = String(text).trim().replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-').replace(/\s+/g, '');
    if (/^[+-]?\d+,\d+$/.test(s))
        s = s.replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s))
        return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function setFieldError(input, errorEl, msg) {
    if (msg) {
        errorEl.textContent = msg;
        errorEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
    }
    else {
        errorEl.textContent = '';
        errorEl.hidden = true;
        input.removeAttribute('aria-invalid');
    }
}
function setEcho(text) {
    els.gpsEcho.textContent = text || '';
    els.gpsEcho.hidden = !text;
}
function nearestCityTimezone(lat, lon) {
    let best = null, bestDist = Infinity;
    for (const c of CITIES) {
        let dLon = Math.abs(c.lon - lon);
        if (dLon > 180)
            dLon = 360 - dLon;
        const dLat = c.lat - lat;
        const x = dLon * Math.cos(((lat + c.lat) / 2) * Math.PI / 180);
        const dist = x * x + dLat * dLat;
        if (dist < bestDist) {
            bestDist = dist;
            best = c;
        }
    }
    return best ? best.tz : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
}
function resolveTimezone(lat, lon) {
    const ianaId = nearestCityTimezone(lat, lon);
    return { ianaId, abbreviation: getTimezoneAbbreviation(ianaId, els.dateInput.value) };
}
let calEvents = { morningStart: null, morningEnd: null, eveningStart: null, eveningEnd: null, locationName: '' };
async function onCalculate() {
    clearError();
    let lat, lon, tzInfo;
    let city = null;
    if (state.tab === 'city') {
        if (!state.city) {
            showError('Please select a city first.');
            return;
        }
        city = state.city;
        lat = city.lat;
        lon = city.lon;
        tzInfo = { ianaId: city.tz, abbreviation: getTimezoneAbbreviation(city.tz, els.dateInput.value) };
    }
    else if (state.tab === 'gps') {
        const latVal = parseDecimal(els.latInput.value, -90, 90);
        const lonVal = parseDecimal(els.lonInput.value, -180, 180);
        setFieldError(els.latInput, els.latError, latVal === null ? 'Enter a latitude between -90 and 90, such as 60.39 or 60,39.' : null);
        setFieldError(els.lonInput, els.lonError, lonVal === null ? 'Enter a longitude between -180 and 180, such as 5.32 or 5,32.' : null);
        if (latVal === null || lonVal === null) {
            setEcho(null);
            hideResults();
            (latVal === null ? els.latInput : els.lonInput).focus();
            return;
        }
        lat = latVal;
        lon = lonVal;
        setEcho(`Using ${lat}, ${lon}`);
        showLoading(true);
        try {
            tzInfo = await resolveTimezone(lat, lon);
        }
        catch (err) {
            showLoading(false);
            showError(err instanceof Error ? err.message : String(err));
            return;
        }
        showLoading(false);
    }
    else {
        throw new Error(`PhotoTimer: unknown tab ${state.tab}`);
    }
    const [year, month, day] = els.dateInput.value.split('-').map(Number);
    if (!year || !month || !day) {
        showError('Please select a valid date.');
        return;
    }
    const dateForCalc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const times = SunCalc.getTimes(dateForCalc, lat, lon);
    const tMorningStart = times.sunrise;
    const tMorningEnd = times.goldenHourEnd;
    const tEveningStart = times.goldenHour;
    const tEveningEnd = times.sunset;
    const isValidMorning = isValidDate(tMorningStart) && isValidDate(tMorningEnd);
    const isValidEvening = isValidDate(tEveningStart) && isValidDate(tEveningEnd);
    const tz = tzInfo.ianaId;
    const morningStr = isValidMorning ? `${formatTime(tMorningStart, tz)} – ${formatTime(tMorningEnd, tz)}` : 'Polar/Missing';
    const eveningStr = isValidEvening ? `${formatTime(tEveningStart, tz)} – ${formatTime(tEveningEnd, tz)}` : 'Polar/Missing';
    calEvents = {
        morningStart: isValidMorning ? tMorningStart : null,
        morningEnd: isValidMorning ? tMorningEnd : null,
        eveningStart: isValidEvening ? tEveningStart : null,
        eveningEnd: isValidEvening ? tEveningEnd : null,
        locationName: city ? `${city.name}, ${city.country}` : `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`
    };
    els.addToCalendarBtn.onclick = () => generateICS(calEvents);
    setupLiveCountdown([tMorningStart, tMorningEnd, tEveningStart, tEveningEnd].filter(d => isValidDate(d)));
    els.resCoords.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
    els.resDate.textContent = formatDate(dateForCalc);
    els.resTz.textContent = tzInfo.abbreviation ? `${tzInfo.abbreviation} / ${tz}` : tz;
    els.resMorningWindow.textContent = morningStr;
    els.resEveningWindow.textContent = eveningStr;
    els.resultsCard.removeAttribute('hidden');
    setTimeout(() => els.resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}
function countdownLabel() {
    const label = els.liveCountdown.parentElement?.querySelector('.countdown-label');
    if (!label)
        throw new Error('PhotoTimer: the countdown label is missing from the page');
    return label;
}
function setupLiveCountdown(validDates) {
    if (countdownInterval)
        clearInterval(countdownInterval);
    const now = Date.now();
    const futureDates = validDates.filter(d => d.getTime() > now).sort((a, b) => a.getTime() - b.getTime());
    const next = futureDates[0];
    if (!next) {
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
            setupLiveCountdown(validDates);
            return;
        }
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff / (1000 * 60)) % 60);
        const s = Math.floor((diff / 1000) % 60);
        els.liveCountdown.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        if (diff < 3600000) {
            els.liveCountdown.classList.add('urgent');
        }
        else {
            els.liveCountdown.classList.remove('urgent');
        }
    }, 1000);
}
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
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tzId,
    }).format(date);
}
function formatDate(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = String(date.getUTCDate()).padStart(2, '0');
    const m = months[date.getUTCMonth()];
    const y = date.getUTCFullYear();
    return `${d} ${m} ${y}`;
}
function getTimezoneAbbreviation(ianaId, dateStr) {
    try {
        const [y = NaN, mo = NaN, d = NaN] = dateStr.split('-').map(Number);
        const date = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: ianaId, timeZoneName: 'short' }).formatToParts(date);
        const tzPart = parts.find(p => p.type === 'timeZoneName');
        return tzPart ? tzPart.value : '';
    }
    catch {
        return '';
    }
}
function generateICS(evs) {
    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Stormberry//PhotoTimer//EN\nCALSCALE:GREGORIAN\n";
    const toICSStr = (d) => (d.toISOString().replace(/[-:]/g, '').split('.')[0] ?? '') + 'Z';
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
function showError(msg) { els.errorMsg.textContent = msg; els.errorMsg.removeAttribute('hidden'); hideResults(); }
function clearError() { els.errorMsg.setAttribute('hidden', ''); els.errorMsg.textContent = ''; }
function showLoading(show) { els.loadingOverlay.hidden = !show; }
function hideResults() {
    els.resultsCard.setAttribute('hidden', '');
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}
document.addEventListener('DOMContentLoaded', init);
