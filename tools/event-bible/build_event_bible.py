#!/usr/bin/env python3
"""Patron Journey Event Bible generator (openpyxl).

Builds:
  out/event-bible.xlsx              all tabs (blank: no event data, no private info)
  out/templates/<id>.xlsx           one file per template (Cover + Inputs + tab + Sources)
  out/field_map.json                which Inputs cell each simulator field fills
Every template tab reads ONLY from the Inputs tab, so filling = writing Inputs cells.
"""
import json, os, re, zipfile, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
VERSION = "event-bible.v1"

CREAM, GOLD, INK, LINE = "F8F4EC", "B8932E", "2B2620", "D9CFBE"
F_TITLE = Font(name="Georgia", size=18, bold=True, color=INK)
F_H1 = Font(name="Georgia", size=13, bold=True, color=INK)
F_HDR = Font(name="Georgia", size=10, bold=True, color="FFFFFF")
F_BODY = Font(name="Calibri", size=10, color=INK)
F_BOLD = Font(name="Calibri", size=10, bold=True, color=INK)
F_MUTED = Font(name="Calibri", size=9, italic=True, color="6B6255")
F_BANNER = Font(name="Georgia", size=11, bold=True, color=GOLD)
FILL_HDR = PatternFill("solid", fgColor=GOLD)
FILL_IN = PatternFill("solid", fgColor=CREAM)
FILL_SEC = PatternFill("solid", fgColor="EFE6D3")
FILL_WARN = PatternFill("solid", fgColor="F6D5CC")
THIN = Side(style="thin", color=LINE)
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
PJ = "https://events-patronjourney.message-0ad.workers.dev"

# ---------------------------------------------------------------- Inputs spec
# key, label, type, methodology default (never event data), simulator source, note
SCALARS = [
    ("data_mode", "Data in this file", "text", "BLANK TEMPLATE", "set by filler", "BLANK TEMPLATE / SAMPLE DATA — fictional / YOUR DATA"),
    ("generated_at", "Generated", "text", None, "filler clock", ""),
    ("event_name", "Event name", "text", None, "profile.name", ""),
    ("organizer", "Organizer / promoter", "text", None, "profile.organizer", ""),
    ("event_type", "Event type", "text", None, "profile.type / subtype", ""),
    ("genre", "Genre", "text", None, "profile.genre", ""),
    ("venue", "Venue / site name", "text", None, "profile.venue", ""),
    ("street", "Street address", "text", None, "profile.street", ""),
    ("city", "City", "text", None, "profile.city", ""),
    ("state", "State / region", "text", None, "profile.state", ""),
    ("zip", "Postcode", "text", None, "profile.zip", ""),
    ("timezone", "Time zone", "text", None, "profile.timezone", ""),
    ("start_date", "First show day", "date", None, "profile.start_date", ""),
    ("end_date", "Last show day", "date", None, "profile.end_date", ""),
    ("show_days", "Show days", "number", None, "safetyWeather.show_days or date span", ""),
    ("load_in_days", "Load-in days before show", "number", 2, "safetyWeather.load_in_days", ""),
    ("load_out_days", "Load-out days after show", "number", 1, "(default)", "ASSUMPTION: edit"),
    ("gates_open", "Gates open (daily)", "time", None, "profile.start_time", ""),
    ("gates_close", "Gates close / curfew (daily)", "time", None, "profile.end_time", ""),
    ("gate_hours", "Gate opening hours per day", "number", None, "computed from gate times", "Drives toilet ratios (Purple Guide <6h / 6h+)"),
    ("attendance", "Expected attendance (N)", "number", None, "options.N", "Per-day peak"),
    ("peak_occupancy", "Peak on-site occupancy", "number", None, "safetyWeather.peak_occupancy", ""),
    ("capacity_limit", "Licensed / ticket cap", "number", None, "profile.limit_registrations", ""),
    ("camping", "Camping (Y/N)", "yn", "N", "profile.camping", ""),
    ("camping_pct", "Share of attendees camping", "pct", None, "options.p_camp", ""),
    ("alcohol_food", "Alcohol & food served in quantity (Y/N)", "yn", "Y", "(default)", "Purple Guide toilet table row"),
    ("female_share", "Female share of audience", "pct", 0.5, "(default)", "Purple Guide 18.17: assume 50:50 when unknown"),
    ("ticket_price", "GA ticket price", "money", None, "options.ticket", ""),
    ("single_day_price", "Single-day ticket price", "money", None, "(blank = GA ÷ show days)", ""),
    ("camp_fee", "Camping fee", "money", None, "options.camp_fee", ""),
    ("avg_revenue_per_head", "Avg revenue per attendee (K23)", "money", None, "budget.K23", ""),
    ("ticket_revenue", "Ticket revenue (K22)", "money", None, "budget.K22", ""),
    ("ancillary_revenue", "Ancillary + sponsor income", "money", None, "budget.ancTotal + sponsors", ""),
    ("total_opex", "Total opex (live)", "money", None, "budget.total_opex", ""),
    ("net_profit", "Net after projected income (K47)", "money", None, "budget.K47", ""),
    ("break_even_price", "Break-even ticket price (K2)", "money", None, "budget.K2", ""),
    ("talent_budget", "Total artist budget", "money", None, "talent budget or departments.talent", ""),
    ("production_budget", "Production budget (ex talent)", "money", None, "departments.production", ""),
    ("marketing_budget", "Marketing budget", "money", None, "departments.marketing", ""),
    ("target_profit", "Target profit", "money", 0, "(you)", ""),
    ("mc_p_profit", "Monte Carlo: chance of profit", "pct", None, "Monte Carlo result", ""),
    ("ticket_url", "Ticket / event URL", "text", None, "event page", "Used for tracking links"),
    ("announce_date", "Lineup announce date", "date", None, "(blank = 90 days before)", ""),
    ("onsale_date", "Public on-sale date", "date", None, "(blank = announce + 2 days)", ""),
    ("cashless_mode", "Cashless mode", "text", None, "rfid.cashlessMode", "closed / open / hybrid / none"),
    ("rfid_enabled", "RFID / cashless used (Y/N)", "yn", "N", "rfid.enabled", ""),
    ("rfid_subtotal", "RFID / cashless cost (sim)", "money", None, "budget.rfid_subtotal", ""),
    ("venue_mode", "Venue mode", "text", None, "safetyWeather.venue_mode", "outdoor / hybrid / indoor"),
    ("weather_score", "Weather risk score (0–100)", "number", None, "/api/weather/risk", ""),
    ("weather_label", "Weather risk label", "text", None, "/api/weather/risk", ""),
    ("rain_pct", "Rain on event days (% of past years)", "number", None, "/api/weather/risk", ""),
    ("storm_pct", "Thunderstorms (% of past years)", "number", None, "/api/weather/risk", ""),
    ("wind_hold_pct", "Gusts over hold threshold (% of years)", "number", None, "/api/weather/risk", ""),
    ("heat_pct", "Highs over 32°C/90°F (% of years)", "number", None, "/api/weather/risk", ""),
    ("cold_pct", "Lows under 5°C/41°F (% of years)", "number", None, "/api/weather/risk", ""),
    ("avg_high_f", "Average high °F", "number", None, "/api/weather/risk", ""),
    ("avg_low_f", "Average low °F", "number", None, "/api/weather/risk", ""),
    ("weather_link", "Weather result link", "text", None, "/weather permalink", ""),
    ("lightning_miles", "Lightning stand-down radius (miles)", "number", 8, "safetyWeather.lightning_stand_down_miles", ""),
    ("wind_hold_mph", "Wind hold (mph)", "number", 35, "safetyWeather.wind_hold_mph", "Use your structure manufacturer's rating"),
    ("hospital_minutes", "Nearest hospital (minutes)", "number", None, "safetyWeather.nearest_hospital_minutes", ""),
    ("fire_permit", "Fire permit (AHJ) status", "text", None, "safetyWeather.ahj_fire_permit_status", ""),
    ("security_staff", "Security posts budgeted in sim", "number", None, "safety line security_per_100 qty ÷ show days", "Sim prices 1 security unit per 100 peak"),
    ("safety_subtotal", "Safety / weather cost (sim)", "money", None, "budget.safety_weather_subtotal", ""),
    ("crew_count", "Crew & staff on site (peak)", "number", None, "(you)", ""),
    ("volunteer_count", "Volunteers (peak)", "number", None, "(you)", ""),
    ("changeover_min", "Default changeover (min)", "number", 15, "(default)", "ASSUMPTION: edit per stage"),
    ("linecheck_min", "Line check before set (min)", "number", 30, "(default)", "ASSUMPTION"),
    ("lane_rate", "Entry lane rate (people / hour / lane)", "number", 660, "(default)", "Green Guide turnstile max; scan + bag search is slower"),
    ("peak_arrival_share", "Share of attendees arriving in busiest hour", "pct", None, "(you)", "Set from last year's scan data"),
    ("egress_minutes", "Target egress time (minutes)", "number", 8, "(default)", "Green Guide normal egress"),
    ("bus_capacity", "Seats per bus / coach", "number", 50, "(default)", "Check your operator"),
    ("shuttle_share", "Share of attendees using shuttles", "pct", None, "(you)", ""),
    ("people_per_car", "People per car", "number", None, "(you)", ""),
    ("deposit_pct", "Standard artist deposit %", "pct", 0.3, "(default)", "EMCF16 talent worksheet standard"),
    ("fest_pass_share", "Share of an act's fans who'd buy a full pass", "pct", 0.2, "(default)", "EMCF16 'Fest vs Single' factor"),
    ("band_spare_pct", "Spare wristbands %", "pct", 0.1, "(default)", "ASSUMPTION"),
    ("device_spare_pct", "Spare devices %", "pct", 0.15, "(default)", "ASSUMPTION"),
]
TABLES = {
    "stages": (10, [("name", "Stage / area", "text"), ("type", "Type", "text"), ("capacity", "Capacity", "number"), ("open", "Opens", "time"), ("close", "Closes", "time")]),
    "lineup": (60, [("artist", "Artist / act", "text"), ("day", "Show day #", "number"), ("stage", "Stage", "text"), ("start", "Set start", "time"), ("length", "Set length (min)", "number"), ("tier", "Tier", "text"), ("draw", "Est. draw", "number"), ("suggested_fee", "Suggested fee", "money"), ("offer", "Offer / guarantee", "money"), ("agency", "Agency", "text")]),
    "budget": (140, [("dept", "Department", "text"), ("item", "Line item", "text"), ("amount", "Budgeted", "money"), ("fixed", "Fixed? (Y/N)", "yn"), ("note", "Note", "text")]),
    "rfid": (20, [("id", "Item id", "text"), ("item", "Item", "text"), ("unit_price", "Unit price", "money"), ("qty", "Qty", "number"), ("unit", "Unit", "text")]),
    "safety": (15, [("id", "Item id", "text"), ("item", "Item", "text"), ("unit_price", "Unit price", "money"), ("qty", "Qty", "number"), ("unit", "Unit", "text")]),
}
FMT = {"date": "yyyy-mm-dd", "time": "hh:mm", "money": '"$"#,##0', "pct": "0%", "number": "#,##0", "text": "@", "yn": "@"}

