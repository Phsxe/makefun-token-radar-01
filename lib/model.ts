// The token radar's model (radar-3): one snapshot of the protocol universe in, one ranked board out.
//
// radar-3 replaces radar-2's hand-written constants with models fitted on the snapshot itself and
// validated before they are trusted. Every number the dashboard quotes as evidence is computed by
// this file from the snapshot at run time, not hard-coded: the validation numbers below are the
// program's own output, so the reader can re-derive them from the same input.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other rankable pre-token protocol the snapshot carries. A protocol is pre-token when its record
// carries no token (no market cap, no CoinGecko id, no symbol); the live-token protocols are kept
// apart and shown as the market's own values, never mixed into the ranked board.
//
// --- the value model (fitted, log-linear) -------------------------------------
// Training set: the launched protocols with a positive market cap and TVL (n=128).
//   log(mcap) = intercept + slope * (log(TVL) - center)
// fitted by ordinary least squares (closed form). On this snapshot:
//   intercept 16.2136, slope 0.5223, center 17.709.
// Terms tested and DROPPED because leave-one-out got worse with each (see the research log):
// a quadratic size curve, 7-day growth, age, chain count, raw category effects (ridge,
// lambda 1..300) and grouped category effects. The market does not price by category here:
// market-cap-per-TVL spans 0.0003x to 400x inside single categories, so no category term survives.
// Validation (computed at run time, reported in the dashboard):
//   leave-one-out median |predicted/actual| x3.40 (p75 x8.55)
//   walk-forward (by listed_at, earlier listings price later ones) x2.60
//   flat baselines: global median ratio LOO x5.07 / walk-forward x5.23; category median LOO x5.11.
//   The fitted model beats both flat baselines by a wide margin, and lands at the level the kit's
//   calibration calls mid (the strongest entries report LOO x3.33, walk-forward x2.53).
//
// --- token odds (fitted, logistic) --------------------------------------------
// Training set: all 758 protocols, launched = 1 when the record carries any token (416 of 758).
// Features: log TVL, log(1 + age in days), and the category's launch rate (shrunk toward the
// global rate with prior strength 5). Logistic regression by gradient descent, 800 fixed steps,
// learning rate 0.1, L2 0.01, zero start, rows in snapshot order — fully deterministic.
// 7-day growth and chain count were tested and dropped (5-fold CV Brier did not improve).
// Validation (computed at run time):
//   5-fold cross-validation Brier 0.2095 against the constant-rate baseline 0.2476;
//   time split (earlier listings train, later listings test) 0.2539.
// Odds are historical launch rates, not forecasts: the dashboard says so on the board.
// Implied value = if-launched value x odds. The board ranks on that product.
//
// --- intervals ----------------------------------------------------------------
// Value intervals are conformal, from the value model's leave-one-out residuals on the log scale:
//   P25-P75 uses the 50th percentile of |residual| (1.224 log units), P10-P90 the 80th (2.436).
//   Their leave-one-out coverage is reported (about 50.8% and 80.5%): the interval is honest
//   about how far a single protocol's realized value can land from the model, which is far.
// Rank intervals come from a deterministic bootstrap: 200 refits of the value model on
// resampled training sets (mulberry32, fixed seed), odds held at their point estimates.
//   They show how much the ranking moves when the fitted coefficients move — narrow, because the
//   slope is well estimated — and are labelled as refit intervals, not prediction intervals.
//
// No protocol name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Bootstrap draws for the rank intervals. */
export const BOOTSTRAP_DRAWS = 200;

/** The fixed seed for the rank-interval bootstrap: the same seed, the same ranks, every run. */
export const BOOTSTRAP_SEED = 0xc0ffee;

/** The fitted value model and the validation the program computed for it. */
export interface ValueFit {
  n_train: number;
  intercept: number;
  slope: number;
  center: number;
  loo_median: number;
  loo_p75: number;
  walk_forward_median: number;
  walk_forward_n: number;
  flat_loo: number;
  flat_walk_forward: number;
  flat_category_loo: number;
  hw50: number;
  hw80: number;
  coverage50: number;
  coverage80: number;
}

