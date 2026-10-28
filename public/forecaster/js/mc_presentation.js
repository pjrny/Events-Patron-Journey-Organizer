/**
 * Phase 2 Monte Carlo journey presentation — clock, dual feeds, scrub, debrief.
 * Does not alter Master Budget math; animates one representative draw.
 */
(function (global) {
  "use strict";

  var DEFAULT_DURATION_MS = 30000; // 20–40s compressed; mid default
  var MIN_MS = 20000;
  var MAX_MS = 40000;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmtMoney(n) {
    var v = Number(n) || 0;
    var sign = v < 0 ? "-" : "+";
    if (v === 0) sign = "";
    return sign + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");
  }

  function create(cfg) {
    cfg = cfg || {};
    var els = {
      rail: null,
      opsFeed: null,
      crowdFeed: null,
      clock: null,
      progress: null,
      debrief: null,
      pauseBtn: null,
      scrub: null,
    };

    var state = {
      playing: false,
      paused: false,
      t0: 0,
      elapsed: 0,
      duration: DEFAULT_DURATION_MS,
      raf: null,
      band: "P50",
      draw: null,
      mcResult: null,
      ros: null,
      stages: [],
      stageIndex: 0,
      events: [], // scheduled feed events
      emitted: 0,
      campingOn: true,
      healthProtocolOn: false,
      ctx: {},
      rng: mulberry32(99),
    };

    function bindDom() {
      els.rail = document.getElementById("mcJourneyRail");
      els.opsFeed = document.getElementById("mcOpsFeed");
      els.crowdFeed = document.getElementById("mcCrowdFeed");
      els.clock = document.getElementById("mcJourneyClock");
      els.progress = document.getElementById("mcJourneyProgress");
      els.debrief = document.getElementById("mcJourneyDebrief");
      els.pauseBtn = document.getElementById("mcJourneyPause");
      els.scrub = document.getElementById("mcJourneyScrub");
      els.stageStatus = document.getElementById("mcJourneyStageStatus");
    }

    function stageStatusFor(harsh, stageId, draw) {
      var flags = global.OpsBank ? global.OpsBank.shockFlags(draw) : {};
      if (harsh >= 2 && (flags.weather || flags.attendance) && (stageId === "weather" || stageId === "queue" || stageId === "egress"))
        return "Incident";
      if (harsh >= 1 && (flags.talent || flags.production || flags.onsite || flags.weather))
        return "Strain";
      return "Clear";
    }

    function buildSchedule(draw, band, rosRows) {
      var Ops = global.OpsBank;
      var Crowd = global.CrowdBank;
      var stages = Ops.activeStages(state.campingOn);
      state.stages = stages;
      var duration = state.duration;
      var events = [];
      var rng = state.rng;
      var cues = global.RosGate
        ? global.RosGate.timelineFromRos(rosRows, duration)
        : [];

      stages.forEach(function (st, si) {
        var start = Math.round((si / stages.length) * duration);
        var end =
          si === stages.length - 1
            ? duration
            : Math.round(((si + 1) / stages.length) * duration);
        var opsLines = Ops.linesForStage(st.id, draw, band, {
          healthProtocolOn: state.healthProtocolOn,
        });
        // 1 OPS per stage window (pick highest severity)
        var sevRank = { Stop: 3, Incident: 2, Watch: 1, Info: 0 };
        opsLines.sort(function (a, b) {
          return (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
        });
        var primary = opsLines[0];
        events.push({
          atMs: start + Math.min(400, Math.floor((end - start) * 0.15)),
          kind: "ops",
          stageId: st.id,
          payload: primary,
        });
        // optional second OPS if hard day + second line
        if (band === "P10" && opsLines[1] && end - start > 2000) {
          events.push({
            atMs: start + Math.floor((end - start) * 0.55),
            kind: "ops",
            stageId: st.id,
            payload: opsLines[1],
          });
        }

        // ~2 CROWD per OPS
        var crowdCount = band === "P90" ? 3 : 2;
        var lines = Crowd.pickLines(
          rng,
          crowdCount,
          { healthProtocolOn: state.healthProtocolOn },
          state.ctx
        );
        for (var ci = 0; ci < lines.length; ci++) {
          var frac = 0.3 + ci * 0.25;
          var at = start + Math.floor((end - start) * frac);
          // Crowd never outruns clock — clamp below end
          at = Math.min(at, end - 50);
          events.push({
            atMs: at,
            kind: "crowd",
            stageId: st.id,
            payload: {
              handle: Crowd.anonHandle(rng),
              text: lines[ci],
              mood: band === "P10" ? "strain" : band === "P90" ? "happy" : "neutral",
            },
          });
        }

        events.push({
          atMs: start,
          kind: "stage",
          stageId: st.id,
          payload: {
            label: st.label,
            status: stageStatusFor(Ops.harshnessFromDraw(draw, band), st.id, draw),
          },
        });
      });

      // ROS cue markers (clock labels)
      cues.forEach(function (c) {
        events.push({
          atMs: c.atMs,
          kind: "ros",
          stageId: null,
          payload: c,
        });
      });

      events.sort(function (a, b) {
        return a.atMs - b.atMs;
      });
      return events;
    }

    function clearFeeds() {
      if (els.opsFeed) els.opsFeed.innerHTML = "";
      if (els.crowdFeed) els.crowdFeed.innerHTML = "";
    }

    function renderRail(activeId, statusMap) {
      if (!els.rail) return;
      els.rail.innerHTML = state.stages
        .map(function (st) {
          var stStatus = (statusMap && statusMap[st.id]) || "Clear";
          var cls =
            "journey-stage" +
            (st.id === activeId ? " active" : "") +
            " status-" +
            stStatus.toLowerCase();
          return (
            "<div class='" +
            cls +
            "' data-stage='" +
            st.id +
            "'><div class='js-label'>" +
            escapeHtml(st.label) +
            "</div><div class='js-status'>" +
            stStatus +
            "</div></div>"
          );
        })
        .join("");
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function appendOps(p) {
      if (!els.opsFeed || !p) return;
      var div = document.createElement("div");
      div.className = "feed-item ops sev-" + String(p.severity || "Info").toLowerCase();
      div.innerHTML =
        "<div class='feed-meta'><span class='sev'>" +
        escapeHtml(p.severity || "Info") +
        "</span> · <span class='stage'>" +
        escapeHtml(p.stage || "") +
        "</span></div>" +
        "<div class='feed-line'>" +
        escapeHtml(p.sentence || "") +
        "</div>" +
        "<div class='feed-mit'>" +
        escapeHtml(p.mitigation || "") +
        "</div>" +
        "<div class='feed-delta'>" +
        fmtMoney(p.moneyDelta) +
        " · attn " +
        (p.attendanceDelta >= 0 ? "+" : "") +
        (p.attendanceDelta || 0) +
        "</div>";
      els.opsFeed.appendChild(div);
      els.opsFeed.scrollTop = els.opsFeed.scrollHeight;
    }

    function appendCrowd(p) {
      if (!els.crowdFeed || !p) return;
      var div = document.createElement("div");
      div.className = "feed-item crowd mood-" + (p.mood || "neutral");
      div.innerHTML =
        "<div class='feed-meta'>" +
        escapeHtml(p.handle || "@anon") +
        "</div>" +
        "<div class='feed-line'>" +
        escapeHtml(p.text || "") +
        "</div>";
      els.crowdFeed.appendChild(div);
      els.crowdFeed.scrollTop = els.crowdFeed.scrollHeight;
    }

    function setClock(ms, rosLabel) {
      if (els.clock) {
        var sec = (ms / 1000).toFixed(1);
        els.clock.textContent =
          (rosLabel ? rosLabel + " · " : "") + sec + "s / " + (state.duration / 1000).toFixed(0) + "s";
      }
      if (els.progress) {
        var pct = Math.min(100, (ms / state.duration) * 100);
        els.progress.style.width = pct + "%";
      }
      if (els.scrub) {
        els.scrub.value = String(Math.round(ms));
        els.scrub.max = String(state.duration);
      }
    }

    function emitUntil(ms) {
      while (state.emitted < state.events.length && state.events[state.emitted].atMs <= ms) {
        var ev = state.events[state.emitted++];
        if (ev.kind === "stage") {
          state.stageIndex = state.stages.findIndex(function (s) {
            return s.id === ev.stageId;
          });
          var map = {};
          map[ev.stageId] = ev.payload.status;
          renderRail(ev.stageId, map);
          if (els.stageStatus) {
            els.stageStatus.textContent = ev.payload.label + " — " + ev.payload.status;
          }
        } else if (ev.kind === "ops") {
          appendOps(ev.payload);
        } else if (ev.kind === "crowd") {
          appendCrowd(ev.payload);
        } else if (ev.kind === "ros") {
          setClock(ms, ev.payload.time + " " + (ev.payload.action || ""));
        }
      }
    }

    function finish() {
      state.playing = false;
      state.paused = false;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = null;
      setClock(state.duration);
      renderDebrief();
      if (typeof cfg.onComplete === "function") cfg.onComplete(state);
    }

    function renderDebrief() {
      if (!els.debrief) return;
      var Ops = global.OpsBank;
      var items = Ops.debriefStages(state.draw, state.campingOn);
      els.debrief.hidden = false;
      els.debrief.innerHTML =
        "<h3>Journey debrief</h3>" +
        "<p class='footer-note' style='text-align:left;padding:0'>Three stages that moved money / risk on this " +
        state.band +
        " draw:</p>" +
        "<ul class='debrief-list'>" +
        items
          .map(function (it) {
            return (
              "<li><strong>" +
              escapeHtml(it.label) +
              "</strong> · " +
              escapeHtml(it.severity) +
              "<div class='feed-line'>" +
              escapeHtml(it.opsLine) +
              "</div>" +
              "<div class='feed-delta'>" +
              fmtMoney(it.moneyDelta) +
              "</div></li>"
            );
          })
          .join("") +
        "</ul>" +
        "<div class='debrief-actions'>" +
        "<button type='button' id='btnReplayP10'>Replay P10</button>" +
        "<button type='button' id='btnReplayP50' class='primary'>Replay P50</button>" +
        "<button type='button' id='btnReplayP90'>Replay P90</button>" +
        "<button type='button' id='btnDownloadMcPack'>Download pack</button>" +
        "</div>";

      var rp10 = document.getElementById("btnReplayP10");
      var rp50 = document.getElementById("btnReplayP50");
      var rp90 = document.getElementById("btnReplayP90");
      var dl = document.getElementById("btnDownloadMcPack");
      if (rp10)
        rp10.onclick = function () {
          replay("P10");
        };
      if (rp50)
        rp50.onclick = function () {
          replay("P50");
        };
      if (rp90)
        rp90.onclick = function () {
          replay("P90");
        };
      if (dl && typeof cfg.onDownloadPack === "function")
        dl.onclick = function () {
          cfg.onDownloadPack();
        };
    }

    function tick(now) {
      if (!state.playing || state.paused) return;
      state.elapsed = Math.min(state.duration, now - state.t0);
      emitUntil(state.elapsed);
      setClock(state.elapsed);
      if (state.elapsed >= state.duration) {
        finish();
        return;
      }
      state.raf = requestAnimationFrame(tick);
    }

    function resetPlayback() {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = null;
      state.playing = false;
      state.paused = false;
      state.elapsed = 0;
      state.emitted = 0;
      clearFeeds();
      if (els.debrief) {
        els.debrief.hidden = true;
        els.debrief.innerHTML = "";
      }
    }

    function start(opts) {
      opts = opts || {};
      bindDom();
      resetPlayback();
      state.mcResult = opts.mcResult || state.mcResult;
      state.band = opts.band || "P50";
      state.campingOn = opts.campingOn !== false;
      state.healthProtocolOn = !!opts.healthProtocolOn;
      state.ctx = opts.ctx || {};
      state.ros = opts.ros || null;
      state.duration = Math.max(MIN_MS, Math.min(MAX_MS, opts.durationMs || DEFAULT_DURATION_MS));
      state.rng = mulberry32((opts.seed != null ? opts.seed : 99) + state.band.charCodeAt(1));

      var MC = global.MonteCarlo;
      var draw =
        opts.draw ||
        (MC && state.mcResult
          ? MC.pickRepresentativeDraw(state.mcResult, state.band)
          : null);
      if (!draw && state.mcResult) {
        draw = {
          net: state.mcResult[state.band] || state.mcResult.P50,
          baseNet: state.mcResult.baseNet,
          shocks: {},
          N: 0,
          baseN: 0,
        };
      }
      state.draw = draw;

      var rosRows = (state.ros && state.ros.rows) || [];
      state.events = buildSchedule(draw, state.band, rosRows);
      renderRail(state.stages[0] && state.stages[0].id, {});
      setClock(0);

      // Show presentation shell
      var shell = document.getElementById("mcJourneyShell");
      if (shell) shell.hidden = false;

      state.playing = true;
      state.paused = false;
      state.t0 = performance.now();
      if (els.pauseBtn) els.pauseBtn.textContent = "Pause";
      state.raf = requestAnimationFrame(tick);
    }

    function replay(band) {
      start({
        mcResult: state.mcResult,
        band: band,
        campingOn: state.campingOn,
        healthProtocolOn: state.healthProtocolOn,
        ctx: state.ctx,
        ros: state.ros,
        durationMs: state.duration,
      });
    }

    function pauseToggle() {
      if (!state.playing && state.elapsed >= state.duration) return;
      if (!state.playing) return;
      if (state.paused) {
        state.paused = false;
        state.t0 = performance.now() - state.elapsed;
        if (els.pauseBtn) els.pauseBtn.textContent = "Pause";
        state.raf = requestAnimationFrame(tick);
      } else {
        state.paused = true;
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = null;
        if (els.pauseBtn) els.pauseBtn.textContent = "Resume";
      }
    }

    function scrubTo(ms) {
      ms = Math.max(0, Math.min(state.duration, Number(ms) || 0));
      // Rebuild feeds up to ms
      clearFeeds();
      state.emitted = 0;
      state.elapsed = ms;
      emitUntil(ms);
      setClock(ms);
      if (ms >= state.duration) {
        finish();
      } else if (state.playing && !state.paused) {
        state.t0 = performance.now() - ms;
      }
    }

    function wireControls() {
      bindDom();
      if (els.pauseBtn) {
        els.pauseBtn.addEventListener("click", pauseToggle);
      }
      if (els.scrub) {
        els.scrub.addEventListener("input", function () {
          state.paused = true;
          if (els.pauseBtn) els.pauseBtn.textContent = "Resume";
          if (state.raf) cancelAnimationFrame(state.raf);
          state.raf = null;
          scrubTo(els.scrub.value);
        });
      }
    }

    return {
      start: start,
      replay: replay,
      pauseToggle: pauseToggle,
      scrubTo: scrubTo,
      wireControls: wireControls,
      resetPlayback: resetPlayback,
      getState: function () {
        return state;
      },
    };
  }

  global.McPresentation = { create: create, DEFAULT_DURATION_MS: DEFAULT_DURATION_MS };
})(typeof window !== "undefined" ? window : global);
