import type { Candle, Signal } from "./types.ts";

export function simpleMovingAverage(values: number[], period: number, endIndex = values.length - 1): number | null {
  if (!Number.isInteger(period) || period < 1 || endIndex + 1 < period) return null;
  let total = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) total += values[i]!;
  return total / period;
}

export function crossoverSignal(candles: Candle[], fastPeriod: number, slowPeriod: number, endIndex = candles.length - 1): Signal {
  if (fastPeriod >= slowPeriod) throw new Error("Fast SMA period must be less than slow SMA period.");
  if (endIndex < slowPeriod) return "HOLD";
  const closes = candles.slice(0, endIndex + 1).map((candle) => candle.close);
  const fastNow = simpleMovingAverage(closes, fastPeriod, endIndex)!;
  const slowNow = simpleMovingAverage(closes, slowPeriod, endIndex)!;
  const fastPrev = simpleMovingAverage(closes, fastPeriod, endIndex - 1)!;
  const slowPrev = simpleMovingAverage(closes, slowPeriod, endIndex - 1)!;
  if (fastPrev <= slowPrev && fastNow > slowNow) return "BUY";
  if (fastPrev >= slowPrev && fastNow < slowNow) return "SELL";
  return "HOLD";
}

export function averageTrueRange(candles: Candle[], period = 14, endIndex = candles.length - 1): number | null {
  if (endIndex < period) return null;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) {
    const candle = candles[i]!;
    const previousClose = candles[i - 1]!.close;
    sum += Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  }
  return sum / period;
}