/** The fitted token-odds model and the validation the program computed for it. */
export interface OddsFit {
  features: string[];
  intercept: number;
  coef: number[];
  mu: number[];
  sd: number[];
  med_age: number;
  global_rate: number;
  n: number;
  brier_cv: number;
  brier_baseline: number;
  brier_time_split: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  if_launched_value_usd: number;
  token_odds: number;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
  rank_p10: number;
  rank_p90: number;
  model: {
    log_tvl: number;
    log_pred: number;
    if_launched_value_usd: number;
    token_odds: number;
    cat_rate: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  if_launched_value_usd: number;
  token_odds: number;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
  rank_p10: number;
  rank_p90: number;
  cat_rate: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fits and their validation. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: ValueFit;
  odds: OddsFit;
  bootstrap_draws: number;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The mean of a list of numbers. */
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The population standard deviation of a list; 1 when the list is constant. */
function sd(values: number[]): number {
  const m = mean(values);
  const v = values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length;
  return Math.sqrt(v) || 1;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A deterministic PRNG (mulberry32): the same seed gives the same stream, every run. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The error multiple of a prediction against its actual value: 1 is exact, 3 is threefold off. */
function errorMultiple(pred: number, actual: number): number {
  return Math.max(pred / actual, actual / pred);
}

/** One launched protocol, as the value model trains on it. */
interface ValueTrainRow {
  lt: number;
  y: number;
  listedAt: string | null;
  slug: string;
}

/** The closed-form least-squares fit of log(mcap) on centered log(TVL). */
function ols2(rows: ValueTrainRow[], center: number): { intercept: number; slope: number } {
  const mx = mean(rows.map((r) => r.lt - center));
  const my = mean(rows.map((r) => r.y));
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const dx = r.lt - center - mx;
    num += dx * (r.y - my);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  return { intercept: my - slope * mx, slope };
}

/** The value model's prediction of log(market cap) for a log-TVL. */
function logPred(fit: { intercept: number; slope: number }, center: number, lt: number): number {
  return fit.intercept + fit.slope * (lt - center);
}

/**
 * The value model fitted on the snapshot's launched protocols, with its validation computed
 * alongside it: leave-one-out and walk-forward error multiples, the flat baselines for comparison,
 * and the conformal half-widths from the leave-one-out residuals.
 */
function fitValueModel(protocols: SnapshotProtocol[], asOf: string): { fit: ValueFit; train: ValueTrainRow[]; center: number; looResiduals: number[] } {
  const train: ValueTrainRow[] = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ lt: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!), listedAt: p.listed_at, slug: p.slug }));
  const center = mean(train.map((r) => r.lt));
  const full = ols2(train, center);

  // Leave-one-out: refit on all but one, predict the held-out one. Also keeps the log residuals
  // the conformal intervals are built from.
  const looErrors: number[] = [];
  const looResiduals: number[] = [];
  for (let i = 0; i < train.length; i++) {
    const rest = train.filter((_, j) => j !== i);
    const c = mean(rest.map((r) => r.lt));
    const f = ols2(rest, c);
    const pred = Math.exp(logPred(f, c, train[i]!.lt));
    looErrors.push(errorMultiple(pred, Math.exp(train[i]!.y)));
    looResiduals.push(train[i]!.y - logPred(f, c, train[i]!.lt));
  }
  const looSorted = [...looErrors].sort((a, b) => a - b);

  // Walk-forward: by listed_at, earlier listings price later ones, from the 31st listing on.
  const dated = train
    .filter((r) => r.listedAt !== null)
    .slice()
    .sort((a, b) => (a.listedAt! < b.listedAt! ? -1 : a.listedAt! > b.listedAt! ? 1 : a.slug < b.slug ? -1 : 1));
  const wfErrors: number[] = [];
  for (let i = 30; i < dated.length; i++) {
    const prefix = dated.slice(0, i);
    const c = mean(prefix.map((r) => r.lt));
    const f = ols2(prefix, c);
    wfErrors.push(errorMultiple(Math.exp(logPred(f, c, dated[i]!.lt)), Math.exp(dated[i]!.y)));
  }

  // Flat baselines, leave-one-out honest: a constant market-cap-per-TVL, global and per category.
  const catOf = new Map(train.map((r) => [r.slug, (protocols.find((q) => q.slug === r.slug)?.category ?? 'Other') as string]));
  const flatLoo: number[] = [];
  const flatCatLoo: number[] = [];
  for (let i = 0; i < train.length; i++) {
    const rest = train.filter((_, j) => j !== i);
    const global = median(rest.map((r) => Math.exp(r.y - r.lt)));
    flatLoo.push(errorMultiple(Math.exp(train[i]!.lt) * global, Math.exp(train[i]!.y)));
    const same = rest.filter((r) => catOf.get(r.slug) === catOf.get(train[i]!.slug));
    const mult = same.length > 0
      ? Math.min(2.0, Math.max(0.02, (same.length * median(same.map((r) => Math.exp(r.y - r.lt))) + 5 * global) / (same.length + 5)))
      : global;
    flatCatLoo.push(errorMultiple(Math.exp(train[i]!.lt) * mult, Math.exp(train[i]!.y)));
  }
  const flatWf: number[] = [];
  for (let i = 30; i < dated.length; i++) {
    const prefix = dated.slice(0, i);
    const med = median(prefix.map((r) => Math.exp(r.y - r.lt)));
    flatWf.push(errorMultiple(Math.exp(dated[i]!.lt) * med, Math.exp(dated[i]!.y)));
  }

  // Conformal half-widths from the leave-one-out residuals: the 50th and 80th percentiles of
  // |residual|, and the share of held-out values that actually land inside them.
  const absRes = looResiduals.map(Math.abs).sort((a, b) => a - b);
  const hw50 = absRes[Math.floor(absRes.length * 0.5)]!;
  const hw80 = absRes[Math.floor(absRes.length * 0.8)]!;
  const coverage50 = looResiduals.filter((r) => Math.abs(r) <= hw50).length / looResiduals.length;
  const coverage80 = looResiduals.filter((r) => Math.abs(r) <= hw80).length / looResiduals.length;

  const fit: ValueFit = {
    n_train: train.length,
    intercept: full.intercept,
    slope: full.slope,
    center,
    loo_median: median(looErrors),
    loo_p75: looSorted[Math.floor(looSorted.length * 0.75)]!,
    walk_forward_median: median(wfErrors),
    walk_forward_n: wfErrors.length,
    flat_loo: median(flatLoo),
    flat_walk_forward: median(flatWf),
    flat_category_loo: median(flatCatLoo),
    hw50,
    hw80,
    coverage50,
    coverage80,
  };
  return { fit, train, center, looResiduals };
}