SCALAR_CELL = {}
TABLE_POS = {}


def I(key):
    return "Inputs!$C$%d" % SCALAR_CELL[key]


def T(table, field, i):
    first, cols = TABLE_POS[table]
    return "Inputs!$%s$%d" % (cols[field], first + i)


def TCOL(table, field):
    first, cols = TABLE_POS[table]
    n = TABLES[table][0]
    return "Inputs!$%s$%d:$%s$%d" % (cols[field], first, cols[field], first + n - 1)


def E(ref):
    return '=IF(%s="","",%s)' % (ref, ref)


def START():
    return I("start_date")


def DAYS():
    return 'IF(%s="",IF(OR(%s="",%s=""),1,%s-%s+1),%s)' % (I("show_days"), I("start_date"), I("end_date"), I("end_date"), I("start_date"), I("show_days"))


def ANNOUNCE():
    return 'IF(%s<>"",%s,IF(%s="","",%s-90))' % (I("announce_date"), I("announce_date"), I("start_date"), I("start_date"))


class Sheet:
    def __init__(self, wb, title, widths, subtitle):
        self.ws = wb.create_sheet(title)
        self.ws.sheet_properties.tabColor = GOLD
        for i, w in enumerate(widths):
            self.ws.column_dimensions[get_column_letter(i + 1)].width = w
        self.ncols = len(widths)
        ws = self.ws
        ws["A1"] = title.upper() if title != "Inputs" else "INPUTS — the only tab you need to edit"
        ws["A1"].font = F_TITLE
        ws.row_dimensions[1].height = 28
        if title != "Inputs":
            ws["A2"] = '=IF(%s="","Event: ________",%s)&"  ·  "&IF(%s="","dates TBD",TEXT(%s,"ddd d mmm yyyy"))&"  ·  "&%s' % (
                I("event_name"), I("event_name"), I("start_date"), I("start_date"), I("data_mode"))
            ws["A2"].font = F_BANNER
        ws["A3"] = subtitle
        ws["A3"].font = F_MUTED
        self.r = 5
        ps = ws.page_setup
        ps.orientation = "landscape"
        ps.paperSize = ws.PAPERSIZE_LETTER
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ps.fitToWidth = 1
        ps.fitToHeight = 0
        ws.page_margins.left = ws.page_margins.right = 0.4
        ws.page_margins.top = ws.page_margins.bottom = 0.5
        ws.oddFooter.left.text = "Patron Journey · Event Bible · &A"
        ws.oddFooter.right.text = "Page &P of &N"
        ws.oddHeader.right.text = "pjrny.com"
        ws.sheet_view.showGridLines = False

    def section(self, text, note=None):
        self.r += 1
        c = self.ws.cell(self.r, 1, text)
        c.font = F_H1
        for col in range(1, self.ncols + 1):
            self.ws.cell(self.r, col).fill = FILL_SEC
        if note:
            self.r += 1
            self.ws.cell(self.r, 1, note).font = F_MUTED
        self.r += 1

    def header(self, labels):
        for i, l in enumerate(labels):
            c = self.ws.cell(self.r, i + 1, l)
            c.font, c.fill, c.alignment, c.border = F_HDR, FILL_HDR, CENTER, BOX
        self.ws.row_dimensions[self.r].height = 30
        self.r += 1
        return self.r - 1

    def row(self, values, fmts=None, inputs=None):
        for i, v in enumerate(values):
            c = self.ws.cell(self.r, i + 1, v)
            c.font, c.border, c.alignment = F_BODY, BOX, WRAP
            if fmts and i < len(fmts) and fmts[i]:
                c.number_format = FMT.get(fmts[i], fmts[i])
            if inputs and i in inputs:
                c.fill = FILL_IN
        self.r += 1
        return self.r - 1

    def kv(self, label, formula, fmt=None, note="", is_input=False):
        a = self.ws.cell(self.r, 1, label); a.font = F_BOLD; a.border = BOX; a.alignment = WRAP
        b = self.ws.cell(self.r, 2, formula); b.font = F_BODY; b.border = BOX; b.alignment = WRAP
        if fmt:
            b.number_format = FMT.get(fmt, fmt)
        if is_input:
            b.fill = FILL_IN
        if note:
            c = self.ws.cell(self.r, 3, note); c.font = F_MUTED
        self.r += 1
        return "$B$%d" % (self.r - 1)


def build_inputs(wb):
    s = Sheet(wb, "Inputs", [34, 22, 30, 16, 16, 14, 14, 16, 16, 14, 18, 14],
              "Cream cells are inputs. The simulator fills them for you; every other tab reads from here. Keep phones, emails and PINs out of shared copies.")
    ws = s.ws
    s.header(["Field", "Key", "Value", "Format", "Filled from", "Note"])
    for key, label, typ, default, src, note in SCALARS:
        SCALAR_CELL[key] = s.r
        ws.cell(s.r, 1, label).font = F_BODY
        ws.cell(s.r, 2, key).font = F_MUTED
        c = ws.cell(s.r, 3, default)
        c.fill, c.border, c.number_format, c.font = FILL_IN, BOX, FMT[typ], F_BODY
        ws.cell(s.r, 4, typ).font = F_MUTED
        ws.cell(s.r, 5, src).font = F_MUTED
        ws.cell(s.r, 6, note).font = F_MUTED
        s.r += 1
    for name, (n, cols) in TABLES.items():
        s.section("Table: " + name, "%d rows. Blank rows are ignored by every tab." % n)
        letters = {f: get_column_letter(j + 2) for j, (f, lab, typ) in enumerate(cols)}
        s.header(["#"] + [lab for _, lab, _ in cols])
        TABLE_POS[name] = (s.r, letters)
        for i in range(n):
            ws.cell(s.r, 1, i + 1).font = F_MUTED
            for j, (f, lab, typ) in enumerate(cols):
                c = ws.cell(s.r, j + 2)
                c.fill, c.border, c.number_format, c.font = FILL_IN, BOX, FMT[typ], F_BODY
            s.r += 1
    ws.freeze_panes = "A5"
    dv = DataValidation(type="list", formula1='"Y,N"', allow_blank=True)
    ws.add_data_validation(dv)
    for key, label, typ, *_ in SCALARS:
        if typ == "yn":
            dv.add("C%d" % SCALAR_CELL[key])
    return s


def tab_ros(wb):
    s = Sheet(wb, "Run of Show", [22, 20, 13, 16, 26, 11, 10, 9, 9, 10, 11, 13, 18, 22],
              "Day-by-day key times and per-stage set times. Set end = start + length; line check = start − line-check minutes; overlap flag checks same stage and day.")
    ws = s.ws
    s.section("1 · Build, show and break dates")
    s.kv("Load-in starts", '=IF(%s="","",%s-%s)' % (START(), START(), I("load_in_days")), "ddd d mmm yyyy")
    s.kv("Gates open (day 1)", '=IF(%s="","",%s+N(%s))' % (START(), START(), I("gates_open")), "ddd d mmm yyyy hh:mm")
    s.kv("Last show day", '=IF(%s="","",%s+%s-1)' % (START(), START(), DAYS()), "ddd d mmm yyyy")
    s.kv("Load-out complete by", '=IF(%s="","",%s+%s-1+%s)' % (START(), START(), DAYS(), I("load_out_days")), "ddd d mmm yyyy")
    s.section("2 · Daily key times", "Crew call and safety briefing are suggested offsets from gates; overwrite them.")
    s.header(["Day", "Date", "Weekday", "Crew call", "Safety briefing", "Gates open", "First set", "Last set ends", "Curfew", "Gates close", "Acts", "Weather", "Notes"])
    lineday, linestart = TCOL("lineup", "day"), TCOL("lineup", "start")
    daily_rows = []
    for d in range(1, 8):
        r = s.r
        on = 'IF(%d>%s,"",' % (d, DAYS())
        daily_rows.append(r)
        vals = [
            '=IF(%d>%s,"",%d)' % (d, DAYS(), d),
            '=' + on + 'IF(%s="","",%s+%d))' % (START(), START(), d - 1),
            '=IF(B%d="","",TEXT(B%d,"dddd"))' % (r, r),
            '=' + on + 'IF(%s="","",MOD(%s-3/24,1)))' % (I("gates_open"), I("gates_open")),
            '=' + on + 'IF(%s="","",MOD(%s-1/24,1)))' % (I("gates_open"), I("gates_open")),
            '=' + on + 'IF(%s="","",%s))' % (I("gates_open"), I("gates_open")),
            '=' + on + 'IF(COUNTIF(%s,%d)=0,"",_xlfn.MINIFS(%s,%s,%d)))' % (lineday, d, linestart, lineday, d),
            "LASTSET%d" % d,
            None,
            '=' + on + 'IF(%s="","",%s))' % (I("gates_close"), I("gates_close")),
            '=' + on + 'COUNTIF(%s,%d))' % (lineday, d),
            '=' + on + 'IF(%s="","run /weather",%s&" · rain "&%s&"%% of yrs"))' % (I("weather_label"), I("weather_label"), I("rain_pct")),
            None,
        ]
        s.row(vals, [None, "ddd d mmm", None, "hh:mm", "hh:mm", "hh:mm", "hh:mm", "hh:mm", "hh:mm", "hh:mm", None, None, None], inputs={8, 12})
    s.section("3 · Stage schedule (from lineup)", "Edit acts in Inputs → lineup. Add stage-manager names and notes in the cream columns.")
    s.header(["Slot", "Day", "Date", "Stage", "Act", "Tier", "Line check", "Set start", "Set end", "Length (min)", "Changeover after", "Overlap check", "Stage manager", "Notes"])
    first = s.r
    n = TABLES["lineup"][0]
    last = first + n - 1
    for i in range(n):
        r = s.r
        a = T("lineup", "artist", i)
        b = 'IF(%s="","",' % a
        st = T("lineup", "start", i); ln = T("lineup", "length", i)
        vals = [
            '=' + b + 'UPPER(LEFT(%s&"X",1))&%s&"-"&TEXT(%d,"00"))' % (T("lineup", "stage", i), T("lineup", "day", i), i + 1),
            '=' + b + '%s)' % T("lineup", "day", i),
            '=' + b + 'IF(OR(%s="",%s=""),"",%s+%s-1))' % (START(), T("lineup", "day", i), START(), T("lineup", "day", i)),
            '=' + b + '%s)' % T("lineup", "stage", i),
            '=' + b + '%s)' % a,
            '=' + b + '%s)' % T("lineup", "tier", i),
            '=' + b + 'IF(%s="","",MOD(%s-%s/1440,1)))' % (st, st, I("linecheck_min")),
            '=' + b + 'IF(%s="","",%s))' % (st, st),
            '=' + b + 'IF(OR(%s="",%s=""),"",%s+%s/1440))' % (st, ln, st, ln),
            '=' + b + '%s)' % ln,
            '=' + b + '%s)' % I("changeover_min"),
            '=IF(E%d="","",IF(OR(H%d="",I%d=""),"needs time",IF(COUNTIFS($D$%d:$D$%d,D%d,$B$%d:$B$%d,B%d,$H$%d:$H$%d,"<"&I%d,$I$%d:$I$%d,">"&H%d)>1,"⚠ overlap","OK")))' % (r, r, r, first, last, r, first, last, r, first, last, r, first, last, r),
            None, None,
        ]
        s.row(vals, [None, None, "ddd d mmm", None, None, None, "hh:mm", "hh:mm", "hh:mm", None, None, None, None, None], inputs={12, 13})
    for d, r in zip(range(1, 8), daily_rows):
        ws.cell(r, 8).value = '=IF(%d>%s,"",IF(COUNTIF($B$%d:$B$%d,%d)=0,"",MOD(_xlfn.MAXIFS($I$%d:$I$%d,$B$%d:$B$%d,%d),1)))' % (d, DAYS(), first, last, d, first, last, first, last, d)
    ws.conditional_formatting.add("L%d:L%d" % (first, last), FormulaRule(formula=['LEFT(L%d,1)="⚠"' % first], fill=FILL_WARN))
    s.section("4 · Generic show-day cues", "From the Iceland Eclipse master schedule and the Forecaster ROS gate. Offsets are hours from gates open.")
    s.header(["Cue", "Offset (h)", "Time", "Owner", "Notes"])
    for cue, off, owner in [("Crew call / radios out", -3, "Production Manager"), ("Site safety walk & sign-off", -2, "Safety Officer"), ("Security & steward briefing", -1, "Security Lead"),
                            ("Box office / will call open", -0.5, "Ticketing Lead"), ("Doors / public ingress", 0, "Security Lead"), ("First set", 1, "Stage Manager"),
                            ("Peak occupancy check", 6, "Festival Director"), ("Headliner", 9, "Stage Manager"), ("Curfew / last set ends", 10.5, "Stage Manager"),
                            ("Public egress, lot release staged", 11, "Security Lead"), ("Site sweep & lost property", 12, "Site Ops")]:
        r = s.r
        s.row([cue, off, '=IF(%s="","",MOD(%s+B%d/24,1))' % (I("gates_open"), I("gates_open"), r), owner, None], [None, "0.0", "hh:mm", None, None], inputs={1, 3, 4})
    ws.freeze_panes = "A5"
    return s


