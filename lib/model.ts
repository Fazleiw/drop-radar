// Drop Radar's value model: one sealed snapshot in, one ranked board out. Standard library only.
//
// Idea: a protocol with no token is priced the way the market already prices its peers. The snapshot
// itself carries every protocol whose token trades (mcap_usd set), so each category gets a market
// multiple, median(mcap / TVL) of its own trading peers, shrunk toward the whole market's median when the
// category has few peers. No protocol name is special-cased anywhere: the same function scores every row.
//
//   peer multiple  m  = (n * median_category + K * median_market) / (n + K), clamped to [M_MIN, M_MAX]
//   momentum       gm = 1 + G_WEIGHT * clamp(change_7d, G_FLOOR, G_CAP) / 100
//   runway         rf = R_FLOOR + R_RANGE * min(age_days, R_DAYS) / R_DAYS     (age unknown: R_UNKNOWN days)
//   reach          cb = 1 + C_STEP * min(chains - 1, C_CAP)
//   implied FDV    v  = round(tvl * m * gm * rf * cb)
//
// The farmer's figure follows from it: an airdrop pool of DROP_SHARE of the implied FDV, spread over the
// TVL that farms it today, is what each $1,000 deposited could earn (drop_per_1k). The board ranks by v;
// the dashboard also sorts by drop_per_1k, the column a farmer acts on.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL = {
  version: 'drop-radar-2',
  shrink_k: 4,
  multiple_min: 0.04,
  multiple_max: 2.5,
  ratio_clip_min: 0.005,
  ratio_clip_max: 6,
  growth_weight: 0.5,
  growth_floor: -40,
  growth_cap: 60,
  runway_floor: 0.8,
  runway_range: 0.4,
  runway_days: 1095,
  runway_unknown_days: 365,
  chain_step: 0.03,
  chain_cap: 10,
  drop_share: 0.075,
} as const;

/**
 * Below the floor, the board applies the house's own product rule (all but the TVL floor), so a wrapped,
 * staked or bridged product of a token that already trades never reads as an early launch: WBTC and
 * USDT0 record no token of their own, yet each is a product of one that trades.
 */
const NOT_FARMABLE = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b|\s(v\d+|\d+\.\d+)$/i;
const WRAPPED_TICKER = /^(w|st|ws|usd)[a-z]*\d*$/i;

/** True when a below-floor protocol is a product of a token that trades, by the house rule's own tests. */
export function isDerivativeProduct(p: SnapshotProtocol): boolean {
  if (NOT_FARMABLE.has(p.category ?? '')) return true;
  if (EXCHANGE_PREFIX.test(p.name) || PRODUCT_NAME.test(p.name)) return true;
  // A one-word name that is a wrapper's ticker (WBTC, USDT0, stETH-like) with no category to say otherwise.
  return p.category === null && WRAPPED_TICKER.test(p.name) && !/\s/.test(p.name);
}

export interface FarmStep { text: string; cost: string; time: string }

export interface Factor { key: string; label: string; value: number; note: string }

export interface Row {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl: number;
  ch7: number | null;
  age: number | null;
  listed: string | null;
  watch: boolean;
  multiple: number;
  peers: number;
  factors: Factor[];
  implied: number;
  pool: number;
  per1k: number;
  conf: 'high' | 'medium' | 'low';
  rank: number;
  steps: FarmStep[];
  plan_cost: string;
  plan_time: string;
}

export interface BoardRow { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }

export interface LiveRow { slug: string; name: string; category: string; tvl: number; mcap: number; ratio: number; symbol: string | null }

export interface CategoryMultiple { category: string; peers: number; median: number | null; multiple: number }