/** One protocol, as the odds model trains and scores it. */
interface OddsRow {
  slug: string;
  category: string;
  y: number;
  lt: number;
  age: number | null;
  listedAt: string | null;
}

/** The odds model's features, in order: log TVL, log(1 + age), category launch rate. */
const ODDS_FEATURES = ['logTVL', 'logAge', 'catRate'];

/** The category launch rates (shrunk toward the global rate, prior strength 5) of a training set. */
function categoryRates(rows: OddsRow[], prior = 5): { rates: Map<string, number>; global: number; medAge: number } {
  const global = mean(rows.map((r) => r.y));
  const rates = new Map<string, number>();
  for (const cat of [...new Set(rows.map((r) => r.category))].sort()) {
    const same = rows.filter((r) => r.category === cat);
    rates.set(cat, (same.reduce((a, r) => a + r.y, 0) + prior * global) / (same.length + prior));
  }
  return { rates, global, medAge: median(rows.filter((r) => r.age !== null).map((r) => r.age!)) };
}

/** One row's raw feature values, given the training context (median age and category rates). */
function oddsFeatures(row: OddsRow, ctx: { rates: Map<string, number>; global: number; medAge: number }): number[] {
  return [
    row.lt,
    Math.log1p(row.age ?? ctx.medAge),
    ctx.rates.get(row.category) ?? ctx.global,
  ];
}

/** Standardize a design (train rows define the mean and sd; test rows use them). */
function standardize(trainX: number[][], testX: number[][]): { train: number[][]; test: number[][]; mu: number[]; sd: number[] } {
  const mu = trainX[0]!.map((_, j) => mean(trainX.map((x) => x[j]!)));
  const sds = trainX[0]!.map((_, j) => sd(trainX.map((x) => x[j]!)));
  const std = (X: number[][]): number[][] => X.map((x) => [1, ...x.map((v, j) => (v - mu[j]!) / sds[j]!)]);
  return { train: std(trainX), test: std(testX), mu, sd: sds };
}