ATTENDEE_PACK = {
    "Tickets & money": ["Ticket / wristband (register it before you go)", "Photo ID", "Payment card + small cash backup", "Emergency contact info card", "Map & directions / parking pass"],
    "Wear": ["Broken-in boots or closed shoes", "Sandals (camp)", "Hat (sun / cold)", "Sunglasses", "Poncho / rain shell", "Warm layer for night", "Socks & underwear (1 per day + spare)", "Bandana / face covering for dust", "Small backpack or fanny pack"],
    "Health & personal": ["Personal medications (in original packaging)", "Earplugs", "Sunscreen", "Lip balm", "Bug repellent", "Blister plasters", "Hand sanitizer & wet wipes", "Toothbrush & paste", "Period products", "Condoms"],
    "Supplies": ["Refillable water bottle (check venue rules)", "Phone + power bank & cable", "Headlamp / small flashlight", "Toilet paper / tissue pack", "Trash bags (leave no trace)", "Small first aid kit", "Pen & notebook"],
    "Camping": ["Tent + stakes + mallet", "Tarp / ground sheet", "Sleeping bag rated for night lows", "Sleeping pad", "Pillow", "Camp light / lantern", "Camp chairs", "Shade structure (if permitted)", "Duct tape, rope, zip ties", "Reusable plates, cup, cutlery", "Stove & fuel (only if permitted)"],
    "Food": ["Water (sealed if allowed)", "Snacks: nuts, jerky, dried fruit, bars", "Easy breakfast items", "Electrolyte packets"],
}


def tab_packing(wb):
    s = Sheet(wb, "Packing List", [22, 46, 52, 8, 8],
              "Attendee list (adapted from the Drive Festival Packing List) adapts to camping and weather history; crew kit list is sized from Inputs.")
    s.section("1 · Attendee packing list", "Share with ticket buyers (Knowledge Center → Patrons → Before you go).")
    s.header(["Category", "Item", "Why / when", "Qty", "✓"])
    for cat, items in ATTENDEE_PACK.items():
        for it in items:
            why = None
            if cat == "Camping":
                why = '=IF(%s="Y","Needed — camping event","Skip unless you camp nearby")' % I("camping")
            elif it.startswith("Poncho"):
                why = '=IF(%s="","Check the weather tool",IF(%s>=30,"Pack it — rain on event days in "&%s&"%% of past years","Light shell is enough"))' % (I("rain_pct"), I("rain_pct"), I("rain_pct"))
            elif it.startswith("Warm layer") or it.startswith("Sleeping bag"):
                why = '=IF(%s="","",IF(%s<50,"Nights average "&ROUND(%s,0)&"°F — pack warm","Nights mild (avg low "&ROUND(%s,0)&"°F)"))' % (I("avg_low_f"), I("avg_low_f"), I("avg_low_f"), I("avg_low_f"))
            elif it.startswith("Sunscreen") or it.startswith("Hat"):
                why = '=IF(%s="","",IF(%s>=20,"Heat risk — highs over 90°F in "&%s&"%% of past years","Average high "&ROUND(N(%s),0)&"°F"))' % (I("heat_pct"), I("heat_pct"), I("heat_pct"), I("avg_high_f"))
            elif it.startswith("Socks"):
                why = '=(%s+1)&" pairs for "&%s&" show day(s)"' % (DAYS(), DAYS())
            elif it.startswith("Ticket"):
                why = '=IF(%s="Y","Cashless event: link your wristband and top up online before you arrive","")' % I("rfid_enabled")
            s.row([cat, it, why, None, None], inputs={3, 4})
    s.section("2 · Crew & production kit")
    s.header(["Area", "Item", "Qty / rule", "Note", "✓"])
    crew = [
        ("Comms", "Two-way radios + spare batteries + chargers", '=IF(%s="","",ROUNDUP(%s/4,0))' % (I("crew_count"), I("crew_count")), "ASSUMPTION: 1 per 4 crew; leads & security 1:1"),
        ("Comms", "Radio channel sheet, printed & laminated", "1 per post", "Channels: Site & Crew Handbook tab"),
        ("PPE", "Hi-vis vests (ISO 20471) for build & break", E(I("crew_count")), "MDLB crew handbook requirement"),
        ("PPE", "Hard hats, gloves, safety boots", "per task risk assessment", ""),
        ("First aid", "First aid kits (crew areas, box office, each stage)", '=COUNTA(%s)-COUNTBLANK(%s)+2' % (TCOL("stages", "name"), TCOL("stages", "name")), "stages + 2"),
        ("Production", "Gaffer tape, cable ties, cable ramps / covers", "per stage", ""),
        ("Production", "Outdoor-rated power strips & leads", "per stage", ""),
        ("Weather", "Rain covers for POS, scanners & FOH", '=IF(%s="","Recommended",IF(%s>=30,"REQUIRED — rain "&%s&"%% of years","Recommended"))' % (I("rain_pct"), I("rain_pct"), I("rain_pct")), "Vendor proposals exclude cover for outdoor kit"),
        ("Weather", "Lightning detection / alert subscription", '="Stand down at "&%s&" miles"' % I("lightning_miles"), ""),
        ("Box office", "Spare wristbands", '=IF(%s="","",ROUNDUP(%s*%s,0))' % (I("attendance"), I("attendance"), I("band_spare_pct")), "spare % from Inputs"),
        ("Box office", "Band applicators / cutters, lanyards, laminates", "", ""),
        ("Box office", "Signage: entry, top-up, refunds, lost & found", "", ""),
        ("Site", "Headlamps & torches for night crew", "", ""),
        ("Site", "Clipboards, printed Event Bible tabs, site maps", "", ""),
    ]
    for area, item, qty, note in crew:
        s.row([area, item, qty, note, None], inputs={4})
    s.ws.freeze_panes = "A5"
    return s


def tab_transport(wb):
    s = Sheet(wb, "Transport Master", [12, 15, 34, 10, 10, 10, 16, 14, 12, 10, 10, 10, 9, 22],
              "Columns follow the IE26 Transport Master Sheet. Arrival = departure + duration; available = capacity − booked. Do not store passenger phone numbers in shared copies.")
    s.section("1 · Shuttle & parking sizing")
    riders = s.kv("Attendees using shuttles", '=IF(OR(%s="",%s=""),"",ROUND(%s*%s,0))' % (I("attendance"), I("shuttle_share"), I("attendance"), I("shuttle_share")), "#,##0", "attendance × shuttle share (Inputs)")
    s.kv("Seats per bus", "=" + I("bus_capacity"), "#,##0")
    win = s.kv("Arrival window (hours)", 3, "0.0", "ASSUMPTION: edit", True)
    rt = s.kv("Round trip (minutes)", 60, "#,##0", "edit per route", True)
    trips = s.kv("Trips per bus in window", '=IF(N(%s)=0,"",MAX(1,ROUNDDOWN(%s*60/%s,0)))' % (rt, win, rt), "#,##0")
    s.kv("Buses needed at peak", '=IF(OR(%s="",%s=""),"",ROUNDUP(%s/(%s*%s),0))' % (riders, trips, riders, I("bus_capacity"), trips), "#,##0")
    s.kv("Cars to park (peak)", '=IF(OR(%s="",%s=""),"",ROUNDUP(%s*(1-N(%s))/%s,0))' % (I("attendance"), I("people_per_car"), I("attendance"), I("shuttle_share"), I("people_per_car")), "#,##0", "non-shuttle attendees ÷ people per car")
    s.section("2 · Master transport log")
    s.header(["Date", "Kind", "Route (from → to)", "Departure", "Duration", "Arrival", "Company / service", "Driver (no phone)", "Vehicle", "Capacity", "Booked", "Available", "Load %", "Notes"])
    first = s.r
    rows = []
    for k in range(3):
        rows.append(('=IF(%s="","",%s-%s+%d)' % (START(), START(), I("load_in_days"), k), "Staff", "Airport → site (crew arrivals)", None, None))
    for i in range(TABLES["lineup"][0]):
        a = T("lineup", "artist", i)
        rows.append(('=IF(OR(%s="",%s="",%s=""),"",%s+%s-1)' % (a, START(), T("lineup", "day", i), START(), T("lineup", "day", i)),
                     '=IF(%s="","","Artist")' % a, '=IF(%s="","",%s&": hotel → site (arrive before line check)")' % (a, a),
                     '=IF(OR(%s="",%s=""),"",MOD(%s-%s/1440-1/24,1))' % (a, T("lineup", "start", i), T("lineup", "start", i), I("linecheck_min")), None))
    for d in range(1, 8):
        rows.append(('=IF(OR(%s="",%d>%s),"",%s+%d)' % (START(), d, DAYS(), START(), d - 1), '=IF(%d>%s,"","Attendee shuttle")' % (d, DAYS()),
                     '=IF(%d>%s,"","Park & ride → main gate (day %d)")' % (d, DAYS(), d), '=IF(OR(%d>%s,%s=""),"",MOD(%s-1/24,1))' % (d, DAYS(), I("gates_open"), I("gates_open")),
                     '=IF(%d>%s,"",%s)' % (d, DAYS(), I("bus_capacity"))))
    for k in range(20):
        rows.append((None, None, None, None, None))
    for date, kind, route, dep, cap in rows:
        r = s.r
        s.row([date, kind, route, dep, None, '=IF(OR(D%d="",E%d=""),"",MOD(D%d+E%d,1))' % (r, r, r, r), None, None, None, cap, None,
               '=IF(J%d="","",J%d-N(K%d))' % (r, r, r), '=IF(OR(J%d="",J%d=0),"",N(K%d)/J%d)' % (r, r, r, r), None],
              ["ddd d mmm", None, None, "hh:mm", "hh:mm", "hh:mm", None, None, None, "#,##0", "#,##0", "#,##0", "0%", None], inputs={4, 6, 7, 8, 9, 10, 13})
    last = s.r - 1
    s.ws.conditional_formatting.add("L%d:L%d" % (first, last), FormulaRule(formula=['AND(L%d<>"",L%d<0)' % (first, first)], fill=FILL_WARN))
    s.ws.freeze_panes = "A5"
    return s


