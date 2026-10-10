import { describe, expect, it } from 'vitest';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import { serialize } from '../../src/storage/serialize';
import type { Habit } from '../../src/types';

const habit = (name: string, over: Partial<Habit> = {}): Habit => ({
  name, icon: '📚', frequency: 'daily', streakMode: 'strict',
  startDate: '2026-10-01', color: '#0A84FF', ...over
});

const docWith = (completions: Record<string, Record<string, 'completed' | 'missed'>>, names: string[]) => normalizeDoc({
  ...emptyDoc('My Fitness'), created: '2020-01-01',
  habits: names.map(n => habit(n)), completions: completions as never, extra: { owner: 'vault-a' }
});

const section = (text: string, title: string): string => text.split('## ').find(b => b.startsWith(title)) ?? '';

describe('serialize', () => {
  it('derives the frontmatter list from the doc, including a new habit', () => {
    const doc = docWith({ Read: { '2026-10-02': 'completed' } }, ['Read', 'Meditate']);
    const out = serialize(doc);
    expect(out).toContain('- name: Read');
    expect(out).toContain('- name: Meditate');
    expect(out).toContain('name: My Fitness');
    expect(out).toContain('created: 2020-01-01');
    expect(out).toContain('owner: vault-a');
    expect(out).toContain('formatVersion: 1');
  });

  it('renames reach both halves at once', () => {
    const doc = docWith({ Read: { '2026-10-02': 'completed' } }, ['Read']);
    const out = serialize(doc);
    expect(out).toContain('- name: Read');
    expect(out).toMatch(/\|\s*📚 Read\s*\|/);
    expect(out).not.toContain('Reading');
  });

  it('writes both glyphs and leaves blanks empty', () => {
    const doc = docWith({ Read: { '2026-10-01': 'completed', '2026-10-02': 'missed' } }, ['Read']);
    const row = serialize(doc).split('\n').find(l => l.includes('📚 Read'))!;
    expect(row).toContain('✓');
    expect(row).toContain('✗');
  });

  it('is idempotent: rewriting its own output changes nothing', () => {
    const doc = docWith({ Read: { '2026-10-05': 'completed' } }, ['Read']);
    const once = serialize(doc);
    expect(serialize(doc, { existingContent: once })).toBe(once);
  });

  it('copies an untouched month through byte for byte when told it did not change', () => {
    const doc = docWith({ Read: { '2026-10-05': 'completed', '2026-09-09': 'completed' } }, ['Read']);
    const canonical = serialize(doc);
    // A note left by a hand edit in September must survive while only October is being rewritten.
    const handEdited = canonical.replace('## September 2026\n', '## September 2026\n<!-- kept -->\n');
    expect(handEdited).not.toBe(canonical);

    const octoberChanged = serialize(doc, { existingContent: handEdited, changedMonths: new Set(['2026-10']) });
    expect(section(octoberChanged, 'September 2026')).toContain('<!-- kept -->');

    const septemberChanged = serialize(doc, { existingContent: handEdited, changedMonths: new Set(['2026-09']) });
    expect(section(septemberChanged, 'September 2026')).not.toContain('<!-- kept -->');
  });

  it('emits ISO column headers only', () => {
    const doc = docWith({ Read: { '2026-10-05': 'completed' } }, ['Read']);
    const header = serialize(doc).split('\n').find(l => l.trim().startsWith('| Habit'))!;
    expect(header).not.toMatch(/[A-Za-z]{3} \d/);
    expect(header).toContain('2026-10-01');
  });

  it('renders the deleted-habit row and keeps its data', () => {
    const doc = normalizeDoc({
      ...docWith({ Old: { '2026-10-05': 'completed' } }, ['Read']),
      deletedHabits: [{ name: 'Old', deletedAt: '2026-09-30' }]
    });
    const out = serialize(doc);
    expect(out).toContain('- name: Old');
    expect(out).toContain('deletedAt: 2026-09-30');
    expect(out).toMatch(/🗑\s+Old/);
  });

  it('omits months with no data but always keeps the current month', () => {
    const doc = docWith({ Read: { '2026-10-05': 'completed' } }, ['Read']);
    const out = serialize(doc);
    expect(out).toContain('## October 2026');
    expect(out).not.toContain('## September 2026');
  });
});
