# BTC paper-trading bot

A first paper-only version of the requested BTC bot. It reads **closed, real BTC-USD candles from Coinbase Exchange's public market-data API** and uses a 9/21 simple moving-average crossover: BUY on an upward cross, SELL on a downward cross, otherwise HOLD. It sends no orders and needs no exchange key.

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

## Paper risk and state

- Starting paper balance: 10,000 USD.
- Planned stop: 2 × 14-period ATR below entry.
- Position sizing: planned stop risk is capped at 1% of marked equity, with notional exposure capped at 25% of equity.
- Assumed paper fee: 0.1% on each side. This is configurable because actual venue fees vary.
- A closed candle that touches the stop exits at the stop, or at the candle open if the market opened below it. Stop is checked before a same-candle crossover exit.
- Position, balance, and trades are held in memory only. Restarting resets the paper account; no ledger or learned memory is written.

## Optional environment settings

`SYMBOL`, `INTERVAL`, `INITIAL_BALANCE`, `PAPER_FEE_RATE`, and `POLL_MILLISECONDS` can override defaults. For example, `SYMBOL=BTC-USD INTERVAL=5m npm run once`. Coinbase supports `1m`, `5m`, `15m`, `1h`, `6h`, and `1d`; each request returns at most 300 candles, so longer replays are paged. The strategy periods and paper risk settings are source constants in this initial version.

Historical replay results are an observation of the fetched candles, not a forecast or live trading result. This project is paper-only.