REF = {}  # cross-tab references: name -> "'Sheet'!$B$n"


def ref(sheet, cell):
    return "'%s'!%s" % (sheet, cell)


def tab_safety(wb):
    name = "Safety Metrics"
    s = Sheet(wb, name, [46, 18, 58],
              "Sizing from published guidance (see Sources). These are planning floors, not approvals: your licensing authority, fire marshal (AHJ) and medical provider set the final numbers.")
    peak = 'IF(%s<>"",%s,%s)' % (I("peak_occupancy"), I("peak_occupancy"), I("attendance"))
    s.section("1 · Audience profile")
    P = s.kv("Peak occupancy used", '=IF(%s="","",%s)' % (peak, peak), "#,##0", "peak occupancy, else attendance")
    H = s.kv("Gate hours per day", '=IF(%s<>"",%s,IF(OR(%s="",%s=""),"",ROUND(MOD(%s-%s,1)*24,1)))' % (I("gate_hours"), I("gate_hours"), I("gates_open"), I("gates_close"), I("gates_close"), I("gates_open")), "0.0")
    Fm = s.kv("Female audience", '=IF(%s="","",ROUND(%s*%s,0))' % (P, P, I("female_share")), "#,##0", "Purple Guide 18.17: use 50:50 if unknown")
    Ml = s.kv("Male audience", '=IF(%s="","",%s-%s)' % (P, P, Fm), "#,##0")
    C = s.kv("Campers", '=IF(OR(%s="",%s<>"Y"),0,ROUND(%s*N(%s),0))' % (P, I("camping"), P, I("camping_pct")), "#,##0")
    D = s.kv("Show days", "=" + DAYS(), "0")
    s.section("2 · Toilets", "Purple Guide ch.18 Table 1. Arena ratio picks the row from gate hours and food/alcohol.")
    fr = s.kv("Arena ratio: females per toilet", '=IF(%s="","",IF(%s<6,100,IF(%s="Y",75,85)))' % (H, H, I("alcohol_food")), "0", "<6h: 100 · 6h+ little food/alcohol: 85 · 6h+ with: 75")
    mr = s.kv("Arena ratio: males per toilet", '=IF(%s="","",IF(%s<6,500,IF(%s="Y",400,425)))' % (H, H, I("alcohol_food")), "0", "<6h: 500 · 85-row: 425 · 75-row: 400")
    ur = s.kv("Arena ratio: males per urinal", '=IF(%s="","",IF(%s<6,150,IF(%s="Y",100,125)))' % (H, H, I("alcohol_food")), "0", "<6h: 150 · 125 · 100")
    tf = s.kv("Toilets for females (arena)", '=IF(OR(%s="",%s=""),"",ROUNDUP(%s/%s,0))' % (Fm, fr, Fm, fr), "#,##0")
    tm = s.kv("Toilets for males (arena)", '=IF(OR(%s="",%s=""),"",ROUNDUP(%s/%s,0))' % (Ml, mr, Ml, mr), "#,##0")
    tu = s.kv("Urinals (arena)", '=IF(OR(%s="",%s=""),"",ROUNDUP(%s/%s,0))' % (Ml, ur, Ml, ur), "#,##0")
    tc = s.kv("Campsite toilets (F 1:75, M 1:150)", '=IF(N(%s)=0,0,ROUNDUP(%s*%s/75,0)+ROUNDUP(%s*(1-%s)/150,0))' % (C, C, I("female_share"), C, I("female_share")), "#,##0", "Purple Guide campsite row")
    tcu = s.kv("Campsite urinals (1:250 males)", '=IF(N(%s)=0,0,ROUNDUP(%s*(1-%s)/250,0))' % (C, C, I("female_share")), "#,##0")
    acc = s.kv("Accessible toilets (minimum)", '=IF(%s="","",MAX(1,ROUNDUP(N(%s)/1000,0)))' % (P, P), "#,##0", "Purple Guide: at least one; 1 per 1,000 here is a planning ASSUMPTION — size to your access audit")
    TT = s.kv("TOTAL toilets (excl. urinals)", '=IF(%s="","",N(%s)+N(%s)+N(%s)+N(%s))' % (P, tf, tm, tc, acc), "#,##0")
    s.section("3 · Water & waste")
    WL = s.kv("Drinking water (litres, whole event)", '=IF(%s="","",ROUND((%s-%s)*4*%s+%s*20*%s,0))' % (P, P, C, D, C, D), "#,##0", "NSW Health: 4 L/person/day day events; 20 L/person/day camping (incl. 4 L potable)")
    s.kv("Drinking water (US gallons)", '=IF(%s="","",ROUND(%s/3.785,0))' % (WL, WL), "#,##0")
    WO = s.kv("Free water outlets / taps (minimum)", '=IF(%s="","",ROUNDUP(%s/1000,0))' % (P, P), "#,##0", "WA Health 2022: 1 outlet per 1,000 at day events")
    WK = s.kv("Waste expected (kg, whole event)", '=IF(%s="","",ROUND((%s-%s)*0.5*%s+%s*1.4*%s,0))' % (P, P, C, D, C, D), "#,##0", "AGF 2024 benchmark: 0.5 kg/person/day day events, 1.4 kg camping")
    s.kv("Waste expected (US tons)", '=IF(%s="","",ROUND(%s/907.2,1))' % (WK, WK), "0.0")
    s.section("4 · Medical & security")
    MT = s.kv("Purple Guide medical tier (by attendance)", '=IF(%s="","",IF(%s<500,1,IF(%s<=2000,2,IF(%s<=5000,3,IF(%s<=10000,4,5)))))' % (P, P, P, P, P), "0", "ch.5 (rev. Dec 2024): T1 <500 · T2 ≤2,000 · T3 ≤5,000 · T4 ≤10,000 · T5 >10,000. A Medical Needs Assessment sets actual cover.")
    s.kv("Nearest hospital (minutes)", E(I("hospital_minutes")), "0", "Long transfer times raise on-site cover — record in the Medical Needs Assessment")
    ST = s.kv("Mobile stewards (starting point)", '=IF(%s="","",ROUNDUP(%s/250,0))' % (P, P), "#,##0", "SGSA guidance ~1 per 250 spectators; your risk assessment sets the number")
    s.kv("Security staff in simulator", E(I("security_staff")), "#,##0", "simulator prices 1 unit per 100 peak — compare with steward floor")
    s.section("5 · Ingress, egress & space")
    AR = s.kv("Arrivals in busiest hour", '=IF(OR(%s="",%s=""),"",ROUND(%s*%s,0))' % (P, I("peak_arrival_share"), P, I("peak_arrival_share")), "#,##0", "set peak arrival share in Inputs")
    LN = s.kv("Entry lanes needed", '=IF(OR(%s="",N(%s)=0),"",ROUNDUP(%s/%s,0))' % (AR, I("lane_rate"), AR, I("lane_rate")), "#,##0", "Green Guide: 660/h per turnstile is a ceiling — measure your scan + search rate")
    EW = s.kv("Egress width, level ground (metres)", '=IF(%s="","",ROUND(%s/(82*%s),1))' % (P, P, I("egress_minutes")), "0.0", "SGSA 82 persons/m/min level; 66 on stairs")
    s.kv("Egress width, stepped (metres)", '=IF(%s="","",ROUND(%s/(66*%s),1))' % (P, P, I("egress_minutes")), "0.0")
    s.kv("Egress width (feet, level)", '=IF(%s="","",ROUND(%s*3.281,0))' % (EW, EW), "0")
    s.kv("Min. standing area at 2 people/m² (m²)", '=IF(%s="","",ROUND(%s/2,0))' % (P, P), "#,##0", "Green Guide general density 2.0/m²; 4.0/m² is the max for standing areas")
    s.kv("Min. standing area, NFPA 101 (ft²)", '=IF(%s="","",%s*5)' % (P, P), "#,##0", "NFPA 101: 5 net ft² per person standing")
    s.section("6 · Weather triggers")
    s.kv("Weather risk", '=IF(%s="","Run /weather for this address",%s&" ("&%s&"/100)")' % (I("weather_label"), I("weather_label"), I("weather_score")))
    s.kv("Lightning stand-down radius (miles)", "=" + I("lightning_miles"), "0", "NWS: resume 30 minutes after the last thunder")
    s.kv("Wind hold (mph)", "=" + I("wind_hold_mph"), "0", "ANSI E1.21: written operations plan with manufacturer wind ratings")
    s.kv("Thunderstorms in past years (%)", E(I("storm_pct")), "0")
    s.kv("Gusts over hold in past years (%)", E(I("wind_hold_pct")), "0")
    s.kv("Heat days in past years (%)", E(I("heat_pct")), "0", "Plan shade, water refills and medical cooling if high")
    s.section("7 · Per-1,000 metrics (for benchmarking)")
    for lab, x in [("Toilets per 1,000", TT), ("Stewards per 1,000", ST), ("Water outlets per 1,000", WO)] :
        s.kv(lab, '=IF(OR(%s="",%s="",N(%s)=0),"",ROUND(%s/%s*1000,1))' % (x, P, P, x, P), "0.0")
    s.section("8 · Plan components checklist", "Status: Not started / Drafted / Submitted / Approved")
    s.header(["Plan / permit", "Status", "Owner / note"])
    first = s.r
    for item in ["Event Safety Plan / risk assessment", "Medical Needs Assessment & medical plan", "Crowd management plan (ingress, egress, density)", "Security & steward deployment plan",
                 "Severe weather & lightning plan (EAP)", "Structures & wind operations plan (ANSI E1.21)", "Tents & membrane structures permit (NFPA 102 / AHJ)", "Fire safety & fire permit (AHJ)",
                 "Traffic & transport management plan", "Water & sanitation plan", "Waste & recycling plan", "Alcohol management plan", "Lost child / vulnerable person procedure",
                 "Communications & radio plan", "Incident reporting & first-aid log"]:
        s.row([item, '=IF(%s<>"",IF(LEFT(A%d,4)="Fire",%s,""),"")' % (I("fire_permit"), s.r, I("fire_permit")) if item.startswith("Fire") else None, None], inputs={1, 2})
    dv = DataValidation(type="list", formula1='"Not started,Drafted,Submitted,Approved"', allow_blank=True)
    s.ws.add_data_validation(dv); dv.add("B%d:B%d" % (first, s.r - 1))
    for k, v in dict(peak=P, toilets=TT, toilets_f=tf, toilets_m=tm, urinals=tu, accessible=acc, water_outlets=WO, water_l=WL, waste_kg=WK, medical_tier=MT, stewards=ST, lanes=LN, egress_m=EW).items():
        REF[k] = ref(name, v)
    return s


