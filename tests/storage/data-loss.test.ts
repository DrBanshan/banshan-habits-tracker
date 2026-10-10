import { describe, expect, it } from 'vitest';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import { deserialize } from '../../src/storage/deserialize';
import { serialize } from '../../src/storage/serialize';
import type { TrackerDoc } from '../../src/model/tracker';
import type { Habit } from '../../src/types';

const TODAY = '2026-10-10';
// A glyph, not a word: the reader derives the habit name by stripping the leading icon run.
const habit = (name: string): Habit => ({
  name, icon: '📚', frequency: 'daily', streakMode: 'strict', startDate: '2026-10-01', color: '#0A84FF'
});

function docOf(names: string[], completions: Record<string, Record<string, 'completed'>>): TrackerDoc {
  return normalizeDoc({ ...emptyDoc('Fitness'), created: '2026-10-01', habits: names.map(habit), completions: completions as never });
}

/** P1 from the spec: add a habit, record a completion, read the file again. */
describe('P1 add', () => {
  it('survives a reload', () => {
    const before = docOf(['Read'], { Read: { [TODAY]: 'completed' } });
    const afterAdd = docOf(['Read', 'Meditate'], {
      Read: { [TODAY]: 'completed' }, Meditate: { [TODAY]: 'completed' }
    });
    const content = serialize(afterAdd, { existingContent: serialize(before), changedMonths: new Set(['2026-10']) });
    expect(deserialize(content).doc!.completions.Meditate[TODAY]).toBe('completed');
  });
});

/** P2: renaming must keep the whole history under the new name. */
describe('P2 rename', () => {
  it('preserves history', () => {
    const before = docOf(['Reading'], { Reading: { [TODAY]: 'completed', '2026-10-09': 'completed' } });
    const afterRename = docOf(['Read'], { Read: { [TODAY]: 'completed', '2026-10-09': 'completed' } });
    const content = serialize(afterRename, { existingContent: serialize(before), changedMonths: new Set(['2026-10']) });
    const reloaded = deserialize(content);
    expect(reloaded.doc!.completions.Read['2026-10-09']).toBe('completed');
    expect(reloaded.doc!.completions.Reading).toBeUndefined();
  });
});

/** P4: the deleted-habit archive must be written, not just held in memory. */
describe('P4 deletedHabits', () => {
  it('round-trips the archive and its data', () => {
    const doc = normalizeDoc({
      ...docOf(['Read'], { Read: { [TODAY]: 'completed' }, Old: { [TODAY]: 'completed' } }),
      deletedHabits: [{ name: 'Old', deletedAt: '2026-10-05' }]
    });
    const back = deserialize(serialize(doc));
    expect(back.doc!.deletedHabits).toEqual([{ name: 'Old', deletedAt: '2026-10-05' }]);
    expect(back.doc!.completions.Old[TODAY]).toBe('completed');
    expect(back.doc!.needsDefinition).toEqual([]);
  });
});

/** The gate of Task 7: a refused write must leave the file untouched. */
describe('gate', () => {
  it.skip('refuses a write that would lose data and leaves the file byte-identical', async () => {
    expect(true).toBe(false);
  });
});
