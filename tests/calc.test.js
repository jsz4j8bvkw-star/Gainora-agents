/* Arithmetic tests for the Business improvement calculator (src/assets/calc.js). */
const fs = require("fs");
const path = require("path");

function run() {
  let passes = 0, failures = 0;
  const check = (cond, msg) => { if (cond) passes++; else { failures++; console.log("  FAIL calc: " + msg); } };
  const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.01 : tol);

  const calc = require(path.join(__dirname, "..", "src", "assets", "calc.js"));
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "calculator.json"), "utf8"));
  data.prices = {
    launchGrowMonthly: 599, launchGrowSetup: 1995,
    cc: { setup: 595, monthly: 399, minutes: 600, extraPer100: 25 },
    partnerMonthly: 950
  };

  // Tier picking follows the minutes included
  // One Capture & Convert price; calls beyond the 600 minutes included cost £25 per 100
  check(calc.pickTier(0, data.prices.cc).monthly === 399, "0 minutes is the normal price");
  check(calc.pickTier(600, data.prices.cc).monthly === 399, "600 minutes still fits the price");
  check(calc.pickTier(601, data.prices.cc).monthly === 424, "601 minutes adds one block of 100");
  check(calc.pickTier(800, data.prices.cc).monthly === 449, "800 minutes adds two blocks");
  check(calc.pickTier(800, data.prices.cc).extra === 50, "the extra is shown separately");

  // Worked example: a trades business, 2-5 people, with every figure given explicitly
  const input = {
    type: "trades", size: "2-5", enquiriesPerWeek: 20, phoneShare: 50, missedShare: 30, noMessageShare: 70,
    outOfHoursShare: 25, conversion: 40, jobValue: 200, minutesPerCall: 3, visitsPerMonth: 400, adminHours: 8, ownerHourValue: 50, directorySpend: 120
  };
  const r = calc.compute(input, data);
  const enquiries = 20 * 4.33;                  // 86.6
  const calls = enquiries * 0.5;                // 43.3
  const missed = calls * 0.3;                   // 12.99
  const lost = missed * 0.7;                    // 9.093
  check(near(r.enquiries, enquiries), `enquiries a month: ${r.enquiries}`);
  check(near(r.cc.calls, calls), `calls a month: ${r.cc.calls}`);
  check(near(r.cc.missedCalls, missed), `missed calls: ${r.cc.missedCalls}`);
  check(near(r.cc.lostCalls, lost), `lost calls: ${r.cc.lostCalls}`);
  check(near(r.cc.outOfHoursCalls, calls * 0.25), `out of hours calls: ${r.cc.outOfHoursCalls}`);
  check(r.cc.tier.extra === 0, `43 calls × 3 min = 130 min fits the minutes included`);
  check(near(r.cc.high, lost * 1.0 * 0.4 * 200), `C&C high: ${r.cc.high}`);
  check(near(r.cc.low, lost * 0.5 * 0.4 * 200), `C&C low: ${r.cc.low}`);
  check(near(r.cc.likely, (r.cc.low + r.cc.high) / 2), "C&C likely is the midpoint");
  check(r.cc.cost === 399, "C&C cost is the monthly price");
  check(r.cc.jobsToPay === 2, `jobs to pay for £249 at £200 should be 2, got ${r.cc.jobsToPay}`);

  // Launch & Grow uses the industry visit rate and adds the directory spend
  const trades = data.types.find(t => t.id === "trades");
  const siteEnq = 400 * trades.visitRate / 100;
  check(near(r.lg.siteEnquiries, siteEnq), `site enquiries: ${r.lg.siteEnquiries}`);
  check(near(r.lg.high, siteEnq * 0.4 * 200 + 120), `L&G high: ${r.lg.high}`);
  check(near(r.lg.low, siteEnq * 0.5 * 0.4 * 200 + 120), `L&G low: ${r.lg.low}`);
  check(r.lg.cost === 599 && r.lg.setup === 1995, "L&G prices from config");

  // Command Centre: hours back between a quarter and a half, valued at the owner's rate
  const adminMonth = 8 * 4.33;
  check(near(r.cmd.adminHoursMonth, adminMonth), `admin hours a month: ${r.cmd.adminHoursMonth}`);
  check(near(r.cmd.hoursLow, adminMonth * 0.25) && near(r.cmd.hoursHigh, adminMonth * 0.5), "Command Centre hours band");
  check(near(r.cmd.high, adminMonth * 0.5 * 50), `Command Centre high value: ${r.cmd.high}`);

  // Partner only for teams
  check(r.partner.applies === false, "Partner should not apply to a 2-5 person business");
  const team = calc.compute(Object.assign({}, input, { size: "6-20" }), data);
  check(team.partner.applies === true, "Partner should apply to a 6-20 person business");
  check(near(team.partner.ownerHoursMonth, (8 + 7.3) * 4.33), `owner hours a month: ${team.partner.ownerHoursMonth}`);

  // Best package is the one with the highest value net of its monthly price
  // Command Centre is included in every package, so it is never the recommendation on its own
  check(r.cmd.cost === 0, "Command Centre costs nothing extra");
  const nets = { "capture-convert": r.cc.likely - r.cc.cost, "launch-grow": r.lg.likely - r.lg.cost };
  const best = Object.keys(nets).sort((a, b) => nets[b] - nets[a])[0];
  check(r.best === best, `best package should be ${best}, got ${r.best}`);

  // Defaults come from calculator.json for the chosen type and size
  const d = calc.defaultsFor(data, "health", "solo");
  check(d.enquiriesPerWeek === data.sizes.find(s => s.id === "solo").enquiriesPerWeek, "default enquiries follow the size");
  check(d.jobValue === data.types.find(t => t.id === "health").jobValue, "default job value follows the type");
  check(d.missedShare === data.defaults.missedShare.value, "default missed share from the research figure");

  // Bad input never produces NaN or negative figures
  const bad = calc.compute({ type: "nope", size: "", enquiriesPerWeek: "abc", jobValue: -5, conversion: "" }, data);
  for (const v of [bad.cc.likely, bad.lg.likely, bad.cmd.likely, bad.cc.low, bad.lg.low]) check(isFinite(v) && v >= 0, `bad input produced ${v}`);
  check(bad.type.id === "other", "unknown type falls back to Other");

  // Zero enquiries means zero value, never an error
  const zero = calc.compute(Object.assign({}, input, { enquiriesPerWeek: 0 }), data);
  check(zero.cc.likely === 0 && zero.cc.cost === 399, "zero enquiries gives zero and the normal price");

  console.log(`  calculator: ${passes} passed, ${failures} failed`);
  return { passes, failures };
}

if (require.main === module) {
  const r = run();
  process.exit(r.failures ? 1 : 0);
}
module.exports = { run };
