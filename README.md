# BTC V1.7.6 RESEARCH

Paper-trading/research build with six independent strategy accounts.

## Included
- `bot.py` — BTC V1.7.6 research bot
- `storage.py` — recoverable state snapshots and CSV export journal
- `requirements.txt` — Python dependencies
- `railway.json` — Railway deployment configuration

## Deploy
1. Create a new GitHub repository.
2. Put all files from this package in the repository root.
3. Connect that repository to Railway.
4. Deploy the service.
5. Mount a persistent Railway volume at `/data` (or set `DATA_DIR` to its mount path).
6. Run exactly one service replica/process per data directory.
7. Confirm the startup logs identify **BTC V1.7.6 RESEARCH**.

## Correctness changes
- OKX candle timestamps represent the open. Higher timeframes now use the correct
  boundaries; entry and exit timestamps use the confirmed five-minute close.
- Stops activated after a close take effect on subsequent candles. If deterioration
  would place a stop through the current price, the trade exits at the current close.
  Gaps through active stops fill at the adverse candle open.
- Missing candles after downtime are backfilled. Incomplete history blocks processing.
- A snapshot commits account state and pending CSV rows together. Interrupted exports
  recover once on restart. An unreadable snapshot stops the engine instead of silently
  resetting balances. Keep the entire data directory together when making backups.
- Regime statistics, RSI edge cases, aggregate risk, and zero-return trade costs are corrected.
- `/health` returns HTTP 503 while starting, after an engine error, or with stale data.

The `btc_v175_*` filenames remain unchanged so existing accounts can resume. Legacy
open-position and shadow entry times are shifted forward five minutes once during
upgrade. Historical closed trades are preserved, and new export rows use schema `6.1`.
For a clean comparison of corrected results, use a new `DATA_DIR`; do not combine
old and corrected research samples as if they came from the same execution model.

## Tests
```sh
pip install -r requirements.txt
python -m unittest discover -s tests -v
```
GitHub Actions runs the suite, including Flask routes, with the pinned dependencies.
An explicit `RS_TEST_CORE_ONLY=1` mode supports offline core regression checks;
it excludes web/HTTP dependencies and skips Flask integration.

## Important
- PAPER/RESEARCH use only.
- Profitability is not guaranteed.
- API keys, tokens, `.env` files and other secrets are intentionally not included.
- Environment variables/secrets, if required for your own deployment, must be configured separately in Railway.
- Keep research datasets from different bot versions separate.
