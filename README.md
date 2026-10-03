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
- **Vanilla HTML/CSS/JS**, no frameworks, no build step.
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
