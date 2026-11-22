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

  var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  var matched = M.boardRows(R).filter(function (row, i) { return same(row, B.rows[i]); }).length;
  var P0 = M.planPortfolio(R);
  var planOk = same(B.portfolio.picks, P0.picks.map(function (q) { return q.r.slug + ':' + q.deposit + ':' + q.start; }));
  var censusOk = same(R.census, B.census) && Object.values(R.census).reduce(function (a, b) { return a + b; }, 0) === R.universe;
  var verified = matched === B.rows.length && matched === R.rows.length && planOk && censusOk;
  document.getElementById('stamp').innerHTML = 'DefiLlama snapshot ' + esc(R.as_of) + ' &middot; model ' + esc(R.cfg.version) +
    ' <span class="check ' + (verified ? 'ok' : 'bad') + '">' + (verified ? '&#10003;' : '&#10007;') + ' page = board.json: ' + matched + '/' + B.rows.length + ' rows' + (planOk ? ' + plan' : '') + (censusOk ? ' + census' : '') + '</span>';

  var D = { view: 'board', q: '', fam: '', chain: '', scope: 'all', verdict: '', anchors: '', sort: 'implied', dir: -1, p: '', budget: '', hours: '', rate: '' };
  var S = JSON.parse(JSON.stringify(D));
  function readHash() {
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      var k = decodeURIComponent(kv.slice(0, i)), v = decodeURIComponent(kv.slice(i + 1));
      if (Object.hasOwn(S, k)) S[k] = k === 'dir' ? (v === '1' ? 1 : -1) : v;
    });
  }
  function go(patch) {
    var focusId = document.activeElement.id;
    var moving = ('view' in patch && patch.view !== S.view) || ('p' in patch && patch.p !== S.p);
    for (var k in patch) S[k] = patch[k];
    var parts = Object.keys(S).filter(function (k) { return S[k] !== D[k]; }).map(function (k) { return k + '=' + encodeURIComponent(S[k]); });
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname);
    render();
    if (moving) {
      window.scrollTo(0, 0);
      app.focus({ preventScroll: true });
    } else if (focusId) {
      var control = document.getElementById(focusId);
      if (control) control.focus({ preventScroll: true });
    }
  }
  function plan() { return M.planPortfolio(R, { budget: S.budget, hours: S.hours, rate: S.rate }); }
  function wire() {
    app.querySelectorAll('[data-slug]').forEach(function (el) { el.onclick = function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go({ p: el.dataset.slug });
    }; });
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
    var s = '<svg viewBox="-76 -12 672 528" class="sweep" role="img" aria-label="Protocol radar">';
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
    var labels = [];
    R.rows.slice().sort(function (p, q) { return q.tvl - p.tvl; }).forEach(function (r) {
      var g = sec[r.family], t = 0.5 + Math.atan((r.ch7 || 0) / 8) / Math.PI, an = g[0] + 0.03 + t * (g[1] - g[0] - 0.06), rr = rad(r.implied);
      var x = c + rr * Math.sin(an), y = c - rr * Math.cos(an), d = 2 + 9 * Math.sqrt(r.tvl / tmax), on = hl ? hl[r.slug] : r.rank <= 4;
      s += '<g class="dot ' + VCLASS[r.plan.verdict] + (hl && !on ? ' dim' : '') + '" data-slug="' + esc(r.slug) + '"><title>#' + r.rank + ' ' + esc(r.name) + ': ' + usd(r.implied) + ', TVL ' + usd(r.tvl) + ', 7d ' + (r.ch7 === null ? 'n/a' : r.ch7.toFixed(1) + '%') + ', ' + r.plan.verdict + '</title>' +
        (r.watch ? '<circle class="wl" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (d + 2.6).toFixed(1) + '"/>' : '') + '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + d.toFixed(1) + '"/></g>';
      if (on && (!hl || !hl.limitLabels || on === 2)) labels.push({ r: r, x: x, y: y, d: d });
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
      '<div class="legend">Radius: log value &middot; angle: 7-day TVL change, shrinking &rarr; growing</div>';
  }

  // ---- the board
  function kpis() {
    var w = R.rows.filter(function (r) { return r.watch; }).length;
    var a = R.census;
    return '<section class="kpis">' + [
      [w + '/' + R.watch_n, 'watchlist ranked'],
      [R.rows.length, 'pre-token protocols ranked'],
      [R.universe, a.priced + ' priced · ' + a.unpricedToken + ' token, no cap · ' + a.products + ' products' + (a.unusable ? ' · ' + a.unusable + ' missing TVL' : '')],
      ['&times;' + R.oos.median_miss.toFixed(2), 'leave one out · ' + R.oos.n + ' traded peers'],
      ['&times;' + R.cohort.median_miss.toFixed(2), 'leave one listing year out · ' + R.cohort.n + ' dated peers'],
      [R.rows.filter(function (r) { return r.plan.verdict === 'Worth farming'; }).length, 'worth farming at the low-end estimate'],
    ].map(function (k) { return '<div><b>' + k[0] + '</b><span>' + k[1] + '</span></div>'; }).join('') + '</section>';
  }

  function howCard() {
    var f = R.fit, o = R.oos, y = R.cohort;
    return '<section class="card"><h3>Valuation and validation</h3><ol class="how">' +
      '<li><b>Size</b> = 10 to the power of (' + f.curve.a.toFixed(3) + ' + ' + f.curve.b.toFixed(3) + ' &times; log10(TVL / $100M)). Curve refit with capped errors.</li>' +
      '<li><b>Family</b> = shrunk median residual for the category family, with ' + R.cfg.shrink_k + ' neutral pseudo-peers.</li>' +
      '<li><b>7-day growth and age</b> = fitted log-price adjustments (' + f.growth.toFixed(4) + ', ' + f.age.toFixed(4) + '). Growth units: 25 percentage points, clipped at −25% and +40%. Age units: log10(days / 365), clipped at ±1. Missing inputs are neutral.</li></ol>' +
      '<p class="mute">Every fold refits the full model. Median error vs flat mcap/TVL: &times;' + o.median_miss.toFixed(2) + ' vs &times;' + o.flat_miss.toFixed(2) +
      ' by protocol; &times;' + y.median_miss.toFixed(2) + ' vs &times;' + y.flat_miss.toFixed(2) + ' across ' + y.folds +
      ' held-out listing years. P25–P75 uses held-out residuals; rank range uses ' + R.cfg.boot + ' seeded refits. Values are conditional on a launch.</p></section>';
  }

  function planCard() {
    return '<section class="card"><h3>Farm planner</h3><p class="mute">' + P0.picks.length +
      ' modeled positions on ' + money(P0.opt.budget) + ' and ' + P0.opt.hours + ' hours per week.</p><a href="#view=plan">Open planner &rarr;</a></section>';
  }

  function protocolLink(r) {
    return '<a class="protocol" id="protocol-' + esc(r.slug) + '" href="#p=' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a>';
  }

  function chip(k, v, label) { return '<button class="chip" id="scope-' + v + '" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + (S[k] === v) + '">' + label + '</button>'; }

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
    }).sort(function (a, b) { var value = Object.hasOwn(key, S.sort) ? key[S.sort] : key.implied, x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * S.dir || a.rank - b.rank; });
  }

  function fx(top, mult, cls) {
    return '<td class="num ' + cls + '">' + top + '<small>' + mult + '</small></td>';
  }

  function rowHtml(r) {
    var tag = r.watch ? '<span class="tag watch">Watchlist</span>' : '', f = r.f;
    return '<tr data-slug="' + esc(r.slug) + '"><td class="num"><b>' + r.rank + '</b><small>' + r.rlo + '&ndash;' + r.rhi + '</small></td>' +
      '<td>' + protocolLink(r) + tag + '<small>' + esc(r.category) + ' &middot; ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</small></td>' +
      '<td class="num"><b class="val">' + usd(r.implied) + '</b><small>' + usd(r.lo) + '&ndash;' + usd(r.hi) + '</small></td>' +
      fx(usd(r.tvl), usd(f.size), 'k-tvl') +
      fx(pct(r.ch7), '&times;' + f.mom.toFixed(2), 'k-g') +
      fx(r.age === null ? 'n/a' : r.age, '&times;' + f.season.toFixed(2), 'k-d') +
      '<td class="num">' + Math.round(r.plan.odds * 100) + '%<small>' + money(r.plan.net_hour) + '/h</small></td>' +
      '<td><span class="verdict ' + VCLASS[r.plan.verdict] + '">' + r.plan.verdict + '</span></td></tr>';
  }

  function board() {
    var rows = filtered(), chains = {}, highlight;
    var hasFilters = S.q || S.fam || S.chain || S.verdict || S.scope !== 'all' || S.anchors;
    document.getElementById('notice').textContent = rows.length + ' protocols shown';
    if (rows.length < R.rows.length) {
      highlight = { limitLabels: true };
      rows.forEach(function (r, i) { highlight[r.slug] = i < 4 ? 2 : 1; });
    }
    R.rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    var famCount = function (f) { return R.rows.filter(function (r) { return r.family === f; }).length; };
    var anchors = S.anchors ? R.traded.filter(function (p) { return !S.fam || p.fam === S.fam; }).sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, 12) : [];
    var verdicts = Object.keys(VCLASS).map(function (v) {
      return '<option' + (S.verdict === v ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
    app.innerHTML = '<div class="pagehead"><h1>Pre-token rankings</h1><p>Valuation at launch, with break-even economics for each farm plan.</p></div>' + kpis() +
      '<div class="hgrid"><section class="rcol" aria-label="Ranked protocols">' +
      '<div class="filters"><input type="search" aria-label="Search protocols" id="q" placeholder="Search protocols" value="' + esc(S.q) + '">' +
      '<select id="fam" aria-label="Family"><option value="">All families</option>' + M.FAMILIES.filter(famCount).map(function (f) { return '<option value="' + esc(f) + '"' + (S.fam === f ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join('') + '</select>' +
      '<select id="chain" aria-label="Chain"><option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) { return '<option' + (S.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="verdict" aria-label="Farm verdict"><option value="">All verdicts</option>' + verdicts + '</select></div>' +
      '<div class="filters scopes">' + chip('scope', 'all', 'All') + chip('scope', 'watch', 'Watchlist') + chip('scope', 'off', 'Off watchlist &ge; ' + usd(R.floor)) + chip('scope', 'early', 'Under ' + usd(R.floor)) +
      '<label class="tog"><input type="checkbox" id="anch"' + (S.anchors ? ' checked' : '') + '> Traded peers</label></div>' +
      '<div class="count"><span><b>' + rows.length + '</b> of ' + R.rows.length + ' protocols' + (anchors.length ? ' &middot; ' + anchors.length + ' traded peers' : '') + '</span>' +
      (hasFilters ? '<button id="clear">Reset filters</button>' : '') + '</div>' +
      '<div class="scroll" tabindex="0" role="region" aria-label="Protocol rankings table"><table class="board"><thead><tr>' + COLS.map(function (c) { return '<th scope="col" class="' + c[2] + '" data-sort="' + c[0] + '"' + (S.sort === c[0] ? ' aria-sort="' + (S.dir < 0 ? 'descending' : 'ascending') + '"' : '') + '><button id="sort-' + c[0] + '">' + c[1] + '</button></th>'; }).join('') + '</tr></thead><tbody>' +
      anchors.map(function (p) { return '<tr class="anchor"><td class="num">&ndash;</td><td>' + esc(p.name) + ' <span class="tag">trades</span><small>' + esc(p.category) + ' &middot; reference, not ranked</small></td><td class="num">' + usd(p.mcap) + '<small>market cap</small></td><td class="num">' + usd(p.tvl) + '</td><td colspan="4" class="mute">market ' + (p.mcap / p.tvl).toFixed(2) + '&times; TVL &middot; curve says ' + usd(Math.pow(10, M.predictLog(R.fit, p))) + '</td></tr>'; }).join('') +
      (rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="8" class="empty">No protocols match these filters.</td></tr>') +
      '</tbody></table></div></section><aside class="lcol"><section class="card radar"><h3>Sector radar</h3>' + sweep(highlight) + '</section>' + howCard() + planCard() + '</aside></div>';
    wire();
    app.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { go({ scope: b.dataset.v }); }; });
    app.querySelectorAll('th[data-sort] button').forEach(function (b) { b.onclick = function () { var k = b.parentNode.dataset.sort; go(S.sort === k ? { dir: -S.dir } : { sort: k, dir: k === 'rank' || k === 'name' || k === 'odds' ? 1 : -1 }); }; });
    var clear = app.querySelector('#clear');
    if (clear) clear.onclick = function () {
      go({ q: '', fam: '', chain: '', verdict: '', scope: 'all', anchors: '' });
      app.querySelector('#q').focus();
    };
    var q = app.querySelector('#q'), t = 0;
    q.oninput = function () {
      clearTimeout(t);
      t = setTimeout(function () {
        var editing = document.activeElement === q, start = q.selectionStart, end = q.selectionEnd;
        go({ q: q.value });
        if (editing) app.querySelector('#q').setSelectionRange(start, end);
      }, 150);
    };
    app.querySelector('#fam').onchange = function (e) { go({ fam: e.target.value }); };
    app.querySelector('#chain').onchange = function (e) { go({ chain: e.target.value }); };
    app.querySelector('#verdict').onchange = function (e) { go({ verdict: e.target.value }); };
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
    app.innerHTML = '<section class="card ptop"><div><h1>Farm portfolio planner</h1><p class="mute">Set a budget and weekly time limit. The planner ranks ' + P.candidates + ' eligible plans by low-end proceeds per dollar of cost and time, with a ' + Math.round(o.family_cap * 100) + '% budget cap per family.</p></div>' +
      '<div class="inputs">' + field('budget', 'Budget, $', 500) + field('hours', 'Hours a week', 0.5) + field('rate', 'Your time, $/h', 5) + '</div></section>' +
      '<section class="totals big">' + tile(P.picks.length, 'positions', money(P.deposit) + ' deployed') + tile(money(P.fees), 'fees and gas', 'every step, every chain') + tile(money(P.forgone), 'income forgone', Math.round(R.cfg.tbill * 100) + '% a year on the deposits') + tile(hrs(P.minutes), 'hands-on time', 'peak week ' + Math.round(Math.max.apply(0, P.load.concat(0))) + ' of ' + cap + ' min') +
      tile(money(P.slice), 'slice if each launched', 'band ' + money(P.lo) + '&ndash;' + money(P.hi)) + tile(P.slice ? Math.round((P.fees + P.forgone) / P.slice * 100) + '%' : '&ndash;', 'break-even odds', 'share of launches that repays the costs') + '</section>' +
      (P.picks.length ? '' : '<p class="card warn">No position fits: a setup week takes about 70 minutes, so allow at least 1.5 hours a week and $' + o.min_fill + ' per position.</p>') +
      '<div class="pgrid"><div><section class="card"><h3>Positions</h3><table class="mini"><thead><tr><th>#</th><th>Protocol</th><th class="num">Deposit</th><th>Chain</th><th class="num">Start</th><th class="num">Fees</th><th class="num">Forgone</th><th class="num">Time</th><th class="num">Slice (band)</th><th class="num">Low slice / $</th></tr></thead><tbody>' +
      P.picks.map(function (q, i) { return '<tr data-slug="' + esc(q.r.slug) + '"><td>' + (i + 1) + '</td><td>' + protocolLink(q.r) + ' <span class="verdict ' + VCLASS[q.r.plan.verdict] + '">' + q.r.plan.verdict + '</span><small>' + esc(q.r.family) + ' &middot; rank ' + q.r.rank + ' &middot; ' + usd(q.r.implied) + '</small></td><td class="num">' + money(q.deposit) + '</td><td>' + esc(q.r.plan.chain) + '</td><td class="num">wk ' + (q.start + 1) + '</td><td class="num">' + money(q.fees) + '</td><td class="num">' + money(q.forgone) + '</td><td class="num">' + q.minutes + ' min</td><td class="num"><b class="val">' + money(q.slice) + '</b><small>' + money(q.lo) + '&ndash;' + money(q.hi) + '</small></td><td class="num">&times;' + q.score.toFixed(2) + '</td></tr>'; }).join('') + '</tbody></table></section>' +
      '<section class="card"><h3>Combined weekly schedule</h3><table class="cal"><thead><tr><th>Position</th>' + weeks + '</tr></thead><tbody>' +
      P.picks.map(function (q) {
        var cells = P.load.map(function (m, i) { var w = q.weeks[i - q.start]; return !w ? '<td></td>' : '<td class="on' + (w.steps.length ? ' st' : '') + '" title="' + Math.round(w.min) + ' min">' + (w.steps.length ? span(w.steps) : '&middot;') + '</td>'; }).join('');
        return '<tr data-slug="' + esc(q.r.slug) + '"><td>' + esc(q.r.name) + '</td>' + cells + '</tr>';
      }).join('') +
      '<tr class="sum"><td>Minutes that week</td>' + P.load.map(function (m) { return '<td class="num' + (m > cap * 0.8 ? ' hot' : '') + '">' + Math.round(m) + '</td>'; }).join('') + '</tr></tbody></table>' +
      '<p class="mute tiny">Numbers link to plan steps. Dots mark weekly checks. Event-driven steps have no fixed week.</p></section>' +
      '<section class="card"><h3>Next in line, left out</h3><table class="mini"><thead><tr><th>Protocol</th><th>Verdict</th><th class="num">Low slice / $</th><th>Why it is out</th></tr></thead><tbody>' +
      Object.keys(reasons).map(function (k) { return reasons[k].slice(0, 3).map(function (x) { return '<tr data-slug="' + esc(x.r.slug) + '"><td>' + esc(x.r.name) + ' <span class="mute">' + esc(x.r.family) + '</span></td><td><span class="verdict ' + VCLASS[x.r.plan.verdict] + '">' + x.r.plan.verdict + '</span></td><td class="num">&times;' + x.score.toFixed(2) + '</td><td>' + esc(x.why) + ' <span class="mute">(' + reasons[k].length + ' rows)</span></td></tr>'; }).join(''); }).join('') + '</tbody></table></section></div>' +
      '<div><section class="card"><h3>Chosen positions on the radar</h3>' + sweep(hl) + '</section><section class="card"><h3>Budget by family, cap ' + Math.round(o.family_cap * 100) + '%</h3>' +
      M.FAMILIES.map(function (f) { var v = P.families[f] || 0; return '<div class="fbar"><span>' + esc(f) + '</span><i><b style="width:' + (v / o.budget * 400).toFixed(1) + '%"></b></i><em>' + money(v) + '</em></div>'; }).join('') + '<p class="mute tiny">Bar end = the ' + Math.round(o.family_cap * 100) + '% cap, ' + money(o.budget * o.family_cap) + '. Unspent: ' + money(o.budget - P.deposit) + '.</p></section></div></div>';
    wire();
    app.querySelectorAll('[data-in]').forEach(function (el) { el.onchange = function () { var x = {}; x[el.dataset.in] = el.value > 0 ? String(+el.value) : ''; go(x); }; });
  }

  // Protocol detail
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
    app.innerHTML = '<a class="back" href="#">&larr; Board</a><div class="dhead"><h1>' + esc(r.name) + '</h1><span class="tag">records no token</span>' + (r.watch ? '<span class="tag watch">watchlist</span>' : '') + '<span class="tag">' + esc(r.category) + '</span><span class="tag">' + esc(r.chains.slice(0, 4).join(' · ')) + '</span> <button id="jump">Farm plan &darr;</button></div>' +
      '<div class="dgrid"><section class="card"><div class="hero"><div><span class="mute">Implied launch value</span><b class="big">' + usd(r.implied) + '</b></div>' +
      '<div><span class="mute">Rank &middot; P10&ndash;P90 of refits</span><b>' + r.rank + ' of ' + R.rows.length + ' &middot; ' + r.rlo + '&ndash;' + r.rhi + '</b></div><div><span class="mute">P25&ndash;P75 band</span><b>' + usd(r.lo) + '&ndash;' + usd(r.hi) + '</b></div></div>' +
      '<h3>Valuation factors</h3><div class="tiles">' + tile(usd(f.size), 'size curve at <b class="k-tvl">' + usd(r.tvl) + ' TVL</b>') + '<i>&times;</i>' + tile(f.tilt.toFixed(2), esc(r.family) + ' tilt, ' + f.peers + ' peers') + '<i>&times;</i>' +
      tile(f.mom.toFixed(2), '<b class="k-g">7-day TVL ' + (r.ch7 === null ? 'n/a' : (r.ch7 >= 0 ? '+' : '') + r.ch7.toFixed(1) + '%') + '</b>') + '<i>&times;</i>' + tile(f.season.toFixed(2), '<b class="k-d">' + (r.age === null ? 'age unknown' : r.age + ' days') + '</b> tracked') + '<i>=</i>' + tile(usd(r.implied), 'implied value', 'res') + '</div>' +
      '<h3 id="peers">Traded peers in the same family</h3><div class="scroll peers" role="region" aria-labelledby="peers" tabindex="0"><table class="mini"><thead><tr><th>Token that trades</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">&times; TVL</th><th class="num">Applied here</th></tr></thead><tbody>' +
      r.peers.map(function (q) { return '<tr><td>' + esc(q.name) + (q.symbol ? ' <span class="mute">$' + esc(q.symbol) + '</span>' : '') + '</td><td class="num">' + usd(q.tvl) + '</td><td class="num">' + usd(q.mcap) + '</td><td class="num">' + (q.mcap / q.tvl).toFixed(2) + '&times;</td><td class="num">' + usd(q.mcap / q.tvl * r.tvl) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '</div><h3>Farm economics</h3><div class="arith">Slice if a token launches = ' + Math.round(R.cfg.drop_share * 100) + '% airdrop &times; ' + usd(r.implied) + ' &times; ' + money(p.deposit) + ' / ' + usd(r.tvl) + ' TVL = <b>' + money(p.slice) + '</b> (band ' + money(p.slice * r.lo / r.implied) + '&ndash;' + money(p.slice * r.hi / r.implied) + ')<br>Break-even = (' + money(p.fees) + ' fees + ' + money(p.forgone) + ' income forgone at ' + Math.round(R.cfg.tbill * 100) + '% a year for ' + p.weeks + ' weeks) / ' + money(p.slice) + ' = <b>' + Math.round(p.odds * 100) + '%</b>: the chance of a launch, with a snapshot, inside the hold that pays for the plan. At the band\'s ends: ' + Math.round(p.odds_hi * 100) + '% to ' + Math.round(p.odds_lo * 100) + '%.</div>' +
      '<p class="mute">' + (p.odds_lo <= R.cfg.worth ? 'Worth farming even at the band\'s low end.' : p.odds_hi > R.cfg.marginal ? 'A skip even if the value lands at the band\'s high end.' : 'Marginal. Low-end break-even exceeds 25%, while high-end break-even is at most 60%.') + '</p>' +
      '<div class="inplan">' + (mine ? 'In the default <a href="#view=plan">portfolio</a>: ' + money(mine.deposit) + ' from week ' + (mine.start + 1) + ', slice ' + money(mine.slice) + '.' : 'Not in the default <a href="#view=plan">' + money(P0.opt.budget) + ' portfolio</a>' + (p.verdict === 'Skip' ? ': a Skip.' : ': other rows pay more per dollar and hour.')) + '</div></section>' +
      '<section class="card" id="steps" tabindex="-1"><div class="plhead"><h3>Farm plan &middot; ' + esc(p.chain) + ' &middot; ' + money(p.deposit) + ' &middot; ' + p.weeks + ' weeks</h3><span class="verdict ' + VCLASS[p.verdict] + '">' + p.verdict + '</span></div>' + timeline(p) +
      '<table class="plan"><thead><tr><th>#</th><th>When</th><th>Step</th><th class="num">Cost</th><th class="num">Time</th></tr></thead><tbody>' +
      p.steps.map(function (s, i) { return '<tr' + (/^Stop rule/.test(s.text) ? ' class="stoprow"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(s.when) + '</td><td>' + esc(s.text) + '</td><td class="num">' + money(s.cost) + '</td><td class="num">' + s.min + ' min</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="totals">' + [[money(p.fees), 'fees and gas'], [money(p.forgone), 'income forgone'], [p.minutes + ' min', 'your time'], [money(p.slice), 'slice if launch'], [Math.round(p.odds * 100) + '%', 'break-even odds'], [money(p.net_hour), 'net per hour if launch']].map(function (t) { return '<div><span>' + t[1] + '</span><b>' + t[0] + '</b></div>'; }).join('') + '</div>' +
      '<ul class="rules"><li>One wallet, your own funds; never split one position across wallets.</li><li>Claim only through the domain bookmarked on day 0.</li><li>Farm steps are scenarios. Verify asset support, fees and eligibility before depositing.</li></ul></section></div>';
    app.querySelector('#jump').onclick = function () { app.querySelector('#steps').focus(); };
  }

  function render() {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-current', b.dataset.view === S.view ? 'page' : 'false'); b.onclick = function () { go({ view: b.dataset.view, p: '' }); }; });
    var r = S.p && bySlug[S.p];
    if (r || S.view === 'plan') document.getElementById('notice').textContent = '';
    if (r) detail(r); else if (S.view === 'plan') planner(); else board();
    var back = app.querySelector('.back'); if (back) back.onclick = function (e) { e.preventDefault(); go({ p: '' }); var previous = document.getElementById('protocol-' + r.slug); if (previous) previous.focus(); };
  }
  window.addEventListener('hashchange', function () { S = JSON.parse(JSON.stringify(D)); readHash(); render(); });
  readHash();
  render();
})();
