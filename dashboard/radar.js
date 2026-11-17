// Drop Radar page: reruns model.js on the sealed snapshot (../data.js), checks it against board.json row by
// row, and renders the board, its radar sweep, a detail view per protocol and the planner. State: the URL hash.
(function () {
  'use strict';
  var M = window.DropRadar, R = M.buildRadar(window.SNAPSHOT), B = window.BOARD;
  var app = document.getElementById('app'), money = M.money, L = function (v) { return Math.log(v) / Math.LN10; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  var usd = function (x) { return x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + Math.round(x / 1e3) + 'K' : '$' + Math.round(x); };
  var pct = function (x) { return x === null ? '<span class="mute">n/a</span>' : '<span class="' + (x >= 0 ? 'up' : 'down') + '">' + (x >= 0 ? '+' : '') + x.toFixed(1) + '%</span>'; };
  var hrs = function (m) { return (m / 60).toFixed(1) + ' h'; };
  var VCLASS = { 'Worth farming': 'v-worth', 'Marginal': 'v-marg', 'Skip': 'v-skip' };
  var bySlug = {}; R.rows.forEach(function (r) { bySlug[r.slug] = r; });

  // board.json = this page: every rank, value and farm plan, and the default portfolio, against the files main.ts wrote.
  var matched = 0;
  R.rows.forEach(function (r, i) {
    var b = B.rows[i], steps = M.boardRows({ rows: [r] })[0].farm_steps;
    if (b && b.slug === r.slug && b.rank === r.rank && b.implied_value_usd === r.implied && b.farm_steps.join('|') === steps.join('|')) matched++;
  });
  var P0 = M.planPortfolio(R), planOk = B.portfolio && B.portfolio.picks.join('|') === P0.picks.map(function (q) { return q.r.slug + ':' + q.deposit + ':' + q.start; }).join('|');
  var verified = matched === B.rows.length && matched === R.rows.length && planOk;
  document.getElementById('stamp').innerHTML = 'DefiLlama snapshot ' + esc(R.as_of) + ' &middot; model ' + esc(R.cfg.version) +
    ' <span class="check ' + (verified ? 'ok' : 'bad') + '">' + (verified ? '&#10003;' : '&#10007;') + ' page = board.json: ' + matched + '/' + B.rows.length + ' rows' + (planOk ? ' + plan' : '') + '</span>';

  var D = { view: 'board', q: '', fam: '', chain: '', scope: 'all', verdict: '', anchors: '', sort: 'implied', dir: -1, p: '', budget: '', hours: '', rate: '' };
  var S = JSON.parse(JSON.stringify(D));
  function readHash() {
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      var k = decodeURIComponent(kv.slice(0, i)), v = decodeURIComponent(kv.slice(i + 1));
      if (k in S) S[k] = k === 'dir' ? Number(v) : v;
    });
  }
  function go(patch) {
    for (var k in patch) S[k] = patch[k];
    var parts = Object.keys(S).filter(function (k) { return S[k] !== D[k]; }).map(function (k) { return k + '=' + encodeURIComponent(S[k]); });
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname);
    render();
  }
  function plan() { return M.planPortfolio(R, { budget: S.budget, hours: S.hours, rate: S.rate }); }
  function wire() {
    app.querySelectorAll('[data-slug]').forEach(function (el) { el.onclick = function () { go({ p: el.dataset.slug }); }; });
    app.querySelectorAll('[data-fam]').forEach(function (el) { el.onclick = function () { go({ view: 'board', fam: S.fam === el.dataset.fam ? '' : el.dataset.fam }); }; });
  }

  // ---- the radar sweep
  // Angle: family sector (sized by its row count); inside a sector, the 7-day TVL change, shrinking to growing.
  // Radius: log implied value. Dot area: TVL. Colour: farm verdict. Ring: on the watchlist.
  function sweep(hl) {
    var W = 520, c = W / 2, r0 = 34, r1 = 196, gap = 0.28;
    var vals = R.rows.map(function (r) { return r.implied; }), vmin = Math.min.apply(0, vals) * 0.85, vmax = Math.max.apply(0, vals) * 1.12;
    var tmax = Math.max.apply(0, R.rows.map(function (r) { return r.tvl; }));
    var rad = function (v) { return r0 + (L(v) - L(vmin)) / (L(vmax) - L(vmin)) * (r1 - r0); };
    var pt = function (a, rr) { return (c + rr * Math.sin(a)).toFixed(1) + ',' + (c - rr * Math.cos(a)).toFixed(1); };
    var fams = M.FAMILIES.map(function (f) { return { f: f, n: R.rows.filter(function (r) { return r.family === f; }).length }; }).filter(function (x) { return x.n; });
    var tot = fams.reduce(function (s, x) { return s + x.n + 10; }, 0), a = gap / 2, sec = {}, famBox = [];
    var s = '<svg viewBox="-90 -20 ' + (W + 180) + ' ' + (W + 40) + '" class="sweep" role="img" aria-label="Radar of every protocol that records no token"><defs><radialGradient id="glow"><stop offset="0" stop-color="#3fe0c0" stop-opacity=".10"/><stop offset="1" stop-color="#3fe0c0" stop-opacity="0"/></radialGradient></defs>';
    s += '<circle cx="' + c + '" cy="' + c + '" r="' + r1 + '" fill="url(#glow)"/>';
    fams.forEach(function (x, i) {
      var span = (2 * Math.PI - gap) * (x.n + 10) / tot, a1 = a + span, mid = a + span / 2;
      sec[x.f] = [a, a1];
      s += '<path class="sec' + (i % 2 ? ' alt' : '') + (S.fam === x.f ? ' on' : '') + '" d="M' + pt(a, r0) + 'L' + pt(a, r1) + 'A' + r1 + ',' + r1 + ' 0 ' + (span > Math.PI ? 1 : 0) + ' 1 ' + pt(a1, r1) + 'L' + pt(a1, r0) + 'A' + r0 + ',' + r0 + ' 0 ' + (span > Math.PI ? 1 : 0) + ' 0 ' + pt(a, r0) + 'Z"/>';
      var lx = c + (r1 + 22) * Math.sin(mid), ly = c - (r1 + 22) * Math.cos(mid), anc = Math.abs(Math.sin(mid)) < 0.2 ? 'middle' : Math.sin(mid) > 0 ? 'start' : 'end';
      var fy = ly + 4 + (Math.cos(mid) < -0.9 ? 6 : 0), fw = (x.f.length + 4) * 8.2;
      famBox.push({ x0: anc === 'start' ? lx : anc === 'end' ? lx - fw : lx - fw / 2, x1: anc === 'start' ? lx + fw : anc === 'end' ? lx : lx + fw / 2, y: fy });
      s += '<text class="fam" data-fam="' + esc(x.f) + '" x="' + lx.toFixed(1) + '" y="' + fy.toFixed(1) + '" text-anchor="' + anc + '">' + esc(x.f) + ' <tspan>' + x.n + '</tspan></text>';
      a = a1;
    });
    [2e6, 5e6, 1e7, 2e7, 5e7].forEach(function (v) {
      if (v < vmin || v > vmax) return;
      s += '<circle class="ring" cx="' + c + '" cy="' + c + '" r="' + rad(v).toFixed(1) + '"/><text class="rl" x="' + c + '" y="' + (c - rad(v) + 3).toFixed(1) + '">' + usd(v).replace('.0M', 'M') + '</text>';
    });
    s += '<g class="beam">';
    for (var k = 0; k < 12; k++) s += '<path d="M' + c + ',' + c + 'L' + pt(-k * 0.05, r1) + 'A' + r1 + ',' + r1 + ' 0 0 0 ' + pt(-(k + 1) * 0.05, r1) + 'Z" opacity="' + (0.2 * (1 - k / 12)).toFixed(3) + '"/>';
    s += '<line x1="' + c + '" y1="' + c + '" x2="' + c + '" y2="' + (c - r1) + '"/></g>';
    var labels = [];
    R.rows.slice().sort(function (p, q) { return q.tvl - p.tvl; }).forEach(function (r) {
      var g = sec[r.family], t = 0.5 + Math.atan((r.ch7 || 0) / 8) / Math.PI, an = g[0] + 0.03 + t * (g[1] - g[0] - 0.06), rr = rad(r.implied);
      var x = c + rr * Math.sin(an), y = c - rr * Math.cos(an), d = 2 + 9 * Math.sqrt(r.tvl / tmax), on = hl ? hl[r.slug] : r.rank <= 8;
      s += '<g class="dot ' + VCLASS[r.plan.verdict] + (hl && !on ? ' dim' : '') + '" data-slug="' + esc(r.slug) + '"><title>#' + r.rank + ' ' + esc(r.name) + ': ' + usd(r.implied) + ', TVL ' + usd(r.tvl) + ', 7d ' + (r.ch7 === null ? 'n/a' : r.ch7.toFixed(1) + '%') + ', ' + r.plan.verdict + '</title>' +
        (r.watch ? '<circle class="wl" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (d + 2.6).toFixed(1) + '"/>' : '') + '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + d.toFixed(1) + '"/></g>';
      if (on) labels.push({ r: r, x: x, y: y, d: d });
    });
    labels.sort(function (p, q) { return p.y - q.y; }).forEach(function (l, i, all) {
      var right = l.x >= c, ty = l.y + 3.5;
      var w = l.r.name.length * 7.5, lx0 = right ? l.x + l.d + 4 : l.x - l.d - 4 - w, lx1 = lx0 + w;
      var hit = function (y) {
        for (var j = 0; j < i; j++) if ((all[j].x >= c) === right && Math.abs(all[j].ty - y) < 14) return true;
        return famBox.some(function (f) { return Math.abs(f.y - y) < 15 && lx1 > f.x0 && lx0 < f.x1; });
      };
      for (var k = 1; hit(ty) && k < 40; k++) ty = l.y + 3.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 14;
      l.ty = ty;
      s += '<text class="lab" x="' + (l.x + (right ? l.d + 4 : -l.d - 4)).toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="' + (right ? 'start' : 'end') + '">' + (hl ? '' : l.r.rank + ' ') + esc(l.r.name.length > 18 ? l.r.name.slice(0, 17) + '…' : l.r.name) + '</text>';
    });
    return s + '</svg><div class="legend"><i class="v-worth"></i>Worth farming <i class="v-marg"></i>Marginal <i class="v-skip"></i>Skip <i class="ringk"></i>watchlist &middot; dot size = TVL</div>' +
      '<div class="legend">Out from the centre = implied value (log) &middot; around each family sector = 7-day TVL change, shrinking &rarr; growing (clockwise)</div>';
  }

  // ---- the board
  function kpis() {
    var w = R.rows.filter(function (r) { return r.watch; }).length, worth = R.rows.filter(function (r) { return r.plan.verdict === 'Worth farming'; }).length;
    var o = R.oos;
    return '<section class="kpis">' + [
      [w + '/' + R.watch_n, 'watchlist ranked, every slug'],
      [R.rows.length, 'ranked: record no token'],
      [R.traded.length, 'already trade: fit the curve, never ranked'],
      [R.set_aside, 'set aside: wrapped, staked, bridged, exchange'],
      ['&times;' + o.median_miss.toFixed(2), 'leave-one-out miss (flat multiple &times;' + o.flat_miss.toFixed(2) + ')'],
      [worth, 'worth farming at break-even odds &le; ' + Math.round(R.cfg.worth * 100) + '%'],
    ].map(function (k) { return '<div><b>' + k[0] + '</b><span>' + k[1] + '</span></div>'; }).join('') + '</section>';
  }

  function howCard() {
    var c = R.fit.curve, o = R.oos;
    return '<section class="card"><h3>How a value is built <code>buildRadar()</code></h3><ol class="how">' +
      '<li><b class="k-tvl">Size curve</b> on <b>TVL</b> <code>fitCurve()</code>: log10 value = ' + c.a.toFixed(2) + ' + ' + c.b.toFixed(3) + ' &times; log10(TVL / $100M), least squares on the ' + R.traded.length + ' protocols whose token trades</li>' +
      '<li><b>&times; family tilt</b> <code>fitTilts()</code>: median residual of the family\'s traded peers, shrunk with ' + R.cfg.shrink_k + ' pseudo-peers: ' + M.FAMILIES.map(function (f) { return esc(f) + ' &times;' + Math.pow(10, R.fit.tilts[f].log).toFixed(2) + ' (' + R.fit.tilts[f].peers + ')'; }).join(', ') + '</li>' +
      '<li><b class="k-g">&times; momentum</b> on <b>7-day growth</b>: 1 + ' + R.cfg.growth_weight + ' &times; 7-day TVL change, held to ' + R.cfg.growth_lo + '%..+' + R.cfg.growth_hi + '%</li>' +
      '<li><b class="k-d">&times; seasoning</b> on <b>days with no token</b>: ' + R.cfg.season_lo + ' + ' + R.cfg.season_span + ' &times; days tracked / ' + R.cfg.season_days + ' (unknown: ' + R.cfg.season_unknown + ')</li></ol>' +
      '<p class="mute">Out of sample <code>outOfSample()</code>: each of the ' + o.n + ' traded tokens refit without itself misses by a median <b>&times;' + o.median_miss.toFixed(2) + '</b> (one flat mcap/TVL multiple: &times;' + o.flat_miss.toFixed(2) + '); ' + Math.round(o.within3 * 100) + '% within 3&times;. Band: P25&ndash;P75 of residuals; rank range: P10&ndash;P90 of ' + R.cfg.boot + ' seeded refits.</p></section>';
  }

  function loadBars(P, h) {
    var cap = P.opt.hours * 60, w = 100 / Math.max(P.load.length, 1);
    return '<div class="load" style="height:' + h + 'px">' + P.load.map(function (m, i) { return '<i style="left:' + (i * w).toFixed(2) + '%;width:' + (w - 1).toFixed(2) + '%;height:' + (m / cap * 100).toFixed(1) + '%" title="week ' + (i + 1) + ': ' + Math.round(m) + ' min"></i>'; }).join('') + '</div>';
  }

  function planCard() {
    var P = plan();
    return '<section class="card pcard"><div class="plhead"><h3>Your farm plan: ' + money(P.opt.budget) + ', ' + P.opt.hours + ' h a week</h3><a href="#view=plan">Open the planner &rarr;</a></div>' +
      '<div class="ptot"><div><span>slice if each launched</span><b class="val">' + money(P.slice) + '</b><small>band ' + money(P.lo) + '&ndash;' + money(P.hi) + '</small></div><div><span>fees + income forgone</span><b>' + money(P.fees + P.forgone) + '</b><small>' + money(P.fees) + ' + ' + money(P.forgone) + '</small></div><div><span>hands-on</span><b>' + hrs(P.minutes) + '</b><small>over ' + P.load.length + ' weeks</small></div></div>' +
      '<ol class="picks">' + P.picks.map(function (q) { return '<li data-slug="' + esc(q.r.slug) + '"><b>' + esc(q.r.name) + '</b> <span class="mute">' + money(q.deposit) + ' &middot; wk ' + (q.start + 1) + ' &middot; ' + esc(q.r.plan.chain) + '</span><span class="num">' + money(q.slice) + '</span></li>'; }).join('') + '</ol>' +
      loadBars(P, 34) + '<p class="mute tiny">Weekly hands-on minutes against the ' + P.opt.hours + ' h cap; greedy by slice per $ of cost and time, one position per protocol, &le; ' + Math.round(P.opt.family_cap * 100) + '% of the budget per family.</p></section>';
  }

  function chip(k, v, label) { return '<button class="chip" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + (S[k] === v) + '">' + label + '</button>'; }

  var COLS = [['rank', '#', 'num'], ['name', 'Protocol', ''], ['implied', 'Implied value', 'num'], ['tvl', 'TVL &rarr; size', 'num k-tvl'], ['ch7', '7-day &rarr; &times;', 'num k-g'], ['age', 'Days &rarr; &times;', 'num k-d'], ['odds', 'Break-even', 'num'], ['verdict', 'Farm verdict', '']];
  var key = { rank: function (r) { return r.rank; }, name: function (r) { return r.name.toLowerCase(); }, implied: function (r) { return r.implied; }, tvl: function (r) { return r.tvl; }, ch7: function (r) { return r.ch7 === null ? -1e9 : r.ch7; }, age: function (r) { return r.age === null ? -1 : r.age; }, odds: function (r) { return r.plan.odds; }, verdict: function (r) { return r.plan.odds; } };

  function filtered() {
    var q = S.q.toLowerCase();
    return R.rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + r.category).toLowerCase().indexOf(q) < 0) return false;
      if (S.fam && r.family !== S.fam) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (S.verdict && r.plan.verdict !== S.verdict) return false;
      if (S.scope === 'watch' && !r.watch) return false;
      if (S.scope === 'off' && (r.watch || !r.above)) return false;
      if (S.scope === 'early' && r.above) return false;
      return true;
    }).sort(function (a, b) { var x = key[S.sort](a), y = key[S.sort](b); return (x < y ? -1 : x > y ? 1 : 0) * S.dir || a.rank - b.rank; });
  }

  // A factor cell: the snapshot figure, the multiplier it becomes, and a bar of where it sits.
  function fx(top, mult, w, cls) { return '<td class="num fx ' + cls + '">' + top + '<small>' + mult + '</small><i style="width:' + Math.max(3, Math.min(100, w)).toFixed(0) + '%"></i></td>'; }

  function rowHtml(r) {
    var tags = r.watch ? '<span class="tag watch">watchlist</span>' : r.above ? '<span class="tag">&ge; floor</span>' : '<span class="tag early">early</span>', f = r.f;
    return '<tr data-slug="' + esc(r.slug) + '"><td class="num"><b>' + r.rank + '</b><small>' + r.rlo + '&ndash;' + r.rhi + '</small></td>' +
      '<td><b>' + esc(r.name) + '</b> ' + tags + '<small>' + esc(r.category) + ' &middot; ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</small></td>' +
      '<td class="num"><b class="val">' + usd(r.implied) + '</b><small>' + usd(r.lo) + '&ndash;' + usd(r.hi) + '</small></td>' +
      fx(usd(r.tvl), usd(f.size), (L(r.tvl) - 6.6) / 2.9 * 100, 'k-tvl') +
      fx(pct(r.ch7), '&times;' + f.mom.toFixed(2), (f.mom - 0.85) / 0.35 * 100, 'k-g') +
      fx(r.age === null ? '365*' : r.age, '&times;' + f.season.toFixed(2), (f.season - R.cfg.season_lo) / R.cfg.season_span * 100, 'k-d') +
      '<td class="num">' + Math.min(999, Math.round(r.plan.odds * 100)) + '%<small>' + money(r.plan.net_hour) + '/h</small></td>' +
      '<td><span class="verdict ' + VCLASS[r.plan.verdict] + '">' + r.plan.verdict + '</span></td></tr>';
  }

  function board() {
    var rows = filtered(), chains = {};
    R.rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    var famCount = function (f) { return R.rows.filter(function (r) { return r.family === f; }).length; };
    var vCount = function (v) { return R.rows.filter(function (r) { return r.plan.verdict === v; }).length; };
    var anchors = S.anchors ? R.traded.filter(function (p) { return !S.fam || p.fam === S.fam; }).sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, 12) : [];
    app.innerHTML = kpis() + '<div class="hgrid"><div class="lcol"><section class="card"><div class="plhead"><h3>Radar &middot; ' + R.rows.length + ' protocols that record no token</h3><span class="mute tiny">click a dot for its plan, a sector to filter</span></div>' + sweep() + '</section>' + planCard() + howCard() + '</div>' +
      '<div class="rcol"><div class="formula">implied value = <b class="k-tvl">size curve(TVL)</b> &times; family tilt &times; <b class="k-g">momentum(7-day growth)</b> &times; <b class="k-d">seasoning(days with no token)</b><span>curve fitted on the ' + R.traded.length + ' tokens that already trade; they are never ranked</span></div>' +
      '<div class="filters">' + chip('scope', 'all', 'All ' + R.rows.length) + chip('scope', 'watch', 'Watchlist ' + R.watch_n) + chip('scope', 'off', 'Off list &ge; floor') + chip('scope', 'early', 'Early &lt; $50M') +
      '<input type="search" id="q" placeholder="Search a protocol" value="' + esc(S.q) + '"></div>' +
      '<div class="filters"><select id="fam"><option value="">All families</option>' + M.FAMILIES.filter(famCount).map(function (f) { return '<option value="' + esc(f) + '"' + (S.fam === f ? ' selected' : '') + '>' + esc(f) + ' (' + famCount(f) + ')</option>'; }).join('') + '</select>' +
      '<select id="chain"><option value="">All chains</option>' + Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).slice(0, 25).map(function (c) { return '<option' + (S.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      chip('verdict', '', 'Any verdict') + ['Worth farming', 'Marginal', 'Skip'].map(function (v) { return chip('verdict', v, v + ' ' + vCount(v)); }).join('') +
      '<label class="tog"><input type="checkbox" id="anch"' + (S.anchors ? ' checked' : '') + '> traded anchors</label></div>' +
      '<p class="mute count"><b>' + rows.length + '</b> of ' + R.rows.length + ' ranked shown' + (S.fam ? ' &middot; ' + esc(S.fam) : '') + (anchors.length ? ' &middot; ' + anchors.length + ' traded anchors' : '') + ' &middot; sorted by ' + COLS.filter(function (c) { return c[0] === S.sort; })[0][1] + ' &middot; click a header to sort</p>' +
      '<table class="board"><thead><tr class="grp"><th colspan="3"></th><th colspan="3">the snapshot\'s own figures &rarr; factor</th><th colspan="2">farm</th></tr><tr>' + COLS.map(function (c) { return '<th class="' + c[2] + '" data-sort="' + c[0] + '"' + (S.sort === c[0] ? ' aria-sort="' + (S.dir < 0 ? 'descending' : 'ascending') + '"' : '') + '>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      anchors.map(function (p) { return '<tr class="anchor"><td class="num">&ndash;</td><td>' + esc(p.name) + ' <span class="tag">trades</span><small>' + esc(p.category) + ' &middot; reference, not ranked</small></td><td class="num">' + usd(p.mcap) + '<small>market cap</small></td><td class="num">' + usd(p.tvl) + '</td><td colspan="4" class="mute">market ' + (p.mcap / p.tvl).toFixed(2) + '&times; TVL &middot; curve says ' + usd(Math.pow(10, R.fit.curve.a + R.fit.curve.b * L(p.tvl / 1e8) + R.fit.tilts[p.fam].log)) + '</td></tr>'; }).join('') +
      rows.map(rowHtml).join('') + '</tbody></table></div></div>';
    wire();
    app.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { var o = {}; o[b.dataset.k] = b.dataset.v; go(o); }; });
    app.querySelectorAll('th[data-sort]').forEach(function (th) { th.onclick = function () { var k = th.dataset.sort; go(S.sort === k ? { dir: -S.dir } : { sort: k, dir: k === 'rank' || k === 'name' || k === 'odds' ? 1 : -1 }); }; });
    var q = app.querySelector('#q'), t = 0;
    q.oninput = function () { clearTimeout(t); t = setTimeout(function () { go({ q: q.value }); var n = app.querySelector('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 150); };
    app.querySelector('#fam').onchange = function (e) { go({ fam: e.target.value }); };
    app.querySelector('#chain').onchange = function (e) { go({ chain: e.target.value }); };
    app.querySelector('#anch').onchange = function (e) { go({ anchors: e.target.checked ? '1' : '' }); };
  }

  // ---- the portfolio planner
  var span = function (a) { return a.length > 1 ? a[0] + '&ndash;' + a[a.length - 1] : String(a[0]); };

  function planner() {
    var P = plan(), o = P.opt, cap = o.hours * 60, hl = {};
    P.picks.forEach(function (q) { hl[q.r.slug] = 1; });
    var field = function (k, label, step) { return '<label>' + label + '<input type="number" min="1" step="' + step + '" data-in="' + k + '" value="' + o[k] + '"></label>'; };
    var tile = function (v, k, sub) { return '<div><span>' + k + '</span><b>' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    var weeks = P.load.map(function (m, i) { return '<th class="num">wk ' + (i + 1) + '</th>'; }).join('');
    var reasons = {}; P.left_out.forEach(function (x) { (reasons[x.why] = reasons[x.why] || []).push(x); });
    app.innerHTML = '<section class="card ptop"><div><h2>Farm portfolio planner</h2><p class="mute">From the ' + P.candidates + ' Worth farming and Marginal rows, <code>planPortfolio()</code> takes positions greedily by slice per dollar of fees, income forgone and time (hours &times; your hourly value): one position per protocol, at most ' + Math.round(o.family_cap * 100) + '% of the budget in one family, each started in the first of ' + o.starts + ' weeks that keeps every week under your hours cap.</p></div>' +
      '<div class="inputs">' + field('budget', 'Budget, $', 500) + field('hours', 'Hours a week', 0.5) + field('rate', 'Your time, $/h', 5) + '</div></section>' +
      '<section class="totals big">' + tile(P.picks.length, 'positions', money(P.deposit) + ' deployed') + tile(money(P.fees), 'fees and gas', 'every step, every chain') + tile(money(P.forgone), 'income forgone', Math.round(R.cfg.tbill * 100) + '% a year on the deposits') + tile(hrs(P.minutes), 'hands-on time', 'peak week ' + Math.round(Math.max.apply(0, P.load.concat(0))) + ' of ' + cap + ' min') +
      tile(money(P.slice), 'slice if each launched', 'band ' + money(P.lo) + '&ndash;' + money(P.hi)) + tile(P.slice ? Math.round((P.fees + P.forgone) / P.slice * 100) + '%' : '&ndash;', 'break-even odds', 'share of launches that repays the costs') + '</section>' +
      (P.picks.length ? '' : '<p class="card warn">No position fits: a setup week takes about 70 minutes, so allow at least 1.5 hours a week and $' + o.min_fill + ' per position.</p>') +
      '<div class="pgrid"><div><section class="card"><h3>Positions, in the order the greedy took them</h3><table class="mini"><thead><tr><th>#</th><th>Protocol</th><th class="num">Deposit</th><th>Chain</th><th class="num">Start</th><th class="num">Fees</th><th class="num">Forgone</th><th class="num">Time</th><th class="num">Slice (band)</th><th class="num">Slice / $</th></tr></thead><tbody>' +
      P.picks.map(function (q, i) { return '<tr data-slug="' + esc(q.r.slug) + '"><td>' + (i + 1) + '</td><td><b>' + esc(q.r.name) + '</b> <span class="verdict ' + VCLASS[q.r.plan.verdict] + '">' + q.r.plan.verdict + '</span><small>' + esc(q.r.family) + ' &middot; rank ' + q.r.rank + ' &middot; ' + usd(q.r.implied) + '</small></td><td class="num">' + money(q.deposit) + '</td><td>' + esc(q.r.plan.chain) + '</td><td class="num">wk ' + (q.start + 1) + '</td><td class="num">' + money(q.fees) + '</td><td class="num">' + money(q.forgone) + '</td><td class="num">' + q.minutes + ' min</td><td class="num"><b class="val">' + money(q.slice) + '</b><small>' + money(q.lo) + '&ndash;' + money(q.hi) + '</small></td><td class="num">&times;' + q.score.toFixed(2) + '</td></tr>'; }).join('') + '</tbody></table></section>' +
      '<section class="card"><h3>The combined schedule: which step of each plan falls in which week</h3><table class="cal"><thead><tr><th>Position</th>' + weeks + '</tr></thead><tbody>' +
      P.picks.map(function (q) {
        var cells = P.load.map(function (m, i) { var w = q.weeks[i - q.start]; return !w ? '<td></td>' : '<td class="on' + (w.steps.length ? ' st' : '') + '" title="' + Math.round(w.min) + ' min">' + (w.steps.length ? span(w.steps) : '&middot;') + '</td>'; }).join('');
        return '<tr data-slug="' + esc(q.r.slug) + '"><td>' + esc(q.r.name) + '</td>' + cells + '</tr>';
      }).join('') +
      '<tr class="sum"><td>Minutes that week</td>' + P.load.map(function (m) { return '<td class="num' + (m > cap * 0.8 ? ' hot' : '') + '">' + Math.round(m) + '</td>'; }).join('') + '</tr></tbody></table>' +
      '<p class="mute tiny">Numbers are the plan steps of each protocol\'s detail page (1&ndash;4 setup, 6 midway, 8 withdraw); &middot; is the 5-minute weekly check. The stop rule and the claim fire only on an event.</p></section>' +
      '<section class="card"><h3>Next in line, left out</h3><table class="mini"><thead><tr><th>Protocol</th><th>Verdict</th><th class="num">Slice / $</th><th>Why it is out</th></tr></thead><tbody>' +
      Object.keys(reasons).map(function (k) { return reasons[k].slice(0, 3).map(function (x) { return '<tr data-slug="' + esc(x.r.slug) + '"><td>' + esc(x.r.name) + ' <span class="mute">' + esc(x.r.family) + '</span></td><td><span class="verdict ' + VCLASS[x.r.plan.verdict] + '">' + x.r.plan.verdict + '</span></td><td class="num">&times;' + x.score.toFixed(2) + '</td><td>' + esc(x.why) + ' <span class="mute">(' + reasons[k].length + ' rows)</span></td></tr>'; }).join(''); }).join('') + '</tbody></table></section></div>' +
      '<div><section class="card"><h3>Chosen positions on the radar</h3>' + sweep(hl) + '</section><section class="card"><h3>Budget by family, cap ' + Math.round(o.family_cap * 100) + '%</h3>' +
      M.FAMILIES.map(function (f) { var v = P.families[f] || 0; return '<div class="fbar"><span>' + esc(f) + '</span><i><b style="width:' + (v / o.budget * 400).toFixed(1) + '%"></b></i><em>' + money(v) + '</em></div>'; }).join('') + '<p class="mute tiny">Bar end = the ' + Math.round(o.family_cap * 100) + '% cap, ' + money(o.budget * o.family_cap) + '. Unspent: ' + money(o.budget - P.deposit) + '.</p></section></div></div>';
    wire();
    app.querySelectorAll('[data-in]').forEach(function (el) { el.onchange = function () { var x = {}; x[el.dataset.in] = el.value > 0 ? String(+el.value) : ''; go(x); }; });
  }

  // ---- one protocol
  function timeline(plan) {
    var W = 540, days = plan.weeks * 7, x = function (d) { return 22 + d / days * (W - 50); }, last = -1e9;
    var s = '<svg viewBox="0 0 ' + W + ' 66" class="tl"><line x1="22" x2="' + (W - 28) + '" y1="18" y2="18"/>';
    for (var w = 0; w <= plan.weeks; w++) s += '<text x="' + x(w * 7) + '" y="44">' + (w ? 'wk ' + w : 'day 0') + '</text>';
    plan.steps.forEach(function (st, i) {
      if (st.at === undefined) return;
      var cx = Math.max(x(st.at), last + 18); last = cx;   // steps on near days sit side by side, never on top of each other
      s += '<circle cx="' + cx + '" cy="18" r="8"/><text class="n" x="' + cx + '" y="21.5">' + (i + 1) + '</text>';
    });
    return s + '<text class="stop" x="22" y="62">step ' + (plan.steps.findIndex(function (st) { return /^Stop rule/.test(st.text); }) + 1) + ', any day: exit if TVL closes under ' + money(plan.stop) + '</text></svg>';
  }

  function detail(r) {
    var p = r.plan, f = r.f, mine = P0.picks.filter(function (q) { return q.r === r; })[0];
    var tile = function (v, k, cls) { return '<div class="tile ' + (cls || '') + '"><b>' + v + '</b><span>' + k + '</span></div>'; };
    app.innerHTML = '<a class="back" href="#">&larr; Board</a><div class="dhead"><h1>' + esc(r.name) + '</h1><span class="tag">records no token</span>' + (r.watch ? '<span class="tag watch">watchlist</span>' : '') + '<span class="tag">' + esc(r.category) + '</span><span class="tag">' + esc(r.chains.slice(0, 4).join(' · ')) + '</span></div>' +
      '<div class="dgrid"><section class="card"><div class="hero"><div><span class="mute">Implied value, this model\'s claim</span><b class="big">' + usd(r.implied) + '</b></div>' +
      '<div><span class="mute">Rank &middot; P10&ndash;P90 of refits</span><b>' + r.rank + ' of ' + R.rows.length + ' &middot; ' + r.rlo + '&ndash;' + r.rhi + '</b></div><div><span class="mute">P25&ndash;P75 band</span><b>' + usd(r.lo) + '&ndash;' + usd(r.hi) + '</b></div></div>' +
      '<h3>How the value is built from the snapshot\'s figures</h3><div class="tiles">' + tile(usd(f.size), 'size curve at <b class="k-tvl">' + usd(r.tvl) + ' TVL</b>') + '<i>&times;</i>' + tile(f.tilt.toFixed(2), esc(r.family) + ' tilt, ' + f.peers + ' peers') + '<i>&times;</i>' +
      tile(f.mom.toFixed(2), '<b class="k-g">7-day TVL ' + (r.ch7 === null ? 'n/a' : (r.ch7 >= 0 ? '+' : '') + r.ch7.toFixed(1) + '%') + '</b>') + '<i>&times;</i>' + tile(f.season.toFixed(2), '<b class="k-d">' + (r.age === null ? '365* days' : r.age + ' days') + '</b> with no token') + '<i>=</i>' + tile(usd(r.implied), 'implied value', 'res') + '</div>' +
      '<h3>Nearest traded peers, same family</h3><table class="mini"><thead><tr><th>Token that trades</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">&times; TVL</th><th class="num">Applied here</th></tr></thead><tbody>' +
      r.peers.map(function (q) { return '<tr><td>' + esc(q.name) + (q.symbol ? ' <span class="mute">$' + esc(q.symbol) + '</span>' : '') + '</td><td class="num">' + usd(q.tvl) + '</td><td class="num">' + usd(q.mcap) + '</td><td class="num">' + (q.mcap / q.tvl).toFixed(2) + '&times;</td><td class="num">' + usd(q.mcap / q.tvl * r.tvl) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h3>The farm arithmetic</h3><div class="arith">Slice if a token launches = ' + Math.round(R.cfg.drop_share * 100) + '% airdrop &times; ' + usd(r.implied) + ' &times; ' + money(p.deposit) + ' / ' + usd(r.tvl) + ' TVL = <b>' + money(p.slice) + '</b> (band ' + money(p.slice * r.lo / r.implied) + '&ndash;' + money(p.slice * r.hi / r.implied) + ')<br>Break-even = (' + money(p.fees) + ' fees + ' + money(p.forgone) + ' income forgone at ' + Math.round(R.cfg.tbill * 100) + '% a year for ' + p.weeks + ' weeks) / ' + money(p.slice) + ' = <b>' + Math.round(p.odds * 100) + '%</b>: the chance of a launch, with a snapshot, inside the hold that pays for the plan. At the band\'s ends: ' + Math.round(p.odds_hi * 100) + '% to ' + Math.round(p.odds_lo * 100) + '%.</div>' +
      '<p class="mute">' + (p.odds_lo <= R.cfg.worth ? 'Worth farming even at the band\'s low end.' : p.odds_hi > R.cfg.marginal ? 'A skip even if the value lands at the band\'s high end.' : 'The verdict turns inside the band: size the deposit down or wait for a points page.') + '</p>' +
      '<div class="inplan">' + (mine ? 'In the default <a href="#view=plan">portfolio</a>: ' + money(mine.deposit) + ' from week ' + (mine.start + 1) + ', slice ' + money(mine.slice) + '.' : 'Not in the default <a href="#view=plan">' + money(P0.opt.budget) + ' portfolio</a>' + (p.verdict === 'Skip' ? ': a Skip.' : ': other rows pay more per dollar and hour.')) + '</div></section>' +
      '<section class="card"><div class="plhead"><h3>Farm plan &middot; ' + esc(p.chain) + ' &middot; ' + money(p.deposit) + ' &middot; ' + p.weeks + ' weeks</h3><span class="verdict ' + VCLASS[p.verdict] + '">' + p.verdict + '</span></div>' + timeline(p) +
      '<table class="plan"><thead><tr><th>#</th><th>When</th><th>Step</th><th class="num">Cost</th><th class="num">Time</th></tr></thead><tbody>' +
      p.steps.map(function (s, i) { return '<tr' + (/^Stop rule/.test(s.text) ? ' class="stoprow"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(s.when) + '</td><td>' + esc(s.text) + '</td><td class="num">' + money(s.cost) + '</td><td class="num">' + s.min + ' min</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="totals">' + [[money(p.fees), 'fees and gas'], [money(p.forgone), 'income forgone'], [p.minutes + ' min', 'your time'], [money(p.slice), 'slice if launch'], [Math.round(p.odds * 100) + '%', 'break-even odds'], [money(p.net_hour), 'net per hour']].map(function (t) { return '<div><span>' + t[1] + '</span><b>' + t[0] + '</b></div>'; }).join('') + '</div>' +
      '<ul class="rules"><li>One wallet, your own funds; never split one position across wallets.</li><li>Claim only through the domain bookmarked on day 0.</li><li>A launch is not promised: this is cost arithmetic and the model\'s claim.</li></ul></section></div>';
  }

  function render() {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === S.view && !S.p)); b.onclick = function () { go({ view: b.dataset.view, p: '' }); }; });
    var r = S.p && bySlug[S.p];
    if (r) detail(r); else if (S.view === 'plan') planner(); else board();
    var back = app.querySelector('.back'); if (back) back.onclick = function (e) { e.preventDefault(); go({ p: '' }); };
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () { S = JSON.parse(JSON.stringify(D)); readHash(); render(); });
  readHash();
  render();
})();
