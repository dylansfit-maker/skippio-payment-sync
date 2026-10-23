import { describe, expect, it } from 'vitest';
import { formatMoney, minorToMajorString, minorUnitDigits, parseMajorToMinor } from './money';

describe('money', () => {
  it('knows minor unit digits per currency', () => {
    expect(minorUnitDigits('EUR')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
  });

  it('parses user input to integer minor units without float errors', () => {
    expect(parseMajorToMinor('12.50', 'EUR')).toBe(1250);
    expect(parseMajorToMinor('12,5', 'EUR')).toBe(1250);
    expect(parseMajorToMinor('12', 'EUR')).toBe(1200);
    expect(parseMajorToMinor('0.07', 'EUR')).toBe(7);
    expect(parseMajorToMinor('19.99', 'EUR')).toBe(1999);
    expect(parseMajorToMinor(' 1.10 ', 'EUR')).toBe(110);
  });

  it('rejects invalid amounts', () => {
    for (const bad of ['', 'abc', '-1', '1.234', '1.', '.5', '1e3', '1 000']) expect(parseMajorToMinor(bad, 'EUR')).toBeNull();
    expect(parseMajorToMinor('1.5', 'JPY')).toBeNull();
  });

  it('formats minor units back to editable text', () => {
    expect(minorToMajorString(1250, 'EUR')).toBe('12.50');
    expect(minorToMajorString(7, 'EUR')).toBe('0.07');
    expect(minorToMajorString(0, 'EUR')).toBe('0.00');
  });

  it('formats for display', () => {
    expect(formatMoney(2650, 'EUR', 'en-US')).toBe('€26.50');
  });
});
