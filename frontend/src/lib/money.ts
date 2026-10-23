/**
 * Money helpers. The API speaks integer minor units (cents). Users type major units ("12.50").
 * Conversion uses string/integer arithmetic only, never floating-point multiplication.
 */

/** Number of decimal places for a currency (EUR -> 2, JPY -> 0), taken from the platform's Intl data. */
export function minorUnitDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Display only. */
export function formatMoney(minor: number, currency: string, locale?: string): string {
  const digits = minorUnitDigits(currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 10 ** digits);
}

/** "12.50" / "12,5" / "12" -> 1250 / 1250 / 1200. Returns null for anything that isn't a plain non-negative amount. */
export function parseMajorToMinor(input: string, currency: string): number | null {
  const digits = minorUnitDigits(currency);
  const pattern = digits === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:[.,](\\d{1,${digits}}))?$`);
  const match = pattern.exec(input.trim());
  if (!match) return null;
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(digits, '0');
  const minor = Number(whole + fraction);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 1250 -> "12.50" (editable text for an input field). */
export function minorToMajorString(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  if (digits === 0) return String(minor);
  const padded = String(minor).padStart(digits + 1, '0');
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}
