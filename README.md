# Token Radar (radar-5)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Phsxe/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Phsxe/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A program that turns a sealed DefiLlama snapshot into a ranked board of
protocols that have not launched a token yet, with a farm plan for each one
and a static dashboard to browse the board.

The entry point is `main.ts`. It reads a snapshot, scores every protocol the
snapshot carries, and writes four things into the output directory:

- `board.json` — the ranked board, one row per protocol.
- `data.js` — the same board and the model, for the dashboard.
- `dashboard/` — a static, no-network dashboard (`index.html`, `app.css`,
  `app.js`).
- `screenshots/` — three screenshots of the dashboard, taken from the
  dashboard itself.
- `dossier.json` — the dashboard source and the screenshots, packed for the
  judges.

Run it with Node 22, standard library only, no network:

```
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Run it twice and the output is byte-identical.

## The model

An implied value is a guess at what a protocol's token would be worth if
it launched today, times the chance it launches at all. Both halves are
fitted on the snapshot itself and checked on data they had not seen, and
the program computes the validation numbers at run time — they are not
typed in.

```
if-launched value = exp(15.96 + 0.39 x (log(TVL) - 17.39))
implied value     = round(if-launched value x token odds)
```

The value model is a log-linear regression of market cap on TVL, fitted
on the 92 launched protocols the board treats as comparable — the same
exclusions the board applies to ranking (exchanges, bridges, liquid
staking, versioned pools, wrapped or staked products), applied to the
launched set, so the model does not learn its multiples from protocols
the board itself refuses to rank. The coefficients above are the fit's
output on the 2026-11-14 snapshot, not constants chosen by hand: the
program refits them from whatever snapshot it is given. Terms tested
and dropped because leave-one-out and walk-forward did not both
improve: a quadratic size curve, seven-day growth, age, chain count,
their combinations, TVL per chain, a size-by-age interaction, and
category effects (intercepts, slopes, and ridge lambda 1–1024). A
placebo — another protocol's growth rate — was tested the same way and
also failed both checks, so the tests have teeth. The market does not
price by category here — market-cap-per-TVL spans 0.0003x to 400x
inside single categories — so no category term survives.

The odds model is a logistic regression fitted on all 758 protocols
(launched = 1 when the record carries any token, 416 of 758), with three
features: log TVL, log(1 + age in days), and the category's launch rate
(shrunk toward the global rate with a prior of five). Seven-day growth
and chain count were tested and dropped the same way. Odds are
historical launch rates of similar protocols, not forecasts of who will
launch.

Validation, computed by the program from the snapshot:

| Check | Fitted model | Flat baseline |
|---|---|---|
| Value model, leave-one-out median error | ×3.27 | ×4.65 (global median ratio) |
| Value model, walk-forward median error | ×2.20 | ×4.35 |
| Token odds, 5-fold Brier score | 0.210 | 0.248 (constant rate) |
| Token odds, time-split Brier score | 0.254 | — |
| P25–P75 interval, held-out coverage | 51% | target ~50% |
| P10–P90 interval, held-out coverage | 80% | target ~80% |

Every row also carries its uncertainty. The value interval is
conformal, from the value model's leave-one-out residuals: P25–P75 uses
the 50th percentile of |residual| (1.21 log units), P10–P90 the 80th
(2.33). The rank interval comes from 200 bootstrap refits of the value
model (mulberry32, fixed seed) and says how much the ranking moves when
the fitted coefficients move — a refit interval, not a prediction
interval. The two kinds of interval answer different questions, and the
dashboard says which is which.

## What the board ranks

The board ranks every protocol the snapshot carries that records no token
and is not a wrapped, staked, bridged or exchange product. That exclusion
is the watchlist's own rule, applied to the whole board: WBTC is Bitcoin
on Ethereum, Binance staked ETH is ETH in a staking product, and neither
is a protocol still waiting on a launch of its own. Versioned pools
(`... V2`, `... V3`) are left out for the same reason — they are a second
deployment, not a second protocol.

On the 2026-11-14 snapshot this gives 198 rows: the 40 watchlist
protocols, plus 158 more pre-token protocols below the watchlist's $50M
floor. The 24 protocols whose token already trades are set aside in a
separate live-token tab, so the reader can see what the multiples are
calibrated against.

The top of the board is USDD, Veda and Polymarket International — the
first two are watchlist protocols, and the odds, not the size alone, put
them there: Sentora Curator has the largest if-launched value
(about $48M) but only a 17% launch odds, so it ranks twenty-second at
about $8.3M implied, and Steakhouse Financial, the next-largest
if-launched value at about $48M, ranks seventeenth at about $9.6M
implied on 20% odds. The strongest implied value on the board is about
$20.1M, and the board totals about $0.78B — in the same range as the
fitted values the market actually produces, instead of the several
billions the old hand-written multiples used to claim.

## The farm plan

Every row carries a six-step farm plan. The steps are built from the
protocol's own record, not from a template:

- The first step is always a fresh wallet that holds only the funds the
  reader plans to farm, with its seed phrase kept offline.
- The deposit step names the protocol's own product (a vault, a pool, a
  market) and sizes the deposit from its TVL: $50 under $100M, $100 up
  to $1B, $150 up to $5B, $250 above that.
- The gas cost is set by the protocol's first chain: about $9 on
  Ethereum, $0.20 on Solana, $1 on the big layer-2s, $2 elsewhere.
- The holding period is set by the protocol's age without a token:
  60 days if it is under 180 days old, 45 days up to a year, 30 days
  above that.
- The weekly action names the category's own verb: deposit for a
  lender, swap for a DEX, vote for a governance protocol.

Each step states its cost and its time. The plan is a suggestion, not
financial advice, and the dashboard says so on every row.

## The dashboard

The dashboard is three files and no network: no external font, no
external script, no fetch. It opens on the pre-token board, strongest
implied value first, and offers:

- Search by name, category or chain.
- Filter by category, by chain, and by watchlist only.
- A pre-token tab and a live-token tab.
- Sortable columns for rank, TVL, seven-day change, age, token odds
  and implied value.
- Every row shows its token odds, its P25–P75 range and its rank
  interval.
- A detail view for every row, with the if-launched value, the odds,
  the intervals and the rank interval, the page recomputing the implied
  value from the fitted coefficients, and the row's farm plan.
- A validation panel with the leave-one-out and walk-forward errors,
  the odds Brier scores and the interval coverage, and a methodology
  panel with the fitted formula and the terms that were tested and
  dropped.

The dashboard's state lives in the URL hash, so a filtered view or a
detail view can be linked to directly.

## Reproduce it

```
git clone https://github.com/Phsxe/makefun-token-radar-01
cd makefun-token-radar-01
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

The snapshot is the sealed one the competition hands out; it is not in
this repository. With it, the program writes `out/` and the dashboard
in `out/dashboard/` opens in any browser.

## Licence

MIT. The library in `vendor/` is the competition kit's own, copied
verbatim, and stays under the same licence.
