/**
 * Festival Forecaster v1.1 — richer multi-tab blank ops templates (.xlsx via SheetJS).
 * Header stamp from wizard profile ONLY. Empty data rows. No sensitive source details.
 */
(function (global) {
  "use strict";

  var SAFETY_FOOTER =
    "Checklist / budget placeholder — not a safety plan and not legal advice.";

  var EMPTY_ROWS = 12;

  /* ---------- profile helpers ---------- */

  function yn(v) {
    return v ? "Y" : "N";
  }

  function showDayCount(profile) {
    if (profile && profile.show_days != null && Number(profile.show_days) > 0) {
      return Math.min(14, Math.max(1, Math.floor(Number(profile.show_days))));
    }
    var start = profile && profile.start_date ? Date.parse(profile.start_date) : NaN;
    var end = profile && profile.end_date ? Date.parse(profile.end_date) : NaN;
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      var days = Math.round((end - start) / 86400000) + 1;
      return Math.min(14, Math.max(1, days));
    }
    return 2;
  }

  function dateList(profile) {
    var n = showDayCount(profile);
    var start = profile && profile.start_date ? Date.parse(profile.start_date) : NaN;
    var out = [];
    var i;
    if (!isNaN(start)) {
      for (i = 0; i < n; i++) {
        var d = new Date(start + i * 86400000);
        out.push(d.toISOString().slice(0, 10));
      }
    } else {
      for (i = 0; i < n; i++) out.push("Day " + (i + 1));
    }
    return out;
  }

  function stampRows(profile) {
    var p = profile || {};
    var dates = [p.start_date, p.end_date].filter(Boolean).join(" – ");
    var city = [p.city, p.state].filter(Boolean).join(", ");
    var typeBits = [p.type, p.subtype, p.genre].filter(Boolean).join(" / ");
    var camping =
      p.camping === true || p.camping === "on" || p.camping === "Y"
        ? "Y"
        : p.camping === false || p.camping === "off" || p.camping === "N"
          ? "N"
          : "";
    var N = p.N != null && p.N !== "" ? String(p.N) : "";
    var caps = [];
    if (p.budget_cap != null && p.budget_cap !== "") caps.push("Budget cap: " + p.budget_cap);
    if (p.talent_cap != null && p.talent_cap !== "") caps.push("Talent cap: " + p.talent_cap);
    if (p.marketing_cap != null && p.marketing_cap !== "")
      caps.push("Marketing cap: " + p.marketing_cap);

    return [
      ["Festival", p.name || ""],
      ["Start–End", dates],
      ["City, State", city],
      ["Type / subtype / genre", typeBits],
      ["Attendance N", N],
      ["Camping", camping],
      ["Budget / talent cap", caps.join(" · ")],
      [],
    ];
  }

  function talentNamesText(profile) {
    var t = profile && (profile.talent_names || profile.talents || profile.artists);
    if (!t) return "";
    if (Array.isArray(t)) return t.filter(Boolean).join(", ");
    return String(t);
  }

  /* ---------- SheetJS helpers ---------- */

  function xlsxLib() {
    return (
      (typeof global !== "undefined" && global.XLSX) ||
      (typeof window !== "undefined" && window.XLSX) ||
      null
    );
  }

  function blankRows(cols, n) {
    var rows = [];
    var i;
    var c = cols || 5;
    var count = n != null ? n : EMPTY_ROWS;
    for (i = 0; i < count; i++) {
      var r = [];
      var j;
      for (j = 0; j < c; j++) r.push("");
      rows.push(r);
    }
    return rows;
  }

  function sheetFromAoA(aoa) {
    var XLSX = xlsxLib();
    return XLSX.utils.aoa_to_sheet(aoa);
  }

  function bookWithSheets(sheetMap) {
    var XLSX = xlsxLib();
    if (!XLSX) throw new Error("SheetJS (XLSX) not loaded — add CDN script before templates.js");
    var wb = XLSX.utils.book_new();
    Object.keys(sheetMap).forEach(function (name) {
      var safe = String(name).slice(0, 31);
      XLSX.utils.book_append_sheet(wb, sheetMap[name], safe);
    });
    return wb;
  }

  function workbookToArrayBuffer(wb) {
    var XLSX = xlsxLib();
    return XLSX.write(wb, { bookType: "xlsx", type: "array" });
  }

  function downloadArrayBuffer(filename, buffer) {
    var blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  function withStamp(profile, headerRow, dataRows, footer) {
    var aoa = stampRows(profile);
    if (headerRow && headerRow.length) aoa.push(headerRow);
    (dataRows || []).forEach(function (r) {
      aoa.push(r);
    });
    if (footer) {
      aoa.push([]);
      aoa.push([footer]);
    }
    return sheetFromAoA(aoa);
  }

  function checklistSheet(profile, items, extraCols) {
    var cols = ["Item", "Done", "Owner", "Due", "Notes"].concat(extraCols || []);
    var rows = (items || []).map(function (it) {
      return [it, "", "", "", ""];
    });
    while (rows.length < Math.max(items.length, 8)) {
      rows.push(["", "", "", "", ""]);
    }
    return withStamp(profile, cols, rows);
  }

  /* ---------- 1. Talent ---------- */

  function buildTalent(profile) {
    var dayBudgets = [["Day", "Stage / area", "Slot count", "Budget $", "Notes"]].concat(
      dateList(profile).map(function (d) {
        return [d, "", "", "", ""];
      })
    );
    dayBudgets = dayBudgets.concat(blankRows(5, EMPTY_ROWS));

    var billing = [
      ["Act / billing name", "Tier", "Billing position", "Co-bill with", "Approved Y/N", "Notes"],
    ].concat(blankRows(6, EMPTY_ROWS));

    var timeslots = [
      ["Date", "Stage", "Slot", "Start", "End", "Set length (min)", "Changeover (min)", "ACT", "Notes"],
    ].concat(blankRows(9, EMPTY_ROWS));

    var offers = [
      [
        "Act",
        "Offer $",
        "Deposit $",
        "Deposit due",
        "Balance due",
        "Status",
        "Agency / contact",
        "Notes",
      ],
    ].concat(blankRows(8, EMPTY_ROWS));

    var avails = [
      ["Act", "Agent", "Genre", "Offer band $", "Status", "Hold date", "Notes"],
    ].concat(blankRows(7, EMPTY_ROWS));

    var genreMap = [
      ["Genre", "Target # acts", "Booked #", "Day preference", "Stage preference", "Notes"],
      ["", "", "", "", "", ""],
      ["", "", "", "", "", ""],
      ["", "", "", "", "", ""],
      ["", "", "", "", "", ""],
      ["", "", "", "", "", ""],
      ["", "", "", "", "", ""],
      ["", "", "", "", "", ""],
      ["", "", "", "", "", ""],
    ].concat(blankRows(6, 6));

    var coverAoa = stampRows(profile).concat([
      ["Talent names (user-typed only — ACT columns stay blank otherwise)", talentNamesText(profile)],
      [],
      ["Notes", ""],
    ]).concat(blankRows(2, 8));

    return bookWithSheets({
      Cover: sheetFromAoA(coverAoa),
      "Day budgets": withStamp(profile, dayBudgets[0], dayBudgets.slice(1)),
      Billing: withStamp(profile, billing[0], billing.slice(1)),
      Timeslots: withStamp(profile, timeslots[0], timeslots.slice(1)),
      "Offers & deposits": withStamp(profile, offers[0], offers.slice(1)),
      Avails: withStamp(profile, avails[0], avails.slice(1)),
      "Genre map": withStamp(profile, genreMap[0], genreMap.slice(1)),
    });
  }

  /* ---------- 2. Artists marketing ---------- */

  function buildArtistsMarketing(profile) {
    var tier = [
      ["Tier", "Channel", "Requirement", "Total needed", "Notes"],
      ["All tiers", "Newsletter", "2×", "2", ""],
      ["All tiers", "Website / site feature", "2×", "2", ""],
      ["All tiers", "Social posts", "3×", "3", ""],
      ["All tiers", "FB event", "1×", "1", ""],
      ["Tier 1", "Newsletter", "", "", ""],
      ["Tier 1", "Website", "", "", ""],
      ["Tier 1", "Socials", "", "", ""],
      ["Tier 1", "FB Event", "", "", ""],
      ["Tier 2", "Newsletter", "", "", ""],
      ["Tier 2", "Website", "", "", ""],
      ["Tier 2", "Socials", "", "", ""],
      ["Tier 2", "FB Event", "", "", ""],
      ["Tier 3", "Newsletter", "", "", ""],
      ["Tier 3", "Website", "", "", ""],
      ["Tier 3", "Socials", "", "", ""],
      ["Tier 3", "FB Event", "", "", ""],
    ];

    var grid = [
      [
        "Artist",
        "Tier",
        "Instagram",
        "Twitter / X",
        "Facebook",
        "FB Event Page",
        "Other SM",
        "Newsletter",
        "Website",
        "Status",
        "Notes",
      ],
    ].concat(blankRows(11, EMPTY_ROWS));

    var campaign = [
      [
        "Campaign",
        "Artist / tier",
        "Channel",
        "Asset ready Y/N",
        "Scheduled date",
        "Posted Y/N",
        "Link / UTM",
        "Notes",
      ],
    ].concat(blankRows(8, EMPTY_ROWS));

    return bookWithSheets({
      "Tier requirements": withStamp(profile, tier[0], tier.slice(1)),
      "Per-artist grid": withStamp(profile, grid[0], grid.slice(1)),
      Campaigns: withStamp(profile, campaign[0], campaign.slice(1)),
    });
  }

  /* ---------- 3. Lineup announce ---------- */

  var LINEUP_SECTIONS = {
    Admin: [
      "Marketing plan outline + prior announce baselines",
      "Timeline — announce date/time + public onsale locked",
      "Budget — expenses proposed / approved / communicated",
      "Ticketing — tiers, prices, packages; early-bird off-sale",
      "Company-wide announce dates communicated",
      "Executive report templates ready",
    ],
    Content: [
      "Admat — logo, date/location, lineup, onsale date, URL",
      "Lineup video — concept, produce, edit, approvals",
      "Social graphics",
      "Website hero / slider design",
      "Print ad creative",
      "Digital ads creative (display / social)",
      "Email graphics",
      "Onsale branding assets + sold-out graphics",
    ],
    Website: [
      "Homepage hero / nav updated",
      "Lineup + artist + sponsor pages created",
      "Blog / press release / FAQs updated",
      "Tickets page — pricing & packages",
      "SEO keywords + schema",
      "QA desktop + mobile (links, images, usability)",
    ],
    Publicity: [
      "Press release written; embargo list ready",
      "Media list + teaser",
      "Media partner promo support negotiated",
      "Influencer outreach + scheduled posts",
      "Artist management contacted; graphics + trackable links",
      "Local / tourism contacts + collateral",
      "Reference listings updated on announce day",
    ],
    Social: [
      "Instagram — teasers, lineup post, video, admat, onsale",
      "X / Twitter — teasers, post, video, admat, onsale",
      "Snapchat / short-form — teasers + formatted assets",
      "YouTube / Vimeo — video uploaded (protected until drop)",
      "Cross-post schedule locked to announce timezone",
    ],
    Ads: [
      "Search campaigns — targeting + copy",
      "Display campaigns — audiences + creatives",
      "Video / pre-roll — audiences + schedule",
      "Social paid boost budget allocation",
      "Geo-fence / hold competitor ads if used",
    ],
    Data: [
      "Website analytics tags verified",
      "Ad / pixel tracking verified",
      "Dashboards + baseline KPIs from prior announces",
      "UTM taxonomy documented",
      "Hourly sell-through monitor plan",
    ],
    Email: [
      "List scrubbed / segmented",
      "Lineup email created + approved",
      "Onsale email created + scheduled",
      "Add-to-calendar link",
      "SMS companion (if used)",
    ],
    Street: [
      "Team leads notified",
      "Collateral ordered / printed / staged",
      "Local business promos coordinated",
      "Distribution start plan (announce day)",
      "Digital street team — graphics + talking points + links",
    ],
    Radio: [
      "Flight schedules planned / contracted",
      "Station promotions negotiated",
      "Spots written / produced / approved / delivered",
      "Press release under embargo to stations",
    ],
    Print: [
      "Ads planned / negotiated / IO signed",
      "Promo packages secured",
      "Creative approved + sent to publication",
    ],
    Sponsors: [
      "Brand assets distributed to sponsors",
      "Suggested announce copy + trackable links",
      "Website partners page approval",
      "Print / digital co-brand approvals",
    ],
    Talent: [
      "Billing order confirmed",
      "Graphics approval from management / agencies",
      "Asset approvals — press, email, social, video, print, radio",
      "Announce copy + trackable links to management",
    ],
  };

  function buildLineupAnnounce(profile) {
    var sheets = {};
    Object.keys(LINEUP_SECTIONS).forEach(function (name) {
      sheets[name] = checklistSheet(profile, LINEUP_SECTIONS[name]);
    });
    return bookWithSheets(sheets);
  }

  /* ---------- 4. Go-to-market ---------- */

  function buildGoToMarket(profile) {
    var milestones = [
      ["Milestone", "Target date", "Owner", "Status", "Notes"],
      ["Web requirements kickoff", "", "", "", ""],
      ["Weekly ops call kickoff", "", "", "", ""],
      ["Final sign-off on web pages", "", "", "", ""],
      ["Password / soft launch", "", "", "", ""],
      ["Public onsale", "", "", "", ""],
      ["Lineup announce", "", "", "", ""],
      ["Weekly check-in cadence set", "", "", "", ""],
    ].concat(blankRows(5, 8));

    var funnel = [
      ["Page / step", "URL / slug", "Ready Y/N", "Owner", "Notes"],
      ["Tickets", "", "", "", ""],
      ["Lodging / camping", "", "", "", ""],
      ["Add-ons / extras", "", "", "", ""],
      ["Cart / checkout", "", "", "", ""],
      ["Confirmation / thank-you", "", "", "", ""],
      ["Account / manage order", "", "", "", ""],
    ].concat(blankRows(5, 8));

    var calendar = [
      ["Week of", "Channel", "Message / theme", "Audience", "Budget $", "Owner", "Status", "Notes"],
    ].concat(blankRows(8, EMPTY_ROWS));

    var audience = [
      ["Segment", "Size est.", "Channel mix", "Offer", "Priority", "Notes"],
    ].concat(blankRows(6, EMPTY_ROWS));

    var mix = [
      ["Channel", "% of media $", "Weekly cadence", "KPI", "Notes"],
      ["Email", "", "", "", ""],
      ["Paid social", "", "", "", ""],
      ["Search", "", "", "", ""],
      ["Display / programmatic", "", "", "", ""],
      ["Influencer / creator", "", "", "", ""],
      ["PR / publicity", "", "", "", ""],
      ["Street / OOH", "", "", "", ""],
      ["Radio", "", "", "", ""],
      ["Print", "", "", "", ""],
    ].concat(blankRows(5, 6));

    return bookWithSheets({
      Milestones: withStamp(profile, milestones[0], milestones.slice(1)),
      "Funnel pages": withStamp(profile, funnel[0], funnel.slice(1)),
      "Weekly media calendar": withStamp(profile, calendar[0], calendar.slice(1)),
      Audiences: withStamp(profile, audience[0], audience.slice(1)),
      Mix: withStamp(profile, mix[0], mix.slice(1)),
    });
  }

  /* ---------- 5. ROS Fred-style ---------- */

  function buildRos(profile) {
    var stages = ["Stage 1 (Main)", "Stage 2", "Stage 3"];
    var dates = dateList(profile);
    var sheets = {};
    dates.forEach(function (dayLabel, idx) {
      var aoa = stampRows(profile);
      aoa.push(["Show day", dayLabel]);
      aoa.push([]);
      // stage header row
      var stageHeader = [];
      stages.forEach(function (st, si) {
        if (si) stageHeader.push("");
        stageHeader.push(st, "", "", "", "");
      });
      stageHeader.push("");
      stageHeader.push("All stages", "", "", "", "");
      aoa.push(stageHeader);

      var colHeader = [];
      stages.forEach(function (st, si) {
        if (si) colHeader.push("");
        colHeader.push("SLOT", "TYPE", "TIMES", "ACT", "NOTES");
      });
      colHeader.push("");
      colHeader.push("SLOT", "TYPE", "TIMES", "ACT", "NOTES");
      aoa.push(colHeader);

      var slotN = 8;
      var s;
      for (s = 1; s <= slotN; s++) {
        var row = [];
        stages.forEach(function (st, si) {
          if (si) row.push("");
          row.push("S" + (si + 1) + "-" + s, "", "", "", "");
        });
        row.push("");
        row.push("", "", "", "", "");
        aoa.push(row);
        // changeover row
        var ch = [];
        stages.forEach(function (st, si) {
          if (si) ch.push("");
          ch.push("CO" + (si + 1) + "-" + s, "Changeover", "", "", "");
        });
        ch.push("");
        ch.push("", "", "", "", "");
        aoa.push(ch);
      }

      aoa.push([]);
      var hold = [];
      stages.forEach(function (st, si) {
        if (si) hold.push("");
        hold.push("", "", "", "", "");
      });
      hold.push("");
      hold.push("HOLD", "Weather hold", "", "", "All-stages weather hold");
      aoa.push(hold);
      aoa.push([]);
      aoa.push(["ACT columns intentionally blank — fill from your lineup only."]);

      var sheetName = "Day " + (idx + 1);
      if (dayLabel && /^\d{4}-\d{2}-\d{2}$/.test(dayLabel)) {
        sheetName = dayLabel;
      }
      sheets[sheetName] = sheetFromAoA(aoa);
    });
    return bookWithSheets(sheets);
  }

  /* ---------- 6. Area hours ---------- */

  function buildAreaHours(profile) {
    var locations = [
      "Gates",
      "Box office",
      "Stages",
      "Bars",
      "Medical",
      "Info",
      "Kids",
      "Camp",
      "Volunteer HQ",
    ];
    var dates = dateList(profile);
    var header = ["Location"].concat(
      dates.reduce(function (acc, d) {
        return acc.concat([d + " open", d + " close"]);
      }, [])
    );
    header.push("Notes");
    var rows = locations.map(function (loc) {
      var r = [loc];
      dates.forEach(function () {
        r.push("", "");
      });
      r.push("");
      return r;
    });
    rows = rows.concat(blankRows(header.length, 8));
    return bookWithSheets({
      "Area hours": withStamp(profile, header, rows),
    });
  }

  /* ---------- 7. Load-in ---------- */

  function buildLoadIn(profile) {
    var header = [
      "Item",
      "Spec",
      "Zone",
      "Power",
      "Vendor",
      "Date in",
      "Days on site",
      "Crew count",
      "Notes",
    ];
    var seed = [
      ["Staging / deck", "", "", "", "", "", "", "", ""],
      ["Roof / cover", "", "", "", "", "", "", "", ""],
      ["FOH position", "", "", "", "", "", "", "", ""],
      ["Barricade", "", "", "", "", "", "", "", ""],
      ["Power distro", "", "", "", "", "", "", "", ""],
      ["Backline", "", "", "", "", "", "", "", ""],
      ["Soft goods", "", "", "", "", "", "", "", ""],
      ["Site infra", "", "", "", "", "", "", "", ""],
    ];
    var rows = seed.concat(blankRows(9, EMPTY_ROWS));
    return bookWithSheets({
      "Load-in": withStamp(profile, header, rows),
    });
  }

  /* ---------- 8. Transport ---------- */

  function buildTransport(profile) {
    var header = [
      "Date",
      "Kind",
      "Route",
      "Depart",
      "Duration",
      "Arrive",
      "Vendor",
      "Vehicle class",
      "Capacity",
      "Tickets sold",
      "Notes",
    ];
    return bookWithSheets({
      Transport: withStamp(profile, header, blankRows(11, EMPTY_ROWS)),
    });
  }

  /* ---------- 9. RFID / POS ---------- */

  function rfidUnitPriceCatalog() {
    var model =
      (typeof global !== "undefined" && global.RFID_MODEL) ||
      (typeof window !== "undefined" && window.RFID_MODEL) ||
      null;
    if (model && Array.isArray(model.catalog)) return model.catalog;
    return [
      { id: "ticketing_fee", label: "Ticketing (platform/ticket fee)", unit_price: 1.49, unit: "per_attendee" },
      { id: "scanner", label: "Access-control scanner", unit_price: 125, unit: "each" },
      { id: "truss", label: "Truss", unit_price: 20, unit: "each" },
      { id: "registration_kiosk", label: "Registration station / kiosk (AC)", unit_price: 75, unit: "each" },
      { id: "pos", label: "POS terminal", unit_price: 85, unit: "each" },
      { id: "platform_fee", label: "Platform fee(s)", unit_price: 1450, unit: "flat" },
      { id: "activation_fee", label: "Activation fee", unit_price: 0.48, unit: "per_attendee" },
      { id: "shipping_service", label: "Shipping / service", unit_price: 600, unit: "flat" },
      { id: "labor_traveling", label: "Labor (traveling)", unit_price: 600, unit: "each" },
      { id: "labor_local", label: "Labor (local)", unit_price: 450, unit: "each" },
      { id: "travel_perdiem", label: "Travel, transport, per diem", unit_price: 720, unit: "each" },
      { id: "rfid_consumable", label: "RFID wristband / consumable", unit_price: 0.45, unit: "per_attendee" },
      { id: "mail_fulfill", label: "Mail fulfillment", unit_price: 7.02, unit: "per_order" },
    ];
  }

  function buildRfidPos(profile) {
    var catalog = rfidUnitPriceCatalog();
    var unitRows = catalog.map(function (c) {
      return [c.label, c.unit_price, c.unit, "", "", ""];
    });
    var access = [
      ["Gate / entrance count", ""],
      ["Scanner count", ""],
      ["Registration / kiosk count", ""],
      ["Truss / mount count", ""],
      ["Offline mode plan", ""],
      ["Notes", ""],
    ];
    var cashless = [
      ["Cashless mode (closed / open / hybrid / none)", ""],
      ["POS terminal count", ""],
      ["Cashless % target", ""],
      ["Settlement contact", ""],
      ["Chargeback process", ""],
      ["Notes", ""],
    ];
    var labor = [
      ["Labor traveling count", ""],
      ["Labor local count", ""],
      ["Travel / per diem count", ""],
      ["Notes", ""],
    ];
    var shipping = [
      ["Shipping / service", ""],
      ["Mail fulfillment orders", ""],
      ["RFID consumable qty", ""],
      ["Notes", ""],
    ];
    var passthrough = [
      ["Consumer ticket fee (pass-through, NOT opex)", "7.00"],
      ["Consumer fulfill fee (pass-through, NOT opex)", "4.99"],
      ["Notes", ""],
    ];

    return bookWithSheets({
      "Unit catalog": withStamp(
        profile,
        ["Line", "Unit price", "Unit", "Qty (blank)", "Extended", "Notes"],
        unitRows.concat(blankRows(6, 4))
      ),
      Access: withStamp(profile, ["Field", "Value"], access.concat(blankRows(2, 6))),
      Cashless: withStamp(profile, ["Field", "Value"], cashless.concat(blankRows(2, 6))),
      Labor: withStamp(profile, ["Field", "Value"], labor.concat(blankRows(2, 6))),
      Shipping: withStamp(profile, ["Field", "Value"], shipping.concat(blankRows(2, 6))),
      "Consumer pass-through": withStamp(
        profile,
        ["Field", "Value"],
        passthrough.concat(blankRows(2, 4))
      ),
    });
  }

  /* ---------- 10. Safety pack ---------- */

  // ESA topic titles ONLY (blank checklists — no handbook body).
  var ESA_TOPICS = [
    "Planning when to reopen / operate",
    "Patron education",
    "Worker health and hygiene",
    "Sanitizing the venue",
    "Ingress and egress",
    "Front of house circulation, F&B, merchandise",
    "Production issues",
    "Legal issues",
  ];

  function buildSafety(profile) {
    var weather = [
      ["Level", "Trigger / condition", "Actions", "Who decides", "Comms", "Notes"],
      ["Green", "", "", "", "", ""],
      ["Yellow", "", "", "", "", ""],
      ["Orange", "", "", "", "", ""],
      ["Red", "", "", "", "", ""],
    ].concat(blankRows(6, 8));

    function safetyChecklist(items) {
      var rows = (items || []).map(function (it) {
        return [it, "", "", "", ""];
      });
      rows = rows.concat(blankRows(5, Math.max(8, 12 - rows.length)));
      return withStamp(profile, ["Item", "Done", "Owner", "Due", "Notes"], rows, SAFETY_FOOTER);
    }

    var medical = safetyChecklist([
      "Medical provider / ALS plan",
      "Aid station locations",
      "Patient transport path",
      "Heat / cold protocols",
      "Medication / sharps policy",
      "Mental health / welfare",
    ]);
    var crowd = safetyChecklist([
      "Capacity by zone",
      "Density monitoring",
      "Queue management",
      "Barrier plan",
      "Ingress / egress rates",
      "Show-stop / hold triggers",
    ]);
    var comms = safetyChecklist([
      "Radio channels / talkgroups",
      "Command post staffing",
      "Public address scripts",
      "App / SMS alert path",
      "Media holding statement",
      "Internal escalation tree",
    ]);
    var eap = safetyChecklist([
      "EAP document owner",
      "Evacuation routes mapped",
      "Shelter / refuge areas",
      "Lost child / reunion",
      "Severe weather decision tree",
      "After-action review slot",
    ]);
    var site = safetyChecklist([
      "Site map current",
      "Emergency vehicle access",
      "Fire lanes clear",
      "Lighting plan",
      "Temporary structure certs",
      "Water / sanitation counts",
    ]);
    var insurance = safetyChecklist([
      "GL / event liability",
      "Weather / cancellation",
      "Vendor COIs collected",
      "Alcohol / special permits",
      "Local authority permits",
      "Noise / curfew compliance",
    ]);

    var esaRows = ESA_TOPICS.map(function (t) {
      return [t, "", "", "", ""];
    });
    esaRows = esaRows.concat(blankRows(5, 8));
    var esa = withStamp(
      profile,
      ["ESA topic (title only)", "Done", "Owner", "Due", "Notes"],
      esaRows,
      SAFETY_FOOTER
    );

    var weatherSheet = withStamp(
      profile,
      weather[0],
      weather.slice(1),
      SAFETY_FOOTER
    );

    return bookWithSheets({
      "Weather matrix": weatherSheet,
      Medical: medical,
      Crowd: crowd,
      Comms: comms,
      EAP: eap,
      "Site design": site,
      "Insurance & permits": insurance,
      "ESA topics": esa,
    });
  }

  /* ---------- Odoo event import CSV (no website/POS/mailer) ---------- */

  function csvEscape(v) {
    var s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function rowsToCsv(rows) {
    return rows
      .map(function (r) {
        return r.map(csvEscape).join(",");
      })
      .join("\n");
  }

  /**
   * buildOdooEventImportCsv(profile, opts)
   * opts: { tiers, sponsors, booths, limit_registrations, timezone, venue, organizer, tags, visibility }
   * Labels: Event / Ticket / Sponsor / Booth sections.
   */
  function buildOdooEventImportCsv(profile, opts) {
    opts = opts || {};
    var p = profile || {};
    var rows = [];
    rows.push(["section", "field", "value"]);
    rows.push(["Event", "name", p.name || ""]);
    rows.push(["Event", "date", p.start_date || p.start || ""]);
    rows.push(["Event", "timezone", opts.timezone || p.timezone || "UTC"]);
    rows.push(["Event", "venue", opts.venue || p.venue || [p.city, p.state].filter(Boolean).join(", ")]);
    rows.push(["Event", "organizer", opts.organizer || p.organizer || ""]);
    rows.push(["Event", "tags", opts.tags || [p.type, p.subtype].filter(Boolean).join("|")]);
    rows.push(["Event", "visibility", opts.visibility || p.visibility || "public"]);
    var lim =
      opts.limit_registrations != null
        ? opts.limit_registrations
        : p.limit_registrations != null
          ? p.limit_registrations
          : "";
    rows.push(["Event", "limit_registrations", lim === "" || lim == null ? "" : String(lim)]);

    var tiers = (opts.tiers && (opts.tiers.rows || opts.tiers.tiers || opts.tiers)) || [];
    if (!Array.isArray(tiers)) tiers = [];
    tiers.forEach(function (t, i) {
      var prefix = "Ticket";
      rows.push([prefix, "name", t.name || "Tier " + (i + 1)]);
      rows.push([prefix, "price", t.price != null ? t.price : ""]);
      rows.push([prefix, "sales_start", t.sales_start || ""]);
      rows.push([prefix, "sales_end", t.sales_end || ""]);
      rows.push([prefix, "maximum", t.max != null ? t.max : ""]);
    });

    var sponsors = (opts.sponsors || []);
    if (!Array.isArray(sponsors)) sponsors = [];
    sponsors.forEach(function (s) {
      rows.push(["Sponsor", "name", s.name || ""]);
      rows.push(["Sponsor", "level", s.level || ""]);
      rows.push(["Sponsor", "type", s.type || "cash"]);
      rows.push(["Sponsor", "show_on_ticket", s.show_on_ticket ? "1" : "0"]);
      rows.push(["Sponsor", "fee", s.fee != null ? s.fee : ""]);
    });

    var booths = opts.booths || [];
    if (!Array.isArray(booths)) booths = [];
    booths.forEach(function (b) {
      rows.push(["Booth", "category", b.category || ""]);
      rows.push(["Booth", "count", b.count != null ? b.count : ""]);
      rows.push(["Booth", "price", b.price != null ? b.price : ""]);
      rows.push(["Booth", "creates_sponsor", b.creates_sponsor ? "1" : "0"]);
    });

    return rowsToCsv(rows);
  }

  function downloadOdooCsv(profile, opts) {
    var csv = buildOdooEventImportCsv(profile, opts);
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = safeName(profile) + "_odoo_event_import.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  /* ---------- pack download ---------- */

  function safeName(profile) {
    return String((profile && profile.name) || "festival")
      .replace(/[^\w\-]+/g, "_")
      .slice(0, 40);
  }

  function allWorkbooks(profile) {
    return [
      { file: "_talent.xlsx", build: buildTalent },
      { file: "_artists_marketing.xlsx", build: buildArtistsMarketing },
      { file: "_lineup_announce.xlsx", build: buildLineupAnnounce },
      { file: "_go_to_market.xlsx", build: buildGoToMarket },
      { file: "_ros.xlsx", build: buildRos },
      { file: "_area_hours.xlsx", build: buildAreaHours },
      { file: "_load_in.xlsx", build: buildLoadIn },
      { file: "_transport.xlsx", build: buildTransport },
      { file: "_rfid_pos.xlsx", build: buildRfidPos },
      { file: "_safety_pack.xlsx", build: buildSafety },
    ];
  }

  function downloadWorkbook(filename, wb) {
    var buf = workbookToArrayBuffer(wb);
    downloadArrayBuffer(filename, buf);
  }

  function downloadAll(profile, opts) {
    var p = profile || {};
    var prefix = safeName(p);
    var list = allWorkbooks(p);
    list.forEach(function (item, i) {
      setTimeout(function () {
        try {
          downloadWorkbook(prefix + item.file, item.build(p));
        } catch (err) {
          if (typeof console !== "undefined" && console.error) {
            console.error("Template download failed:", item.file, err);
          }
        }
      }, i * 350);
    });
    // NEW: odoo_event_import.csv after xlsx pack
    setTimeout(function () {
      try {
        downloadOdooCsv(p, opts || p.odoo_export || {});
      } catch (err) {
        if (typeof console !== "undefined" && console.error) {
          console.error("Odoo CSV download failed:", err);
        }
      }
    }, list.length * 350 + 100);
  }

  // Node / test helpers (no DOM download)
  function buildAllBuffers(profile) {
    var p = profile || {};
    return allWorkbooks(p).map(function (item) {
      var wb = item.build(p);
      return {
        file: safeName(p) + item.file,
        buffer: workbookToArrayBuffer(wb),
        sheetNames: wb.SheetNames.slice(),
      };
    });
  }

  global.Templates = {
    stampRows: stampRows,
    showDayCount: showDayCount,
    buildTalent: buildTalent,
    buildArtistsMarketing: buildArtistsMarketing,
    buildLineupAnnounce: buildLineupAnnounce,
    buildGoToMarket: buildGoToMarket,
    buildRos: buildRos,
    buildAreaHours: buildAreaHours,
    buildLoadIn: buildLoadIn,
    buildTransport: buildTransport,
    buildRfidPos: buildRfidPos,
    buildSafety: buildSafety,
    downloadAll: downloadAll,
    buildAllBuffers: buildAllBuffers,
    rfidUnitPriceCatalog: rfidUnitPriceCatalog,
    buildOdooEventImportCsv: buildOdooEventImportCsv,
    downloadOdooCsv: downloadOdooCsv,
  };
})(typeof window !== "undefined" ? window : global);
