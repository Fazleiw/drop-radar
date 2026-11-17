# drop-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fazleiw/drop-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fazleiw/drop-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Drop Radar ranks every DeFi protocol that records no token by what its launch would be worth if the market priced it like the protocols whose token already trades: a size curve (log market cap on log TVL) fitted on those traded anchors, a shrunk family tilt, 7-day momentum and days tracked with no token. The fit is tested leave-one-out, every value carries a P25–P75 band and a rank range from seeded refits, and every row a netted farm plan (fees, income forgone, time) with a Worth farming / Marginal / Skip verdict. The page recomputes the board with the same model.js and checks it against board.json.

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

An implied value is this board's own claim, not a forecast that any token will launch.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
