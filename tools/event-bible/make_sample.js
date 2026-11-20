// Build SAMPLE data from the real simulator engine, fill every template, write out/sample/*.xlsx + out/sample.json
global.window = global;
const fs = require("fs"), path = require("path");
const SIM = "/workspace/fsim-pj-tools";
for (const f of ["budget_engine", "ticket_tiers", "sponsors_booths", "rfid_addon", "safety_weather"]) eval(fs.readFileSync(path.join(SIM, "js", f + ".js"), "utf8"));
const model = JSON.parse(fs.readFileSync(path.join(SIM, "budget_model.json")));
global.RFID_MODEL = JSON.parse(fs.readFileSync(path.join(SIM, "rfid_model.json")));
global.SAFETY_WEATHER_MODEL = JSON.parse(fs.readFileSync(path.join(SIM, "safety_weather_model.json")));
global.fflate = require("./web/fflate.min.js");
const EB = require("./web/event_bible.js");
const OUT = path.join(__dirname, "out");
const fm = JSON.parse(fs.readFileSync(path.join(OUT, "field_map.json")));

const N = 4000;
const sw = { enabled: true, venue_mode: "outdoor", peak_occupancy: N, show_days: 3, load_in_days: 2, camping: true, nearest_hospital_minutes: 25, ahj_fire_permit_status: "submitted", lightning_stand_down_miles: 8, wind_hold_mph: 35 };
const opts = Object.assign({}, model.defaults, { N, p_camp: 0.6, rfid: { enabled: true, cashlessMode: "closed" }, safetyWeather: sw });
const budget = BudgetEngine.compute(model, opts);
const form = {
  profile: { name: "SAMPLE Fest (fictional)", organizer: "Sample Promotions (fictional)", type: "Music festival", subtype: "Camping", genre: "Indie / electronic", venue: "Sample Ranch (fictional)", street: "", city: "Austin", state: "TX", zip: "", timezone: "America/Chicago", start_date: "2027-04-09", end_date: "2027-04-11", start_time: "12:00", end_time: "23:00", camping: true, limit_registrations: 4500 },
  options: { N, ticket: model.defaults.ticket, camp_fee: model.defaults.camp_fee, p_camp: 0.6 },
  rfid: { enabled: true, cashlessMode: "closed" }, safetyWeather: sw,
};
// Fictional acts; suggested fees split the simulator talent line by a descending weight (SAMPLE ONLY).
const acts = 30, talent = budget.departments.talent, w = Array.from({ length: acts }, (_, i) => 1 / (i + 1)), ws = w.reduce((a, b) => a + b, 0);
const talentObj = { pay: { per_artist: w.map((x, i) => ({ name: "Sample Act " + String(i + 1).padStart(2, "0"), rank: i + 1, suggested_fee: Math.round(talent * x / ws / 500) * 500 })) },
  artists: w.map((x, i) => ({ name: "Sample Act " + String(i + 1).padStart(2, "0"), draw: { mid: Math.round(N * 0.6 * x / w[0] / 10) * 10 } })) };
async function main() {
  let weather = null;
  try { weather = await (await fetch("https://events-patronjourney.message-0ad.workers.dev/api/weather/risk?address=Austin%2C%20TX&date=2027-04-09&days=3")).json(); } catch (e) { console.error("weather", e.message); }
  const data = EB.fromSimulator({ form, budget, model, talent: talentObj, lineupText: "", weather, mc: { pProfit: null }, ros: [], mode: "SAMPLE DATA — fictional event", origin: "https://events-patronjourney.message-0ad.workers.dev" });
  data.scalars.ticket_url = "https://example.com/sample-fest";
  data.scalars.crew_count = 120; data.scalars.volunteer_count = 80; data.scalars.peak_arrival_share = 0.25; data.scalars.shuttle_share = 0.3; data.scalars.people_per_car = 2.5;
  data.lineup_note = "Sample acts and draws are fictional.";
  fs.mkdirSync(path.join(OUT, "sample"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "sample.json"), JSON.stringify(data, null, 1));
  for (const id of Object.keys(fm.files)) {
    const buf = fs.readFileSync(path.join(OUT, fm.files[id].path));
    const bytes = EB.fill(buf, data, fm);
    fs.writeFileSync(path.join(OUT, "sample", id + "-sample.xlsx"), bytes);
  }
  console.log("sample ok", Object.keys(fm.files).length, "files; budget rows", data.tables.budget.length, "lineup", data.tables.lineup.length, "weather", !!(weather && weather.ok));
}
main();