def tab_rfid(wb):
    name = "RFID & POS"
    s = Sheet(wb, name, [40, 16, 16, 16, 40],
              "Sizing, costs, policies and the advance checklist from the Drive RFID/POS planner, WRSTBND proposals and Testival scope of work. Vendor prices are NOT included — get quotes.")
    sim = lambda i: 'SUMIFS(%s,%s,"%s")' % (TCOL("rfid", "qty"), TCOL("rfid", "id"), i)
    s.section("1 · Sizing", "Planned = your number (cream). Suggested pulls from the simulator or Safety Metrics.")
    s.header(["Item", "Suggested", "Planned", "With spares", "Basis"])
    rows = [
        ("wristbands", "Wristbands / credentials", '=IF(%s="","",ROUNDUP(%s*(1+%s),0))' % (I("attendance"), I("attendance"), I("band_spare_pct")), I("band_spare_pct"), "attendance + spare %"),
        ("portals", "Entry scanners / portals", '=IF(%s>0,%s,IF(%s="","",%s))' % (sim("scanner"), sim("scanner"), REF["lanes"], REF["lanes"]), I("device_spare_pct"), "simulator qty, else Safety Metrics entry lanes"),
        ("pos", "POS terminals (bars, food, merch)", '=IF(%s>0,%s,"")' % (sim("pos"), sim("pos")), I("device_spare_pct"), "simulator qty; observed: 16 POS at 1.5k, 60 POS at 25k (WRSTBND proposals)"),
        ("kiosks", "Registration / top-up kiosks", '=IF(%s>0,%s,"")' % (sim("registration_kiosk"), sim("registration_kiosk")), I("device_spare_pct"), "observed: 6 at 1.5k, 8 at 25k"),
        ("truss", "Portal truss / gantries", '=IF(%s>0,%s,"")' % (sim("truss"), sim("truss")), None, "simulator qty"),
    ]
    for key, lab, sug, spare, basis in rows:
        r = s.r
        s.row([lab, sug, None, '=IF(N(C%d)+N(B%d)=0,"",ROUNDUP(IF(C%d<>"",C%d,B%d)*(1+%s),0))' % (r, r, r, r, r, spare if spare else "0"), basis], [None, "#,##0", "#,##0", "#,##0", None], inputs={2})
        REF["rfid_" + key] = ref(name, "$D$%d" % r)
    s.section("2 · Observed device ratios (reference only)")
    s.header(["Event size (from proposals)", "Portals", "POS", "Registration", "Note"])
    s.row(["1,500 attendees", 7, 16, 6, "WRSTBND proposal (PixieRock)"])
    s.row(["25,000 attendees", 20, 60, 8, "WRSTBND proposal (HIVE)"])
    s.section("3 · Cost lines (from simulator)")
    s.header(["Item", "Unit price", "Qty", "Extended", "Unit"])
    f = s.r
    for i in range(TABLES["rfid"][0]):
        r = s.r
        s.row([E(T("rfid", "item", i)), E(T("rfid", "unit_price", i)), E(T("rfid", "qty", i)), '=IF(A%d="","",N(B%d)*N(C%d))' % (r, r, r), E(T("rfid", "unit", i))], [None, "money", "#,##0", "money", None])
    tot = s.row(["Total", None, None, "=SUM(D%d:D%d)" % (f, s.r - 1), '=IF(%s="","","sim subtotal: "&TEXT(%s,"$#,##0"))' % (I("rfid_subtotal"), I("rfid_subtotal"))], [None, None, None, "money", None])
    s.ws.cell(tot, 1).font = F_BOLD
    REF["rfid_total"] = ref(name, "$D$%d" % tot)
    s.row(["Free wristband tool & checklist", None, None, None, PJ + "/rfid (Hippie Wrangler)"])
    s.row(["Vendor exclusions to budget separately", None, None, None, "Weather covers, security of equipment overnight, golf carts, radios, freight (WRSTBND proposals)"])
    s.section("4 · Cashless policies")
    s.kv("Cashless mode", '=IF(%s="","closed / open / hybrid",%s)' % (I("cashless_mode"), I("cashless_mode")))
    for lab in ["Top-up methods (online, kiosk, cash booth)", "Minimum / maximum top-up", "Refund window & fee (state it before on-sale)", "Lost wristband: replacement fee & balance transfer",
                "Offline mode: what happens if network drops", "Tipping policy & staff payout", "Under-21 / alcohol flags on credentials", "Accessibility: cash option for unbanked guests"]:
        s.kv(lab, None, None, "", True)
    s.section("5 · Advance checklist", "Due = first show day − days before.")
    s.header(["Task", "Days before", "Due", "Owner", "Status"])
    for t, d in [("Choose vendor & sign SOW", 120), ("Credential design & artwork approved", 90), ("Ticketing integration tested", 75), ("Menu / product import (fields below)", 45),
                 ("Device counts locked & freight booked", 40), ("Network / Wi-Fi survey of site", 35), ("Staff & vendor training plan", 21), ("Wristbands mailed or fulfillment set", 21),
                 ("Onsite build, portals & POS test", 2), ("Daily settlement & reporting", 0)]:
        r = s.r
        s.row([t, d, '=IF(%s="","",%s-B%d)' % (START(), START(), r), None, None], [None, "0", "ddd d mmm yyyy", None, None], inputs={1, 3, 4})
    s.section("6 · Menu import fields (POS)", "From the Testival scope of work. One row per product.")
    s.header(["External ID", "Name", "Product Type", "Internal Ref / Barcode", "Sales Price · Tax · Category"])
    for k in range(10):
        s.row([None] * 5, inputs={0, 1, 2, 3, 4})
    s.section("7 · Training & FOH")
    for t in ["Bar & food staff: sale, refund, void, offline", "Box office: activation, top-up, lost band", "Supervisors: device swap, reports, settlement", "FOH policy: no cash / card fallback, tipping, ID checks"]:
        s.kv(t, None, None, "", True)
    s.ws.freeze_panes = "A5"
    return s


DEPTS = [("site", "Site"), ("production", "Production"), ("talent", "Talent"), ("marketing", "Marketing"), ("ticketing", "Ticketing"), ("staff", "Staff"),
         ("pre_production", "Pre-production"), ("misc", "Misc / ops"), ("annual_ops", "Annual ops"), ("rfid", "RFID / cashless"), ("safety", "Safety & weather")]


def tab_budget(wb):
    name = "Budget & Scenarios"
    s = Sheet(wb, name, [30, 34, 16, 12, 16, 16, 16, 30],
              "Structure follows the Music & Camping Master Budgeting Tool and Basic Scenario Calculator. Lines come from the simulator; edit amounts in Inputs → budget.")
    amt, fixed, dept = TCOL("budget", "amount"), TCOL("budget", "fixed"), TCOL("budget", "dept")
    s.section("1 · Headline")
    rev = s.kv("Ticket revenue", '=IF(%s<>"",%s,IF(OR(%s="",%s=""),"",%s*%s))' % (I("ticket_revenue"), I("ticket_revenue"), I("attendance"), I("ticket_price"), I("attendance"), I("ticket_price")), "money", "sim K22, else attendance × GA price")
    anc = s.kv("Ancillary + sponsor income", "=N(%s)" % I("ancillary_revenue"), "money")
    cost = s.kv("Total costs", '=IF(%s<>"",%s,SUM(%s))' % (I("total_opex"), I("total_opex"), amt), "money", "sim opex, else sum of budget lines")
    net = s.kv("Net profit / (loss)", '=IF(%s="","",%s+%s-%s)' % (rev, rev, anc, cost), "money")
    bep = s.kv("Break-even ticket price", '=IF(N(%s)=0,"",(%s-%s)/%s)' % (I("attendance"), cost, anc, I("attendance")), "money", "(costs − ancillary) ÷ attendance")
    bea = s.kv("Break-even attendance at GA price", '=IF(N(%s)=0,"",ROUNDUP(MAX(0,%s-%s)/%s,0))' % (I("ticket_price"), cost, anc, I("ticket_price")), "#,##0", "Basic Scenario Calculator method")
    s.kv("Simulator net after addbacks (K47)", E(I("net_profit")), "money", "includes the simulator's kickback / owner addbacks")
    s.kv("Simulator break-even (K2, sheet method)", E(I("break_even_price")), "money", "Master Budget K2 per-ticket rate from the simulator")
    s.kv("Target-profit ticket price", '=IF(N(%s)=0,"",(%s-%s+N(%s))/%s)' % (I("attendance"), cost, anc, I("target_profit"), I("attendance")), "money")
    s.kv("Monte Carlo chance of profit", E(I("mc_p_profit")), "0%", "from the simulator run")
    REF["break_even_att"] = ref(name, bea)
    REF["net"] = ref(name, net)
    s.section("2 · Scenarios", "Change attendance % and price (cream). Fixed costs stay; variable costs (lines marked N) scale with attendance.")
    s.header(["Scenario", "Attendance % of plan", "Attendance", "Ticket price", "Ticket revenue", "Total cost", "Net", "Margin"])
    var = 'SUMIFS(%s,%s,"N")' % (amt, fixed)
    for nm, pct in [("Worst case", 0.6), ("Soft", 0.75), ("Below plan", 0.9), ("Plan", 1.0), ("Strong", 1.1), ("Sell-out", 1.2)]:
        r = s.r
        s.row([nm, pct, '=IF(%s="","",ROUND(%s*B%d,0))' % (I("attendance"), I("attendance"), r), "=" + I("ticket_price"),
               '=IF(OR(C%d="",D%d=""),"",C%d*D%d)' % (r, r, r, r),
               '=IF(%s="","",%s-%s+%s*B%d)' % (cost, cost, var, var, r),
               '=IF(OR(E%d="",F%d=""),"",E%d+%s*B%d-F%d)' % (r, r, r, anc, r, r),
               '=IF(OR(G%d="",N(E%d)=0),"",G%d/(E%d+%s*B%d))' % (r, r, r, r, anc, r)],
              [None, "0%", "#,##0", "money", "money", "money", "money", "0%"], inputs={1, 3})
    s.ws.conditional_formatting.add("G%d:G%d" % (s.r - 6, s.r - 1), FormulaRule(formula=['AND(G%d<>"",G%d<0)' % (s.r - 6, s.r - 6)], fill=FILL_WARN))
    s.section("3 · Department roll-up")
    s.header(["Department", "Key", "Budgeted", "% of total", "", "", "", ""])
    f = s.r
    for key, lab in DEPTS:
        r = s.r
        s.row([lab, key, '=SUMIFS(%s,%s,B%d)' % (amt, dept, r), '=IF(SUM(%s)=0,"",C%d/SUM(%s))' % (amt, r, amt)], [None, None, "money", "0%"])
    s.row(["Total", None, "=SUM(C%d:C%d)" % (f, s.r - 1), None], [None, None, "money"])
    s.section("4 · Line items")
    s.header(["Department", "Line item", "Budgeted", "Fixed?", "Actual", "Variance", "% of total", "Note"])
    for i in range(TABLES["budget"][0]):
        r = s.r
        s.row([E(T("budget", "dept", i)), E(T("budget", "item", i)), E(T("budget", "amount", i)), E(T("budget", "fixed", i)), None,
               '=IF(OR(C%d="",E%d=""),"",E%d-C%d)' % (r, r, r, r), '=IF(OR(C%d="",SUM(%s)=0),"",C%d/SUM(%s))' % (r, amt, r, amt), E(T("budget", "note", i))],
              [None, None, "money", None, "money", "money", "0%", None], inputs={4})
    s.ws.freeze_panes = "A5"
    return s


