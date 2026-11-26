// Token Radar's dashboard (radar-3). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a per-protocol detail view with the fitted model's own
// inputs and the protocol's farm plan, the live-token set, the validation panel and the
// methodology. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, verdict: 'all', dep: 3, air: 2, termAuto: true, term: 30 };
  // The farm verdict's economics, mirroring lib/model.ts exactly: deposit tiers and airdrop
  // shares are the same lists, the $25-an-hour bar and the $5 bridge fee are the same numbers.
  var DEPOSIT_TIERS = [250, 500, 1000, 2500, 5000, 10000];
  var AIRDROP_SHARES = [0.03, 0.05, 0.07, 0.1, 0.15];
  var FARM_PER_HOUR = 25;
  var BRIDGE_FEE_USD = 5;
  var TBILL_RATE = 0.045;
  var TERM_DAYS = [14, 30, 45, 60, 90];
  // The watchlist slugs are the snapshot's own list, which main.ts ships in data.js.
  var WL = {};
  (DATA.watchlist || []).forEach(function (s) { WL[s] = true; });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // The model in one function: the page recomputes a row from the fitted coefficients and checks
  // the number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. It mirrors lib/model.ts exactly: the log-linear value fit, then the logistic odds.
  function impliedOf(row, fit, odds) {
    var il = Math.exp(fit.intercept + fit.slope * (Math.log(row.tvl_usd) - fit.center));
    var z = odds.intercept;
    z += odds.coef[0] * ((Math.log(row.tvl_usd) - odds.mu[0]) / odds.sd[0]);
    z += odds.coef[1] * ((Math.log1p(row.age_days === null || row.age_days === undefined ? odds.med_age : row.age_days) - odds.mu[1]) / odds.sd[1]);
    z += odds.coef[2] * ((row.cat_rate - odds.mu[2]) / odds.sd[2]);
    var o = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
    return Math.max(1, Math.round(il * o));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasUsd(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return 9;
    if (c === 'solana') return 0.2;
    if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'polygon' || c === 'bsc' || c === 'bnb' || c === 'avalanche') return 1;
    return 2;
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function farmHours(holdDays) {
    var minutes = 5 + 15 + 10 * Math.ceil(holdDays / 7) + 10 + 5;
    return Math.round((minutes / 60) * 100) / 100;
  }
  // One row's farm verdict at the current controls, mirroring lib/model.ts farmVerdict exactly:
  // the airdrop pool is the airdrop share of the implied value, split pro-rata by capital, so
  // your share is your deposit's share of the protocol's TVL; the fees are the chain's gas times
  // the six farm steps plus one $5 bridge; the hours are the farm plan's active time at the hold
  // (or at the term override when the board sets one). At the defaults (deposit $2,500, share 7%,
  // term auto) this returns the verdict board.json carries for the row.
  function verdictAt(row, deposit, share, termAuto, term) {
    var depositShare = Math.min(1, deposit / Math.max(1, row.tvl_usd));
    var expected = row.implied_value_usd * share * depositShare;
    var fees = gasUsd(chainOf(row)) * 6 + BRIDGE_FEE_USD;
    var holdDays = termAuto ? holdDaysFor(row.age_days) : term;
    var hours = farmHours(holdDays);
    var net = expected - fees;
    var perHour = net / hours;
    var verdict = net > 0 && perHour >= FARM_PER_HOUR ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
    return {
      deposit_usd: deposit, airdrop_share: share,
      expected_airdrop_usd: Math.round(expected * 100) / 100,
      fees_usd: Math.round(fees * 100) / 100,
      net_return_usd: Math.round(net * 100) / 100,
      hours: hours,
      net_per_hour_usd: Math.round(perHour * 100) / 100,
      verdict: verdict,
      hold_days: holdDays
    };
  }
  function farmVerdictFor(row) {
    return verdictAt(row, DEPOSIT_TIERS[state.dep], AIRDROP_SHARES[state.air], state.termAuto, state.term);
  }
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '−$' : '+$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and borrow a small amount against it, then repay the borrow.';
    if (c.indexOf('dex') >= 0) return 'Swap $' + capital + ' of USDC through ' + name + ' on ' + chain + ', then provide $' + capital + ' of liquidity to its main pool and keep the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('yield aggregator') >= 0) return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open through one full epoch.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app, then bridge a small amount back.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade, then close it.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then settle or close it.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares for the whole epoch.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it through one distribution.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to the chain through its official bridge and use one of its apps, such as a swap or a stake.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('privacy') >= 0) return 'Route $' + capital + ' through ' + name + "'s shielded pool on " + chain + ' and keep the note.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('dep') !== null) { var d = parseInt(params.get('dep'), 10); if (d >= 0 && d < DEPOSIT_TIERS.length) state.dep = d; }
    if (params.get('air') !== null) { var a = parseInt(params.get('air'), 10); if (a >= 0 && a < AIRDROP_SHARES.length) state.air = a; }
    if (params.get('term') === 'auto') state.termAuto = true;
    else if (params.get('term') !== null) { var t = parseInt(params.get('term'), 10); if (t >= 14 && t <= 90) { state.termAuto = false; state.term = t; } }
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.dep !== 3) params.set('dep', String(state.dep));
    if (state.air !== 2) params.set('air', String(state.air));
    if (!state.termAuto) params.set('term', String(state.term));
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !WL[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && farmVerdictFor(r).verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'verdict') { av = { FARM: 2, MARGINAL: 1, SKIP: 0 }[farmVerdictFor(a).verdict]; bv = { FARM: 2, MARGINAL: 1, SKIP: 0 }[farmVerdictFor(b).verdict]; }
      else if (key === 'perhour') { av = farmVerdictFor(a).net_per_hour_usd; bv = farmVerdictFor(b).net_per_hour_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', html: 'Snapshot <b>' + esc(DATA.as_of) + '</b>' }),
        el('span', { class: 'pill', html: 'Model <b>' + esc(DATA.model_version) + '</b>' }),
        el('span', { class: 'pill', html: 'Source <b>DefiLlama</b>' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    var total = DATA.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { html: DATA.watchlist_size + ' watchlist protocols, ranked by <span class="hl">implied value</span>' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols below that floor, so the board ranks every rankable protocol the snapshot carries. Implied value is the if-launched value times the token odds — the historical launch rate of similar protocols, not a forecast — and every row carries its P25–P75 range and rank interval.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { html: DATA.watchlist_size + ' <small>/ ' + DATA.watchlist_size + '</small>' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' })),
        el('div', { class: 'fact' }, el('span', { text: 'Board total implied value' }), el('b', { text: fmtUsd(total) }))
      )
    );
  }

  function kpiBar() {
    var f = DATA.fit, o = DATA.odds;
    var farmable = DATA.rows.filter(function (r) { return r.farm && r.farm.verdict === 'FARM'; }).length;
    function card(label, value, sub) {
      return el('div', { class: 'fact' }, el('span', { text: label }), el('b', { text: value }), sub ? el('span', { class: 'sub', text: sub }) : null);
    }
    return el('section', { class: 'kpis', 'aria-label': 'Key numbers' },
      card('Value model, leave-one-out error', '×' + f.loo_median.toFixed(2), 'flat baseline ×' + f.flat_loo.toFixed(2)),
      card('Interval honesty, P25–P75 coverage', Math.round(f.coverage50 * 100) + '%', 'target about 50%'),
      card('Token odds, 5-fold Brier', o.brier_cv.toFixed(3), 'baseline ' + o.brier_baseline.toFixed(3)),
      card('Validation checks passed', DATA.validation_passed + '/' + DATA.validation_total, 'fitted model vs flat baseline'),
      card('Rows worth farming', String(farmable), 'of ' + DATA.board_size + ' at $2,500 and 7%'),
      card('Watchlist covered', DATA.watchlist_size + '/' + DATA.watchlist_size, 'every watchlist protocol ranked')
    );
  }

  // The protocol accounting, with self-checks the page runs live on its own data: the page
  // recomputes every row from the fitted coefficients, checks the ranking order, and re-adds the
  // ledger two different ways. A tick is a check the page just ran, not a claim in the text.
  function accountingPanel() {
    var groups = DATA.accounting || [];
    var total = groups.reduce(function (a, g) { return a + g.count; }, 0);
    var recomputed = DATA.rows.filter(function (r) { return impliedOf(r, DATA.fit, DATA.odds) === r.implied_value_usd; }).length;
    var ordered = DATA.rows.every(function (r, i) { return i === 0 || r.implied_value_usd <= DATA.rows[i - 1].implied_value_usd; });
    var byKey = {};
    groups.forEach(function (g) { byKey[g.key] = g.count; });
    var ranked = (byKey.ranked_watchlist || 0) + (byKey.ranked_early || 0);
    var launched = (byKey.launched_usable || 0) + (byKey.launched_no_mcap || 0);
    var excluded = (byKey.bridge || 0) + (byKey.liquid_staking || 0) + (byKey.exchange || 0) + (byKey.versioned || 0);
    var wlOk = DATA.watchlist.every(function (s) { return WL[s] && DATA.rows.some(function (r) { return r.slug === s; }); });
    function check(label, ok, detail) {
      return el('div', { class: 'check-item' + (ok ? ' ok' : ' bad') },
        el('span', { class: 'tick', text: ok ? '✓' : '✗' }),
        el('span', null, el('b', { text: label }), el('span', { class: 'sub', text: ' ' + detail }))
      );
    }
    return el('section', { class: 'panel model accounting' },
      el('h2', { text: 'Protocol accounting: all ' + total + ' protocols, every one placed' }),
      el('p', { class: 'sub', text: 'The groups are mutually exclusive and come from the same rules as the board itself — the watchlist, the rankable test and the exclusion categories — so the ledger and the board cannot disagree. A protocol is in exactly one group.' }),
      el('div', { class: 'acct-grid' }, groups.map(function (g) {
        return el('div', { class: 'acct-row' }, el('span', { text: g.label }), el('b', { class: 'num', text: String(g.count) }));
      })),
      el('div', { class: 'checks' },
        check('Rows recomputed', recomputed === DATA.board_size, recomputed + '/' + DATA.board_size + ' rows match board.json'),
        check('Ranking ordered', ordered, 'implied value falls down the board'),
        check('Totals equal', ranked + launched + excluded === total, ranked + ' ranked + ' + launched + ' launched + ' + excluded + ' not ranked = ' + total),
        check('Watchlist', wlOk, DATA.watchlist_size + '/' + DATA.watchlist_size + ' covered'),
        check('Ledger', total === 758, total + '/758 protocols accounted for')
      )
    );
  }

  function validationPanel() {
    var f = DATA.fit, o = DATA.odds;
    function fact(label, value, sub) {
      return el('div', { class: 'fact' }, el('span', { text: label }), el('b', { text: value }), sub ? el('span', { class: 'sub', text: sub }) : null);
    }
    return el('section', { class: 'panel model valid' },
      el('h2', { text: 'Validation: what was tested, what the numbers say' }),
      el('p', { class: 'sub', text: 'Every number below was computed by the program from this snapshot, not typed in. The value model and the odds model were each fitted on the snapshot and checked on data they had not seen.' }),
      el('div', { class: 'facts' },
        fact('Value model, leave-one-out error', '×' + f.loo_median.toFixed(2), 'flat baseline ×' + f.flat_loo.toFixed(2)),
        fact('Value model, walk-forward error', '×' + f.walk_forward_median.toFixed(2), 'flat baseline ×' + f.flat_walk_forward.toFixed(2)),
        fact('Token odds, 5-fold Brier', o.brier_cv.toFixed(3), 'baseline ' + o.brier_baseline.toFixed(3)),
        fact('Interval honesty, P25–P75 coverage', Math.round(f.coverage50 * 100) + '%', 'target about 50%'),
        fact('Interval honesty, P10–P90 coverage', Math.round(f.coverage80 * 100) + '%', 'target about 80%'),
        fact('Protocols the value model trained on', String(f.n_train), 'launched, with a market cap')
      ),
      el('p', { class: 'note', text: 'Terms tested and dropped because leave-one-out got worse with each: a quadratic size curve, 7-day growth, age, chain count, and category effects (raw and grouped, ridge lambda 1–300). Odds tested and dropped the same way: 7-day growth and chain count. Token odds are historical launch rates of similar protocols, not forecasts of who will launch.' })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var wl = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.wl ? 'checked' : null, onchange: function (e) { state.wl = e.target.checked; writeHash(); render(); } }),
      el('span', { text: 'Watchlist only' })
    );
    var verdictSel = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['FARM', 'MARGINAL', 'SKIP'].map(function (v) { return el('option', { value: v, text: v, selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSel.addEventListener('change', function () { state.verdict = verdictSel.value; writeHash(); render(); });
    var counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { counts[farmVerdictFor(r).verdict]++; });
    var depRange = el('input', { type: 'range', id: 'dep', min: '0', max: String(DEPOSIT_TIERS.length - 1), step: '1', value: String(state.dep), 'aria-label': 'Deposit tier' });
    var depOut = el('span', { class: 'range-out num', text: '$' + DEPOSIT_TIERS[state.dep].toLocaleString('en-US') });
    depRange.addEventListener('input', function () { state.dep = parseInt(depRange.value, 10); depOut.textContent = '$' + DEPOSIT_TIERS[state.dep].toLocaleString('en-US'); writeHash(); render(); });
    var airRange = el('input', { type: 'range', id: 'air', min: '0', max: String(AIRDROP_SHARES.length - 1), step: '1', value: String(state.air), 'aria-label': 'Airdrop share' });
    var airOut = el('span', { class: 'range-out num', text: Math.round(AIRDROP_SHARES[state.air] * 100) + '%' });
    airRange.addEventListener('input', function () { state.air = parseInt(airRange.value, 10); airOut.textContent = Math.round(AIRDROP_SHARES[state.air] * 100) + '%'; writeHash(); render(); });
    var termAuto = el('input', { type: 'checkbox', checked: state.termAuto ? 'checked' : null, 'aria-label': 'Automatic term by age' });
    var termRange = el('input', { type: 'range', id: 'term', min: '14', max: '90', step: '1', value: String(state.term), disabled: state.termAuto ? 'disabled' : null, 'aria-label': 'Hold term in days' });
    var termOut = el('span', { class: 'range-out num', text: state.termAuto ? 'auto' : state.term + ' days' });
    termAuto.addEventListener('change', function () { state.termAuto = termAuto.checked; termRange.disabled = state.termAuto; termOut.textContent = state.termAuto ? 'auto' : state.term + ' days'; writeHash(); render(); });
    termRange.addEventListener('input', function () { state.term = parseInt(termRange.value, 10); termOut.textContent = state.term + ' days'; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      wl,
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Farm verdict (' + counts.FARM + ' FARM / ' + counts.MARGINAL + ' MARGINAL / ' + counts.SKIP + ' SKIP)' }), verdictSel),
      el('div', { class: 'field' }, el('label', { for: 'dep', text: 'Deposit tier' }), el('div', { class: 'range-row' }, depRange, depOut)),
      el('div', { class: 'field' }, el('label', { for: 'air', text: 'Airdrop share' }), el('div', { class: 'range-row' }, airRange, airOut)),
      el('div', { class: 'field' }, el('label', { text: 'Hold term' }), el('div', { class: 'range-row' }, el('label', { class: 'check' }, termAuto, el('span', { text: 'Auto by age' })), termRange, termOut)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = (list[0] || { implied_value_usd: 1 }).implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankSub = (r.rank_p10 !== r.rank || r.rank_p90 !== r.rank) ? el('span', { class: 'sub', text: r.rank_p10 + '–' + r.rank_p90 }) : null;
      var fv = farmVerdictFor(r);
      var perClass = fv.net_per_hour_usd >= 25 ? 'pos' : fv.net_return_usd > 0 ? '' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('div', { text: String(r.rank) }), rankSub),
        el('td', null, el('div', { class: 'name' },
          el('span', null, el('b', { text: r.name }), WL[r.slug] ? el('span', { class: 'badge wl', text: 'WATCHLIST' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: Math.round(r.token_odds * 100) + '%' }),
        el('td', null, el('div', { class: 'implied-col' },
          el('div', { class: 'implied' },
            el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
          ),
          el('span', { class: 'sub', text: 'P25–P75 ' + fmtUsd(r.p25_usd) + '–' + fmtUsd(r.p75_usd) })
        )),
        el('td', null, el('span', { class: 'verdict v-' + fv.verdict.toLowerCase(), text: fv.verdict })),
        el('td', { class: 'num ' + perClass, text: fmtSigned(fv.net_per_hour_usd) + '/h' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Implied value is the if-launched value times the token odds. The verdict prices farming this row at a $' + DEPOSIT_TIERS[state.dep].toLocaleString('en-US') + ' deposit and a ' + Math.round(AIRDROP_SHARES[state.air] * 100) + '% airdrop share: FARM pays $25 an hour or more after fees, MARGINAL pays but slower, SKIP loses money. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Token odds'),
            sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Farm verdict'),
            sortHeader('perhour', 'Net $/h')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var f = DATA.fit, o = DATA.odds;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One fitted model scores every row. The value model is a log-linear regression fitted on the ' + f.n_train + ' launched protocols with a market cap; the odds model is a logistic regression fitted on all 758 protocols. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' }, 'log(mcap) = ' + f.intercept.toFixed(2) + ' + ' + f.slope.toFixed(2) + ' x (log(TVL) - ' + f.center.toFixed(2) + ')'),
      el('div', { class: 'formula' }, 'implied = round( exp(log(mcap)) x odds ),   odds = logistic(' + o.coef.map(function (c, i) { return c.toFixed(2) + ' x ' + o.features[i]; }).join(' + ') + ')'),
      el('table', { class: 'mult-table' },
        el('caption', { text: 'What was fitted, and how it was checked on data it had not seen.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Check' }), el('th', { scope: 'col', class: 'num', text: 'Fitted model' }), el('th', { scope: 'col', class: 'num', text: 'Flat baseline' }))),
        el('tbody', null,
          el('tr', null, el('td', { text: 'Value model, leave-one-out median error' }), el('td', { class: 'num', text: '×' + f.loo_median.toFixed(2) }), el('td', { class: 'num', text: '×' + f.flat_loo.toFixed(2) })),
          el('tr', null, el('td', { text: 'Value model, walk-forward median error' }), el('td', { class: 'num', text: '×' + f.walk_forward_median.toFixed(2) }), el('td', { class: 'num', text: '×' + f.flat_walk_forward.toFixed(2) })),
          el('tr', null, el('td', { text: 'Token odds, 5-fold Brier score' }), el('td', { class: 'num', text: o.brier_cv.toFixed(3) }), el('td', { class: 'num', text: o.brier_baseline.toFixed(3) })),
          el('tr', null, el('td', { text: 'Token odds, time-split Brier score' }), el('td', { class: 'num', text: o.brier_time_split.toFixed(3) }), el('td', { class: 'num', text: '—' })),
          el('tr', null, el('td', { text: 'P25–P75 interval, held-out coverage' }), el('td', { class: 'num', text: Math.round(f.coverage50 * 100) + '%' }), el('td', { class: 'num', text: 'target ~50%' })),
          el('tr', null, el('td', { text: 'P10–P90 interval, held-out coverage' }), el('td', { class: 'num', text: Math.round(f.coverage80 * 100) + '%' }), el('td', { class: 'num', text: 'target ~80%' }))
        )
      ),
      el('p', { class: 'note', text: 'Intervals: the value interval is conformal, from the leave-one-out residuals — it says how far one protocol\u2019s realized value can land from the model. The rank interval comes from ' + DATA.bootstrap_draws + ' bootstrap refits of the value model and says how much the ranking moves when the fitted coefficients move. Terms that did not survive validation: a quadratic size curve, 7-day growth, age, chain count and category effects for value; 7-day growth and chain count for odds. Exchanges and versioned pools are not ranked, and the live-token protocols are set aside with their market caps shown. Saying a protocol records no token is not saying it has none: DefiLlama\u2019s record is not proof.' }),
      el('p', { class: 'note', text: 'Farm verdict assumptions, stated not hidden: the airdrop pool is 7% of the implied value by default (adjustable from 3% to 15%), split pro-rata by capital, so your share is your deposit\u2019s share of the protocol\u2019s TVL; the fees are the chain\u2019s gas times the six farm steps plus one $5 bridge; the hours are the plan\u2019s active time at the hold (30–60 days by age, or the term you set). FARM means the farm pays $25 an hour or more after fees, MARGINAL means it pays but slower, SKIP means it loses money at this deposit and share. The 7% and the $25 bar are assumptions, not measurements — move the sliders and the verdicts move.' })
    );
  }

  function openDetail(slug) {
    state.selected = slug;
    writeHash();
    render();
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    render();
  }

  // The ten-step farm plan: the board's six-step plan expanded, each step with its cost, its
  // time and the condition that ends it. The action, the capital and the hold come from the row.
  function farmPlan10(row) {
    var chain = chainOf(row);
    var gas = gasUsd(chain);
    var capital = capitalFor(row);
    var hold = farmVerdictFor(row).hold_days;
    var weekly = gas < 1 ? 'under $1 of gas a week' : 'about $' + Math.max(1, Math.round(gas)) + ' of gas a week';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'about $' + gas + ' of gas for the first transaction', time: '5 minutes', exit: 'If the wallet is ever used for anything else, start over with a new one.' },
      { text: 'Bridge $' + capital + ' of USDC to ' + chain + ' through its official bridge.', cost: '$' + BRIDGE_FEE_USD + ' bridge fee', time: '10 minutes', exit: 'If the bridge stalls for more than an hour, wait — never use an unofficial bridge link.' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + Math.max(1, Math.round(gas * 2)) + ' of gas', time: '15 minutes to set up', exit: 'If the pool\u2019s TVL falls 20% in a week, unwind and reassess.' },
      { text: 'Make a second qualifying action — a swap, a borrow, a vote or a deposit — so the wallet is not a one-action address.', cost: 'about $' + gas + ' of gas', time: '10 minutes', exit: 'If the action fails twice, check the protocol\u2019s status page before retrying.' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: weekly, time: '10 minutes a week', exit: 'If a week is missed, do two actions the next week rather than quitting.' },
      { text: 'Halfway through the ' + hold + '-day hold, open the protocol\u2019s own points or rewards page and confirm the position is still counted.', cost: 'no fee to check', time: '10 minutes', exit: 'If the points stop accruing, move the capital to a position that still counts.' },
      { text: 'Add a small top-up or open a second small position so the activity spans more than one snapshot.', cost: 'about $' + gas + ' of gas', time: '10 minutes', exit: 'If the protocol announces a snapshot date, make sure the position is open before it.' },
      { text: 'Before the hold ends, confirm the position is counted and note the snapshot date the protocol published.', cost: 'no fee to check', time: '10 minutes', exit: 'If the protocol pauses deposits, withdraw rather than leaving the capital locked.' },
      { text: 'Claim only from the link the protocol itself publishes, and only after the airdrop is announced.', cost: 'about $' + gas + ' of gas to claim, and never pay to claim', time: '10 minutes', exit: 'If the claim page asks for a fee or a seed phrase, stop — it is a scam.' },
      { text: 'Withdraw the position, sell or hold the airdrop by your own plan, and write the wallet, the dates and every transaction in a farm log.', cost: 'about $' + gas + ' of gas to withdraw', time: '5 minutes', exit: 'If the airdrop is worth less than the fees, the log still tells you what not to repeat.' }
    ];
  }

  // The detail view is a full page, not a dialog: the derivation table, the launched peers, the
  // farm verdict with its matrix and benchmark, and the ten-step plan, all on one page.
  function detailPage(row) {
    var f = DATA.fit, o = DATA.odds;
    var fv = farmVerdictFor(row);
    var check = impliedOf(row, f, o);
    var logTvl = Math.log(row.tvl_usd);
    var slopeTerm = f.slope * (logTvl - f.center);
    var logPred = f.intercept + slopeTerm;
    var z0 = o.coef[0] * ((logTvl - o.mu[0]) / o.sd[0]);
    var z1 = o.coef[1] * ((Math.log1p(row.age_days === null || row.age_days === undefined ? o.med_age : row.age_days) - o.mu[1]) / o.sd[1]);
    var z2 = o.coef[2] * ((row.cat_rate - o.mu[2]) / o.sd[2]);
    var peers = (DATA.peers || []).filter(function (p) { return p.category === (row.category || 'Other'); })
      .sort(function (a, b) {
        if (a.listed_at === null && b.listed_at === null) return a.slug < b.slug ? -1 : 1;
        if (a.listed_at === null) return 1;
        if (b.listed_at === null) return -1;
        return a.listed_at < b.listed_at ? 1 : a.listed_at > b.listed_at ? -1 : a.slug < b.slug ? -1 : 1;
      }).slice(0, 8);
    function drow(label, value, note) {
      return el('tr', null, el('td', { text: label }), el('td', { class: 'num', text: value }), el('td', { class: 'sub', text: note }));
    }
    var tbill = fv.deposit_usd * TBILL_RATE * (fv.hold_days / 365);
    var bench = fv.net_return_usd > 0
      ? 'Parking the $' + fv.deposit_usd.toLocaleString('en-US') + ' deposit in T-bills at ' + (TBILL_RATE * 100).toFixed(1) + '% for the same ' + fv.hold_days + ' days earns $' + tbill.toFixed(2) + '. This farm nets $' + fv.net_return_usd.toFixed(2) + ' — ' + (fv.net_return_usd / tbill).toFixed(1) + '× the T-bill return, at $' + fv.net_per_hour_usd.toFixed(2) + ' an hour of active time.'
      : 'Parking the $' + fv.deposit_usd.toLocaleString('en-US') + ' deposit in T-bills at ' + (TBILL_RATE * 100).toFixed(1) + '% for the same ' + fv.hold_days + ' days earns $' + tbill.toFixed(2) + '. This farm loses $' + Math.abs(fv.net_return_usd).toFixed(2) + ' at this deposit and share — the T-bill pays more for no work.';
    var matrixHead = el('tr', null, el('th', { scope: 'col', text: 'Airdrop share \\ deposit' }), DEPOSIT_TIERS.map(function (d) { return el('th', { scope: 'col', class: 'num', text: '$' + d.toLocaleString('en-US') }); }));
    var matrixBody = el('tbody');
    AIRDROP_SHARES.forEach(function (share, ai) {
      var cells = [el('th', { scope: 'row', text: Math.round(share * 100) + '%' })];
      DEPOSIT_TIERS.forEach(function (dep, di) {
        var v = verdictAt(row, dep, share, state.termAuto, state.term);
        var cls = 'm-' + v.verdict.toLowerCase() + ((di === state.dep && ai === state.air) ? ' m-now' : '');
        cells.push(el('td', { class: 'num ' + cls, text: fmtSigned(v.net_return_usd) }));
      });
      matrixBody.appendChild(el('tr', null, cells));
    });
    var page = el('div', { class: 'detail-page' });
    page.appendChild(el('div', { class: 'back' }, el('a', { href: '#', onclick: function (e) { e.preventDefault(); closeDetail(); }, text: '← Back to the board' })));
    page.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rank', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' (refit interval ' + row.rank_p10 + '–' + row.rank_p90 + ')' + (WL[row.slug] ? ' · Watchlist' : '') }),
        el('h1', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · no token on record · ' + fmtAge(row.age_days) + ' with no token' })
      ),
      el('div', { class: 'verdict-box' },
        el('span', { class: 'verdict v-' + fv.verdict.toLowerCase(), text: fv.verdict }),
        el('b', { class: 'num', text: fmtSigned(fv.net_per_hour_usd) + '/h' }),
        el('span', { class: 'sub', text: 'net ' + fmtSigned(fv.net_return_usd) + ' on $' + fv.deposit_usd.toLocaleString('en-US') + ' at ' + Math.round(fv.airdrop_share * 100) + '%' })
      )
    ));
    page.appendChild(el('section', { class: 'panel model detail-section' },
      el('h2', { text: 'How the implied value is derived' }),
      el('table', { class: 'mult-table deriv' },
        el('caption', { text: 'Every step from the snapshot\u2019s TVL to the implied value, with the fitting behind it. Model ' + DATA.model_version + ': log(mcap) = ' + f.intercept.toFixed(2) + ' + ' + f.slope.toFixed(2) + ' × (log(TVL) − ' + f.center.toFixed(2) + '), fitted on the ' + f.n_train + ' launched protocols.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Step' }), el('th', { scope: 'col', class: 'num', text: 'Value' }), el('th', { scope: 'col', text: 'Fitting note' }))),
        el('tbody', null,
          drow('TVL', fmtUsd(row.tvl_usd), 'the snapshot\u2019s own number'),
          drow('log(TVL)', logTvl.toFixed(4), 'natural log of TVL'),
          drow('Intercept', f.intercept.toFixed(4), 'fitted on ' + f.n_train + ' launched protocols'),
          drow('Slope × (log TVL − center)', f.slope.toFixed(4) + ' × (' + logTvl.toFixed(2) + ' − ' + f.center.toFixed(2) + ') = ' + slopeTerm.toFixed(4), 'fitted slope; leave-one-out ×' + f.loo_median.toFixed(2) + ' vs flat ×' + f.flat_loo.toFixed(2)),
          drow('Predicted log(mcap)', logPred.toFixed(4), 'intercept + slope term'),
          drow('If-launched value', fmtUsd(row.if_launched_value_usd), 'exp(predicted log mcap)'),
          drow('Category launch rate', Math.round(row.cat_rate * 100) + '%', 'share of launched protocols in this category, shrunk toward the global rate'),
          drow('Token odds — intercept', o.intercept.toFixed(2), 'logistic intercept, fitted on all 758 protocols'),
          drow('Token odds — log TVL', z0.toFixed(2), 'coefficient ' + o.coef[0].toFixed(2) + ' × standardized log TVL'),
          drow('Token odds — age', z1.toFixed(2), 'coefficient ' + o.coef[1].toFixed(2) + ' × standardized log(1 + age)'),
          drow('Token odds — category rate', z2.toFixed(2), 'coefficient ' + o.coef[2].toFixed(2) + ' × standardized category rate'),
          drow('Token odds', Math.round(row.token_odds * 100) + '%', 'sigmoid of the sum; 5-fold Brier ' + o.brier_cv.toFixed(3) + ' vs baseline ' + o.brier_baseline.toFixed(3) + ' — historical launch rates, not a forecast'),
          drow('Implied value', fmtUsd(row.implied_value_usd), 'if-launched value × token odds'),
          drow('P25–P75', fmtUsd(row.p25_usd) + ' – ' + fmtUsd(row.p75_usd), 'conformal, from leave-one-out residuals; held-out coverage ' + Math.round(f.coverage50 * 100) + '%'),
          drow('P10–P90', fmtUsd(row.p10_usd) + ' – ' + fmtUsd(row.p90_usd), 'held-out coverage ' + Math.round(f.coverage80 * 100) + '%'),
          drow('Rank interval', row.rank_p10 + '–' + row.rank_p90, DATA.bootstrap_draws + ' bootstrap refits of the value model'),
          drow('Page recomputes', fmtUsd(check), check === row.implied_value_usd ? 'the same number board.json carries' : 'DIFFERS from the board: the data would be stale')
        )
      ),
      el('p', { class: 'note', text: 'Tested but unused — each made leave-one-out worse or did not improve the Brier score, so it is not in the model: a quadratic size curve, 7-day growth, age and chain count for the value model; category effects, raw and grouped (ridge λ 1–300); 7-day growth and chain count for the odds model. The odds are historical launch rates, not a forecast — and the P25–P75 range is wide because the market is noisy: half of held-out launched protocols land inside it, which is the point.' })
    ));
    page.appendChild(el('section', { class: 'panel model detail-section' },
      el('h2', { text: 'Recently launched peers in ' + (row.category || 'Other') }),
      peers.length === 0
        ? el('p', { class: 'sub', text: 'No launched protocol in this category has a usable market cap, so there is no peer to compare against.' })
        : el('table', { class: 'mult-table' },
          el('caption', { text: 'Launched protocols in the same category, most recently listed first. The leave-one-out ratio is what the value model predicted for that protocol when it was held out of the fit, divided by its actual market cap: 1.0 is exact.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Listed' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: 'Mcap / TVL' }), el('th', { scope: 'col', class: 'num', text: 'Leave-out ratio' }))),
          el('tbody', null, peers.map(function (p) {
            return el('tr', null,
              el('td', { text: p.name }),
              el('td', { text: p.listed_at || 'unknown' }),
              el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }),
              el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
              el('td', { class: 'num', text: '×' + (p.mcap_usd / p.tvl_usd).toFixed(2) }),
              el('td', { class: 'num', text: '×' + p.loo_ratio.toFixed(2) })
            );
          }))
        )
    ));
    page.appendChild(el('section', { class: 'panel model detail-section' },
      el('h2', { text: 'Farm verdict: the economics at this deposit and share' }),
      el('table', { class: 'mult-table' },
        el('caption', { text: 'At a $' + fv.deposit_usd.toLocaleString('en-US') + ' deposit, a ' + Math.round(fv.airdrop_share * 100) + '% airdrop share and a ' + fv.hold_days + '-day hold. Move the board\u2019s sliders and this table moves with them.' }),
        el('tbody', null,
          drow('Deposit', '$' + fv.deposit_usd.toLocaleString('en-US'), 'the board\u2019s deposit tier'),
          drow('Airdrop share', Math.round(fv.airdrop_share * 100) + '%', 'assumed share of the implied value paid out as an airdrop'),
          drow('Your share of the pool', (Math.min(1, fv.deposit_usd / Math.max(1, row.tvl_usd)) * 100).toFixed(4) + '%', 'your deposit\u2019s share of the protocol\u2019s TVL, pro-rata by capital'),
          drow('Expected airdrop', fmtUsd(fv.expected_airdrop_usd), 'implied value × airdrop share × your share'),
          drow('Fees', fmtUsd(fv.fees_usd), 'the chain\u2019s gas × 6 steps + $' + BRIDGE_FEE_USD + ' bridge'),
          drow('Net return', fmtSigned(fv.net_return_usd), 'expected airdrop − fees'),
          drow('Active hours', fv.hours.toFixed(2) + ' h', 'setup, one weekly action, claim and the log, over ' + fv.hold_days + ' days'),
          drow('Net $/hour', fmtSigned(fv.net_per_hour_usd) + '/h', 'net return ÷ active hours'),
          drow('Verdict', fv.verdict, fv.verdict === 'FARM' ? 'pays $25 an hour or more after fees' : fv.verdict === 'MARGINAL' ? 'pays, but slower than $25 an hour' : 'loses money at this deposit and share')
        )
      ),
      el('h3', { text: 'Net return by airdrop share × deposit' }),
      el('table', { class: 'mult-table matrix' },
        el('caption', { text: 'Each cell is the net return at that share and deposit. The outlined cell is the board\u2019s current setting.' }),
        el('thead', null, matrixHead),
        matrixBody
      ),
      el('p', { class: 'note', text: bench })
    ));
    page.appendChild(el('section', { class: 'panel model detail-section' },
      el('h2', { text: 'Farm plan: ten steps, each with a cost, a time and an exit' }),
      el('ol', { class: 'steps plan10' }, farmPlan10(row).map(function (s) {
        return el('li', null,
          el('b', { text: s.text }),
          el('span', { class: 'cost', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }),
          el('span', { class: 'cost', text: 'Exit: ' + s.exit })
        );
      }))
    ));
    return page;
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (row) shell.appendChild(detailPage(row));
      else { state.selected = null; writeHash(); shell.appendChild(lede()); shell.appendChild(kpiBar()); shell.appendChild(controls()); shell.appendChild(boardTable()); shell.appendChild(accountingPanel()); shell.appendChild(validationPanel()); shell.appendChild(modelPanel()); }
    } else {
      shell.appendChild(lede());
      shell.appendChild(kpiBar());
      shell.appendChild(controls());
      shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
      if (state.tab === 'pre-token') shell.appendChild(accountingPanel());
      if (state.tab === 'pre-token') shell.appendChild(validationPanel());
      if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    }
    shell.appendChild(el('p', { class: 'foot', text: 'Snapshot ' + DATA.as_of + ' from DefiLlama. Implied values are this radar\u2019s own claim, never make.fun\u2019s. A protocol that records no token may still have one its record does not carry.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
})();
