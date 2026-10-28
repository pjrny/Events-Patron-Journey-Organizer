/**
 * RFID / Cashless (Basic Scenario) — optional add-on estimate.
 * Unit prices from Tool Basic Scenario Calculator PRICES row only.
 * NOT Master Budget. Additive to live forecast opex when enabled.
 */
(function (global) {
  "use strict";

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function ceil(n) {
    return Math.ceil(n);
  }

  function defaultCatalog() {
    const baked =
      (typeof global !== "undefined" && global.RFID_MODEL) ||
      (typeof window !== "undefined" && window.RFID_MODEL) ||
      null;
    if (baked && Array.isArray(baked.catalog)) return baked;
    return null;
  }

  /**
   * Default qty heuristics labeled ASSUMPTION in UI.
   */
  function defaultQtys(N) {
    N = Math.max(0, num(N, 0));
    const scanners = Math.max(4, ceil(N / 800));
    const pos = Math.max(4, ceil(N / 400));
    const registration_kiosk = Math.max(2, ceil(N / 2000));
    const labor_traveling = 2;
    return {
      ticketing_fee: N,
      scanner: scanners,
      truss: scanners,
      registration_kiosk: registration_kiosk,
      pos: pos,
      platform_fee: 1,
      activation_fee: N,
      shipping_service: 1,
      labor_traveling: labor_traveling,
      labor_local: 2,
      travel_perdiem: labor_traveling,
      rfid_consumable: N,
      mail_fulfill: Math.max(1, ceil(N * 0.03)),
    };
  }

  /**
   * computeRfidEstimate({ N, qtyOverrides, enabled, catalog })
   * → { enabled, lines[{id,label,unit_price,qty,unit,extended,sheet}], subtotal, consumer_passthrough, assumption_note }
   */
  function computeRfidEstimate(opts) {
    opts = opts || {};
    const enabled = !!opts.enabled;
    const N = num(opts.N, 0);
    const model = opts.catalog || defaultCatalog();
    const catalog = (model && model.catalog) || [];
    const overrides = opts.qtyOverrides || {};

    const consumerSrc =
      (model && model.consumer_passthrough) || {
        ticket_fee_consumer: { label: "Consumer ticket fee (pass-through)", amount: 7.0 },
        fulfill_fee_consumer: { label: "Consumer fulfill fee (pass-through)", amount: 4.99 },
      };

    const consumer_passthrough = {
      ticket_fee_consumer: num(
        consumerSrc.ticket_fee_consumer && consumerSrc.ticket_fee_consumer.amount != null
          ? consumerSrc.ticket_fee_consumer.amount
          : consumerSrc.ticket_fee_consumer,
        7.0
      ),
      fulfill_fee_consumer: num(
        consumerSrc.fulfill_fee_consumer && consumerSrc.fulfill_fee_consumer.amount != null
          ? consumerSrc.fulfill_fee_consumer.amount
          : consumerSrc.fulfill_fee_consumer,
        4.99
      ),
      note: "Consumer-paid fees — NOT promoter opex; pass-through info only.",
    };

    if (!enabled) {
      return {
        enabled: false,
        lines: [],
        subtotal: 0,
        consumer_passthrough: consumer_passthrough,
        assumption_note: null,
        bucket_label: "RFID / Cashless (Basic Scenario)",
      };
    }

    const defs = defaultQtys(N);
    // Resolve overrides: if user sets labor_traveling, travel_perdiem follows unless also overridden
    const qty = Object.assign({}, defs);
    Object.keys(overrides).forEach(function (k) {
      if (overrides[k] === "" || overrides[k] == null) return;
      const v = Number(overrides[k]);
      if (Number.isFinite(v) && v >= 0) qty[k] = v;
    });
    if (
      Object.prototype.hasOwnProperty.call(overrides, "labor_traveling") &&
      !Object.prototype.hasOwnProperty.call(overrides, "travel_perdiem")
    ) {
      const lt = Number(overrides.labor_traveling);
      if (Number.isFinite(lt) && lt >= 0) qty.travel_perdiem = lt;
    }

    const lines = catalog.map(function (item) {
      const q = num(qty[item.id], 0);
      const up = num(item.unit_price, 0);
      const extended = Math.round(up * q * 100) / 100;
      return {
        id: item.id,
        label: item.label,
        unit_price: up,
        qty: q,
        unit: item.unit,
        extended: extended,
        sheet: item.sheet || "",
        qty_rule: item.qty_rule || "",
      };
    });

    const subtotal = Math.round(lines.reduce(function (s, l) {
      return s + l.extended;
    }, 0) * 100) / 100;

    return {
      enabled: true,
      lines: lines,
      subtotal: subtotal,
      consumer_passthrough: consumer_passthrough,
      assumption_note:
        "ASSUMPTION: default qtys from heuristics (scanners≈max(4,ceil(N/800)), POS≈max(4,ceil(N/400)), kiosk≈max(2,ceil(N/2000)), mail≈3% of N, labor 2/2). Edit any qty.",
      bucket_label: (model && model.label) || "RFID / Cashless (Basic Scenario)",
      source_note:
        (model && model.source_note) ||
        "Unit prices from Tool Basic Scenario Calculator — not Master Budget.",
    };
  }

  global.RfidAddon = {
    computeRfidEstimate: computeRfidEstimate,
    defaultQtys: defaultQtys,
    defaultCatalog: defaultCatalog,
  };
})(typeof window !== "undefined" ? window : global);
