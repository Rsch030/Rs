import { PaperAccount, money } from "./execution.ts";
import { startDashboard } from "./dashboard.ts";
import { fetchCandles, formatTime } from "./market.ts";
import { averageTrueRange, crossoverSignal, simpleMovingAverage } from "./strategy.ts";
import { configFromEnvironment } from "./types.ts";

const config = configFromEnvironment();
const once = process.argv.includes("--once");
const account = new PaperAccount(config);
let lastCloseTime = 0;
let failures = 0;
let lastAttemptAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let latestCandles: Awaited<ReturnType<typeof fetchCandles>> = [];
let lastSignal: "BUY" | "SELL" | "HOLD" = "HOLD";
let lastAction: string | null = null;
const startedAt = new Date().toISOString();

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
    sma9: simpleMovingAverage(closes, config.fastPeriod),
    sma21: simpleMovingAverage(closes, config.slowPeriod),
    initialBalance: config.initialBalance,
    cash: account.cash,
    equity: account.equity(markPrice),
    position,
    unrealizedPnl: position ? (markPrice - position.entryPrice) * position.quantity : 0,
    trades: account.trades.slice(-10),
  };
});

console.log(`Paper-only ${config.symbol} ${config.interval} bot — ${config.fastPeriod}/${config.slowPeriod} SMA crossover`);
console.log("Market candles: Coinbase Exchange public API.");
console.log(`Starting paper balance ${money(config.initialBalance)}. No exchange credentials or order endpoint are used.`);
console.log("Position and paper balance exist only in memory; restarting this process resets them.");

do {
  try {
    lastAttemptAt = new Date().toISOString();
    const candles = await fetchCandles(config.symbol, config.interval, 100);
    failures = 0;
    lastError = null;
    lastSuccessAt = new Date().toISOString();
    latestCandles = candles;
    const index = candles.length - 1;
    if (index < config.slowPeriod) throw new Error("Not enough closed candles to calculate the moving averages.");
    const candle = candles[index]!;
    if (candle.closeTime !== lastCloseTime) {
      lastCloseTime = candle.closeTime;
      const closes = candles.map((item) => item.close);
      const fast = simpleMovingAverage(closes, config.fastPeriod)!;
      const slow = simpleMovingAverage(closes, config.slowPeriod)!;
      const signal = crossoverSignal(candles, config.fastPeriod, config.slowPeriod, index);
      const action = account.process(candles, index, signal, averageTrueRange(candles, 14, index));
      lastSignal = signal;
      lastAction = action ?? signal;
      console.log(`${formatTime(candle.closeTime)} | close ${money(candle.close)} | SMA${config.fastPeriod} ${money(fast)} / SMA${config.slowPeriod} ${money(slow)} | ${signal}${action ? ` — ${action}` : ""} | equity ${money(account.equity(candle.close))}`);
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
