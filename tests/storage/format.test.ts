import { describe, expect, it } from 'vitest';
import { CELL_DONE, CELL_MISS, buildMonthHeader, colourFor, isKnownMonthHeader, monthKeyFor, parseIsoDate, parseMonthHeader, stripIcon, toIsoDate } from '../../src/storage/format';

describe('toIsoDate', () => {
  it('passes an ISO date through', () => expect(toIsoDate('2026-01-02')).toBe('2026-01-02'));
  it('converts the legacy "Mon 6/10" form', () => expect(toIsoDate('Mon 6/10', 2020)).toBe('2020-06-10'));
  it('returns null for junk', () => expect(toIsoDate('nonsense', 2020)).toBeNull());
  it('returns null for a legacy date that is not a real day', () => {
    expect(toIsoDate('Mon 13/45', 2020)).toBeNull();
    expect(toIsoDate('Xyz 99/99', 2020)).toBeNull();
    expect(toIsoDate('Xyz 0/1', 2020)).toBeNull();
    expect(toIsoDate('Xyz 1/0', 2020)).toBeNull();
  });
  it('keeps a real legacy date', () => expect(toIsoDate('Xyz 2/29', 2024)).toBe('2024-02-29'));
});

describe('parseIsoDate', () => {
  it('parses a real calendar day', () => {
    expect(parseIsoDate('2026-10-08')).not.toBeNull();
    expect(parseIsoDate('2024-02-29')).not.toBeNull();
  });
  it('rejects shapes that are not days', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-02-31')).toBeNull();
    expect(parseIsoDate('2026-13-45')).toBeNull();
    expect(parseIsoDate('2026-00-10')).toBeNull();
    expect(parseIsoDate('2026-10-00')).toBeNull();
    expect(parseIsoDate('2026-1-01')).toBeNull();
  });
  it('rejects a day a leap year does not have', () => expect(parseIsoDate('2026-02-29')).toBeNull());
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
