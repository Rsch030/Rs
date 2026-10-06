"""Chronological paper replay using the real entry, exit and account risk code.

Precompute causal indicators once, then expose only candles closed at each step.
The final seven days are reported separately; there is no parameter search.
Costs are a sensitivity estimate, not live execution or an equity simulation.
"""
import argparse
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def load(path, folder, name):
    os.environ['DATA_DIR'] = folder
    spec = importlib.util.spec_from_file_location(name, path)
    bot = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bot)
    return bot


def contexts(bot, c):
    frames = bot.frames(c)
    d1 = frames[2].copy()
    d1['er24'] = (d1.close-d1.close.shift(24)).abs()/d1.close.diff().abs().rolling(24).sum().replace(0, float('nan'))
    d1['atr_pct'] = d1.atr/d1.close
    d1['vol_ratio'] = d1.atr_pct/d1.atr_pct.rolling(720, min_periods=480).median().replace(0, float('nan'))
    return frames, d1


def snapshot(bot, fs, indicators):
    x, h = indicators.loc[fs[2].index[-1]], fs[3].iloc[-1]
    ax = float(x.adx) if bot.finite(x.adx) else 0.
    er = float(x.er24) if bot.finite(x.er24) else 0.
    vr = float(x.vol_ratio) if bot.finite(x.vol_ratio) else 1.
    bull = int(x.ema20>x.ema50)+int(x.ema20_slope3>0)+int(h.ema20>h.ema50)+int(h.ema20_slope3>0)
    bear = int(x.ema20<x.ema50)+int(x.ema20_slope3<0)+int(h.ema20<h.ema50)+int(h.ema20_slope3<0)
    direction = 'BULL' if bull>=3 and bull>bear else 'BEAR' if bear>=3 and bear>bull else 'NEUTRAL'
    strength = 'STRONG' if ax>=25 and er>=.22 else 'MEDIUM' if ax>=18 and er>=.10 else 'WEAK'
    volatility = 'HIGH' if vr>=1.25 else 'LOW' if vr<=.80 else 'NORMAL'
    state = ('EXPANSION' if ax>=22 and er>=.18 and vr>=1.05 else
             'RANGE_CHOP' if ax<18 and er<.10 else
             'CONTRACTION' if vr<.85 and ax<20 else
             'TREND' if direction!='NEUTRAL' and strength in {'MEDIUM','STRONG'} else 'TRANSITION')
    return dict(regime=f'{direction}_{strength}_{volatility}_{state}', direction=direction,
                strength=strength, volatility=volatility, market_state=state, adx=ax,
                er24=er, vol_ratio=vr, ema20_slope3_1h=float(x.ema20_slope3),
                ema20_slope3_4h=float(h.ema20_slope3), price=float(fs[0].close.iloc[-1]))


