import { beforeEach, describe, expect, it } from 'vitest';
import { readDoc, saveDoc } from '../../src/storage/vaultFile';
import { docOf, fakeApp, habit, MISSING } from './helpers';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import type { TrackerErrorKind } from '../../src/model/tracker';
import { actionsFor, labelFor } from '../../src/views/errorActions';
import { getState, init, loadHabits } from '../../src/store';

describe('error taxonomy', () => {
  it('reports corrupt frontmatter as parse-failed, with a time', async () => {
    const app = fakeApp('---\n: : :\n---\n');
    const out = await readDoc(app.app as never, 'habits.md');
    expect(out.ok).toBe(false);
    expect(out.error!.kind).toBe('parse-failed');
    expect(out.error!.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('reports an absent file as file-missing-uncreatable', async () => {
    const app = fakeApp(MISSING);
    const out = await readDoc(app.app as never, 'habits.md');
    expect(out.ok).toBe(false);
    expect(out.error!.kind).toBe('file-missing-uncreatable');
  });

  it('names the habit and date a refused write would have destroyed', async () => {
    const keep = docOf(['Read', 'Run']);
    const app = fakeApp('---\nname: A\nhabits: []\n---\n');
    const lossy = normalizeDoc({ ...emptyDoc('A'), habits: [habit('Read')], completions: { Read: {} } as never });
    const out = await saveDoc(app.app as never, 'habits.md', lossy, { protectAgainst: keep });
    expect(out.error!.kind).toBe('write-aborted-safety');
    expect(out.error!.habit).toBeDefined();
    expect(out.error!.date).toBeDefined();
  });
});

describe('what the card offers, per kind', () => {
  const KINDS: TrackerErrorKind[] = [
    'parse-failed', 'write-aborted-safety', 'write-failed', 'external-edit-conflict', 'drift-healed',
    'file-missing-uncreatable'
  ];

  it('covers every failure the storage layer can produce', () => {
    for (const kind of KINDS) {
      expect(actionsFor(kind).length).toBeGreaterThan(0);
      expect(actionsFor(kind)).toContain('retry');           // a way to try again always exists
    }
  });

  it('offers no way out that destroys the user data', () => {
    for (const kind of KINDS) {
      for (const action of actionsFor(kind)) {
        expect(labelFor(action)).not.toMatch(/delete|trash|reset|wipe|remove/i);
      }
    }
  });

  it('does not offer to open a file that is not there', () => {
    expect(actionsFor('file-missing-uncreatable')).not.toContain('open-file');
    expect(actionsFor('parse-failed')).toContain('open-file');       // there, the file is worth seeing
  });

  it('always offers the way back to a kept copy when reading is what failed', () => {
    expect(actionsFor('parse-failed')).toContain('restore');
    expect(actionsFor('write-aborted-safety')).toContain('restore');
  });

  it('gives each action a label that reads as a sentence', () => {
    expect(labelFor('retry')).toBe('Retry');
    expect(labelFor('restore')).toContain('Restore');
    expect(labelFor('open-file')).toContain('data file');
    expect(labelFor('diagnostics')).toContain('diagnostics');
  });
});

describe('the store keeps a typed error beside the text', () => {
  beforeEach(() => {
    expect(getState).toBeDefined();
  });

  it('carries errorInfo and the one line of text together', async () => {
    const app = fakeApp('---\n: : :\n---\n');
    init(app.app as never, 'habits.md');
    await loadHabits();
    expect(typeof getState().error).toBe('string');
    expect(getState().errorInfo).not.toBeNull();
    expect(getState().errorInfo!.kind).toBe('parse-failed');
  });

  it('clears both once the file reads again, which is what Retry relies on', async () => {
    const app = fakeApp('---\n: : :\n---\n');
    init(app.app as never, 'habits.md');
    await loadHabits();
    expect(getState().errorInfo).not.toBeNull();

    app.content = '---\nformatVersion: 1\nname: My Fitness\ncreated: 2026-10-01\nhabits: []\n---\n';
    await loadHabits();
    expect(getState().error).toBe(null);
    expect(getState().errorInfo).toBe(null);
    expect(getState().loading).toBe(false);
  });

});
