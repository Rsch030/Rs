import type { Candle } from "./types.ts";

const COINBASE_BASE = "https://api.exchange.coinbase.com/products";
const GRANULARITIES: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "6h": 21_600,
  "1d": 86_400,
};

export async function fetchCandles(symbol: string, interval: string, limit = 1000): Promise<Candle[]> {
  if (!/^[A-Z0-9]{2,12}-[A-Z0-9]{2,12}$/.test(symbol)) {
    throw new Error(`Invalid Coinbase product symbol: ${symbol}. Use a pair such as BTC-USD.`);
  }
  const granularity = GRANULARITIES[interval];
  if (!granularity) throw new Error(`Unsupported Coinbase candle interval: ${interval}.`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Candle limit must be between 1 and 1000.");

  const stepMs = granularity * 1000;
  const lastClosedOpenTime = Math.floor(Date.now() / stepMs) * stepMs - stepMs;
  const firstOpenTime = lastClosedOpenTime - (limit - 1) * stepMs;
  const candlesByTime = new Map<number, Candle>();
  let pageStart = firstOpenTime;

  // Coinbase limits each candles response to 300 points. Split longer history into non-overlapping windows.
  while (pageStart <= lastClosedOpenTime) {
    const pageEnd = Math.min(lastClosedOpenTime, pageStart + 299 * stepMs);
    const url = new URL(`${COINBASE_BASE}/${encodeURIComponent(symbol)}/candles`);
    url.searchParams.set("granularity", String(granularity));
    url.searchParams.set("start", new Date(pageStart).toISOString());
    url.searchParams.set("end", new Date(pageEnd).toISOString());

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "btc-paper-bot/1.0" },
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw new Error(`Could not reach Coinbase public market data: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 240);
      throw new Error(`Coinbase returned HTTP ${response.status}: ${detail}`);
    }

    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("Coinbase returned an unexpected candle response.");
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) throw new Error("Coinbase returned a malformed candle.");
      const candle: Candle = {
        openTime: Number(row[0]) * 1000,
        low: Number(row[1]),
        high: Number(row[2]),
        open: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: (Number(row[0]) + granularity) * 1000 - 1,
      };
      if (Object.values(candle).some((value) => !Number.isFinite(value))) {
        throw new Error("Coinbase candle contains invalid numbers.");
      }
      if (candle.openTime >= firstOpenTime && candle.openTime <= lastClosedOpenTime) {
        candlesByTime.set(candle.openTime, candle);
      }
    }
    pageStart = pageEnd + stepMs;
  }

  // Closed candles only, in chronological order. Missing provider intervals stay missing; none are fabricated.
  return [...candlesByTime.values()]
    .filter((candle) => candle.closeTime < Date.now())
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-limit);
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace(".000Z", " UTC");
}
