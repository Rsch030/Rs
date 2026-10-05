import ast
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from storage import SnapshotStore, PersistenceError, atomic_write

CORE_ONLY = os.getenv('RS_TEST_CORE_ONLY') == '1'


def load_bot(directory):
    with patch.dict(os.environ, {'DATA_DIR': directory}):
        spec = importlib.util.spec_from_file_location('research_bot_test', ROOT / 'bot.py')
        module = importlib.util.module_from_spec(spec)
        if CORE_ONLY:
            # Explicit offline mode exercises real core functions without web/HTTP
            # dependencies. CI uses the normal import and Flask test client.
            tree = ast.parse((ROOT / 'bot.py').read_text())
            tree.body = [n for n in tree.body if not (
                isinstance(n, ast.ImportFrom) and n.module == 'flask'
                or isinstance(n, ast.Import) and any(a.name == 'requests' for a in n.names)
                or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'app' for t in n.targets)
            )]
            for node in tree.body:
                if isinstance(node, ast.FunctionDef):
                    node.decorator_list = []
            module.requests = types.SimpleNamespace(Session=lambda: types.SimpleNamespace(headers={}))
            exec(compile(tree, str(ROOT / 'bot.py'), 'exec'), module.__dict__)
        else:
            spec.loader.exec_module(module)
        return module


def candles(start, count):
    dates = pd.date_range(start, periods=count, freq='5min')
    return pd.DataFrame({'timestamp': dates, 'open': 10000., 'high': 10010.,
                         'low': 9990., 'close': 10000., 'volume': 1.})


def api_rows(frame):
    return [[str(int(row.timestamp.timestamp()*1000)), str(row.open), str(row.high),
             str(row.low), str(row.close), str(row.volume), '1', '1', '1']
            for row in frame.itertuples()]


class BotTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.bot = load_bot(self.directory.name)
        self.state = self.bot.load_state()
        self.time = pd.Timestamp('2026-10-04T00:05:00Z')

    def enter(self, side='LONG'):
        sig = {'entry': 10000., 'stop_distance': 100., 'signal': side,
               'candidate_id': 'test-candidate', 'time': self.time, 'reason': 'TEST',
               'features': {'strategy': 'EMA_SCALP', 'regime': 'TEST'}, 'score': 80,
               'regime': 'TEST', 'estimated_cost_R': .09}
        with self.bot.store.transaction(self.state):
            self.bot.open_position('EMA_SCALP', self.state, self.state['strategies']['EMA_SCALP'], sig)
        return self.state['strategies']['EMA_SCALP']

    def manage(self, open_, high, low, close):
        bar = pd.Series({'timestamp': self.time, 'open': open_, 'high': high, 'low': low, 'close': close})
        with self.bot.store.transaction(self.state):
            self.bot.check_position('EMA_SCALP', self.state, self.state['strategies']['EMA_SCALP'], bar)

    def test_long_deterioration_exits_at_available_close(self):
        account = self.enter()
        self.manage(10000., 10080., 9990., 9995.)
        trade = pd.read_csv(self.bot.TRADES_FILE).iloc[-1]
        self.assertIsNone(account['position'])
        self.assertEqual(trade['exit'], 9995.)
        self.assertLess(trade.net_R, 0)
        self.assertEqual(trade.reason, 'DETERIORATION_MARKET_EXIT')

    def test_research_daily_loss_limit_is_enforced(self):
        account=self.state['strategies']['EMA_SCALP']
        account.update(balance=480.,risk_day=self.time.date().isoformat(),day_start_balance=500.)
        self.assertEqual(self.bot.risk_permission(account,self.time),(False,'STRATEGY_DAILY_LOSS_LIMIT'))

    def test_research_hard_drawdown_is_enforced(self):
        account=self.state['strategies']['EMA_SCALP']
        account.update(balance=450.,peak_balance=500.)
        self.assertEqual(self.bot.risk_permission(account,self.time),(False,'STRATEGY_HARD_DRAWDOWN_MODE'))

    def test_legacy_loss_streak_gets_one_pause(self):
        account=self.state['strategies']['EMA_SCALP']
        account['loss_streak']=4
        self.assertEqual(self.bot.risk_permission(account,self.time),(False,'STRATEGY_COOLDOWN'))
        self.assertTrue(self.bot.risk_permission(account,self.time+pd.Timedelta(hours=9))[0])
        self.assertTrue(self.bot.risk_permission(account,self.time+pd.Timedelta(hours=10))[0])

    def test_loss_pause_applies_in_research(self):
        account=self.enter()
        account['loss_streak']=2
        self.manage(10000.,10010.,9880.,9900.)
        self.assertEqual(account['loss_streak'],3)
        self.assertEqual(self.bot.risk_permission(account,self.time+pd.Timedelta(minutes=10)),(False,'STRATEGY_COOLDOWN'))

    def test_exit_prevents_immediate_reentry(self):
        account=self.enter()
        self.manage(10000.,10010.,9880.,9900.)
        exit_time=self.time+pd.Timedelta(minutes=5)
        self.assertEqual(self.bot.risk_permission(account,exit_time),(False,'REENTRY_PAUSE'))
        self.assertTrue(self.bot.risk_permission(account,exit_time+pd.Timedelta(minutes=15))[0])

    def test_invalid_risk_does_not_open_negative_size(self):
        with patch.object(self.bot,'RISK_PER_TRADE',-.01):
            self.assertEqual(self.bot.risk_permission(self.state['strategies']['EMA_SCALP'],self.time),(False,'INVALID_RISK_PER_TRADE'))

    def test_stale_and_future_signals_are_blocked(self):
        self.assertEqual(self.bot.entry_data_permission(self.time,self.time+pd.Timedelta(minutes=3)),(False,'STALE_SIGNAL'))
        self.assertEqual(self.bot.entry_data_permission(self.time,self.time-pd.Timedelta(seconds=1)),(False,'FUTURE_SIGNAL'))
        self.assertTrue(self.bot.entry_data_permission(self.time,self.time+pd.Timedelta(seconds=25))[0])

    def test_soft_drawdown_reduces_default_risk(self):
        account=self.state['strategies']['EMA_SCALP']
        account.update(balance=465.,peak_balance=500.)
        self.assertEqual(self.bot.effective_risk_pct(account),.0025)

    def test_short_deterioration_exits_at_available_close(self):
        self.enter('SHORT')
        self.manage(10000., 10010., 9920., 10005.)
        trade = pd.read_csv(self.bot.TRADES_FILE).iloc[-1]
        self.assertEqual(trade['exit'], 10005.)
        self.assertLess(trade.net_R, 0)

    def test_stop_gap_uses_adverse_open_long(self):
        self.enter()
        self.manage(9880., 9890., 9870., 9885.)
        self.assertEqual(pd.read_csv(self.bot.TRADES_FILE).iloc[-1]['exit'], 9880.)

    def test_stop_gap_uses_adverse_open_short(self):
        self.enter('SHORT')
        self.manage(10120., 10130., 10110., 10125.)
        self.assertEqual(pd.read_csv(self.bot.TRADES_FILE).iloc[-1]['exit'], 10120.)

    def test_same_bar_stop_and_target_is_conservative(self):
        self.enter()
        self.manage(10000., 10300., 9800., 10000.)
        trade = pd.read_csv(self.bot.TRADES_FILE).iloc[-1]
        self.assertEqual(trade['exit'], 9900.)
        self.assertEqual(trade.reason, 'AMBIGUOUS_STOP_FIRST')

    def test_new_stop_only_applies_to_subsequent_bar(self):
        account = self.enter()
        self.manage(10000., 10080., 9990., 10070.)
        self.assertIsNotNone(account['position'])
        self.assertGreater(account['position']['stop'], 10000.)
        self.assertFalse(Path(self.bot.TRADES_FILE).exists())

    def test_entry_bar_is_not_reprocessed(self):
        account = self.enter()
        self.time -= pd.Timedelta(minutes=5)
        self.manage(10000., 11000., 9000., 10000.)
        self.assertEqual(account['position']['bars_held'], 0)

    def test_resampling_uses_open_time_and_exact_three_bars(self):
        data = candles('2026-10-04T00:00:00Z', 7)
        data['open'] = range(100, 107)
        data['close'] = range(100, 107)
        result = self.bot.closed_resample(data, '15min')
        self.assertEqual(list(result.index), list(pd.date_range('2026-10-04T00:15:00Z', periods=2, freq='15min')))
        self.assertEqual(result.iloc[0]['open'], 100)
        self.assertEqual(result.iloc[0]['close'], 102)
        self.assertEqual(result.iloc[0]['volume'], 3)

    def test_partial_higher_timeframe_is_excluded(self):
        self.assertTrue(self.bot.closed_resample(candles('2026-10-04T00:00:00Z', 2), '15min').empty)

    def test_rsi_zero_loss_and_flat_series(self):
        self.assertEqual(self.bot.rsi(pd.Series(range(40))).iloc[-1], 100)
        self.assertEqual(self.bot.rsi(pd.Series(range(40, 0, -1))).iloc[-1], 0)
        self.assertEqual(self.bot.rsi(pd.Series([5.]*40)).iloc[-1], 50)

    def test_regime_statistics_do_not_require_feature_join(self):
        self.enter()
        self.manage(10000., 10010., 9890., 9900.)
        result = self.bot.regime_performance()
        self.assertEqual(result[0]['regime'], 'TEST')
        self.assertEqual(result[0]['trades'], 1)

    def test_zero_gross_return_has_no_cost_deductions(self):
        self.enter()
        with self.bot.store.transaction(self.state):
            self.bot.close_position('EMA_SCALP', self.state,
                                    self.state['strategies']['EMA_SCALP'],
                                    10000., self.time+pd.Timedelta(minutes=5), 'TEST')
        trade = self.bot.recent()[0]
        self.assertEqual(trade['costs_R'], 0)
        self.assertEqual(trade['costs_eur'], 0)
        self.assertEqual(trade['net_R'], 0)
        self.assertEqual(trade['balance'], 500)

    def test_paper_settlement_uses_gross_profit_for_both_sides(self):
        # Nonzero configured estimates must not reduce the account settlement.
        self.bot.TAKER_FEE = .00035
        self.bot.SLIPPAGE_BPS = 1.0
        for side, exit_price in [('LONG', 10035.), ('SHORT', 9965.),
                                 ('LONG', 9900.), ('SHORT', 10100.)]:
            with self.subTest(side=side, exit_price=exit_price):
                account = self.enter(side)
                balance = account['balance']
                risk = account['position']['risk_eur']
                expected_r = .35 if exit_price in (10035., 9965.) else -1.
                with self.bot.store.transaction(self.state):
                    self.bot.close_position('EMA_SCALP', self.state, account,
                                            exit_price, self.time, 'TEST')
                trade = pd.read_csv(self.bot.TRADES_FILE).iloc[-1]
                self.assertEqual(trade.fees_eur, 0)
                self.assertEqual(trade.slippage_eur, 0)
                self.assertAlmostEqual(trade.net_R, expected_r)
                self.assertAlmostEqual(trade.pnl_eur, risk * expected_r)
                self.assertAlmostEqual(account['balance'], balance + risk * expected_r)
                if expected_r > 0:
                    self.assertEqual(account['loss_streak'], 0)

    def test_legacy_open_entry_times_migrate_only_once(self):
        account = self.enter()
        self.state['version'] = 'BTC-V1.7.5-RESEARCH'
        self.bot.save_state(self.state)
        migrated = self.bot.load_state()
        expected = self.time+pd.Timedelta(minutes=5)
        self.assertEqual(pd.Timestamp(migrated['strategies']['EMA_SCALP']['position']['entry_time']), expected)
        self.assertEqual(self.bot.load_state(), migrated)

    def test_signal_time_is_confirmed_close_time(self):
        data = candles('2026-07-01T00:00:00Z', 26000)
        snap = {'regime':'TEST','direction':'BULL','strength':'MEDIUM','market_state':'TREND'}
        with patch.dict(self.bot.DETECTORS, {'EMA_SCALP': lambda *args: ('LONG', 'TEST', 100., 24)}):
            signal = self.bot.signal_for('EMA_SCALP', data, snap)
        expected = data.timestamp.iloc[-1]+pd.Timedelta(minutes=5)
        self.assertEqual(signal['time'], expected)
        self.assertEqual(pd.Timestamp(signal['features']['time']), expected)

    def test_total_risk_is_weighted_by_combined_balance(self):
        for account in self.state['strategies'].values():
            account['position'] = {'risk_eur': 5., 'risk_pct': .01}
        self.assertAlmostEqual(self.bot.open_risk(self.state), .01)

    def test_corrupt_state_does_not_reset_accounts(self):
        Path(self.bot.STATE_FILE).write_text('{ broken')
        with self.assertRaises(PersistenceError):
            self.bot.load_state()

    def test_history_backfill_recovers_outage(self):
        history = candles('2026-10-01T00:00:00Z', 1000)
        calls = []
        def fetch(endpoint, params):
            calls.append(endpoint)
            if endpoint == self.bot.LIVE_ENDPOINT:
                return api_rows(history.tail(300))
            before = pd.to_datetime(int(params['after']), unit='ms', utc=True)
            return api_rows(history[history.timestamp < before].tail(300))
        with patch.object(self.bot, 'okx_get', fetch):
            result = self.bot.update_candles(history.head(1))
        self.assertEqual(len(result), 1000)
        self.assertTrue((result.timestamp.diff().dropna() == pd.Timedelta(minutes=5)).all())
        self.assertGreater(calls.count(self.bot.HISTORY_ENDPOINT), 1)

    def test_unrecoverable_gap_does_not_overwrite_candles(self):
        old = candles('2026-10-01T00:00:00Z', 1)
        self.bot.write_candles(old)
        original = Path(self.bot.CANDLES_FILE).read_bytes()
        with patch.object(self.bot, 'okx_get', side_effect=[api_rows(candles('2026-10-03T00:00:00Z', 300)), []]):
            with self.assertRaisesRegex(RuntimeError, 'Cannot recover'):
                self.bot.update_candles(old)
        self.assertEqual(Path(self.bot.CANDLES_FILE).read_bytes(), original)

    def test_health_tracks_startup_success_errors_and_staleness(self):
        self.assertEqual(self.bot.health()[1], 503)
        now = self.bot.utc_now().isoformat()
        self.bot.engine.update(status='running', last_success=now, last_candle_close=now)
        self.assertEqual(self.bot.health()[1], 200)
        self.bot.engine['last_candle_close'] = '2020-01-01T00:00:00Z'
        self.assertEqual(self.bot.health()[0]['status'], 'stale')
        self.bot.engine['status'] = 'error'
        self.assertEqual(self.bot.health()[1], 503)

    def test_failed_export_recovers_trade_exactly_once(self):
        self.enter()
        real_write = atomic_write
        def fail_csv(path, data):
            if str(path) == self.bot.TRADES_FILE:
                raise OSError('disk unavailable')
            return real_write(path, data)
        with patch('storage.atomic_write', side_effect=fail_csv):
            with self.assertRaises(PersistenceError):
                self.manage(10000., 10010., 9890., 9900.)
        recovered = self.bot.load_state()
        self.assertEqual(recovered['total_trades'], 1)
        self.assertIsNone(recovered['strategies']['EMA_SCALP']['position'])
        self.assertEqual(len(pd.read_csv(self.bot.TRADES_FILE)), 1)
        self.bot.load_state()
        self.assertEqual(len(pd.read_csv(self.bot.TRADES_FILE)), 1)

    def test_processing_exception_rolls_back_state_and_queued_rows(self):
        with self.assertRaises(ValueError):
            with self.bot.store.transaction(self.state):
                self.state['total_trades'] = 99
                self.bot.append_decision({'decision': 'OPEN'})
                raise ValueError('detector failed')
        self.assertEqual(self.state['total_trades'], 0)
        self.assertFalse(Path(self.bot.DECISIONS_FILE).exists())

    def test_recovery_after_csv_already_written_is_idempotent(self):
        real_write = self.bot.store._write_state
        calls = 0
        def fail_cleanup(state):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('crash after export')
            real_write(state)
        with patch.object(self.bot.store, '_write_state', side_effect=fail_cleanup):
            with self.assertRaises(PersistenceError):
                with self.bot.store.transaction(self.state):
                    self.bot.append_decision({'decision': 'OPEN'})
        self.bot.load_state()
        self.bot.load_state()
        self.assertEqual(len(pd.read_csv(self.bot.DECISIONS_FILE)), 1)

    @unittest.skipIf(CORE_ONLY, 'Flask integration requires installed requirements')
    def test_web_routes_and_dashboard(self):
        data = candles(self.bot.utc_now()-pd.Timedelta(days=90), 26000)
        self.bot.write_candles(data)
        client = self.bot.app.test_client()
        self.assertEqual(client.get('/').status_code, 200)
        self.assertEqual(client.get('/api/status').status_code, 200)
        self.assertEqual(client.get('/health').status_code, 503)
        self.assertEqual(client.get('/download/trades').status_code, 404)


if __name__ == '__main__':
    unittest.main()
