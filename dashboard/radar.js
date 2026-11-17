// Drop Radar page: recomputes the whole board in the browser with model.js (DropRadar.buildRadar on the
// sealed snapshot in ../data.js), checks it against board.json row by row, and renders the board, a
// detail view per protocol and the method. State lives in the URL hash, so every view is linkable.
(function () {
  'use strict';
  var M = window.DropRadar, R = M.buildRadar(window.SNAPSHOT), B = window.BOARD;
  var app = document.getElementById('app'), money = M.money;
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  var usd = function (x) { return x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + Math.round(x / 1e3) + 'K' : '$' + Math.round(x); };
  var pct = function (x) { return x === null ? '<span class="mute">n/a</span>' : '<span class="' + (x >= 0 ? 'up' : 'down') + '">' + (x >= 0 ? '+' : '') + x.toFixed(1) + '%</span>'; };
  var VCLASS = { 'Worth farming': 'v-worth', 'Marginal': 'v-marg', 'Skip': 'v-skip' };

  // board.json = this page: every rank, value and farm plan the page computed against the file main.ts wrote.
  var matched = 0;
  R.rows.forEach(function (r, i) {
    var b = B.rows[i], steps = M.boardRows({ rows: [r] })[0].farm_steps;
    if (b && b.slug === r.slug && b.rank === r.rank && b.implied_value_usd === r.implied && b.farm_steps.join('|') === steps.join('|')) matched++;
  });
  var verified = matched === B.rows.length && matched === R.rows.length;
  document.getElementById('stamp').innerHTML = 'DefiLlama snapshot ' + esc(R.as_of) + ' &middot; model ' + esc(R.cfg.version) +
    ' <span class="check ' + (verified ? 'ok' : 'bad') + '">' + (verified ? '&#10003;' : '&#10007;') + ' page = board.json: ' + matched + '/' + B.rows.length + ' rows</span>';

  var D = { view: 'board', q: '', fam: '', chain: '', scope: 'all', verdict: '', anchors: '', sort: 'implied', dir: -1, p: '' };
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

  // ------------------------------------------------------------ the board
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

  function scatter() {
    var W = 330, H = 170, x0 = 6, x1 = 11, y0 = 3, y1 = 11;
    var px = function (v) { return 30 + (Math.log(v) / Math.LN10 - x0) / (x1 - x0) * (W - 40); };
    var py = function (v) { return H - 20 - (Math.log(v) / Math.LN10 - y0) / (y1 - y0) * (H - 30); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap or implied value against TVL">';
    [7, 8, 9, 10].forEach(function (e) { var x = px(Math.pow(10, e)); s += '<line class="grid" x1="' + x + '" x2="' + x + '" y1="8" y2="' + (H - 20) + '"/><text class="ax" x="' + x + '" y="' + (H - 6) + '">' + usd(Math.pow(10, e)) + '</text>'; });
    [5, 7, 9].forEach(function (e) { var y = py(Math.pow(10, e)); s += '<line class="grid" x1="30" x2="' + (W - 10) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="2" y="' + (y + 3) + '">' + usd(Math.pow(10, e)) + '</text>'; });
    R.traded.forEach(function (p) { s += '<circle class="tr" cx="' + px(p.tvl).toFixed(1) + '" cy="' + py(Math.max(p.mcap, 1e3)).toFixed(1) + '" r="2.2"/>'; });
    R.rows.forEach(function (r) { s += '<rect class="pre" x="' + (px(r.tvl) - 2).toFixed(1) + '" y="' + (py(r.implied) - 2).toFixed(1) + '" width="4" height="4"/>'; });
    var c = R.fit.curve, a = Math.pow(10, x0), b = Math.pow(10, x1), f = function (t) { return Math.pow(10, c.a + c.b * Math.log(t / 1e8) / Math.LN10); };
    s += '<line class="fitl" x1="' + px(a * 10) + '" y1="' + py(f(a * 10)) + '" x2="' + px(b) + '" y2="' + py(f(b)) + '"/></svg>';
    return s + '<div class="legend"><i class="dot-tr"></i> trades (mcap) <i class="dot-pre"></i> records no token, at implied value <i class="dot-fit"></i> fitted size curve</div>';
  }

  function modelCards() {
    var c = R.fit.curve, o = R.oos, best = R.rows.filter(function (r) { return r.watch; }).sort(function (a, b) { return b.plan.net_hour - a.plan.net_hour; }).slice(0, 3);
    return '<section class="cards"><div class="card"><h3>How a value is built <code>buildRadar()</code></h3><ol class="how">' +
      '<li><b>Size curve</b> <code>fitCurve()</code>: log10 value = ' + c.a.toFixed(2) + ' + ' + c.b.toFixed(3) + ' &times; log10(TVL / $100M), least squares on the ' + R.traded.length + ' protocols whose token trades</li>' +
      '<li><b>&times; family tilt</b> <code>fitTilts()</code>: median residual of the family\'s traded peers, shrunk with ' + R.cfg.shrink_k + ' pseudo-peers</li>' +
      '<li><b>&times; momentum</b>: 1 + ' + R.cfg.growth_weight + ' &times; 7-day TVL change, held to ' + R.cfg.growth_lo + '%..+' + R.cfg.growth_hi + '%</li>' +
      '<li><b>&times; seasoning</b>: ' + R.cfg.season_lo + ' + ' + R.cfg.season_span + ' &times; days tracked with no token / ' + R.cfg.season_days + '</li></ol>' +
      '<p class="mute">Band: P25&ndash;P75 of the fit\'s residuals (&times;' + Math.pow(10, R.band[0]).toFixed(2) + ' to &times;' + Math.pow(10, R.band[1]).toFixed(2) + '). Rank range: P10&ndash;P90 over ' + R.cfg.boot + ' seeded refits.</p></div>' +
      '<div class="card chart"><h3>Market cap or implied value vs TVL</h3>' + scatter() + '</div>' +
      '<div class="card"><h3>Out of sample <code>outOfSample()</code></h3><p><b>&times;' + o.median_miss.toFixed(2) + '</b> median miss over ' + o.n + ' traded tokens, each refit without itself, against <b>&times;' + o.flat_miss.toFixed(2) + '</b> for one flat mcap/TVL multiple; <b>' + Math.round(o.within3 * 100) + '%</b> within 3&times;; rank correlation <b>' + o.rank_corr.toFixed(2) + '</b>.</p>' +
      '<h3>Best net per hands-on hour, watchlist</h3><p>' + best.map(function (r) { return '<a href="#p=' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a> ' + money(r.plan.net_hour) + '/h'; }).join(' &middot; ') + '</p></div></section>';
  }

  function chip(k, v, label) { return '<button class="chip" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + (S[k] === v) + '">' + label + '</button>'; }

  var COLS = [['rank', '#', 'num'], ['name', 'Protocol', ''], ['implied', 'Implied value', 'num'], ['band', 'P25&ndash;P75 band', ''], ['tvl', 'TVL', 'num'], ['ch7', '7d TVL', 'num'], ['age', 'Days no token', 'num'], ['odds', 'Break-even odds', 'num'], ['net', 'Net if launch $/h', 'num'], ['verdict', 'Farm verdict', '']];
  var key = { rank: function (r) { return r.rank; }, name: function (r) { return r.name.toLowerCase(); }, implied: function (r) { return r.implied; }, band: function (r) { return r.hi / r.lo; }, tvl: function (r) { return r.tvl; }, ch7: function (r) { return r.ch7 === null ? -1e9 : r.ch7; }, age: function (r) { return r.age === null ? -1 : r.age; }, odds: function (r) { return r.plan.odds; }, net: function (r) { return r.plan.net_hour; }, verdict: function (r) { return r.plan.odds; } };

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

  function bandBar(r) {
    var lg = function (v) { return Math.log(v) / Math.LN10; }, lo = 6, hi = 10;
    var p = function (v) { return Math.max(0, Math.min(100, (lg(v) - lo) / (hi - lo) * 100)); };
    return '<span class="bandbar"><i style="left:' + p(r.lo).toFixed(1) + '%;width:' + (p(r.hi) - p(r.lo)).toFixed(1) + '%"></i><b style="left:' + p(r.implied).toFixed(1) + '%"></b></span>';
  }

  function rowHtml(r) {
    var tags = (r.watch ? '<span class="tag watch">watchlist</span>' : r.above ? '<span class="tag">off list &ge; floor</span>' : '<span class="tag early">early &lt; $50M</span>');
    return '<tr data-slug="' + esc(r.slug) + '"><td class="num"><b>' + r.rank + '</b><small>' + r.rlo + '&ndash;' + r.rhi + '</small></td>' +
      '<td><b>' + esc(r.name) + '</b> ' + tags + '<small>' + esc(r.category) + ' &middot; ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</small></td>' +
      '<td class="num"><b class="val">' + usd(r.implied) + '</b><small>' + usd(r.lo) + '&ndash;' + usd(r.hi) + '</small></td><td>' + bandBar(r) + '</td>' +
      '<td class="num">' + usd(r.tvl) + '</td><td class="num">' + pct(r.ch7) + '</td><td class="num">' + (r.age === null ? '365*' : r.age) + '</td>' +
      '<td class="num">' + Math.min(999, Math.round(r.plan.odds * 100)) + '%</td><td class="num">' + money(r.plan.net_hour) + '<small>' + r.plan.weeks + ' wk &middot; ' + esc(r.plan.chain) + '</small></td>' +
      '<td><span class="verdict ' + VCLASS[r.plan.verdict] + '">' + r.plan.verdict + '</span></td></tr>';
  }

  function board() {
    var rows = filtered(), chains = {};
    R.rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    var famCount = function (f) { return R.rows.filter(function (r) { return r.family === f; }).length; };
    var vCount = function (v) { return R.rows.filter(function (r) { return r.plan.verdict === v; }).length; };
    var anchors = S.anchors ? R.traded.filter(function (p) { return !S.fam || p.fam === S.fam; }).sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, 12) : [];
    app.innerHTML = kpis() + modelCards() +
      '<div class="filters">' + chip('scope', 'all', 'All ' + R.rows.length) + chip('scope', 'watch', 'Watchlist ' + R.watch_n) + chip('scope', 'off', 'Off list &ge; floor') + chip('scope', 'early', 'Early &lt; $50M') +
      '<input type="search" id="q" placeholder="Search a protocol" value="' + esc(S.q) + '">' +
      '<select id="chain"><option value="">All chains</option>' + Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).slice(0, 25).map(function (c) { return '<option' + (S.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<label class="tog"><input type="checkbox" id="anch"' + (S.anchors ? ' checked' : '') + '> traded anchors</label></div>' +
      '<div class="filters">' + chip('fam', '', 'All families') + M.FAMILIES.filter(famCount).map(function (f) { return chip('fam', f, esc(f) + ' ' + famCount(f)); }).join('') +
      '<span class="sep"></span>' + chip('verdict', '', 'Any verdict') + ['Worth farming', 'Marginal', 'Skip'].map(function (v) { return chip('verdict', v, v + ' ' + vCount(v)); }).join('') + '</div>' +
      '<p class="mute count"><b>' + rows.length + '</b> of ' + R.rows.length + ' ranked shown' + (anchors.length ? ' &middot; ' + anchors.length + ' traded anchors' : '') + ' &middot; sorted by ' + COLS.filter(function (c) { return c[0] === S.sort; })[0][1] + '</p>' +
      '<table><thead><tr>' + COLS.map(function (c) { return '<th class="' + c[2] + '" data-sort="' + c[0] + '"' + (S.sort === c[0] ? ' aria-sort="' + (S.dir < 0 ? 'descending' : 'ascending') + '"' : '') + '>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      anchors.map(function (p) { return '<tr class="anchor"><td class="num">&ndash;</td><td>' + esc(p.name) + ' <span class="tag">trades</span><small>' + esc(p.category) + ' &middot; reference, not ranked</small></td><td class="num">' + usd(p.mcap) + '<small>market cap</small></td><td></td><td class="num">' + usd(p.tvl) + '</td><td colspan="5" class="mute">market ' + (p.mcap / p.tvl).toFixed(2) + '&times; TVL &middot; curve says ' + usd(Math.pow(10, R.fit.curve.a + R.fit.curve.b * Math.log(p.tvl / 1e8) / Math.LN10 + R.fit.tilts[p.fam].log)) + '</td></tr>'; }).join('') +
      rows.map(rowHtml).join('') + '</tbody></table>';
    app.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { var o = {}; o[b.dataset.k] = b.dataset.v; go(o); }; });
    app.querySelectorAll('th[data-sort]').forEach(function (th) { th.onclick = function () { var k = th.dataset.sort; go(S.sort === k ? { dir: -S.dir } : { sort: k, dir: k === 'rank' || k === 'name' || k === 'odds' ? 1 : -1 }); }; });
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) { tr.onclick = function () { go({ p: tr.dataset.slug }); }; });
    var q = app.querySelector('#q'), t = 0;
    q.oninput = function () { clearTimeout(t); t = setTimeout(function () { go({ q: q.value }); var n = app.querySelector('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 150); };
    app.querySelector('#chain').onchange = function (e) { go({ chain: e.target.value }); };
    app.querySelector('#anch').onchange = function (e) { go({ anchors: e.target.checked ? '1' : '' }); };
  }

  // ------------------------------------------------------------ one protocol
  function timeline(plan) {
    var W = 540, days = plan.weeks * 7, x = function (d) { return 22 + d / days * (W - 50); }, last = -1e9;
    var s = '<svg viewBox="0 0 ' + W + ' 66" class="tl"><line x1="22" x2="' + (W - 28) + '" y1="18" y2="18"/>';
    for (var w = 0; w <= plan.weeks; w++) s += '<text x="' + x(w * 7) + '" y="44">' + (w ? 'wk ' + w : 'day 0') + '</text>';
    plan.steps.forEach(function (st, i) {
      var m = /day (\d+)/.exec(st.when), d = m ? +m[1] : null;
      if (d === null) return;
      var cx = Math.max(x(d), last + 18); last = cx;   // steps on near days sit side by side, never on top of each other
      s += '<circle cx="' + cx + '" cy="18" r="8"/><text class="n" x="' + cx + '" y="21.5">' + (i + 1) + '</text>';
    });
    return s + '<text class="stop" x="22" y="62">step ' + (plan.steps.findIndex(function (st) { return /^Stop rule/.test(st.text); }) + 1) + ', any day: exit if TVL closes under ' + money(plan.stop) + '</text></svg>';
  }

  function detail(r) {
    var p = r.plan, f = r.f;
    var tile = function (v, k, cls) { return '<div class="tile ' + (cls || '') + '"><b>' + v + '</b><span>' + k + '</span></div>'; };
    app.innerHTML = '<a class="back" href="#">&larr; Board</a><div class="dhead"><h1>' + esc(r.name) + '</h1><span class="tag">records no token</span>' + (r.watch ? '<span class="tag watch">watchlist</span>' : '') + '<span class="tag">' + esc(r.category) + '</span><span class="tag">' + esc(r.chains.slice(0, 4).join(' \u00b7 ')) + '</span></div>' +
      '<div class="dgrid"><section class="card"><div class="hero"><div><span class="mute">Implied value, this model\'s claim</span><b class="big">' + usd(r.implied) + '</b></div>' +
      '<div><span class="mute">Rank &middot; P10&ndash;P90 of refits</span><b>' + r.rank + ' of ' + R.rows.length + ' &middot; ' + r.rlo + '&ndash;' + r.rhi + '</b></div><div><span class="mute">P25&ndash;P75 band</span><b>' + usd(r.lo) + '&ndash;' + usd(r.hi) + '</b></div></div>' +
      '<h3>How the value is built</h3><div class="tiles">' + tile(usd(f.size), 'size curve at ' + usd(r.tvl) + ' TVL') + '<i>&times;</i>' + tile(f.tilt.toFixed(2), esc(r.family) + ' tilt, ' + f.peers + ' peers') + '<i>&times;</i>' +
      tile(f.mom.toFixed(2), '7-day TVL ' + (r.ch7 === null ? 'n/a' : (r.ch7 >= 0 ? '+' : '') + r.ch7.toFixed(1) + '%')) + '<i>&times;</i>' + tile(f.season.toFixed(2), (r.age === null ? '365* days' : r.age + ' days') + ' tracked') + '<i>=</i>' + tile(usd(r.implied), 'implied value', 'res') + '</div>' +
      '<h3>Nearest traded peers, same family</h3><table class="mini"><thead><tr><th>Token that trades</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">&times; TVL</th><th class="num">Applied here</th></tr></thead><tbody>' +
      r.peers.map(function (q) { return '<tr><td>' + esc(q.name) + (q.symbol ? ' <span class="mute">$' + esc(q.symbol) + '</span>' : '') + '</td><td class="num">' + usd(q.tvl) + '</td><td class="num">' + usd(q.mcap) + '</td><td class="num">' + (q.mcap / q.tvl).toFixed(2) + '&times;</td><td class="num">' + usd(q.mcap / q.tvl * r.tvl) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h3>The farm arithmetic</h3><div class="arith">Slice if a token launches = ' + Math.round(R.cfg.drop_share * 100) + '% airdrop &times; ' + usd(r.implied) + ' &times; ' + money(p.deposit) + ' / ' + usd(r.tvl) + ' TVL = <b>' + money(p.slice) + '</b><br>Break-even = (' + money(p.fees) + ' fees + ' + money(p.forgone) + ' income forgone at ' + Math.round(R.cfg.tbill * 100) + '% a year for ' + p.weeks + ' weeks) / ' + money(p.slice) + ' = <b>' + Math.round(p.odds * 100) + '%</b>: the chance of a launch, with a snapshot, inside the hold that pays for the plan.</div>' +
      '<h3>How hard the verdict leans on the estimate</h3><table class="mini"><thead><tr><th>Implied value at</th><th class="num">Value</th><th class="num">Slice</th><th class="num">Break-even odds</th></tr></thead><tbody>' +
      [['band low (P25)', r.lo, p.odds_lo], ['point estimate', r.implied, p.odds], ['band high (P75)', r.hi, p.odds_hi]].map(function (b) { return '<tr><td>' + b[0] + '</td><td class="num">' + usd(b[1]) + '</td><td class="num">' + money(p.slice * b[1] / r.implied) + '</td><td class="num">' + Math.round(b[2] * 100) + '%</td></tr>'; }).join('') +
      '</tbody></table><p class="mute">' + (p.odds_lo <= R.cfg.worth ? 'Worth farming even at the band\'s low end.' : p.odds_hi > R.cfg.marginal ? 'A skip even if the value lands at the band\'s high end.' : 'The verdict turns inside the band: size the deposit down or wait for a points page.') + '</p></section>' +
      '<section class="card"><div class="plhead"><h3>Farm plan &middot; ' + esc(p.chain) + ' &middot; ' + money(p.deposit) + ' &middot; ' + p.weeks + ' weeks</h3><span class="verdict ' + VCLASS[p.verdict] + '">' + p.verdict + '</span></div>' + timeline(p) +
      '<table class="plan"><thead><tr><th>#</th><th>When</th><th>Step</th><th class="num">Cost</th><th class="num">Time</th></tr></thead><tbody>' +
      p.steps.map(function (s, i) { return '<tr' + (/^Stop rule/.test(s.text) ? ' class="stoprow"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(s.when) + '</td><td>' + esc(s.text) + '</td><td class="num">' + money(s.cost) + '</td><td class="num">' + s.min + ' min</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="totals">' + [[money(p.fees), 'fees and gas'], [money(p.forgone), 'income forgone'], [p.minutes + ' min', 'your time'], [money(p.slice), 'slice if launch'], [Math.round(p.odds * 100) + '%', 'break-even odds'], [money(p.net_hour), 'net per hour']].map(function (t) { return '<div><span>' + t[1] + '</span><b>' + t[0] + '</b></div>'; }).join('') + '</div>' +
      '<ul class="rules"><li>One wallet, your own funds; never split one position across wallets.</li><li>Claim only through the domain bookmarked on day 0.</li><li>A launch is not promised: this is cost arithmetic and the model\'s claim.</li></ul></section></div>';
  }

  // ------------------------------------------------------------ method
  function method() {
    var o = R.oos, t = R.fit.tilts;
    app.innerHTML = '<section class="cards two"><div class="card"><h3>Model ' + esc(R.cfg.version) + ': one function, every row</h3>' +
      '<p>The page you are reading ran <code>DropRadar.buildRadar()</code> from model.js on the sealed snapshot and matched board.json row by row (' + matched + '/' + B.rows.length + '). No protocol name appears in the model.</p>' +
      '<p><b>Anchors.</b> The ' + R.traded.length + ' snapshot protocols with a market cap price the curve and are never ranked. Below the floor, the house rule (all but the TVL floor) sets aside ' + R.set_aside + ' wrapped, staked, bridged and exchange products.</p>' +
      '<p><b>Out of sample.</b> Each traded token is refit without itself: median miss &times;' + o.median_miss.toFixed(2) + ' vs &times;' + o.flat_miss.toFixed(2) + ' for one flat multiple; ' + Math.round(o.within3 * 100) + '% within 3&times;; Spearman ' + o.rank_corr.toFixed(2) + '.</p>' +
      '<p><b>Farm verdict.</b> Worth farming when break-even odds &le; ' + Math.round(R.cfg.worth * 100) + '%, Marginal &le; ' + Math.round(R.cfg.marginal * 100) + '%, else Skip. Costs: a per-chain gas table, $1 per bridge leg, ' + Math.round(R.cfg.tbill * 100) + '% a year forgone; deposit $2,000 ($1,000 under $20M TVL).</p></div>' +
      '<div class="card"><h3>Family tilts <code>fitTilts()</code></h3><table class="mini"><thead><tr><th>Family</th><th class="num">Traded peers</th><th class="num">Tilt</th><th class="num">Ranked</th></tr></thead><tbody>' +
      M.FAMILIES.map(function (fm) { return '<tr><td>' + esc(fm) + '</td><td class="num">' + t[fm].peers + '</td><td class="num">&times;' + Math.pow(10, t[fm].log).toFixed(2) + '</td><td class="num">' + R.rows.filter(function (r) { return r.family === fm; }).length + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
  }

  function render() {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === S.view && !S.p)); b.onclick = function () { go({ view: b.dataset.view, p: '' }); }; });
    var r = S.p && R.rows.filter(function (x) { return x.slug === S.p; })[0];
    if (r) detail(r); else if (S.view === 'method') method(); else board();
    var back = app.querySelector('.back'); if (back) back.onclick = function (e) { e.preventDefault(); go({ p: '' }); };
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () { S = JSON.parse(JSON.stringify(D)); readHash(); render(); });
  readHash();
  render();
})();
