import type { TrackerDoc } from '../../src/model/tracker';
import type { Habit } from '../../src/types';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';

export interface FakeApp {
  content: string;
  modifyCalls: number;
  writeCalls: number;
  failNextModify?: () => Promise<never>;
  app: unknown;
  emitModify: (path: string) => void;
}

export function fakeApp(initial = ''): FakeApp {
  const handlers = new Set<(data: { file: { path: string } }) => void>();
  const state: FakeApp = {
    content: initial, modifyCalls: 0, writeCalls: 0, app: null,
    emitModify: (path: string) => { for (const h of handlers) h({ file: { path } }); }
  };
  const file = { path: 'habits.md' };
  Object.defineProperty(file, 'constructor', { value: { name: 'TFile' } });
  state.app = {
    vault: {
      getAbstractFileByPath: () => (state.content === MISSING ? null : file),
      read: async () => { if (state.content === MISSING) throw new Error('missing'); return state.content; },
      modify: async (_f: unknown, text: string) => {
        state.modifyCalls++;
        if (state.failNextModify) { const f = state.failNextModify; state.failNextModify = undefined; return f(); }
        state.content = text;
      },
      adapter: {
        read: async () => { if (state.content === MISSING) throw new Error('missing'); return state.content; },
        write: async (_p: string, text: string) => { state.writeCalls++; state.content = text; },
        exists: async () => state.content !== MISSING
      },
      on: (_event: string, handler: (data: { file: { path: string } }) => void) => {
        handlers.add(handler);
        return () => { handlers.delete(handler); };
      },
      offref: (_event: string, ref: () => void) => { ref(); }
    },
    create: async (_p: string, text: string) => { state.writeCalls++; state.content = text; }
  };
  return state;
}

export const MISSING = '<<missing>>';

// Icons are glyphs, not words: a habit cell is "<icon> <name>" and the reader strips a leading
// non-letter run, so an ASCII word icon would be read back as part of the habit name.
export const habit = (name: string): Habit => ({
  name, icon: '📚', frequency: 'daily', streakMode: 'strict', startDate: '2026-10-01', color: '#0A84FF'
});

export const docOf = (names: string[], completions: Record<string, Record<string, 'completed' | 'missed'>> = {}): TrackerDoc =>
  normalizeDoc({
    ...emptyDoc('Fitness'), created: '2026-10-01', habits: names.map(habit),
    completions: Object.fromEntries(names.map(n => [n, { '2026-10-10': 'completed', ...(completions[n] ?? {}) } as never]))
  });

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** A vault index that never caught up: getAbstractFileByPath returns null but the adapter can read. */
export function fakeAppUnindexed(initial: string): FakeApp {
  const state = fakeApp(initial);
  (state.app as { vault: { getAbstractFileByPath: () => unknown } }).vault.getAbstractFileByPath = () => null;
  return state;
}

export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}
