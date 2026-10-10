import { describe, expect, it } from 'vitest';
import { BackupStore, MAX_BACKUPS } from '../../src/storage/backup';
import type { BackupEntry } from '../../src/storage/backup';
import { fakeApp } from './helpers';
import { getState, init, loadHabits, renameHabit, restoreFromBackup, setPlugin, toggleDay, whenSaved } from '../../src/store';
import { saveDoc } from '../../src/storage/vaultFile';
import { deserialize } from '../../src/storage/deserialize';

function holder() {
  const box: { data: Record<string, unknown> | null } = { data: null };
  return { box, store: new BackupStore(async () => box.data, async (d) => { box.data = d; }) };
}

describe('BackupStore', () => {
  it('keeps at most MAX_BACKUPS copies, newest first', async () => {
    const { store } = holder();
    for (let i = 1; i <= MAX_BACKUPS + 3; i++) await store.record(`v${i}`);
    const list = await store.list();
    expect(list).toHaveLength(MAX_BACKUPS);
    // list() reports size rather than the text, so the newest copy is identified by its stamp.
    expect(await store.take(list[0].stamp)).toBe(`v${MAX_BACKUPS + 3}`);
    expect(await store.take(list[list.length - 1].stamp)).toBe(`v${MAX_BACKUPS + 3 - (MAX_BACKUPS - 1)}`);
  });

  it('does not record the same content twice in a row', async () => {
    const { store } = holder();
    await store.record('same');
    await store.record('same');
    expect(await store.list()).toHaveLength(1);
  });

  it('survives a corrupt blob', async () => {
    const { store, box } = holder();
    await store.record('good');
    box.data = { backups: 'nonsense' };
    expect(await store.take('nope')).toBe(null);
    expect(await store.list()).toEqual([]);
    box.data = { backups: [{ stamp: 'a', content: 'x' }, null, { stamp: 2 }, 7] };
    const list = await store.list();
    expect(list).toEqual([{ stamp: 'a', bytes: 1 }]);        // toEqual ignores a valued-as-undefined key
    expect(await store.take('a')).toBe('x');
  });

  it('returns the requested copy verbatim', async () => {
    const { store } = holder();
    await store.record('---\nname: A\n---\n');
    const [entry] = await store.list();
    expect(await store.take(entry.stamp)).toBe('---\nname: A\n---\n');
  });

  it('gives every copy its own stamp even when several land in the same instant', async () => {
    const { store } = holder();
    for (let i = 0; i < 4; i++) await store.record(`body ${i}`);
    const list = await store.list();
    const stamps = list.map(e => e.stamp);
    expect(new Set(stamps).size).toBe(stamps.length);
    // Each stamp has to address its own copy, or a restore would silently pick the wrong one.
    expect(await store.take(stamps[0])).toBe('body 3');
    expect(await store.take(stamps[3])).toBe('body 0');
  });

  it('leaves an empty store readable rather than throwing', async () => {
    const { store } = holder();
    expect(await store.list()).toEqual([]);
    expect(await store.take('anything')).toBe(null);
  });
});

// The rotation only matters if the save path actually feeds it and a restore comes back out of it,
// so these drive the real store rather than the class on its own.
describe('backup wiring', () => {
  const today = new Date().toISOString().split('T')[0];

  const seed = (withFrontmatter: boolean) => (withFrontmatter
    ? '---\nformatVersion: 1\nname: My Fitness\ncreated: 2026-10-01\nhabits:\n  - name: Read\n    icon: 📚\n    frequency: daily\n    streakMode: strict\n    startDate: 2026-10-01\n---\n\n## October 2026\n| Habit | ' + today + ' |\n| --- | --- |\n| 📚 Read | ✓ |\n'
    : '## October 2026\n| Habit | ' + today + ' |\n| --- | --- |\n| 📚 Read | ✓ |\n');

  function env(withFrontmatter = true) {
    const box: { data: Record<string, unknown> | null } = { data: null };
    const app = fakeApp(seed(withFrontmatter));
    setPlugin({ backups: new BackupStore(async () => box.data, async (d) => { box.data = d; }) });
    init(app.app as never, 'habits.md');
    return { app, box };
  }

  it('rotates the text being replaced on the first write of a session', async () => {
    const { app, box } = env();
    await loadHabits();
    toggleDay('Read', today);                                   // ✓ -> unmarked
    await whenSaved();
    const list = await (box.data as never as { backups: BackupEntry[] }).backups.map(e => e.content);
    expect(list.length).toBe(1);
    expect(list[0]).toContain('| 📚 Read | ✓ |');               // the pre-write text, kept
  });

  it('does not rotate again for every later partial write', async () => {
    const { app, box } = env();
    await loadHabits();
    toggleDay('Read', today);
    await whenSaved();
    toggleDay('Read', today);                                   // back to completed
    await whenSaved();
    toggleDay('Read', today);
    await whenSaved();
    expect((box.data as { backups: unknown[] }).backups).toHaveLength(1);
  });

  it('rotates again for a full rewrite', async () => {
    const { box } = env();
    await loadHabits();
    toggleDay('Read', today);
    await whenSaved();
    renameHabit('Read', 'Reading');                              // a full rewrite that really changes the text
    await whenSaved();
    expect((box.data as { backups: unknown[] }).backups.length).toBeGreaterThanOrEqual(2);
  });

  it('does not rotate for a write that changes nothing', async () => {
    const app = fakeApp(seed(true));
    const recorded: string[] = [];
    const record = async (prev: string) => { recorded.push(prev); };
    const doc = deserialize(app.content).doc!;

    expect((await saveDoc(app.app as never, 'habits.md', doc, { record })).ok).toBe(true);
    expect(recorded).toHaveLength(1);
    // The second write produces the text already on disk and is skipped before any rotation, so the
    // rotation cannot fill up with copies of one same file.
    expect((await saveDoc(app.app as never, 'habits.md', doc, { record })).ok).toBe(true);
    expect(recorded).toHaveLength(1);
  });

  it('keeps junk out of the rotation', async () => {
    const { app, box } = env();
    await loadHabits();
    // An outside actor clobbered the file after the last read: the text about to be replaced is junk,
    // and a copy nobody could ever restore is not worth keeping.
    app.content = 'total nonsense, and no frontmatter to go by';
    toggleDay('Read', today);
    await whenSaved();
    expect(box.data === null || (box.data as { backups?: unknown[] }).backups === undefined).toBe(true);
    expect(app.content).toContain('- name: Read');               // the healthy state was still written back
  });

  it('puts a kept copy back and re-reads it', async () => {
    const { app, box } = env();
    await loadHabits();
    const before = app.content;
    toggleDay('Read', today);
    await whenSaved();
    expect(app.content).not.toBe(before);

    const entries = (box.data as { backups: BackupEntry[] }).backups;
    await restoreFromBackup(entries[0].stamp);
    expect(app.content).toBe(before);
    expect(getState().completions.Read?.[today]).toBe('completed');
  });

  it('reports rather than throwing when asked for a copy that is gone', async () => {
    const { app } = env();
    await loadHabits();
    const before = app.content;
    await restoreFromBackup('not-a-stamp');
    expect(app.content).toBe(before);
    expect(getState().error).toBe(null);
  });
});
