import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addHabit, deleteHabit, getState, init, loadHabits, renameHabit, toggleDay, whenSaved } from '../../src/store';
import { serialize } from '../../src/storage/serialize';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import { fakeApp } from './helpers';
import type { Habit } from '../../src/types';

let app: ReturnType<typeof fakeApp>;
const today = new Date().toISOString().split('T')[0];

// A glyph, not a word: the reader derives the habit name by stripping the leading icon run, so a
// word icon would key the data under "IC Read" and every gate comparison below would desync.
const habit = (name: string): Habit => ({
  name, icon: '📚', frequency: 'daily', streakMode: 'strict', startDate: today, color: '#0A84FF'
});

beforeEach(async () => {
  app = fakeApp(serialize(normalizeDoc({
    ...emptyDoc('My Fitness'), created: '2026-10-01', habits: [habit('Reading')],
    completions: { Reading: { [today]: 'completed' } } as never
  })));
  init(app.app as never, 'habits.md');
  await loadHabits();
});

afterEach(() => {
  expect(getState().errorInfo?.kind ?? null).toBeNull();
});

async function settled(): Promise<void> {
  await whenSaved();
}

describe('store saves', () => {
  it('keeps a renamed habit history', async () => {
    renameHabit('Reading', 'Read');
    await settled();
    expect(app.content).toMatch(/- name: Read\b/);
    expect(app.content).not.toMatch(/- name: Reading\b/);
    // Assert the data survived on that habit's own row: the table is 31 columns wide, so a pattern
    // that has to reach the glyph from the name cell without crossing a pipe could never match.
    const row = app.content.split('\n').find(l => l.startsWith('| 📚 Read ')) ?? '';
    expect(row).not.toBe('');
    expect(row).toContain('✓');
  });

  it('keeps a newly added habit data', async () => {
    addHabit(habit('Meditate'));
    toggleDay('Meditate', today);
    await settled();
    expect(app.content).toMatch(/- name: Meditate\b/);
    const row = app.content.split('\n').find(l => l.startsWith('| 📚 Meditate ')) ?? '';
    expect(row).not.toBe('');
    expect(row).toContain('✓');
  });

  it('keeps a deleted habit archive in the file', async () => {
    addHabit(habit('Temp'));
    await settled();
    deleteHabit('Temp', true);
    await settled();
    expect(app.content).toMatch(/deletedHabits:/);
    expect(app.content).toMatch(/- name: Temp/);
  });

  it('preserves the tracker name and created the user chose', async () => {
    toggleDay('Reading', today);
    await settled();
    expect(app.content).toContain('name: My Fitness');
    expect(app.content).toContain('created: 2026-10-01');
  });
});
