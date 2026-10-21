#!/usr/bin/env python3
"""Build D1 seed SQL for festival_directory from forecast_sim_event/festivals.json.
Coords: offline GeoNames cities1000 (CC-BY 4.0) matched on city+state+country, then city+country.
Personal contact emails/phones are NEVER written; only a website domain derived from a non-freemail
contact email domain (e.g. info@artdubai.ae -> artdubai.ae)."""
import json, sys, re, unicodedata, collections
src, gn, out = sys.argv[1], sys.argv[2], sys.argv[3]
def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^(st\.?|saint)\s", "saint ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()
by_state, by_cty = {}, {}
for line in open(gn, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    lat, lon, cc, a1, pop = float(f[4]), float(f[5]), f[8], f[10], int(f[14] or 0)
    for nm in {norm(f[1]), norm(f[2])}:
        if not nm: continue
        for d, k in ((by_state, (cc, a1, nm)), (by_cty, (cc, nm))):
            if k not in d or d[k][2] < pop: d[k] = (lat, lon, pop)
FREE = {"gmail.com","yahoo.com","hotmail.com","outlook.com","aol.com","icloud.com","live.com","msn.com","comcast.net","me.com","ymail.com","att.net","sbcglobal.net","verizon.net","gmx.de","web.de","hotmail.co.uk","yahoo.co.uk","btinternet.com","mail.com","protonmail.com","bellsouth.net","cox.net","charter.net","earthlink.net","rocketmail.com","googlemail.com"}
def q(v):
    if v is None: return "NULL"
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"
rows = json.load(open(src)); stats = collections.Counter()
with open(out, "w") as o:
    o.write("DELETE FROM festival_directory;\n")
    batch = []
    for i, r in enumerate(rows, 1):
        cc = (r.get("country") or "").upper(); st = (r.get("state") or "").upper(); c = norm(r.get("city"))
        hit = by_state.get((cc, st, c)); prec = "city" if hit else None
        if not hit and cc != "US":  # US: no cross-state fallback (Springfield problem)
            hit = by_cty.get((cc, c)); prec = "city_country" if hit else None
        stats[prec or "none"] += 1
        lat, lon = (round(hit[0], 4), round(hit[1], 4)) if hit else (None, None)
        sd = r.get("start") or None; m = int(sd[5:7]) if sd and re.match(r"\d{4}-\d{2}", sd) else None
        web = None
        em = re.search(r"@([A-Za-z0-9.-]+\.[A-Za-z]{2,})", r.get("contact") or "")
        if em and em.group(1).lower() not in FREE: web = em.group(1).lower()
        att = r.get("attendance"); att = int(att) if isinstance(att, (int, float)) else None
        vals = (i, r["name"], r.get("city"), st or None, cc or None, lat, lon, prec, m, sd, r.get("end") or None,
                r.get("category"), r.get("subcategory"), att, web, "forecast_sim_event/festivals.json")
        batch.append("(" + ",".join(q(v) for v in vals) + ")")
        if len(batch) == 200:
            o.write("INSERT INTO festival_directory (id,name,city,state,country,lat,lon,geo_precision,month,start_date,end_date,category,subcategory,attendance,website,source) VALUES " + ",".join(batch) + ";\n"); batch = []
    if batch: o.write("INSERT INTO festival_directory (id,name,city,state,country,lat,lon,geo_precision,month,start_date,end_date,category,subcategory,attendance,website,source) VALUES " + ",".join(batch) + ";\n")
print(len(rows), dict(stats))
