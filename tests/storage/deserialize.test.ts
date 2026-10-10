import { describe, expect, it } from 'vitest';
import { deserialize } from '../../src/storage/deserialize';

const FRONTMATTER = [
  '---',
  'name: My Fitness',
  'created: 2020-01-01',
  'habits:',
  '  - name: Reading',
  '    icon: BOOK',
  '    frequency: daily',
  '    streakMode: strict',
  '    startDate: 2020-01-01',
  '    color: "#0A84FF"',
  '---'
].join('\n');

const doc = (body: string): string => `${FRONTMATTER}\n\n${body}`;
const table = (rows: string[]): string => [
  '## October 2026',
  '| Habit | 2026-10-01 | 2026-10-02 |',
  '| --- | --- | --- |',
  ...rows
].join('\n');

describe('deserialize', () => {
  it('reads habits and completions', () => {
    const out = deserialize(doc(table(['| 📚 Reading | ✓ | |'])));
    expect(out.failure).toBeNull();
    expect(out.doc!.completions.Reading).toEqual({ '2026-10-01': 'completed' });
  });

  it('keeps the missed glyph as a distinct status', () => {
    const out = deserialize(doc(table(['| 📚 Reading | ✗ | ✓'])));
    expect(out.doc!.completions.Reading).toEqual({ '2026-10-01': 'missed', '2026-10-02': 'completed' });
  });

  it('merges a table-only habit instead of dropping it', () => {
    const out = deserialize(doc(table(['| 📚 Reading | ✓ | ✓', '| 🪷 Meditate | | ✓'])));
    expect(out.doc!.completions.Meditate).toEqual({ '2026-10-02': 'completed' });
    expect(out.doc!.needsDefinition).toEqual(['Meditate']);
    expect(out.healed).toEqual(['Meditate']);
    const synth = out.doc!.habits.find(h => h.name === 'Meditate')!;
    expect(synth.frequency).toBe('daily');
    expect(synth.streakMode).toBe('strict');
    expect(synth.startDate).toBe('2026-10-02');
  });

  it('frontmatter wins for attributes, tables win for data', () => {
    const out = deserialize(doc(table(['| 🎎 Reading | ✓ | |'])));
    expect(out.doc!.habits[0].icon).toBe('BOOK');
    expect(out.doc!.completions.Reading['2026-10-01']).toBe('completed');
  });

  it('keeps a frontmatter habit with no rows as zero completions', () => {
    const out = deserialize(doc(table(['| 📚 Reading | | |'])));
    expect(out.doc!.habits).toHaveLength(1);
    expect(out.doc!.completions.Reading).toEqual({});
  });

  // pendingData cannot come from the file: every table-only name is synthesised into a habit,
  // so nothing stays orphan. normalizeDoc owns pendingData and is tested there.
  it('keeps the rows of a habit no definition and no archive knows about', () => {
    const out = deserialize(doc(table(['| 👻 GHOST | ✓ | |', '| 📚 Reading | | |'])));
    expect(out.failure).toBeNull();
    expect(out.doc!.completions.GHOST).toEqual({ '2026-10-01': 'completed' });
    expect(out.healed).toEqual(['GHOST']);
    expect(out.doc!.needsDefinition).toEqual(['GHOST']);
    expect(out.doc!.habits.some(h => h.name === 'GHOST')).toBe(true);
  });

  it('reports no-frontmatter and bad-yaml instead of throwing', () => {
    expect(deserialize('no front matter here').failure).toBe('no-frontmatter');
    expect(deserialize('---\n: : : bogus\n---\n').failure).toBe('bad-yaml');
  });

  it('yields an empty doc when habits is an empty list', () => {
    const out = deserialize(['---', 'name: Empty', 'habits: []', '---', '', '## October 2026', ''].join('\n'));
    expect(out.failure).toBeNull();
    expect(out.doc!.habits).toEqual([]);
  });

  it('preserves unknown frontmatter keys', () => {
    const out = deserialize(['---', 'name: Keep', 'habits: []', 'owner: vault-a', '---', ''].join('\n'));
    expect(out.doc!.extra.owner).toBe('vault-a');
  });

  it('reads deletedHabits and accepts their rows', () => {
    const src = ['---', 'name: Keep', 'habits:', '  - name: Reading', '    icon: BOOK', '    frequency: daily',
      '    streakMode: strict', '    startDate: 2020-01-01', 'deletedHabits:', '  - name: Old', '    deletedAt: 2026-09-01',
      '---', '', table(['| 📚 Reading | ✓ | |', '| 🗑 Old | ✓ | |'])].join('\n');
    const out = deserialize(src);
    expect(out.doc!.deletedHabits).toEqual([{ name: 'Old', deletedAt: '2026-09-01' }]);
    expect(out.doc!.completions.Old).toEqual({ '2026-10-01': 'completed' });
    expect(out.doc!.needsDefinition).toEqual([]);
  });

  it('still accepts the legacy Mon 6/10 header', () => {
    const src = doc(['## October 2026', '| Habit | Wed 10/1 | Thu 10/2 |', '| --- | --- | --- |',
      '| 📚 Reading | ✓ | |'].join('\n'));
    const out = deserialize(src);
    expect(out.doc!.completions.Reading).toEqual({ '2026-10-01': 'completed' });
  });

  it('still reads the pre-month-section format: frontmatter then one bare table', () => {
    const src = [
      '---', 'name: Legacy', 'created: 2026-06-10', 'habits:', '  - name: Habit', '    icon: 🏃',
      '    frequency: daily', '    streakMode: strict', '    startDate: 2026-06-10', '---', '',
      '| Habit | Mon 6/10 | Tue 6/11 |', '| --- | --- | --- |', '| 🏃 Habit | ✓ | |'
    ].join('\n');
    const out = deserialize(src);
    expect(out.failure).toBeNull();
    // The year of a legacy header comes from the document, not from today.
    expect(out.doc!.completions.Habit).toEqual({ '2026-06-10': 'completed' });
  });

  it('reads several month sections into one habit list', () => {
    const src = ['---', 'name: Two', 'created: 2026-05-01', 'habits:', '  - name: Run', '    icon: 🏃',
      '    frequency: daily', '    streakMode: strict', '    startDate: 2026-05-01', '---', '',
      '## June 2026', '| Habit | 2026-06-10 |', '| --- | --- |', '| 🏃 Run | ✓ |', '',
      '## May 2026', '| Habit | 2026-05-02 |', '| --- | --- |', '| 🏃 Run | ✓ |'].join('\n');
    const out = deserialize(src);
    expect(out.doc!.habits).toHaveLength(1);
    expect(out.doc!.completions.Run).toEqual({ '2026-06-10': 'completed', '2026-05-02': 'completed' });
    expect(out.healed).toEqual([]);
  });
});
