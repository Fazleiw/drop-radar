// Drop Radar: a token-radar-01 entry (Node 22, standard library only, no network).
//
// The model lives in dashboard/model.js, the same file the page runs: main.ts requires it, builds the
// radar from the sealed snapshot, checks the board against the gate's rules, and writes
//   /output/board.json   the ranked rows (slug, name, rank, implied_value_usd, farm_steps)
//   /output/data.js      the snapshot and board.json, for the page to recompute and compare
//   /output/dashboard/   the page; /output/screenshots/; /output/dossier.json (vendored library), last.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const DropRadar = require('./dashboard/model.js');
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

interface BoardRow { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a: string) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`drop radar: ${message}\n`);
  process.exit(1);
}

/** The gate's board rules, checked before anything is written: null when the board passes. */
function boardIssue(rows: BoardRow[], snapshot: { protocols: { slug: string }[]; watchlist: string[] }): string | null {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows (100 to 4,000 allowed)`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `rank ${i + 1} is ${r.rank}`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} implied ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a step of ${s.trim().length} chars`;
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length) return `misses watchlist ${missing.slice(0, 5).join(', ')}`;
  if (rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) return 'every row has the same implied value';
  return null;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
const radar = DropRadar.buildRadar(snapshot);
const rows: BoardRow[] = DropRadar.boardRows(radar);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

const board = { model: radar.cfg.version, as_of: snapshot.as_of, rows };
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify(board)}\n`);
writeFileSync(join(out, 'data.js'), `window.SNAPSHOT=${JSON.stringify(snapshot)};\nwindow.BOARD=${JSON.stringify(board)};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name} is not a plain name`);

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const price = radar.price[radar.pk].test, odds = radar.oddsTests.filter((s: { kept?: boolean }) => s.kept).pop().test;
process.stdout.write(
  `drop radar: ${radar.universe} protocols, ${radar.traded.length} traded anchors, ${rows.length} pre-token rows, ${radar.set_aside} set aside; ` +
    `price miss x${price.first.miss.toFixed(2)} one out, x${price.walk.miss.toFixed(2)} older to newer; odds Brier ${odds.first.brier.toFixed(3)} / ${odds.walk.brier.toFixed(3)}; ` +
    `ledger ${Object.values(radar.ledger).reduce((a: number, b: unknown) => a + (b as number), 0)} of ${radar.universe}; ${pages.length} page files, ${shots.length} screenshots\n`,
);