def budget_lookup(pattern):
    return '=IFERROR(1/(1/SUMIFS(%s,%s,"%s")),"")' % (TCOL("budget", "amount"), TCOL("budget", "item"), pattern)


def tab_production(wb):
    s = Sheet(wb, "Production Fulfillment", [16, 40, 14, 12, 16, 16, 14, 14, 30],
              "Ops, staging and production order list. Quantities link to Safety Metrics and RFID & POS; budget column matches line items in Inputs → budget.")
    s.header(["Area", "Item", "Qty", "Unit", "Budget (sim)", "Vendor (no contacts)", "Order by", "Status", "Notes / spec"])
    f = s.r
    D = lambda days: '=IF(%s="","",%s-%d)' % (START(), START(), days)
    items = [
        ("Site", "Perimeter fencing", None, "ft", budget_lookup("Fencing"), 60, "Site plan sets length"),
        ("Site", "Bike-rack barricade", None, "sections", budget_lookup("Bikerack*"), 45, ""),
        ("Site", "Portable toilets (incl. accessible)", "=" + REF["toilets"], "units", budget_lookup("Portapotties*"), 45, "Purple Guide ratios — Safety Metrics"),
        ("Site", "Urinal units / troughs", "=" + REF["urinals"], "units", None, 45, ""),
        ("Site", "Accessible toilets", "=" + REF["accessible"], "units", None, 45, "Place on hard standing near accessible viewing"),
        ("Site", "Free water points", "=" + REF["water_outlets"], "outlets", budget_lookup("Miscellaneous*"), 30, '=IF(%s="","","~"&TEXT(%s,"#,##0")&" L drinking water total")' % (REF["water_l"], REF["water_l"])),
        ("Site", "Waste & recycling (dumpsters, bins, labor)", '=IF(%s="","",ROUND(%s/1000,1))' % (REF["waste_kg"], REF["waste_kg"]), "tonnes", budget_lookup("Trash*"), 30, "AGF benchmark — Safety Metrics"),
        ("Site", "Festival tents (vendors & production)", None, "tents", budget_lookup("Festival Tents*"), 45, "NFPA 102 / AHJ permit"),
        ("Site", "Generators (site)", None, "units", budget_lookup("Generators"), 45, "Fuel plan & refuel schedule"),
        ("Site", "Light towers", None, "units", budget_lookup("Heavy Equipment*"), 30, ""),
        ("Site", "Golf carts / utility vehicles", None, "units", budget_lookup("Golf Carts"), 30, "15 km/h site speed limit (MDLB handbook)"),
        ("Site", "Radios, batteries, chargers", '=IF(%s="","",ROUNDUP(%s/4,0))' % (I("crew_count"), I("crew_count")), "radios", budget_lookup("Walkie*"), 30, "ASSUMPTION 1 per 4 crew"),
        ("Site", "Directional & safety signage", None, "signs", budget_lookup("Directional Signage"), 30, "Exit, first aid, water, lost & found"),
        ("Medical", "Medical provider (tier per Purple Guide)", '="Tier "&%s' % REF["medical_tier"], "", budget_lookup("EMS Medical Services"), 60, "Medical Needs Assessment"),
        ("Security", "Security & stewards (peak shift)", '=MAX(N(%s),N(%s))' % (REF["stewards"], I("security_staff")), "staff", budget_lookup("Security"), 60, "SGSA ~1:250 floor; sim 1 per 100"),
        ("Ticketing", "Wristbands / credentials", "=" + REF["rfid_wristbands"], "bands", budget_lookup("Cloth Wristbands*"), 60, "incl. spares"),
        ("Ticketing", "Entry scanners / portals", "=" + REF["rfid_portals"], "devices", None, 40, ""),
        ("Ticketing", "POS terminals", "=" + REF["rfid_pos"], "devices", None, 40, ""),
        ("Ticketing", "Registration / top-up kiosks", "=" + REF["rfid_kiosks"], "kiosks", None, 40, ""),
        ("Ticketing", "Entry lanes", "=" + REF["lanes"], "lanes", None, 30, "Green Guide 660/h ceiling"),
        ("Production", "FOH build", None, "per stage", budget_lookup("FOH Build"), 30, ""),
        ("Production", "Crash barricade", None, "m", budget_lookup("Crash Barricade"), 30, ""),
        ("Production", "LED video walls", None, "", budget_lookup("LED Video Walls"), 45, ""),
        ("Production", "Lasers / effects (permits)", None, "", budget_lookup("Lasers"), 45, "FDA variance (US) / AHJ"),
        ("Production", "Backline per tech riders", None, "", budget_lookup("Backline*"), 21, ""),
        ("Hospitality", "Artist hotels", None, "rooms", budget_lookup("Hotels for Artists"), 30, ""),
        ("Hospitality", "Artist runners / ground transport", None, "", budget_lookup("Runners*"), 21, "Transport Master tab"),
        ("Hospitality", "Crew catering, water & green rooms", '=N(%s)+N(%s)' % (I("crew_count"), I("volunteer_count")), "people", budget_lookup("Production Food*"), 21, ""),
    ]
    for area, item, qty, unit, bud, days, note in items:
        s.row([area, item, qty, unit, bud, None, D(days), "Not ordered", note], [None, None, "#,##0", None, "money", None, "ddd d mmm", None, None], inputs={5, 7})
    for i in range(TABLES["stages"][0]):
        st = T("stages", "name", i)
        for part, pat in [("Staging & facade", "Stage & Facade*"), ("Sound", "Sound Stage*"), ("Lighting", "Lighting Stage*")]:
            n = i + 1
            lk = budget_lookup(pat.replace("Stage*", "Stage %d*" % n)) if n <= 3 else None
            if part == "Staging & facade" and n <= 3:
                lk = budget_lookup("Stage & Facade Design Materials  Stage %d*" % n)
            s.row(['=IF(%s="","","Stage")' % st, '=IF(%s="","",%s&" — %s")' % (st, st, part), '=IF(%s="","",1)' % st, "", lk, None, '=IF(OR(%s="",%s=""),"",%s-45)' % (st, START(), START()), '=IF(%s="","","Not ordered")' % st,
                   '=IF(%s="","",%s&" · cap "&TEXT(N(%s),"#,##0"))' % (st, T("stages", "type", i), T("stages", "capacity", i))],
                  [None, None, "#,##0", None, "money", None, "ddd d mmm", None, None], inputs={5, 7})
    dv = DataValidation(type="list", formula1='"Not ordered,Quoted,Ordered,Confirmed,Delivered,Returned"', allow_blank=True)
    s.ws.add_data_validation(dv); dv.add("H%d:H%d" % (f, s.r - 1))
    s.ws.freeze_panes = "A5"
    return s


