import { sizePosition } from "./risk.ts";
import { bullishTrendFilter } from "./strategy.ts";
import type { BotConfig, Candle, CompletedTrade, ExitReason, Position, Signal } from "./types.ts";

export class PaperAccount {
  cash: number;
  readonly positions: Position[] = [];
  readonly trades: CompletedTrade[] = [];
  completedTradeCount = 0;
  readonly config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
    this.cash = config.initialBalance;
  }

  equity(markPrice: number): number {
    return this.cash + this.positions.reduce((total, position) => total + position.quantity * markPrice, 0);
  }

  process(candles: Candle[], index: number, signal: Signal | StrategySignal[], atr: number | null): string | null {
    const candle = candles[index]!;
    const signals: StrategySignal[] = typeof signal === "string"
      ? [{ fastPeriod: this.config.fastPeriod, slowPeriod: this.config.slowPeriod, signal }]
      : signal;
    const signalByProfile = new Map(signals.map((item) => [profileKey(item.fastPeriod, item.slowPeriod), item.signal]));
    const actions: string[] = [];

    // Manage each open profile independently. If a candle spans both exits, assume
    // the stop was hit first (conservative fill ordering).
    for (const position of [...this.positions]) {
      let reason: ExitReason | null = null;
      let fillPrice = candle.close;
      if (candle.low <= position.stopPrice) {
        reason = "STOP_LOSS";
        fillPrice = Math.min(candle.open, position.stopPrice);
      } else if (candle.high >= position.takeProfitPrice) {
        reason = "TAKE_PROFIT";
        fillPrice = Math.max(candle.open, position.takeProfitPrice);
      } else if (signalByProfile.get(profileKey(position.fastPeriod, position.slowPeriod)) === "SELL") {
        reason = "SMA_CROSS";
      }
      if (reason) {
        this.close(position, fillPrice, candle.closeTime, reason);
        actions.push(`${reason} SMA${position.fastPeriod}/${position.slowPeriod} @ ${money(fillPrice)}`);
      }
    }

    if (atr === null || this.positions.length >= MAX_OPEN_POSITIONS) return actions.length ? actions.join("; ") : null;

    // Research guard: keep a single directional exposure at a time. The public
    // portfolio limit remains three, but correlated SMA profiles cannot stack
    // more long positions while an earlier long is open.
    if (this.positions.length > 0) return actions.length ? actions.join("; ") : null;

    const perSlotRisk = this.config.riskFraction / MAX_OPEN_POSITIONS;
    const perSlotExposure = this.config.maxExposureFraction / MAX_OPEN_POSITIONS;
    const trendAllowsLong = bullishTrendFilter(candles, index);
    for (const setup of signals) {
      if (setup.signal !== "BUY") continue;
      if (!trendAllowsLong) {
        actions.push(`FILTERED_TREND SMA${setup.fastPeriod}/${setup.slowPeriod}`);
        continue;
      }
      if (this.positions.length >= MAX_OPEN_POSITIONS) break;
      if (this.positions.some((position) => position.fastPeriod === setup.fastPeriod && position.slowPeriod === setup.slowPeriod)) continue;
      const sized = sizePosition({
        equity: this.equity(candle.close), cash: this.cash, entryPrice: candle.close, atr,
        riskFraction: perSlotRisk, maxExposureFraction: perSlotExposure,
        stopAtrMultiple: this.config.stopAtrMultiple, feeRate: this.config.feeRate,
      });
      if (!sized) continue;
      const cost = sized.quantity * candle.close;
      const entryFee = cost * this.config.feeRate;
      if (cost + entryFee > this.cash) continue;
      this.cash -= cost + entryFee;
      const feeRate = this.config.feeRate;
      const takeProfitPrice = (candle.close * (1 + feeRate)
        + (candle.close - sized.stopPrice) * this.config.takeProfitRMultiple)
        / (1 - feeRate);
      const position: Position = {
        entryPrice: candle.close, quantity: sized.quantity, stopPrice: sized.stopPrice,
        takeProfitPrice, entryTime: candle.closeTime, entryFee,
        fastPeriod: setup.fastPeriod, slowPeriod: setup.slowPeriod,
      };
      this.positions.push(position);
      actions.push(`BUY SMA${setup.fastPeriod}/${setup.slowPeriod} ${sized.quantity.toFixed(6)} @ ${money(candle.close)} (SL ${money(sized.stopPrice)}; TP ${money(takeProfitPrice)}; risk ${money(sized.expectedStopLoss)})`);
      // Only one new position can be opened per candle.
      break;
    }
    return actions.length ? actions.join("; ") : null;
  }

  private close(position: Position, exitPrice: number, exitTime: number, reason: ExitReason): void {
    const proceeds = position.quantity * exitPrice;
    const exitFee = proceeds * this.config.feeRate;
    this.cash += proceeds - exitFee;
    const grossPnl = (exitPrice - position.entryPrice) * position.quantity;
    this.trades.push({
      entryTime: position.entryTime, exitTime, entryPrice: position.entryPrice, exitPrice,
      quantity: position.quantity, grossPnl, fees: position.entryFee + exitFee,
      netPnl: grossPnl - position.entryFee - exitFee, reason,
    });
    this.completedTradeCount++;
    if (this.trades.length > 5_000) this.trades.splice(0, this.trades.length - 5_000);
    const index = this.positions.indexOf(position);
    if (index >= 0) this.positions.splice(index, 1);
  }
}

export const MAX_OPEN_POSITIONS = 3;

export interface StrategySignal {
  fastPeriod: number;
  slowPeriod: number;
  signal: Signal;
}

function profileKey(fastPeriod: number, slowPeriod: number): string {
  return `${fastPeriod}/${slowPeriod}`;
}

export function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
