/* Drop Radar model (drop-radar-5). One file, two hosts: the browser page loads it as a script and main.ts
 * requires it, so board.json and the page come from the same function, buildRadar(snapshot).
 * Standard JavaScript only; deterministic (no clock, seeded resampling). No protocol name appears here. */
(function (root) {
  'use strict';

  var CFG = {
    version: 'drop-radar-5',
    shrink_k: 4,          // pseudo-peers pulling a family tilt toward 1
    growth_lo: -25, growth_hi: 40, factor_penalty: 100,
    drop_share: 0.10,     // airdrop share of the implied FDV
    tbill: 0.04,          // income a deposit forgoes, per year
    boot: 60,             // refits for the rank range
    worth: 0.25, marginal: 0.6,
  };

  var FAMILIES = ['Vaults & yield', 'Lending & CDP', 'Trading', 'RWA & stables', 'Staking', 'Infra & chains', 'Other'];
  var EXCLUDED = { 'CEX': 1, 'Bridge': 1, 'Cross Chain Bridge': 1, 'Canonical Bridge': 1, 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1 };

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

  function isProduct(p) {
    if (EXCLUDED[p.category]) return true;
    if (/^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i.test(p.name)) return true;
    return /\b(wrapped|staked|staking)\b/i.test(p.name) || /\s(v\d+(\.\d+)?|\d+\.\d+)$/i.test(p.name);
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

  function features(p, asOf) {
    var age = p.listed_at ? daysBetween(p.listed_at, asOf) : null;
    return { x: L(p.tvl_usd / 1e8), fam: familyOf(p.category), age: age,
      g: clamp(p.change_7d || 0, CFG.growth_lo, CFG.growth_hi) / 25,
      d: age === null ? 0 : clamp(L(Math.max(1, age) / 365), -1, 1) };
  }

  function baseLog(fit, p) { return fit.curve.a + fit.curve.b * p.x + fit.tilts[p.fam].log; }
  function predictLog(fit, p) { return baseLog(fit, p) + fit.growth * p.g + fit.age * p.d; }

  function fitAll(pts) {
    // Refit the size curve with capped residuals so extreme market caps have less leverage.
    var initial = fitCurve(pts);
    var errors = pts.map(function (p) { return p.y - initial.a - initial.b * p.x; });
    var center = median(errors);
    var cap = 1.75 * median(errors.map(function (e) { return Math.abs(e - center); }));
    var curve = fitCurve(pts.map(function (p, i) {
      return { x: p.x, y: initial.a + initial.b * p.x + clamp(errors[i], center - cap, center + cap) };
    }));
    var fit = { curve: curve, tilts: fitTilts(pts, curve) };
    // Joint ridge regression on the remaining log-dollar error, with neutral priors.
    var gg = CFG.factor_penalty, dd = CFG.factor_penalty, gd = 0, gy = 0, dy = 0;
    pts.forEach(function (p) {
      var e = clamp(p.y - baseLog(fit, p), -1, 1);
      gg += p.g * p.g; dd += p.d * p.d; gd += p.g * p.d;
      gy += p.g * e; dy += p.d * e;
    });
    var det = gg * dd - gd * gd;
    fit.growth = (gy * dd - dy * gd) / det;
    fit.age = (dy * gg - gy * gd) / det;
    return fit;
  }

  function outOfSample(pts, split) {
    var folds = new Map(), errors = [], flat = [], size = [], family = [];
    if (split === 'newer') {
      var dated = pts.filter(function (p) { return p.age !== null; }).sort(function (a, b) { return b.age - a.age; });
      [0.55, 0.70, 0.85, 1].map(function (q) { return Math.floor(q * dated.length); }).forEach(function (end, i, cuts) {
        if (i) folds.set(i, dated.slice(cuts[i - 1], end));
      });
    } else {
      pts.forEach(function (p) {
        var k = split === 'year' ? p.year : p.slug;
        if (k) folds.set(k, (folds.get(k) || []).concat(p));
      });
    }

    folds.forEach(function (test) {
      if (!test.length) return;
      var train = pts.filter(function (p) {
        return split === 'newer' ? p.age !== null && p.age > test[0].age : !test.includes(p);
      });
      var f = fitAll(train), mult = median(train.map(function (p) { return p.y - p.x; }));
      test.forEach(function (p) {
        errors.push(p.y - predictLog(f, p));
        flat.push(p.y - p.x - mult);
        size.push(p.y - f.curve.a - f.curve.b * p.x);
        family.push(p.y - baseLog(f, p));
      });
    });
    var miss = function (a) { return Math.pow(10, median(a.map(Math.abs))); };
    return { n: errors.length, folds: folds.size, median_miss: miss(errors), flat_miss: miss(flat),
      size_miss: miss(size), family_miss: miss(family), band: [quantile(errors, 0.25), quantile(errors, 0.75)] };
  }

  // Farm scenarios
  var GAS = { Solana: 0.005, Sui: 0.01, Aptos: 0.01, Base: 0.03, Arbitrum: 0.05, Optimism: 0.04, Polygon: 0.02, BSC: 0.08, Binance: 0.08, Avalanche: 0.08, Sonic: 0.02, Ink: 0.02, Unichain: 0.02, 'Hyperliquid L1': 0.03, Plasma: 0.02, Tron: 1, Bitcoin: 2, Ethereum: 4 };
  function cheapestChain(chains) {
    var best = null;
    chains.slice(0, 3).forEach(function (c) { var g = GAS[c] === undefined ? 0.15 : GAS[c]; if (!best || g < best.gas) best = { chain: c, gas: g }; });
    return best || { chain: 'its main chain', gas: 0.15 };
  }
  function money(x) { var s = x < 0 ? '-' : ''; x = Math.abs(x); return s + (x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x < 10 ? '$' + x.toFixed(2) : '$' + Math.round(x).toLocaleString('en-US')); }

  var PLAY = {
    'Vaults & yield': { verb: 'If {N} offers a USDC vault on {C}, deposit up to {D} and keep the shares; otherwise confirm the supported asset or stop', tx: 2, weeks: 8, mid: 'verify recorded points and use the withdrawal preview to estimate exit costs' },
    'Lending & CDP': { verb: 'Supply {D} of USDC on {N} on {C}, where the asset is supported. Borrow up to 20% only if an official points program counts borrowing and the health factor stays above 3', tx: 3, weeks: 8, mid: 'recheck health and repay the loan if its funding cost exceeds the plan' },
    'Trading': { verb: 'On {N} on {C}, quote a spot swap up to {Q}. Use a route credited to this protocol and keep the receipt, or skip if none is available', tx: 2, weeks: 6, mid: 'check the credited activity before repeating one small swap' },
    'Perps': { verb: 'On {N} on {C}, use an officially eligible market for one open-and-close trade up to {Q} at 1x; close the position the same day', tx: 3, weeks: 6, mid: 'verify eligible fills and use the same size for a second round trip only within the fee cap' },
    'RWA & stables': { verb: 'Subscribe {D} to {N}\'s main product on {C} after checking its minimum ticket and redemption window', tx: 2, weeks: 8, mid: 're-read the product page and confirm the position accrues; redeem nothing early' },
    'Staking': { verb: 'Stake {D} through {N}\'s own interface on {C}, choosing the option with no lock-up or the shortest one', tx: 2, weeks: 8, mid: 'claim or restake any reward once, a second dated action' },
    'Infra & chains': { verb: 'Bridge {D} onto {N}{OC} and use 3 of its own apps: a swap, a lend and a liquidity position', tx: 6, weeks: 6, mid: 'repeat one swap and one deposit so activity spans more than one week' },
    'Other': { verb: 'Use {N}\'s core product on {C} with {D}: one deposit or action now', tx: 3, weeks: 6, mid: 'repeat the core action once so the address shows two dates' },
  };

  function farmPlan(r) {
    var D = r.tvl < 20e6 ? 1000 : 2000;
    var cc = cheapestChain(r.chains), g = cc.gas;
    var trading = r.family === 'Trading', pb = PLAY[/derivative|perp/i.test(r.category) ? 'Perps' : r.family], W = pb.weeks;
    var execution = trading ? D * 0.003 : 0;
    var fill = function (s) { return s.replace(/\{OC\}/g, cc.chain === r.name ? '' : ' (' + cc.chain + ')').replace(/\{D\}/g, money(D)).replace(/\{Q\}/g, money(D / 4)).replace(/\{N\}/g, r.name).replace(/\{C\}/g, cc.chain); };
    var stop = Math.round(r.tvl * (1 - clamp(Math.abs(r.ch7 || 0) * 2 / 100, 0.1, 0.4)));
    var kyc = r.family === 'RWA & stables', d1 = kyc ? 3 : 1;
    // at: the day a step falls on (weekly: every held week; neither: it fires only on an event).
    var steps = [
      { when: 'day 0', at: 0, text: 'Open ' + r.name + ' from its DefiLlama listing, bookmark that domain, and read its docs on points, rewards and withdrawals; never use a link from a reply or DM.', cost: 0, min: 20 },
      kyc ? { when: 'day 0', at: 0, text: 'Pass ' + r.name + '\'s KYC if it asks for one; allow 1 to 3 days before you deposit, and skip the row if it is closed to your country.', cost: 0, min: 30 }
          : { when: 'day 0', at: 0, text: 'Note ' + r.name + '\'s minimum deposit and withdrawal delay; if funds lock for longer than ' + W + ' weeks, shrink the deposit or skip.', cost: 0, min: 10 },
      { when: 'day ' + d1, at: d1, text: 'Move ' + money(D) + ' of USDC and about ' + money(Math.max(0.5, g * 10)) + ' of gas to one wallet on ' + cc.chain + ', the cheapest of up to three listed chains (one transaction there costs about ' + money(g) + ').', cost: 1 + g, min: 15 },
      { when: 'day ' + d1, at: d1, text: fill(pb.verb) + (trading ? '. Allow ' + money(execution / 2) + ' for execution fees and slippage, separate from gas.' : '.'), cost: g * pb.tx + execution / 2, min: 20 },
      { when: 'weekly x' + W, weekly: true, text: 'Each week, check ' + r.name + '\'s TVL on DefiLlama against the stop level ' + money(stop) + ' and log the position\'s balance and any points shown.', cost: 0, min: 5 * W },
      { when: 'day ' + Math.round(W * 3.5), at: Math.round(W * 3.5), text: 'Midway, ' + fill(pb.mid) + '.', cost: g * 2 + execution / 2, min: 15 },
      { when: 'any day', text: 'Stop rule: if TVL falls below ' + money(stop) + ', exit when withdrawals are available. If paused, cancel new deposits and track the official status.', cost: g * 2, min: 10 },
      { when: 'day ' + W * 7, at: W * 7, text: 'After ' + W + ' weeks, withdraw the ' + money(D) + ' and bridge it back, unless a points season is announced that rewards holding longer.', cost: 1 + g * 2, min: 15 },
      { when: 'if a token launches', text: 'Claim only through the domain bookmarked on day 0, never through a link someone sends you; sell or hold by your own rule, not the chart.', cost: g, min: 10 },
    ];
    var fees = steps.reduce(function (s, x) { return s + x.cost; }, 0);
    var forgone = D * CFG.tbill * W / 52;
    var minutes = steps.reduce(function (s, x) { return s + x.min; }, 0);
    var slice = CFG.drop_share * r.implied * D / r.tvl;
    var odds = (fees + forgone) / slice, oddsLo = odds * r.implied / r.lo, oddsHi = odds * r.implied / r.hi;
    var verdict = oddsLo <= CFG.worth ? 'Worth farming' : oddsHi > CFG.marginal ? 'Skip' : 'Marginal';
    return { deposit: D, chain: cc.chain, gas: g, weeks: W, stop: stop, steps: steps, fees: fees, execution: execution, forgone: forgone, minutes: minutes, slice: slice, odds: odds, net_hour: (slice - fees - forgone) / (minutes / 60), verdict: verdict,
      // The same arithmetic at the value band's two ends: how far the verdict leans on the point estimate.
      odds_lo: oddsLo, odds_hi: oddsHi };
  }


  // Portfolio
  var PF = { budget: 10000, hours: 3, rate: 25, family_cap: 0.25, starts: 4, min_fill: 250, tvl_cap: 0.001 };

  function weekLoad(plan) {
    var w = [];
    for (var k = 0; k <= plan.weeks; k++) w.push({ min: 0, steps: [] });
    plan.steps.forEach(function (s, i) {
      if (s.weekly) for (k = 0; k < plan.weeks; k++) w[k].min += s.min / plan.weeks;
      else if (s.at !== undefined) { w[Math.floor(s.at / 7)].min += s.min; w[Math.floor(s.at / 7)].steps.push(i + 1); }
    });
    return w;
  }

  function planPortfolio(radar, opt) {
    var o = {}, k;
    for (k in PF) o[k] = opt && opt[k] > 0 ? +opt[k] : PF[k];
    var cap = o.hours * 60, load = [], fam = {}, left = o.budget, picks = [], out = [];
    var cand = radar.rows.filter(function (r) { return r.plan.verdict !== 'Skip'; }).map(function (r) {
      var p = r.plan; return { r: r, score: (p.slice * r.lo / r.implied) / (p.fees + p.forgone + p.minutes / 60 * o.rate) };
    }).sort(function (a, b) { return b.score - a.score || a.r.rank - b.r.rank; });
    cand.forEach(function (c) {
      var r = c.r, p = r.plan, room = Math.min(left, o.budget * o.family_cap - (fam[r.family] || 0));
      var dep = Math.floor(Math.min(p.deposit * o.budget / PF.budget, r.tvl * o.tvl_cap, room) / 50) * 50;
      var skip = function (why) { out.push({ r: r, score: c.score, why: why }); };
      if (dep < o.min_fill) return skip(left < o.min_fill ? 'budget spent' : room < o.min_fill ? 'family at ' + Math.round(o.family_cap * 100) + '%' : 'too small');
      var x = dep / p.deposit, slice = p.slice * x, forgone = p.forgone * x, fees = p.fees + p.execution * (x - 1);
      if ((fees + forgone) / (slice * r.hi / r.implied) > CFG.marginal) return skip('fees eat a ' + money(dep) + ' slice');
      var wl = weekLoad(p), start = -1;
      for (var s = 0; s < o.starts && start < 0; s++) {
        if (wl.every(function (w, i) { return (load[s + i] || 0) + w.min <= cap; })) start = s;
      }
      if (start < 0) return skip('hours cap');
      wl.forEach(function (w, i) { load[start + i] = (load[start + i] || 0) + w.min; });
      fam[r.family] = (fam[r.family] || 0) + dep; left -= dep;
      picks.push({ r: r, score: c.score, deposit: dep, start: start, weeks: wl, fees: fees, forgone: forgone, minutes: p.minutes, slice: slice, lo: slice * r.lo / r.implied, hi: slice * r.hi / r.implied });
    });
    var sum = function (f) { return picks.reduce(function (t, q) { return t + q[f]; }, 0); };
    for (k = 0; k < load.length; k++) load[k] = load[k] || 0;
    return { opt: o, picks: picks, left_out: out, candidates: cand.length, load: load, families: fam,
      deposit: sum('deposit'), fees: sum('fees'), forgone: sum('forgone'), minutes: sum('minutes'), slice: sum('slice'), lo: sum('lo'), hi: sum('hi') };
  }

  function stepText(s) { return s.when + ': ' + s.text + ' (cost ' + money(s.cost) + ', ' + s.min + ' min)'; }

  // Board
  function buildRadar(snap) {
    var asOf = snap.as_of, watch = {};
    snap.watchlist.forEach(function (s) { watch[s] = 1; });
    var pts = [], rows = [];
    var census = { ranked: 0, priced: 0, unpricedToken: 0, products: 0, unusable: 0 };
    snap.protocols.forEach(function (p) {
      if (p.mcap_usd > 0 && p.tvl_usd > 0) {
        pts.push(Object.assign(features(p, asOf), { slug: p.slug, name: p.name, symbol: p.symbol,
          category: p.category || 'Uncategorised', year: p.listed_at && p.listed_at.slice(0, 4),
          tvl: p.tvl_usd, mcap: p.mcap_usd, y: L(p.mcap_usd) }));
      }
    });
    pts.sort(function (a, b) { return a.slug.localeCompare(b.slug, 'en'); });
    var fit = fitAll(pts), oos = outOfSample(pts), cohort = outOfSample(pts, 'year');
    var bandLo = Math.min(0, oos.band[0]), bandHi = Math.max(0, oos.band[1]);

    snap.protocols.forEach(function (p) {
      var w = !!watch[p.slug];
      if (!w && p.tvl_usd <= 0) { census.unusable++; return; }
      if (!w && !isPreToken(p)) { census[p.mcap_usd > 0 ? 'priced' : 'unpricedToken']++; return; }
      if (!w && isProduct(p)) { census.products++; return; }
      census.ranked++;
      var f = features(p, asOf), implied = Math.max(1, Math.round(Math.pow(10, predictLog(fit, f))));
      var size = Math.pow(10, fit.curve.a + fit.curve.b * f.x);
      rows.push({ slug: p.slug, name: p.name, category: p.category || 'Uncategorised', family: f.fam,
        chains: p.chains, tvl: p.tvl_usd, ch7: p.change_7d, age: f.age, features: f, watch: w, above: p.tvl_usd >= snap.floor_usd,
        f: { size: size, tilt: Math.pow(10, fit.tilts[f.fam].log), mom: Math.pow(10, fit.growth * f.g),
          season: Math.pow(10, fit.age * f.d), peers: fit.tilts[f.fam].peers }, implied: implied,
        lo: Math.max(1, Math.round(implied * Math.pow(10, bandLo))), hi: Math.round(implied * Math.pow(10, bandHi)) });
    });
    rows.sort(function (a, b) { return b.implied - a.implied || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });

    // Rank range: refit the curve and tilts on seeded resamples of the traded set, rank again, keep P10..P90.
    var seed = 20261114, rnd = function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    var seen = rows.map(function () { return []; });
    for (var b = 0; b < CFG.boot; b++) {
      var sample = pts.map(function () { return pts[Math.floor(rnd() * pts.length)]; });
      var fb = fitAll(sample);
      var vals = rows.map(function (r, i) { return { i: i, v: predictLog(fb, r.features) }; });
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
      census: census, fit: fit, oos: oos, cohort: cohort, newer: outOfSample(pts, 'newer'), traded: pts, rows: rows };
  }

  function boardRows(radar) {
    return radar.rows.map(function (r) { return { slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied, farm_steps: r.plan.steps.map(stepText) }; });
  }

  var api = { CFG: CFG, PF: PF, FAMILIES: FAMILIES, familyOf: familyOf, predictLog: predictLog, buildRadar: buildRadar, boardRows: boardRows, planPortfolio: planPortfolio, weekLoad: weekLoad, money: money };
  root.DropRadar = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
