# BTC paper-trading bot

A paper-only BTC bot. It reads **closed, real BTC-USD candles from Coinbase Exchange's public market-data API** and uses an adaptive simple-moving-average crossover. It sends no orders and needs no exchange key.

## Run

Requires Node.js 22.6 or newer. The bot needs network access to Coinbase Exchange's public market-data endpoint.

```sh
npm install
npm run paper     # poll for new closed 5-minute candles
npm run once      # inspect one latest closed candle
npm run replay    # replay up to 1,000 real candles and print measured results
npm run check     # TypeScript type check
```

## Railway

`railway.json` configures Railway to run `npm run paper` as a continuously running worker and restart it after failures. It has no HTTP health endpoint because it is a candle-polling worker. Deploy the project from a GitHub repository with this directory as the service root. Railway's restart controls can then restart the paper worker and its logs can be checked remotely.

The replay reports the actual candle date range, paper account result, fees, trade count, drawdown, and a same-window buy-and-hold comparison. It does not generate candles or fill gaps with fixture data. Coinbase network/API errors are shown as errors; no performance result is fabricated.

## Adaptive paper strategy

At each newly closed candle, the bot fetches up to 600 real candles and compares five faster SMA pairs (2/5, 3/7, 3/8, 4/9, and 5/13) by replaying them on the most recent 40% of that window. The selected pair maximizes net paper return after the configured fees, with a drawdown penalty, and must have at least two completed validation trades. Until then it uses 3/8 while collecting samples. These shorter periods can create more entry signals but can also increase fee drag and false signals. The newest candle is excluded from selection and used only to calculate the live paper signal.

This is rolling parameter selection, not a predictive AI model. It is recalculated on real market history, models fees but not spread or slippage, and can still lose money. The dashboard shows the current pair, validation trade count, window size, and score. All positions remain paper-only and use the same 1% planned stop risk, 25% exposure cap, ATR stop, and fee-aware take profit.

## Paper risk and state

- Starting paper balance: 10,000 USD.
- Planned stop: 2 × 14-period ATR below entry.
- Take-profit: the price is calculated to target 1.5R net after the configured entry and exit fees. With the default 2 × ATR stop, that is farther than a gross 3 × ATR target.
- Position sizing: planned stop risk is capped at 1% of marked equity, with notional exposure capped at 25% of equity.
- Assumed paper fee: 0.1% on each side. This is configurable because actual venue fees vary.
- A closed candle that touches the stop exits at the stop, or at the candle open if the market opened below it. The fee-adjusted 1.5R net take-profit exits at its target, or at the candle open if the market opened above it. Stop is checked first if one candle spans both levels; otherwise take-profit is checked before a same-candle crossover exit.
- Paper balance, open position (including entry, stop, and take-profit), completed trades, last processed candle, and selected learner profile are written atomically to `PAPER_STATE_FILE` (default `./data/paper-state.json`). On Railway, mount a persistent volume at `/data` and set `PAPER_STATE_FILE=/data/paper-state.json`. The state is validated on startup; incompatible or corrupt state stops startup instead of silently resetting the account. The last 5,000 trades are retained, with a lifetime trade count.

## Optional environment settings

`SYMBOL`, `INTERVAL`, `INITIAL_BALANCE`, `PAPER_FEE_RATE`, and `POLL_MILLISECONDS` can override defaults. For example, `SYMBOL=BTC-USD INTERVAL=5m npm run once`. Coinbase supports `1m`, `5m`, `15m`, `1h`, `6h`, and `1d`; each request returns at most 300 candles, so longer replays are paged. The strategy periods and paper risk settings are source constants in this initial version.

Historical replay results are an observation of the fetched candles, not a forecast or live trading result. This project is paper-only.
