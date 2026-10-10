import { PaperAccount, money } from "./execution.ts";
import { fetchCandles, formatTime } from "./market.ts";
import { averageTrueRange, crossoverSignal, simpleMovingAverage } from "./strategy.ts";
import { configFromEnvironment } from "./types.ts";

const config = configFromEnvironment();
const candles = await fetchCandles(config.symbol, config.interval, 1000);
const warmup = Math.max(config.slowPeriod + 1, 15);
if (candles.length <= warmup + 1) throw new Error(`Only ${candles.length} closed candles available; need more than ${warmup + 1}.`);

const account = new PaperAccount(config);
const equityCurve: number[] = [config.initialBalance];
for (let i = warmup; i < candles.length; i++) {
  const signal = crossoverSignal(candles, config.fastPeriod, config.slowPeriod, i);
  account.process(candles, i, signal, averageTrueRange(candles, 14, i));
  equityCurve.push(account.equity(candles[i]!.close));
}

const finalCandle = candles[candles.length - 1]!;
const finalEquity = account.equity(finalCandle.close);
const netReturn = ((finalEquity / config.initialBalance) - 1) * 100;
const closedNet = account.trades.reduce((sum, trade) => sum + trade.netPnl, 0);
const winners = account.trades.filter((trade) => trade.netPnl > 0).length;
const peakAndDrawdown = equityCurve.reduce((state, equity) => {
  const peak = Math.max(state.peak, equity);
  return { peak, max: Math.max(state.max, (peak - equity) / peak) };
}, { peak: config.initialBalance, max: 0 });
const firstCandle = candles[warmup]!;
const firstFast = simpleMovingAverage(candles.map((c) => c.close), config.fastPeriod, warmup)!;
const firstSlow = simpleMovingAverage(candles.map((c) => c.close), config.slowPeriod, warmup)!;
const buyAndHold = ((finalCandle.close / firstCandle.close) - 1) * 100;

console.log(`Paper replay — ${config.symbol} ${config.interval}, ${config.fastPeriod}/${config.slowPeriod} SMA`);
console.log(`Real Coinbase closed candles: ${candles.length} (${formatTime(firstCandle.closeTime)} to ${formatTime(finalCandle.closeTime)})`);
console.log(`Starting balance: ${money(config.initialBalance)} | fee assumption: ${(config.feeRate * 100).toFixed(3)}% per side`);
console.log(`Final marked equity: ${money(finalEquity)} | return: ${netReturn.toFixed(2)}% | max drawdown: ${(peakAndDrawdown.max * 100).toFixed(2)}%`);
console.log(`Closed trades: ${account.trades.length} | wins: ${winners} | realized net P&L: ${money(closedNet)} | open position: ${account.position ? `${account.position.quantity.toFixed(6)} BTC` : "none"}`);
console.log(`Buy-and-hold over same candle window: ${buyAndHold.toFixed(2)}%`);
console.log("These figures are a historical paper replay, not a prediction or live account result.");
