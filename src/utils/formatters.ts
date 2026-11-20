/**
 * Formats stock quantities:
 * - Whole numbers display without decimals (e.g. 10.00 -> "10", 91.00 -> "91").
 * - Fractional quantities keep meaningful decimals without trailing zeros (e.g. 1.50 -> "1.5", 2.25 -> "2.25").
 */
export function formatStockNumber(value?: number | null): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  const rounded = Math.round(num * 10000) / 10000;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return String(Math.round(rounded));
  }
  return Number(rounded.toFixed(2)).toString();
}
