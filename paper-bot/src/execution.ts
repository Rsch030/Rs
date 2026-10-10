import { sizePosition } from "./risk.ts";
import type { BotConfig, Candle, CompletedTrade, ExitReason, Position, Signal } from "./types.ts";

export class PaperAccount {
  cash: number;
  position: Position | null = null;
  readonly trades: CompletedTrade[] = [];
  readonly config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
    this.cash = config.initialBalance;
  }

  equity(markPrice: number): number {
    return this.cash + (this.position ? this.position.quantity * markPrice : 0);
  }

  process(candles: Candle[], index: number, signal: Signal, atr: number | null): string | null {
    const candle = candles[index]!;
    if (this.position) {
      // Check the protective stop before the close-based crossover on each completed bar.
      if (candle.low <= this.position.stopPrice) {
        const fillPrice = Math.min(candle.open, this.position.stopPrice);
        this.close(fillPrice, candle.closeTime, "STOP_LOSS");
        return `STOP_LOSS @ ${money(fillPrice)}`;
      }
      if (signal === "SELL") {
        this.close(candle.close, candle.closeTime, "SMA_CROSS");
        return `SELL @ ${money(candle.close)}`;
      }
      return null;
    }

    if (signal !== "BUY" || atr === null) return null;
    const sized = sizePosition({
      equity: this.equity(candle.close), cash: this.cash, entryPrice: candle.close, atr,
      riskFraction: this.config.riskFraction, maxExposureFraction: this.config.maxExposureFraction,
      stopAtrMultiple: this.config.stopAtrMultiple, feeRate: this.config.feeRate,
    });
    if (!sized) return null;
    const cost = sized.quantity * candle.close;
    const entryFee = cost * this.config.feeRate;
    if (cost + entryFee > this.cash) return null;
    this.cash -= cost + entryFee;
    this.position = {
      entryPrice: candle.close, quantity: sized.quantity, stopPrice: sized.stopPrice,
      entryTime: candle.closeTime, entryFee,
    };
    return `BUY ${sized.quantity.toFixed(6)} @ ${money(candle.close)} (stop ${money(sized.stopPrice)}; planned risk ${money(sized.expectedStopLoss)})`;
  }

  private close(exitPrice: number, exitTime: number, reason: ExitReason): void {
    const position = this.position;
    if (!position) return;
    const proceeds = position.quantity * exitPrice;
    const exitFee = proceeds * this.config.feeRate;
    this.cash += proceeds - exitFee;
    const grossPnl = (exitPrice - position.entryPrice) * position.quantity;
    this.trades.push({
      entryTime: position.entryTime, exitTime, entryPrice: position.entryPrice, exitPrice,
      quantity: position.quantity, grossPnl, fees: position.entryFee + exitFee,
      netPnl: grossPnl - position.entryFee - exitFee, reason,
    });
    this.position = null;
  }
}

export function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
