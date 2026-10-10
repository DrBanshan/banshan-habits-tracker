import { describe, expect, it } from 'vitest';
import { saveDoc, startWatcher } from '../../src/storage/vaultFile';
import { docOf, fakeApp, sleep } from './helpers';

const FAST = { debounceMs: 10 };
const SEED = '---\nname: A\nhabits: []\n---\n';

describe('startWatcher', () => {
  it('reports an external edit once, after the debounce', async () => {
    const app = fakeApp(SEED);
    let calls = 0;
    const stop = startWatcher(app.app as never, 'habits.md', { ...FAST, onExternalEdit: () => { calls++; } });

    app.emitModify('habits.md');
    await sleep(40);
    expect(calls).toBe(1);

    app.emitModify('habits.md');                     // a second edit is a second notice
    await sleep(40);
    expect(calls).toBe(2);

    stop();
    app.emitModify('habits.md');                     // stopped listeners stay silent
    await sleep(40);
    expect(calls).toBe(2);
  });

  it('collapses a burst of edits into one notice', async () => {
    const app = fakeApp(SEED);
    let calls = 0;
    const stop = startWatcher(app.app as never, 'habits.md', { ...FAST, onExternalEdit: () => { calls++; } });
    app.emitModify('habits.md');
    app.emitModify('habits.md');
    app.emitModify('habits.md');
    await sleep(40);
    expect(calls).toBe(1);
    stop();
  });

  it('ignores edits to other files', async () => {
    const app = fakeApp(SEED);
    let calls = 0;
    const stop = startWatcher(app.app as never, 'habits.md', { ...FAST, onExternalEdit: () => { calls++; } });
    app.emitModify('other.md');
    await sleep(40);
    expect(calls).toBe(0);
    stop();
  });

  it('stays quiet about our own write', async () => {
    const app = fakeApp(SEED);
    let calls = 0;
    const stop = startWatcher(app.app as never, 'habits.md', { ...FAST, onExternalEdit: () => { calls++; } });
    await saveDoc(app.app as never, 'habits.md', docOf(['Read']), {});
    app.emitModify('habits.md');                     // the echo the vault fires for us
    await sleep(40);
    expect(calls).toBe(0);
    stop();
  });

  it('waits instead of reloading while a save is in flight', async () => {
    const app = fakeApp(SEED);
    const seen: string[] = [];
    let busy = true;
    const stop = startWatcher(app.app as never, 'habits.md', {
      ...FAST, onExternalEdit: () => { seen.push('reloaded'); }, isBusy: () => busy
    });
    app.emitModify('habits.md');
    await sleep(40);
    expect(seen).toEqual([]);                         // held while the queue is busy
    busy = false;
    await sleep(60);                                  // a save draining shortly after must still be served
    expect(seen).toEqual(['reloaded']);
    stop();
  });

  it('gives up holding rather than polling forever when a save never clears', async () => {
    const app = fakeApp(SEED);
    let calls = 0;
    const stop = startWatcher(app.app as never, 'habits.md', {
      ...FAST, onExternalEdit: () => { calls++; }, isBusy: () => true
    });
    app.emitModify('habits.md');
    await sleep(400);                                 // a bounded chain, not an eternal one
    expect(calls).toBe(0);
    stop();
  });

  it('detaches cleanly and reports no error doing it', async () => {
    const app = fakeApp(SEED);
    const stop = startWatcher(app.app as never, 'habits.md', { ...FAST, onExternalEdit: () => undefined });
    stop();
    expect(() => stop()).not.toThrow();               // a double stop must be harmless
  });
});
