// Drop Radar page: reruns model.js on the sealed snapshot (../data.js), checks it against board.json row by row,
// and renders the board with its protocol accounting and radar sweep, and a detail view per protocol. State: the URL hash.
(function () {
  'use strict';
  var M = window.DropRadar, R = M.buildRadar(window.SNAPSHOT), B = window.BOARD;
  var app = document.getElementById('app'), money = M.money, L = function (v) { return Math.log(v) / Math.LN10; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  var usd = function (x) { return x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + Math.round(x / 1e3) + 'K' : '$' + Math.round(x); };
  var pct = function (x) { return x === null ? '<span class="mute">n/a</span>' : '<span class="' + (x >= 0 ? 'up' : 'down') + '">' + (x >= 0 ? '+' : '') + x.toFixed(1) + '%</span>'; };
  var VCLASS = { 'Worth farming': 'v-worth', 'Marginal': 'v-marg', 'Skip': 'v-skip' };
  var bySlug = {}; R.rows.forEach(function (r) { bySlug[r.slug] = r; });

  // board.json = this page: every rank, value and farm plan, against the file main.ts wrote.
  var matched = 0;
  R.rows.forEach(function (r, i) {
    var b = B.rows[i], steps = M.boardRows({ rows: [r] })[0].farm_steps;
    if (b && b.slug === r.slug && b.rank === r.rank && b.implied_value_usd === r.implied && b.farm_steps.join('|') === steps.join('|')) matched++;
  });
  var verified = matched === B.rows.length && matched === R.rows.length;
  document.getElementById('stamp').innerHTML = 'DefiLlama snapshot ' + esc(R.as_of) + ' &middot; model ' + esc(R.cfg.version) +
    ' <span class="check ' + (verified ? 'ok' : 'bad') + '">' + (verified ? '&#10003;' : '&#10007;') + ' page = board.json: ' + matched + '/' + B.rows.length + ' rows</span>';

  var D = { q: '', fam: '', chain: '', scope: 'all', verdict: '', sort: 'implied', dir: -1, p: '' };
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
    var p = R.price[R.pk].test, p0 = R.price[0].test, o = R.oddsTests.filter(function (s) { return s.kept; }).pop().test, o0 = R.oddsTests[0].test;
    return '<section class="kpis">' + [
      [w + '/' + R.watch_n, 'watchlist ranked, every slug'],
      [R.rows.length, 'ranked: record no token, not a product of one that trades'],
      ['&times;' + p.first.miss.toFixed(2) + ' &middot; &times;' + p.walk.miss.toFixed(2), 'price miss, one out &middot; older&rarr;newer (flat &times;' + p0.first.miss.toFixed(2) + ' &middot; &times;' + p0.walk.miss.toFixed(2) + ')'],
      [o.first.brier.toFixed(3) + ' &middot; ' + o.walk.brier.toFixed(3), 'odds Brier, ten folds &middot; older&rarr;newer (base rate ' + o0.first.brier.toFixed(3) + ' &middot; ' + o0.walk.brier.toFixed(3) + ')'],
      [Math.round(R.cover[0].walk * 100) + '% &middot; ' + Math.round(R.cover[1].walk * 100) + '%', 'newer caps inside the printed P25&ndash;P75 &middot; P10&ndash;P90 (stated 50% &middot; 80%)'],
      [worth, 'worth farming: odds beat break-even at the low price'],
    ].map(function (k) { return '<div><b>' + k[0] + '</b><span>' + k[1] + '</span></div>'; }).join('') + '</section>';
  }

  // Every snapshot protocol in exactly one group, and the checks this page reruns against board.json.
  var LCOL = ['#3fe0c0', '#2aa98f', '#1b6f61', '#ffb547', '#8a6a3a', '#ff6f86', '#a28dff', '#7d6bd1', '#5b5a9e', '#6f7d96', '#3a4660'];
  function ledger() {
    var g = R.ledger, keys = M.LEDGER.filter(function (k) { return g[k]; }), n = keys.reduce(function (s, k) { return s + g[k]; }, 0);
    var sum = function (a, f) { return a.reduce(function (s, r) { return s + r[f]; }, 0); }, w = R.rows.filter(function (r) { return r.watch; }).length;
    var desc = R.rows.every(function (r, i) { return r.rank === i + 1 && (!i || r.implied <= R.rows[i - 1].implied); });
    var col = function (k) { return LCOL[M.LEDGER.indexOf(k)]; };
    var chk = [[verified, 'this table = board.json: ' + matched + ' of ' + B.rows.length + ' rows recomputed here'], [desc, 'ranks 1&ndash;' + R.rows.length + ' in order, values never rise'],
      [sum(R.rows, 'implied') === sum(B.rows, 'implied_value_usd'), 'totals equal: ' + usd(sum(R.rows, 'implied'))], [w === R.watch_n, 'watchlist ' + w + ' of ' + R.watch_n + ' ranked'], [n === R.universe, 'ledger ' + n + ' of ' + R.universe + ' protocols']];
    return '<section class="card ledger"><div class="plhead"><h3>Protocol accounting <code>buildRadar()</code></h3><span class="mute tiny">all ' + R.universe + ' snapshot protocols, each in exactly one group</span></div><div class="lbar">' +
      keys.map(function (k) { return '<i style="flex:' + g[k] + ';background:' + col(k) + '" title="' + esc(k) + ': ' + g[k] + '"></i>'; }).join('') + '</div><div class="lkey">' +
      keys.map(function (k) { return '<span><i style="background:' + col(k) + '"></i>' + esc(k) + ' <b>' + g[k] + '</b></span>'; }).join('') + '</div><div class="lkey">' +
      chk.map(function (c) { return '<span class="check ' + (c[0] ? 'ok' : 'bad') + '">' + (c[0] ? '&#10003; ' : '&#10007; ') + c[1] + '</span>'; }).join('') + '</div></section>';
  }

  // Every term of both fits, in the order it was tried, with its two held-out scores and whether it stayed.
  function howCard() {
    var c = R.fit.curve, b = R.om.b, n = R.price[0].test.n_walk;
    var tr = function (s, i, a, z) { return '<tr' + (s.kept ? ' class="kept"' : '') + '><td>' + esc(s.name) + '</td><td class="num">' + a + '</td><td class="num">' + z + '</td><td>' + (s.kept ? 'kept' : i ? 'tested, not kept' : 'baseline') + '</td></tr>'; };
    var head = function (x, y) { return '<table class="mini tests"><thead><tr><th>Term, added in order</th><th class="num">' + x + '</th><th class="num">' + y + '</th><th></th></tr></thead><tbody>'; };
    return '<section class="card"><h3>Every term tested on rows it never saw <code>heldOut()</code></h3>' +
      '<p class="mute tiny">A term stays only if it lowers the miss in both tests: one left out, and later listings scored by a fit on earlier ones (' + n + ' traded, ' + R.dated + ' dated rows).</p>' +
      '<h4>Price if a token launches &middot; median miss, ' + R.traded.length + ' traded tokens</h4>' + head('One out', 'Older&rarr;newer') +
      R.price.map(function (s, i) { return tr(s, i, '&times;' + s.test.first.miss.toFixed(2), '&times;' + s.test.walk.miss.toFixed(2)); }).join('') + '</tbody></table>' +
      '<h4>Token odds &middot; Brier score (share called right), ' + R.dated + ' protocols, ' + Math.round(R.share * 100) + '% record a token</h4>' + head('Ten folds', 'Older&rarr;newer') +
      R.oddsTests.map(function (s, i) { return tr(s, i, s.test.first.brier.toFixed(3) + ' (' + Math.round(s.test.first.hit * 100) + '%)', s.test.walk.brier.toFixed(3) + ' (' + Math.round(s.test.walk.hit * 100) + '%)'); }).join('') + '</tbody></table>' +
      '<p class="mute tiny"><b class="k-tvl">Price</b> <code>fitCurve()</code>: log10 cap = ' + c.a.toFixed(2) + ' + ' + c.b.toFixed(3) + ' &times; log10(TVL / $100M). <b class="k-d">Odds</b> <code>fitOdds()</code>, logit per unit: years tracked ' + b[1].toFixed(2) + ', log10 TVL ' + b[2].toFixed(2) + ', 10 pts of 7-day growth ' + b[3].toFixed(2) + ', families ' + Math.min.apply(0, b.slice(4)).toFixed(2) + '&ndash;' + Math.max.apply(0, b.slice(4)).toFixed(2) +
      '. <code>tokenOdds()</code> = share of like peers recording a token by ' + R.ceiling.toFixed(1) + ' years, among those that had not by its age. Band: P25&ndash;P75 of held-out misses; rank range: P10&ndash;P90 of ' + R.cfg.boot + ' refits.</p></section>';
  }

  function chip(k, v, label) { return '<button class="chip" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + (S[k] === v) + '">' + label + '</button>'; }

  var COLS = [['rank', '#', 'num'], ['name', 'Protocol', ''], ['implied', 'Implied value', 'num'], ['tvl', 'TVL &rarr; launch', 'num k-tvl'], ['ch7', '7-day', 'num k-g'], ['age', 'Days', 'num k-g'], ['q', 'Token odds', 'num k-d'], ['odds', 'Break-even', 'num'], ['verdict', 'Farm verdict', '']];
  var key = { rank: function (r) { return r.rank; }, name: function (r) { return r.name.toLowerCase(); }, implied: function (r) { return r.implied; }, tvl: function (r) { return r.tvl; }, ch7: function (r) { return r.ch7 === null ? -1e9 : r.ch7; }, age: function (r) { return r.age === null ? -1 : r.age; }, q: function (r) { return r.odds; }, odds: function (r) { return r.plan.odds; }, verdict: function (r) { return r.plan.odds; } };

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
    var tags = (r.watch ? '<span class="tag watch">watchlist</span>' : r.above ? '<span class="tag">&ge; floor</span>' : '<span class="tag early">early</span>') + (r.sib ? '<span class="tag">$' + esc(r.sib) + ' trades</span>' : ''), f = r.f;
    return '<tr data-slug="' + esc(r.slug) + '"><td class="num"><b>' + r.rank + '</b><small>' + r.rlo + '&ndash;' + r.rhi + '</small></td>' +
      '<td><b>' + esc(r.name) + '</b> ' + tags + '<small>' + esc(r.category) + ' &middot; ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</small></td>' +
      '<td class="num"><b class="val">' + usd(r.implied) + '</b><small>' + usd(r.lo) + '&ndash;' + usd(r.hi) + '</small></td>' +
      fx(usd(r.tvl), usd(r.launch), (L(r.tvl) - 6.6) / 2.9 * 100, 'k-tvl') + '<td class="num">' + pct(r.ch7) + '</td><td class="num">' + (r.age === null ? 'n/a*' : r.age) + '</td>' +
      fx(Math.round(r.odds * 100) + '%', 'peers ' + Math.round(f.now * 100) + '&rarr;' + Math.round(f.end * 100) + '%', r.odds * 100, 'k-d') +
      '<td class="num">' + Math.min(999, Math.round(r.plan.odds * 100)) + '%<small>' + money(r.plan.net_hour) + '/h</small></td>' +
      '<td><span class="verdict ' + VCLASS[r.plan.verdict] + '">' + r.plan.verdict + '</span></td></tr>';
  }

  function board() {
    var rows = filtered(), chains = {};
    R.rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    var famCount = function (f) { return R.rows.filter(function (r) { return r.family === f; }).length; };
    var vCount = function (v) { return R.rows.filter(function (r) { return r.plan.verdict === v; }).length; };
    app.innerHTML = kpis() + ledger() + '<div class="hgrid"><div class="lcol"><section class="card"><div class="plhead"><h3>Radar &middot; ' + R.rows.length + ' protocols that record no token</h3><span class="mute tiny">click a dot for its plan, a sector to filter</span></div>' + sweep() + '</section>' + howCard() + '</div>' +
      '<div class="rcol"><div class="formula">implied value = <b class="k-tvl">price if it launches(TVL)</b> &times; <b class="k-d">token odds(days with no token, TVL, 7-day growth, family)</b><span>price fitted on the ' + R.traded.length + ' tokens that already trade (never ranked); odds on the token record of ' + R.dated + ' dated protocols</span></div>' +
      '<div class="filters">' + chip('scope', 'all', 'All ' + R.rows.length) + chip('scope', 'watch', 'Watchlist ' + R.watch_n) + chip('scope', 'off', 'Off list &ge; floor') + chip('scope', 'early', 'Early &lt; $50M') +
      '<input type="search" id="q" placeholder="Search a protocol" value="' + esc(S.q) + '"></div>' +
      '<div class="filters"><select id="fam"><option value="">All families</option>' + M.FAMILIES.filter(famCount).map(function (f) { return '<option value="' + esc(f) + '"' + (S.fam === f ? ' selected' : '') + '>' + esc(f) + ' (' + famCount(f) + ')</option>'; }).join('') + '</select>' +
      '<select id="chain"><option value="">All chains</option>' + Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).slice(0, 25).map(function (c) { return '<option' + (S.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      chip('verdict', '', 'Any verdict') + ['Worth farming', 'Marginal', 'Skip'].map(function (v) { return chip('verdict', v, v + ' ' + vCount(v)); }).join('') +
      '</div>' +
      '<p class="mute count"><b>' + rows.length + '</b> of ' + R.rows.length + ' ranked shown' + (S.fam ? ' &middot; ' + esc(S.fam) : '') + ' &middot; sorted by ' + COLS.filter(function (c) { return c[0] === S.sort; })[0][1] + ' &middot; click a header to sort</p>' +
      '<table class="board"><thead><tr class="grp"><th colspan="3"></th><th colspan="4">the snapshot\'s own figures &rarr; price &times; odds</th><th colspan="2">farm</th></tr><tr>' + COLS.map(function (c) { return '<th class="' + c[2] + '" data-sort="' + c[0] + '"' + (S.sort === c[0] ? ' aria-sort="' + (S.dir < 0 ? 'descending' : 'ascending') + '"' : '') + '>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(rowHtml).join('') + '</tbody></table></div></div>';
    wire();
    app.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { var o = {}; o[b.dataset.k] = b.dataset.v; go(o); }; });
    app.querySelectorAll('th[data-sort]').forEach(function (th) { th.onclick = function () { var k = th.dataset.sort; go(S.sort === k ? { dir: -S.dir } : { sort: k, dir: k === 'rank' || k === 'name' || k === 'odds' ? 1 : -1 }); }; });
    var q = app.querySelector('#q'), t = 0;
    q.oninput = function () { clearTimeout(t); t = setTimeout(function () { go({ q: q.value }); var n = app.querySelector('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 150); };
    app.querySelector('#fam').onchange = function (e) { go({ fam: e.target.value }); };
    app.querySelector('#chain').onchange = function (e) { go({ chain: e.target.value }); };
  }

  // ---- one protocol
  function detail(r) {
    var p = r.plan, f = r.f;
    var tile = function (v, k, cls) { return '<div class="tile ' + (cls || '') + '"><b>' + v + '</b><span>' + k + '</span></div>'; };
    app.innerHTML = '<a class="back" href="#">&larr; Board</a><div class="dhead"><h1>' + esc(r.name) + '</h1><span class="tag">records no token</span>' + (r.watch ? '<span class="tag watch">watchlist</span>' : '') + (r.sib ? '<span class="tag">its brand\'s $' + esc(r.sib) + ' trades</span>' : '') + '<span class="tag">' + esc(r.category) + '</span><span class="tag">' + esc(r.chains.slice(0, 4).join(' · ')) + '</span></div>' +
      '<div class="dgrid"><section class="card"><div class="hero"><div><span class="mute">Implied value, this model\'s claim</span><b class="big">' + usd(r.implied) + '</b></div>' +
      '<div><span class="mute">Rank &middot; P10&ndash;P90 of refits</span><b>' + r.rank + ' of ' + R.rows.length + ' &middot; ' + r.rlo + '&ndash;' + r.rhi + '</b></div><div><span class="mute">P25&ndash;P75 band</span><b>' + usd(r.lo) + '&ndash;' + usd(r.hi) + '</b></div></div>' +
      '<h3>How the value is built from the snapshot\'s figures</h3><div class="tiles">' + tile(usd(r.launch), 'if it launches: size curve at <b class="k-tvl">' + usd(r.tvl) + ' TVL</b>') + '<i>&times;</i>' +
      tile(Math.round(r.odds * 100) + '%', '<b class="k-d">token odds</b>' + (r.age === null ? 'age n/a*' : r.age + ' days') + ' with no token, 7-day ' + (r.ch7 === null ? 'n/a' : (r.ch7 >= 0 ? '+' : '') + r.ch7.toFixed(1) + '%')) + '<i>=</i>' + tile(usd(r.implied), 'implied value', 'res') + '</div>' +
      '<p class="mute tiny">Odds: peers like it (same TVL, growth, family) record a token ' + Math.round(f.now * 100) + '% of the time by its age and ' + Math.round(f.end * 100) + '% by ' + R.ceiling.toFixed(1) + ' years, so (' + Math.round(f.end * 100) + ' &minus; ' + Math.round(f.now * 100) + ') / (100 &minus; ' + Math.round(f.now * 100) + ') = ' + Math.round(r.odds * 100) + '% of the ones still without one get there. The peers\' record, not a forecast.</p>' +
      '<h3>The farm arithmetic</h3><div class="arith">Drop if a token launches = ' + Math.round(R.cfg.drop_share * 100) + '% airdrop &times; ' + usd(r.launch) + ' &times; ' + money(p.deposit) + ' / (' + usd(r.tvl) + ' TVL + ' + money(p.deposit) + ') = <b>' + money(p.launch) + '</b>; expected drop = &times; ' + Math.round(r.odds * 100) + '% odds = <b>' + money(p.slice) + '</b><br>Break-even = (' + money(p.fees) + ' fees + ' + money(p.forgone) + ' income forgone at ' + Math.round(R.cfg.tbill * 100) + '% a year for ' + p.weeks + ' weeks) / ' + money(p.launch) + ' = <b>' + Math.round(p.odds * 100) + '%</b> odds, against the model\'s <b>' + Math.round(r.odds * 100) + '%</b>. With the price at the band\'s ends: ' + Math.round(p.odds_hi * 100) + '% to ' + Math.round(p.odds_lo * 100) + '%.</div>' +
      '<p class="mute">' + (r.odds >= p.odds_lo ? 'Worth farming: the odds clear the break-even even at the band\'s low price.' : r.odds < p.odds ? 'A skip: the odds sit below the break-even at the point price.' : 'Marginal: the odds clear the break-even only above the band\'s low price; size the deposit down or wait for a points page.') + '</p>' +
      '</section>' +
      '<section class="card"><div class="plhead"><h3>Farm plan &middot; ' + esc(p.chain) + ' &middot; ' + money(p.deposit) + ' &middot; ' + p.weeks + ' weeks</h3><span class="verdict ' + VCLASS[p.verdict] + '">' + p.verdict + '</span></div>' + '<p class="stopline">Stop rule, any day: exit if TVL closes under ' + money(p.stop) + '</p>' +
      '<table class="plan"><thead><tr><th>#</th><th>When</th><th>Step</th><th class="num">Cost</th><th class="num">Time</th></tr></thead><tbody>' +
      p.steps.map(function (s, i) { return '<tr' + (/^Stop rule/.test(s.text) ? ' class="stoprow"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(s.when) + '</td><td>' + esc(s.text) + '</td><td class="num">' + money(s.cost) + '</td><td class="num">' + s.min + ' min</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="totals">' + [[money(p.fees), 'fees and gas'], [money(p.forgone), 'income forgone'], [p.minutes + ' min', 'your time'], [money(p.launch), 'drop if it launches'], [money(p.slice), 'expected drop'], [Math.round(p.odds * 100) + '%', 'break-even odds'], [money(p.net_hour), 'net per hour']].map(function (t) { return '<div><span>' + t[1] + '</span><b>' + t[0] + '</b></div>'; }).join('') + '</div>' +
      '</section></div>';
  }

  function render() {
    var r = S.p && bySlug[S.p];
    if (r) detail(r); else board();
    var back = app.querySelector('.back'); if (back) back.onclick = function (e) { e.preventDefault(); go({ p: '' }); };
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () { S = JSON.parse(JSON.stringify(D)); readHash(); render(); });
  readHash();
  render();
})();
