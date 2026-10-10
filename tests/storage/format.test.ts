import { describe, expect, it } from 'vitest';
import { CELL_DONE, CELL_MISS, buildMonthHeader, colourFor, isKnownMonthHeader, monthKeyFor, parseMonthHeader, stripIcon, toIsoDate } from '../../src/storage/format';

describe('toIsoDate', () => {
  it('passes an ISO date through', () => expect(toIsoDate('2026-01-02')).toBe('2026-01-02'));
  it('converts the legacy "Mon 6/10" form', () => expect(toIsoDate('Mon 6/10', 2020)).toBe('2020-06-10'));
  it('returns null for junk', () => expect(toIsoDate('nonsense', 2020)).toBeNull());
});

describe('month headers', () => {
  it('round-trips a built header', () => {
    expect(parseMonthHeader('## October 2026')).toEqual({ year: 2026, month: 9 });
    expect(buildMonthHeader(2026, 9)).toBe('## October 2026');
    expect(isKnownMonthHeader('## October 2026')).toBe(true);
    expect(isKnownMonthHeader('## Notes')).toBe(false);
    expect(monthKeyFor('2026-10-31')).toBe('2026-10');
  });
});

describe('cells', () => {
  it('maps the two glyphs', () => {
    expect(CELL_DONE).toBe('✓');
    expect(CELL_MISS).toBe('✗');
  });
  it('strips the icon prefix from a habit cell', () => {
    expect(stripIcon('📚 Reading')).toBe('Reading');
    expect(stripIcon('Reading')).toBe('Reading');
  });
  it('picks a stable colour per name', () => {
    expect(colourFor('Read')).toBe(colourFor('Read'));
  });
});
