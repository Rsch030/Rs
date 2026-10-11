import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { StrategyChoice } from "./learner.ts";
import type { BotConfig, CompletedTrade, Position, Signal } from "./types.ts";

export interface PersistedPaperState {
  version: 2;
  symbol: string;
  interval: string;
  initialBalance: number;
  feeRate: number;
  cash: number;
  positions: Position[];
  trades: CompletedTrade[];
  completedTradeCount: number;
  lastCloseTime: number;
  lastSignal: Signal;
  lastAction: string | null;
  strategyChoice: StrategyChoice;
}

export function stateFilePath(): string {
  return resolve(process.env.PAPER_STATE_FILE ?? "./data/paper-state.json");
}

export async function loadPaperState(path: string, config: BotConfig): Promise<PersistedPaperState | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Paper state at ${path} is not valid JSON; it was left untouched.`);
  }
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) {
    throw new Error(`Paper state at ${path} has an unsupported format; it was left untouched.`);
  }
  if (value.symbol !== config.symbol || value.interval !== config.interval || value.initialBalance !== config.initialBalance || value.feeRate !== config.feeRate) {
    throw new Error(`Paper state at ${path} belongs to different market, starting-balance, or fee settings; it was left untouched.`);
  }
  const positions = value.version === 1
    ? (value.position === null ? [] : [{ ...value.position as object, fastPeriod: numberOr(value.strategyChoice, "fastPeriod", 3), slowPeriod: numberOr(value.strategyChoice, "slowPeriod", 8) }])
    : value.positions;
  if (!isFiniteNumber(value.cash) || value.cash < 0 || !isFiniteNumber(value.completedTradeCount)
    || value.completedTradeCount < 0 || !Number.isInteger(value.completedTradeCount)
    || !isFiniteNumber(value.lastCloseTime) || value.lastCloseTime < 0
    || !isSignal(value.lastSignal) || !(typeof value.lastAction === "string" || value.lastAction === null)
    || !Array.isArray(positions) || positions.length > 3 || !positions.every(isPosition)
    || (value.version === 1 && !isLegacyPosition(value.position))
    || !Array.isArray(value.trades) || value.trades.length > 5_000
    || !value.trades.every(isCompletedTrade) || !isStrategyChoice(value.strategyChoice)) {
    throw new Error(`Paper state at ${path} failed validation; it was left untouched.`);
  }

  return { ...value, version: 2, positions } as unknown as PersistedPaperState;
}

export async function savePaperState(path: string, state: PersistedPaperState): Promise<void> {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, absolutePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSignal(value: unknown): value is Signal {
  return value === "BUY" || value === "SELL" || value === "HOLD";
}

function isPosition(value: unknown): value is Position {
  if (value === null) return false;
  if (!isRecord(value)) return false;
  return ["entryPrice", "quantity", "stopPrice", "takeProfitPrice", "entryTime", "entryFee"]
    .every((key) => isFiniteNumber(value[key]))
    && (value.entryPrice as number) > 0
    && (value.quantity as number) > 0
    && (value.stopPrice as number) > 0
    && (value.stopPrice as number) < (value.entryPrice as number)
    && (value.takeProfitPrice as number) > (value.entryPrice as number)
    && (value.entryFee as number) >= 0
    && Number.isInteger(value.fastPeriod) && (value.fastPeriod as number) > 0
    && Number.isInteger(value.slowPeriod) && (value.slowPeriod as number) > (value.fastPeriod as number);
}

function isLegacyPosition(value: unknown): value is Omit<Position, "fastPeriod" | "slowPeriod"> | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return ["entryPrice", "quantity", "stopPrice", "takeProfitPrice", "entryTime", "entryFee"]
    .every((key) => isFiniteNumber(value[key]))
    && (value.entryPrice as number) > 0 && (value.quantity as number) > 0
    && (value.stopPrice as number) > 0 && (value.stopPrice as number) < (value.entryPrice as number)
    && (value.takeProfitPrice as number) > (value.entryPrice as number) && (value.entryFee as number) >= 0;
}

function numberOr(value: unknown, key: string, fallback: number): number {
  return isRecord(value) && Number.isInteger(value[key]) && (value[key] as number) > 0 ? value[key] as number : fallback;
}

function isCompletedTrade(value: unknown): value is CompletedTrade {
  if (!isRecord(value)) return false;
  return ["entryTime", "exitTime", "entryPrice", "exitPrice", "quantity", "grossPnl", "fees", "netPnl"]
    .every((key) => isFiniteNumber(value[key]))
    && (value.entryPrice as number) > 0
    && (value.exitPrice as number) > 0
    && (value.quantity as number) > 0
    && (value.fees as number) >= 0
    && (value.reason === "SMA_CROSS" || value.reason === "STOP_LOSS" || value.reason === "TAKE_PROFIT");
}

function isStrategyChoice(value: unknown): value is StrategyChoice {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.fastPeriod) && Number.isInteger(value.slowPeriod)
    && (value.fastPeriod as number) > 0 && (value.slowPeriod as number) > (value.fastPeriod as number)
    && (value.status === "learning" || value.status === "adaptive")
    && isFiniteNumber(value.validationTrades) && isFiniteNumber(value.validationCandles)
    && (value.score === null || isFiniteNumber(value.score))
    && isFiniteNumber(value.windowCandles);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
