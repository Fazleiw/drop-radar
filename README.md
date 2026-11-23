# drop-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fazleiw/drop-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fazleiw/drop-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Drop Radar ranks every DeFi protocol that records no token by implied value = price if a token launches × token odds.

- The price is a size curve (log market cap on log TVL) fitted on the 128 protocols whose token already trades.
- The odds come from a logistic fit of "records a token" over 381 dated protocols on years tracked, TVL, 7-day growth and family. The odds of a protocol still without a token are the share of like peers that record one by the oldest cohort's age, among those that had not by its age.
- Each term of both fits is tested on rows it never saw, one left out and older listings predicting newer ones, and stays only if it lowers the miss in both. The family tilt and the price-side growth and age terms fail that rule and are shown as tested, not kept.

Every value carries a P25–P75 band from held-out misses and a rank range from refits of both models. Every row has a costed farm plan (drop if it launches, expected drop, fees, income forgone, time) with a verdict:

- **Worth farming:** the odds clear the break-even even at the band's low price.
- **Marginal:** the odds clear it at the point price.
- **Skip:** they do not.

Products and other product lines of brands whose token trades are set aside off the watchlist. The board puts each of the snapshot's 758 protocols in exactly one group and shows how many newer caps land inside the printed bands.

The page recomputes the board with the same model.js and checks it against board.json: rows, rank order, totals, watchlist and ledger.

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
