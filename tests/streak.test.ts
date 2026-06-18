import { describe, it, expect } from 'vitest';
import { calculateStreak } from '../src/streak';
import type { Habit, CompletionStatus } from '../src/types';

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    name: 'Test Habit',
    icon: '🏃',
    frequency: 'daily',
    streakMode: 'strict',
    startDate: '2026-06-01',
    color: '#0A84FF',
    ...overrides
  };
}

function makeCompletions(pairs: [string, CompletionStatus][]): Record<string, Record<string, CompletionStatus>> {
  const map: Record<string, Record<string, CompletionStatus>> = { 'Test Habit': {} };
  for (const [date, status] of pairs) {
    map['Test Habit'][date] = status;
  }
  return map;
}

describe('calculateStreak', () => {
  it('returns 0 streak when no completions exist', () => {
    const habit = makeHabit();
    const result = calculateStreak(habit, makeCompletions([]));
    expect(result).toEqual({ current: 0, longest: 0 });
  });

  it('calculates current streak for consecutive completed days', () => {
    const habit = makeHabit({ startDate: '2026-06-01' });
    const completions = makeCompletions([
      ['2026-06-01', 'completed'],
      ['2026-06-02', 'completed'],
      ['2026-06-03', 'completed'],
    ]);
    const result = calculateStreak(habit, completions);
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });

  it('breaks streak on missed day in strict mode', () => {
    const habit = makeHabit({ startDate: '2026-06-01' });
    const completions = makeCompletions([
      ['2026-06-01', 'completed'],
      ['2026-06-02', 'missed'],
      ['2026-06-03', 'completed'],
    ]);
    const result = calculateStreak(habit, completions);
    expect(result.current).toBe(1);
    expect(result.longest).toBe(1);
  });

  it('allows one gap in forgiving mode', () => {
    const habit = makeHabit({
      startDate: '2026-06-01',
      streakMode: 'forgiving'
    });
    const completions = makeCompletions([
      ['2026-06-01', 'completed'],
      ['2026-06-02', 'missed'],
      ['2026-06-03', 'completed'],
    ]);
    const result = calculateStreak(habit, completions);
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });

  it('filters only active days for specific frequency', () => {
    const habit = makeHabit({
      frequency: 'specific',
      specificDays: ['Mon', 'Wed', 'Fri'],
      startDate: '2026-06-01'
    });
    const completions = makeCompletions([
      ['2026-06-01', 'completed'],
      ['2026-06-03', 'completed'],
      ['2026-06-05', 'completed'],
    ]);
    const result = calculateStreak(habit, completions);
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });

  it('handles unmarked days as non-completed', () => {
    const habit = makeHabit({ startDate: '2026-06-01' });
    const completions = makeCompletions([
      ['2026-06-01', 'completed'],
      ['2026-06-02', 'unmarked'],
      ['2026-06-03', 'completed'],
    ]);
    const result = calculateStreak(habit, completions);
    expect(result.current).toBe(1);
    expect(result.longest).toBe(1);
  });
});
