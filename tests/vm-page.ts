// Runs the page's three scripts, suncalc.js, cities.js and then the compiled app.js, in a fresh
// node:vm context, one global scope as in a browser, with a stub of the page parts app.js touches,
// a clock fixed at a given instant and timers the test runs by hand. No browser and no DOM library:
// app.js is a classic script that reads the page as it loads, so it cannot be imported; this runs it
// as the page does, then lets a test type in the search, press keys and buttons and read the result
// through the same listeners the page uses. Made on WeatherWhisper's tests/vm-page.ts (5 November 2026).

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

type Listener = (event: StubEvent) => void;

/** The parts of an event that app.js reads. */
interface StubEvent { key?: string; target?: StubElement; preventDefault(): void }

/** A page element with only what app.js uses. */
class StubElement {
  textContent = '';
  value = '';
  /** Set by app.js on the download link. */
  href = '';
  download = '';
  onclick: (() => void) | null = null;
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly children: StubElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly tag: string;
  readonly id: string;
  parentElement: StubElement | null = null;
  #html = '';
  /** Called by focus(), so the page knows which element has the focus. */
  onFocus: ((el: StubElement) => void) | null = null;
  constructor(tag: string, id = '') { this.tag = tag; this.id = id; }
  get hidden(): boolean { return this.attributes.has('hidden'); }
  set hidden(on: boolean) { if (on) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get className(): string { return [...this.classes].join(' '); }
  readonly classList = {
    add: (c: string): void => { this.classes.add(c); },
    remove: (c: string): void => { this.classes.delete(c); },
    contains: (c: string): boolean => this.classes.has(c),
    toggle: (c: string, on?: boolean): boolean => { const v = on ?? !this.classes.has(c); if (v) this.classes.add(c); else this.classes.delete(c); return v; },
  };
  /** Markup is only recorded; setting it to '' empties the element, as app.js expects. */
  get innerHTML(): string { return this.#html; }
  set innerHTML(html: string) { this.#html = html; if (html === '') this.children.splice(0); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  appendChild(child: StubElement): StubElement { this.children.push(child); child.parentElement = this; return child; }
  removeChild(child: StubElement): StubElement { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); return child; }
  querySelectorAll(selector: string): StubElement[] {
    if (selector !== 'li') throw new Error(`stub: querySelectorAll(${selector})`);
    return this.children.filter((c) => c.tag === 'li');
  }
  querySelector(selector: string): StubElement | null {
    if (!selector.startsWith('.')) throw new Error(`stub: querySelector(${selector})`);
    return this.children.find((c) => c.classes.has(selector.slice(1))) ?? null;
  }
  /** Only the search box and its list sit inside .search-wrapper. */
  closest(selector: string): StubElement | null {
    if (selector !== '.search-wrapper') throw new Error(`stub: closest(${selector})`);
    return this.id === 'city-search' || this.id === 'city-dropdown' || this.tag === 'li' ? this : null;
  }
  focus(): void { this.onFocus?.(this); }
  scrollIntoView(): void { /* nothing to scroll */ }
  click(): void { this.fire('click'); }
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  fire(type: string, init: { key?: string } = {}): boolean {
    let prevented = false;
    const event: StubEvent = { ...init, target: this, preventDefault: () => { prevented = true; } };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return prevented;
  }
}
// The kinds app.js checks with instanceof.
class StubInput extends StubElement {}
class StubButton extends StubElement {}
class StubList extends StubElement {}

/** What the page shows. */
export interface PageState {
  tab: string;
  panels: string;
  city: string;
  dropdown: string[];
  highlighted: number;
  selected: string | null;
  error: string | null;
  latError: string | null;
  lonError: string | null;
  echo: string | null;
  loading: boolean;
  /** null while the results card is hidden. */
  result: { coords: string; date: string; tz: string; morning: string; evening: string; countdown: string; urgent: boolean; label: string } | null;
  focus: string;
  date: string;
}

export interface Page {
  state(): PageState;
  /** Types text into the city search, as the input event delivers it. */
  typeCity(text: string): void;
  /** A key press in the city search; true when the page prevented the default. */
  key(key: string): boolean;
  /** The mouse enters, or clicks, row i of the city list. */
  hoverRow(i: number): void;
  clickRow(i: number): void;
  /** A click on the page outside the search. */
  clickOutside(): void;
  clickTab(tab: 'city' | 'gps'): void;
  clearCity(): void;
  setDate(value: string): void;
  /** Types into a coordinate field (the input event). */
  typeCoord(which: 'lat' | 'lon', text: string): void;
  /** Presses Calculate and waits until its work is done. */
  calculate(): Promise<void>;
  /** Presses the calendar button: the file name and the text of the .ics. */
  exportIcs(): { name: string; type: string; text: string };
  /** Moves the clock to this instant (ms) and runs each running interval once, as one tick. */
  tick(now: number): void;
  /** The number of intervals running. */
  intervals(): number;
  /** Calls a global function of app.js with JSON arguments and returns the result as JSON. */
  call(name: 'parseDecimal' | 'nearestCityTimezone' | 'formatDate' | 'getTimezoneAbbreviation' | 'formatTime', args: (number | string | null | { date: string })[]): string;
}

/** Loads suncalc.js, cities.js and app.js from root (a directory URL) at the instant now, and fires DOMContentLoaded. */
export function loadPage(root: URL, start: number): Page {
  let now = start;
  let focused = '';
  const onFocus = (el: StubElement): void => { focused = el.id; };
  const make = (Kind: typeof StubElement, tag: string, id: string): StubElement => { const e = new Kind(tag, id); e.onFocus = onFocus; return e; };
  const els = new Map<string, StubElement>();
  const add = (Kind: typeof StubElement, tag: string, ids: string[]): void => { for (const id of ids) els.set(id, make(Kind, tag, id)); };
  add(StubButton, 'button', ['tab-city', 'tab-gps', 'city-clear-btn', 'calculate-btn', 'add-to-calendar-btn']);
  add(StubInput, 'input', ['city-search', 'lat-input', 'lon-input', 'date-input']);
  add(StubList, 'ul', ['city-dropdown']);
  add(StubElement, 'div', ['panel-city', 'panel-gps', 'city-selected', 'city-selected-text', 'lat-error', 'lon-error', 'gps-echo', 'error-msg',
    'results-card', 'res-coords', 'res-date', 'res-tz', 'live-countdown', 'res-morning-window', 'res-evening-window', 'loading-overlay']);
  const el = (id: string): StubElement => {
    const e = els.get(id);
    if (!e) throw new Error(`no stub #${id}`);
    return e;
  };
  // The page as index.html starts it.
  el('tab-city').dataset['tab'] = 'city';
  el('tab-gps').dataset['tab'] = 'gps';
  el('tab-city').classes.add('active');
  for (const id of ['panel-gps', 'city-dropdown', 'city-selected', 'lat-error', 'lon-error', 'gps-echo', 'error-msg', 'results-card', 'loading-overlay']) el(id).hidden = true;
  el('live-countdown').textContent = '\u002d\u002d:\u002d\u002d:\u002d\u002d';
  const banner = new StubElement('div');
  const label = new StubElement('div');
  label.classes.add('countdown-label');
  label.textContent = 'Next Golden Hour In:';
  banner.appendChild(label);
  banner.appendChild(el('live-countdown'));
  const body = new StubElement('body');

  const docListeners = new Map<string, Listener>();
  const timers = new Map<number, { fn: () => void; every: number | null }>();
  let timerSeq = 0;
  const blobs: { text: string; type: string }[] = [];
  const downloads: { href: string; download: string }[] = [];

  // The clock: new Date() and Date.now() give the current instant; every other use is the real Date.
  class FixedDate extends Date {
    constructor(...args: [] | [number | string | Date] | [number, number, number]) {
      if (args.length === 0) super(now); else if (args.length === 1) super(args[0]); else super(args[0], args[1], args[2]);
    }
    static override now(): number { return now; }
  }

  const sandbox = {
    Date: FixedDate,
    Element: StubElement,
    HTMLElement: StubElement,
    HTMLInputElement: StubInput,
    HTMLButtonElement: StubButton,
    HTMLUListElement: StubList,
    setTimeout: (fn: () => void): number => { timers.set(++timerSeq, { fn, every: null }); return timerSeq; },
    setInterval: (fn: () => void, ms: number): number => { timers.set(++timerSeq, { fn, every: ms }); return timerSeq; },
    clearInterval: (id: number): void => { timers.delete(id); },
    Blob: class { constructor(parts: string[], opts: { type: string }) { blobs.push({ text: parts.join(''), type: opts.type }); } },
    URL: { createObjectURL: (): string => `blob:stub/${blobs.length}` },
    document: {
      body,
      getElementById: (id: string): StubElement | null => els.get(id) ?? null,
      addEventListener: (type: string, fn: Listener): void => { docListeners.set(type, fn); },
      createElement: (tag: string): StubElement => {
        const e = make(StubElement, tag, '');
        if (tag === 'a') e.click = (): void => { downloads.push({ href: e.href, download: e.download }); };
        return e;
      },
    },
  };
  const context = createContext(sandbox);
  runInContext('var window = globalThis;', context);
  for (const file of ['suncalc.js', 'cities.js', 'app.js']) {
    runInContext(readFileSync(new URL(file, root), 'utf8'), context, { filename: file });
  }
  const ready = docListeners.get('DOMContentLoaded');
  if (!ready) throw new Error('app.js did not wait for DOMContentLoaded');
  ready({ preventDefault: () => undefined });

  const shown = (id: string): string | null => (el(id).hidden ? null : el(id).textContent);
  const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
  return {
    state: () => ({
      tab: ['tab-city', 'tab-gps'].map((id) => `${id}:${el(id).className}:${el(id).getAttribute('aria-selected')}`).join(' '),
      panels: `${el('panel-city').hidden ? 'hidden' : 'shown'}/${el('panel-gps').hidden ? 'hidden' : 'shown'}`,
      city: el('city-search').value,
      dropdown: el('city-dropdown').hidden ? [] : el('city-dropdown').children.map((li) => li.innerHTML),
      highlighted: el('city-dropdown').children.findIndex((li) => li.classes.has('highlighted')),
      selected: shown('city-selected') === null ? null : el('city-selected-text').textContent,
      error: shown('error-msg'),
      latError: shown('lat-error'),
      lonError: shown('lon-error'),
      echo: shown('gps-echo'),
      loading: !el('loading-overlay').hidden,
      result: el('results-card').hidden ? null : {
        coords: el('res-coords').textContent, date: el('res-date').textContent, tz: el('res-tz').textContent,
        morning: el('res-morning-window').textContent, evening: el('res-evening-window').textContent,
        countdown: el('live-countdown').textContent, urgent: el('live-countdown').classes.has('urgent'), label: label.textContent,
      },
      focus: focused,
      date: el('date-input').value,
    }),
    typeCity: (text) => { el('city-search').value = text; el('city-search').fire('input'); },
    key: (key) => el('city-search').fire('keydown', { key }),
    hoverRow: (i) => { const li = el('city-dropdown').children[i]; if (!li) throw new Error(`no row ${i}`); li.fire('mouseenter'); },
    clickRow: (i) => { const li = el('city-dropdown').children[i]; if (!li) throw new Error(`no row ${i}`); li.fire('click'); },
    clickOutside: () => { const fn = docListeners.get('click'); if (fn) fn({ target: new StubElement('h1'), preventDefault: () => undefined }); },
    clickTab: (tab) => { el(`tab-${tab}`).fire('click'); },
    clearCity: () => { el('city-clear-btn').fire('click'); },
    setDate: (value) => { el('date-input').value = value; },
    typeCoord: (which, text) => { const e = el(`${which}-input`); e.value = text; e.fire('input'); },
    calculate: async () => { el('calculate-btn').fire('click'); await flush(); },
    exportIcs: () => {
      const fn = el('add-to-calendar-btn').onclick;
      if (!fn) throw new Error('the calendar button is not wired');
      fn();
      const blob = blobs.at(-1);
      const file = downloads.at(-1);
      if (!blob || !file) throw new Error('no download');
      return { name: file.download, type: blob.type, text: blob.text };
    },
    tick: (at) => { now = at; for (const [id, t] of [...timers]) if (t.every !== null && timers.has(id)) t.fn(); },
    intervals: () => [...timers.values()].filter((t) => t.every !== null).length,
    call: (name, args) => String(runInContext(`JSON.stringify(${name}(${args.map((a) => (a !== null && typeof a === 'object' ? `new Date(${JSON.stringify(a.date)})` : JSON.stringify(a))).join(', ')}))`, context)),
  };
}
