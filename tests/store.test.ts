import { describe, it, expect } from 'vitest';
import * as store from '../src/store';

describe('store', () => {
  it('exports all required functions', () => {
    expect(typeof store.getState).toBe('function');
    expect(typeof store.subscribe).toBe('function');
    expect(typeof store.init).toBe('function');
    expect(typeof store.loadHabits).toBe('function');
    expect(typeof store.toggleDay).toBe('function');
    expect(typeof store.addHabit).toBe('function');
    expect(typeof store.renameHabit).toBe('function');
    expect(typeof store.deleteHabit).toBe('function');
    expect(typeof store.setHabitColor).toBe('function');
    expect(typeof store.setViewType).toBe('function');
    expect(typeof store.setSelectedHabit).toBe('function');
    expect(typeof store.setSelectedMonth).toBe('function');
    expect(typeof store.setSelectedYear).toBe('function');
    expect(typeof store.clearError).toBe('function');
    expect(typeof store.setHabitsFilePath).toBe('function');
  });
});
