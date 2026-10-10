import { describe, expect, it } from 'vitest';
import { assertInvariants, diffDocs, emptyDoc, normalizeDoc } from '../../src/model/tracker';
import type { Habit } from '../../src/types';

const habit = (name: string, over: Partial<Habit> = {}): Habit => ({
  name, icon: 'X', frequency: 'daily', streakMode: 'strict',
  startDate: '2026-01-01', color: '#0A84FF', ...over
});

describe('normalizeDoc', () => {
  it('gives every habit a completions entry', () => {
    const doc = { ...emptyDoc(), habits: [habit('Read')] };
    const out = normalizeDoc(doc);
    expect(out.completions.Read).toEqual({});
  });

  it('keeps deleted habit data and unknown keys as pendingData', () => {
    const doc = {
      ...emptyDoc(), habits: [] as Habit[],
      completions: { Ghost: { '2026-01-02': 'completed' as const } },
      deletedHabits: [{ name: 'Old', deletedAt: '2026-01-03' }]
    };
    const out = normalizeDoc(doc);
    expect(out.completions.Ghost).toEqual({ '2026-01-02': 'completed' });
    expect(out.pendingData).toContain('Ghost');
    expect(out.completions.Old).toBeDefined();
  });

  it('keeps the rows of a deleted habit that still has a table row', () => {
    const doc = {
      ...emptyDoc(), habits: [habit('Read')],
      completions: { Old: { '2026-10-01': 'completed' as const } },
      deletedHabits: [{ name: 'Old', deletedAt: '2026-09-01' }]
    };
    const out = normalizeDoc(doc);
    expect(out.completions.Old).toEqual({ '2026-10-01': 'completed' });
    expect(out.pendingData).toEqual([]);
  });

  it('keeps a completions row named after an Object.prototype member', () => {
    const doc = {
      ...emptyDoc(), habits: [] as Habit[],
      completions: { valueOf: { '2026-01-02': 'completed' as const } }
    };
    const out = normalizeDoc(doc);
    expect(out.pendingData).toContain('valueOf');
    expect(Object.prototype.hasOwnProperty.call(out.completions, 'valueOf')).toBe(true);
    expect(out.completions.valueOf).toEqual({ '2026-01-02': 'completed' });
  });

  it('gives a deleted habit named after an Object.prototype member its own entry', () => {
    const doc = {
      ...emptyDoc(), habits: [habit('Read')],
      completions: {}, deletedHabits: [{ name: 'hasOwnProperty', deletedAt: '2026-01-03' }]
    };
    const out = normalizeDoc(doc);
    expect(Object.prototype.hasOwnProperty.call(out.completions, 'hasOwnProperty')).toBe(true);
    expect(out.completions.hasOwnProperty).toEqual({});
  });
});

describe('assertInvariants', () => {
  it('accepts a normalized doc', () => {
    expect(() => assertInvariants(normalizeDoc({ ...emptyDoc(), habits: [habit('Read')] }), 'test')).not.toThrow();
  });

  it('rejects a non ISO date key', () => {
    const doc = normalizeDoc({ ...emptyDoc(), habits: [habit('Read')] });
    doc.completions.Read['Jan 2'] = 'completed';
    expect(() => assertInvariants(doc, 'test')).toThrow(/not ISO/);
  });

  it('rejects a habit with no completions entry', () => {
    const doc = { ...emptyDoc(), habits: [habit('Read')], completions: {} };
    expect(() => assertInvariants(doc, 'test')).toThrow(/Read/);
  });

  it('rejects a shaped date key that is not a real day', () => {
    const doc = normalizeDoc({ ...emptyDoc(), habits: [habit('Read')] });
    doc.completions.Read['2026-02-29'] = 'completed';   // 2026 is not a leap year
    expect(() => assertInvariants(doc, 'test')).toThrow(/not a real day/);
    const other = normalizeDoc({ ...emptyDoc(), habits: [habit('Read')] });
    other.completions.Read['2026-99-99'] = 'completed';
    expect(() => assertInvariants(other, 'test')).toThrow(/not a real day/);
  });

  it('accepts a real leap day', () => {
    const doc = normalizeDoc({ ...emptyDoc(), habits: [habit('Read')] });
    doc.completions.Read['2024-02-29'] = 'completed';
    expect(() => assertInvariants(doc, 'test')).not.toThrow();
  });

  it('rejects a habit named after an Object.prototype member with no own entry', () => {
    const doc = { ...emptyDoc(), habits: [habit('toString')], completions: {} };
    expect(() => assertInvariants(doc, 'test')).toThrow(/has no completions entry/);
  });
});

describe('diffDocs', () => {
  it('does not count an unmarked cell as data the file must carry', () => {
    const intended = normalizeDoc({
      ...emptyDoc(), habits: [habit('Read')],
      completions: { Read: { '2026-10-01': 'unmarked' as const, '2026-10-02': 'completed' as const } }
    });
    // The writer emits no cell for an unmarked day, which is the whole point of the glyph set.
    const written = normalizeDoc({
      ...emptyDoc(), habits: [habit('Read')], completions: { Read: { '2026-10-02': 'completed' as const } }
    });
    expect(diffDocs(intended, written).lostCompletions).toEqual([]);
  });

  it('does not count an unmarked cell as data the file must carry', () => {
    const intended = normalizeDoc({
      ...emptyDoc(), habits: [habit('Read')],
      completions: { Read: { '2026-10-01': 'unmarked' as const, '2026-10-02': 'completed' as const } }
    });
    // The writer emits no cell for an unmarked day, which is the whole point of the glyph set.
    const written = normalizeDoc({
      ...emptyDoc(), habits: [habit('Read')],
      completions: { Read: { '2026-10-02': 'completed' as const } }
    });
    expect(diffDocs(intended, written).lostCompletions).toEqual([]);
  });

  it('still reports a completed cell that went missing', () => {
    const intended = normalizeDoc({
      ...emptyDoc(), habits: [habit('Read')],
      completions: { Read: { '2026-10-02': 'completed' as const } }
    });
    const written = normalizeDoc({ ...emptyDoc(), habits: [habit('Read')], completions: { Read: {} } });
    expect(diffDocs(intended, written).lostCompletions).toEqual([
      { habit: 'Read', date: '2026-10-02', status: 'completed' }
    ]);
  });
});

describe('unused-diffDocs-old', () => {
  it('reports habits and completions that disappeared', () => {
    const before = normalizeDoc({
      ...emptyDoc(), habits: [habit('Read'), habit('Run')],
      completions: { Read: { '2026-01-02': 'completed' }, Run: { '2026-01-02': 'completed' } }
    } as never);
    const after = normalizeDoc({
      ...before, habits: [habit('Read')],
      completions: { Read: {} }
    } as never);
    const d = diffDocs(before, after);
    expect(d.lostHabits).toEqual(['Run']);
    expect(d.lostCompletions).toEqual([
      { habit: 'Read', date: '2026-01-02', status: 'completed' },
      { habit: 'Run', date: '2026-01-02', status: 'completed' }
    ]);
  });
});
