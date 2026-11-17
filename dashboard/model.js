/* Drop Radar model (drop-radar-4). One file, two hosts: the browser page loads it as a script and main.ts
 * requires it, so board.json and the page come from the same function, buildRadar(snapshot).
 * Standard JavaScript only; deterministic (no clock, seeded resampling). No protocol name appears here. */
(function (root) {
  'use strict';

  var CFG = {
    version: 'drop-radar-4',
    shrink_k: 4,          // pseudo-peers pulling a family tilt toward 1
    growth_weight: 0.5, growth_lo: -25, growth_hi: 40,
    season_lo: 0.75, season_span: 0.35, season_days: 730, season_unknown: 365,
    drop_share: 0.10,     // airdrop share of the implied FDV
    tbill: 0.04,          // income a deposit forgoes, per year
    boot: 60,             // refits for the rank range
    worth: 0.25, marginal: 0.6,
  };

  var FAMILIES = ['Vaults & yield', 'Lending & CDP', 'Trading', 'RWA & stables', 'Staking', 'Infra & chains', 'Other'];
  var EXCLUDED = { 'CEX': 1, 'Bridge': 1, 'Canonical Bridge': 1, 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1 };

  function familyOf(cat) {
    var c = String(cat || '').toLowerCase();
    if (/basis|yield|vault|curator|allocator|farm|liquidity manager|indexes|staking pool|governance incentives/.test(c)) return 'Vaults & yield';
    if (/lending|cdp|collateral|interest rate/.test(c)) return 'Lending & CDP';
    if (/dex|derivative|prediction|option|perp|otc|launchpad|trading/.test(c)) return 'Trading';
    if (/rwa|stable|cedefi|payment|card/.test(c)) return 'RWA & stables';
    if (/staking|restak|btc/.test(c)) return 'Staking';
    if (/bridge|chain|rollup|oracle|privacy|infra|wallet|sdk/.test(c)) return 'Infra & chains';
    return 'Other';
  }

  function isPreToken(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }

  /** The house product rule minus its TVL floor: wrapped, staked, bridged and exchange products of a traded token. */
  function isProduct(p) {
    if (EXCLUDED[p.category]) return true;
    if (/^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i.test(p.name)) return true;
    return /\b(wrapped|staked|staking)\b/i.test(p.name) || /\s(v\d+|\d+\.\d+)$/i.test(p.name);
  }

  var L = function (x) { return Math.log(x) / Math.LN10; };
  var clamp = function (x, lo, hi) { return Math.min(hi, Math.max(lo, x)); };
  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function quantile(a, q) { var s = a.slice().sort(function (x, y) { return x - y; }); var i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); }
  function daysBetween(a, b) { return Math.max(0, Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5)); }

  /** Size curve: least squares of log10(mcap) on log10(TVL / $100M) over the protocols whose token trades. */
  function fitCurve(pts) {
    var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
    var b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    return { a: a, b: b };
  }

  /** Family tilts: the median residual of each family's traded peers, shrunk toward 0 with shrink_k pseudo-peers. */
  function fitTilts(pts, curve) {
    var by = {};
    pts.forEach(function (p) { (by[p.fam] = by[p.fam] || []).push(p.y - (curve.a + curve.b * p.x)); });
    var t = {};
    FAMILIES.forEach(function (f) { var r = by[f] || []; t[f] = { peers: r.length, log: r.length ? (r.length * median(r)) / (r.length + CFG.shrink_k) : 0 }; });
    return t;
  }

  function fitAll(pts) { var c = fitCurve(pts); return { curve: c, tilts: fitTilts(pts, c) }; }
  function predictLog(fit, x, fam) { return fit.curve.a + fit.curve.b * x + fit.tilts[fam].log; }

  function spearman(a, b) {
    function ranks(v) { var idx = v.map(function (x, i) { return [x, i]; }).sort(function (p, q) { return p[0] - q[0]; }); var r = []; idx.forEach(function (p, k) { r[p[1]] = k; }); return r; }
    var ra = ranks(a), rb = ranks(b), n = a.length, d = 0;
    for (var i = 0; i < n; i++) d += (ra[i] - rb[i]) * (ra[i] - rb[i]);
    return 1 - (6 * d) / (n * (n * n - 1));
  }

  /** Leave-one-out: refit without each traded token, predict it, and compare with one flat mcap/TVL multiple. */
  function outOfSample(pts) {
    var err = [], flatErr = [], pred = [], act = [];
    for (var i = 0; i < pts.length; i++) {
      var rest = pts.slice(0, i).concat(pts.slice(i + 1));
      var f = fitAll(rest), p = pts[i];
      var yhat = predictLog(f, p.x, p.fam);
      err.push(Math.abs(yhat - p.y)); pred.push(yhat); act.push(p.y);
      var flat = median(rest.map(function (q) { return q.y - L(q.tvl); }));
      flatErr.push(Math.abs(flat + L(p.tvl) - p.y));
    }
    var within3 = err.filter(function (e) { return e <= L(3); }).length / err.length;
    return { n: pts.length, median_miss: Math.pow(10, median(err)), flat_miss: Math.pow(10, median(flatErr)), within3: within3, rank_corr: spearman(pred, act), sd: Math.sqrt(err.reduce(function (s, e) { return s + e * e; }, 0) / err.length) };
  }

  // ---------------------------------------------------------------- farm arithmetic
  var GAS = { Solana: 0.005, Sui: 0.01, Aptos: 0.01, Base: 0.03, Arbitrum: 0.05, Optimism: 0.04, Polygon: 0.02, BSC: 0.08, Binance: 0.08, Avalanche: 0.08, Sonic: 0.02, Ink: 0.02, Unichain: 0.02, 'Hyperliquid L1': 0.03, Plasma: 0.02, Tron: 1, Bitcoin: 2, Ethereum: 4 };
  function cheapestChain(chains) {
    var best = null;
    chains.slice(0, 3).forEach(function (c) { var g = GAS[c] === undefined ? 0.15 : GAS[c]; if (!best || g < best.gas) best = { chain: c, gas: g }; });
    return best || { chain: 'its main chain', gas: 0.15 };
  }
  function money(x) { var s = x < 0 ? '-' : ''; x = Math.abs(x); return s + (x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x < 10 ? '$' + x.toFixed(2) : '$' + Math.round(x).toLocaleString('en-US')); }

  var PLAY = {
    'Vaults & yield': { verb: 'Deposit {D} of USDC into {N}\'s largest stablecoin vault on {C} and keep the receipt shares in the same wallet', tx: 2, weeks: 8, mid: 'top the vault up once with 10% more so the address shows two deposit dates' },
    'Lending & CDP': { verb: 'Supply {D} of USDC on {N} on {C}, then borrow 20% of it back (health factor above 3) and leave the loan open', tx: 3, weeks: 8, mid: 'repay half the loan and borrow it again, a second dated action on both sides of the book' },
    'Trading': { verb: 'Deposit {D} on {N} on {C} and trade it in 5 small round trips at 1x (fees under 0.3% of the deposit)', tx: 6, weeks: 6, mid: 'make 3 more round trips and, if the app has one, add {Q} to its liquidity vault' },
    'RWA & stables': { verb: 'Subscribe {D} to {N}\'s main product on {C} after checking its minimum ticket and redemption window', tx: 2, weeks: 8, mid: 're-read the product page and confirm the position accrues; redeem nothing early' },
    'Staking': { verb: 'Stake {D} through {N}\'s own interface on {C}, choosing the option with no lock-up or the shortest one', tx: 2, weeks: 8, mid: 'claim or restake any reward once, a second dated action' },
    'Infra & chains': { verb: 'Bridge {D} onto {N}{OC} and use 3 of its own apps: a swap, a lend and a liquidity position', tx: 6, weeks: 6, mid: 'repeat one swap and one deposit so activity spans more than one week' },
    'Other': { verb: 'Use {N}\'s core product on {C} with {D}: one deposit or action now', tx: 3, weeks: 6, mid: 'repeat the core action once so the address shows two dates' },
  };

  function farmPlan(r) {
    var D = r.tvl < 20e6 ? 1000 : 2000;
    var cc = cheapestChain(r.chains), g = cc.gas, pb = PLAY[r.family], W = pb.weeks;
    var fill = function (s) { return s.replace(/\{OC\}/g, cc.chain === r.name ? '' : ' (' + cc.chain + ')').replace(/\{D\}/g, money(D)).replace(/\{Q\}/g, money(D / 4)).replace(/\{N\}/g, r.name).replace(/\{C\}/g, cc.chain); };
    var stop = Math.round(r.tvl * (1 - Math.max(0.1, Math.abs(r.ch7 || 0) * 2 / 100)));
    var kyc = r.family === 'RWA & stables', d1 = kyc ? 3 : 1;
    // at: the day a step falls on (weekly: every held week; neither: it fires only on an event).
    var steps = [
      { when: 'day 0', at: 0, text: 'Open ' + r.name + ' from its DefiLlama listing, bookmark that domain, and read its docs on points, rewards and withdrawals; never use a link from a reply or DM.', cost: 0, min: 20 },
      kyc ? { when: 'day 0', at: 0, text: 'Pass ' + r.name + '\'s KYC if it asks for one; allow 1 to 3 days before you deposit, and skip the row if it is closed to your country.', cost: 0, min: 30 }
          : { when: 'day 0', at: 0, text: 'Note ' + r.name + '\'s minimum deposit and withdrawal delay; if funds lock for longer than ' + W + ' weeks, shrink the deposit or skip.', cost: 0, min: 10 },
      { when: 'day ' + d1, at: d1, text: 'Move ' + money(D) + ' of USDC and about ' + money(Math.max(0.5, g * 10)) + ' of gas to one wallet on ' + cc.chain + ', the cheapest of its top chains (one transaction there costs about ' + money(g) + ').', cost: 1 + g, min: 15 },
      { when: 'day ' + d1, at: d1, text: fill(pb.verb) + '.', cost: g * pb.tx, min: 20 },
      { when: 'weekly x' + W, weekly: true, text: 'Each week, check ' + r.name + '\'s TVL on DefiLlama against the stop level ' + money(stop) + ' and log the position\'s balance and any points shown.', cost: 0, min: 5 * W },
      { when: 'day ' + Math.round(W * 3.5), at: Math.round(W * 3.5), text: 'Midway, ' + fill(pb.mid) + '.', cost: g * 2, min: 15 },
      { when: 'any day', text: 'Stop rule: if TVL closes below ' + money(stop) + ' or withdrawals pause, withdraw at once and end the plan.', cost: g * 2, min: 10 },
      { when: 'day ' + W * 7, at: W * 7, text: 'After ' + W + ' weeks, withdraw the ' + money(D) + ' and bridge it back, unless a points season is announced that rewards holding longer.', cost: 1 + g * 2, min: 15 },
      { when: 'if a token launches', text: 'Claim only through the domain bookmarked on day 0, never through a link someone sends you; sell or hold by your own rule, not the chart.', cost: g, min: 10 },
    ];
    var fees = steps.reduce(function (s, x) { return s + x.cost; }, 0);
    var forgone = D * CFG.tbill * W / 52;
    var minutes = steps.reduce(function (s, x) { return s + x.min; }, 0);
    var slice = CFG.drop_share * r.implied * D / r.tvl;
    var odds = (fees + forgone) / slice;
    var verdict = odds <= CFG.worth ? 'Worth farming' : odds <= CFG.marginal ? 'Marginal' : 'Skip';
    return { deposit: D, chain: cc.chain, gas: g, weeks: W, stop: stop, steps: steps, fees: fees, forgone: forgone, minutes: minutes, slice: slice, odds: odds, net_hour: (slice - fees - forgone) / (minutes / 60), verdict: verdict,
      // The same arithmetic at the value band's two ends: how far the verdict leans on the point estimate.
      odds_lo: (fees + forgone) / (slice * r.lo / r.implied), odds_hi: (fees + forgone) / (slice * r.hi / r.implied) };
  }


  // ---------------------------------------------------------------- the portfolio
  var PF = { budget: 10000, hours: 3, rate: 25, family_cap: 0.25, starts: 4, min_fill: 250, tvl_cap: 0.001 };

  /** Minutes a plan asks for in each week of its hold, steps by number: dated steps in week floor(day / 7), the check every week. */
  function weekLoad(plan) {
    var w = [];
    for (var k = 0; k <= plan.weeks; k++) w.push({ min: 0, steps: [] });
    plan.steps.forEach(function (s, i) {
      if (s.weekly) for (k = 0; k < plan.weeks; k++) w[k].min += s.min / plan.weeks;
      else if (s.at !== undefined) { w[Math.floor(s.at / 7)].min += s.min; w[Math.floor(s.at / 7)].steps.push(i + 1); }
    });
    return w;
  }

  /** Greedy plan: Worth farming and Marginal rows by slice per dollar of fees + income forgone + time (hours x rate),
   *  one position per protocol, at most family_cap of the budget per family, each position started in the first of
   *  `starts` weeks where every week of the combined schedule stays under the hours cap. Deterministic. */
  function planPortfolio(radar, opt) {
    var o = {}, k;
    for (k in PF) o[k] = opt && opt[k] > 0 ? +opt[k] : PF[k];
    var cap = o.hours * 60, load = [], fam = {}, left = o.budget, picks = [], out = [];
    var cand = radar.rows.filter(function (r) { return r.plan.verdict !== 'Skip'; }).map(function (r) {
      var p = r.plan; return { r: r, score: p.slice / (p.fees + p.forgone + p.minutes / 60 * o.rate) };
    }).sort(function (a, b) { return b.score - a.score || a.r.rank - b.r.rank; });
    cand.forEach(function (c) {
      var r = c.r, p = r.plan, room = Math.min(left, o.budget * o.family_cap - (fam[r.family] || 0));
      var dep = Math.floor(Math.min(p.deposit * o.budget / PF.budget, r.tvl * o.tvl_cap, room) / 50) * 50;
      var skip = function (why) { out.push({ r: r, score: c.score, why: why }); };
      if (dep < o.min_fill) return skip(left < o.min_fill ? 'budget spent' : room < o.min_fill ? 'family at ' + Math.round(o.family_cap * 100) + '%' : 'too small');
      var x = dep / p.deposit, slice = p.slice * x, forgone = p.forgone * x;
      if ((p.fees + forgone) / slice > CFG.marginal) return skip('fees eat a ' + money(dep) + ' slice');
      var wl = weekLoad(p), start = -1;
      for (var s = 0; s < o.starts && start < 0; s++) {
        if (wl.every(function (w, i) { return (load[s + i] || 0) + w.min <= cap; })) start = s;
      }
      if (start < 0) return skip('hours cap');
      wl.forEach(function (w, i) { load[start + i] = (load[start + i] || 0) + w.min; });
      fam[r.family] = (fam[r.family] || 0) + dep; left -= dep;
      picks.push({ r: r, score: c.score, deposit: dep, start: start, weeks: wl, fees: p.fees, forgone: forgone, minutes: p.minutes, slice: slice, lo: slice * r.lo / r.implied, hi: slice * r.hi / r.implied });
    });
    var sum = function (f) { return picks.reduce(function (t, q) { return t + q[f]; }, 0); };
    for (k = 0; k < load.length; k++) load[k] = load[k] || 0;
    return { opt: o, picks: picks, left_out: out, candidates: cand.length, load: load, families: fam,
      deposit: sum('deposit'), fees: sum('fees'), forgone: sum('forgone'), minutes: sum('minutes'), slice: sum('slice'), lo: sum('lo'), hi: sum('hi') };
  }

  function stepText(s) { return s.when + ': ' + s.text + ' (cost ' + money(s.cost) + ', ' + s.min + ' min)'; }

  // ---------------------------------------------------------------- the board
  function buildRadar(snap) {
    var asOf = snap.as_of, watch = {};
    snap.watchlist.forEach(function (s) { watch[s] = 1; });
    var pts = [];
    snap.protocols.forEach(function (p) {
      if (p.mcap_usd > 0 && p.tvl_usd > 0) pts.push({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category || 'Uncategorised', fam: familyOf(p.category), tvl: p.tvl_usd, mcap: p.mcap_usd, x: L(p.tvl_usd / 1e8), y: L(p.mcap_usd) });
    });
    pts.sort(function (a, b) { return a.slug < b.slug ? -1 : 1; });
    var fit = fitAll(pts);
    var oos = outOfSample(pts);
    var resid = pts.map(function (p) { return p.y - predictLog(fit, p.x, p.fam); });
    var bandLo = quantile(resid, 0.25), bandHi = quantile(resid, 0.75);

    var rows = [], setAside = 0;
    snap.protocols.forEach(function (p) {
      var w = !!watch[p.slug];
      if (!w && (!isPreToken(p) || !(p.tvl_usd > 0))) return;
      if (!w && isProduct(p)) { setAside++; return; }
      var fam = familyOf(p.category), x = L(p.tvl_usd / 1e8);
      var size = Math.pow(10, fit.curve.a + fit.curve.b * x);
      var tilt = Math.pow(10, fit.tilts[fam].log);
      var g = clamp(p.change_7d === null ? 0 : p.change_7d, CFG.growth_lo, CFG.growth_hi);
      var mom = 1 + CFG.growth_weight * g / 100;
      var age = p.listed_at ? daysBetween(p.listed_at, asOf) : null;
      var season = CFG.season_lo + CFG.season_span * Math.min(age === null ? CFG.season_unknown : age, CFG.season_days) / CFG.season_days;
      var implied = Math.max(1, Math.round(size * tilt * mom * season));
      rows.push({ slug: p.slug, name: p.name, category: p.category || 'Uncategorised', family: fam, chains: p.chains, tvl: p.tvl_usd, ch7: p.change_7d, age: age, watch: w, above: p.tvl_usd >= snap.floor_usd,
        f: { size: size, tilt: tilt, mom: mom, season: season, peers: fit.tilts[fam].peers }, implied: implied,
        lo: Math.round(implied * Math.pow(10, bandLo)), hi: Math.round(implied * Math.pow(10, bandHi)) });
    });
    rows.sort(function (a, b) { return b.implied - a.implied || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });

    // Rank range: refit the curve and tilts on seeded resamples of the traded set, rank again, keep P10..P90.
    var seed = 20261114, rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    var seen = rows.map(function () { return []; });
    for (var b = 0; b < CFG.boot; b++) {
      var sample = pts.map(function () { return pts[Math.floor(rnd() * pts.length)]; });
      var fb = fitAll(sample);
      var vals = rows.map(function (r, i) { return { i: i, v: predictLog(fb, L(r.tvl / 1e8), r.family) + L(r.f.mom * r.f.season) }; });
      vals.sort(function (p, q) { return q.v - p.v; }).forEach(function (o, k) { seen[o.i].push(k + 1); });
    }
    rows.forEach(function (r, i) { r.rlo = Math.round(quantile(seen[i], 0.1)); r.rhi = Math.round(quantile(seen[i], 0.9)); r.plan = farmPlan(r); });

    var peersOf = function (r) {
      // nearest by TVL among the family's peers inside the middle of its multiples, so one outlier never reads as the evidence
      var ms = pts.filter(function (p) { return p.fam === r.family; }).map(function (p) { return p.mcap / p.tvl; }), lo = quantile(ms, 0.1), hi = quantile(ms, 0.9);
      return pts.filter(function (p) { return p.fam === r.family && p.mcap / p.tvl >= lo && p.mcap / p.tvl <= hi; })
        .sort(function (a, b) { return Math.abs(a.x - L(r.tvl / 1e8)) - Math.abs(b.x - L(r.tvl / 1e8)); }).slice(0, 3)
        .map(function (p) { return { name: p.name, symbol: p.symbol, tvl: p.tvl, mcap: p.mcap }; });
    };
    rows.forEach(function (r) { r.peers = peersOf(r); });

    return { cfg: CFG, as_of: asOf, source: snap.source, floor: snap.floor_usd, universe: snap.protocols.length, watch_n: snap.watchlist.length,
      set_aside: setAside, fit: fit, oos: oos, band: [bandLo, bandHi], traded: pts, rows: rows };
  }

  function boardRows(radar) {
    return radar.rows.map(function (r) { return { slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied, farm_steps: r.plan.steps.map(stepText) }; });
  }

  var api = { CFG: CFG, PF: PF, FAMILIES: FAMILIES, familyOf: familyOf, buildRadar: buildRadar, boardRows: boardRows, planPortfolio: planPortfolio, weekLoad: weekLoad, money: money };
  root.DropRadar = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
