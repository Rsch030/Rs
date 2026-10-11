import { PaperAccount, money } from "./execution.ts";
import { startDashboard } from "./dashboard.ts";
import { learnStrategy } from "./learner.ts";
import { fetchCandles, formatTime } from "./market.ts";
import { loadPaperState, savePaperState, stateFilePath, type PersistedPaperState } from "./persistence.ts";
import { averageTrueRange, crossoverSignal, simpleMovingAverage } from "./strategy.ts";
import { configFromEnvironment } from "./types.ts";

const config = configFromEnvironment();
const once = process.argv.includes("--once");
const account = new PaperAccount(config);
let strategyChoice = learnStrategy([], config);
let lastCloseTime = 0;
let failures = 0;
let lastAttemptAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let latestCandles: Awaited<ReturnType<typeof fetchCandles>> = [];
let lastSignal: "BUY" | "SELL" | "HOLD" = "HOLD";
let lastAction: string | null = null;
const startedAt = new Date().toISOString();
const persistentStatePath = stateFilePath();
let stateDirty = false;

function snapshotState(): PersistedPaperState {
  return {
    version: 1,
    symbol: config.symbol,
    interval: config.interval,
    initialBalance: config.initialBalance,
    feeRate: config.feeRate,
    cash: account.cash,
    position: account.position,
    trades: account.trades.slice(-5_000),
    completedTradeCount: account.completedTradeCount,
    lastCloseTime,
    lastSignal,
    lastAction,
    strategyChoice,
  };
}

const savedState = await loadPaperState(persistentStatePath, config);
if (savedState) {
  account.cash = savedState.cash;
  account.position = savedState.position;
  account.trades.push(...savedState.trades);
  account.completedTradeCount = savedState.completedTradeCount;
  lastCloseTime = savedState.lastCloseTime;
  lastSignal = savedState.lastSignal;
  lastAction = savedState.lastAction;
  strategyChoice = savedState.strategyChoice;
  console.log(`Restored persistent paper account from ${persistentStatePath}: equity and position retained; ${account.completedTradeCount} completed trades.`);
} else {
  await savePaperState(persistentStatePath, snapshotState());
  console.log(`Created persistent paper account at ${persistentStatePath}.`);
}

startDashboard(() => {
  const latest = latestCandles.at(-1);
  const closes = latestCandles.map((item) => item.close);
  const position = account.position;
  const markPrice = latest?.close ?? position?.entryPrice ?? 0;
  return {
    symbol: config.symbol,
    interval: config.interval,
    startedAt,
    lastAttemptAt,
    lastSuccessAt,
    error: lastError,
    failures,
    candles: latestCandles.slice(-60),
    signal: lastSignal,
    lastAction,
    smaFast: simpleMovingAverage(closes, strategyChoice.fastPeriod),
    smaSlow: simpleMovingAverage(closes, strategyChoice.slowPeriod),
    strategyChoice,
    initialBalance: config.initialBalance,
    cash: account.cash,
    equity: account.equity(markPrice),
    position,
    unrealizedPnl: position ? (markPrice - position.entryPrice) * position.quantity : 0,
    completedTrades: account.completedTradeCount,
    trades: account.trades.slice(-10),
  };
});

console.log(`Paper-only ${config.symbol} ${config.interval} bot — adaptive SMA crossover (3/8, 5/13, 7/16, 9/21, 12/26)`);
console.log("Market candles: Coinbase Exchange public API.");
console.log(`Starting paper balance ${money(config.initialBalance)}. No exchange credentials or order endpoint are used.`);
console.log("Position and paper balance exist only in memory; restarting this process resets them.");

do {
  try {
    lastAttemptAt = new Date().toISOString();
    const recentCandles = await fetchCandles(config.symbol, config.interval, 100);
    failures = 0;
    lastError = null;
    lastSuccessAt = new Date().toISOString();
    latestCandles = recentCandles;
    if (stateDirty) {
      await savePaperState(persistentStatePath, snapshotState());
      stateDirty = false;
    }
    const recentIndex = recentCandles.length - 1;
    if (recentIndex < 0) throw new Error("Coinbase returned no closed candles.");
    const newestCloseTime = recentCandles[recentIndex]!.closeTime;
    if (newestCloseTime !== lastCloseTime) {
      // Refresh a larger real-candle window once per new closed candle. The
      // newest candle is held out of learning and used only for this signal.
      const candles = await fetchCandles(config.symbol, config.interval, 600);
      const index = candles.length - 1;
      if (index < 0 || candles[index]!.closeTime !== newestCloseTime) {
        throw new Error("The learning window did not include the newest closed candle.");
      }
      const candle = candles[index]!;
      strategyChoice = learnStrategy(candles.slice(0, index), config);
      latestCandles = candles;
      const closes = candles.map((item) => item.close);
      const fast = simpleMovingAverage(closes, strategyChoice.fastPeriod);
      const slow = simpleMovingAverage(closes, strategyChoice.slowPeriod);
      if (fast === null || slow === null) throw new Error("Not enough closed candles for the selected SMA profile.");
      const signal = crossoverSignal(candles, strategyChoice.fastPeriod, strategyChoice.slowPeriod, index);
      const action = account.process(candles, index, signal, averageTrueRange(candles, 14, index));
      lastSignal = signal;
      lastAction = `${strategyChoice.status === "adaptive" ? "Adaptief" : "Leren"} SMA ${strategyChoice.fastPeriod}/${strategyChoice.slowPeriod} · ${action ?? signal}`;
      lastCloseTime = candle.closeTime;
      stateDirty = true;
      await savePaperState(persistentStatePath, snapshotState());
      stateDirty = false;
      console.log(`${formatTime(candle.closeTime)} | close ${money(candle.close)} | SMA${strategyChoice.fastPeriod} ${money(fast)} / SMA${strategyChoice.slowPeriod} ${money(slow)} | ${strategyChoice.status} (${strategyChoice.validationTrades} validatietrades) | ${signal}${action ? ` — ${action}` : ""} | equity ${money(account.equity(candle.close))}`);
    }
    if (once) break;
  } catch (error) {
    failures++;
    lastError = error instanceof Error ? error.message : String(error);
    const wait = Math.min(config.pollMilliseconds * 2 ** Math.min(failures - 1, 4), 120_000);
    console.error(`Market read failed: ${lastError}. Retrying in ${Math.round(wait / 1000)}s.`);
    if (once) process.exitCode = 1;
    else await new Promise((resolve) => setTimeout(resolve, wait));
  }
  if (!once) await new Promise((resolve) => setTimeout(resolve, config.pollMilliseconds));
} while (!once);
