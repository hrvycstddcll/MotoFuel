# MotoFuel

A static web app for motorbikes: plan a ride on a satellite map and
estimate the fuel and cost it will take.

No build step, no backend and nothing to install. The markup and styles live in
**`index.html`**, the application logic in **`script/app.js`**, and the
background photo in **`assets/`**.

```
index.html            markup and styles
script/app.js         all application logic
assets/bg_urban.avif  background photo
```

## Run it

```bash
cd 'C:\Users\Acer\OneDrive\Desktop\APIs'
python -m http.server 8000
```

Then open <http://localhost:8000>. (Node equivalent: `npx serve .`)

> Use a local server rather than opening the file directly. The Geolocation
> API only works in a secure context, and `file://` does not qualify.

## Look and feel

- **Glassmorphism** — every panel uses `backdrop-filter: blur()` over the
  background photo, with a light hairline border and a soft drop shadow.
  A `@supports` fallback swaps in an opaque fill on browsers without
  `backdrop-filter`, so nothing becomes unreadable.
- **Two-tone scrim** over the photo (light in the light theme, dark in the
  dark one) keeps text legible without hiding the image.
- **No logo.** The header is just the wordmark and the theme toggle.
- The background is `assets/bg_urban.avif`, applied with `background-attachment:
  fixed` so it does not scroll. Note that iOS Safari ignores
  `background-attachment: fixed`; the image still covers, it just scrolls
  with the page. If you want it locked on mobile, use a fixed positioned
  `<img>` or `position: fixed` container instead.

The image is 962 KB. If load time matters, re-encode it smaller or drop to
WebP — it is the largest thing on the page by far.

## Setting a pin

There are three ways to place a point, and they all stay in sync with a single
active target shown in the **Start / Destination** toggle:

1. **Search** a place, address or landmark and click a result. Each result is
   badged with which point it will set, and the badge updates if you switch
   target.
2. **Tap the map**. The cursor turns into a crosshair while a target is armed.
3. **Use my location** for the start, from your device's GPS.

After you set a point the target flips automatically, so setting both ends in
sequence needs no extra clicks. Press <kbd>Enter</kbd> to accept the first
search result, <kbd>Esc</kbd> to dismiss the list.

### Removing a point

Each of the **A** and **B** rows has a small **×** button that removes just
that point, leaving the other one and the route intact. Both are disabled and
dimmed until that point exists. This is separate from **Clear**, which wipes
the whole route.

Changing a point is easier than deleting it, though — just drag the pin, or
set it again from search. You only need **×** when you want one end gone.

## What it calculates

The estimate is the inverse of the standard fuel-consumption figure — the
distance you can cover on one litre of fuel:

```
litres needed = distance (km) / efficiency (km/L)
cost          = litres needed x price per litre
```

Worked examples at 25 km/L and PHP 65.00 per litre:

| Distance | Fuel needed | Cost |
| --- | --- | --- |
| 14.52 km | 0.58 L | PHP 37.75 |
| 100 km | 4.00 L | PHP 260.00 |
| 350 km | 14.00 L | PHP 910.00 |

The trip panel shows distance, litres, cost, and the arithmetic
actually used, so you can see where each number came from. Defaults are 25 km/L
and PHP 65.00 per litre; both are editable and remembered.

**Currency is Philippine pesos (PHP).** The price field is a plain number in
pesos per litre — there is no currency conversion, so if you ride somewhere
else just type that local price in and the maths still holds.

If routing fails, the app falls back to a straight-line haversine distance and
warns you, because real road distance is typically 20-40% longer.

## Other features

- **Satellite basemap** by default, with a switcher to a street map
- **Start (A) and destination (B)** as draggable pins, recomputing as you drag
- **Per-point ×** to remove the start or destination on its own
- **Swap** and **Clear** controls
- The route is drawn as a real road polyline, not a straight line
- Dark / light theme, remembered between visits
- Icons are inline SVG, not emoji, so they follow the theme and need no emoji
  font

## Data and privacy

Everything is stored in `localStorage` on your own machine. Nothing is uploaded
anywhere. There is no account and no server.

| Key | Holds |
| --- | --- |
| `motofuel.route.v1` | start, destination, efficiency, price per litre |
| `motofuel.theme.v1` | dark or light |

## External services

| Purpose | Service | Key required |
| --- | --- | --- |
| Satellite imagery | Esri World Imagery | no |
| Street map | OpenStreetMap tiles | no |
| Road routing | OSRM public server | no |
| Address lookup | Nominatim | no |
| Positioning | Browser Geolocation API | no |

**Nominatim's usage policy caps requests at 1 per second.** A single
`politeFetch` wrapper in the app serialises every geocoding call and spaces
them a second apart, and the search box is debounced by 400ms. Do not remove
that delay or you will be blocked.

**OSRM's public server is a demo instance** with no SLA. It is fine for local
use, but run your own for anything real.

**Esri World Imagery** is free for personal and non-commercial use. Commercial
use needs an Esri account and subscription. The required attribution is
included on the map.

Geolocation requires a secure context: `localhost` counts as one, so it works
under `http://localhost:8000`, but a plain-HTTP LAN address will not. Use HTTPS
in production.

## Tech notes

Tailwind runs from the Play CDN (`cdn.tailwindcss.com`) and Leaflet from
unpkg, both with Subresource Integrity hashes so the browser refuses a
tampered download. For production, install Tailwind properly and build a real
stylesheet instead of compiling classes in the browser.

Dark mode inverts only `.leaflet-tile-pane`, so the satellite imagery flips to
a night-friendly palette while the route line, pins and controls keep their
true colours.
