/**
 * SVG poster download — name, dates, city/state, type, camping, size band, talent.
 * No fake headliners.
 */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sizeBandLabel(N) {
    const n = Number(N) || 0;
    if (n < 1000) return "Intimate (<1k)";
    if (n < 5000) return "Boutique (1–5k)";
    if (n < 15000) return "Mid (5–15k)";
    if (n < 40000) return "Large (15–40k)";
    return "Stadium (40k+)";
  }

  function fmtMoney(n) {
    return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
  }

  function buildSvg(profile, pnl) {
    const name = profile.name || "Untitled Festival";
    const dates =
      [profile.start_date, profile.end_date].filter(Boolean).join(" → ") ||
      "Dates TBD";
    const place = [profile.city, profile.state].filter(Boolean).join(", ") || "Location TBD";
    const type = profile.type || "Festival";
    const camping = profile.camping ? "Camping: ON" : "Camping: OFF";
    const band = sizeBandLabel(profile.N);
    const talent =
      pnl && pnl.departments
        ? "Talent budget " + fmtMoney(pnl.departments.talent)
        : "Talent budget TBD";
    const N = profile.N ? Number(profile.N).toLocaleString("en-US") + " capacity" : "";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="55%" stop-color="#1e1b4b"/>
      <stop offset="100%" stop-color="#312e81"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1350" fill="url(#bg)"/>
  <rect x="48" y="48" width="984" height="1254" rx="24" fill="none" stroke="url(#accent)" stroke-width="3" opacity="0.85"/>
  <text x="540" y="160" text-anchor="middle" fill="#94a3b8" font-family="Georgia, serif" font-size="22" letter-spacing="6">LINEUP INSURANCE PACK</text>
  <text x="540" y="280" text-anchor="middle" fill="#f8fafc" font-family="Georgia, serif" font-size="64" font-weight="700">${esc(name)}</text>
  <rect x="390" y="320" width="300" height="4" fill="url(#accent)"/>
  <text x="540" y="420" text-anchor="middle" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="32">${esc(dates)}</text>
  <text x="540" y="480" text-anchor="middle" fill="#c4b5fd" font-family="system-ui,sans-serif" font-size="28">${esc(place)}</text>
  <g font-family="system-ui,sans-serif" font-size="26" fill="#f1f5f9">
    <text x="540" y="620" text-anchor="middle">${esc(type)}</text>
    <text x="540" y="680" text-anchor="middle">${esc(camping)}</text>
    <text x="540" y="740" text-anchor="middle">${esc(band)}${N ? " · " + esc(N) : ""}</text>
    <text x="540" y="800" text-anchor="middle">${esc(talent)}</text>
  </g>
  <text x="540" y="1080" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="18">No invented headliners — talent $ only</text>
  <text x="540" y="1220" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="20">Festival Forecaster · Patron Journey</text>
</svg>`;
  }

  function download(profile, pnl) {
    const svg = buildSvg(profile, pnl);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (profile.name || "festival").replace(/[^\w\-]+/g, "_").slice(0, 40);
    a.href = url;
    a.download = safe + "_poster.svg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return svg;
  }

  global.Poster = { buildSvg, download, sizeBandLabel };
})(typeof window !== "undefined" ? window : global);
