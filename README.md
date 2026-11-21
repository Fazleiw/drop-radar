# drop-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fazleiw/drop-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fazleiw/drop-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Drop Radar values the pre-token protocols in the sealed DefiLlama snapshot as if their tokens launched. It fits the size curve, family adjustment, seven-day TVL growth and time tracked on priced tokens. The dashboard shows two tests that refit every term: leave one protocol out and leave one listing year out. Valuation bands use held-out errors, and rank ranges come from seeded bootstrap refits.

Every protocol on the board has a costed farm scenario. The verdict uses the break-even thresholds at both ends of the valuation band, and the planner prioritizes low-end proceeds per dollar of fees, foregone income and time. The page recomputes the ranks, farm steps, protocol census and default planner selections from the same model as the generated board.

Entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
open out/dashboard/index.html
```

Node 22.18+ and the standard library only; no network.

- `dashboard/model.js`: the model, shared by main.ts and the page
- `main.ts`: reads the snapshot, checks the board against the gate, writes `board.json`, `data.js`, the dashboard and `dossier.json`
- `dashboard/`: static page (board, detail view, filters, method)

Implied values are conditional on launch. The snapshot cannot establish launch timing, airdrop eligibility or executable fees.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