export interface RadarData {
  as_of: string;
  source: string;
  floor: number;
  model: typeof MODEL;
  market_median: number;
  universe: number;
  live_count: number;
  pre_count: number;
  rows: Row[];
  live: LiveRow[];
  categories: CategoryMultiple[];
}

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (!s || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw new Error('snapshot: protocols and watchlist are required');
  return s;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((p, q) => p - q);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.max(0, Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Each category's market multiple from its own trading peers, shrunk toward the market median. */
export function categoryMultiples(snapshot: Snapshot): { market: number; table: Map<string, CategoryMultiple> } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = clamp(p.mcap_usd / p.tvl_usd, MODEL.ratio_clip_min, MODEL.ratio_clip_max);
    const cat = p.category ?? 'Uncategorised';
    if (!ratios.has(cat)) ratios.set(cat, []);
    ratios.get(cat)!.push(r);
    all.push(r);
  }
  const market = median(all) ?? 0.2;
  const table = new Map<string, CategoryMultiple>();
  const cats = new Set<string>(snapshot.protocols.map((p) => p.category ?? 'Uncategorised'));
  for (const cat of [...cats].sort()) {
    const rs = ratios.get(cat) ?? [];
    const med = median(rs);
    const n = rs.length;
    const k = MODEL.shrink_k;
    const blended = med === null ? market : (n * med + k * market) / (n + k);
    table.set(cat, { category: cat, peers: n, median: med === null ? null : round4(med), multiple: round4(clamp(blended, MODEL.multiple_min, MODEL.multiple_max)) });
  }
  return { market: round4(market), table };
}

// ---------------------------------------------------------------- farm plans

type Playbook = 'vault' | 'lend' | 'dex' | 'perp' | 'rwa' | 'bridge' | 'chain' | 'stake' | 'pay' | 'generic';

export function playbookFor(category: string): Playbook {
  const c = category.toLowerCase();
  if (/risk curator|capital allocator|yield|basis|liquidity manager|leveraged farming|farm|options vault|indexes|governance incentives/.test(c)) return 'vault';
  if (/lending|cdp|collateral|uncollateralized|stablecoin/.test(c)) return 'lend';
  if (/dex/.test(c)) return 'dex';
  if (/derivative|prediction|options|perp/.test(c)) return 'perp';
  if (/rwa|otc|cedefi/.test(c)) return 'rwa';
  if (/bridge/.test(c)) return 'bridge';
  if (/^chain$|rollup/.test(c)) return 'chain';
  if (/staking|restak|btc/.test(c)) return 'stake';
  if (/payment|card|privacy/.test(c)) return 'pay';
  return 'generic';
}

interface Gas { label: string; perTx: number }

/** Typical cost of one transaction on the protocol's cheapest listed chain (a stated assumption, USD). */
export function gasFor(chains: string[]): { chain: string; gas: Gas } {
  const table: Record<string, Gas> = {
    Solana: { label: 'under $0.01', perTx: 0.005 },
    Sui: { label: 'about $0.01', perTx: 0.01 },
    Aptos: { label: 'about $0.01', perTx: 0.01 },
    Base: { label: 'about $0.05', perTx: 0.05 },
    Arbitrum: { label: 'about $0.08', perTx: 0.08 },
    Optimism: { label: 'about $0.05', perTx: 0.05 },
    Hyperliquid: { label: 'about $0.05', perTx: 0.05 },
    'Hyperliquid L1': { label: 'about $0.05', perTx: 0.05 },
    BSC: { label: 'about $0.10', perTx: 0.1 },
    Polygon: { label: 'about $0.02', perTx: 0.02 },
    Avalanche: { label: 'about $0.10', perTx: 0.1 },
    Tron: { label: 'about $1', perTx: 1 },
    Bitcoin: { label: 'about $2', perTx: 2 },
    Ethereum: { label: '$3 to $10', perTx: 6 },
  };
  let best: { chain: string; gas: Gas } | null = null;
  for (const ch of chains) {
    const g = table[ch] ?? { label: 'about $0.20', perTx: 0.2 };
    if (best === null || g.perTx < best.gas.perTx) best = { chain: ch, gas: g };
  }
  return best ?? { chain: 'its main chain', gas: { label: 'about $0.20', perTx: 0.2 } };
}

const usd = (x: number): string => (x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `$${Math.round(x / 1e3)}K` : `$${x.toFixed(2)}`);

function money(x: number): string {
  return x < 1 ? `$${x.toFixed(2)}` : `$${Math.round(x).toLocaleString('en-US')}`;
}

