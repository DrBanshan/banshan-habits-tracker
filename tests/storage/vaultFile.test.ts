import { describe, expect, it } from 'vitest';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import { forgetWrite, isOwnWrite, readDoc, saveDoc } from '../../src/storage/vaultFile';
import { serialize } from '../../src/storage/serialize';
import { fakeApp, fakeAppUnindexed, habit, MISSING } from './helpers';
import type { TrackerDoc } from '../../src/model/tracker';

const docOf = (names: string[]): TrackerDoc => normalizeDoc({
  ...emptyDoc('Fitness'), created: '2026-10-01', habits: names.map(habit),
  completions: Object.fromEntries(names.map(n => [n, { '2026-10-10': 'completed' } as never]))
});

describe('readDoc', () => {
  it('reads through the vault when indexed', async () => {
    const app = fakeApp(serialize(docOf(['Read'])));
    const out = await readDoc(app.app as never, 'habits.md');
    expect(out.ok).toBe(true);
    expect(out.doc!.habits.map(h => h.name)).toEqual(['Read']);
  });

  it('falls back to the adapter when the index has not caught up', async () => {
    const app = fakeAppUnindexed(serialize(docOf(['Read'])));
    const out = await readDoc(app.app as never, 'habits.md');
    expect(out.ok).toBe(true);
    expect(out.doc!.habits[0].name).toBe('Read');
  });

  it('reports bad-yaml instead of throwing', async () => {
    const app = fakeApp('---\n: : :\n---\n');
    const out = await readDoc(app.app as never, 'habits.md');
    expect(out.ok).toBe(false);
    expect(out.error!.kind).toBe('parse-failed');
  });
});

describe('saveDoc', () => {
  it('writes once and leaves content that reads back identical', async () => {
    const app = fakeApp(serialize(docOf(['Read'])));
    const out = await saveDoc(app.app as never, 'habits.md', docOf(['Read', 'Meditate']), { changedMonths: new Set(['2026-10']) });
    expect(out.ok).toBe(true);
    expect(app.modifyCalls).toBe(1);
    expect(out.acceptedContent).toBe(app.content);
  });

  it('refuses a write that would lose data and touches nothing', async () => {
    const keep = docOf(['Read', 'Run']);
    const app = fakeApp(serialize(keep));
    const before = app.content;
    // A doc that silently drops Run's history is what the gate must stop.
    const lossy = normalizeDoc({ ...emptyDoc('Fitness'), created: '2026-10-01', habits: [habit('Read')], completions: { Read: {} } as never });
    const out = await saveDoc(app.app as never, 'habits.md', lossy, { changedMonths: new Set(['2026-10']), protectAgainst: keep });
    expect(out.ok).toBe(false);
    expect(out.error!.kind).toBe('write-aborted-safety');
    expect(app.content).toBe(before);
    expect(app.modifyCalls).toBe(0);
    expect(out.error!.message).toMatch(/Run/);
  });

  it('surfaces a vault failure as write-failed', async () => {
    const app = fakeApp(serialize(docOf(['Read'])));
    app.failNextModify = async () => { throw new Error('read-only volume'); };
    // The doc has to differ from what is on disk, or the unchanged-content short circuit
    // returns before the vault is ever asked and there is nothing to surface.
    const out = await saveDoc(app.app as never, 'habits.md', docOf(['Read', 'Run']), {});
    expect(out.ok).toBe(false);
    expect(out.error!.kind).toBe('write-failed');
  });

  it('suppresses its own echo by fingerprint', async () => {
    const app = fakeApp(serialize(docOf(['Read'])));
    const out = await saveDoc(app.app as never, 'habits.md', docOf(['Read']), {});
    expect(isOwnWrite('habits.md', app.content)).toBe(true);
    expect(isOwnWrite('habits.md', app.content + 'x')).toBe(false);
    forgetWrite('habits.md');
    expect(isOwnWrite('habits.md', app.content)).toBe(false);
    void out;
  });

  it('creates a missing file through the adapter', async () => {
    const app = fakeApp(MISSING);
    const out = await saveDoc(app.app as never, 'habits.md', docOf(['Read']), {});
    expect(out.ok).toBe(true);
    expect(app.writeCalls + app.modifyCalls).toBeGreaterThan(0);
  });
});