def summarize(rows):
    if not rows: return {'trades': 0, 'gross_R': 0., 'cost_sensitivity_R': 0.}
    d = pd.DataFrame(rows)
    returns = d.raw_R
    distances = (d.entry-d.initial_stop).abs()
    costs = (d.entry+d['exit'])/distances*.00045
    return dict(trades=len(d), gross_R=round(float(returns.sum()), 4),
                cost_sensitivity_R=round(float((returns-costs).sum()), 4),
                paper_pnl_eur=round(float(d.pnl_eur.sum()), 2),
                winrate=round(float((returns>0).mean()), 4),
                profit_factor=round(float(returns[returns>0].sum()/abs(returns[returns<0].sum())), 4) if (returns<0).any() else None)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('candles')
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--days', type=int, default=30)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    c = pd.read_csv(args.candles, parse_dates=['timestamp'])
    c['timestamp'] = pd.to_datetime(c.timestamp, utc=True)
    if (c.timestamp.diff().dropna()!=pd.Timedelta(minutes=5)).any(): raise ValueError('Candle gaps')
    start = c.timestamp.iloc[-1]-pd.Timedelta(days=args.days)
    holdout = c.timestamp.iloc[-1]-pd.Timedelta(days=7)
    models = []
    with tempfile.TemporaryDirectory() as folder:
        baseline = load(Path(args.baseline), folder, 'baseline')
        candidate = load(ROOT/'bot.py', folder, 'candidate')
        all_frames, indicators = contexts(baseline, c)
        for name, bot in [('baseline',baseline),('candidate',candidate)]:
            trades = []
            bot.append_fixed = lambda path, row, cols, b=bot, out=trades: out.append(dict(row)) if path==b.TRADES_FILE else None
            models.append((name, bot, bot.default_state(), trades))
        # Check optimized features against the ordinary prefix calculation.
        for i in [len(c)-2000,len(c)-1000,len(c)-1]:
            close = c.timestamp.iloc[i]+pd.Timedelta(minutes=5)
            fs = [f.loc[f.index<close] if n==0 else f.loc[f.index<=close] for n,f in enumerate(all_frames)]
            actual = baseline.regime_snapshot(c.iloc[:i+1])
            fast = snapshot(baseline,fs,indicators)
            assert actual['regime']==fast['regime'] and abs(actual['er24']-fast['er24'])<1e-10
        last_day = None
        with open(os.devnull,'w') as quiet:
            for i in range(len(c)):
                bar = c.iloc[i]
                if bar.timestamp<start: continue
                close = bar.timestamp+pd.Timedelta(minutes=5)
                fs = [f.loc[f.index<close].tail(250) if n==0 else f.loc[f.index<=close].tail(900) for n,f in enumerate(all_frames)]
                if min(len(f) for f in fs)<200: continue
                snap = snapshot(baseline,fs,indicators)
                for name,bot,state,trades in models:
                    bot.frames = lambda _, f=fs: f
                    with contextlib.redirect_stdout(quiet):
                        for key in bot.STRATEGIES:
                            bot.check_position(key,state,state['strategies'][key],bar)
                        for key,cfg in bot.STRATEGIES.items():
                            account = state['strategies'][key]
                            sig = bot.signal_for(key,c.iloc[max(0,i-600):i+1],snap)
                            if not sig or not sig.get('signal') or not cfg['enabled'] or not sig['allowed'] or account['position']: continue
                            if not bot.risk_permission(account,close)[0] or not bot.validate_order_candidate(key,sig)[0]: continue
                            bot.open_position(key,state,account,sig)
                if close.date()!=last_day:
                    print('Replayed',str(close.date()),flush=True); last_day=close.date()
        report = {'from':str(start),'until':str(c.timestamp.iloc[-1]+pd.Timedelta(minutes=5)),
                  'holdout_from':str(holdout),'notes':'Paper gross settlement, existing risk guards, flat closed positions only. Unclosed positions excluded. Cost sensitivity: 3.5bps fee + 1bp slippage each side. No parameter search; final 7 days separate.'}
        for name,bot,state,trades in models:
            early = [t for t in trades if pd.Timestamp(t['entry_time'])<holdout]
            late = [t for t in trades if pd.Timestamp(t['entry_time'])>=holdout]
            report[name] = dict(development=summarize(early), holdout=summarize(late), total=summarize(trades),
                                per_strategy={k:summarize([t for t in trades if t['strategy']==k]) for k in bot.STRATEGIES},
                                per_strategy_development={k:summarize([t for t in early if t['strategy']==k]) for k in bot.STRATEGIES},
                                per_strategy_holdout={k:summarize([t for t in late if t['strategy']==k]) for k in bot.STRATEGIES},
                                open_positions=bot.open_position_count(state),
                                worst_account_drawdown=min(a['max_drawdown'] for a in state['strategies'].values()))
            pd.DataFrame(trades).to_csv(str(args.out)+'.'+name+'.csv',index=False)
        Path(args.out).write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__': main()
