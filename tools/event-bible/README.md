# Event Bible build

- `python3 build_event_bible.py` builds out/event-bible.xlsx, out/templates/*.xlsx and out/field_map.json (openpyxl).
- `node make_sample.js` builds the SAMPLE data from the simulator engine (expects the forecast_sim_event checkout at /workspace/fsim-pj-tools and `web/fflate.min.js`) and fills every template into out/sample/.
- Copy the outputs to `public/library/` (and event-bible.xlsx + field_map.json to forecast_sim_event `templates/event_bible/`).
- `web/event_bible.js` is the shared browser filler. The same file is in `public/library/` and in forecast_sim_event `js/`.
