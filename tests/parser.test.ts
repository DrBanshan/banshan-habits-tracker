import { describe, it, expect } from 'vitest';
import { parseTrackerFile, generateTrackerContent } from '../src/parser';
import type { Tracker } from '../src/types';

const SAMPLE_CONTENT = `---
name: "Fitness Tracker"
created: "2026-06-10"
habits:
  - name: "Morning Run"
    icon: "🏃"
    frequency: "daily"
    streakMode: "strict"
    startDate: "2026-06-10"
    color: "#0A84FF"
  - name: "Read 30 min"
    icon: "📚"
    frequency: "daily"
    streakMode: "forgiving"
    startDate: "2026-06-10"
    color: "#26A641"
---

| Habit | 2026-06-10 | 2026-06-11 | 2026-06-12 |
|-------|------------|------------|------------|
| 🏃 Morning Run | ✓ | | ✓ |
| 📚 Read 30 min | ✓ | ✓ | ✓ |
`;

const MULTI_SECTION_CONTENT = `---
name: "Multi Section Tracker"
created: "2026-06-10"
habits:
  - name: "Morning Run"
    icon: "🏃"
    frequency: "daily"
    streakMode: "strict"
    startDate: "2026-06-10"
    color: "#0A84FF"
---

## June 2026
| Habit | 2026-06-10 | 2026-06-11 | 2026-06-12 |
|-------|------------|------------|------------|
| 🏃 Morning Run | ✓ | | ✓ |

## May 2026
| Habit | 2026-05-01 | 2026-05-02 |
|-------|------------|------------|
| 🏃 Morning Run | ✓ | ✓ |
`;

describe('parseTrackerFile', () => {
  it('parses YAML frontmatter correctly', () => {
    const result = parseTrackerFile(SAMPLE_CONTENT);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Fitness Tracker');
    expect(result!.created).toBe('2026-06-10');
    expect(result!.habits).toHaveLength(2);
    expect(result!.habits[0].name).toBe('Morning Run');
    expect(result!.habits[0].icon).toBe('🏃');
    expect(result!.habits[0].frequency).toBe('daily');
    expect(result!.habits[0].streakMode).toBe('strict');
    expect(result!.habits[0].color).toBe('#0A84FF');
    expect(result!.habits[1].streakMode).toBe('forgiving');
    expect(result!.habits[1].color).toBe('#26A641');
  });

  it('parses markdown table completions', () => {
    const result = parseTrackerFile(SAMPLE_CONTENT);
    expect(result!.completions['Morning Run']['2026-06-10']).toBe('completed');
    // Empty cells should not be stored (no 'unmarked' entries)
    expect(result!.completions['Morning Run']['2026-06-11']).toBeUndefined();
    expect(result!.completions['Morning Run']['2026-06-12']).toBe('completed');
    expect(result!.completions['Read 30 min']['2026-06-10']).toBe('completed');
    expect(result!.completions['Read 30 min']['2026-06-11']).toBe('completed');
    expect(result!.completions['Read 30 min']['2026-06-12']).toBe('completed');
  });

  it('parses multi-section tracker files', () => {
    const result = parseTrackerFile(MULTI_SECTION_CONTENT);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Multi Section Tracker');
    expect(result!.habits).toHaveLength(1);
    expect(result!.completions['Morning Run']['2026-06-10']).toBe('completed');
    expect(result!.completions['Morning Run']['2026-06-12']).toBe('completed');
    expect(result!.completions['Morning Run']['2026-05-01']).toBe('completed');
    expect(result!.completions['Morning Run']['2026-05-02']).toBe('completed');
  });

  it('returns null for content without frontmatter', () => {
    expect(parseTrackerFile('No frontmatter here')).toBeNull();
  });

  it('returns null for content without habits', () => {
    expect(parseTrackerFile('---\nname: test\n---')).toBeNull();
  });

  it('handles missing table gracefully', () => {
    const content = `---
name: "Test"
created: "2026-06-10"
habits:
  - name: "Habit"
    icon: "🏃"
    frequency: "daily"
    streakMode: "strict"
    startDate: "2026-06-10"
---`;
    const result = parseTrackerFile(content);
    expect(result).not.toBeNull();
    expect(result!.completions['Habit']).toEqual({});
  });

  it('converts old date format to ISO', () => {
    const content = `---
name: "Old Format"
created: "2026-06-10"
habits:
  - name: "Habit"
    icon: "🏃"
    frequency: "daily"
    streakMode: "strict"
    startDate: "2026-06-10"
---

| Habit | Mon 6/10 | Tue 6/11 |
|-------|----------|----------|
| 🏃 Habit | ✓ | |`;
    const result = parseTrackerFile(content);
    expect(result).not.toBeNull();
    expect(result!.completions['Habit']['2026-06-10']).toBe('completed');
    // Empty cells should not be stored
    expect(result!.completions['Habit']['2026-06-11']).toBeUndefined();
  });
});

