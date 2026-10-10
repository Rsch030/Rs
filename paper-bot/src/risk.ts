export interface SizingInput {
  equity: number;
  cash: number;
  entryPrice: number;
  atr: number;
  riskFraction: number;
  maxExposureFraction: number;
  stopAtrMultiple: number;
  feeRate: number;
}

export interface SizingResult {
  quantity: number;
  stopPrice: number;
  riskBudget: number;
  expectedStopLoss: number;
}

/** Sizes a long paper position so its planned stop loss is at most 1% of equity,
 * while also capping notional exposure at 25% of equity. */
export function sizePosition(input: SizingInput): SizingResult | null {
  const { equity, cash, entryPrice, atr, riskFraction, maxExposureFraction, stopAtrMultiple, feeRate } = input;
  if (![equity, cash, entryPrice, atr].every(Number.isFinite) || entryPrice <= 0 || atr <= 0 || equity <= 0 || cash <= 0) return null;
  const stopDistance = atr * stopAtrMultiple;
  const stopPrice = entryPrice - stopDistance;
  if (stopPrice <= 0) return null;
  const riskBudget = equity * riskFraction;
  const riskSizedQuantity = riskBudget / stopDistance;
  const exposureSizedQuantity = (equity * maxExposureFraction) / entryPrice;
  const cashSizedQuantity = cash / (entryPrice * (1 + feeRate));
  const quantity = Math.min(riskSizedQuantity, exposureSizedQuantity, cashSizedQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, stopPrice, riskBudget, expectedStopLoss: quantity * stopDistance };
}
