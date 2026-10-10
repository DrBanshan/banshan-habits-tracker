import { describe, expect, it, vi } from 'vitest';
import { lintHabitsFile } from '../../src/parser';
import { fakeApp } from './helpers';
import { init, loadHabits, updateSettings } from '../../src/store';

// A glyph, not a word: the reader derives names by stripping the leading icon run, so a word icon
// would key rows under "IC Read" and lint would see rows it cannot match to the properties block.
const FILE = [
  '---', 'name: A', 'habits:', '  - name: Read', '    icon: 📚', '    frequency: daily',
  '    streakMode: strict', '    startDate: 2026-10-01', '---', '',
  '## October 2026', '| Habit | 2026-10-01 |', '| --- | --- |', '| 📚 Read | ✓ |', '',
  '## September 2026', '| Habit | 2026-09-01 |', '| --- | --- |', '| 📚 Read | |'
].join('\n');

describe('lintHabitsFile', () => {
  it('removes a section that holds no data', async () => {
    const app = fakeApp(FILE);
    const changed = await lintHabitsFile(app.app as never, 'habits.md');
    expect(changed).toBe(true);
    expect(app.content).toContain('## October 2026');
    expect(app.content).not.toContain('## September 2026');
  });

  it('keeps a section that holds data', async () => {
    const app = fakeApp(FILE.replace('| 📚 Read | |', '| 📚 Read | ✓ |'));
    const changed = await lintHabitsFile(app.app as never, 'habits.md');
    expect(changed).toBe(false);
    expect(app.content).toContain('## September 2026');
  });

  it('is quiet unless debug mode is on', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => { });
    try {
      const app = fakeApp(FILE);
      await lintHabitsFile(app.app as never, 'habits.md');
      expect(spy.mock.calls.some(c => String(c[0]).includes('Lint:'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('does report per section once debug mode is on', async () => {
    init({ } as never, 'habits.md', undefined, undefined, undefined, true);      // debugMode last
    const spy = vi.spyOn(console, 'log').mockImplementation(() => { });
    try {
      const app = fakeApp(FILE);
      await lintHabitsFile(app.app as never, 'habits.md');
      expect(spy.mock.calls.some(c => String(c[0]).includes('Lint:'))).toBe(true);
    } finally {
      spy.mockRestore();
      init({ } as never, 'habits.md', undefined, undefined, undefined, false);
    }
  });
});

describe('the empty-section mode', () => {
  const seeded = () => fakeApp(FILE);

  it('leaves the file alone in manual mode, which is what fresh installs get', async () => {
    const app = seeded();
    init(app.app as never, 'habits.md', undefined, undefined, 'manual');
    await loadHabits();
    expect(app.content).toContain('## September 2026');         // no silent rewrite on load
  });

  it('still cleans on load for a user who chose onload', async () => {
    const app = seeded();
    init(app.app as never, 'habits.md', undefined, undefined, 'onload');
    await loadHabits();
    expect(app.content).toContain('## October 2026');
    expect(app.content).not.toContain('## September 2026');
  });

  it('accepts manual through the settings update path too', async () => {
    const app = seeded();
    init(app.app as never, 'habits.md');
    updateSettings(undefined, undefined, 'manual');
    await loadHabits();
    expect(app.content).toContain('## September 2026');
  });

  it('keeps the data of a habit that has ticks in only some months', async () => {
    const app = seeded();
    init(app.app as never, 'habits.md', undefined, undefined, 'manual');
    await loadHabits();
    expect(app.content).toContain('✓');
  });
});