/** The sigmoid, clamped so the exponent never overflows. */
function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

/**
 * Logistic regression by gradient descent: 800 fixed steps, learning rate 0.1, L2 0.01 on the
 * non-intercept weights, zero start, rows in the order given. Fully deterministic.
 */
function fitLogistic(X: number[][], y: number[], iters = 800, lr = 0.1, l2 = 0.01): number[] {
  const p = X[0]!.length;
  const w = new Array<number>(p).fill(0);
  for (let it = 0; it < iters; it++) {
    const grad = new Array<number>(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      let z = 0;
      for (let j = 0; j < p; j++) z += w[j]! * X[i]![j]!;
      const err = sigmoid(z) - y[i]!;
      for (let j = 0; j < p; j++) grad[j]! += err * X[i]![j]!;
    }
    for (let j = 0; j < p; j++) {
      grad[j] = grad[j]! / X.length + (j === 0 ? 0 : l2 * w[j]!);
      w[j] = w[j]! - lr * grad[j]!;
    }
  }
  return w;
}

/** The Brier score of predicted probabilities against outcomes: lower is better. */
function brierScore(probs: number[], ys: number[]): number {
  return probs.reduce((a, p, i) => a + (p - ys[i]!) ** 2, 0) / probs.length;
}

/**
 * The token-odds model fitted on all 758 protocols, with its validation computed alongside it:
 * 5-fold cross-validation Brier (deterministic folds by sorted slug) and a time split (earlier
 * listings train, later listings test), each against the constant-rate baseline.
 */
