# drop-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fazleiw/drop-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fazleiw/drop-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Drop Radar ranks every DeFi protocol that records no token by what its launch would be worth if it were priced like its own trading peers: each category's market multiple (median market cap / TVL of the protocols in it whose token trades) is read from the same sealed snapshot, shrunk toward the market median when peers are few, and adjusted for 7-day momentum, days tracked with no token and chain reach. Every row carries a drop-per-$1K estimate, a confidence grade and a concrete farm plan with the cost and time of each step.

Entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
open out/dashboard/index.html
```

Node 22.18+ and the standard library only; no network.

- `lib/model.ts`: peer multiples, the value model, the product filter and farm plans
- `main.ts`: reads the snapshot, checks the board against the gate, writes `board.json`, `data.js`, the dashboard and `dossier.json`
- `dashboard/`: static page (board, detail drawer, filters, trading peers, model)

An implied value is this board's own claim, not a forecast that any token will launch.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
