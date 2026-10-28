/**
 * Curated crowd-voice lines for MC journey presentation.
 * Original bank only — no confession xlsx / real-name ingest.
 * Placeholders: {event} {city} {headliner} {day}
 */
(function (global) {
  "use strict";

  /** Lines usable any run (weather, crush, ingress, toilets, medical staffing, production hygiene). */
  var GENERAL = [
    "Just landed for {event} — someone tell me the shuttle actually exists",
    "Merch line vs first set: the eternal {city} dilemma",
    "Gates open vibes already. Who brought the portable charger brigade",
    "Wristband scan took 4 seconds. Efficiency wins, {event}",
    "First 100ft past security and the sound bleed already hits",
    "Main path jam at the food court fork — follow the flags people",
    "Hydration station queue is a vibe. Free water > mystery punch",
    "Toilet row is actually stocked. Small miracle, big morale",
    "Stage left sightline blocked by a flag forest. Moving uphill",
    "Set changeover clean — no 20-minute mystery pause today",
    "Camp open announcement just dropped. Pack mule mode activated",
    "Quiet hours sign at camp: respect the neighbors, keep the glow",
    "Medical tent visible from the plaza — good signage, better planning",
    "Weather desk says monitor the north cell. Poncho check",
    "Lightning watch posted. Seeking covered areas, not heroics",
    "Wind on the video wall — ops holding tall structures. Smart call",
    "F&B prices posted clearly. No surprise sticker shock at till",
    "Cashless tap worked first try. Rare and appreciated",
    "Merch drop size chart is honest. Medium means medium",
    "Lost & found board already filling with keys and one shoe",
    "Ingress paced well — no cattle-chute energy at Gate B",
    "Security wand check polite and quick. Thank you staff",
    "Accessibility lane marked and moving. Do better industry, copy this",
    "Map app offline packet saved me when bars died near the bowl",
    "Earplugs from the info booth. Hearing is forever",
    "Shade sails near the secondary stage = afternoon survival kit",
    "Crowd density mid-bowl feels managed. Room to dance, room to exit",
    "Volunteer in the orange vest answered three questions. Legend",
    "Production tape lines kept the cable trip hazard honest",
    "Handwash stations by toilets actually have soap. Clap emoji",
    "Peak song, peak smile, peak strangers singing off-key together",
    "Headliner walk-up energy in {city} is unreal right now",
    "{headliner} soundcheck bleed was a free appetizer. No complaints",
    "Day {day} legs say sit, heart says one more stage hop",
    "Camp stove etiquette PSA: aim away from tents. Always",
    "Re-entry wrist check smooth. No drama, no lost time",
    "Water refill > buying another plastic bottle. Planet points",
    "Info booth printed schedule when phones died. Old school clutch",
    "Fence line clear path for EMS. Please do not picnic there",
    "Egress plan posted at every major junction. Read it before midnight",
    "Post-set calm walk-out beats the stampede. Patience pays",
    "Shuttle queue after last song is long but moving. Bring snacks",
    "Someone shared sunscreen at the railing. Festival communism works",
    "Bass from Stage 2 rattling the taco truck in the best way",
    "Photo pit turnover was fair. Everyone got a turn, nobody camped",
    "Ground crew sweeping cups between sets — unsung MVPs",
    "Quiet chill zone behind merch is underrated recovery real estate",
    "Camp neighbor shared jumper cables. Instant lifelong alliance",
    "Storm cell slid east. Sets back on. Collective exhale",
    "Toilet paper restock mid-afternoon. Logistics people eat well tonight",
    "Crowd surf attempt shut down kindly. Floors are for feet here",
    "ASL interpreter on the side screen — inclusion looking sharp",
    "Bike valet still had my wheels. Faith in humanity +1",
    "Overnight security flashlight check was chill, not creepy. Good brief",
    "Morning coffee cart line at camp open: soft launch into Day {day}",
    "Program booklet map matched reality. Cartographers, we see you",
    "Heat flags went yellow; misting fans spun up. Ops paying attention",
    "Bag check for exit routes during the ballad. Adulting at {event}",
    "Stranger returned my dropped badge. Kindness still trends offline",
    "Last song encore into a clean egress. That is how you close a night",
    "Leaving {city} dusty, happy, and already checking next year rumors",
    "Radio chatter from staff sounded coordinated, not chaotic. Respect",
    "Vendor load-out lane kept separate from patrons. Invisible excellence",
    "First timer in the Discord said the journey rail tips helped. Same",
  ];

  /** Only when optional health-protocol intensity toggle is ON. */
  var HEALTH_PROTOCOL = [
    "Temp check lane: staff noted 100.4F threshold on the sandwich board",
    "Signage asks for ~6ft spacing in the slow queue — intensity mode on",
    "Isolation policy card mentions 14-day step-back if symptoms hit staff",
    "Hand hygiene station before wristband: soap, water, no judgment",
    "Mask optional zone marked near medical; follow posted intensity rules",
    "Health protocol desk answering what-if questions without panic theater",
  ];

  var BANNED_PATTERNS = [
    /\b(rape|raping|assaulted|molest)\b/i,
    /\b(overdose|od'd|od on)\b/i,
    /\b(kill myself|kys)\b/i,
    /\b(nigger|nigga|faggot|retard|tranny)\b/i,
    /\b(doxx?|ssn\b|social security)\b/i,
    /\b(how to (buy|sell|dose|hide|cut) .*(drug|molly|coke|heroin|fentanyl|ketamine))\b/i,
    /\b((buy|sell|dose|hide) (molly|coke|heroin|fentanyl|weed brick))\b/i,
    /\b(underage|middle school|elementary).{0,40}(sex|nude|porn)/i,
    /\b(sex|nude|porn).{0,40}(minor|underage|schoolgirl|ptot)\b/i,
    /\bptot\b/i,
    // crude real-name / celebrity doxx style — keep bank generic
    /\b(my name is [A-Z][a-z]+ [A-Z][a-z]+)\b/,
    /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/, // SSN-like
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // phone-like doxx
  ];

  function safeRequire(p) {
    try { return require(p); } catch (e) { return null; }
  }

  /**
   * Accept server-generated lines (Worker, from private R2 sources) only if they
   * pass the shared ban filter; otherwise fall back to the curated bank.
   */
  function acceptGenerated(lines, count, rng, opts, ctx) {
    var ok = (lines || []).filter(filterBanned);
    if (ok.length >= count) return ok.slice(0, count);
    return ok.concat(pickLines(rng || Math.random, count - ok.length, opts, ctx));
  }

  function filterBanned(line) {
    if (!line || typeof line !== "string") return false;
    var s = line.trim();
    if (!s) return false;
    for (var i = 0; i < BANNED_PATTERNS.length; i++) {
      if (BANNED_PATTERNS[i].test(s)) return false;
    }
    // Shared rules (same module the organizer Worker uses for generated lines)
    var shared = global.CrowdBanFilter || (typeof require === "function" ? safeRequire("./crowd_ban_filter.js") : null);
    if (shared && !shared.isAllowed(s)) return false;
    return true;
  }

  function curatedBank(opts) {
    opts = opts || {};
    var out = GENERAL.filter(filterBanned);
    if (opts.healthProtocolOn) {
      out = out.concat(HEALTH_PROTOCOL.filter(filterBanned));
    }
    return out;
  }

  function fillTemplate(line, ctx) {
    ctx = ctx || {};
    return String(line)
      .replace(/\{event\}/g, ctx.event || "the fest")
      .replace(/\{city\}/g, ctx.city || "town")
      .replace(/\{headliner\}/g, ctx.headliner || "the headliner")
      .replace(/\{day\}/g, ctx.day != null ? String(ctx.day) : "1");
  }

  function pickLines(rng, count, opts, ctx) {
    var bank = curatedBank(opts);
    var picks = [];
    var used = {};
    var guard = 0;
    while (picks.length < count && guard < count * 8) {
      guard++;
      var idx = Math.floor(rng() * bank.length);
      if (used[idx]) continue;
      used[idx] = true;
      var raw = bank[idx];
      if (!filterBanned(raw)) continue;
      var filled = fillTemplate(raw, ctx);
      if (filled.length > 140) filled = filled.slice(0, 137) + "...";
      if (!filterBanned(filled)) continue;
      picks.push(filled);
    }
    return picks;
  }

  function anonHandle(rng) {
    var n = Math.floor(rng() * 9000) + 1000;
    return "@anon" + n;
  }

  global.CrowdBank = {
    GENERAL: GENERAL,
    HEALTH_PROTOCOL: HEALTH_PROTOCOL,
    filterBanned: filterBanned,
    curatedBank: curatedBank,
    fillTemplate: fillTemplate,
    pickLines: pickLines,
    acceptGenerated: acceptGenerated,
    anonHandle: anonHandle,
  };
})(typeof window !== "undefined" ? window : global);