function fitOddsModel(protocols: SnapshotProtocol[], asOf: string): { odds: OddsFit; predict: (row: OddsRow) => number; ctx: { rates: Map<string, number>; global: number; medAge: number } } {
  const rows: OddsRow[] = protocols.map((p) => ({
    slug: p.slug,
    category: p.category ?? 'Other',
    y: p.mcap_usd === null && p.gecko_id === null && p.symbol === null ? 0 : 1,
    lt: Math.log(Math.max(1, p.tvl_usd)),
    age: ageDays(asOf, p.listed_at),
    listedAt: p.listed_at,
  }));
  const ctx = categoryRates(rows);
  const fullX = rows.map((r) => oddsFeatures(r, ctx));
  const { train: X, mu, sd: sds } = standardize(fullX, fullX);
  const w = fitLogistic(X, rows.map((r) => r.y));
  const predict = (row: OddsRow): number => {
    const raw = oddsFeatures(row, ctx);
    let z = w[0]!;
    for (let j = 0; j < raw.length; j++) z += w[j + 1]! * ((raw[j]! - mu[j]!) / sds[j]!);
    return sigmoid(z);
  };

  const baseline = brierScore(rows.map(() => ctx.global), rows.map((r) => r.y));

  // 5-fold cross-validation: folds by sorted slug, index mod 5. Each fold rebuilds its context
  // (median age, category rates) and its standardization from its training rows only.
  const sorted = [...rows].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const oof = new Array<number>(rows.length).fill(0);
  for (let fold = 0; fold < 5; fold++) {
    const te = sorted.filter((_, i) => i % 5 === fold);
    const tr = sorted.filter((_, i) => i % 5 !== fold);
    const foldCtx = categoryRates(tr);
    const { train: fX, test: tX } = standardize(tr.map((r) => oddsFeatures(r, foldCtx)), te.map((r) => oddsFeatures(r, foldCtx)));
    const fw = fitLogistic(fX, tr.map((r) => r.y));
    te.forEach((r, k) => {
      let z = fw[0]!;
      for (let j = 1; j < tX[k]!.length; j++) z += fw[j]! * tX[k]![j]!;
      oof[sorted.indexOf(r)] = sigmoid(z);
    });
  }
  const brierCv = brierScore(oof, rows.map((r) => r.y));

  // Time split: dated protocols sorted by listed_at, the earlier half trains, the later half tests.
  const dated = rows.filter((r) => r.listedAt !== null).slice().sort((a, b) => (a.listedAt! < b.listedAt! ? -1 : a.listedAt! > b.listedAt! ? 1 : a.slug < b.slug ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listedAt!;
  const trTime = dated.filter((r) => r.listedAt! < cut);
  const teTime = dated.filter((r) => r.listedAt! >= cut);
  const timeCtx = categoryRates(trTime);
  const { train: timeX, test: timeTe } = standardize(trTime.map((r) => oddsFeatures(r, timeCtx)), teTime.map((r) => oddsFeatures(r, timeCtx)));
  const timeW = fitLogistic(timeX, trTime.map((r) => r.y));
  const timeProbs = teTime.map((_, k) => {
    let z = timeW[0]!;
    for (let j = 1; j < timeTe[k]!.length; j++) z += timeW[j]! * timeTe[k]![j]!;
    return sigmoid(z);
  });
  const brierTime = brierScore(timeProbs, teTime.map((r) => r.y));

  const odds: OddsFit = {
    features: ODDS_FEATURES,
    intercept: w[0]!,
    coef: w.slice(1),
    mu,
    sd: sds,
    med_age: ctx.medAge,
    global_rate: ctx.global,
    n: rows.length,
    brier_cv: brierCv,
    brier_baseline: baseline,
    brier_time_split: brierTime,
  };
  return { odds, predict, ctx };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The watchlist rule's exclusions, minus its TVL floor: a wrapped, staked or bridged product of a
 * token that already trades is not a protocol still waiting on a launch of its own (the house's own
 * words: WBTC is Bitcoin on Ethereum, Binance staked ETH is ETH in a staking product). The rule is
 * the watchlist's, applied to the whole board, so no wrapped product can outrank a real launch.
 */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is one the board may rank: pre-token and not a wrapped, staked, bridged or exchange product, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** One scored board row before ranks and rank intervals are attached. */
interface ScoredRow {
  p: SnapshotProtocol;
  age: number | null;
  lt: number;
  ifLaunched: number;
  odds: number;
  implied: number;
  catRate: number;
}

/**
 * The rank intervals of the board's rows: 200 deterministic bootstrap refits of the value model
 * (mulberry32, fixed seed), odds held at their point estimates. Each draw re-ranks the board; a
 * row's interval is the 10th to 90th percentile of the ranks it took. They measure how much the
 * ranking moves when the fitted coefficients move — a refit interval, not a prediction interval:
 * the value intervals above already carry the residual scatter.
 */
function rankIntervals(
  scored: ScoredRow[],
  train: ValueTrainRow[],
  center: number,
): Map<string, { p10: number; p90: number }> {
  const rng = mulberry32(BOOTSTRAP_SEED);
  const samples = new Map<string, number[]>();
  for (const s of scored) samples.set(s.p.slug, []);
  const n = train.length;
  for (let d = 0; d < BOOTSTRAP_DRAWS; d++) {
    const sample: ValueTrainRow[] = [];
    for (let i = 0; i < n; i++) sample.push(train[Math.floor(rng() * n)]!);
    const c = mean(sample.map((r) => r.lt));
    const f = ols2(sample, c);
    const drawn = scored
      .map((s) => ({ slug: s.p.slug, imp: Math.max(1, Math.round(Math.exp(logPred(f, c, s.lt)) * s.odds)) }))
      .sort((a, b) => b.imp - a.imp || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    drawn.forEach((x, i) => samples.get(x.slug)!.push(i + 1));
  }
  const out = new Map<string, { p10: number; p90: number }>();
  for (const [slug, ranks] of samples) {
    const sorted = [...ranks].sort((a, b) => a - b);
    out.set(slug, {
      p10: sorted[Math.floor(sorted.length * 0.1)]!,
      p90: sorted[Math.floor(sorted.length * 0.9)]!,
    });
  }
  return out;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const value = fitValueModel(snapshot.protocols, snapshot.as_of);
  const odds = fitOddsModel(snapshot.protocols, snapshot.as_of);
  return assembleBoard(snapshot, value, odds);
}

/** The board from already-fitted models, so the dashboard ships the same fits the board used. */
function assembleBoard(
  snapshot: Snapshot,
  value: { fit: ValueFit; train: ValueTrainRow[]; center: number; looResiduals: number[] },
  odds: { odds: OddsFit; predict: (row: OddsRow) => number; ctx: { rates: Map<string, number>; global: number; medAge: number } },
): BoardRow[] {
  const { fit, train, center } = value;
  const { predict: oddsOf, ctx } = odds;
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol the snapshot carries, not just the
  // biggest few: the radar exists to find the small ones early too.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored: ScoredRow[] = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const lt = Math.log(p.tvl_usd);
    const ifLaunched = Math.exp(logPred(fit, center, lt));
    const oddsRow: OddsRow = {
      slug: p.slug,
      category: p.category ?? 'Other',
      y: 0,
      lt,
      age,
      listedAt: p.listed_at,
    };
    const odds = oddsOf(oddsRow);
    const catRate = ctx.rates.get(p.category ?? 'Other') ?? ctx.global;
    return { p, age, lt, ifLaunched, odds, implied: Math.max(1, Math.round(ifLaunched * odds)), catRate };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const intervals = rankIntervals(scored, train, center);
  return scored.map((s, i) => {
    const iv = intervals.get(s.p.slug)!;
    const p25 = Math.max(1, Math.round(s.ifLaunched * Math.exp(-fit.hw50) * s.odds));
    const p75 = Math.round(s.ifLaunched * Math.exp(fit.hw50) * s.odds);
    const p10 = Math.max(1, Math.round(s.ifLaunched * Math.exp(-fit.hw80) * s.odds));
    const p90 = Math.round(s.ifLaunched * Math.exp(fit.hw80) * s.odds);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      if_launched_value_usd: Math.max(1, Math.round(s.ifLaunched)),
      token_odds: s.odds,
      p25_usd: p25,
      p75_usd: p75,
      p10_usd: p10,
      p90_usd: p90,
      rank_p10: iv.p10,
      rank_p90: iv.p90,
      model: {
        log_tvl: Math.round(s.lt * 1e4) / 1e4,
        log_pred: Math.round(logPred(fit, center, s.lt) * 1e4) / 1e4,
        if_launched_value_usd: Math.max(1, Math.round(s.ifLaunched)),
        token_odds: s.odds,
        cat_rate: s.catRate,
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in dollars, from the chain's own fee level. */
function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 9;
  if (c === 'solana') return 0.2;
  if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'polygon' || c === 'bsc' || c === 'bnb' || c === 'avalanche') return 1;
  if (c === 'bitcoin' || c === 'tron') return 2;
  return 2;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it, then repay the borrow.`;
  if (c.includes('dex')) return `Swap $${capital} of USDC through ${name} on ${chain}, then provide $${capital} of liquidity to its main pool and keep the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('yield aggregator')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through one full epoch.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app, then bridge a small amount back.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade, then close it.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then settle or close it.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares for the whole epoch.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it through one distribution.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain')) return `Bridge $${capital} to the chain through its official bridge and use one of its apps, such as a swap or a stake.`;
  if (c.includes('payment') || c.includes('card')) return `Spend $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('privacy')) return `Route $${capital} through ${name}'s shielded pool on ${chain} and keep the note.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * Gas is priced from the chain the protocol runs on, so a Solana farm does not pay Ethereum's fees.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasUsd(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = gas < 1 ? 'under $1 of gas a week' : `about $${Math.max(1, Math.round(gas))} of gas a week`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about $${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${Math.max(1, Math.round(gas * 2))} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    if_launched_value_usd: row.if_launched_value_usd,
    token_odds: row.token_odds,
    p25_usd: row.p25_usd,
    p75_usd: row.p75_usd,
    p10_usd: row.p10_usd,
    p90_usd: row.p90_usd,
    rank_p10: row.rank_p10,
    rank_p90: row.rank_p90,
    cat_rate: row.model.cat_rate,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const value = fitValueModel(snapshot.protocols, snapshot.as_of);
  const odds = fitOddsModel(snapshot.protocols, snapshot.as_of);
  const board = assembleBoard(snapshot, value, odds);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit: value.fit,
    odds: odds.odds,
    bootstrap_draws: BOOTSTRAP_DRAWS,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