export function farmPlan(p: SnapshotProtocol, per1k: number, watch: boolean): { steps: FarmStep[]; cost: string; time: string } {
  const category = p.category ?? 'Uncategorised';
  const book = playbookFor(category);
  const { chain, gas } = gasFor(p.chains);
  const g = gas.perTx;
  const size = per1k >= 40 ? 1000 : per1k >= 10 ? 500 : 250;
  const name = p.name;
  const steps: FarmStep[] = [];
  steps.push({
    text: `Open ${name}'s app from its DefiLlama listing (never from a reply or a DM), check whether it runs a points or season page, and screenshot the terms; ${watch ? 'it sits on the house watchlist, so' : 'it is below the watchlist floor, so'} log the date you start.`,
    cost: 'free',
    time: '10 min',
  });
  steps.push({
    text: `Fund a fresh wallet on ${chain} (${name}'s cheapest listed chain): bridge or withdraw ${money(size)} of a stablecoin plus gas; one transaction there costs ${gas.label}.`,
    cost: `${money(2 + g * 2)} in fees`,
    time: '15 min',
  });
  const core: Record<Playbook, [string, number, string]> = {
    vault: [`Deposit ${money(size)} into ${name}'s main stablecoin or blue-chip vault; prefer the vault with the longest track record, and note its withdrawal delay before you deposit.`, 2, '20 min'],
    lend: [`Supply ${money(size)} on ${name}, then borrow 25% of it against the deposit (health factor above 2.5) and resupply: lenders usually score both sides of the book.`, 4, '25 min'],
    dex: [`Swap on ${name} in 6 to 10 trades worth ${money(size * 2)} in total across two or more pairs, then add ${money(size / 2)} of liquidity in a stable or major pair.`, 10, '40 min'],
    perp: [`Deposit ${money(size)} as margin on ${name} and trade small, delta-neutral size (long and short or 1-2x) to build ${money(size * 10)} of volume; keep fees under 0.5% of margin per week.`, 8, '45 min'],
    rwa: [`Complete ${name}'s onboarding (KYC if it asks) and subscribe its minimum ticket, or ${money(size)} where the minimum is lower; read the redemption window first.`, 2, '1-2 days for KYC'],
    bridge: [`Bridge ${money(size)} through ${name} in 3 transfers across different chain pairs over a week; return the funds the same way.`, 6, '30 min'],
    chain: [`Bridge ${money(size)} onto ${name} and use 3 of its native apps (a swap, a lend, a liquidity position) so the address shows breadth, not one-off volume.`, 8, '1 hr'],
    stake: [`Stake or restake ${money(size)} through ${name}'s own interface, choosing the option with no lock-up or the shortest one.`, 2, '20 min'],
    pay: [`Use ${name} for 3 real payments or transfers of ${money(Math.min(size, 100))} each, spaced over different days.`, 3, '20 min'],
    generic: [`Use ${name}'s core product with ${money(size)}: one deposit or action now, and the same again a week later.`, 4, '30 min'],
  };
  const [coreText, txs, coreTime] = core[book];
  steps.push({ text: coreText, cost: `${money(g * txs)} gas`, time: coreTime });
  steps.push({
    text: `Keep the position open and touch it once a week for 8 weeks (claim, compound or rebalance); activity across weeks reads as a user, a single burst reads as a farmer.`,
    cost: `${money(g * 8)} gas`,
    time: '5 min a week, 8 weeks',
  });
  steps.push({
    text: `At the model's figures a ${money(1000)} position could earn about ${money(per1k)} if ${name} airdrops ${Math.round(MODEL.drop_share * 1000) / 10}% of an implied FDV to today's TVL: stop adding if that drops below 2x your fees, and exit if TVL falls 30% in a week.`,
    cost: 'free',
    time: '5 min a week',
  });
  const total = 2 + g * (2 + txs + 8);
  return { steps, cost: money(total), time: book === 'rwa' ? 'about 9 weeks incl. KYC' : 'about 8 weeks, 2 hrs active' };
}

