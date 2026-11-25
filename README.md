# Token Radar (radar-2)

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

An implied value is a guess at what a protocol's token would be worth if it
launched today. It is built from the snapshot's own numbers, never from a
hand-written list of names.

```
implied value = TVL x category multiple x growth multiplier x maturity multiplier
```

The category multiple is the median market-cap-to-TVL ratio of the traded
protocols in the same category, shrunk toward the global median (0.205x)
with a prior of five, and clamped to the range 0.02x to 2.0x. A category
with one traded protocol does not get to set its own multiple; a category
with many does. The multiples are printed in the dashboard's methodology
panel, with the sample size beside each one, so the shrinkage is visible.

The growth multiplier comes from the protocol's seven-day TVL change,
clamped to the range -60% to +120%, with a weight of 0.75. The maturity
multiplier comes from how long the protocol has gone without a token:
0.6 plus up to 0.4 for age, capped at three years. A protocol with no
recorded launch date is treated as one year old.

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

The top of the board is Steakhouse Financial, Sentora Curator and
Gauntlet — risk curators with $1.5B to $2.8B of TVL and no token on
record. The strongest implied value on the board is about $1.46B.

## The farm plan

Every row carries a six-step farm plan. The steps are built from the
protocol's own record, not from a template:

- The first step is always a fresh wallet that holds only the funds the
  reader plans to farm, with its seed phrase kept offline.
- The deposit step names the protocol's own product (a vault, a pool, a
  market) and sizes the deposit from its TVL: $150 for a protocol under
  $500M, $500 up to $2B, $2,000 above that.
- The gas cost is set by the protocol's first chain: about $9 on
  Ethereum, $0.20 on Solana, $1 on the big layer-2s, $2 elsewhere.
- The holding period is set by the protocol's age without a token:
  30 days under a year, 60 days up to two years, 90 days above that.
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
- Sortable columns for rank, TVL, seven-day change, age and implied
  value.
- A detail view for every row, with the model broken down into its
  four factors, the page recomputing the implied value from those
  factors, and the row's farm plan.
- A methodology panel that lists every category multiple with its
  sample size.

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
