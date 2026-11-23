/* Drop Radar model (drop-radar-7), run by main.ts and the page alike. Deterministic; names no protocol.
 * implied value = price if a token launches (fit on traded tokens) x token odds (fit on every dated protocol's
 * token record). A term enters either fit only if it lowers the held-out miss in both of its tests. */
(function (root) {
  'use strict';

  var CFG = {
    version: 'drop-radar-7',
    shrink_k: 4, ridge: 0.5, fam_ridge: 8, ceiling_q: 0.95, odds_floor: 0.03,
    drop_share: 0.10,     // airdrop share of the launch value
    tbill: 0.04,          // income a deposit forgoes, per year
    boot: 60,             // refits for the rank range
  };

  var FAMILIES = ['Vaults & yield', 'Lending & CDP', 'Trading', 'RWA & stables', 'Staking', 'Infra & chains', 'Other'];
  var EXCLUDED = { 'CEX': 1, 'Bridge': 1, 'Canonical Bridge': 1, 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1, 'Stablecoin Wrapper': 1 };

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

  /** The house product rule minus its TVL floor, plus stablecoin wrappers and restaking of a liquid-staked token. */
  function isProduct(p, staked) {
    if (EXCLUDED[p.category]) return true;
    if (p.category === 'Restaking' && p.slug.split('-').some(function (s) { return staked[s]; })) return true;
    if (/^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i.test(p.name)) return true;
    return /\b(wrapped|staked|staking)\b/i.test(p.name) || /\s(v\d+|\d+\.\d+)$/i.test(p.name);
  }

  var L = function (x) { return Math.log(x) / Math.LN10; };
  var clamp = function (x, lo, hi) { return Math.min(hi, Math.max(lo, x)); };
  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function quantile(a, q) { var s = a.slice().sort(function (x, y) { return x - y; }); var i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); }
  function years(a, b) { return Math.max(0, (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5 / 365.25); }
  function solve(A, b) {   // Gaussian elimination, partial pivots
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      for (k = i + 1, j = i; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[j][i])) j = k;
      var t = M[i]; M[i] = M[j]; M[j] = t;
      for (k = i + 1; k < n; k++) { var f = M[k][i] / M[i][i]; for (j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
    }
    var x = [];
    for (i = n - 1; i >= 0; i--) { var s = M[i][n]; for (j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }

  // ---------------------------------------------------------------- price if a token launches
  /** Size curve: least squares of log10(mcap) on log10(TVL / $100M) over the protocols whose token trades. */
  function fitCurve(pts) {
    var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
    var b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    return { a: a, b: b };
  }

  /** Family tilts: the median residual of each family's traded peers, shrunk toward 0 with shrink_k pseudo-peers. */
  function fitTilts(pts, curve) {
    var by = {}, t = {};
    pts.forEach(function (p) { (by[p.fam] = by[p.fam] || []).push(p.y - (curve.a + curve.b * p.x)); });
    FAMILIES.forEach(function (f) { var r = by[f] || []; t[f] = { peers: r.length, log: r.length ? (r.length * median(r)) / (r.length + CFG.shrink_k) : 0 }; });
    return t;
  }

  /** Price terms, added in order: 0 flat multiple, 1 size curve, 2 family tilt, 3 7-day growth and years tracked. */
  var PRICE = ['flat median multiple', '+ size curve, log TVL', '+ family tilt', '+ 7-day growth, years tracked'];
  function fitPrice(pts, k) {
    if (!k) { var m = median(pts.map(function (p) { return p.y - L(p.tvl); })); return { k: 0, m: m }; }
    var c = fitCurve(pts), t = k > 1 ? fitTilts(pts, c) : null, f = { k: k, curve: c, tilts: t, w: [0, 0] };
    if (k > 2) {   // ridge least squares of the remaining residual on growth and age
      var A = [[CFG.ridge, 0], [0, CFG.ridge]], v = [0, 0];
      pts.forEach(function (p) { var e = p.y - priceLog(f, p), z = [p.g, p.age]; for (var i = 0; i < 2; i++) { v[i] += z[i] * e; for (var j = 0; j < 2; j++) A[i][j] += z[i] * z[j]; } });
      f.w = solve(A, v);
    }
    return f;
  }
  function priceLog(f, p) {
    if (!f.k) return f.m + L(p.tvl);
    return f.curve.a + f.curve.b * p.x + (f.tilts ? f.tilts[p.fam].log : 0) + f.w[0] * p.g + f.w[1] * p.age;
  }

  /** Two held-out tests: leave one traded token out, and price later listings from earlier ones only. */
  function heldOut(rows, fit, score) {
    var dated = rows.filter(function (u) { return u.listed; }).sort(function (a, b) { return a.listed < b.listed ? -1 : a.listed > b.listed ? 1 : a.slug < b.slug ? -1 : 1; });
    var walk = [0.55, 0.7, 0.85].map(function (s, i, a) { var n = dated.length; return [dated.slice(Math.floor(s * n), Math.floor((a[i + 1] || 1) * n)), dated.slice(0, Math.floor(s * n))]; });
    return { first: score(rows, fit), walk: score(walk, fit), n_walk: walk.reduce(function (s, w) { return s + w[0].length; }, 0) };
  }
  function looBlocks(rows) { return rows.map(function (u, i) { return [[u], rows.slice(0, i).concat(rows.slice(i + 1))]; }); }
  function priceScore(blocks, k) {
    if (!blocks[0][1]) blocks = looBlocks(blocks);
    var e = [];
    blocks.forEach(function (b) { var f = fitPrice(b[1], k); b[0].forEach(function (p) { e.push(p.y - priceLog(f, p)); }); });
    return { miss: Math.pow(10, median(e.map(Math.abs))), err: e };
  }

  // ---------------------------------------------------------------- token odds
  /** Logistic fit of "records a token" on the kept terms, by Newton steps with a ridge on every slope. */
  var ODDS = ['age', 'size', 'growth', 'family'];
  function oddsX(u, t) {
    var x = [1];
    if (t.age) x.push(u.age); if (t.size) x.push(u.x); if (t.growth) x.push(u.g);
    if (t.family) FAMILIES.slice(1).forEach(function (f) { x.push(u.fam === f ? 1 : 0); });
    return x;
  }
  var sig = function (z) { return 1 / (1 + Math.exp(-z)); };
  var dot = function (x, b) { return x.reduce(function (s, v, j) { return s + v * b[j]; }, 0); };
  function fitOdds(us, t) {
    var X = us.map(function (u) { return oddsX(u, t); }), d = X[0].length, b = X[0].map(function () { return 0; });
    var lam = function (j) { return j === 0 ? 0 : t.family && j >= d - FAMILIES.length + 1 ? CFG.fam_ridge : CFG.ridge; };
    for (var it = 0; it < 25; it++) {
      var H = b.map(function () { return b.map(function () { return 0; }); }), g = b.map(function (v, j) { return -lam(j) * v; });
      X.forEach(function (x, i) {
        var p = sig(dot(x, b)), w = p * (1 - p);
        for (var j = 0; j < d; j++) { g[j] += x[j] * (us[i].y - p); for (var k = 0; k < d; k++) H[j][k] += w * x[j] * x[k]; }
      });
      for (var j = 0; j < d; j++) H[j][j] += lam(j) + 1e-9;
      var st = solve(H, g); b = b.map(function (v, j) { return v + st[j]; });
    }
    return { b: b, t: t, p: function (u) { return sig(dot(oddsX(u, t), b)); } };
  }
  function tenFold(us) { var s = us.slice().sort(function (a, b) { return a.slug < b.slug ? -1 : 1; }), out = []; for (var k = 0; k < 10; k++) out.push([s.filter(function (u, i) { return i % 10 === k; }), s.filter(function (u, i) { return i % 10 !== k; })]); return out; }
  function oddsScore(blocks, t) {
    if (!blocks[0][1]) blocks = tenFold(blocks);
    var s = 0, n = 0, hit = 0;
    blocks.forEach(function (b) { var m = fitOdds(b[1], t); b[0].forEach(function (u) { var p = m.p(u); s += (p - u.y) * (p - u.y); n++; if ((p >= 0.5) === (u.y === 1)) hit++; }); });
    return { brier: s / n, hit: hit / n };
  }

  /** Token odds: the share of peers like it that record a token by the oldest cohort's age, among those that had not by
   *  its own age: (F(ceiling) - F(age)) / (1 - F(age)). F is the fitted share recording a token at a given age. */
  function tokenOdds(m, u, ceiling) {
    var now = m.p(u), end = m.t.age ? m.p(Object.assign({}, u, { age: Math.max(ceiling, u.age) })) : 1;
    return { q: clamp((end - now) / (1 - now), CFG.odds_floor, 1), now: now, end: end };
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

  /** Drop if a token launches = drop_share x launch value x deposit / (TVL + deposit); expected drop = that x token odds.
   *  Break-even odds = (fees + income forgone) / drop if it launches. Worth farming: the model's odds clear the break-even
   *  even with the price at its band's low end (P25); Marginal: they clear it at the point estimate; Skip: they do not. */
  function farmPlan(r) {
    var D = r.tvl < 20e6 ? 1000 : 2000;
    var cc = cheapestChain(r.chains), g = cc.gas, pb = PLAY[r.family], W = pb.weeks;
    var fill = function (s) { return s.replace(/\{OC\}/g, cc.chain === r.name ? '' : ' (' + cc.chain + ')').replace(/\{D\}/g, money(D)).replace(/\{Q\}/g, money(D / 4)).replace(/\{N\}/g, r.name).replace(/\{C\}/g, cc.chain); };
    var stop = Math.round(r.tvl * (1 - Math.max(0.1, Math.abs(r.ch7 || 0) * 2 / 100)));
    var kyc = r.family === 'RWA & stables', d1 = kyc ? 3 : 1;
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
    var launch = CFG.drop_share * r.launch * D / (r.tvl + D), slice = launch * r.odds;
    var be = (fees + forgone) / launch, beLo = be * r.implied / r.lo;
    var verdict = r.odds >= beLo ? 'Worth farming' : r.odds >= be ? 'Marginal' : 'Skip';
    return { deposit: D, chain: cc.chain, gas: g, weeks: W, stop: stop, steps: steps, fees: fees, forgone: forgone, minutes: minutes, launch: launch, slice: slice, odds: be, net_hour: (slice - fees - forgone) / (minutes / 60), verdict: verdict,
      odds_lo: beLo, odds_hi: be * r.implied / r.hi };
  }

  // ---------------------------------------------------------------- the portfolio
  var PF = { budget: 10000, hours: 3, rate: 25, family_cap: 0.25, starts: 4, min_fill: 250, tvl_cap: 0.001 };

  /** Minutes a plan asks for in each week of its hold: dated steps in week floor(day / 7), the check every week. */
  function weekLoad(plan) {
    var w = [];
    for (var k = 0; k <= plan.weeks; k++) w.push({ min: 0, steps: [] });
    plan.steps.forEach(function (s, i) {
      if (s.weekly) for (k = 0; k < plan.weeks; k++) w[k].min += s.min / plan.weeks;
      else if (s.at !== undefined) { w[Math.floor(s.at / 7)].min += s.min; w[Math.floor(s.at / 7)].steps.push(i + 1); }
    });
    return w;
  }

  /** Greedy plan: Worth farming and Marginal rows by expected drop per $ of fees + income forgone + time (hours x rate),
   *  one per protocol, at most family_cap of the budget per family, started in the first of `starts` weeks that keeps
   *  every week of the combined schedule under the hours cap. */
  function planPortfolio(radar, opt) {
    var o = {}, k;
    for (k in PF) o[k] = opt && opt[k] > 0 ? +opt[k] : PF[k];
    var cap = o.hours * 60, load = [], fam = {}, left = o.budget, picks = [];
    var cand = radar.rows.filter(function (r) { return r.plan.verdict !== 'Skip'; }).map(function (r) {
      var p = r.plan; return { r: r, score: p.slice / (p.fees + p.forgone + p.minutes / 60 * o.rate) };
    }).sort(function (a, b) { return b.score - a.score || a.r.rank - b.r.rank; });
    cand.forEach(function (c) {
      var r = c.r, p = r.plan, room = Math.min(left, o.budget * o.family_cap - (fam[r.family] || 0));
      var dep = Math.floor(Math.min(p.deposit * o.budget / PF.budget, r.tvl * o.tvl_cap, room) / 50) * 50;
      var x = dep / p.deposit, slice = p.slice * x, forgone = p.forgone * x;
      if (dep < o.min_fill || p.fees + forgone > slice) return;   // too small, or fees eat the smaller slice
      var wl = weekLoad(p), start = -1;
      for (var s = 0; s < o.starts && start < 0; s++) {
        if (wl.every(function (w, i) { return (load[s + i] || 0) + w.min <= cap; })) start = s;
      }
      if (start < 0) return;
      wl.forEach(function (w, i) { load[start + i] = (load[start + i] || 0) + w.min; });
      fam[r.family] = (fam[r.family] || 0) + dep; left -= dep;
      picks.push({ r: r, score: c.score, deposit: dep, start: start, weeks: wl, fees: p.fees, forgone: forgone, minutes: p.minutes, slice: slice, lo: slice * r.lo / r.implied, hi: slice * r.hi / r.implied });
    });
    var sum = function (f) { return picks.reduce(function (t, q) { return t + q[f]; }, 0); };
    for (k = 0; k < load.length; k++) load[k] = load[k] || 0;
    return { opt: o, picks: picks, candidates: cand.length, load: load,
      deposit: sum('deposit'), fees: sum('fees'), forgone: sum('forgone'), minutes: sum('minutes'), slice: sum('slice'), lo: sum('lo'), hi: sum('hi') };
  }

  function stepText(s) { return s.when + ': ' + s.text + ' (cost ' + money(s.cost) + ', ' + s.min + ' min)'; }

  // ---------------------------------------------------------------- the board
  function buildRadar(snap) {
    var asOf = snap.as_of, watch = {}, staked = {};
    snap.watchlist.forEach(function (s) { watch[s] = 1; });
    snap.protocols.forEach(function (p) { if (/Liquid (Re)?[Ss]taking/.test(p.category)) staked[p.slug] = 1; });
    var feat = function (p) {
      return { slug: p.slug, name: p.name, fam: familyOf(p.category), tvl: p.tvl_usd, x: L(p.tvl_usd / 1e8), listed: p.listed_at,
        g: clamp(p.change_7d === null ? 0 : p.change_7d, -30, 30) / 10, age: p.listed_at ? years(p.listed_at, asOf) : null };
    };
    var all = snap.protocols.filter(function (p) { return p.tvl_usd > 0; }).map(feat);
    var midAge = median(all.filter(function (u) { return u.age !== null; }).map(function (u) { return u.age; }));
    all.forEach(function (u) { u.known = u.age !== null; if (!u.known) u.age = midAge; });
    var bySlug = {}; all.forEach(function (u) { bySlug[u.slug] = u; });

    // price: the traded tokens, terms added in order, kept only if both held-out misses fall
    var pts = [];
    snap.protocols.forEach(function (p) {
      if (p.mcap_usd > 0 && p.tvl_usd > 0) pts.push(Object.assign({ symbol: p.symbol, category: p.category || 'Uncategorised', mcap: p.mcap_usd, y: L(p.mcap_usd) }, bySlug[p.slug]));
    });
    pts.sort(function (a, b) { return a.slug < b.slug ? -1 : 1; });
    var price = PRICE.map(function (name, k) { return { name: name, k: k, test: heldOut(pts, k, priceScore) }; }), pk = 0;
    price.forEach(function (s, k) { if (!k) return; var c = price[pk].test; s.kept = s.test.first.miss < c.first.miss && s.test.walk.miss < c.walk.miss; if (s.kept) pk = k; });
    var fit = fitPrice(pts, pk), loo = price[pk].test.first;
    var bandLo = quantile(loo.err, 0.25), bandHi = quantile(loo.err, 0.75);

    // odds: every dated protocol that is not a product, token recorded or not
    var us = snap.protocols.filter(function (p) { return p.listed_at && p.tvl_usd > 0 && !isProduct(p, staked); }).map(function (p) { return Object.assign({ y: isPreToken(p) ? 0 : 1 }, bySlug[p.slug]); });
    var cur = { name: 'base rate of peers', t: {}, test: heldOut(us, {}, oddsScore) }, odds = [cur];
    ODDS.forEach(function (term) {
      var t = Object.assign({}, cur.t); t[term] = 1;
      var s = { name: '+ ' + { age: 'years tracked', size: 'size, log TVL', growth: '7-day TVL growth', family: 'family' }[term], t: t, test: heldOut(us, t, oddsScore) };
      s.kept = s.test.first.brier < cur.test.first.brier && s.test.walk.brier < cur.test.walk.brier;
      if (s.kept) cur = s; odds.push(s);
    });
    var om = fitOdds(us, cur.t), ceiling = quantile(us.map(function (u) { return u.age; }), CFG.ceiling_q);
    var share = us.reduce(function (s, u) { return s + u.y; }, 0) / us.length;

    // a brand whose token trades: another product line of it (same first word of the name) is set aside off the list
    var brand = {}, word = function (n) { var x = n.toLowerCase().split(/[\s-]/)[0]; return x.length > 2 ? x : ''; };
    snap.protocols.forEach(function (p) { if (!isPreToken(p) && p.symbol && word(p.name)) brand[word(p.name)] = p.symbol; });
    var rows = [], setAside = 0;
    snap.protocols.forEach(function (p) {
      var w = !!watch[p.slug], sib = brand[word(p.name)] || '';
      if (!w && (!isPreToken(p) || !(p.tvl_usd > 0))) return;
      if (!w && (sib || isProduct(p, staked))) { setAside++; return; }
      var u = bySlug[p.slug], fam = u.fam;
      var size = Math.pow(10, fit.curve.a + fit.curve.b * u.x), launch = Math.pow(10, priceLog(fit, u));
      var o = tokenOdds(om, u, ceiling), q = o.q, implied = Math.max(1, Math.round(launch * q));
      rows.push({ slug: p.slug, name: p.name, category: p.category || 'Uncategorised', family: fam, chains: p.chains, tvl: p.tvl_usd, ch7: p.change_7d,
        age: u.known ? Math.round(u.age * 365.25) : null, sib: sib, watch: w, above: p.tvl_usd >= snap.floor_usd,
        f: { size: size, now: o.now, end: o.end }, launch: launch, odds: q, implied: implied, lo: Math.max(1, Math.round(implied * Math.pow(10, bandLo))), hi: Math.round(implied * Math.pow(10, bandHi)) });
    });
    rows.sort(function (a, b) { return b.implied - a.implied || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });

    // Rank range: refit price and odds on seeded resamples of their rows, rank again, keep P10..P90.
    var seed = 20261114, rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    var pick = function (a) { return a.map(function () { return a[Math.floor(rnd() * a.length)]; }); }, seen = rows.map(function () { return []; });
    for (var b = 0; b < CFG.boot; b++) {
      var fb = fitPrice(pick(pts), pk), ob = fitOdds(pick(us), cur.t);
      rows.map(function (r, i) { var u = bySlug[r.slug]; return { i: i, v: priceLog(fb, u) + L(tokenOdds(ob, u, ceiling).q) }; })
        .sort(function (p, q) { return q.v - p.v; }).forEach(function (o, k) { seen[o.i].push(k + 1); });
    }
    rows.forEach(function (r, i) { r.rlo = Math.round(quantile(seen[i], 0.1)); r.rhi = Math.round(quantile(seen[i], 0.9)); r.plan = farmPlan(r); });


    return { cfg: CFG, as_of: asOf, source: snap.source, floor: snap.floor_usd, universe: snap.protocols.length, watch_n: snap.watchlist.length,
      set_aside: setAside, fit: fit, price: price, pk: pk, oddsTests: odds, om: om, ceiling: ceiling, share: share, dated: us.length, band: [bandLo, bandHi], traded: pts, rows: rows };
  }

  function boardRows(radar) {
    return radar.rows.map(function (r) { return { slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied, farm_steps: r.plan.steps.map(stepText) }; });
  }

  var api = { CFG: CFG, PF: PF, FAMILIES: FAMILIES, familyOf: familyOf, buildRadar: buildRadar, boardRows: boardRows, planPortfolio: planPortfolio, weekLoad: weekLoad, money: money, priceLog: priceLog };
  root.DropRadar = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
