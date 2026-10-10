import { describe, expect, it } from 'vitest';
import { enqueue, hasPending, pendingCount, whenIdle } from '../../src/storage/writeQueue';

describe('writeQueue', () => {
  it('never runs two writers for one path at a time', async () => {
    let live = 0, peak = 0;
    const slow = () => new Promise<void>(resolve => {
      live++; peak = Math.max(peak, live);
      setTimeout(() => { live--; resolve(); }, 5);
    });
    enqueue('a.md', 'toggle', slow);
    enqueue('a.md', 'toggle', slow);
    await whenIdle('a.md');
    expect(peak).toBe(1);
  });

  it('coalesces a burst into one flush that sees the newest state', async () => {
    const seen: number[] = [];
    let token = 0;
    const work = async () => { await new Promise(r => setTimeout(r, 5)); seen.push(token); };
    token = 1; enqueue('b.md', 'toggle', work);
    token = 2; enqueue('b.md', 'toggle', work);
    token = 3; enqueue('b.md', 'toggle', work);
    await whenIdle('b.md');
    expect(seen.length).toBeLessThanOrEqual(2);
    expect(seen[seen.length - 1]).toBe(3);          // the newest state always wins
    expect(hasPending('b.md')).toBe(false);
  });

  it('keeps different paths independent', async () => {
    const done: string[] = [];
    enqueue('c.md', 'toggle', async () => { await new Promise(r => setTimeout(r, 8)); done.push('c'); });
    enqueue('d.md', 'toggle', async () => { done.push('d'); });
    await whenIdle();
    expect(done).toContain('c');
    expect(done).toContain('d');
    expect(pendingCount()).toBe(0);
  });

  it('survives a writer that rejects and still runs the next one', async () => {
    let ran = 0;
    enqueue('e.md', 'x', async () => { ran++; throw new Error('boom'); });
    await whenIdle('e.md');
    expect(ran).toBe(1);                             // the rejection was contained, not rethrown

    // A later request has to reach the file: a lane that wedged on a failed write is the failure
    // mode that matters here, and it is distinct from a burst being coalesced away.
    enqueue('e.md', 'y', async () => { ran++; });
    await whenIdle('e.md');
    expect(ran).toBe(2);
    expect(pendingCount('e.md')).toBe(0);
    expect(hasPending('e.md')).toBe(false);
  });

  it('reports a burst as pending until the lane drains', async () => {
    let ran = 0;
    const slow = async () => { await new Promise(r => setTimeout(r, 10)); ran++; };
    enqueue('f.md', 'toggle', slow);
    expect(hasPending('f.md')).toBe(true);
    expect(pendingCount('f.md')).toBe(1);
    await whenIdle('f.md');
    expect(hasPending('f.md')).toBe(false);
    expect(ran).toBe(1);
  });
});
