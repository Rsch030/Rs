export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export type Signal = "BUY" | "SELL" | "HOLD";
export type ExitReason = "SMA_CROSS" | "STOP_LOSS";

export interface Position {
  entryPrice: number;
  quantity: number;
  stopPrice: number;
  entryTime: number;
  entryFee: number;
}

export interface CompletedTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  reason: ExitReason;
}

export interface BotConfig {
  symbol: string;
  interval: string;
  fastPeriod: number;
  slowPeriod: number;
  initialBalance: number;
  riskFraction: number;
  maxExposureFraction: number;
  stopAtrMultiple: number;
  feeRate: number;
  pollMilliseconds: number;
}

export const DEFAULT_CONFIG: BotConfig = {
  symbol: "BTC-USD",
  interval: "5m",
  fastPeriod: 9,
  slowPeriod: 21,
  initialBalance: 10_000,
  riskFraction: 0.01,
  maxExposureFraction: 0.25,
  stopAtrMultiple: 2,
  feeRate: 0.001,
  pollMilliseconds: 15_000,
};

export function configFromEnvironment(): BotConfig {
  const config = { ...DEFAULT_CONFIG };
  config.symbol = (process.env.SYMBOL ?? config.symbol).toUpperCase();
  config.interval = process.env.INTERVAL ?? config.interval;
  config.initialBalance = positiveNumber("INITIAL_BALANCE", config.initialBalance);
  config.feeRate = nonNegativeNumber("PAPER_FEE_RATE", config.feeRate);
  config.pollMilliseconds = positiveNumber("POLL_MILLISECONDS", config.pollMilliseconds);
  return config;
}

function positiveNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a number greater than zero.`);
  return parsed;
}

function nonNegativeNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) throw new Error(`${name} must be between 0 and 1.`);
  return parsed;
}
