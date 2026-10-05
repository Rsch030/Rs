# BTC V1.7.7 RESEARCH

Paper-trading/research build with six independent strategy accounts.

New paper trades settle without fee or slippage deductions: `net_R = raw_R`
and the account receives the gross P/L. Configured cost estimates still guide
signal sizing and management. Historical trades and balances are preserved;
past deductions are not refunded. The dashboard and `/api/status` identify
this policy (`paper_costs_charged: false`).

## Included
- `bot.py` — BTC V1.7.7 research bot
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
7. Confirm the startup logs identify **BTC V1.7.7 RESEARCH**.

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


## V1.7.7 loss controls
- Default risk is 0.5% per trade, reduced to at most 0.25% after 6% drawdown.
- Both RESEARCH and production enforce the 3% daily realized loss limit and
  9% hard realized drawdown limit. Limits can be exceeded by an already open trade
  or a stop gap; they block new entries, not retroactively cap losses.
- Three consecutive losses pause the strategy for eight hours. An existing legacy
  losing streak receives one pause on its next entry evaluation.
- Every exit blocks re-entry for 15 minutes (REENTRY_PAUSE_MINUTES, minimum five).
- Signals older than max(120 seconds, three polling intervals) cannot open trades.
- Historical losses remain visible; paper costs policy from main is preserved.

## Current deployment status (2026-10-05)
GitHub write access has been restored and these changes are proposed on a branch.
Railway currently runs an older build and has no persistent volume on trade-bot.
Before merging or deploying, preserve the actual running state and complete data
directory and migrate them to a persistent volume. Public CSV exports are not a
complete restorable snapshot. These changes are not yet active on the dashboard.