// ---------------------------------------------------------------- the board

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { market, table } = categoryMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const rows: Row[] = [];
  for (const p of snapshot.protocols) {
    const onWatch = watch.has(p.slug);
    if (!onWatch) {
      if (!isPreToken(p) || p.tvl_usd <= 0) continue;
      if (isDerivativeProduct(p)) continue;
    }
    const category = p.category ?? 'Uncategorised';
    const cm = table.get(category)!;
    const g = clamp(p.change_7d ?? 0, MODEL.growth_floor, MODEL.growth_cap);
    const gm = 1 + (MODEL.growth_weight * g) / 100;
    const age = p.listed_at === null ? null : daysBetween(p.listed_at, snapshot.as_of);
    const ageUsed = age ?? MODEL.runway_unknown_days;
    const rf = MODEL.runway_floor + (MODEL.runway_range * Math.min(ageUsed, MODEL.runway_days)) / MODEL.runway_days;
    const cb = 1 + MODEL.chain_step * Math.min(Math.max(p.chains.length - 1, 0), MODEL.chain_cap);
    const implied = Math.max(1, Math.round(p.tvl_usd * cm.multiple * gm * rf * cb));
    const pool = implied * MODEL.drop_share;
    const per1k = Math.round((pool / p.tvl_usd) * 1000 * 100) / 100;
    const conf: Row['conf'] = cm.peers >= 5 && age !== null ? 'high' : cm.peers >= 2 ? 'medium' : 'low';
    const plan = farmPlan(p, per1k, onWatch);
    rows.push({
      slug: p.slug,
      name: p.name,
      category,
      chains: p.chains,
      tvl: p.tvl_usd,
      ch7: p.change_7d,
      age,
      listed: p.listed_at,
      watch: onWatch,
      multiple: cm.multiple,
      peers: cm.peers,
      factors: [
        { key: 'tvl', label: 'TVL', value: p.tvl_usd, note: 'today, from the snapshot' },
        { key: 'm', label: 'Peer multiple', value: cm.multiple, note: `${cm.peers} trading ${category} peer${cm.peers === 1 ? '' : 's'}, shrunk to market ${market}x` },
        { key: 'gm', label: 'Momentum', value: round4(gm), note: p.change_7d === null ? '7d change unreported: neutral' : `7d TVL ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}%` },
        { key: 'rf', label: 'Runway', value: round4(rf), note: age === null ? 'listing date unknown: 365 days assumed' : `${age} days tracked with no token` },
        { key: 'cb', label: 'Reach', value: round4(cb), note: `${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}` },
      ],
      implied,
      pool: Math.round(pool),
      per1k,
      conf,
      rank: 0,
      steps: plan.steps,
      plan_cost: plan.cost,
      plan_time: plan.time,
    });
  }
  rows.sort((a, b) => b.implied - a.implied || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => (r.rank = i + 1));

  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied,
    farm_steps: r.steps.map((s) => `${s.text} (cost: ${s.cost}; time: ${s.time})`),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category ?? 'Uncategorised', tvl: p.tvl_usd, mcap: p.mcap_usd!, ratio: round4(p.mcap_usd! / p.tvl_usd), symbol: p.symbol }))
    .sort((a, b) => b.mcap - a.mcap || a.slug.localeCompare(b.slug));

  const usedCats = new Set(rows.map((r) => r.category));
  const categories = [...table.values()].filter((c) => usedCats.has(c.category) || c.peers > 0).sort((a, b) => b.peers - a.peers || a.category.localeCompare(b.category));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor: snapshot.floor_usd,
    model: MODEL,
    market_median: market,
    universe: snapshot.protocols.length,
    live_count: live.length,
    pre_count: snapshot.protocols.filter(isPreToken).length,
    rows,
    live: live.slice(0, 60),
    categories,
  };
  return { board, radar };
}

/** The gate's own board checks, run before anything is written: null when the board passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
  }
  if (board.length < 100 || board.length > 4000) return `${board.length} rows (100 to 4,000 allowed)`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length) return `misses watchlist ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank ${i + 1} is ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} implied ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} step of ${s.trim().length} chars`;
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row has the same implied value';
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

export { usd };
