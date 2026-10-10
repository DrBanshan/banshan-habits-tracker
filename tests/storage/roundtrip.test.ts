import { describe, expect, it } from 'vitest';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import type { TrackerDoc } from '../../src/model/tracker';
import { deserialize } from '../../src/storage/deserialize';
import { serialize } from '../../src/storage/serialize';
import { seeded } from './helpers';
import type { Habit } from '../../src/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ICONS = ['📚', '🪷', '🎎', '👻', '🗑', '🏃'];

function buildDoc(seed: number): TrackerDoc {
  const rnd = seeded(seed);
  const count = 1 + Math.floor(rnd() * 4);
  const habits: Habit[] = [];
  const completions: Record<string, Record<string, 'completed' | 'missed'>> = {};
  // Deliberately spans a month end, a leap-day February and a year boundary.
  // 2024 is a leap year, so Feb 29 is a real day: an impossible date cannot round-trip and the
  // writer is right to have no column for it.
  const months = ['2024-02', '2026-10', '2025-12'];
  for (let h = 0; h < count; h++) {
    const name = `H${h}`;
    const frequency = rnd() < 0.6 ? 'daily' : rnd() < 0.5 ? 'weekly' : 'specific';
    const habit: Habit = {
      name, icon: ICONS[h % ICONS.length], frequency: frequency as Habit['frequency'],
      streakMode: rnd() < 0.5 ? 'strict' : 'forgiving',
      startDate: '2025-12-01', color: '#0A84FF'
    };
    if (frequency === 'specific') habit.specificDays = [DAY_NAMES[Math.floor(rnd() * 7)]];
    habits.push(habit);
    const cells: Record<string, 'completed' | 'missed'> = {};
    for (const month of months) {
      const days = month === '2024-02' ? 29 : 31;
      for (let d = 1; d <= days; d++) {
        if (rnd() < 0.35) cells[`${month}-${String(d).padStart(2, '0')}`] = rnd() < 0.85 ? 'completed' : 'missed';
      }
    }
    completions[name] = cells;
  }
  return normalizeDoc({ ...emptyDoc('RT'), created: '2025-12-01', habits, completions: completions as never });
}

describe('round trip', () => {
  it('preserves every habit and every completion for 40 seeded docs', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const doc = buildDoc(seed);
      const back = deserialize(serialize(doc));
      expect(back.failure, `seed ${seed}`).toBeNull();
      for (const h of doc.habits) {
        const got = back.doc!.habits.find(x => x.name === h.name);
        expect(got, `habit ${h.name} of seed ${seed}`).toBeDefined();
        expect(got!.frequency).toBe(h.frequency);
        expect(got!.streakMode).toBe(h.streakMode);
        expect(got!.color).toBe(h.color);
      }
      for (const [name, cells] of Object.entries(doc.completions)) {
        for (const [date, status] of Object.entries(cells)) {
          expect(back.doc!.completions[name]?.[date], `seed ${seed} ${name} ${date}`).toBe(status);
        }
      }
    }
  });
});