describe('generateTrackerContent', () => {
  it('generates valid YAML frontmatter', () => {
    const tracker: Tracker = {
      name: 'Test Tracker',
      created: '2026-06-10',
      habits: [{
        name: 'Test Habit',
        icon: '🏃',
        frequency: 'daily',
        streakMode: 'strict',
        startDate: '2026-06-10',
        color: '#0A84FF'
      }],
      completions: {}
    };
    const content = generateTrackerContent(tracker, 3);
    expect(content).toContain('name: Test Tracker');
    expect(content).toContain('created:');
    expect(content).toContain('---');
  });

  it('generates current month section', () => {
    const tracker: Tracker = {
      name: 'Test Tracker',
      created: '2026-06-10',
      habits: [{
        name: 'Test Habit',
        icon: '🏃',
        frequency: 'daily',
        streakMode: 'strict',
        startDate: '2026-06-10',
        color: '#0A84FF'
      }],
      completions: { 'Test Habit': { '2026-06-10': 'completed' as any } }
    };
    const content = generateTrackerContent(tracker, 3);
    expect(content).toContain('## June 2026');
  });

  it('generates previous months sections', () => {
    const tracker: Tracker = {
      name: 'Test Tracker',
      created: '2026-06-10',
      habits: [{
        name: 'Test Habit',
        icon: '🏃',
        frequency: 'daily',
        streakMode: 'strict',
        startDate: '2026-06-10',
        color: '#0A84FF'
      }],
      completions: {
        'Test Habit': {
          '2026-05-15': 'completed' as any,
          '2026-04-20': 'completed' as any,
          '2026-01-05': 'completed' as any
        }
      }
    };
    const content = generateTrackerContent(tracker, 3);
    expect(content).toContain('## May 2026');
    expect(content).toContain('## April 2026');
    expect(content).toContain('## January 2026');
    // Months without data should not appear
    expect(content).not.toContain('## March 2026');
    expect(content).not.toContain('## February 2026');
  });

  it('round-trips multi-section data correctly', () => {
    const tracker: Tracker = {
      name: 'Round Trip Test',
      created: '2026-06-10',
      habits: [{
        name: 'Morning Run',
        icon: '🏃',
        frequency: 'daily',
        streakMode: 'strict',
        startDate: '2026-06-10',
        color: '#0A84FF'
      }],
      completions: {
        'Morning Run': {
          '2026-06-10': 'completed',
          '2026-06-11': 'unmarked',
          '2026-06-12': 'completed',
          '2026-05-01': 'completed'
        }
      }
    };
    const content = generateTrackerContent(tracker, 3);
    const parsed = parseTrackerFile(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('Round Trip Test');
    expect(parsed!.completions['Morning Run']['2026-06-10']).toBe('completed');
    // Empty cells should not be stored
    expect(parsed!.completions['Morning Run']['2026-06-11']).toBeUndefined();
    expect(parsed!.completions['Morning Run']['2026-06-12']).toBe('completed');
    expect(parsed!.completions['Morning Run']['2026-05-01']).toBe('completed');
  });
});
