/**
 * OPS radio / incident log templates mapped to journey stages + MC shocks.
 * Severity: Info | Watch | Incident | Stop
 */
(function (global) {
  "use strict";

  var STAGES = [
    { id: "prearrival", label: "Pre-arrival", hideIfCampingOff: false },
    { id: "queue", label: "Queue / ingress", hideIfCampingOff: false },
    { id: "wristband", label: "Wristband / first 100ft", hideIfCampingOff: false },
    { id: "circulation", label: "Circulation", hideIfCampingOff: false },
    { id: "fnb", label: "F&B / merch", hideIfCampingOff: false },
    { id: "program", label: "Program", hideIfCampingOff: false },
    { id: "camping", label: "Camping", hideIfCampingOff: true },
    { id: "medical", label: "Medical", hideIfCampingOff: false },
    { id: "weather", label: "Weather / emergency", hideIfCampingOff: false },
    { id: "egress", label: "Egress", hideIfCampingOff: false },
  ];

  /**
   * Templates: stage, shock keys that elevate them, severities by harshness (0 soft … 2 hard)
   */
  var TEMPLATES = [
    {
      id: "gate_open",
      stage: "queue",
      shocks: [],
      severity: ["Info", "Info", "Watch"],
      line: "Gates staffed; bag check lanes paced to ticket scan rate.",
      mitigation: "Hold overflow in shade queue; open Lane C if wait >12 min.",
    },
    {
      id: "attn_soft",
      stage: "prearrival",
      shocks: ["attendance"],
      severity: ["Info", "Watch", "Incident"],
      line: "Advance scan rate below plan — walk-up and will-call pressure rising.",
      mitigation: "Add box-office runners; push shuttle ETA SMS.",
    },
    {
      id: "ingress_crush",
      stage: "queue",
      shocks: ["attendance"],
      severity: ["Watch", "Incident", "Stop"],
      line: "Ingress density high at Gate A choke — temporary meter-in.",
      mitigation: "Split queue; deploy barrier wing; PA ask for patience.",
    },
    {
      id: "wrist_scan",
      stage: "wristband",
      shocks: ["onsite"],
      severity: ["Info", "Watch", "Watch"],
      line: "Wristband encode lag on two stations; failover handhelds live.",
      mitigation: "Swap battery bank; route VIP to Station 4.",
    },
    {
      id: "first_100",
      stage: "wristband",
      shocks: [],
      severity: ["Info", "Info", "Watch"],
      line: "First 100ft clear — wayfinding flags up, no cable trip reports.",
      mitigation: "Spot-check tape lines every 30 min.",
    },
    {
      id: "circulation_jam",
      stage: "circulation",
      shocks: ["attendance", "production"],
      severity: ["Watch", "Incident", "Incident"],
      line: "Main artery slow between Plaza and Stage 2 — bidirectional pinch.",
      mitigation: "One-way pulse 10 min; move cart traffic to service road.",
    },
    {
      id: "prod_hygiene",
      stage: "circulation",
      shocks: ["production"],
      severity: ["Info", "Watch", "Incident"],
      line: "Cable pass uncovered at crossover — production hygiene flag.",
      mitigation: "Yellow jacket + steward until deck lid returns.",
    },
    {
      id: "fnb_spend",
      stage: "fnb",
      shocks: ["onsite"],
      severity: ["Info", "Watch", "Incident"],
      line: "F&B ticket average soft vs plan; merch still tracking.",
      mitigation: "Push combo specials; open second merch till.",
    },
    {
      id: "toilet_stock",
      stage: "fnb",
      shocks: ["attendance"],
      severity: ["Info", "Watch", "Incident"],
      line: "Toilet block B paper/water low after peak set.",
      mitigation: "Service cart priority; temp close 2 stalls for restock.",
    },
    {
      id: "talent_cost",
      stage: "program",
      shocks: ["talent"],
      severity: ["Info", "Watch", "Incident"],
      line: "Artist hospitality rider extras hitting production contingency.",
      mitigation: "Cap backline adds; route overage to day-2 hold.",
    },
    {
      id: "set_delay",
      stage: "program",
      shocks: ["production", "weather"],
      severity: ["Watch", "Incident", "Stop"],
      line: "Changeover overrun on main — audio snake fault under deck.",
      mitigation: "Spare loom hot; slip set 12 min; notify screens.",
    },
    {
      id: "camp_open",
      stage: "camping",
      shocks: ["camp"],
      severity: ["Info", "Watch", "Watch"],
      line: "Camp open confirmed; quiet-hours brief to overnight security.",
      mitigation: "Extra rover on Loop C; fire-lane keep-clear sweep.",
    },
    {
      id: "camp_mix",
      stage: "camping",
      shocks: ["camp", "weather"],
      severity: ["Info", "Watch", "Incident"],
      line: "Camping mix softer than plan — day parking overflow heavier.",
      mitigation: "Rebalance lot B; keep camp shuttle cadence.",
    },
    {
      id: "medical_staff",
      stage: "medical",
      shocks: ["attendance", "weather"],
      severity: ["Info", "Watch", "Incident"],
      line: "Medical volume elevated — heat/exhaustion cluster at misting fans.",
      mitigation: "Open aid satchel B; request one additional EMT pair.",
    },
    {
      id: "weather_cell",
      stage: "weather",
      shocks: ["weather"],
      severity: ["Watch", "Incident", "Stop"],
      line: "Weather desk: cell approaching; wind hold watch on tall structures.",
      mitigation: "Lower video wall; stage managers on lightning SOP.",
    },
    {
      id: "weather_cost",
      stage: "weather",
      shocks: ["weather", "production"],
      severity: ["Info", "Watch", "Incident"],
      line: "Ground protection and delay labor bank drawing against weather reserve.",
      mitigation: "Track hours; do not touch cancellation reserve yet.",
    },
    {
      id: "egress_plan",
      stage: "egress",
      shocks: [],
      severity: ["Info", "Info", "Watch"],
      line: "Egress routes lit; lot release staged north→south.",
      mitigation: "Hold rideshare curb until pedestrian pulse clears.",
    },
    {
      id: "egress_crush",
      stage: "egress",
      shocks: ["attendance"],
      severity: ["Watch", "Incident", "Stop"],
      line: "Egress surge at South Gate — temporary hold on lot C release.",
      mitigation: "Meter pedestrians; PA calm message; open Gate D.",
    },
    // Health-protocol intensity (optional) — tagged
    {
      id: "hp_spacing",
      stage: "queue",
      shocks: [],
      healthProtocol: true,
      severity: ["Info", "Watch", "Watch"],
      line: "Health protocol ON: queue markers at ~6ft in slow lane.",
      mitigation: "Stewards coach spacing; do not invent capacity cuts.",
    },
    {
      id: "hp_temp",
      stage: "medical",
      shocks: [],
      healthProtocol: true,
      severity: ["Info", "Watch", "Incident"],
      line: "Staff briefing: fever screen reference 100.4F per posted protocol.",
      mitigation: "Symptomatic workers to isolation desk; no public shaming.",
    },
    {
      id: "hp_isolation",
      stage: "medical",
      shocks: [],
      healthProtocol: true,
      severity: ["Watch", "Watch", "Incident"],
      line: "Protocol card: 14-day isolation path if confirmed workplace exposure.",
      mitigation: "Notify HQ only; keep patron messaging factual.",
    },
  ];

  function activeStages(campingOn) {
    return STAGES.filter(function (s) {
      return !(s.hideIfCampingOff && !campingOn);
    });
  }

  function harshnessFromDraw(draw, band) {
    // band: P10 hard, P50 mid, P90 soft
    if (band === "P10") return 2;
    if (band === "P90") return 0;
    return 1;
  }

  function shockFlags(draw) {
    draw = draw || {};
    var s = draw.shocks || {};
    var flags = {};
    if (s.attnMult != null && s.attnMult < 0.92) flags.attendance = true;
    if (s.attnMult != null && s.attnMult > 1.08) flags.attendanceUp = true;
    if (s.talentMult != null && s.talentMult > 1.12) flags.talent = true;
    if (s.prodMult != null && s.prodMult > 1.08) flags.production = true;
    if (s.onsiteMult != null && s.onsiteMult < 0.9) flags.onsite = true;
    if (s.campMixDelta != null && s.campMixDelta < -0.05) flags.camp = true;
    if (s.weatherCost != null && s.weatherCost > 1.04) flags.weather = true;
    if (s.weatherAttn != null && s.weatherAttn < 0.97) flags.weather = true;
    return flags;
  }

  function moneyDelta(draw, templateId) {
    var d = draw || {};
    var base = d.baseNet != null ? d.baseNet : 0;
    var net = d.net != null ? d.net : base;
    var totalDelta = net - base;
    // Attribute a slice of delta to this incident type (display only)
    var weight = 0.08;
    if (/weather|talent|attn|ingress|egress_crush|fnb|set_delay/.test(templateId)) weight = 0.14;
    if (/gate_open|first_100|egress_plan|wrist_scan|camp_open|hp_/.test(templateId)) weight = 0.03;
    var money = Math.round(totalDelta * weight);
    var attnBase = d.baseN || 1;
    var attnNow = d.N || attnBase;
    var attnDelta = Math.round((attnNow - attnBase) * (weight / 0.5));
    return { money: money, attendance: attnDelta };
  }

  /**
   * Build OPS lines for a journey stage given representative draw + band.
   */
  function linesForStage(stageId, draw, band, opts) {
    opts = opts || {};
    var harsh = harshnessFromDraw(draw, band);
    var flags = shockFlags(draw);
    var healthOn = !!opts.healthProtocolOn;
    var out = [];

    TEMPLATES.forEach(function (t) {
      if (t.stage !== stageId) return;
      if (t.healthProtocol && !healthOn) return;
      var relevant = !t.shocks || t.shocks.length === 0;
      if (t.shocks && t.shocks.length) {
        relevant = t.shocks.some(function (k) {
          return flags[k];
        });
        // Soft band still gets some Info baseline
        if (!relevant && harsh === 0 && t.shocks.length && Math.random) {
          // deterministic: only baseline empties
          relevant = false;
        }
      }
      // Always include pure baseline Info templates on soft/mid
      if (!t.shocks || t.shocks.length === 0) {
        if (t.healthProtocol && !healthOn) return;
        // On P10, still show baselines as Watch sometimes
        relevant = true;
      }
      // Hard day: skip happy-only if shock template not relevant — already handled
      if (!relevant && harsh < 2) return;
      if (!relevant && harsh === 2) {
        // still skip unrelated shock templates
        return;
      }

      var sev = (t.severity && t.severity[harsh]) || "Info";
      // P90: clamp Stop/Incident down for non-weather
      if (band === "P90" && sev === "Stop") sev = "Watch";
      if (band === "P90" && sev === "Incident" && !(flags.weather && t.stage === "weather"))
        sev = "Info";
      // P10: elevate shock-linked
      if (band === "P10" && relevant && t.shocks && t.shocks.length && sev === "Info")
        sev = "Watch";

      var deltas = moneyDelta(draw, t.id);
      out.push({
        id: t.id,
        stage: t.stage,
        severity: sev,
        sentence: t.line,
        mitigation: t.mitigation,
        moneyDelta: deltas.money,
        attendanceDelta: deltas.attendance,
        healthProtocol: !!t.healthProtocol,
      });
    });

    // Ensure at least one line per stage
    if (!out.length) {
      out.push({
        id: "heartbeat",
        stage: stageId,
        severity: "Info",
        sentence: "Net clear — no material flags this window.",
        mitigation: "Maintain cadence; next check on ROS cue.",
        moneyDelta: 0,
        attendanceDelta: 0,
      });
    }
    return out;
  }

  /**
   * Pick primary debrief stages that moved money/risk.
   */
  function debriefStages(draw, campingOn) {
    var flags = shockFlags(draw);
    var scored = [
      { stage: "prearrival", score: flags.attendance ? 3 : 0 },
      { stage: "queue", score: flags.attendance ? 2 : 1 },
      { stage: "fnb", score: flags.onsite ? 3 : 0 },
      { stage: "program", score: (flags.talent ? 3 : 0) + (flags.production ? 2 : 0) },
      { stage: "camping", score: flags.camp ? 3 : 0 },
      { stage: "medical", score: flags.attendance || flags.weather ? 2 : 0 },
      { stage: "weather", score: flags.weather ? 4 : 0 },
      { stage: "egress", score: flags.attendance ? 1 : 0 },
      { stage: "circulation", score: flags.production ? 2 : 0 },
    ];
    if (!campingOn) scored = scored.filter(function (s) { return s.stage !== "camping"; });
    scored.sort(function (a, b) { return b.score - a.score; });
    var top = scored.filter(function (s) { return s.score > 0; }).slice(0, 3);
    if (top.length < 3) {
      ["program", "queue", "egress"].forEach(function (id) {
        if (top.length >= 3) return;
        if (!top.some(function (t) { return t.stage === id; })) {
          if (id === "camping" && !campingOn) return;
          top.push({ stage: id, score: 0 });
        }
      });
    }
    return top.slice(0, 3).map(function (t) {
      var lines = linesForStage(t.stage, draw, "P50", {});
      var best = lines[0];
      return {
        stage: t.stage,
        label: (STAGES.find(function (s) { return s.id === t.stage; }) || {}).label || t.stage,
        opsLine: best ? best.sentence : "",
        severity: best ? best.severity : "Info",
        moneyDelta: best ? best.moneyDelta : 0,
      };
    });
  }

  global.OpsBank = {
    STAGES: STAGES,
    TEMPLATES: TEMPLATES,
    activeStages: activeStages,
    shockFlags: shockFlags,
    linesForStage: linesForStage,
    debriefStages: debriefStages,
    harshnessFromDraw: harshnessFromDraw,
  };
})(typeof window !== "undefined" ? window : global);
