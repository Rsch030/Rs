# V1.7.8 exploratory paper replay

Compare V1.7.7 main commit `909894ed653162aa6d5612b2c961e48f07eafdd4`
with V1.7.8 on the running bot's stored five-minute BTC-USDT candles.
The requested window is 2026-08-07 16:40 through 2026-10-06 16:45 UTC;
the 200 completed four-hour candle warmup delays trades until approximately August 9.
The final seven days begin September 29 16:40 UTC. Both versions start with
six independent EUR500 paper accounts and use the existing risk/exit controls.

| Closed-trade measure | V1.7.7 | V1.7.8 |
|---|---:|---:|
| Trades | 1,121 | 618 |
| Gross R, earlier period | -16.5204 | +14.4199 |
| Gross R, final seven days | +1.9323 | +6.0735 |
| Gross R, total | -14.5882 | +20.4934 |
| Gross paper P/L | EUR-41.77 | EUR+36.36 |
| Win rate | 50.22% | 53.56% |
| Gross profit factor | 0.9690 | 1.0789 |
| Worst individual account realized drawdown | 9.08% | 7.89% |
| Estimated cost-adjusted R sensitivity | -349.6667 | -172.6723 |

SMC_SWEEP retained its rules: +22.2713R across 90 baseline trades.
EMA retained its rules: -3.3710R across 417 trades; it was stronger in the
last month but has no demonstrated net edge over this full window.
Momentum (-12.3864R), breakout (-15.0483R) and mean reversion (-5.5128R,
only 16 trades) move to shadow measurement. Their historical balances remain
in totals. This removes new paper exposure without erasing past losses.
The revised trend pullback made +1.5931R on 111 trades versus -0.5410R on
240 original trades, but its last seven days were -0.1862R on only 10 trades.

An earlier broader candidate tightened EMA too and performed worse in the
last seven days of the 30-day replay (-0.3663R versus +6.5345R).
Those EMA changes were discarded. There was no parameter grid search.
The final selection is exploratory: these same data informed the changes;
the last seven days are a separate temporal slice, not untouched validation.
The replay evaluates every eligible historical close; the running bot can
miss entries during downtime, so this does not reproduce its actual account P/L.

Cost sensitivity subtracts 3.5bps estimated fees plus 1bp slippage per side
from closed trades. It does not rerun equity or risk limits with those costs.
Both versions remain negative under that assumption. OHLC candles cannot
reproduce intrabar paths, fills, latency or funding; unclosed trades are
excluded (zero remained open at the end here). This is not a live-money release.

## Reproduce

Use the retained candle file whose SHA256 appears in `replay-v178.json`:

```sh
git show 909894ed653162aa6d5612b2c961e48f07eafdd4:bot.py > /tmp/bot-v177.py
python research/backtest.py /path/to/candles.csv --baseline /tmp/bot-v177.py --days 60 --out /tmp/replay.json
python -m unittest discover -s tests -v
```

The replay precomputes causal indicators and exposes only completed candles
at each step. Three prefix comparisons verify its optimized regime features.
It uses the actual entry, exit and account risk functions and an isolated
scratch data directory, without network requests or production writes.
V1.7.8 passes 37 tests, including real retests, no chasing, closed-15m timing,
range context and retention of shadow account balances/open risk.
