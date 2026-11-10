/*
  Business improvement calculator.
  The maths lives in `compute`, which is pure and tested in tests/calc.test.js.
  Figures and sources come from calculator.json (built into /assets/calc-data.js as window.GAINORA_CALC).
  Prices come from site.config.json through the same file. Nothing is stored or sent.
*/
(function (root) {
  "use strict";

  var WEEKS_PER_MONTH = 4.33;
  var HR_HOURS_PER_WEEK = 7.3; // NerdWallet UK 2025: HR and team coordination, same study as admin hours

  function num(v, fallback) {
    var n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, ""));
    return isFinite(n) && n >= 0 ? n : fallback;
  }

  /* One Capture & Convert price. Calls beyond the minutes included are charged in blocks of 100. */
  function pickTier(minutes, cc) {
    var extraBlocks = minutes > cc.minutes ? Math.ceil((minutes - cc.minutes) / 100) : 0;
    var extra = extraBlocks * (cc.extraPer100 || 0);
    return { id: "cc", name: "Capture & Convert", monthly: cc.monthly + extra, base: cc.monthly, extra: extra, setup: cc.setup, minutes: cc.minutes };
  }

  function findBy(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[list.length - 1];
  }

  /* Returns the starting inputs for a type and size, from calculator.json */
  function defaultsFor(data, typeId, sizeId) {
    var type = findBy(data.types, typeId || "other");
    var size = findBy(data.sizes, sizeId || "solo");
    var d = data.defaults;
    return {
      type: type.id, size: size.id,
      enquiriesPerWeek: size.enquiriesPerWeek,
      jobValue: type.jobValue,
      phoneShare: d.phoneShare.value,
      missedShare: d.missedShare.value,
      noMessageShare: d.noMessageShare.value,
      outOfHoursShare: d.outOfHoursShare.value,
      conversion: d.conversion.value,
      minutesPerCall: d.minutesPerCall.value,
      visitsPerMonth: d.visitsPerMonth.value,
      adminHours: d.adminHours.value,
      ownerHourValue: d.ownerHourValue.value,
      directorySpend: d.directorySpend.value
    };
  }

  /* All figures are per month. */
  function compute(input, data) {
    var type = findBy(data.types, input.type);
    var size = findBy(data.sizes, input.size);
    var p = data.prices, b = data.bands;
    var enqWeek = num(input.enquiriesPerWeek, size.enquiriesPerWeek);
    var jobValue = num(input.jobValue, type.jobValue);
    var conv = num(input.conversion, data.defaults.conversion.value) / 100;
    var phoneShare = num(input.phoneShare, data.defaults.phoneShare.value) / 100;
    var missedShare = num(input.missedShare, data.defaults.missedShare.value) / 100;
    var noMessage = num(input.noMessageShare, data.defaults.noMessageShare.value) / 100;
    var outOfHours = num(input.outOfHoursShare, data.defaults.outOfHoursShare.value) / 100;
    var minutesPerCall = num(input.minutesPerCall, data.defaults.minutesPerCall.value);
    var visits = num(input.visitsPerMonth, data.defaults.visitsPerMonth.value);
    var adminHours = num(input.adminHours, data.defaults.adminHours.value);
    var hourValue = num(input.ownerHourValue, data.defaults.ownerHourValue.value);
    var directorySpend = num(input.directorySpend, 0);

    var enquiries = enqWeek * WEEKS_PER_MONTH;
    var calls = enquiries * phoneShare;
    var missedCalls = calls * missedShare;
    var lostCalls = missedCalls * noMessage;          // callers who hung up and left nothing
    var outOfHoursCalls = calls * outOfHours;
    var minutes = calls * minutesPerCall;

    // Capture & Convert: the receptionist answers the calls that go unanswered today.
    var tier = pickTier(minutes, p.cc);
    var ccCustomersHigh = lostCalls * b.recoveredHigh * conv;
    var ccCustomersLow = lostCalls * b.recoveredLow * conv;
    var cc = {
      lostCalls: lostCalls, missedCalls: missedCalls, outOfHoursCalls: outOfHoursCalls, calls: calls, minutes: minutes,
      tier: tier,
      customersLow: ccCustomersLow, customersHigh: ccCustomersHigh,
      low: ccCustomersLow * jobValue, high: ccCustomersHigh * jobValue,
      cost: tier.monthly,
      jobsToPay: jobValue > 0 ? Math.ceil(tier.monthly / jobValue) : null
    };
    cc.likely = (cc.low + cc.high) / 2;

    // Launch & Grow: enquiries from a website you own, plus what you stop paying lead sites.
    var siteEnquiries = visits * (type.visitRate / 100);
    var lgCustomersHigh = siteEnquiries * conv;
    var lg = {
      visits: visits, siteEnquiries: siteEnquiries, visitRate: type.visitRate, rulerIndustry: type.rulerIndustry,
      customersLow: lgCustomersHigh * b.recoveredLow, customersHigh: lgCustomersHigh,
      directorySpend: directorySpend,
      low: lgCustomersHigh * b.recoveredLow * jobValue + directorySpend,
      high: lgCustomersHigh * jobValue + directorySpend,
      cost: p.launchGrowMonthly, setup: p.launchGrowSetup
    };
    lg.likely = (lg.low + lg.high) / 2;

    // Command Centre: hours back from watching, checking and chasing.
    var adminMonth = adminHours * WEEKS_PER_MONTH;
    var cmd = {
      adminHoursMonth: adminMonth,
      hoursLow: adminMonth * b.hoursBackLow, hoursHigh: adminMonth * b.hoursBackHigh,
      low: adminMonth * b.hoursBackLow * hourValue, high: adminMonth * b.hoursBackHigh * hourValue,
      cost: 0                                         // included in every package
    };
    cmd.likely = (cmd.low + cmd.high) / 2;

    // Growth & Operations Partner: shown for teams only; the audit puts a number on it.
    var partner = {
      applies: !!size.team,
      ownerHoursMonth: (adminHours + HR_HOURS_PER_WEEK) * WEEKS_PER_MONTH,
      cost: p.partnerMonthly
    };

    var ranked = [
      { id: "capture-convert", net: cc.likely - cc.cost },
      { id: "launch-grow", net: lg.likely - lg.cost }
    ].sort(function (a, b2) { return b2.net - a.net; });

    return { type: type, size: size, enquiries: enquiries, jobValue: jobValue, conversion: conv, cc: cc, lg: lg, cmd: cmd, partner: partner, best: ranked[0].id };
  }

  var api = { compute: compute, pickTier: pickTier, defaultsFor: defaultsFor, WEEKS_PER_MONTH: WEEKS_PER_MONTH };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GainoraCalc = api;

  /* ======================= Browser UI ======================= */
  if (typeof document === "undefined") return;

  var data = root.GAINORA_CALC;
  var mounts = document.querySelectorAll("[data-calc]");
  if (!data || !mounts.length) return;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var params = new URLSearchParams(window.location.search);

  function money(n) {
    if (!isFinite(n)) return "£0";
    var r = n >= 1000 ? Math.round(n / 10) * 10 : Math.round(n);
    return "£" + r.toLocaleString("en-GB");
  }
  function whole(n) { return Math.round(n).toLocaleString("en-GB"); }
  function one(n) { return (Math.round(n * 10) / 10).toLocaleString("en-GB"); }
  function esc(s) { var d = document.createElement("div"); d.textContent = String(s); return d.innerHTML; }

  function sourceLine(key) {
    var s = data.sources[key];
    if (!s) return "";
    return '<a href="' + esc(s.url) + '" rel="noopener" target="_blank">' + esc(s.name) + '</a>, ' + esc(s.publisher) + ', ' + esc(s.year);
  }
  function badge(def) {
    if (def.basis === "research") return '<span class="calc-badge calc-badge-research" title="From published research. See the source below the inputs.">Research</span>';
    if (def.basis === "yours") return '<span class="calc-badge">Your number</span>';
    return '<span class="calc-badge">Your estimate</span>';
  }

  function field(id, def, value, opts) {
    opts = opts || {};
    var unit = def.unit || "";
    var isPct = unit === "%";
    var step = opts.step || (isPct ? 1 : (unit === "hours a week" ? 0.5 : 1));
    var max = isPct ? ' max="100"' : "";
    var note = def.note ? '<span class="calc-note">' + esc(def.note) + (def.source ? ". " + sourceLine(def.source) : "") + "</span>" : (def.source ? '<span class="calc-note">' + sourceLine(def.source) + "</span>" : "");
    return '<div class="field calc-field' + (opts.cls ? " " + opts.cls : "") + '">' +
      '<label for="' + id + '">' + esc(def.label) + ' ' + badge(def) + '</label>' +
      '<div class="calc-input-wrap' + (isPct ? " is-pct" : (unit.indexOf("£") === 0 ? " is-money" : "")) + '">' +
      '<input id="' + id + '" name="' + id.replace(/^calc-/, "") + '" type="number" inputmode="decimal" min="0"' + max + ' step="' + step + '" value="' + esc(value) + '">' +
      (isPct ? '<span class="calc-unit">%</span>' : (unit.indexOf("£") === 0 ? '<span class="calc-unit calc-unit-pre">£</span>' : (unit ? '<span class="calc-unit">' + esc(unit) + '</span>' : ""))) +
      '</div>' + note + '</div>';
  }

  function selectField(id, label, list, value) {
    var opts = list.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === value ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("");
    return '<div class="field calc-field"><label for="' + id + '">' + esc(label) + '</label><select id="' + id + '" name="' + id.replace(/^calc-/, "") + '">' + opts + "</select></div>";
  }

  function countUp(el, to, format) {
    var from = parseFloat(el.getAttribute("data-value") || "0") || 0;
    el.setAttribute("data-value", String(to));
    if (reduceMotion || Math.abs(to - from) < 1) { el.textContent = format(to); return; }
    var start = null, dur = 600;
    function tick(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - t, 3);
      el.textContent = format(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function readInputs(mount, state) {
    var out = {};
    for (var k in state) out[k] = state[k];
    mount.querySelectorAll("input, select").forEach(function (el) {
      var key = el.name;
      if (!key) return;
      out[key] = el.tagName === "SELECT" ? el.value : el.value;
    });
    return out;
  }

  function bookHref(r, pkg) {
    return "/book/?package=" + encodeURIComponent(pkg) + "&type=" + encodeURIComponent(r.type.id) + "&size=" + encodeURIComponent(r.size.id) + "&from=calculator";
  }

  function cardCC(r, highlight) {
    var c = r.cc;
    return '<article class="calc-card' + (highlight ? " is-best" : "") + '" data-package="capture-convert">' +
      (highlight ? '<p class="calc-best">Biggest return for these figures</p>' : '') +
      '<p class="calc-card-eyebrow">Capture &amp; Convert</p>' +
      '<h3>Calls you\'re losing today, answered</h3>' +
      '<p class="calc-figure"><span class="calc-amount" data-value="0"></span><span class="calc-per">a month in work, likely</span></p>' +
      '<p class="calc-band">Between ' + money(c.low) + ' and ' + money(c.high) + ' a month, against ' + money(c.cost) + ' a month' + (c.tier.extra ? ' (' + money(c.tier.base) + ' plus ' + money(c.tier.extra) + ' for calls beyond the ' + whole(c.tier.minutes) + ' minutes included)' : '') + ', with Command Centre included.' + (c.jobsToPay ? ' It pays for itself with ' + whole(c.jobsToPay) + (c.jobsToPay === 1 ? ' job' : ' jobs') + ' a month.' : "") + '</p>' +
      '<ul class="calc-how">' +
      '<li>About <strong>' + whole(c.calls) + '</strong> calls a month, of which <strong>' + whole(c.missedCalls) + '</strong> go unanswered and <strong>' + whole(c.lostCalls) + '</strong> callers leave no message.</li>' +
      '<li>With a receptionist answering every call, between half and all of those become enquiries; at your conversion rate that is <strong>' + one(c.customersLow) + ' to ' + one(c.customersHigh) + '</strong> extra customers a month at ' + money(r.jobValue) + ' each.</li>' +
      '<li>About <strong>' + whole(c.outOfHoursCalls) + '</strong> of your calls a month arrive outside 9 to 5. Those would be answered too.</li>' +
      '</ul>' +
      '<p class="calc-src">Sources: ' + sourceLine("moneypenny2016") + '; ' + sourceLine("lightwork2026") + '. The half-to-all band is our assumption.</p>' +
      '<a class="button ' + (highlight ? "button-primary" : "button-secondary") + '" href="' + bookHref(r, "capture-convert") + '">Check these numbers on a 15-minute diagnostic</a>' +
      '</article>';
  }

  function cardLG(r, highlight) {
    var l = r.lg;
    return '<article class="calc-card' + (highlight ? " is-best" : "") + '" data-package="launch-grow">' +
      (highlight ? '<p class="calc-best">Biggest return for these figures</p>' : '') +
      '<p class="calc-card-eyebrow">Launch &amp; Grow</p>' +
      '<h3>Enquiries from a website and profile you own</h3>' +
      '<p class="calc-figure"><span class="calc-amount" data-value="0"></span><span class="calc-per">a month, likely</span></p>' +
      '<p class="calc-band">Between ' + money(l.low) + ' and ' + money(l.high) + ' a month, against ' + money(l.cost) + ' a month after ' + money(l.setup) + ' setup, with Command Centre included. Ad spend is extra and paid by you.</p>' +
      '<ul class="calc-how">' +
      '<li>At <strong>' + whole(l.visits) + '</strong> visits a month and the <strong>' + esc(l.rulerIndustry) + '</strong> benchmark of ' + one(l.visitRate) + '% of visits becoming an enquiry, that is about <strong>' + one(l.siteEnquiries) + '</strong> enquiries a month from your own site.</li>' +
      '<li>At your conversion rate, <strong>' + one(l.customersLow) + ' to ' + one(l.customersHigh) + '</strong> customers a month at ' + money(r.jobValue) + ' each' + (l.directorySpend > 0 ? ', plus the <strong>' + money(l.directorySpend) + '</strong> a month you currently pay lead sites' : '') + '.</li>' +
      '</ul>' +
      '<p class="calc-src">Source: ' + sourceLine("ruler2026") + '. Visits and the half-to-all band are assumptions; replace the visits with your own analytics.</p>' +
      '<a class="button ' + (highlight ? "button-primary" : "button-secondary") + '" href="' + bookHref(r, "launch-grow") + '">Check these numbers on a 15-minute diagnostic</a>' +
      '</article>';
  }

  function cardCmd(r) {
    var c = r.cmd;
    return '<article class="calc-card calc-card-quiet" data-package="command-centre">' +
      '<p class="calc-card-eyebrow">Command Centre · included in every package</p>' +
      '<h3>Hours a month back from watching and checking</h3>' +
      '<p class="calc-figure"><span class="calc-amount" data-value="0"></span><span class="calc-per">hours a month, likely</span></p>' +
      '<p class="calc-band">Between ' + one(c.hoursLow) + ' and ' + one(c.hoursHigh) + ' hours a month, worth ' + money(c.low) + ' to ' + money(c.high) + ' at your hourly value. No extra cost: it comes with Capture &amp; Convert, Launch &amp; Grow and the Partner.</p>' +
      '<ul class="calc-how">' +
      '<li>You spend about <strong>' + whole(c.adminHoursMonth) + '</strong> hours a month on admin and keeping an eye on things.</li>' +
      '<li>Command Centre takes over the watching, checking and chasing. We assume it hands back a quarter to a half of that time; the monthly report shows what it actually did.</li>' +
      '</ul>' +
      '<p class="calc-src">Source: ' + sourceLine("nerdwallet2025") + '. The quarter-to-half share is our assumption.</p>' +
      '<a class="button button-secondary" href="' + bookHref(r, r.best) + '">Check these numbers on a 15-minute diagnostic</a>' +
      '</article>';
  }

  function cardPartner(r) {
    var p = r.partner;
    if (!p.applies) return "";
    return '<article class="calc-card calc-card-quiet" data-package="partner">' +
      '<p class="calc-card-eyebrow">Growth &amp; Operations Partner</p>' +
      '<h3>For a team your size, the owner\'s time is the number</h3>' +
      '<p class="calc-figure"><span class="calc-amount" data-value="0"></span><span class="calc-per">hours a month running the business, not growing it</span></p>' +
      '<p class="calc-band">Admin plus coordinating the team, at the UK average. The Operations Audit (£495, credited back) puts your own number on it and costs the fix before you commit. Running it afterwards is ' + money(p.cost) + ' a month.</p>' +
      '<p class="calc-src">Source: ' + sourceLine("nerdwallet2025") + '.</p>' +
      '<a class="button button-secondary" href="' + bookHref(r, "partner") + '">Talk it through on a 15-minute diagnostic</a>' +
      '</article>';
  }

  function renderResults(mount, r, mode, focus) {
    var box = mount.querySelector(".calc-results");
    var best = focus || r.best;
    var html;
    if (mode === "mini") {
      html = cardCC(r, true) + '<p class="calc-more"><a href="/calculator/?type=' + encodeURIComponent(r.type.id) + '&size=' + encodeURIComponent(r.size.id) + '">See every package and change every figure</a></p>';
    } else {
      html = cardCC(r, best === "capture-convert") + cardLG(r, best === "launch-grow") + cardCmd(r) + cardPartner(r);
    }
    box.innerHTML = html;
    var values = { "capture-convert": [r.cc.likely, money], "launch-grow": [r.lg.likely, money], "command-centre": [(r.cmd.hoursLow + r.cmd.hoursHigh) / 2, one], "partner": [r.partner.ownerHoursMonth, whole] };
    box.querySelectorAll(".calc-card").forEach(function (card) {
      var v = values[card.getAttribute("data-package")];
      var el = card.querySelector(".calc-amount");
      if (v && el) countUp(el, v[0], v[1]);
    });
  }

  function mount(el) {
    var mode = el.getAttribute("data-calc") === "mini" ? "mini" : "full";
    var typeId = params.get("type") || (data.types[0] && data.types[0].id);
    var sizeId = params.get("size") || "2-5";
    var focus = params.get("package");
    if (focus && ["capture-convert", "launch-grow"].indexOf(focus) < 0) focus = null;
    var state = defaultsFor(data, typeId, sizeId);
    var touched = {};
    var d = data.defaults;

    var inputsHtml;
    if (mode === "mini") {
      inputsHtml =
        '<div class="calc-row">' + selectField("calc-type", "Type of business", data.types, state.type) + selectField("calc-size", "Size", data.sizes, state.size) + '</div>' +
        '<div class="calc-row">' +
        field("calc-enquiriesPerWeek", { label: "Enquiries a week, all channels", unit: "", basis: "assumption" }, state.enquiriesPerWeek) +
        field("calc-jobValue", { label: "Average value of a job or customer", unit: "£", basis: findBy(data.types, state.type).jobValueBasis, source: findBy(data.types, state.type).jobValueSource, note: findBy(data.types, state.type).jobValueNote }, state.jobValue) +
        '</div>';
    } else {
      var t = findBy(data.types, state.type);
      inputsHtml =
        '<fieldset class="calc-group"><legend>Your business</legend>' +
        '<div class="calc-row">' + selectField("calc-type", "Type of business", data.types, state.type) + selectField("calc-size", "Size", data.sizes, state.size) + '</div>' +
        '<div class="calc-row">' +
        field("calc-enquiriesPerWeek", { label: "Enquiries a week, all channels", unit: "", basis: "assumption", note: "A starting point for a business your size. Put in your own number" }, state.enquiriesPerWeek) +
        field("calc-jobValue", { label: "Average value of a job or customer", unit: "£", basis: t.jobValueBasis, source: t.jobValueSource, note: t.jobValueNote || "Your number. What a typical job or first booking is worth to you" }, state.jobValue) +
        '</div>' +
        '<div class="calc-row">' +
        field("calc-directorySpend", d.directorySpend, state.directorySpend) +
        field("calc-visitsPerMonth", d.visitsPerMonth, state.visitsPerMonth) +
        '</div>' +
        '<div class="calc-row">' +
        field("calc-adminHours", d.adminHours, state.adminHours) +
        field("calc-ownerHourValue", d.ownerHourValue, state.ownerHourValue) +
        '</div>' +
        '</fieldset>' +
        '<fieldset class="calc-group"><legend>How calls and enquiries behave</legend>' +
        '<p class="small">Starting figures from published research where we found it, marked Research. The rest are marked as estimates. Change any of them.</p>' +
        '<div class="calc-row">' + field("calc-phoneShare", d.phoneShare, state.phoneShare) + field("calc-missedShare", d.missedShare, state.missedShare) + '</div>' +
        '<div class="calc-row">' + field("calc-noMessageShare", d.noMessageShare, state.noMessageShare) + field("calc-outOfHoursShare", d.outOfHoursShare, state.outOfHoursShare) + '</div>' +
        '<div class="calc-row">' + field("calc-conversion", d.conversion, state.conversion) + field("calc-minutesPerCall", d.minutesPerCall, state.minutesPerCall) + '</div>' +
        '</fieldset>';
    }

    el.innerHTML =
      '<form class="calc-form" novalidate autocomplete="off">' + inputsHtml + '</form>' +
      '<div class="calc-results" aria-live="polite" aria-atomic="false"></div>' +
      (mode === "full" ? '<p class="calc-foot small">Estimates, not promises. Every figure above can be changed, and the 15-minute diagnostic is where we check them against your real numbers. Figures as of ' + esc(data.asOf) + '. Nothing you type here is stored or sent.</p>' : "");

    var form = el.querySelector(".calc-form");
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    function recompute() {
      var input = readInputs(el, state);
      renderResults(el, compute(input, data), mode, focus);
    }

    form.addEventListener("input", function (e) {
      var name = e.target.name;
      if (!name) return;
      if (name === "type" || name === "size") {
        // Refresh the size- and type-dependent starting points the visitor hasn't edited
        var fresh = defaultsFor(data, form.querySelector("[name=type]").value, form.querySelector("[name=size]").value);
        state.type = fresh.type; state.size = fresh.size;
        if (!touched.enquiriesPerWeek && name === "size") { var q = form.querySelector("[name=enquiriesPerWeek]"); if (q) q.value = fresh.enquiriesPerWeek; }
        if (!touched.jobValue && name === "type") { var j = form.querySelector("[name=jobValue]"); if (j) j.value = fresh.jobValue; }
        if (name === "type") {
          var tt = findBy(data.types, fresh.type);
          var jf = form.querySelector("[name=jobValue]");
          if (jf) {
            var wrap = jf.closest(".calc-field");
            var lab = wrap.querySelector("label");
            lab.innerHTML = esc("Average value of a job or customer") + " " + badge({ basis: tt.jobValueBasis });
            var noteEl = wrap.querySelector(".calc-note");
            var noteHtml = tt.jobValueNote ? esc(tt.jobValueNote) + (tt.jobValueSource ? ". " + sourceLine(tt.jobValueSource) : "") : "Your number. What a typical job or first booking is worth to you";
            if (noteEl) noteEl.innerHTML = noteHtml;
          }
        }
      } else {
        touched[name] = true;
      }
      recompute();
    });

    recompute();
  }

  mounts.forEach(mount);
})(typeof window !== "undefined" ? window : this);
