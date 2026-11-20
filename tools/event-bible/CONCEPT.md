# Patron Journey Knowledge Center — guides, tools and templates (concept v1)

Owner: Patron Journey (pjrny.com / patronjourney.com). Drafted 2026-11-20.

## 1. Goal
One place where a festival producer can go from "should I do this?" to "here is my Event Bible", and where their
patrons and staff find how-tos. Everything links to everything: a guide links to the template it explains and to
the tool that fills that template; a tool result offers the guide and the download.

## 2. Three audiences, three doors

| Door | Who | What they need | Sign-in | Where it lives |
|---|---|---|---|---|
| **Patrons** | Ticket buyers / attendees | How to register, link a wristband, top up, refunds, packing list, what to expect (journey map stages: awareness → registration → final prep → event → post-event) | Public | Odoo Knowledge (patronjourney.com/knowledge), public articles; packing list PDF from /library |
| **Organizers / producers** | Festival producers, promoters, ops leads | Tools (Simulator, Weather, Talent, Competitors, RFID), templates (Event Bible + 11 templates), best-practice guides | Tools + templates public; "use my data" uses their simulator session; saved history needs pjrny.com sign-in | Worker: `/library` (templates), `/forecaster/` (simulator, Event Bible step), tool pages; Odoo Knowledge "Organizer guides" section for long-form articles |
| **Staff / crew** | POS operators, scanners, top-up desk, crew | POS how-to, how to scan, how to top up, site rules, incident reporting, radio etiquette | Signed in (Odoo portal/internal users) | Odoo Knowledge private workspace (existing article 42 + children); event-specific crew handbook generated from the Event Bible "Handbook" tab |

The shared nav (`/pj-nav.js`) already carries Help Center → patron / staff links. Add **Template Library** to the tools row.

## 3. Information architecture

```
Knowledge Center
├── Patrons (public, Odoo Knowledge)
│   ├── Getting your ticket · Registering your wristband · Topping up · Refunds of unused balance
│   ├── Before you go: packing list (download), getting there, accessibility
│   └── At the event: lost & found, medical/welfare, code of conduct
├── Organizers
│   ├── Plan  → Simulator (P&L + Monte Carlo) · Weather risk · Competitors · Talent draw
│   ├── Build → Template Library (/library): Event Bible + 11 templates, blank / SAMPLE / my data
│   ├── Guides (Odoo Knowledge, public): one best-practice article per template (below)
│   └── Run   → Dashboard (events, tickets, scanner) · RFID planner · Hippie Wrangler cashless
└── Staff (sign-in required, Odoo Knowledge private)
    ├── POS how-to · How to scan · How to top up (existing)
    ├── Crew handbook (per event, generated from Event Bible Handbook tab)
    └── Incident reporting · radio channels · emergency procedures
```

### Guide ↔ template ↔ tool matrix

| Best-practice guide (Odoo Knowledge article) | Template (Event Bible tab) | Filled by tool |
|---|---|---|
| Building a run of show that survives changeovers | Run of Show | Simulator lineup / stages, Talent |
| What attendees should pack (by climate & camping) | Packing List | Simulator (camping, weather) |
| Moving crew, artists and guests | Transport Master | Simulator (attendance, days, lineup) |
| Load-in to load-out: production fulfillment | Production Fulfillment | Simulator (stages, days, budget lines) |
| Writing your crew handbook | Site & Crew Handbook | Simulator (dates, venue), Safety |
| Cashless that works offline: RFID & POS sizing | RFID & POS Planner | Simulator RFID add-on, /rfid |
| Booking talent with numbers, not vibes | Talent Worksheet | /talent, Simulator lineup + artist budget |
| Getting artists to actually promote | Artist Marketing Checklist | Simulator lineup |
| The lineup announcement playbook | Lineup Announce Checklist | Simulator dates (countdown) |
| Budget, break-even and scenarios | Budget & Scenarios | Simulator P&L |
| Safety planning and the metrics that matter | Safety Guide & Metrics | Simulator safety/weather, /weather |

Each guide follows one shape: *Why it matters (3 lines) → The 5 rules → Common mistakes → Download the template → Fill it from the simulator → Sources*.

## 4. Presentation patterns
- **Library cards** (`/library`): one card per template — title, one-line purpose, audience chips (Organizer / Staff / Patron),
  "covers" bullets, and three buttons: **Blank**, **SAMPLE**, **My data** (enabled when a simulator session exists in this browser).
  Top card = Event Bible (all tabs). Filter chips: Plan · Build · Run · Safety · Marketing.
- **End of simulation**: a final "Event Bible" step in the Forecaster (after P&L and Monte Carlo) shows what will be prefilled
  (event, dates, attendance, stages, lineup, budget lines, RFID/POS, weather risk, staffing) and downloads the workbook.
- **Branding**: cream #F8F4EC, gold #B8932E, ink #2B2620, Georgia headings, same as emails and tools. Workbook tabs use the
  same palette: gold header bands, cream input cells, ink text.
- **Privacy by design**: the browser fills the file locally (no simulator data is uploaded); blank files contain no names,
  phones, emails, PINs or vendor prices; SAMPLE files are watermarked "SAMPLE DATA — fictional" on every tab.
- **Odoo Knowledge**: long-form guides live in Odoo (SEO, editable by PJ staff without deploys). Each article embeds the
  library card via `<iframe src=".../library?only=<template_id>">` or a plain link. Staff articles stay in a private workspace.

## 5. Template system design (how it works technically)
- One generator (`/workspace/ff-templates/build_event_bible.py`, openpyxl) builds every workbook.
- Every template tab reads from a single **Inputs** tab via formulas. Filling a workbook = writing values into Inputs only, so
  styles, formulas and print setup survive. Cell addresses are documented in `field_map.json`.
- The browser filler (`/library/event-bible.js`, uses fflate) opens the xlsx zip, writes Inputs cells, and downloads.
  Same code serves /forecaster (Event Bible step) and /library (My data).
- Simulator → library hand-off: the Forecaster saves `pj_event_bible_state_v1` in localStorage (same origin), the library reads it.

## 6. Roadmap
1. (now) Event Bible + 11 templates, /library, Forecaster step.
2. Odoo Knowledge: 11 organizer guide articles + "Template Library" landing article (draft text can be generated from the
   Notes tab of each template).
3. Site map editor (see SITEMAP_CONCEPT.md) exports a PNG into the Event Bible "Site map" slot.
4. Signed-in organizers: save Event Bible snapshots to D1 per event; share read-only crew handbook links.
