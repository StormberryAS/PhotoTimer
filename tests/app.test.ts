// The page logic, run as the page runs it (tests/vm-page.ts): suncalc.js, cities.js, then the
// compiled app.js, with the clock fixed at 5 November 2026 12:00 in Oslo. The expected values are
// what the JavaScript before the move to TypeScript (commit c6691e3) showed at that instant.

process.env.TZ = 'Europe/Oslo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './vm-page.ts';

const NOW = Date.parse('2026-11-05T11:00:00Z');
const root = new URL('../', import.meta.url);
/** The empty countdown, hyphen-minus signs and colons (written as escapes). */
const NONE = '\u002d\u002d:\u002d\u002d:\u002d\u002d';
const row = (name: string, country: string): string => `<span class="city-name">${name}</span><span class="city-country">${country}</span>`;
const at = (iso: string): number => Date.parse(iso);

test('load: the city tab, today as the date, no city and no result', () => {
  const s = loadPage(root, NOW).state();
  assert.deepEqual([s.tab, s.panels, s.date, s.selected, s.error, s.result, s.dropdown.length],
    ['tab-city:active:null tab-gps::null', 'shown/hidden', '2026-11-05', null, null, null, 0]);
});

test('the city search: prefix matches first, at most 8 rows, keys and the mouse', async () => {
  const page = loadPage(root, NOW);
  await page.calculate();
  assert.equal(page.state().error, 'Please select a city first.');
  page.typeCity('Berg');
  assert.deepEqual(page.state().dropdown, [row('Bergerac', 'France'), row('Bergedorf', 'Germany'), row('Bergheim', 'Germany'),
    row('Bergisch Gladbach', 'Germany'), row('Bergkamen', 'Germany'), row('Bergamo', 'Italy'), row('Bergen', 'Norway'), row('Bergen', 'The Netherlands')]);
  assert.equal(page.key('ArrowDown'), true);
  page.key('ArrowDown');
  page.key('ArrowUp');
  assert.equal(page.state().highlighted, 0);
  page.hoverRow(2);
  assert.equal(page.state().highlighted, 2);
  page.key('Escape');
  assert.deepEqual(page.state().dropdown, []);
  page.typeCity('gothenburg');
  assert.deepEqual(page.state().dropdown, [row('Göteborg', 'Sweden')]);
  page.typeCity('erdal');
  assert.deepEqual(page.state().dropdown.slice(0, 2), [row('Erdal', 'Norway'), row('Cloverdale', 'Canada')]);
  page.clickOutside();
  assert.deepEqual(page.state().dropdown, []);
  page.typeCity('zzzzqqq');
  assert.deepEqual(page.state().dropdown, []);
  page.typeCity('Berg');
  page.key('ArrowDown');
  page.key('Enter');
  assert.deepEqual([page.state().selected, page.state().city], ['Bergerac, France (Europe/Paris)', '']);
  page.clearCity();
  assert.deepEqual([page.state().selected, page.state().focus], [null, 'city-search']);
});

