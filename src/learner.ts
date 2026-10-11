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

// Use short lookbacks so the paper bot can react to more 5-minute crossovers.
// Fee-adjusted replay still decides which of these profiles is retained.
export const STRATEGY_PROFILES = [
  { fastPeriod: 2, slowPeriod: 5 },
  { fastPeriod: 3, slowPeriod: 7 },
  { fastPeriod: 3, slowPeriod: 8 },
  { fastPeriod: 4, slowPeriod: 9 },
  { fastPeriod: 5, slowPeriod: 13 },
] as const;

const CANDIDATES = STRATEGY_PROFILES;

const VALIDATION_FRACTION = 0.4;
const MIN_VALIDATION_TRADES = 2;

/**
 * Choose a paper strategy by replaying each candidate over the most recent
 * validation slice. All inputs must be real, closed candles. The caller should
 * exclude the candle it is about to trade to avoid selecting a strategy with
 * information from that candle.
 */
export function learnStrategy(candles: Candle[], config: BotConfig): StrategyChoice {
  const fallback = CANDIDATES[2]; // Faster 3/8 profile while collecting enough real samples.
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
