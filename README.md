# PhotoTimer

Offline golden-hour and blue-hour scheduler for photographers and cinematographers. PhotoTimer calculates exact "Golden Hour" and "Blue Hour" windows anywhere on Earth without external server lookups or tracker cookies.

**Live:** [photo.stormberry.as](https://photo.stormberry.as)

## Features
- **Accurate calculations**: morning and evening golden-hour bounds computed within the browser.
- **City search or typed coordinates**: pick from the bundled city catalogue, or type a latitude and longitude. A decimal comma works as well as a point (`60,39` or `60.39`), and so does a typographic minus; anything out of range is refused with a message rather than computed.
- **Live countdown**: an animated, real-time pulsing ticker that counts down to the next optimal shooting window.
- **.ics calendar export**: one-click `.ics` generation, so the next window drops straight into Apple Calendar, ProtonCalendar, Outlook, etc.
- **Sovereign architecture**: the times are computed in the browser with no network call; typed coordinates take the timezone of the nearest city in the bundled catalogue.

## Architecture
- **Vanilla HTML and CSS, TypeScript**, no frameworks.
- **TypeScript source in `ts/`, compiled JavaScript committed.** `ts/app.ts` compiles to `app.js`, a classic script as before, at the path the page has always loaded. `app.js` is committed because GitHub Pages serves the repository as it is, with no build step of its own; `.gitattributes` marks it as generated. Edit the TypeScript, never the `.js`.
- **Generated and vendored files kept as they are.** `cities.js` is the shared Stormberry Labs city catalogue, written by SunApp's `update_cities.py`; `suncalc.js` is SunCalc 1.8.0, vendored byte for byte. Neither is compiled or edited here; `ts/cities.d.ts` and `ts/suncalc.d.ts` declare their types for the TypeScript.
- **Build:** `npm run build` (`tools/build-ts.sh`) installs the pinned compiler (`npm ci`), compiles, then runs `bump_assets.py` to restamp the `?v=` cache stamps. `npm run check` changes nothing and fails when the committed JavaScript is not what the TypeScript compiles to. `npm test` runs the tests in `tests/` with the test runner built into Node 24. The published app has no runtime dependencies.
- **Privacy first**, no cookies, no tracking. The golden-hour times involve no network at all: every city carries its own IANA timezone in the bundled catalogue, and typed coordinates are resolved to a zone by nearest-neighbour lookup in that same catalogue. The page never asks for the device's location either: a place comes from city search or from typed coordinates.
- Stormberry dark-mode glassmorphism design system, Inter typography.
- **Sovereign AI**, built and maintained using high-speed agentic workflows.

## Stack
- [SunCalc](https://github.com/mourner/suncalc) for solar position maths, bundled locally.
- [Inter](https://rsms.me/inter/) typeface, locally hosted.

## Credits
Built by [Stormberry AS](https://stormberry.as). Proudly powered by sovereign AI agents.

## Disclaimer

Supplied free of charge, **as is**, with no warranty of any kind. Using it creates no client or advisory relationship with Stormberry AS, and nothing it produces is professional advice.


This is a **functioning prototype**, not a certified instrument and not a professional service. Values are computed or modelled, not measured. Check anything that matters against an authoritative source before you act on it. Stormberry AS reimburses no cost or loss arising from use of this application.

Full terms: [DISCLAIMER.md](DISCLAIMER.md).