test('Bergen: the two windows, the countdown through the day, and the .ics', async () => {
  const page = loadPage(root, NOW);
  page.typeCity('Bergen');
  page.clickRow(0);
  assert.equal(page.state().selected, 'Bergen, Norway (Europe/Oslo)');
  await page.calculate();
  const r = page.state().result;
  assert.deepEqual(r && [r.coords, r.date, r.tz, r.morning, r.evening, r.countdown, r.label],
    ['60.3930°, 5.3242°', '05 Nov 2026', 'GMT+1 / Europe/Oslo', '08:13 – 09:25', '15:22 – 16:33', NONE, 'Next Golden Hour Event In:']);
  const ics = page.exportIcs();
  assert.deepEqual([ics.name, ics.type], ['Golden_Hour_Schedule.ics', 'text/calendar;charset=utf-8']);
  assert.equal(ics.text, [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stormberry//PhotoTimer//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', 'UID:1793876400000M@stormberry.as', 'DTSTAMP:20261105T110000Z', 'DTSTART:20261105T071331Z', 'DTEND:20261105T082506Z',
    'SUMMARY:Morning Golden Hour (PhotoTimer)', 'DESCRIPTION:Perfect light for photography in Bergen, Norway', 'LOCATION:Bergen, Norway', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:1793876400000E@stormberry.as', 'DTSTAMP:20261105T110000Z', 'DTSTART:20261105T142203Z', 'DTEND:20261105T153337Z',
    'SUMMARY:Evening Golden Hour (PhotoTimer)', 'DESCRIPTION:Perfect light for photography in Bergen, Norway', 'LOCATION:Bergen, Norway', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n'));
  const count = (): string => { const c = page.state().result; return c ? `${c.countdown}${c.urgent ? ' urgent' : ''} | ${c.label}` : 'hidden'; };
  page.tick(NOW);
  assert.equal(count(), '03:22:03 | Next Golden Hour Event In:');
  page.tick(at('2026-11-05T13:30:00Z'));
  assert.equal(count(), '00:52:03 urgent | Next Golden Hour Event In:');
  page.tick(at('2026-11-05T14:30:00Z'));
  assert.equal(count(), '00:52:03 urgent | Next Golden Hour Event In:', 'the window has begun: a new interval, its first tick a second later');
  page.tick(at('2026-11-05T14:30:01Z'));
  assert.equal(count(), '01:03:36 | Next Golden Hour Event In:');
  page.tick(at('2026-11-05T15:30:00Z'));
  assert.equal(count(), '00:03:37 urgent | Next Golden Hour Event In:');
  page.tick(at('2026-11-05T15:40:00Z'));
  assert.equal(count(), `${NONE} | No More Golden Hours Today`);
  assert.equal(page.intervals(), 0);
});

test('polar light, other dates and no date', async () => {
  const page = loadPage(root, NOW);
  page.typeCity('Tromsø');
  page.key('ArrowDown');
  page.key('Enter');
  await page.calculate();
  page.tick(NOW);
  const result = (): string => { const r = page.state().result; return r ? [r.coords, r.date, r.tz, r.morning, r.evening, r.countdown, r.label].join(' | ') : 'hidden'; };
  assert.equal(result(), '69.6489°, 18.9551° | 05 Nov 2026 | GMT+1 / Europe/Oslo | Polar/Missing | Polar/Missing | 02:28:09 | Next Golden Hour Event In:');
  assert.equal(page.exportIcs().text, 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Stormberry//PhotoTimer//EN\nCALSCALE:GREGORIAN\nEND:VCALENDAR');
  page.clearCity();
  page.typeCity('Sydney');
  page.key('ArrowDown');
  page.key('Enter');
  page.setDate('2026-12-21');
  await page.calculate();
  page.tick(NOW);
  assert.equal(result(), '-33.8678°, 151.2073° | 21 Dec 2026 | GMT+11 / Australia/Sydney | 05:41 – 06:18 | 19:29 – 20:06 | 1087:41:58 | Next Golden Hour Event In:');
  page.setDate('2026-11-04');
  await page.calculate();
  assert.equal(result(), `-33.8678°, 151.2073° | 04 Nov 2026 | GMT+11 / Australia/Sydney | 05:53 – 06:28 | 18:51 – 19:26 | ${NONE} | No More Golden Hours Today`);
  assert.equal(page.intervals(), 0);
  page.setDate('');
  await page.calculate();
  assert.deepEqual([page.state().error, page.state().result], ['Please select a valid date.', null]);
});

test('typed coordinates: a decimal comma, a Unicode minus, refusals and the zone of the nearest city', async () => {
  const page = loadPage(root, NOW);
  page.clickTab('gps');
  assert.deepEqual([page.state().tab, page.state().panels], ['tab-city::false tab-gps:active:true', 'hidden/shown']);
  await page.calculate();
  const LAT = 'Enter a latitude between -90 and 90, such as 60.39 or 60,39.';
  const LON = 'Enter a longitude between -180 and 180, such as 5.32 or 5,32.';
  assert.deepEqual([page.state().latError, page.state().lonError, page.state().focus, page.state().result], [LAT, LON, 'lat-input', null]);
  page.typeCoord('lat', '60,39');
  assert.deepEqual([page.state().latError, page.state().lonError], [null, LON]);
  page.typeCoord('lon', '5,32');
  await page.calculate();
  page.tick(NOW);
  const r = page.state().result;
  assert.deepEqual([page.state().echo, r && [r.coords, r.tz, r.morning, r.evening, r.countdown].join(' | ')],
    ['Using 60.39, 5.32', '60.3900°, 5.3200° | GMT+1 / Europe/Oslo | 08:13 – 09:25 | 15:22 – 16:33 | 03:22:05']);
  assert.match(page.exportIcs().text, /\nLOCATION:Lat: 60\.3900, Lon: 5\.3200\n/);
  page.typeCoord('lat', '\u221233,87');
  assert.equal(page.state().echo, null);
  page.typeCoord('lon', '151.21');
  await page.calculate();
  assert.deepEqual([page.state().echo, page.state().result?.tz], ['Using -33.87, 151.21', 'GMT+11 / Australia/Sydney']);
  page.typeCoord('lat', '91');
  await page.calculate();
  assert.deepEqual([page.state().latError, page.state().lonError, page.state().echo, page.state().result], [LAT, null, null, null]);
  page.typeCoord('lat', '78,22');
  page.typeCoord('lon', '15,65');
  await page.calculate();
  assert.deepEqual([page.state().result?.tz, page.state().result?.morning, page.state().result?.label], ['GMT+1 / Arctic/Longyearbyen', 'Polar/Missing', 'No More Golden Hours Today']);
  page.clickTab('city');
  assert.deepEqual([page.state().tab, page.state().panels], ['tab-city:active:true tab-gps::false', 'shown/hidden']);
  const parse = (t: string | null): string => page.call('parseDecimal', [t, -90, 90]);
  assert.deepEqual(['60,39', '\u221233,87', ' 5 ', '+1.5', '.5', '5.', '\u2013 12', '-90'].map(parse), ['60.39', '-33.87', '5', '1.5', '0.5', '5', '-12', '-90']);
  assert.deepEqual(['1,2,3', '1e3', '', 'abc', '90.0001', '1 000', '0x10', 'Infinity', null].map(parse), Array(9).fill('null'));
  assert.deepEqual([[0, 0], [0, 179.99], [0, -179.99], [-90, 0], [71, -8], [21.3, -157.8]].map(([a, b]) => page.call('nearestCityTimezone', [a ?? 0, b ?? 0])),
    ['"Africa/Accra"', '"Pacific/Tarawa"', '"Pacific/Tarawa"', '"Atlantic/South_Georgia"', '"Atlantic/Reykjavik"', '"Pacific/Honolulu"']);
  assert.deepEqual(['2026-01-01', '2026-03-29', ''].map((d) => page.call('getTimezoneAbbreviation', ['Europe/Oslo', d])), ['"GMT+1"', '"GMT+2"', '""']);
});
