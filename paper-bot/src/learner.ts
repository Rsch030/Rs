import { PaperAccount } from "./execution.ts";
import { averageTrueRange, crossoverSignal } from "./strategy.ts";
import type { BotConfig, Candle } from "./types.ts";

export interface StrategyChoice {
  fastPeriod: number;
  slowPeriod: number;
  status: "learning" | "adaptive";
  validationTrades: number;
  validationCandles: number;
  score: number | null;
  windowCandles: number;
}

// Include faster pairs so the paper bot can explore more signals, while still
// comparing them with the original and slower SMA profiles.
const CANDIDATES = [
  { fastPeriod: 3, slowPeriod: 8 },
  { fastPeriod: 5, slowPeriod: 13 },
  { fastPeriod: 7, slowPeriod: 16 },
  { fastPeriod: 9, slowPeriod: 21 },
  { fastPeriod: 12, slowPeriod: 26 },
] as const;

const VALIDATION_FRACTION = 0.4;
const MIN_VALIDATION_TRADES = 2;

/**
 * Choose a paper strategy by replaying each candidate over the most recent
 * validation slice. All inputs must be real, closed candles. The caller should
 * exclude the candle it is about to trade to avoid selecting a strategy with
 * information from that candle.
 */
export function learnStrategy(candles: Candle[], config: BotConfig): StrategyChoice {
  const fallback = CANDIDATES[1]; // Faster than the original 9/21 while collecting samples.
  const validationStart = Math.floor(candles.length * (1 - VALIDATION_FRACTION));
  const validationCandles = Math.max(0, candles.length - validationStart);

  if (validationCandles < 80) {
    return {
      ...fallback,
      status: "learning",
      validationTrades: 0,
      validationCandles,
      score: null,
      windowCandles: candles.length,
    };
  }

  let best: StrategyChoice | null = null;
  for (const candidate of CANDIDATES) {
    const account = new PaperAccount({ ...config, ...candidate });
    let peak = config.initialBalance;
    let maxDrawdown = 0;
    const firstIndex = Math.max(validationStart, candidate.slowPeriod, 14);

    for (let index = firstIndex; index < candles.length; index++) {
      const signal = crossoverSignal(candles, candidate.fastPeriod, candidate.slowPeriod, index);
      account.process(candles, index, signal, averageTrueRange(candles, 14, index));
      const equity = account.equity(candles[index]!.close);
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
    }

    if (account.trades.length < MIN_VALIDATION_TRADES) continue;
    const finalEquity = account.equity(candles.at(-1)!.close);
    const netReturnPct = ((finalEquity / config.initialBalance) - 1) * 100;
    const drawdownPct = maxDrawdown * 100;
    // Prefer net results after modeled fees and penalize unstable equity curves.
    const score = netReturnPct - drawdownPct * 0.5;
    const result: StrategyChoice = {
      ...candidate,
      status: "adaptive",
      validationTrades: account.trades.length,
      validationCandles,
      score,
      windowCandles: candles.length,
    };
    if (!best || result.score! > best.score!) best = result;
  }

  return best ?? {
    ...fallback,
    status: "learning",
    validationTrades: 0,
    validationCandles,
    score: null,
    windowCandles: candles.length,
  };
}
