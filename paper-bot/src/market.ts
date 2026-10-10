import type { Candle } from "./types.ts";

const BINANCE_BASE = "https://api.binance.com/api/v3/klines";

export async function fetchCandles(symbol: string, interval: string, limit = 1000): Promise<Candle[]> {
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error(`Invalid Binance symbol: ${symbol}`);
  if (!/^(1|3|5|15|30)m$|^(1|2|4|6|8|12)h$|^1d$/.test(interval)) {
    throw new Error(`Unsupported candle interval: ${interval}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Candle limit must be between 1 and 1000.");

  const url = new URL(BINANCE_BASE);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  let response: Response;
  try {
    response = await fetch(url, { headers: { "user-agent": "btc-paper-bot/1.0" }, signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    throw new Error(`Could not reach Binance public market data: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Binance returned HTTP ${response.status}: ${detail}`);
  }

  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("Binance returned an unexpected candle response.");
  const now = Date.now();
  const candles = rows.map((row: unknown): Candle => {
    if (!Array.isArray(row) || row.length < 7) throw new Error("Binance returned a malformed candle.");
    const candle = {
      openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
      close: Number(row[4]), volume: Number(row[5]), closeTime: Number(row[6]),
    };
    if (Object.values(candle).some((value) => !Number.isFinite(value))) throw new Error("Binance candle contains invalid numbers.");
    return candle;
  });
  // Use closed candles only. This keeps the signal from changing while a bar is still forming.
  return candles.filter((candle) => candle.closeTime < now);
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace(".000Z", " UTC");
}