def tab_handbook(wb):
    s = Sheet(wb, "Site & Crew Handbook", [30, 100],
              "Need-to-knows for every crew member, structured after the MDLBEAST SS22 Site Guidelines & Crew Handbook (v10). Replace bracketed text; keep phone numbers off shared copies.")
    def para(head, body):
        a = s.ws.cell(s.r, 1, head); a.font = F_BOLD; a.alignment = WRAP; a.border = BOX
        b = s.ws.cell(s.r, 2, body); b.font = F_BODY; b.alignment = WRAP; b.border = BOX
        if isinstance(body, str) and body.startswith("[") : b.fill = FILL_IN
        s.ws.row_dimensions[s.r].height = max(18, 15 * (1 + len(str(body)) // 110))
        s.r += 1
    s.section("1 · Welcome & mission")
    para("Event", '=IF(%s="","[Event name]",%s)&" — "&IF(%s="","[venue]",%s)&", "&%s&" "&%s' % (I("event_name"), I("event_name"), I("venue"), I("venue"), I("city"), I("state")))
    para("Show dates", '=IF(%s="","[dates]",TEXT(%s,"ddd d mmm")&" – "&TEXT(%s+%s-1,"ddd d mmm yyyy"))' % (START(), START(), START(), DAYS()))
    para("Build / break", '=IF(%s="","[build dates]","Build from "&TEXT(%s-%s,"ddd d mmm")&" · load-out complete "&TEXT(%s+%s-1+%s,"ddd d mmm"))' % (START(), START(), I("load_in_days"), START(), DAYS(), I("load_out_days")))
    para("Mission", "[One or two sentences on what this event is for and how crew make it happen.]")
    s.section("2 · Code of conduct & anti-harassment")
    para("Standard", "Zero tolerance for harassment, threats, unwanted contact, discriminatory language or gestures — online and offline, before, during and after the event. Applies to crew, artists, vendors, sponsors and guests.")
    para("Consequence", "Removal from site without pay or refund; authorities informed where the law is broken; possible ban from future events.")
    para("Report to", "[Conduct email / welfare tent location — no personal numbers]")
    s.section("3 · Emergency protocol")
    para("How to report", "1) Radio Event Control / Health & Safety on the emergency channel  2) Go to the nearest first-aid post  3) Tell the nearest security member.")
    para("Medical cover", '="Medical provider tier: "&%s&" (Purple Guide). Nearest hospital: "&IF(%s="","[minutes]",%s&" min")' % (REF["medical_tier"], I("hospital_minutes"), I("hospital_minutes")))
    para("Weather", '="Lightning within "&%s&" miles: stop outdoor work and move to shelter; resume 30 min after last thunder (NWS). Wind hold at "&%s&" mph per structure ratings."' % (I("lightning_miles"), I("wind_hold_mph")))
    para("Evacuation", "[Assembly points, who calls it, show-stop wording, egress routes — see site map]")
    s.section("4 · Incident reporting timelines")
    para("Immediately", "Near miss, medical emergency, lost-time injury, fire, structural concern, missing / vulnerable person.")
    para("Within 12 hours", "First-aid treatment, property damage, security incidents with no injury.")
    para("Form", "[Link to incident form / Odoo helpdesk]  Record: who, what, where, when, witnesses, action taken.")
    s.section("5 · Site safety rules")
    para("Induction", "Everyone completes the site safety induction before starting work and carries their credential at all times.")
    para("PPE", "Hi-vis to ISO 20471 during build and break; hard hat, gloves and safety boots where the task risk assessment requires.")
    para("Vehicles", "Site speed limit 15 km/h (~10 mph). Use ring/BOH roads, yield to through traffic, pedestrians use walkways. Vehicle passes pre-approved only.")
    para("Plant & heavy machinery", "Certified operators only; banksman for reversing; no plant moves in public areas while gates are open.")
    para("Night work", "Request tower lights in advance for work after sunset.")
    para("Working at height / rigging", "[Rigging supervisor, permit-to-work process, wind limits]")
    s.section("6 · Site operations")
    para("Site hours", '="Gates "&IF(%s="","[open]",TEXT(%s,"hh:mm"))&" – "&IF(%s="","[close]",TEXT(%s,"hh:mm"))&". Crew call ~3 h before gates."' % (I("gates_open"), I("gates_open"), I("gates_close"), I("gates_close")))
    para("Deliveries", "Book a delivery slot; deliveries outside the show hours only; driver needs vehicle pass and delivery reference.")
    para("Service stations", "[Water, power, waste and toilet points for crew — map refs]")
    para("Internet & radios", "[Wi-Fi network for production / POS; radio channel plan below]")
    s.section("7 · Credentials, uniforms & access")
    para("Credentials", "Non-transferable. Show on request. Lost credentials reported to Accreditation immediately.")
    para("Uniform", "[Crew shirt colours by department]")
    para("Zones", "[Zone letters / colours and who may enter backstage, FOH, BOH]")
    s.section("8 · Radio channels & key contacts (roles only)")
    s.header(["Channel", "Use / role"])
    for ch, use in [("1", "Event Control (emergency)"), ("2", "Production"), ("3", "Security"), ("4", "Medical / welfare"), ("5", "Site ops & logistics"), ("6", "Box office & RFID"), ("7", "Artist relations & transport"), ("8", "Bars & vendors")]:
        s.row([ch, use], inputs={1})
    return s


def tab_talent(wb):
    s = Sheet(wb, "Talent Worksheet", [26, 7, 12, 8, 10, 11, 11, 14, 14, 14, 14, 12, 12, 16, 16],
              "Max-guarantee method from the EMCF16 talent worksheet: an act's attributable ticket revenue ÷ (1 + (production + profit − extra revenue) ÷ talent budget).")
    s.section("1 · Budget inputs")
    tb = s.kv("Talent budget (TB)", '=IF(%s<>"",%s,SUM(%s))' % (I("talent_budget"), I("talent_budget"), TCOL("lineup", "offer")), "money")
    pb = s.kv("Production budget (PB)", "=N(%s)" % I("production_budget"), "money")
    pp = s.kv("Target profit (P)", "=N(%s)" % I("target_profit"), "money")
    er = s.kv("Extra revenue (ER)", "=N(%s)" % I("ancillary_revenue"), "money")
    tpf = s.kv("Full-pass price (TPF)", "=N(%s)" % I("ticket_price"), "money")
    tps = s.kv("Single-day price (TPS)", '=IF(%s<>"",%s,IF(N(%s)=0,"",%s/%s))' % (I("single_day_price"), I("single_day_price"), I("ticket_price"), I("ticket_price"), DAYS()), "money")
    fs = s.kv("Fans buying full pass", "=" + I("fest_pass_share"), "0%", "EMCF16 used 20%")
    dv = s.kv("Divisor 1 + (PB + P − ER) ÷ TB", '=IF(N(%s)=0,"",1+(%s+%s-%s)/%s)' % (tb, pb, pp, er, tb), "0.00")
    s.section("2 · Offers")
    s.header(["Artist", "Day", "Stage", "Tier", "Est. draw", "Full-pass fans", "Single-day fans", "Attributable revenue", "Max guarantee", "Suggested (sim)", "Offer", "Deposit", "Balance", "Offer vs max", "Agency"])
    f = s.r
    for i in range(TABLES["lineup"][0]):
        r = s.r; a = T("lineup", "artist", i)
        s.row([E(a), E(T("lineup", "day", i)), E(T("lineup", "stage", i)), E(T("lineup", "tier", i)), E(T("lineup", "draw", i)),
               '=IF(E%d="","",ROUND(E%d*%s,0))' % (r, r, fs), '=IF(E%d="","",E%d-F%d)' % (r, r, r),
               '=IF(E%d="","",F%d*%s+G%d*N(%s))' % (r, r, tpf, r, tps), '=IF(OR(H%d="",%s=""),"",H%d/%s)' % (r, dv, r, dv),
               E(T("lineup", "suggested_fee", i)), E(T("lineup", "offer", i)),
               '=IF(K%d="","",K%d*%s)' % (r, r, I("deposit_pct")), '=IF(K%d="","",K%d-L%d)' % (r, r, r),
               '=IF(OR(K%d="",I%d=""),"",IF(K%d>I%d,"⚠ over max","OK"))' % (r, r, r, r), E(T("lineup", "agency", i))],
              [None, None, None, None, "#,##0", "#,##0", "#,##0", "money", "money", "money", "money", "money", "money", None, None])
    l = s.r - 1
    s.row(["Totals", None, None, None, "=SUM(E%d:E%d)" % (f, l), None, None, None, "=SUM(I%d:I%d)" % (f, l), "=SUM(J%d:J%d)" % (f, l), "=SUM(K%d:K%d)" % (f, l), "=SUM(L%d:L%d)" % (f, l), "=SUM(M%d:M%d)" % (f, l),
           '=IF(N(%s)=0,"",IF(SUM(K%d:K%d)>%s,"⚠ offers exceed budget","within budget"))' % (tb, f, l, tb), None],
          [None, None, None, None, "#,##0", None, None, None, "money", "money", "money", "money", "money", None, None])
    s.ws.conditional_formatting.add("N%d:N%d" % (f, l + 1), FormulaRule(formula=['LEFT(N%d,1)="⚠"' % f], fill=FILL_WARN))
    s.section("3 · Sales scoreboard from announce", "EMCF16 tracked sales weekly from announce. Target line is a straight line to break-even attendance — ASSUMPTION; replace with your curve.")
    s.header(["Week", "Week of", "Target cumulative tickets", "Actual cumulative", "Gap", "Notes"])
    for k in range(1, 17):
        r = s.r
        s.row([k, '=IF(%s="","",%s+7*(A%d-1))' % (ANNOUNCE(), ANNOUNCE(), r), '=IF(N(%s)=0,"",ROUND(%s*A%d/16,0))' % (REF["break_even_att"], REF["break_even_att"], r), None,
               '=IF(OR(C%d="",D%d=""),"",D%d-C%d)' % (r, r, r, r), None], [None, "ddd d mmm", "#,##0", "#,##0", "#,##0", None], inputs={3, 5})
    s.ws.freeze_panes = "A5"
    return s


def tab_artist_marketing(wb):
    s = Sheet(wb, "Artist Marketing", [26, 8, 12, 12, 12, 12, 12, 60],
              "Promotion commitments per act (Drive Artists Marketing Checklist). Tracking links append UTM tags to your ticket URL.")
    s.section("1 · Tier requirements", "Tier 1 counts are from the Drive checklist; set Tier 2/3 yourself.")
    s.header(["Tier", "", "Newsletter", "Website", "Socials", "FB event", "", "Notes"])
    t1 = s.row(["Tier 1", None, 2, 2, 3, 1, None, "Headliners / top draw"], inputs={2, 3, 4, 5})
    t2 = s.row(["Tier 2", None, None, None, None, None, None, "ASSUMPTION: set your own"], inputs={2, 3, 4, 5})
    t3 = s.row(["Tier 3", None, None, None, None, None, None, "ASSUMPTION: set your own"], inputs={2, 3, 4, 5})
    s.section("2 · Tracker")
    s.header(["Artist", "Tier", "Newsletter ✓", "Website ✓", "Socials posted", "Socials req.", "FB event ✓", "Tracking link"])
    for i in range(TABLES["lineup"][0]):
        r = s.r; a = T("lineup", "artist", i)
        tier = 'IF(OR(%s="1",%s="Tier 1",%s="headliner"),%d,IF(OR(%s="2",%s="Tier 2"),%d,%d))' % (T("lineup", "tier", i), T("lineup", "tier", i), T("lineup", "tier", i), t1, T("lineup", "tier", i), T("lineup", "tier", i), t2, t3)
        s.row([E(a), E(T("lineup", "tier", i)), None, None, None, '=IF(A%d="","",INDEX($E:$E,%s))' % (r, tier), None,
               '=IF(OR(A%d="",%s=""),"",%s&IF(ISNUMBER(SEARCH("?",%s)),"&","?")&"utm_source="&LOWER(SUBSTITUTE(TRIM(A%d)," ","-"))&"&utm_medium=artist_social&utm_campaign=lineup")' % (r, I("ticket_url"), I("ticket_url"), I("ticket_url"), r)],
              inputs={2, 3, 4, 6})
    s.ws.freeze_panes = "A5"
    return s


ANNOUNCE_LEAD = {"Admin": 56, "Talent Buying": 56, "Sponsorship Approvals": 28, "Content": 28, "Print": 28, "Website": 21, "Publicity": 21, "Radio": 21,
                 "Social": 14, "Digital Ads": 14, "Data & Analytics": 14, "Street Team": 14, "E-mail": 7}


def tab_announce(wb):
    data = json.load(open(os.path.join(HERE, "data", "lineup_announce.json")))
    s = Sheet(wb, "Lineup Announce", [18, 26, 70, 10, 13, 14, 12],
              "Checklist from the Drive 'Festival Lineup Announce Checklist'. Lead days are suggested (ASSUMPTION) — edit them; due = announce date − lead days.")
    s.kv("Announce date", '=IF(%s="","set in Inputs",%s)' % (ANNOUNCE(), ANNOUNCE()), "ddd d mmm yyyy")
    s.kv("Public on-sale", '=IF(%s<>"",%s,IF(%s="","",%s+2))' % (I("onsale_date"), I("onsale_date"), ANNOUNCE(), ANNOUNCE()), "ddd d mmm yyyy")
    s.r += 1
    s.header(["Section", "Task", "Detail", "Lead days", "Due", "Owner", "Done"])
    for sec in data:
        lead = ANNOUNCE_LEAD.get(sec["section"], 14)
        for task, detail in sec["items"]:
            r = s.r
            s.row([sec["section"], task, detail, lead, '=IF(%s="","",%s-D%d)' % (ANNOUNCE(), ANNOUNCE(), r), None, None], [None, None, None, "0", "ddd d mmm", None, None], inputs={3, 5, 6})
    for task, detail, lead in [("Announce day", "Post lineup across all channels at the set time; monitor ticketing & site load", 0), ("On-sale day", "Sales scoreboard starts (Talent Worksheet §3)", -2)]:
        r = s.r
        s.row(["Go live", task, detail, lead, '=IF(%s="","",%s-D%d)' % (ANNOUNCE(), ANNOUNCE(), r), None, None], [None, None, None, "0", "ddd d mmm", None, None], inputs={3, 5, 6})
    s.ws.freeze_panes = "A5"
    return s


SOURCES = [
    ("The Purple Guide — ch.18 Sanitary facilities, Table 1 & 18.17", "Toilet & urinal ratios by gate time / food & alcohol; campsite ratios; 50:50 default", "https://www.thepurpleguide.co.uk/"),
    ("The Purple Guide — ch.5 Medical (rev. Dec 2024)", "Medical tiers by attendance; Medical Needs Assessment", "https://www.thepurpleguide.co.uk/"),
    ("SGSA Guide to Safety at Sports Grounds (Green Guide), 6th ed.", "Turnstile 660/h; egress 82 /m/min level, 66 stepped; 8 min egress; density 2.0/m² general, 4.0/m² standing", "https://sgsa.org.uk/greenguide/"),
    ("SGSA — stewarding guidance", "Mobile stewards ~1 per 250, set by risk assessment", "https://sgsa.org.uk/"),
    ("NSW Health — Mass gatherings: water", "4 L/person single day; 20 L/person/day camping incl. 4 L potable", "https://www.health.nsw.gov.au/"),
    ("WA Health — Guidelines for concerts, events and organised gatherings (2022)", "1 free water outlet per 1,000 at day events", "https://www.health.wa.gov.au/"),
    ("A Greener Festival (AGF) 2024 benchmark, via Airship", "Waste 0.5 kg/person/day day events; 1.4 kg camping", "https://www.agreenerfestival.com/"),
    ("NFPA 101 Life Safety Code", "Assembly occupant load factor 5 net ft² per person (standing)", "https://www.nfpa.org/codes-and-standards/nfpa-101"),
    ("NFPA 102 Grandstands, Folding & Telescopic Seating, Tents & Membrane Structures", "Tent permits & spacing", "https://www.nfpa.org/codes-and-standards/nfpa-102"),
    ("ANSI E1.21 — Temporary structures for outdoor events", "Written operations plan incl. wind thresholds", "https://tsp.esta.org/"),
    ("NOAA / National Weather Service — Lightning safety", "When thunder roars go indoors; wait 30 min after last thunder", "https://www.weather.gov/safety/lightning"),
    ("ISO 20471 High-visibility clothing", "Hi-vis standard for crew", "https://www.iso.org/standard/76663.html"),
    ("Drive: EMCF16 Talent Worksheet", "Max guarantee formula; 20% fest-pass share; 30% deposit; weekly scoreboard", "My Drive/APPS/Festival Forecaster"),
    ("Drive: Artists Marketing Checklist", "Tier 1 promo commitments", "My Drive/APPS/Festival Forecaster"),
    ("Drive: Festival Lineup Announce Checklist", "13-section announce checklist", "My Drive/APPS/Festival Forecaster"),
    ("Drive: Music & Camping Master Budgeting Tool / Basic Scenario Calculator", "Department structure; break-even method", "My Drive/APPS/Festival Forecaster"),
    ("Drive: IE26 Transport Master Sheet", "Transport log columns", "My Drive/APPS/Festival Forecaster"),
    ("Drive: Iceland Eclipse master schedule, Polaris / Music ROS", "ROS structure & cues", "My Drive/APPS/Festival Forecaster"),
    ("Drive: MDLBEAST SS22 Site Guidelines & Crew Handbook v10", "Handbook structure, 15 km/h, incident timelines, ISO 20471", "My Drive/APPS/Festival Forecaster"),
    ("Drive: Event RFID POS Planner, WRSTBND proposals, Testival24 SOW", "Device ratios observed, exclusions, menu import fields, training", "My Drive/APPS/Festival Forecaster"),
    ("Drive: Festival Packing List", "Attendee packing categories", "My Drive/APPS/Festival Forecaster"),
    ("Patron Journey Festival Forecaster", "Budget engine, RFID & safety lines, weather risk", PJ + "/forecaster/"),
]
ASSUMPTIONS = ["Values marked ASSUMPTION are editable placeholders, not research findings.", "Guidance ratios are planning floors. Local law, the licensing authority, AHJ / fire marshal and medical provider decide.",
               "Vendor prices from Drive proposals are deliberately excluded; get current quotes.", "No personal data (names of private individuals, phones, emails, PINs) is included in blank or sample files."]


def tab_sources(wb):
    s = Sheet(wb, "Sources", [56, 70, 48], "Every ratio and method in this workbook traces to one of these.")
    s.header(["Source", "Used for", "Link / location"])
    for a, b, c in SOURCES:
        r = s.row([a, b, c])
        if c.startswith("http"):
            s.ws.cell(r, 3).hyperlink = c
    s.section("Assumptions & caveats")
    for a in ASSUMPTIONS:
        s.row([a, None, None])
    return s


TEMPLATES = [
    ("ros", "Run of Show", "Run of Show", "Build/show/break dates, daily key times, stage schedule with overlap checks, show-day cues", "Run", [], tab_ros),
    ("packing", "Packing List", "Packing List", "Attendee list that adapts to weather & camping, plus crew kit", "Run", [], tab_packing),
    ("transport", "Transport Master", "Transport Master", "Shuttle & parking sizing and the master transport log", "Build", [], tab_transport),
    ("production", "Production Fulfillment", "Production Fulfillment", "Ops, staging & production order list linked to safety sizing and budget", "Build", ["safety", "rfid"], tab_production),
    ("handbook", "Site & Crew Handbook", "Site & Crew Handbook", "Crew need-to-knows: conduct, emergencies, incident timelines, site rules", "Build", ["safety"], tab_handbook),
    ("rfid", "RFID & POS Planner", "RFID & POS", "Device sizing, cost lines, cashless policies, advance checklist, menu import", "Plan", ["safety"], tab_rfid),
    ("talent", "Talent Worksheet", "Talent Worksheet", "Max guarantee per act, offers, deposits and the sales scoreboard", "Plan", ["budget"], tab_talent),
    ("artist_marketing", "Artist Marketing Checklist", "Artist Marketing", "Tier commitments and tracking links per act", "Marketing", [], tab_artist_marketing),
    ("announce", "Lineup Announce Checklist", "Lineup Announce", "13-section announce plan with due dates", "Marketing", [], tab_announce),
    ("budget", "Budget & Scenario Calculator", "Budget & Scenarios", "Headline P&L, break-even, 6 scenarios, department roll-up, line items", "Plan", [], tab_budget),
    ("safety", "Event Safety Guide & Metrics", "Safety Metrics", "Toilets, water, waste, medical, stewards, ingress/egress, weather triggers", "Safety", [], tab_safety),
]
BY_ID = {t[0]: t for t in TEMPLATES}
BUILD_ORDER = ["safety", "rfid", "budget", "ros", "packing", "transport", "production", "handbook", "talent", "artist_marketing", "announce"]
TAB_ORDER = ["ros", "packing", "transport", "production", "handbook", "rfid", "talent", "artist_marketing", "announce", "budget", "safety"]


def tab_cover(wb, ids, title):
    s = Sheet(wb, "Cover", [18, 34, 70, 14], "Patron Journey · Festival Forecaster")
    ws = s.ws
    ws["A1"] = title
    s.section("Contents")
    s.header(["#", "Tab", "What it covers", "Stage"])
    tabs = [("Inputs", "Inputs", "The only tab you edit — everything else reads from it", "")] + [(BY_ID[i][2], BY_ID[i][1], BY_ID[i][3], BY_ID[i][4]) for i in ids] + [("Sources", "Sources", "Citations, assumptions and caveats", "")]
    for n, (sheet, lab, desc, stage) in enumerate(tabs, 1):
        r = s.row([n, lab, desc, stage])
        c = ws.cell(r, 2); c.hyperlink = "#'%s'!A1" % sheet; c.font = Font(name="Calibri", size=10, color=GOLD, underline="single")
    s.section("How to use")
    for t in ["1. Fill the cream cells on Inputs (or download this file pre-filled from the Festival Forecaster).", "2. Each tab recalculates from Inputs. Cream cells on other tabs are for your own notes and status.",
              "3. Print: every tab is set to landscape, fit to page width.", "4. Before sharing outside your team, check no phone numbers, emails or PINs were added.",
              "5. Library & guides: " + PJ + "/library"]:
        s.row([None, t, None, None])
    s.kv("Data", "=" + I("data_mode"))
    s.kv("Generated", E(I("generated_at")))
    s.kv("Template version", VERSION)
    return s


def build(ids, title):
    wb = Workbook()
    wb.remove(wb.active)
    SCALAR_CELL.clear(); TABLE_POS.clear(); REF.clear()
    build_inputs(wb)
    need = []
    def add(i):
        for d in BY_ID[i][5]:
            add(d)
        if i not in need:
            need.append(i)
    for i in ids:
        add(i)
    for i in BUILD_ORDER:
        if i in need:
            BY_ID[i][6](wb)
    tab_sources(wb)
    tab_cover(wb, [i for i in TAB_ORDER if i in need], title)
    order = ["Cover", "Inputs"] + [BY_ID[i][2] for i in TAB_ORDER if i in need] + ["Sources"]
    wb._sheets = [wb[n] for n in order]
    wb.active = 0
    wb.calculation.fullCalcOnLoad = True
    wb.properties.creator = "Patron Journey"
    wb.properties.title = title
    return wb, [i for i in TAB_ORDER if i in need]


def main():
    os.makedirs(os.path.join(OUT, "templates"), exist_ok=True)
    files = {}
    wb, tabs = build(TAB_ORDER, "EVENT BIBLE")
    p = os.path.join(OUT, "event-bible.xlsx"); wb.save(p)
    files["event-bible"] = {"path": "event-bible.xlsx", "title": "Event Bible (all templates)", "tabs": tabs}
    for tid, label, sheet, desc, stage, deps, fn in TEMPLATES:
        wb, tabs = build([tid], label.upper())
        wb.save(os.path.join(OUT, "templates", tid + ".xlsx"))
        files[tid] = {"path": "templates/%s.xlsx" % tid, "title": label, "sheet": sheet, "description": desc, "stage": stage, "tabs": tabs}
    fm = {
        "version": VERSION, "inputs_sheet": "Inputs", "value_column": "C",
        "scalars": {k: {"cell": "C%d" % SCALAR_CELL[k], "type": t, "label": l, "source": src} for k, l, t, d, src, n in SCALARS},
        "tables": {n: {"first_row": TABLE_POS[n][0], "max_rows": TABLES[n][0], "columns": {f: {"col": TABLE_POS[n][1][f], "type": t} for f, lab, t in TABLES[n][1]}} for n in TABLES},
        "files": files,
    }
    json.dump(fm, open(os.path.join(OUT, "field_map.json"), "w"), indent=1, ensure_ascii=False)
    print("built", len(files), "files; inputs rows", len(SCALAR_CELL))


if __name__ == "__main__":
    main()
