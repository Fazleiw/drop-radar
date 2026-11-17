// Drop Radar dashboard: reads window.RADAR (written by main.ts into ../data.js), no network, no framework.
// State lives in the URL hash (view, search, category, chain, scope, confidence, sort, open protocol),
// so every view is linkable and the screenshots are the page's own renders of a hash.
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  var detail = document.getElementById('detail');
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };

  function usd(x) {
    if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
    if (x >= 1e3) return '$' + Math.round(x / 1e3) + 'K';
    return '$' + Number(x).toFixed(2);
  }
  function pct(x) { return x === null ? '<span class="note">n/a</span>' : '<span class="' + (x >= 0 ? 'up' : 'down') + '">' + (x >= 0 ? '+' : '') + x.toFixed(1) + '%</span>'; }

  var state = { view: 'board', q: '', cat: '', chain: '', scope: 'all', conf: '', sort: 'implied', dir: -1, p: '' };
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    h.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
      var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
      if (k in state) state[k] = k === 'dir' ? Number(v) || -1 : v;
    });
  }
  function writeHash() {
    var parts = [];
    Object.keys(state).forEach(function (k) {
      var d = { view: 'board', q: '', cat: '', chain: '', scope: 'all', conf: '', sort: 'implied', dir: -1, p: '' }[k];
      if (state[k] !== d) parts.push(k + '=' + encodeURIComponent(state[k]));
    });
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname);
  }

  // ------------------------------------------------------------ summary strip
  function kpis() {
    var rows = R.rows;
    var watch = rows.filter(function (r) { return r.watch; }).length;
    var total = rows.reduce(function (a, r) { return a + r.implied; }, 0);
    var best = rows.slice().sort(function (a, b) { return b.per1k - a.per1k; })[0];
    var hi = rows.filter(function (r) { return r.conf === 'high'; }).length;
    document.getElementById('kpis').innerHTML = [
      ['Ranked pre-token', rows.length, watch + ' watchlist + ' + (rows.length - watch) + ' below the floor'],
      ['Implied FDV, all rows', usd(total), 'if each launched at its peers\' multiple'],
      ['Trading peer set', R.live_count, 'market median ' + R.market_median + 'x TVL'],
      ['Best drop per $1K', best ? usd(best.per1k) : '-', best ? esc(best.name) + ' (' + best.conf + ' confidence)' : ''],
      ['High-confidence rows', hi, '5+ trading peers and a known age'],
    ].map(function (k) { return '<div class="kpi"><div class="k">' + k[0] + '</div><div class="v">' + k[1] + '</div><div class="s">' + k[2] + '</div></div>'; }).join('');
    document.getElementById('foot').textContent = 'Snapshot ' + R.as_of + ' \u00b7 ' + R.source + ' \u00b7 model ' + R.model.version + ' \u00b7 an implied value is this board\'s own claim, not a forecast that a token will launch. A protocol records no token in DefiLlama; it may still have one.';
  }

  // ------------------------------------------------------------ board
  var COLS = [
    ['rank', 'Rank', 'num'], ['name', 'Protocol', ''], ['tvl', 'TVL', 'num'], ['ch7', '7d', 'num'], ['age', 'No-token days', 'num'],
    ['multiple', 'Peer x', 'num'], ['implied', 'Implied FDV', 'num'], ['per1k', 'Drop / $1K', 'num'], ['conf', 'Confidence', ''],
  ];
  var CONF_ORDER = { high: 3, medium: 2, low: 1 };

  function filtered() {
    var q = state.q.toLowerCase();
    return R.rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + r.category).toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.scope === 'watch' && !r.watch) return false;
      if (state.scope === 'early' && r.watch) return false;
      if (state.conf && r.conf !== state.conf) return false;
      return true;
    }).sort(function (a, b) {
      var k = state.sort, x = a[k], y = b[k];
      if (k === 'conf') { x = CONF_ORDER[x]; y = CONF_ORDER[y]; }
      if (k === 'name') return state.dir * String(x).localeCompare(String(y));
      if (x === null) return 1; if (y === null) return -1;
      return state.dir * (x - y) || a.rank - b.rank;
    });
  }

  function options(values, current, all) {
    return '<option value="">' + all + '</option>' + values.map(function (v) { return '<option' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }

  function board() {
    var cats = {}, chains = {};
    R.rows.forEach(function (r) { cats[r.category] = 1; r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    var chainList = Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).slice(0, 30);
    var rows = filtered();
    var maxV = R.rows[0].implied;
    var chip = function (k, v, label) { return '<button class="chip" data-k="' + k + '" data-v="' + v + '" aria-pressed="' + (state[k] === v) + '">' + label + '</button>'; };
    app.innerHTML =
      '<div class="filters">' +
      '<input type="search" id="q" placeholder="Search protocol or category" value="' + esc(state.q) + '">' +
      '<select id="cat" aria-label="Category">' + options(Object.keys(cats).sort(), state.cat, 'All categories') + '</select>' +
      '<select id="chain" aria-label="Chain">' + options(chainList, state.chain, 'All chains') + '</select>' +
      chip('scope', 'all', 'All') + chip('scope', 'watch', 'Watchlist') + chip('scope', 'early', 'Below the floor') +
      chip('conf', '', 'Any confidence') + chip('conf', 'high', 'High only') +
      '<span class="count">' + rows.length + ' of ' + R.rows.length + ' rows</span></div>' +
      '<table><thead><tr>' + COLS.map(function (c) {
        return '<th class="' + c[2] + '" data-sort="' + c[0] + '"' + (state.sort === c[0] ? ' aria-sort="' + (state.dir < 0 ? 'descending' : 'ascending') + '"' : '') + '>' + c[1] + '</th>';
      }).join('') + '<th>Value</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr data-slug="' + esc(r.slug) + '"' + (state.p === r.slug ? ' class="sel"' : '') + '>' +
          '<td class="num">' + r.rank + '</td>' +
          '<td class="name"><b>' + esc(r.name) + '</b>' + (r.watch ? '<span class="tag watch">watchlist</span>' : '') + '<span class="cat">' + esc(r.category) + ' \u00b7 ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></td>' +
          '<td class="num">' + usd(r.tvl) + '</td><td class="num">' + pct(r.ch7) + '</td>' +
          '<td class="num">' + (r.age === null ? '<span class="note">n/a</span>' : r.age) + '</td>' +
          '<td class="num">' + r.multiple.toFixed(3) + '</td>' +
          '<td class="num"><b>' + usd(r.implied) + '</b></td>' +
          '<td class="num">' + usd(r.per1k) + '</td>' +
          '<td><span class="conf ' + r.conf + '">' + r.conf + '</span></td>' +
          '<td><div class="bar"><i style="width:' + Math.max(2, Math.round(100 * Math.sqrt(r.implied / maxV))) + '%"></i></div></td></tr>';
      }).join('') + '</tbody></table>';

    app.querySelector('#q').addEventListener('input', function (e) { state.q = e.target.value; rerender(true); });
    app.querySelector('#cat').addEventListener('change', function (e) { state.cat = e.target.value; rerender(); });
    app.querySelector('#chain').addEventListener('change', function (e) { state.chain = e.target.value; rerender(); });
    app.querySelectorAll('.chip').forEach(function (b) { b.addEventListener('click', function () { state[b.dataset.k] = b.dataset.v; rerender(); }); });
    app.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.sort;
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'rank' || k === 'name' ? 1 : -1; }
        rerender();
      });
    });
    app.querySelectorAll('tbody tr').forEach(function (tr) { tr.addEventListener('click', function () { state.p = tr.dataset.slug; rerender(); }); });
  }

  // ------------------------------------------------------------ detail
  function openDetail() {
    var r = state.p && R.rows.filter(function (x) { return x.slug === state.p; })[0];
    if (!r) { detail.hidden = true; return; }
    detail.hidden = false;
    var peers = R.live.filter(function (l) { return l.category === r.category; }).slice(0, 5);
    var f = r.factors;
    detail.innerHTML =
      '<button class="close" id="close">Close</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="meta">#' + r.rank + ' of ' + R.rows.length + ' \u00b7 ' + esc(r.category) + ' \u00b7 ' + esc(r.chains.join(', ')) + (r.watch ? ' \u00b7 <span class="tag watch">watchlist</span>' : ' \u00b7 below the $' + (R.floor / 1e6) + 'M floor') + '</div>' +
      '<div class="big"><div><div class="k">Implied FDV</div><div class="v">' + usd(r.implied) + '</div></div>' +
      '<div><div class="k">Drop pool (' + (R.model.drop_share * 100) + '%)</div><div class="v">' + usd(r.pool) + '</div></div>' +
      '<div><div class="k">Drop per $1K deposited</div><div class="v">' + usd(r.per1k) + '</div></div></div>' +
      '<h3>How the value is built</h3><div class="chain">' + f.map(function (x) {
        return '<span>' + esc(x.label) + '</span><span class="f">' + (x.key === 'tvl' ? usd(x.value) : '\u00d7 ' + x.value.toFixed(3)) + '</span><span class="n">' + esc(x.note) + '</span>';
      }).join('') + '</div>' +
      '<div class="formula">' + usd(f[0].value) + ' \u00d7 ' + f[1].value.toFixed(3) + ' \u00d7 ' + f[2].value.toFixed(3) + ' \u00d7 ' + f[3].value.toFixed(3) + ' \u00d7 ' + f[4].value.toFixed(3) + ' = ' + usd(r.implied) + '</div>' +
      '<p class="note">Confidence <span class="conf ' + r.conf + '">' + r.conf + '</span>: ' + r.peers + ' trading peer' + (r.peers === 1 ? '' : 's') + ' in ' + esc(r.category) + (r.age === null ? ', listing date unknown' : '') + '.</p>' +
      '<h3>Farm plan \u00b7 ' + esc(r.plan_cost) + ' all-in fees \u00b7 ' + esc(r.plan_time) + '</h3><ol class="plan">' +
      r.steps.map(function (s) { return '<li>' + esc(s.text) + '<span class="ct">cost ' + esc(s.cost) + ' \u00b7 time ' + esc(s.time) + '</span></li>'; }).join('') + '</ol>' +
      (peers.length ? '<h3>Trading ' + esc(r.category) + ' peers (the multiple\'s evidence)</h3><table><tbody>' + peers.map(function (l) {
        return '<tr><td>' + esc(l.name) + (l.symbol ? ' <span class="note">$' + esc(l.symbol) + '</span>' : '') + '</td><td class="num">' + usd(l.mcap) + ' mcap</td><td class="num">' + usd(l.tvl) + ' TVL</td><td class="num">' + l.ratio.toFixed(2) + 'x</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="note">No trading peer in this category: the market median multiple stands in.</p>');
    detail.querySelector('#close').addEventListener('click', function () { state.p = ''; rerender(); });
  }

  // ------------------------------------------------------------ peers and model
  function peersView() {
    app.innerHTML = '<p class="note">Protocols whose token already trades are kept off the board: they are the market evidence each category\'s multiple is read from. Top ' + R.live.length + ' by market cap.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' +
      R.live.map(function (l) { return '<tr><td>' + esc(l.name) + (l.symbol ? ' <span class="note">$' + esc(l.symbol) + '</span>' : '') + '</td><td>' + esc(l.category) + '</td><td class="num">' + usd(l.mcap) + '</td><td class="num">' + usd(l.tvl) + '</td><td class="num">' + l.ratio.toFixed(3) + 'x</td></tr>'; }).join('') + '</tbody></table>';
  }

  function modelView() {
    var m = R.model;
    app.innerHTML = '<div class="grid2"><div class="card"><h3>The value model (' + m.version + ')</h3>' +
      '<p>Every pre-token protocol is priced as the market already prices the protocols in its category whose tokens trade.</p>' +
      '<div class="formula">implied = TVL \u00d7 peer multiple \u00d7 momentum \u00d7 runway \u00d7 reach</div>' +
      '<p><b>Peer multiple</b>: median market cap / TVL of the category\'s trading peers, shrunk toward the market median (' + R.market_median + 'x) with weight k = ' + m.shrink_k + ', clamped to ' + m.multiple_min + '\u2013' + m.multiple_max + 'x.</p>' +
      '<p><b>Momentum</b>: 1 + ' + m.growth_weight + ' \u00d7 7-day TVL change, clamped to ' + m.growth_floor + '% \u2026 +' + m.growth_cap + '%.</p>' +
      '<p><b>Runway</b>: ' + m.runway_floor + ' + ' + m.runway_range + ' \u00d7 days tracked with no token / ' + m.runway_days + ' (unknown: ' + m.runway_unknown_days + ' days). A long run with no token means a larger backlog of users to reward.</p>' +
      '<p><b>Reach</b>: +' + m.chain_step + ' per extra chain, up to ' + m.chain_cap + '.</p>' +
      '<p><b>Drop per $1K</b>: an airdrop of ' + (m.drop_share * 100) + '% of implied FDV, spread over today\'s TVL. The farmer\'s column.</p>' +
      '<p class="note">No protocol is named in the model: one function scores every row. Below the floor, the house\'s own product rule removes wrapped, staked, bridged and exchange products.</p></div>' +
      '<div class="card"><h3>Category multiples</h3><table><thead><tr><th>Category</th><th class="num">Peers</th><th class="num">Median</th><th class="num">Used</th></tr></thead><tbody>' +
      R.categories.map(function (c) { return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.peers + '</td><td class="num">' + (c.median === null ? '-' : c.median.toFixed(3)) + '</td><td class="num">' + c.multiple.toFixed(3) + 'x</td></tr>'; }).join('') +
      '</tbody></table></div></div>';
  }

  var timer = 0;
  function rerender(debounced) {
    writeHash();
    if (debounced) { clearTimeout(timer); timer = setTimeout(render, 120); return; }
    render();
  }
  function render() {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === state.view)); });
    if (state.view === 'peers') peersView(); else if (state.view === 'model') modelView(); else board();
    openDetail();
    var q = document.getElementById('q');
    if (q && document.activeElement === document.body && state.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  document.querySelectorAll('.tabs button').forEach(function (b) { b.addEventListener('click', function () { state.view = b.dataset.view; state.p = ''; rerender(); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.p) { state.p = ''; rerender(); } });
  readHash();
  kpis();
  render();
})();
