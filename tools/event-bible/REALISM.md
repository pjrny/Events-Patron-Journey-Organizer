# Simulator realism: improvements (Priority 1b/2b)

## Shipped (v1.6, on PR #6 branch). Low risk, display only, cited
1. **Published-guidance sizing panel** under Safety / Weather (`js/guidance_sizing.js`). It recalculates on every Recalc and never changes dollars.
   - Toilets + urinals: Purple Guide ch.18 Table 1 (rows chosen by gate hours; campsite 1:75 F / 1:150 M / 1 urinal per 250; 50:50 split per 18.17), plus at least one accessible toilet.
   - Medical tier: Purple Guide ch.5 (rev. Dec 2024). T1 <500, T2 ≤2,000, T3 ≤5,000, T4 ≤10,000, T5 above.
   - Steward floor about 1 per 250 (SGSA), shown next to the sim's security units.
   - Drinking water: 4 L/person/day, 20 L camping (NSW Health). Free water outlets: 1 per 1,000 (WA Health 2022).
   - Waste: 0.5 kg/person/day, 1.4 kg camping (A Greener Festival 2024 benchmark).
2. **Event Bible Safety Metrics** adds entry lanes (Green Guide 660/h ceiling), egress width (82 persons/m/min level, 66 stepped, 8-minute target), standing area (2.0/m² general, NFPA 101 5 ft²), lightning (NWS 30-min rule) and wind (ANSI E1.21) triggers.
3. **Talent max guarantee** (EMCF16 method) per act, from the sim's ticket price, production, ancillary and talent budget.
4. **Production list quantities** are tied to guidance, not guesses: toilets, water points, waste tonnes, medical tier, stewards, wristbands + spares, devices + spares.
5. **Packing list** reacts to the real 5-year weather history from `/api/weather/risk` (rain %, heat %, avg low).
6. **Budget scenarios** split fixed vs variable lines from `budget_model.json` line types, so attendance scenarios scale only variable costs.

## Backlog (needs a decision or more data; not changing dollars yet)
| # | Idea | Why | Source / data needed | Risk |
|---|---|---|---|---|
| 1 | Make the `Portapotties GA` cost line = Purple Guide unit count × unit rate × days | Today it scales linearly with N | Local unit hire rate (quote) | Changes P&L, so it needs reconcile at N0 |
| 2 | Security cost from a steward/SIA-style deployment (posts × hours) instead of per-100-peak units | Shift-based is how contractors quote | Contractor hourly rate, gate hours | Changes P&L |
| 3 | Medical cost by Purple Guide tier instead of per-day flat | Cover scales with tier | Provider quotes by tier | Changes P&L |
| 4 | POS count from bar throughput (transactions/hour per terminal × peak demand) | Queue realism | Measured transactions/hour from your RFID vendor reports (Testival/HIVE data) | Needs real throughput data. Do not invent it |
| 5 | Entry lanes from measured scan + search rate and arrival curve | 660/h is a turnstile ceiling; bag search is slower | Your gate scan logs (peak-hour share) | Needs data |
| 6 | Heat days add water & medical demand | Heat raises water use and casualties | Local health guidance; weather heat % already available | Medium |
| 7 | Camping adds overnight toilets/showers & security | Partially done in safety lines | Purple Guide campsite showers ratio (verify) | Low |
| 8 | Weather-driven attendance/walk-up dip in Monte Carlo | Rain history is available per date | Historic walk-up vs rain data from past events | Needs data |
| 9 | Waste cost from tonnes × haul rate | Today it's a flat line | Hauler quote / tonne | Changes P&L |
| 10 | Staff ratios (bar staff per POS, volunteers per shift) | Labor realism | Your past staffing sheets | Needs data |
