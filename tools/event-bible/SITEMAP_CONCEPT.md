# Site Map Editor: concept (Priority 3, concept only)

**Goal:** Organizers place stages, gates, toilets, water, medical, bars and fences on a real aerial photo of their venue, drawn to scale. The finished map exports as PNG/PDF into the Event Bible. Ops data (toilet counts, water points, entry lanes) flows in from the Event Bible's Safety Metrics.

## 1. Starting point: Odoo's POS floor-plan editor
`patronjourney.odoo.com/pos/ui/10/floor` is Odoo's restaurant floor editor (OWL components in `pos_restaurant`). It already gives us:
- A background image per floor.
- Drag, resize and rotate shapes (tables), with colour, label and seat count.
- Multiple floors.
- Persistence as `restaurant.floor` / `restaurant.table` records.

That covers the core UX we want: drag an object onto a picture and save it.

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Re-skin Odoo** | Custom module `pj_site_map`. It inherits `restaurant.floor` (one floor per event/day or per layer). It adds `event_id`, scale fields (`m_per_px`) and `icon_type` on `restaurant.table`. The frontend is an OWL patch that swaps the table shapes for festival icons. | Data lives in Odoo next to the event. Staff can see the map in POS. Permissions come free. | Odoo.sh / custom-module access needed (Odoo Online SaaS can't install custom Python modules). POS assets are coupled to the POS session. Upgrades can break patches. Floor editor needs a POS config. |
| **B. Worker page that mimics the UX** (recommended first) | `/sitemap` on the organizer Worker. Plain canvas/SVG editor (e.g. Konva or hand-rolled SVG). The layout is saved as JSON in D1 (`site_maps` table keyed by event draft). Optional sync of objects to Odoo `restaurant.table` later. | Ships now, no Odoo hosting change. Same nav/branding. Works on any device. Same browser-side export pipeline as the Event Bible. | A second editor to maintain. Odoo POS doesn't see it until sync is built. |

**Recommendation:** build B with a data model that mirrors `restaurant.floor/table` (name, x, y, width, height, rotation, color, shape, seats→capacity). A later Odoo module (A) can then import the same JSON 1:1.

## 2. Background imagery: "snap the venue"
1. **Find the place.** Nominatim search on the event address from the Forecaster: `nominatim.openstreetmap.org/search?q=…&format=json`. The usage policy is max 1 request/second, a real User-Agent/Referer, no autocomplete-per-keystroke and no bulk use. Proxy it through the Worker and cache results (the Worker already geocodes for `/api/weather/risk`, so reuse that).
2. **Frame it.** The user drags a rectangle on a slippy map, then picks zoom 15–19.
3. **Capture.** Provider options:

| Provider | Imagery | Can it go in a PDF / Event Bible? | Notes |
|---|---|---|---|
| **Esri World Imagery** (ArcGIS Location Platform) | Satellite | **Yes** for internal business use, client reports and presentations; other commercial use needs Esri permission. | Free tier (per Esri pricing page): 2M basemap tiles, 1,000 static maps/month. Needs an API key. Must show "Powered by Esri" + source attribution. **Best fit.** |
| **Mapbox Static Images** | Satellite / streets | Printing static images is **personal, non-commercial only**; commercial printing needs Mapbox permission. Client-side cache max 30 days. Requests must come from the end-user device. | Needs © Mapbox © OpenStreetMap + logo. Fine on screen; risky for an organizer's printed bible. |
| **Google Maps Static API** | Satellite | **No.** Google's FAQ: images can't be stored, cached or included in printed/electronic documents (PDFs). | Only usable as a live on-screen background, so not for export. Needs key + billing. |
| **OpenStreetMap tiles** (tile.openstreetmap.org) | Streets only, no satellite | Data is ODbL, so export with "© OpenStreetMap contributors" is OK. The *tile server* forbids heavy or bulk use. | Use for the street-map mode. For volume, use a commercial OSM tile host. |
| **User upload** | Drone shot / venue CAD / PDF site plan | Yes (their own image) | Always offered. Often the most accurate. |

4. **Stitching.** For Esri/OSM, fetch the tiles for the bbox client-side and draw them onto an offscreen canvas. Keep the attribution string with the layer.

## 3. Scale calibration
- **Auto (Web Mercator):** metres per pixel = 156543.03392 × cos(latitude) ÷ 2^zoom (tile ground resolution at 256-px tiles). Store `m_per_px` with the background.
- **Manual (uploads):** the user clicks two points and types the real distance ("this fence line is 120 m"), and we derive `m_per_px`.
- With scale known, objects carry real sizes: a 40 ft stage, a 2.4 m toilet block. The editor also shows live **area** (m²/ft²) for drawn audience zones, and **capacity** at the Green Guide density (2.0/m² general, 4.0/m² max standing) and NFPA 101 (5 ft²/person). These are the same formulas as the Safety Metrics tab, so the map becomes a check on the licensed capacity.

## 4. Festival icon library (v1 set)
- Stages (main/secondary/DJ booth) and FOH.
- Gates/entry lanes, box office, wristband exchange, top-up kiosk.
- Toilets (standard / accessible / urinal), water point, first aid/medical, welfare/lost & found.
- Security post, emergency exit, assembly point, fire point/extinguisher, AED.
- Bars, food vendors, merch, sponsor activation.
- Generators, light towers, waste/recycling, crew/BOH, artist village, parking, shuttle stop, camping.
- Fencing/barrier lines (polyline with length readout), crash barrier, vehicle route (15 km/h site speed note), pedestrian route.

Use simple monoline SVGs in PJ gold/ink and ship them as one sprite. Each icon has a `kind` that maps to Event Bible counts.

## 5. Layers
Base imagery → Site boundary & fencing → Infrastructure (power, water, waste) → Audience (stages, zones, bars) → Safety (exits, medical, security, routes) → Transport (parking, shuttles, BOH road) → Labels/notes. Each layer can be shown, hidden and locked, and print presets can switch layers on and off: "Patron map" hides BOH; "Crew map" shows everything.

## 6. Tie-in with the Event Bible
- **Counts check:** placed toilets vs Safety Metrics TOTAL toilets, water points vs outlets, gates vs entry lanes. A legend shows ✓ or ⚠.
- **Export:** a PNG at 2× (screen) and a PDF page (letter/A3 landscape, title block with event name/date, north arrow, scale bar, attribution). The PNG is injected into the Event Bible as a new "Site Map" sheet image, either with openpyxl server-side or by adding `xl/media/image1.png` + a drawing part client-side with the same fflate approach.
- **Patron version:** a simplified export for the Knowledge Center "Before you go" article.

## 7. Phasing
1. **MVP (Worker):** address → Esri capture or upload → calibrate → place icons → save JSON in D1 → PNG/PDF export.
2. Counts check against the Event Bible plus a Site Map tab in the download.
3. Odoo module: import the JSON into `restaurant.floor/table` so POS staff see bar/vendor positions. Needs Odoo.sh or on-prem (custom code isn't possible on Odoo Online).
4. Multi-day/phase maps (build, show, break) and sharing a read-only link with crew.

## 8. Licensing caveats (summary)
- Google Static Maps can't be used in exported/printed Event Bibles.
- Mapbox printing is non-commercial only without a separate agreement.
- Esri allows static/print use for internal business, client reports and presentations, with attribution. Confirm the organizer's use case with Esri for public-facing commercial maps.
- OSM data is ODbL with attribution; tile.openstreetmap.org can't be used for bulk or heavy capture.
- Nominatim: 1 request/second, identify the app, cache, no autocomplete.
- Always print the attribution in the map title block.

Sources: Google Maps Platform FAQ & Terms; Mapbox static-maps page, Static Images API docs, attribution guide; Esri ArcGIS Location Platform pricing / licensing & attribution / static-maps terms; OSM Tile Usage Policy; Nominatim Usage Policy.
