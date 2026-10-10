# Habit Tracker Data-Trust Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `habits.md` impossible to corrupt through add / rename / delete / reorder / toggle, heal already-desynced files, and make external edits visible — without ever losing a user's history.

**Architecture:** All format knowledge moves out of `src/parser.ts` and `src/store.ts` into a pure Obsidian-free document model (`TrackerDoc`) with one tolerant reader (`deserialize`) and one canonical writer (`serialize`). A per-path write queue serialises today's five fire-and-forget `void persist(...)` sites, a parse-back gate refuses any write that would lose data, rotating backups live in the plugin data blob, and a debounced vault watcher reloads on external edits while suppressing our own writes by content fingerprint.

**Tech Stack:** TypeScript (strict, `src/tsconfig.json`), esbuild via `build.js`, vitest 1.x (`npm run test`), the `yaml` package for frontmatter, Obsidian plugin APIs (`ItemView`, `Setting`, `Modal`, `Notice`, `registerEvent`, `vault.on('modify')`, `loadData`/`saveData`).

**Spec:** `docs/superpowers/specs/2026-10-10-habits-storage-data-trust-design.md` — read §1.1 (verified failures) before Task 6.

---

## Conventions the worker must follow

These come from `AGENTS.md` and the `obsidian` skill; violating them fails review.

- Module-level exported functions, no classes and no `this` outside `ItemView`/`Modal` subclasses. Match `src/parser.ts` and `src/store.ts`.
- `interface` not `type` for object shapes; no `enum`; no `as` casts unless narrowing an Obsidian union (mirror `isTFile` at `src/parser.ts:14`); no `var`; no non-null `!` except the existing `settings!`.
- No `any`, no floating promises: `void promise()` or `.catch(...)` (pattern at `src/store.ts:161`).
- `async`/`await`, never `.then()` chains.
- No new `console.log` — anything diagnostic goes behind `isDebug()` (`src/store.ts:64`).
- No `fetch()` (use `plugin.requestUrl` if a network call ever appears), no Node.js imports (they break mobile), no regex lookbehind (iOS < 16.4).
- DOM only through `createEl`/`createDiv`/`createSpan`; never `document.createElement`.
- Sentence case for user-visible text ("Restore previous data file", not "Restore Previous Data File").
- Every task ends with a commit whose message states purpose ("why"), one line plus optional body, no attribution lines.

**Before every commit, both must be clean:**

```bash
npm run typecheck && npm run test
```

Expected at all times: `tsc --noEmit` prints nothing but the npm banner, and vitest ends `Test Files  N passed` / `Tests  N passed` with the starting count of 18 never decreasing.

## Two amendments to the spec

The spec was written before implementation details were pinned. These two changes are deliberate and already reflected in the tasks below; do not "fix" them back.

1. **`sha256` → FNV-1a fingerprint.** Node's `crypto` is unavailable on Obsidian mobile, and importing it would violate the Node.js-import rule the community scanner enforces. A 32-bit FNV-1a string hash is enough for "is this the file I just wrote", and it is 8 lines. See Task 9.
2. **Byte-stability is achieved by `changedMonths`, not by reusing old text.** `serialize` takes the set of month keys whose data actually changed in this flush and copies the untouched sections through verbatim; that gives both minimal diffs and a testable idempotence law. The write path already knows the touched date (`affectedDate` at `src/store.ts:303-308`), so no new bookkeeping is needed. See Tasks 3 and 10.

## File structure

| File | Responsibility (one job) | Task |
|---|---|---|
| `src/model/tracker.ts` | `TrackerDoc` shape, `normalizeDoc`, `assertInvariants`, `diffDocs` — no format strings, no Obsidian | 1 |
| `src/storage/format.ts` | format atoms only: month names, `DAY_NAMES`, ISO/legacy date conversion, cell glyphs, `stripIcon`, colour pick | 1 |
| `src/storage/deserialize.ts` | content → `TrackerDoc`; tolerant; reports what it healed | 2 |
| `src/storage/serialize.ts` | `TrackerDoc` + existing content + `changedMonths` → content | 3 |
| `src/storage/writeQueue.ts` | one in-flight writer per path, coalescing | 9 |
| `src/storage/vaultFile.ts` | only module touching `app.vault`: read, gated write, watcher, self-write suppression | 7, 11 |
| `src/storage/backup.ts` | rotating copies in the plugin data blob, restore listing | 11 |
| `src/parser.ts` | becomes a re-export façade + keeps `lintHabitsFile`/`ensureDefaultTracker` | 5, 13 |
| `src/types.ts` | adds `TrackerError`/`TrackerErrorKind`, `'manual'` cleanup mode | 14 |
| `src/store.ts` | actions route through the queue; `TrackerDoc` is the only save input | 8, 10, 14 |
| `src/main.ts` | watcher start/stop, four new commands, `'manual'` default | 12, 13, 14 |
| `src/view.ts` | error card, loading placeholder | 14 |
| `src/views/modals.ts` | `RestoreDataFileModal`, `RestoreDeletedHabitModal` | 11, 12 |
| `src/styles.css` | error card and `needsDefinition` hint styles | 14 |
| `tests/storage/helpers.ts` | shared fake `app` harness | 4 |
| `tests/storage/{model,format,deserialize,serialize,roundtrip,queue,vaultFile,backup,data-loss}.test.ts` | one file per unit above | 1–12 |

Import direction is one-way: `store → storage → model`, and `model`/`format` import nothing from Obsidian. `parser.ts` may re-export from `storage/*`, never the reverse, or the cycle breaks the headless tests.

---

## Stage 1 — pure core (no behaviour change yet)

### Task 1: Document model and format atoms

**Files:**
- Create: `src/model/tracker.ts`
- Create: `src/storage/format.ts`
- Test: `tests/storage/model.test.ts`
- Test: `tests/storage/format.test.ts`

- [ ] **Step 1: Write the failing model tests**

Create `tests/storage/model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertInvariants, diffDocs, emptyDoc, normalizeDoc } from '../../src/model/tracker';
import type { Habit } from '../../src/types';

const habit = (name: string, over: Partial<Habit> = {}): Habit => ({
  name, icon: 'X', frequency: 'daily', streakMode: 'strict',
  startDate: '2026-01-01', color: '#0A84FF', ...over
});

describe('normalizeDoc', () => {
  it('gives every habit a completions entry', () => {
    const doc = { ...emptyDoc(), habits: [habit('Read')] };
    const out = normalizeDoc(doc);
    expect(out.completions.Read).toEqual({});
  });

  it('keeps deleted habit data and unknown keys as pendingData', () => {
    const doc = {
      ...emptyDoc(), habits: [] as Habit[],
      completions: { Ghost: { '2026-01-02': 'completed' as const } },
      deletedHabits: [{ name: 'Old', deletedAt: '2026-01-03' }]
    };
    const out = normalizeDoc(doc);
    expect(out.completions.Ghost).toEqual({ '2026-01-02': 'completed' });
    expect(out.pendingData).toContain('Ghost');
    expect(out.completions.Old).toBeDefined();
  });
});

describe('assertInvariants', () => {
  it('accepts a normalized doc', () => {
    expect(() => assertInvariants(normalizeDoc({ ...emptyDoc(), habits: [habit('Read')] }), 'test')).not.toThrow();
  });

  it('rejects a non ISO date key', () => {
    const doc = normalizeDoc({ ...emptyDoc(), habits: [habit('Read')] });
    doc.completions.Read['Jan 2'] = 'completed';
    expect(() => assertInvariants(doc, 'test')).toThrow(/not ISO/);
  });

  it('rejects a habit with no completions entry', () => {
    const doc = { ...emptyDoc(), habits: [habit('Read')], completions: {} };
    expect(() => assertInvariants(doc, 'test')).toThrow(/Read/);
  });
});

describe('diffDocs', () => {
  it('reports habits and completions that disappeared', () => {
    const before = normalizeDoc({
      ...emptyDoc(), habits: [habit('Read'), habit('Run')],
      completions: { Read: { '2026-01-02': 'completed' }, Run: { '2026-01-02': 'completed' } }
    } as never);
    const after = normalizeDoc({
      ...before, habits: [habit('Read')],
      completions: { Read: {} }
    } as never);
    const d = diffDocs(before, after);
    expect(d.lostHabits).toEqual(['Run']);
    expect(d.lostCompletions).toEqual([
      { habit: 'Read', date: '2026-01-02', status: 'completed' },
      { habit: 'Run', date: '2026-01-02', status: 'completed' }
    ]);
  });
});
```

- [ ] **Step 2: Write the failing format tests**

Create `tests/storage/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CELL_DONE, CELL_MISS, buildMonthHeader, colourFor, isKnownMonthHeader, monthKeyFor, parseMonthHeader, stripIcon, toIsoDate } from '../../src/storage/format';

describe('toIsoDate', () => {
  it('passes an ISO date through', () => expect(toIsoDate('2026-01-02')).toBe('2026-01-02'));
  it('converts the legacy "Mon 6/10" form', () => expect(toIsoDate('Mon 6/10', 2020)).toBe('2020-06-10'));
  it('returns null for junk', () => expect(toIsoDate('nonsense', 2020)).toBeNull());
});

describe('month headers', () => {
  it('round-trips a built header', () => {
    expect(parseMonthHeader('## October 2026')).toEqual({ year: 2026, month: 9 });
    expect(buildMonthHeader(2026, 9)).toBe('## October 2026');
    expect(isKnownMonthHeader('## October 2026')).toBeTrue();
    expect(isKnownMonthHeader('## Notes')).toBeFalse();
    expect(monthKeyFor('2026-10-31')).toBe('2026-09');
  });
});

describe('cells', () => {
  it('maps the two glyphs', () => {
    expect(CELL_DONE).toBe('✓');
    expect(CELL_MISS).toBe('✗');
  });
  it('strips the icon prefix from a habit cell', () => {
    expect(stripIcon('📚 Reading')).toBe('Reading');
    expect(stripIcon('Reading')).toBe('Reading');
  });
  it('picks a stable colour per name', () => {
    expect(colourFor('Read')).toBe(colourFor('Read'));
  });
});
```

- [ ] **Step 3: Run them and confirm they fail for the right reason**

Run: `npx vitest run tests/storage`
Expected: FAIL, `Cannot find module` style resolution errors for `../../src/model/tracker` and `../../src/storage/format` — not assertion failures.

- [ ] **Step 4: Implement `src/storage/format.ts`**

```ts
import { DEFAULT_COLORS } from '../types';

export const CELL_DONE = '✓';
export const CELL_MISS = '✗';
export const DELETED_ICON = '🗑';
export const SYNTHESISED_ICON = '❔';
export const DELETED_COLOR = '#999999';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LEGACY_DATE = /^[A-Za-z]+\s+(\d{1,2})\/(\d{1,2})$/;

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseIsoDate(text: string): Date | null {
  const m = ISO_DATE.exec(text);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Accepts canonical ISO and the legacy "Mon 6/10" form, which carries no year. */
export function toIsoDate(header: string, fallbackYear = new Date().getFullYear()): string | null {
  if (ISO_DATE.test(header)) return header;
  const legacy = LEGACY_DATE.exec(header.trim());
  if (legacy) return `${fallbackYear}-${pad2(Number(legacy[1]))}-${pad2(Number(legacy[2]))}`;
  return null;
}

export function dayName(date: Date): string {
  return DAY_NAMES[date.getDay()];
}

export function buildMonthHeader(year: number, month: number): string {
  return `## ${MONTHS[month]} ${year}`;
}

export function isKnownMonthHeader(line: string): boolean {
  return parseMonthHeader(line) !== null;
}

export function parseMonthHeader(line: string): { year: number; month: number } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('## ')) return null;
  const parts = trimmed.slice(3).trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const month = MONTHS.indexOf(parts[0]);
  const year = Number(parts[1]);
  if (month < 0 || !Number.isInteger(year)) return null;
  return { year, month };
}

/** 'YYYY-MM', the key form used by the queue and section index. */
export function monthKeyFor(date: string): string {
  return date.slice(0, 7);
}

export function daysOfMonth(year: number, month: number): string[] {
  const count = new Date(year, month + 1, 0).getDate();
  const dates: string[] = [];
  for (let day = 1; day <= count; day++) dates.push(formatDate(new Date(year, month, day)));
  return dates;
}

/** Habit cells are "<emoji> <name>"; name may legitimately contain no leading symbol. */
export function stripIcon(cell: string): string {
  return cell.replace(/^[^\p{L}\p{Nd}]+/gu, '').trim();
}

export function colourFor(name: string): string {
  return DEFAULT_COLORS[hash32(name) % DEFAULT_COLORS.length];
}

/** Shared with the write queue's self-write suppression, hence exported. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
```

Note: `stripIcon` is a deliberate replacement for the codepoint-range regex at `src/parser.ts:33`; `\p{L}\p{Nd}` treats any leading non-letter/non-digit run as the icon, which is what the `🗑` and `❔` rows need. It must keep passing the existing `tests/parser.test.ts` cases.

- [ ] **Step 5: Implement `src/model/tracker.ts`**

```ts
import type { CompletionMap, Habit } from '../types';

export const FORMAT_VERSION = 1;

export type TrackerErrorKind =
  | 'parse-failed'
  | 'write-aborted-safety'
  | 'write-failed'
  | 'external-edit-conflict'
  | 'drift-healed'
  | 'file-missing-uncreatable';

/** Every failure the storage layer can produce, so the UI can offer the right way out. */
export interface TrackerError {
  kind: TrackerErrorKind;
  message: string;
  occurredAt: string;
  habit?: string;
  date?: string;
}

export interface DeletedHabit {
  name: string;
  deletedAt: string;
}

/**
 * The single representation of habits.md. Both the reader and the writer speak
 * this, so the frontmatter habit list and the month tables cannot be authored apart.
 */
export interface TrackerDoc {
  name: string;
  created: string;
  formatVersion: number;
  habits: Habit[];
  completions: CompletionMap;
  deletedHabits: DeletedHabit[];
  /** Frontmatter keys the plugin does not know, preserved on write. */
  extra: Record<string, unknown>;
  /** Habits merged in from a table row only, so the UI can ask the user to confirm details. */
  needsDefinition: string[];
  /** Completions held for a name that has no definition anywhere. */
  pendingData: string[];
}

export function emptyDoc(name = 'My Habits'): TrackerDoc {
  const today = new Date().toISOString().split('T')[0];
  return {
    name, created: today, formatVersion: FORMAT_VERSION,
    habits: [], completions: {}, deletedHabits: [],
    extra: {}, needsDefinition: [], pendingData: []
  };
}

export function habitNames(doc: TrackerDoc): Set<string> {
  const names = new Set<string>();
  for (const h of doc.habits) names.add(h.name);
  for (const d of doc.deletedHabits) names.add(d.name);
  for (const n of doc.pendingData) names.add(n);
  return names;
}

/**
 * Repairs the two representable inconsistencies: a habit with no completions entry,
 * and completions held under a name nothing defines (kept as pendingData, never dropped).
 */
export function normalizeDoc(doc: TrackerDoc): TrackerDoc {
  const completions: CompletionMap = {};
  for (const h of doc.habits) completions[h.name] = { ...(doc.completions[h.name] ?? {}) };
  const pendingData = [...doc.pendingData];
  for (const d of doc.deletedHabits) {
    if (!completions[d.name]) completions[d.name] = {};
  }
  for (const [name, cells] of Object.entries(doc.completions)) {
    if (completions[name]) continue;
    completions[name] = { ...cells };
    if (!pendingData.includes(name)) pendingData.push(name);
  }
  const needsDefinition = doc.needsDefinition.filter(n => doc.habits.some(h => h.name === n));
  return { ...doc, completions, needsDefinition, pendingData };
}

export function assertInvariants(doc: TrackerDoc, where: string): void {
  for (const h of doc.habits) {
    if (!doc.completions[h.name]) {
      throw new Error(`${where}: habit "${h.name}" has no completions entry`);
    }
  }
  const known = habitNames(doc);
  for (const [name, cells] of Object.entries(doc.completions)) {
    if (!known.has(name)) throw new Error(`${where}: completions for unknown habit "${name}"`);
    for (const date of Object.keys(cells)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`${where}: date key for "${name}" is not ISO YYYY-MM-DD: "${date}"`);
      }
    }
  }
}

export interface DocDiff {
  lostHabits: string[];
  lostCompletions: { habit: string; date: string; status: string }[];
}

/** Used by the parse-back gate: what would this write destroy compared to the intended doc? */
export function diffDocs(intended: TrackerDoc, actual: TrackerDoc): DocDiff {
  const lostHabits = intended.habits
    .map(h => h.name)
    .filter(name => !actual.habits.some(h => h.name === name));
  const lostCompletions: DocDiff['lostCompletions'] = [];
  for (const [name, cells] of Object.entries(intended.completions)) {
    for (const [date, status] of Object.entries(cells)) {
      if (actual.completions[name]?.[date] !== status) {
        lostCompletions.push({ habit: name, date, status });
      }
    }
  }
  return { lostHabits, lostCompletions };
}
```

- [ ] **Step 6: Run the suite**

Run: `npx vitest run tests/storage && npm run typecheck`
Expected: PASS for both new files; `tsc --noEmit` silent.

- [ ] **Step 7: Commit**

```bash
git add src/model/tracker.ts src/storage/format.ts tests/storage
git commit -m "feat: add a single document model for the habits file format" -m "Both ends of the storage layer must speak TrackerDoc so the frontmatter habit list and the month tables can no longer be authored apart."
```
### Task 2: Tolerant reader

**Files:**
- Create: `src/storage/deserialize.ts`
- Test: `tests/storage/deserialize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/deserialize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deserialize } from '../../src/storage/deserialize';

const FRONTMATTER = [
  '---',
  'name: My Fitness',
  'created: 2020-01-01',
  'habits:',
  '  - name: Reading',
  '    icon: BOOK',
  '    frequency: daily',
  '    streakMode: strict',
  '    startDate: 2020-01-01',
  '    color: "#0A84FF"',
  '---'
].join('\n');

const doc = (body: string): string => `${FRONTMATTER}\n\n${body}`;
const table = (rows: string[]): string => [
  '## October 2026',
  '| Habit | 2026-10-01 | 2026-10-02 |',
  '| --- | --- | --- |',
  ...rows
].join('\n');

describe('deserialize', () => {
  it('reads habits and completions', () => {
    const out = deserialize(doc(table(['| BOOK Reading | ✓ | |'])));
    expect(out.failure).toBeNull();
    expect(out.doc!.completions.Reading).toEqual({ '2026-10-01': 'completed' });
  });

  it('keeps the missed glyph as a distinct status', () => {
    const out = deserialize(doc(table(['| BOOK Reading | ✗ | ✓'])));
    expect(out.doc!.completions.Reading).toEqual({ '2026-10-01': 'missed', '2026-10-02': 'completed' });
  });

  it('merges a table-only habit instead of dropping it', () => {
    const out = deserialize(doc(table(['| BOOK Reading | ✓ | ✓', '| LOTUS Meditate | | ✓'])));
    expect(out.doc!.completions.Meditate).toEqual({ '2026-10-02': 'completed' });
    expect(out.doc!.needsDefinition).toEqual(['Meditate']);
    expect(out.healed).toEqual(['Meditate']);
    const synth = out.doc!.habits.find(h => h.name === 'Meditate')!;
    expect(synth.frequency).toBe('daily');
    expect(synth.streakMode).toBe('strict');
    expect(synth.startDate).toBe('2026-10-02');
  });

  it('frontmatter wins for attributes, tables win for data', () => {
    const out = deserialize(doc(table(['| OTHER Reading | ✓ | |'])));
    expect(out.doc!.habits[0].icon).toBe('BOOK');
    expect(out.doc!.completions.Reading['2026-10-01']).toBe('completed');
  });

  it('keeps a frontmatter habit with no rows as zero completions', () => {
    const out = deserialize(doc(table(['| BOOK Reading | | |'])));
    expect(out.doc!.habits).toHaveLength(1);
    expect(out.doc!.completions.Reading).toEqual({});
  });

  it('retains orphan data as pendingData', () => {
    const out = deserialize(doc(table(['| GHOST Reading | ✓ | |', '| BOOK Reading | | |'])));
    expect(out.doc!.completions.GHOST).toEqual({ '2026-10-01': 'completed' });
    expect(out.doc!.pendingData).toEqual(['GHOST']);
  });

  it('reports no-frontmatter and bad-yaml instead of throwing', () => {
    expect(deserialize('no front matter here').failure).toBe('no-frontmatter');
    expect(deserialize('---\n: : : bogus\n---\n').failure).toBe('bad-yaml');
  });

  it('yields an empty doc when habits is an empty list', () => {
    const out = deserialize(['---', 'name: Empty', 'habits: []', '---', '', '## October 2026', ''].join('\n'));
    expect(out.failure).toBeNull();
    expect(out.doc!.habits).toEqual([]);
  });

  it('preserves unknown frontmatter keys', () => {
    const out = deserialize(['---', 'name: Keep', 'habits: []', 'owner: vault-a', '---', ''].join('\n'));
    expect(out.doc!.extra.owner).toBe('vault-a');
  });

  it('reads deletedHabits and accepts their rows', () => {
    const src = ['---', 'name: Keep', 'habits:', '  - name: Reading', '    icon: BOOK', '    frequency: daily',
      '    streakMode: strict', '    startDate: 2020-01-01', 'deletedHabits:', '  - name: Old', '    deletedAt: 2026-09-01',
      '---', '', table(['| BOOK Reading | ✓ | |', '| TRASH Old | ✓ | |'])].join('\n');
    const out = deserialize(src);
    expect(out.doc!.deletedHabits).toEqual([{ name: 'Old', deletedAt: '2026-09-01' }]);
    expect(out.doc!.completions.Old).toEqual({ '2026-10-01': 'completed' });
    expect(out.doc!.needsDefinition).toEqual([]);
  });

  it('still accepts the legacy Mon 6/10 header', () => {
    const src = doc(['## October 2026', '| Habit | Wed 10/1 | Thu 10/2 |', '| --- | --- | --- |',
      '| BOOK Reading | ✓ | |'].join('\n'));
    const out = deserialize(src);
    expect(out.doc!.completions.Reading).toEqual({ '2026-10-01': 'completed' });
  });
});
```

- [ ] **Step 2: Confirm they fail**

Run: `npx vitest run tests/storage/deserialize`
Expected: FAIL, cannot resolve `../../src/storage/deserialize`.

- [ ] **Step 3: Implement `src/storage/deserialize.ts`**

```ts
import * as yaml from 'yaml';
import type { CompletionStatus, Habit } from '../types';
import { emptyDoc, normalizeDoc } from '../model/tracker';
import type { DeletedHabit, TrackerDoc } from '../model/tracker';
import { CELL_DONE, CELL_MISS, SYNTHESISED_ICON, colourFor, parseMonthHeader, stripIcon, toIsoDate } from './format';

export type DeserializeFailure = 'no-frontmatter' | 'bad-yaml' | 'no-habits';

export interface DeserializeResult {
  doc: TrackerDoc | null;
  failure: DeserializeFailure | null;
  /** Names merged in from a table row that frontmatter never listed. */
  healed: string[];
}

const HABIT_KEYS = ['name', 'icon', 'frequency', 'specificDays', 'streakMode', 'startDate', 'color'];
const DOC_KEYS = ['name', 'created', 'habits', 'deletedHabits', 'formatVersion', ...HABIT_KEYS];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractFrontmatter(content: string): string | null {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  return match ? match[1] : null;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function toHabit(raw: Record<string, unknown>): Habit | null {
  const name = asString(raw.name, '');
  if (!name) return null;
  const frequency = raw.frequency === 'weekly' || raw.frequency === 'specific' ? raw.frequency : 'daily';
  const streakMode = raw.streakMode === 'forgiving' ? 'forgiving' : 'strict';
  const days = Array.isArray(raw.specificDays)
    ? raw.specificDays.filter((d): d is string => typeof d === 'string')
    : undefined;
  return {
    name,
    icon: asString(raw.icon, SYNTHESISED_ICON),
    frequency,
    ...(frequency === 'specific' && days && days.length > 0 ? { specificDays: days } : {}),
    streakMode,
    startDate: asString(raw.startDate, new Date().toISOString().split('T')[0]),
    color: asString(raw.color, colourFor(name))
  };
}

/** Column dates of a section, in table order, skipping unparseable headers. */
function readColumnDates(lines: string[], start: number, end: number, fallbackYear: number): { column: number; date: string }[] {
  for (let i = start; i < end; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    const cells = lines[i].trim().split('|').map(c => c.trim());
    const out: { column: number; date: string }[] = [];
    for (let j = 2; j < cells.length; j++) {
      const iso = toIsoDate(cells[j], fallbackYear);
      if (iso) out.push({ column: j, date: iso });
    }
    return out;
  }
  return [];
}

export function deserialize(content: string): DeserializeResult {
  const fmText = extractFrontmatter(content);
  if (fmText === null) return { doc: null, failure: 'no-frontmatter', healed: [] };

  let raw: unknown;
  try {
    raw = yaml.parse(fmText);
  } catch {
    return { doc: null, failure: 'bad-yaml', healed: [] };
  }
  if (!isRecord(raw)) return { doc: null, failure: 'no-habits', healed: [] };
  if (!Array.isArray(raw.habits)) return { doc: null, failure: 'no-habits', healed: [] };

  const doc = emptyDoc(asString(raw.name, 'My Habits'));
  doc.created = asString(raw.created, new Date().toISOString().split('T')[0]);
  doc.formatVersion = typeof raw.formatVersion === 'number' ? raw.formatVersion : doc.formatVersion;

  for (const rawHabit of raw.habits) {
    if (!isRecord(rawHabit)) continue;
    const habit = toHabit(rawHabit);
    if (habit && !doc.habits.some(h => h.name === habit.name)) doc.habits.push(habit);
  }
  if (Array.isArray(raw.deletedHabits)) {
    for (const entry of raw.deletedHabits) {
      if (!isRecord(entry)) continue;
      const name = asString(entry.name, '');
      if (name) doc.deletedHabits.push({ name, deletedAt: asString(entry.deletedAt, '') } as DeletedHabit);
    }
  }
  for (const key of Object.keys(raw)) {
    if (!DOC_KEYS.includes(key)) doc.extra[key] = raw[key];
  }

  const lines = content.split('\n');
  const defined = new Set([...doc.habits.map(h => h.name), ...doc.deletedHabits.map(d => d.name)]);
  const healed = new Set<string>();

  for (let s = 0; s < lines.length; s++) {
    const header = parseMonthHeader(lines[s]);
    if (!header) continue;
    let end = lines.length;
    for (let i = s + 1; i < lines.length; i++) {
      if (parseMonthHeader(lines[i])) { end = i; break; }
    }
    const columns = readColumnDates(lines, s + 1, end, header.year);

    let row = s + 1;
    while (row < end && !lines[row].trim().startsWith('|')) row++;
    row += 2;                                   // skip the header row and the separator row

    for (; row < end; row++) {
      const line = lines[row].trim();
      if (!line.startsWith('|')) break;
      const cells = line.split('|').map(c => c.trim());
      if (cells.length < 3) continue;
      const name = stripIcon(cells[1]);
      if (!name) continue;

      if (!defined.has(name)) {
        defined.add(name);
        healed.add(name);
        const first = columns
          .filter(c => cells[c.column] === CELL_DONE || cells[c.column] === CELL_MISS)
          .map(c => c.date).sort()[0];
        doc.habits.push({
          name, icon: SYNTHESISED_ICON, frequency: 'daily', streakMode: 'strict',
          startDate: first ?? doc.created, color: colourFor(name)
        });
      }

      for (const { column, date } of columns) {
        const cell = cells[column];
        if (cell === undefined) continue;
        const status: CompletionStatus | null = cell === CELL_DONE ? 'completed' : cell === CELL_MISS ? 'missed' : null;
        if (!status) continue;
        (doc.completions[name] ??= {})[date] = status;
      }
    }
  }

  return { doc: normalizeDoc(doc), failure: null, healed: [...healed] };
}
```

`pendingData` is filled by `normalizeDoc` — do not set it here.

- [ ] **Step 4: Run them**

Run: `npx vitest run tests/storage/deserialize`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage/deserialize.ts tests/storage/deserialize.test.ts
git commit -m "feat: read the habits file tolerantly so table-only habits survive" -m "The old reader built completions only for habits listed in frontmatter and discarded every other cell without a word, which is what made a rename destroy history."
```

### Task 3: Canonical writer

**Files:**
- Create: `src/storage/serialize.ts`
- Test: `tests/storage/serialize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/serialize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import { serialize } from '../../src/storage/serialize';
import { deserialize } from '../../src/storage/deserialize';
import type { Habit } from '../../src/types';

const habit = (name: string, over: Partial<Habit> = {}): Habit => ({
  name, icon: 'IC', frequency: 'daily', streakMode: 'strict',
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
    expect(out).toMatch(/\|\s*IC Read\s*\|/);
    expect(out).not.toContain('Reading');
  });

  it('writes both glyphs and leaves blanks empty', () => {
    const doc = docWith({ Read: { '2026-10-01': 'completed', '2026-10-02': 'missed' } }, ['Read']);
    const row = serialize(doc).split('\n').find(l => l.includes('IC Read'))!;
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
```

- [ ] **Step 2: Confirm they fail**

Run: `npx vitest run tests/storage/serialize`
Expected: FAIL, cannot resolve `../../src/storage/serialize`.

- [ ] **Step 3: Implement `src/storage/serialize.ts`**

```ts
import * as yaml from 'yaml';
import type { TrackerDoc } from '../model/tracker';
import { CELL_DONE, CELL_MISS, DELETED_COLOR, DELETED_ICON, buildMonthHeader, daysOfMonth, monthKeyFor, parseMonthHeader } from './format';

export interface SerializeOptions {
  /** Existing file text; untouched month sections are copied out of it verbatim. */
  existingContent?: string;
  /** 'YYYY-MM' keys whose rendered text may differ this flush. Undefined means all months. */
  changedMonths?: Set<string>;
}

interface Section { year: number; month: number; text: string }

function habitToYaml(h: { name: string; icon: string; frequency: string; streakMode: string; startDate: string; color: string; specificDays?: string[] }): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: h.name, icon: h.icon, frequency: h.frequency, streakMode: h.streakMode,
    startDate: h.startDate, color: h.color
  };
  if (h.frequency === 'specific' && h.specificDays && h.specificDays.length > 0) out.specificDays = h.specificDays;
  return out;
}

function buildFrontmatter(doc: TrackerDoc): string {
  const canonical: Record<string, unknown> = {
    formatVersion: doc.formatVersion,
    name: doc.name,
    created: doc.created,
    habits: doc.habits.map(habitToYaml)
  };
  if (doc.deletedHabits.length > 0) {
    canonical.deletedHabits = doc.deletedHabits.map(d => ({ name: d.name, deletedAt: d.deletedAt }));
  }
  const merged = { ...doc.extra, ...canonical };   // canonical keys always win over preserved keys
  return yaml.stringify(merged, { lineWidth: 0 });
}

function monthsWithData(doc: TrackerDoc): Set<string> {
  const keys = new Set<string>();
  for (const cells of Object.values(doc.completions)) {
    for (const [date, status] of Object.entries(cells)) {
      if (status === 'completed' || status === 'missed') keys.add(monthKeyFor(date));
    }
  }
  return keys;
}

function renderSection(doc: TrackerDoc, year: number, month: number): string {
  const dates = daysOfMonth(year, month);
  const lines: string[] = [];
  lines.push(buildMonthHeader(year, month));
  lines.push(`| Habit | ${dates.join(' | ')} |`);
  lines.push(`| ${Array(dates.length + 1).fill('---').join(' | ')} |`);

  const rows = [
    ...doc.habits.map(h => ({ name: h.name, icon: h.icon })),
    ...doc.deletedHabits
      .filter(d => dates.some(date => doc.completions[d.name]?.[date] === 'completed' || doc.completions[d.name]?.[date] === 'missed'))
      .map(d => ({ name: d.name, icon: DELETED_ICON }))
  ];
  for (const row of rows) {
    const cells = [`${row.icon} ${row.name}`];
    for (const date of dates) {
      const status = doc.completions[row.name]?.[date];
      cells.push(status === 'completed' ? CELL_DONE : status === 'missed' ? CELL_MISS : '');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function existingSections(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const header = parseMonthHeader(lines[i]);
    if (!header) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (parseMonthHeader(lines[j])) { end = j; break; }
    }
    out.set(monthKeyFor(`${header.year}-${String(header.month + 1).padStart(2, '0')}-01`), lines.slice(i, end).join('\n'));
  }
  return out;
}

export function serialize(doc: TrackerDoc, options: SerializeOptions = {}): string {
  const withData = monthsWithData(doc);
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const keys = new Set([...withData, currentKey]);

  const wanted = [...keys]
    .map(key => ({ key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1 }))
    .sort((a, b) => a.key < b.key ? 1 : a.key > b.key ? -1 : 0);

  const carried = options.existingContent ? existingSections(options.existingContent) : new Map<string, string>();

  const sections: string[] = [];
  for (const { key, year, month } of wanted) {
    const unchanged = options.changedMonths !== undefined && !options.changedMonths.has(key);
    const previous = carried.get(key);
    sections.push(unchanged && previous !== undefined ? previous : renderSection(doc, year, month));
  }

  return `---\n${buildFrontmatter(doc)}---\n\n${sections.join('\n')}\n`;
}
```

Two things to respect: `renderSection` is the single author of a month table, replacing both `generateMonthSection` (`src/parser.ts:359`) and the inline copy in `generateTrackerContent` (`src/parser.ts:278-286`) — Task 5 deletes them; and preserved `extra` keys are merged **under** the canonical ones so a hand-added `name:` in frontmatter can never shadow the live tracker name.

- [ ] **Step 4: Run them**

Run: `npx vitest run tests/storage/serialize`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage/serialize.ts tests/storage/serialize.test.ts
git commit -m "feat: author the habits file from one canonical writer" -m "Frontmatter and month tables now come from the same TrackerDoc in a single step, so add and rename can no longer leave the two halves disagreeing."
```

### Task 4: Shared fake-app harness and the round-trip law

**Files:**
- Create: `tests/storage/helpers.ts`
- Test: `tests/storage/roundtrip.test.ts`

- [ ] **Step 1: Write the harness**

Create `tests/storage/helpers.ts`. This is the fake `app` the whole storage layer is tested against — modelled on what `src/storage/vaultFile.ts` will call, and already proven to drive the real parser head-lessly:

```ts
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

export const habit = (name: string): Habit => ({
  name, icon: 'IC', frequency: 'daily', streakMode: 'strict', startDate: '2026-10-01', color: '#0A84FF'
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
```

- [ ] **Step 2: Write the failing round-trip property test**

Create `tests/storage/roundtrip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import type { TrackerDoc } from '../../src/model/tracker';
import { deserialize } from '../../src/storage/deserialize';
import { serialize } from '../../src/storage/serialize';
import { seeded } from './helpers';
import type { Habit } from '../../src/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildDoc(seed: number): { doc: TrackerDoc; expected: TrackerDoc } {
  const rnd = seeded(seed);
  const count = 1 + Math.floor(rnd() * 4);
  const habits: Habit[] = [];
  const completions: Record<string, Record<string, 'completed' | 'missed'>> = {};
  // Deliberately spans a month end, a leap-day February and a year boundary.
  const months = ['2026-02', '2026-10', '2025-12'];
  for (let h = 0; h < count; h++) {
    const name = `H${h}`;
    const frequency = rnd() < 0.6 ? 'daily' : rnd() < 0.5 ? 'weekly' : 'specific';
    const habit: Habit = {
      name, icon: `IC${h}`, frequency: frequency as Habit['frequency'],
      streakMode: rnd() < 0.5 ? 'strict' : 'forgiving',
      startDate: '2025-12-01', color: '#0A84FF'
    };
    if (frequency === 'specific') habit.specificDays = [DAY_NAMES[Math.floor(rnd() * 7)]];
    habits.push(habit);
    const cells: Record<string, 'completed' | 'missed'> = {};
    for (const month of months) {
      const days = month === '2026-02' ? 29 : 31;
      for (let d = 1; d <= days; d++) {
        if (rnd() < 0.35) cells[`${month}-${String(d).padStart(2, '0')}`] = rnd() < 0.85 ? 'completed' : 'missed';
      }
    }
    completions[name] = cells;
  }
  const doc = normalizeDoc({ ...emptyDoc('RT'), created: '2025-12-01', habits, completions: completions as never });
  const expected = normalizeDoc({ ...emptyDoc('RT'), created: '2025-12-01', habits, completions: completions as never });
  return { doc, expected };
}

describe('round trip', () => {
  it('preserves every habit and every completion for 40 seeded docs', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { doc } = buildDoc(seed);
      const back = deserialize(serialize(doc));
      expect(back.failure, `seed ${seed}`).toBeNull();
      for (const h of doc.habits) {
        const got = back.doc!.habits.find(x => x.name === h.name);
        expect(got, `habit ${h.name} of seed ${seed}`).toBeDefined();
        expect(got!.frequency).toBe(h.frequency);
        expect(got!.streakMode).toBe(h.streakMode);
        expect(got!.color).toBe(h.color);
      }
      for (const [name, cells] of Object.entries(doc.completions)) {
        for (const [date, status] of Object.entries(cells)) {
          expect(back.doc!.completions[name]?.[date], `seed ${seed} ${name} ${date}`).toBe(status);
        }
      }
    }
  });
});
```

- [ ] **Step 3: Run it and read the result**

Run: `npx vitest run tests/storage/roundtrip`
Expected: PASS once Tasks 2 and 3 are in. If a seed fails, the message names `seed N habit/date` — fix the writer or reader, never the expectation, and keep the seed in the commit body.

- [ ] **Step 4: Commit**

```bash
git add tests/storage/helpers.ts tests/storage/roundtrip.test.ts
git commit -m "test: assert the habits file round-trips without loss" -m "parse(serialize(doc)) must preserve habits and completions exactly across month ends, leap February and the year boundary, for seeded random documents."
```

### Task 5: Reduce `parser.ts` to a façade

**Files:**
- Modify: `src/parser.ts` (delete `generateTrackerContent`, `buildMonthSection`, `generateMonthDates`, `getMonthName`, `getDayName`, `findMonthsWithData`, `stripIcon`, `parseHabit`; keep `parseTrackerFile`, `readTrackerFile`, `writeTrackerFile`, `lintHabitsFile`, `ensureDefaultTracker`, `isTFile`)
- Test: existing `tests/parser.test.ts` — must stay green, unchanged

- [ ] **Step 1: Re-export from the new modules**

Replace the top imports of `src/parser.ts` with the façade imports and delete the functions listed above, keeping the signatures other modules call:

```ts
import * as yaml from 'yaml';
import type { App, TAbstractFile, TFile } from 'obsidian';
import type { Tracker } from '../types';
import { deserialize } from './deserialize';
import { serialize } from './serialize';
import { buildMonthHeader, parseMonthHeader, toIsoDate } from './format';
```

`parseTrackerFile(content)` keeps returning `Tracker | null` for compatibility, delegating to the tolerant reader so the fix is live for every existing caller the moment this task lands:

```ts
export function parseTrackerFile(content: string): Tracker | null {
  const { doc, failure } = deserialize(content);
  if (!doc || failure) return null;
  return { name: doc.name, created: doc.created, habits: doc.habits, completions: doc.completions };
}
```

`generateTrackerContent(tracker, daysToShow, filterEmptyMonths)` becomes a shim over the writer; `daysToShow` is already unused by the old code and stays ignored:

```ts
export function generateTrackerContent(tracker: Tracker, daysToShow = 21, filterEmptyMonths = true): string {
  return serialize(normalizeDoc({
    ...emptyDoc(tracker.name), created: tracker.created,
    habits: tracker.habits, completions: tracker.completions
  }));
}
```

Keep `writeTrackerFile` for now — it is replaced in Task 7 and deleted in Task 10; do not touch it in this task.

- [ ] **Step 2: Run the pre-existing suite untouched**

Run: `npm run test`
Expected: PASS with **18** tests — including the three `generateTrackerContent` cases and the "round-trips multi-section data correctly" case at `tests/parser.test.ts:205`. Any red here means the new writer diverged from the old format; fix the writer, and never edit the old expectations to match new output.

- [ ] **Step 3: Typecheck and check for orphans your change created**

Run: `npm run typecheck && npx tsc --noEmit --listFiles 2>/dev/null | tail -1`
Then confirm nothing your change made unused survives in `src/parser.ts`: the deleted helpers above must have no remaining references (`grep -n "generateMonthDates\|buildMonthSection\|findMonthsWithData\|getDayName" src/parser.ts` prints nothing).

- [ ] **Step 4: Commit**

```bash
git add src/parser.ts
git commit -m "refactor: keep parser as a façade over the new storage modules" -m "parseTrackerFile now delegates to the tolerant reader, so table-only habits survive for every existing call site, and the duplicated month renderers go away."
```

### Task 6: Pin the four proven failures as tests (they must go red here)

**Files:**
- Test: `tests/storage/data-loss.test.ts`

- [ ] **Step 1: Write the four probes as behavioural tests**

Create `tests/storage/data-loss.test.ts`. Each asserts *data survived*, not file text, so a red run points straight at a lost completion:

```ts
import { describe, expect, it } from 'vitest';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import { deserialize } from '../../src/storage/deserialize';
import { serialize } from '../../src/storage/serialize';
import { fakeApp, MISSING } from './helpers';
import type { TrackerDoc } from '../../src/model/tracker';
import type { Habit } from '../../src/types';

const TODAY = '2026-10-10';
const habit = (name: string): Habit => ({
  name, icon: 'IC', frequency: 'daily', streakMode: 'strict', startDate: '2026-10-01', color: '#0A84FF'
});

function docOf(names: string[], completions: Record<string, Record<string, 'completed'>>): TrackerDoc {
  return normalizeDoc({ ...emptyDoc('Fitness'), created: '2026-10-01', habits: names.map(habit), completions: completions as never });
}

/** P1 from the spec: add a habit, record a completion, read the file again. */
describe('P1 add', () => {
  it('survives a reload', () => {
    const before = docOf(['Read'], { Read: { [TODAY]: 'completed' } });
    const afterAdd = docOf(['Read', 'Meditate'], {
      Read: { [TODAY]: 'completed' }, Meditate: { [TODAY]: 'completed' }
    });
    const content = serialize(afterAdd, { existingContent: serialize(before), changedMonths: new Set(['2026-10']) });
    expect(deserialize(content).doc!.completions.Meditate[TODAY]).toBe('completed');
  });
});

/** P2: renaming must keep the whole history under the new name. */
describe('P2 rename', () => {
  it('preserves history', () => {
    const before = docOf(['Reading'], { Reading: { [TODAY]: 'completed', '2026-10-09': 'completed' } });
    const afterRename = docOf(['Read'], { Read: { [TODAY]: 'completed', '2026-10-09': 'completed' } });
    const content = serialize(afterRename, { existingContent: serialize(before), changedMonths: new Set(['2026-10']) });
    const reloaded = deserialize(content);
    expect(reloaded.doc!.completions.Read['2026-10-09']).toBe('completed');
    expect(reloaded.doc!.completions.Reading).toBeUndefined();
  });
});

/** P4: the deleted-habit archive must be written, not just held in memory. */
describe('P4 deletedHabits', () => {
  it('round-trips the archive and its data', () => {
    const doc = normalizeDoc({
      ...docOf(['Read'], { Read: { [TODAY]: 'completed' }, Old: { [TODAY]: 'completed' } }),
      deletedHabits: [{ name: 'Old', deletedAt: '2026-10-05' }]
    });
    const back = deserialize(serialize(doc));
    expect(back.doc!.deletedHabits).toEqual([{ name: 'Old', deletedAt: '2026-10-05' }]);
    expect(back.doc!.completions.Old[TODAY]).toBe('completed');
  });
});

/** The gate of Task 7: a refused write must leave the file untouched. */
describe('gate', () => {
  it.skip('refuses a write that would lose data and leaves the file byte-identical', async () => {
    expect(true).toBeFalse();
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/storage/data-loss`
Expected: **the P1/P2/P4 cases already PASS here** — Tasks 1–5 fixed the writer and reader — and the skipped `gate` case is the deliberate placeholder for Task 7 (it is `it.skip`, so vitest reports 3 passed, 1 skipped). The probes in §1.1 of the spec were red against the *old* code path; these exercise the new one. The old-path red is proven in step 3 instead.

- [ ] **Step 3: Prove the pin catches the old behaviour too**

Run: `git stash && npx vitest run tests/storage/data-loss 2>&1 | tail -20 && git stash pop`
Expected: the P1/P2/P4 cases FAIL while the old `parser.ts`/`tracker` shape is in place, then PASS again after `git stash pop`. If they pass against the old code, the assertions are not testing what they claim — tighten them before continuing. (The four pre-existing probes at `tests/parser.test.ts` are not a substitute; they never rename or add.)

- [ ] **Step 4: Commit**

```bash
git add tests/storage/data-loss.test.ts
git commit -m "test: pin the four data-loss cases found in the habits file storage" -m "Behavioural pins for spec section 1.1: an added habit, a renamed habit, the deleted-habit archive and a refused write."
```
### Task 7: The only writer, with a parse-back gate

**Files:**
- Create: `src/storage/vaultFile.ts`
- Test: `tests/storage/vaultFile.test.ts`
- Test: un-skip the `gate` case in `tests/storage/data-loss.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/vaultFile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import { readDoc, saveDoc } from '../../src/storage/vaultFile';
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
    expect(out.ok).toBeTrue();
    expect(out.doc!.habits.map(h => h.name)).toEqual(['Read']);
  });

  it('falls back to the adapter when the index has not caught up', async () => {
    const app = fakeAppUnindexed(serialize(docOf(['Read'])));
    const out = await readDoc(app.app as never, 'habits.md');
    expect(out.ok).toBeTrue();
    expect(out.doc!.habits[0].name).toBe('Read');
  });

  it('reports bad-yaml instead of throwing', async () => {
    const app = fakeApp('---\n: : :\n---\n');
    const out = await readDoc(app.app as never, 'habits.md');
    expect(out.ok).toBeFalse();
    expect(out.error!.kind).toBe('parse-failed');
  });
});

describe('saveDoc', () => {
  it('writes once and leaves content that reads back identical', async () => {
    const app = fakeApp(serialize(docOf(['Read'])));
    const out = await saveDoc(app.app as never, 'habits.md', docOf(['Read', 'Meditate']), { changedMonths: new Set(['2026-10']) });
    expect(out.ok).toBeTrue();
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
    expect(out.ok).toBeFalse();
    expect(out.error!.kind).toBe('write-aborted-safety');
    expect(app.content).toBe(before);
    expect(app.modifyCalls).toBe(0);
    expect(out.error!.message).toMatch(/Run/);
  });

  it('surfaces a vault failure as write-failed', async () => {
    const app = fakeApp(serialize(docOf(['Read'])));
    app.failNextModify = async () => { throw new Error('read-only volume'); };
    const out = await saveDoc(app.app as never, 'habits.md', docOf(['Read']), {});
    expect(out.ok).toBeFalse();
    expect(out.error!.kind).toBe('write-failed');
  });

  it('suppresses its own echo by fingerprint', async () => {
    const app = fakeApp(serialize(docOf(['Read'])));
    const out = await saveDoc(app.app as never, 'habits.md', docOf(['Read']), {});
    expect(isOwnWrite('habits.md', app.content)).toBeTrue();
    expect(isOwnWrite('habits.md', app.content + 'x')).toBeFalse();
    forgetWrite('habits.md');
    expect(isOwnWrite('habits.md', app.content)).toBeFalse();
    void out;
  });

  it('creates a missing file through the adapter', async () => {
    const app = fakeApp(MISSING);
    const out = await saveDoc(app.app as never, 'habits.md', docOf(['Read']), {});
    expect(out.ok).toBeTrue();
    expect(app.writeCalls + app.modifyCalls).toBeGreaterThan(0);
  });
});
```

Add the two imports it needs at the top of that file: `import { forgetWrite, isOwnWrite } from '../../src/storage/vaultFile';`

- [ ] **Step 2: Confirm they fail**

Run: `npx vitest run tests/storage/vaultFile`
Expected: FAIL, cannot resolve `../../src/storage/vaultFile`.

- [ ] **Step 3: Implement `src/storage/vaultFile.ts`**

```ts
import type { App } from 'obsidian';
import { assertInvariants, diffDocs } from '../model/tracker';
import type { DocDiff, TrackerDoc } from '../model/tracker';
import { deserialize } from './deserialize';
import { serialize } from './serialize';
import { hash32 } from './format';
import type { TrackerError, TrackerErrorKind } from '../model/tracker';

export interface SaveOptions {
  changedMonths?: Set<string>;
  /** The document the gate must not let this write fall behind, usually last-known-good state. */
  protectAgainst?: TrackerDoc;
  onNotice?: (kind: TrackerErrorKind, message: string) => void;
}

export interface FileResult {
  ok: boolean;
  doc: TrackerDoc | null;
  acceptedContent?: string;
  loss?: DocDiff;
  error?: TrackerError;
}

const lastWritten = new Map<string, number>();

function fail(kind: TrackerErrorKind, message: string, habit?: string, date?: string): TrackerError {
  return { kind, message, occurredAt: new Date().toISOString(), ...(habit ? { habit } : {}), ...(date ? { date } : {}) };
}

export async function readDoc(app: App, path: string): Promise<FileResult> {
  const viaIndex = app.vault.getAbstractFileByPath(path);
  if (viaIndex) {
    const file = viaIndex as Parameters<App['vault']['read']>[0];
    const content = await app.vault.read(file);
    return fromText(content, path);
  }
  try {
    return fromText(await app.vault.adapter.read(path), path);
  } catch {
    return { ok: false, doc: null, error: fail('file-missing-uncreatable', `No data file at ${path} and none could be created`) };
  }
}

function fromText(content: string, path: string): FileResult {
  const { doc, failure, healed } = deserialize(content);
  if (!doc || failure) {
    return { ok: false, doc: null, error: fail('parse-failed', `${path}: ${failure === 'bad-yaml' ? 'the properties block is not valid YAML' : failure === 'no-habits' ? 'the properties block lists no habits' : 'the file has no properties block'}`) };
  }
  try {
    assertInvariants(doc, 'read');
  } catch (e) {
    return { ok: false, doc: null, error: fail('parse-failed', e instanceof Error ? e.message : 'invalid document') };
  }
  if (healed.length > 0) {
    lastWritten.set(path, hash32(content));
    void import('../store').then(m => m.reportDrift(healed)).catch(() => { /* surfaced by store */ });
  }
  return { ok: true, doc, acceptedContent: content };
}

export async function saveDoc(app: App, path: string, doc: TrackerDoc, options: SaveOptions = {}): Promise<FileResult> {
  try {
    assertInvariants(doc, 'write');
  } catch (e) {
    return { ok: false, doc: null, error: fail('write-aborted-safety', e instanceof Error ? e.message : 'invalid document') };
  }

  const existing = await readExisting(app, path);
  let content: string;
  try {
    content = serialize(doc, { existingContent: existing ?? undefined, changedMonths: options.changedMonths });
  } catch (e) {
    return { ok: false, doc, error: fail('write-aborted-safety', e instanceof Error ? e.message : 'serialisation failed') };
  }

  const check = deserialize(content);
  if (!check.doc || check.failure) {
    return { ok: false, doc, acceptedContent: existing ?? undefined, error: fail('write-aborted-safety', `the produced file would not read back (${check.failure ?? 'unknown'})`) };
  }
  const baseline = options.protectAgainst ?? doc;
  const loss = diffDocs(baseline, check.doc);
  if (loss.lostHabits.length > 0 || loss.lostCompletions.length > 0) {
    const detail = [
      ...loss.lostHabits.map(n => `habit "${n}"`),
      ...loss.lostCompletions.slice(0, 5).map(l => `${l.habit} ${l.date}`)
    ].join(', ');
    return {
      ok: false, doc, acceptedContent: existing ?? undefined, loss,
      error: fail('write-aborted-safety', `write refused: it would drop ${detail}${loss.lostCompletions.length > 5 ? ` and ${loss.lostCompletions.length - 5} more` : ''}`, loss.lostCompletions[0]?.habit, loss.lostCompletions[0]?.date)
    };
  }

  if (content === existing) return { ok: true, doc, acceptedContent: content };

  try {
    const abstract = app.vault.getAbstractFileByPath(path);
    if (abstract) {
      await app.vault.modify(abstract as Parameters<App['vault']['modify']>[0], content);
    } else {
      await app.vault.adapter.write(path, content);
    }
  } catch (e) {
    return { ok: false, doc, error: fail('write-failed', e instanceof Error ? e.message : 'the vault refused the write') };
  }

  lastWritten.set(path, hash32(content));
  return { ok: true, doc, acceptedContent: content };
}

async function readExisting(app: App, path: string): Promise<string | null> {
  const abstract = app.vault.getAbstractFileByPath(path);
  if (abstract) return app.vault.read(abstract as Parameters<App['vault']['read']>[0]);
  try {
    return await app.vault.adapter.read(path);
  } catch {
    return null;
  }
}

/** True when this text is byte-for-byte what this process last accepted for that path. */
export function isOwnWrite(path: string, content: string): boolean {
  return lastWritten.get(path) === hash32(content);
}

export function forgetWrite(path: string): void {
  lastWritten.delete(path);
}
```

`import('../store')` inside `fromText` exists only to keep `storage → store` out of the import graph; `reportDrift` is added in Task 8 Step 1, so land that step before this one if you reorder.

- [ ] **Step 4: Un-skip and run the gate pin**

Replace the placeholder in `tests/storage/data-loss.test.ts` — delete the `it.skip('refuses a write that would lose data...')` block and the whole `describe('gate', ...)` wrapper, then add this case inside a new `describe('gate', ...)`:

```ts
import { saveDoc } from '../../src/storage/vaultFile';
import { normalizeDoc, emptyDoc } from '../../src/model/tracker';

  it('refuses a write that would lose data and leaves the file byte-identical', async () => {
    const keep = docOf(['Read', 'Run'], { Read: { [TODAY]: 'completed' }, Run: { [TODAY]: 'completed' } });
    const app = fakeApp(serialize(keep));
    const before = app.content;
    const lossy = normalizeDoc({ ...emptyDoc('Fitness'), created: '2026-10-01', habits: [habit('Read')], completions: { Read: {} } as never });
    const out = await saveDoc(app.app as never, 'habits.md', lossy, { protectAgainst: keep });
    expect(out.ok).toBeFalse();
    expect(out.error!.kind).toBe('write-aborted-safety');
    expect(app.content).toBe(before);
  });
```

Run: `npx vitest run tests/storage/vaultFile tests/storage/data-loss`
Expected: PASS, 4 + 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/storage/vaultFile.ts tests/storage/vaultFile.test.ts tests/storage/data-loss.test.ts
git commit -m "feat: gate habits file writes behind a re-parse that must lose nothing" -m "A produced document is read back and compared with the last known good one; any lost habit or completion aborts the write and leaves the file untouched."
```

### Task 8: Route the store through the new document and writer

**Files:**
- Modify: `src/store.ts:296-320` (`persist`), the five `void persist(...)` sites (`:161`, `:181`, `:206`, `:236`, `:253`, `:285`), `init` (`:47-62`), `loadHabits` (`:69-141`)
- Test: `tests/storage/store-save.test.ts`

- [ ] **Step 1: Add the drift reporter and document plumbing to `src/store.ts`**

Replace the module-local state's file handling so the store owns one current document. Add these imports to `src/store.ts` first, all matching the one-way `store → storage → model` direction:

```ts
import { emptyDoc, normalizeDoc } from './model/tracker';
import type { TrackerDoc, TrackerErrorKind } from './model/tracker';
import { readDoc, saveDoc } from './storage/vaultFile';
import { enqueue, hasPending, whenIdle } from './storage/writeQueue';
```

Then add near the other module state:

```ts
let lastGoodDoc: TrackerDoc | null = null;
let notices: { kind: TrackerErrorKind; message: string }[] = [];

export function reportDrift(healed: string[]): void {
  notices.push({ kind: 'drift-healed', message: `${healed.length} habit(s) were present only as a table row: ${healed.join(', ')}` });
}

export function takeNotices(): { kind: TrackerErrorKind; message: string }[] {
  const out = notices;
  notices = [];
  return out;
}

export function getLastGoodDoc(): TrackerDoc | null {
  return lastGoodDoc ? normalizeDoc({ ...lastGoodDoc }) : null;
}
```

In `loadHabits` (`src/store.ts:69-141`) replace the hand-rolled read/lint/parse ladder with the reader, and record the good document:

```ts
export async function loadHabits(): Promise<void> {
  if (!appRef) return;
  setState(s => ({ ...s, loading: true, error: null }));
  const out = await readDoc(appRef, habitsFilePath);
  if (!out.ok || !out.doc) {
    setState(s => ({ ...s, loading: false, errorInfo: out.error ?? null, error: out.error?.message ?? 'Unknown error' }));
    return;
  }
  const doc = out.doc;
  lastGoodDoc = doc;
  const streaks: Record<string, StreakInfo> = {};
  for (const habit of doc.habits) streaks[habit.name] = calculateStreak(habit, doc.completions);
  setState(s => ({
    ...s,
    habits: doc.habits,
    completions: doc.completions,
    streaks,
    selectedHabit: doc.habits.length > 0 ? doc.habits[0].name : null,
    loading: false,
    errorInfo: null,
    deletedHabits: doc.deletedHabits,
    needsDefinition: doc.needsDefinition,
    pendingData: doc.pendingData
  }));
  void flushNotices();
}

async function flushNotices(): Promise<void> {
  const { Notice } = await import('obsidian');
  for (const n of takeNotices()) new Notice(n.message, 6000);
}
```

`errorInfo`, `needsDefinition` and `pendingData` are added to `AppState` in Task 14; to keep this task compiling, add them now as optional in `src/types.ts`:

```ts
  errorInfo?: TrackerError | null;
  needsDefinition?: string[];
  pendingData?: string[];
```

- [ ] **Step 2: Replace `persist` with a document save**

Delete `persist` at `src/store.ts:296-320` entirely — including the `name: 'My Habits'` / `created: today` literal that clobbered user frontmatter on full regeneration — and add:

```ts
function currentDoc(): TrackerDoc {
  const s = getState();
  return normalizeDoc({
    ...(lastGoodDoc ?? emptyDoc()),
    habits: s.habits,
    completions: s.completions,
    deletedHabits: s.deletedHabits ?? [],
    needsDefinition: s.needsDefinition ?? [],
    pendingData: s.pendingData ?? []
  });
}

function requestSave(changedDates: string[]): void {
  if (!appRef) return;
  void saveNow(changedDates).catch(e => {
    console.warn('[HabitTracker] save failed', e);
  });
}

async function saveNow(changedDates: string[]): Promise<void> {
  if (!appRef) return;
  const changedMonths = changedDates.length > 0 ? new Set(changedDates.map(d => d.slice(0, 7))) : undefined;
  const out = await saveDoc(appRef, habitsFilePath, currentDoc(), { changedMonths, protectAgainst: lastGoodDoc ?? undefined });
  if (out.ok) {
    if (out.doc) lastGoodDoc = out.doc;
    return;
  }
  if (out.error) {
    setState(s => ({ ...s, errorInfo: out.error ?? null, error: out.error?.message ?? 'Failed to save' }));
    console.warn(`[HabitTracker] ${out.error.kind}: ${out.error.message}`);
  }
}
```

Update every former call: `toggleDay` becomes `requestSave([date])` (`src/store.ts:161`); `addHabit`, `renameHabit`, `deleteHabit`, `setHabitColor` and `reorderHabits` become `requestSave([])` — an empty list means "every month may change", which is exactly what a definition change can touch.

`renameHabit` (`src/store.ts:190-215`) additionally must move the completion cells to the new key before saving; it already does (`:200-204`) — leave that logic alone, it becomes correct once both halves are written together.

- [ ] **Step 3: Write the store-level save test that reproduces P1/P2 through the UI actions**

Create `tests/storage/store-save.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addHabit, deleteHabit, getState, init, loadHabits, renameHabit, toggleDay } from '../../src/store';
import { serialize } from '../../src/storage/serialize';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';
import { fakeApp } from './helpers';
import type { Habit } from '../../src/types';

let app: ReturnType<typeof fakeApp>;
const today = new Date().toISOString().split('T')[0];

const habit = (name: string): Habit => ({
  name, icon: 'IC', frequency: 'daily', streakMode: 'strict', startDate: today, color: '#0A84FF'
});

beforeEach(async () => {
  app = fakeApp(serialize(normalizeDoc({
    ...emptyDoc('My Fitness'), created: '2026-10-01', habits: [habit('Reading')],
    completions: { Reading: { [today]: 'completed' } } as never
  })));
  init(app.app as never, 'habits.md');
  await loadHabits();
});

afterEach(() => {
  expect(getState().errorInfo?.kind ?? null).toBeNull();
});

async function settled(): Promise<void> {
  // One macrotask flush is enough while saves are awaited inside requestSave's own promise chain.
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('store saves', () => {
  it('keeps a renamed habit history', async () => {
    renameHabit('Reading', 'Read');
    await settled();
    expect(app.content).toMatch(/- name: Read\b/);
    expect(app.content).not.toMatch(/- name: Reading\b/);
    expect(app.content).toMatch(/IC Read\s*\|[^|]*✓/);
  });

  it('keeps a newly added habit data', async () => {
    addHabit(habit('Meditate'));
    toggleDay('Meditate', today);
    await settled();
    expect(app.content).toMatch(/- name: Meditate\b/);
    expect(app.content).toMatch(/IC Meditate\s*\|[^|]*✓/);
  });

  it('keeps a deleted habit archive in the file', async () => {
    addHabit(habit('Temp'));
    await settled();
    deleteHabit('Temp', true);
    await settled();
    expect(app.content).toMatch(/deletedHabits:/);
    expect(app.content).toMatch(/- name: Temp/);
  });

  it('preserves the tracker name and created the user chose', async () => {
    toggleDay('Reading', today);
    await settled();
    expect(app.content).toContain('name: My Fitness');
    expect(app.content).toContain('created: 2026-10-01');
  });
});
```

- [ ] **Step 4: Run the whole gate**

Run: `npm run test && npm run typecheck`
Expected: PASS — 18 pre-existing plus everything added in Tasks 1–8, and a silent typecheck. The four cases above are the spec's §1.1 evidence at the level a user touches.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/types.ts tests/storage/store-save.test.ts
git commit -m "fix: save the habits file from one document so history stops disappearing" -m "Adding or renaming a habit no longer desynchronises the properties list from the month tables, and saving no longer rewrites the user's tracker name or created date."
```

### Task 9: Serialise writers per path

**Files:**
- Create: `src/storage/writeQueue.ts`
- Test: `tests/storage/queue.test.ts`
- Modify: `src/store.ts` (`requestSave`/`saveNow`)

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/queue.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { pendingCount, whenIdle } from '../../src/storage/writeQueue';
import { enqueue } from '../../src/storage/writeQueue';

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

  it('survives a writer that rejects', async () => {
    let second = false;
    enqueue('e.md', 'x', async () => { throw new Error('boom'); });
    enqueue('e.md', 'y', async () => { second = true; });
    await whenIdle('e.md');
    expect(second).toBeTrue();
    expect(pendingCount()).toBe(0);
    void vi;
  });
});
```

- [ ] **Step 2: Confirm they fail**

Run: `npx vitest run tests/storage/queue`
Expected: FAIL, cannot resolve `../../src/storage/writeQueue`.

- [ ] **Step 3: Implement `src/storage/writeQueue.ts`**

```ts
export type Writer = () => Promise<void>;

interface Lane { tail: Promise<void>; pending: number; dirty: boolean }
const lanes = new Map<string, Lane>();

/**
 * One in-flight writer per path, with coalescing: while a write is running further
 * requests only mark the lane dirty, and the next flush reads state fresh at that moment.
 */
export function enqueue(path: string, reason: string, writer: Writer): Promise<void> {
  const lane = lanes.get(path) ?? { tail: Promise.resolve(), pending: 0, dirty: false };
  lanes.set(path, lane);
  lane.pending++;
  lane.dirty = true;
  void reason;

  lane.tail = lane.tail.then(async () => {
    if (!lane.dirty) return;
    lane.dirty = false;
    try {
      await writer();
    } catch (e) {
      console.warn('[HabitTracker] queued write failed', e);
    }
  });

  return lane.tail.then(() => {
    lane.pending = Math.max(0, lane.pending - 1);
    if (lane.pending === 0) lanes.delete(path);
  });
}

export function pendingCount(path?: string): number {
  if (path !== undefined) return lanes.get(path)?.pending ?? 0;
  let total = 0;
  for (const lane of lanes.values()) total += lane.pending;
  return total;
}

export function hasPending(path?: string): boolean {
  return pendingCount(path) > 0;
}

export function whenIdle(path?: string): Promise<void> {
  if (path !== undefined) {
    const lane = lanes.get(path);
    return lane ? lane.tail.then(() => undefined) : Promise.resolve();
  }
  return Promise.all([...lanes.values()].map(l => l.tail.then(() => undefined))).then(() => undefined);
}
```

- [ ] **Step 4: Wire the store to it**

In `src/store.ts` make `requestSave` enqueue instead of firing, and expose idleness for tests and the watcher:

```ts
function requestSave(changedDates: string[]): void {
  if (!appRef) return;
  pendingDates.addAll(changedDates);
  void enqueue(habitsFilePath, 'save', async () => {
    const dates = [...pendingDates];
    pendingDates.clear();
    await saveNow(dates);
  }).catch(() => { /* surfaced by saveNow */ });
}

const pendingDates = new Set<string>();
```

Add next to it:

```ts
export function whenSaved(): Promise<void> {
  return whenIdle(habitsFilePath);
}

export function isSaving(): boolean {
  return hasPending(habitsFilePath);
}
```

Then simplify `tests/storage/store-save.test.ts`: replace the two-tick `settled()` body with `await whenSaved();` and import `whenSaved` from `../../src/store`.

- [ ] **Step 5: Run and commit**

Run: `npm run test && npm run typecheck`
Expected: PASS, silent typecheck.

```bash
git add src/storage/writeQueue.ts src/store.ts tests/storage/queue.test.ts tests/storage/store-save.test.ts
git commit -m "fix: serialise data file writes so quick toggles stop overwriting each other" -m "Each path gets one in-flight writer and a burst coalesces into a flush that snapshots state at flush time, replacing five independent fire-and-forget read-modify-write cycles."
```

### Task 10: Delete the legacy writer

**Files:**
- Modify: `src/parser.ts` (delete `writeTrackerFile` and any import left unused by that deletion)
- Test: existing suite

- [ ] **Step 1: Prove nothing references it any more**

Run: `grep -rn "writeTrackerFile" src tests`
Expected: only the definition and its own doc comment — no call sites. If a call site remains, stop and route it through `saveDoc` first; do not delete a function that is still called.

- [ ] **Step 2: Delete it**

Remove `writeTrackerFile` from `src/parser.ts` (`src/parser.ts:381` onward, through the end of its empty-section trimming), plus imports it alone used. Per `AGENTS.md` §3 clean up only orphans your own change created — leave `lintHabitsFile` and `ensureDefaultTracker` untouched.

- [ ] **Step 3: Run the suite and build for real**

Run: `npm run test && npm run typecheck && npm run build`
Expected: PASS, silent typecheck, build ends with `Build complete`.

- [ ] **Step 4: Commit**

```bash
git add src/parser.ts
git commit -m "refactor: remove the section patching writer superseded by the canonical writer" -m "It rewrote only the affected month, which is how the properties list and the tables drifted apart after an add or a rename."
```

### Task 11: Rotating backups and Restore

**Files:**
- Create: `src/storage/backup.ts`
- Create: `src/views/modals.ts` additions (`RestoreDataFileModal`)
- Modify: `src/main.ts` (plugin data blob shape, `Restore previous data file` command)
- Test: `tests/storage/backup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/backup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BackupStore, MAX_BACKUPS } from '../../src/storage/backup';

function blobStore(): { data: Record<string, unknown> | null } {
  return { data: null };
}

describe('BackupStore', () => {
  it('keeps at most MAX_BACKUPS copies, newest first', async () => {
    const holder = blobStore();
    const store = new BackupStore(async () => holder.data, async (d) => { holder.data = d; });
    for (let i = 1; i <= MAX_BACKUPS + 3; i++) await store.record(`v${i}`);
    const list = await store.list();
    expect(list).toHaveLength(MAX_BACKUPS);
    expect(list[0].content).toBe(`v${MAX_BACKUPS + 3}`);
  });

  it('does not record the same content twice in a row', async () => {
    const holder = blobStore();
    const store = new BackupStore(async () => holder.data, async (d) => { holder.data = d; });
    await store.record('same');
    await store.record('same');
    expect(await store.list()).toHaveLength(1);
  });

  it('survives a corrupt blob', async () => {
    const holder = blobStore();
    const store = new BackupStore(async () => holder.data, async (d) => { holder.data = d; });
    await store.record('good');
    holder.data = { backups: 'nonsense' };
    expect(await store.take('nope')).toBeNull();
    const list = await store.list();
    expect(list.every(b => typeof b.content === 'string')).toBeTrue();
  });

  it('returns the requested copy verbatim', async () => {
    const holder = blobStore();
    const store = new BackupStore(async () => holder.data, async (d) => { holder.data = d; });
    await store.record('---\nname: A\n---\n');
    const [entry] = await store.list();
    expect(await store.take(entry.stamp)).toBe('---\nname: A\n---\n');
  });
});
```

- [ ] **Step 2: Confirm they fail**

Run: `npx vitest run tests/storage/backup`
Expected: FAIL, cannot resolve `../../src/storage/backup`.

- [ ] **Step 3: Implement `src/storage/backup.ts`**

```ts
export const MAX_BACKUPS = 5;

export interface BackupEntry {
  stamp: string;
  at: string;
  content: string;
}

type Read = () => Promise<Record<string, unknown> | null>;
type Write = (data: Record<string, unknown>) => Promise<void>;

/** Rotating copies of the data file, kept inside the plugin data blob so the vault stays clean. */
export class BackupStore {
  constructor(private read: Read, private write: Write) {}

  private async all(): Promise<BackupEntry[]> {
    const blob = await this.read();
    const raw = blob?.backups;
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is BackupEntry =>
      typeof e === 'object' && e !== null &&
      typeof (e as BackupEntry).stamp === 'string' && typeof (e as BackupEntry).content === 'string');
  }

  async list(): Promise<{ stamp: string; at: string; bytes: number }[]> {
    return (await this.all()).map(e => ({ stamp: e.stamp, at: e.at, bytes: e.content.length }));
  }

  async take(stamp: string): Promise<string | null> {
    return (await this.all()).find(e => e.stamp === stamp)?.content ?? null;
  }

  async record(content: string): Promise<void> {
    const existing = await this.all();
    if (existing.length > 0 && existing[0].content === content) return;
    const at = new Date();
    const stamp = `${at.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    const entry: BackupEntry = { stamp, at: at.toISOString(), content };
    await this.write({ ...await this.read(), backups: [entry, ...existing].slice(0, MAX_BACKUPS) });
  }
}
```

The `class` here is deliberate and allowed: it carries per-instance state (the blob accessors), which the "no `this`" convention is about avoiding in stateless modules.

- [ ] **Step 4: Give the plugin one blob accessor and stop the settings write from eating backups**

`src/main.ts` currently saves settings as the whole blob, which would wipe a `backups` key. Add:

```ts
async readBlob(): Promise<Record<string, unknown> | null> {
  const raw = await this.loadData();
  return typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
}

async writeBlob(patch: Record<string, unknown>): Promise<void> {
  const merged = { ...await this.readBlob(), ...patch };
  await super.saveData(merged);
}

backups!: BackupStore;
```

set `this.backups = new BackupStore(() => this.readBlob(), (d) => this.writeBlob(d));` as the first statement of `onload` before `loadSettings`, then change `saveSettings` to `await this.writeBlob({ ...this.settings });` — the merge is what keeps `backups` alive.

- [ ] **Step 5: Record on the right occasions, and add the Restore modal**

In `src/storage/vaultFile.ts` `saveDoc`, immediately before the `app.vault.modify(...)` call, accept an optional recorder and call it:

```ts
  if (options.record && existing !== null && existing !== content) await options.record(existing).catch(() => { /* best-effort */ });
```

with `record?: (previous: string) => Promise<void>;` added to `SaveOptions`. In `src/store.ts` pass it from `saveNow` as `{ changedMonths, protectAgainst: ..., record: (prev) => recordBackup(prev, changedMonths) }`, and gate it to the two occasions the spec names — the first write of a session, and any full rewrite (`changedMonths === undefined`):

```ts
let backedUpThisSession = false;

async function recordBackup(previous: string, changedMonths: Set<string> | undefined): Promise<void> {
  if (!pluginRef) return;
  if (backedUpThisSession && changedMonths !== undefined) return;   // first write of the session, or a full rewrite
  if (!BACKUP_ELIGIBLE.test(previous)) return;
  await pluginRef.backups.record(previous);
  backedUpThisSession = true;
}
```

`BACKUP_ELIGIBLE` keeps junk out of the rotation — a copy is worth keeping only if it could be restored, and `BackupStore.record` already refuses to store the same text twice in a row:

```ts
const BACKUP_ELIGIBLE = /^---\n[\s\S]*?\n---/;
```

and `let pluginRef: HabitTrackerPlugin | null = null;` set through a new `setPlugin(plugin: HabitTrackerPlugin): void` export called from `onload`. On a lost write, `restoreFromBackup(stamp)` writes the stored text back through `app.vault.modify` and reloads.

Add to `src/views/modals.ts`:

```ts
export class RestoreDataFileModal extends Modal {
  constructor(private plugin: HabitTrackerPlugin, private onPick: (stamp: string) => Promise<void>) { super(plugin.app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Restore previous data file' });
    void (async () => {
      const list = await this.plugin.backups.list();
      if (list.length === 0) {
        contentEl.createEl('p', { text: 'No previous copies have been kept yet.' });
        return;
      }
      for (const entry of list) {
        const row = contentEl.createDiv({ cls: 'backup-row' });
        row.createEl('button', { cls: 'backup-restore-button', text: new Date(entry.at).toLocaleString() })
          .addEventListener('click', () => { void this.onPick(entry.stamp).then(() => this.close()); });
        row.createEl('span', { text: `${entry.bytes} bytes`, cls: 'backup-size' });
      }
    })();
  }
}
```

and register the command in `onload` following the `addCommand` shape at `src/main.ts:41-45`:

```ts
this.addCommand({
  id: 'restore-data-file',
  name: 'Restore previous data file',
  callback: () => this.openRestoreBackupModal()
});
```

and the shared opener on the plugin, which the error card of Task 14 also calls:

```ts
  openRestoreBackupModal(): void {
    new RestoreDataFileModal(this, async (stamp) => { await restoreFromBackup(stamp); }).open();
  }
```

- [ ] **Step 6: Run, manual check, commit**

Run: `npm run test && npm run typecheck`
Manual check in the dev vault: toggle a day, edit `habits.md` by hand in another editor, then run **Restore previous data file** from the command palette and confirm the pre-edit content returns.

```bash
git add src/storage/backup.ts src/storage/vaultFile.ts src/store.ts src/main.ts src/views/modals.ts tests/storage/backup.test.ts
git commit -m "feat: keep rotating copies of the data file and a way back to them" -m "Five newest copies go into the plugin data blob, recorded before the first write of a session and before any full rewrite, with a command palette entry to restore one."
```
### Task 12: See edits made outside the plugin

**Files:**
- Modify: `src/storage/vaultFile.ts` (add `startWatcher`)
- Modify: `src/main.ts` (start it from `onload` through `registerEvent`)
- Modify: `src/store.ts` (deferred reload hook)
- Create: `RestoreDeletedHabitModal` in `src/views/modals.ts`
- Test: `tests/storage/watcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/watcher.test.ts`. The fake app exposes `emitModify(path)` so a test can drive what the vault would fire:

```ts
import { describe, expect, it } from 'vitest';
import { saveDoc, startWatcher } from '../../src/storage/vaultFile';
import { docOf, fakeApp, sleep } from './helpers';

const FAST = { debounceMs: 10 };

describe('startWatcher', () => {
  it('reports an external edit once, after the debounce', async () => {
    const app = fakeApp('---\nname: A\nhabits: []\n---\n');
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
    const app = fakeApp('---\nname: A\nhabits: []\n---\n');
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
    const app = fakeApp();
    let calls = 0;
    const stop = startWatcher(app.app as never, 'habits.md', { ...FAST, onExternalEdit: () => { calls++; } });
    app.emitModify('other.md');
    await sleep(40);
    expect(calls).toBe(0);
    stop();
  });

  it('stays quiet about our own write', async () => {
    const app = fakeApp();
    let calls = 0;
    const stop = startWatcher(app.app as never, 'habits.md', { ...FAST, onExternalEdit: () => { calls++; } });
    await saveDoc(app.app as never, 'habits.md', docOf(['Read']), {});
    app.emitModify('habits.md');                     // the echo the vault fires for us
    await sleep(40);
    expect(calls).toBe(0);
    stop();
  });

  it('waits instead of reloading while a save is in flight', async () => {
    const app = fakeApp();
    const seen: string[] = [];
    let busy = true;
    const stop = startWatcher(app.app as never, 'habits.md', {
      ...FAST, onExternalEdit: () => { seen.push('reloaded'); }, isBusy: () => busy
    });
    app.emitModify('habits.md');
    await sleep(40);
    expect(seen).toEqual([]);                         // held while the queue is busy
    busy = false;
    await sleep(40);
    expect(seen).toEqual(['reloaded']);
    stop();
  });
});
```

The fake app already carries `on`, `offref` and `emitModify` (Task 4), so no per-test event plumbing is needed. `debounceMs` is injectable for exactly this reason — production keeps its 500 ms default and the tests use 10 ms. A reload that was held because a save was in flight and then resolves on its own is not an error and needs no notice; `external-edit-conflict` stays unused in this plan, so do not invent a producer for it.

- [ ] **Step 2: Confirm they fail**

Run: `npx vitest run tests/storage/watcher`
Expected: FAIL, `startWatcher` is not exported from `src/storage/vaultFile.ts`.

- [ ] **Step 3: Implement `startWatcher` in `src/storage/vaultFile.ts`**

```ts
export interface WatcherHandlers {
  onExternalEdit: (path: string) => void;
  /** True while a local save is in flight; the reload is held until it clears. */
  isBusy?: () => boolean;
  debounceMs?: number;
}

export function startWatcher(app: App, path: string, handlers: WatcherHandlers): () => void {
  const debounceMs = handlers.debounceMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = false;

  const flush = () => {
    timer = null;
    if (handlers.isBusy?.() === true) {
      if (held) return;                     // one retry chain is enough
      held = true;
      timer = setTimeout(flush, debounceMs);
      return;
    }
    held = false;
    handlers.onExternalEdit(path);
  };

  const onModify = (data: { file?: { path?: string } }) => {
    if (data?.file?.path !== path) return;
    void (async () => {
      const text = await readExisting(app, path);
      if (text !== null && isOwnWrite(path, text)) return;      // our own echo
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    })();
  };

  const ref = app.vault.on('modify', onModify as never);
  return () => {
    if (timer !== null) clearTimeout(timer);
    app.vault.offref('modify', ref);
  };
}
```

`vault.on('modify')` hands back an event reference that `vault.offref('modify', ref)` detaches; the stop function returned by `startWatcher` does exactly that, so no caller ever touches the ref directly.

- [ ] **Step 4: Start it from the plugin, and defer while saving**

In `src/main.ts`, hold the stop function on the plugin so a settings change can tear the old watcher down before a new one starts:

```ts
  private stopWatcher: (() => void) | null = null;

  // in onload, after await loadHabits()
  this.stopWatcher = startWatcher(this.app, this.settings.habitsFilePath, {
    onExternalEdit: () => { void this.loadHabits(); },
    isBusy: () => isSaving()
  });

  // in onunload
  onunload(): void {
    this.stopWatcher?.();
    this.stopWatcher = null;
  }
```

`isSaving` comes from Task 9 (`src/store.ts`). If `habitsFilePath` changes in settings, call `this.stopWatcher?.()` first and then start a watcher for the new path.

```ts
this.registerEvent(startWatcher(this.app, this.settings.habitsFilePath, {
  onExternalEdit: () => { void this.loadHabits(); },
  isBusy: () => isSaving()
}));
```

If `habitsFilePath` changes in settings, stop the old watcher before starting a new one: hold the stop function on the plugin (`private stopWatcher: (() => void) | null`) and call it in the settings `onChange` before restarting.

- [ ] **Step 5: Restore a deleted habit**

Add to `src/views/modals.ts`, following the shape of `DeleteHabitModal` (`src/views/modals.ts:225-378`):

```ts
export class RestoreDeletedHabitModal extends Modal {
  constructor(private plugin: HabitTrackerPlugin, private onDone: () => Promise<void>) { super(plugin.app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Restore deleted habit' });
    const deleted = this.plugin.getState().deletedHabits ?? [];
    if (deleted.length === 0) {
      contentEl.createEl('p', { text: 'Nothing has been deleted yet.' });
      return;
    }
    for (const entry of deleted) {
      this.addOption(contentEl, entry.name, async () => {
        this.plugin.restoreHabit(entry.name);
        this.close();
        await this.onDone();
      });
    }
  }

  private addOption(container: HTMLElement, name: string, run: () => Promise<void>): void {
    const row = container.createDiv({ cls: 'restore-row' });
    row.createEl('button', { cls: 'restore-habit-button', text: name, attr: { 'aria-label': `Restore ${name}` } })
      .addEventListener('click', () => { void run(); });
  }
}
```

`restoreHabit` needs `import { colourFor, SYNTHESISED_ICON } from './storage/format';` in `src/store.ts`, and the plugin gains a delegating `restoreHabit(name: string)` beside the others in `src/main.ts`.

and the store action, which moves the name back while keeping every completion (this is what `deletedHabits` in Task 2 now makes possible):

```ts
export function restoreHabit(name: string): void {
  const current = getState();
  if (current.habits.some(h => h.name === name)) return;
  const archived = (current.deletedHabits ?? []).find(d => d.name === name);
  if (!archived) return;
  const cells = { ...(current.completions[name] ?? {}) };
  const habit: Habit = {
    name, icon: SYNTHESISED_ICON, frequency: 'daily', streakMode: 'strict',
    startDate: Object.keys(cells).sort()[0] ?? new Date().toISOString().split('T')[0],
    color: colourFor(name)
  };
  const newHabits = [...current.habits, habit];
  const newCompletions = { ...current.completions, [name]: cells };
  requestSave(Object.keys(cells));
  setState(s => ({
    ...s, habits: newHabits, completions: newCompletions,
    deletedHabits: (s.deletedHabits ?? []).filter(d => d.name !== name),
    pendingData: (s.pendingData ?? []).filter(n => n !== name),
    needsDefinition: [...(s.needsDefinition ?? []), name]
  }));
}
```

Wire `restoreHabit(name)` on the plugin in `src/main.ts` next to the other delegating methods, and register the `restore-deleted-habit` command with the same `addCommand` shape used in Task 11.

- [ ] **Step 6: Run and commit**

Run: `npm run test && npm run typecheck`
Expected: PASS. Manual check: with the tracker view open, edit `habits.md` in another editor and save — the view updates without a reload; toggle a day and confirm the watcher does not fight the toggle (no flicker, no lost tick).

```bash
git add src/storage/vaultFile.ts src/main.ts src/store.ts src/views/modals.ts tests/storage/watcher.test.ts
git commit -m "feat: reload the view when the data file changes outside the plugin" -m "A debounced vault modify listener suppressed by content fingerprint, held while a local save is in flight, plus restore for habits deleted with data kept."
```

### Task 13: Make empty-section cleanup opt-in

**Files:**
- Modify: `src/types.ts` (`EmptyTableDetection` gains `'manual'`), `src/parser.ts` (`lintHabitsFile` logs), `src/main.ts` (default + command)
- Test: `tests/storage/lint.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/lint.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { lintHabitsFile } from '../../src/parser';
import { fakeApp } from './helpers';

const FILE = [
  '---', 'name: A', 'habits:', '  - name: Read', '    icon: IC', '    frequency: daily',
  '    streakMode: strict', '    startDate: 2026-10-01', '---', '',
  '## October 2026', '| Habit | 2026-10-01 |', '| --- | --- |', '| IC Read | ✓ |', '',
  '## September 2026', '| Habit | 2026-09-01 |', '| --- | --- |', '| IC Read | |'
].join('\n');

describe('lintHabitsFile', () => {
  it('removes a section that holds no data', async () => {
    const app = fakeApp(FILE);
    const changed = await lintHabitsFile(app.app as never, 'habits.md');
    expect(changed).toBeTrue();
    expect(app.content).toContain('## October 2026');
    expect(app.content).not.toContain('## September 2026');
  });

  it('is quiet unless debug mode is on', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => { });
    const app = fakeApp(FILE);
    await lintHabitsFile(app.app as never, 'habits.md');
    expect(spy.mock.calls.some(c => String(c.arguments[0]).includes('Lint:'))).toBeFalse();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Confirm they fail**

Run: `npx vitest run tests/storage/lint`
Expected: the quiet case FAILS — `src/parser.ts:557` logs per section unconditionally today.

- [ ] **Step 3: Gate the logging**

In `src/parser.ts`, inside `lintHabitsFile`, wrap the per-section log and the summary log:

```ts
    if (isDebug()) console.log('[HabitTracker] Lint: section=' + sectionHeaders[i].header + ' hasData=' + hasData);
```

and for the trailing "removed N empty month section(s)" line. Import `isDebug` the same way `writeTrackerFile` already did (`src/parser.ts:382`): `const { isDebug } = await import('./store');` at the top of the async function, keeping the lazily-imported cycle.

- [ ] **Step 4: Add the `'manual'` mode**

In `src/types.ts` widen the setting:

```ts
export type EmptyTableDetection = 'onload' | 'onchange' | 'manual';
```

and in `AppState`/`PluginSettings` use that type instead of the inline union. Fresh installs default to it — in `src/main.ts`:

```ts
const DEFAULT_SETTINGS: PluginSettings = {
  habitsFilePath: DEFAULT_HABITS_FILE, todayViewDays: 7, keepDeletedData: true,
  emptyTableDetection: 'manual', debugMode: false
};
```

Keep existing users on their stored value: `loadSettings` (`src/main.ts:75-95`) already falls back only when the stored key is missing, so add validation that accepts the three names and falls back to the stored-or-`onload` value rather than to `'manual'`:

```ts
      emptyTableDetection: EMPTY_TABLE_MODES.includes(safe.emptyTableDetection as EmptyTableDetection)
        ? (safe.emptyTableDetection as EmptyTableDetection)
        : 'onload',
```

with `const EMPTY_TABLE_MODES: EmptyTableDetection[] = ['onload', 'onchange', 'manual'];`. Add the dropdown option in the existing setting row (`src/main.ts:176-186`) — sentence case:

```ts
        .addOption('manual', 'Manually')
```

and honour it in `loadHabits` (`src/store.ts:86`): run the lint only when `state.emptyTableDetection === 'onload'`, and in `saveNow` pass `changedMonths` so `onchange` filtering is no longer needed (the canonical writer never emits an empty section).

Register the explicit cleanup command:

```ts
    this.addCommand({
      id: 'clean-empty-sections',
      name: 'Clean empty month sections',
      callback: () => {
        void (async () => {
          const removed = await lintHabitsFile(this.app, this.settings.habitsFilePath);
          new Notice(removed ? 'Removed empty month sections' : 'No empty month sections found', 4000);
          await this.loadHabits();
        })();
      }
    });
```

- [ ] **Step 5: Run and commit**

Run: `npm run test && npm run typecheck`
Expected: PASS.

```bash
git add src/types.ts src/parser.ts src/main.ts src/store.ts tests/storage/lint.test.ts
git commit -m "feat: stop rewriting the data file on every plugin load" -m "Automatic cleanup becomes a third manual mode that fresh installs get by default, the explicit command covers the rest, and the per-section lint log goes behind debug mode."
```

### Task 14: Typed errors, a safer error card, and the loading state

**Files:**
- Modify: `src/types.ts`, `src/store.ts`, `src/view.ts:366-388`, `src/main.ts`, `src/styles.css`
- Test: `tests/storage/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readDoc, saveDoc } from '../../src/storage/vaultFile';
import { docOf, fakeApp, habit, MISSING } from './helpers';
import { emptyDoc, normalizeDoc } from '../../src/model/tracker';

describe('error taxonomy', () => {
  it('reports corrupt frontmatter as parse-failed', async () => {
    const app = fakeApp('---\n: : :\n---\n');
    const out = await readDoc(app.app as never, 'habits.md');
    expect(out.ok).toBeFalse();
    expect(out.error!.kind).toBe('parse-failed');
    expect(out.error!.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reports an absent file as file-missing-uncreatable', async () => {
    const app = fakeApp(MISSING);
    const out = await readDoc(app.app as never, 'habits.md');
    expect(out.ok).toBeFalse();
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
```

- [ ] **Step 2: Confirm they fail**

Run: `npx vitest run tests/storage/errors`
Expected: FAIL — `TrackerErrorKind` is not exported from `src/types.ts` yet.

- [ ] **Step 3: Point `AppState` at the error type**

`TrackerErrorKind` and `TrackerError` already exist in `src/model/tracker.ts` (Task 1), so `src/types.ts` only gains the state fields — add the import and the two members:

```ts
import type { TrackerError } from './model/tracker';
```

and, in `AppState`, keep `error` for the one line of text the header can show and add the typed twin:

```ts
  errorInfo: TrackerError | null;
  error: string | null;
```

Update every `setState` that touched `error` in `src/store.ts` to set both (Task 8 already wrote them in this shape).

- [ ] **Step 4: Replace the error card**

Rewrite the block at `src/view.ts:366-388`. Keep the existing `no-habits-message` class family and add per-kind actions; no action may delete the file:

```ts
    if (state.errorInfo) {
      const info = state.errorInfo;
      const card = this.viewPanel.createEl('div', { cls: 'no-habits-message error-card' });
      card.createEl('div', { text: 'Habit data could not be loaded', cls: 'error-title' });
      card.createEl('div', { text: info.message, cls: 'error-detail' });
      if (info.habit) card.createEl('div', { text: `Affected habit: ${info.habit}${info.date ? ` on ${info.date}` : ''}`, cls: 'error-detail' });

      const actions = card.createDiv({ cls: 'error-actions' });
      const action = (label: string, run: () => void) => {
        actions.createEl('button', {
          text: label, cls: 'error-action-button', attr: { type: 'button', 'aria-label': label }
        }).addEventListener('click', run);
      };
      action('Retry', () => { void this.plugin.loadHabits(); void this.render(); });
      if (info.kind !== 'file-missing-uncreatable') {
        // Open the data file in the main area. Check the installed obsidian typings for the
        // current open-file call before writing this line; do not invent an API name.
        action('Open data file', () => { void this.plugin.openDataFile(); });
      }
      action('Restore previous data file', () => this.plugin.openRestoreBackupModal());
      action('Copy diagnostics', () => {
        const field = card.createEl('textarea', { cls: 'error-diagnostics-field', attr: { 'aria-label': 'Diagnostics to copy' } });
        field.value = `${info.kind}: ${info.message}\nat ${info.occurredAt}\nfile: ${state.habitsFilePath}`;
        field.select();
        new Notice('Diagnostics selected — press Ctrl+C', 4000);
      });
      return;
    }

    if (state.loading) {
      this.viewPanel.createEl('div', { text: 'Loading habit data…', cls: 'no-habits-message' });
      return;
    }
```

Delete the `Delete habits file & reload` button from this path (`src/view.ts:369-383`) and add `openRestoreBackupModal()` to `src/main.ts`, which opens the Task 11 modal.

and `openDataFile` on the plugin, which the card uses when the file itself is fine but the user needs to see it:

```ts
  async openDataFile(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.settings.habitsFilePath);
    if (!isTFile(file)) return;
    const leaf = this.app.workspace.getLeaf(true);
    await leaf?.openFile(file);
  }
```

- [ ] **Step 5: Move the destructive reset where it belongs**

In the settings tab class (`src/main.ts:120-190`), after the Debug mode row, add a row whose button opens a modal that must be confirmed twice before it trashes the file, and only through the file manager so the user can recover it:

```ts
    new Setting(containerEl)
      .setName('Reset the data file')
      .setDesc('Moves the current data file to the trash and starts a fresh one. Your habits and history are deleted.')
      .addButton(btn => btn.setButtonText('Reset…').setWarning().onClick(() => {
        new ResetDataFileModal(this.app, this.plugin, async () => {
          const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.habitsFilePath);
          if (isTFile(file)) await this.app.fileManager.trashFile(file);
          await this.plugin.loadHabits();
          await this.plugin.refreshView();
        }).open();
      }));
```

with `ResetDataFileModal` in `src/views/modals.ts`, which cannot be confirmed until the user has typed the file name back:

```ts
export class ResetDataFileModal extends Modal {
  constructor(app: App, private plugin: HabitTrackerPlugin, private onConfirm: () => Promise<void>) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    const name = this.plugin.settings.habitsFilePath;
    contentEl.createEl('h2', { text: 'Reset the data file' });
    contentEl.createEl('p', { text: `Type "${name}" to confirm. The file moves to the trash and a fresh one takes its place.` });

    const field = contentEl.createEl('input', { type: 'text', cls: 'reset-confirm-input', attr: { 'aria-label': `Type ${name} to confirm` } });
    const confirm = contentEl.createEl('button', { text: 'Move to trash and reset', cls: 'mod-warning' });
    confirm.disabled = true;
    field.addEventListener('input', () => { confirm.disabled = field.value.trim() !== name; });
    confirm.addEventListener('click', () => { void this.onConfirm().then(() => this.close()); });
  }
}
```

`isTFile` comes from `./parser`, `trashFile` from `this.app.fileManager` (already used at `src/view.ts:376`), and `Notice` from `'obsidian'`.

- [ ] **Step 6: Styles**

Append to `src/styles.css`, theme-coloured only, no hard-coded colours, and reuse existing variables (the pattern used across the file):

```css
.error-card {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  padding: var(--size-4-4);
  text-align: start;
}

.error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
}

.error-action-button {
  min-height: 44px;
  min-width: 44px;
}

.error-action-button:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
}

.habit-needs-definition-hint {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}
```

Then mark habits that came from a table row only in the habit dropdown (`src/view.ts:573-583`), so the user can tell why a card looks unconfigured:

```ts
        if ((this.plugin.getState().needsDefinition ?? []).includes(habit.name)) item.addClass('needs-definition');
```

- [ ] **Step 7: Run, verify by hand, commit**

Run: `npm run test && npm run typecheck && npm run build`
Manual checks, one per kind: break the frontmatter (`: : :`) → card says *properties block is not valid YAML* and offers retry/restore, with **no** delete button; fill a habit row with a future date and toggle a habit from the Today view while the file is read-only → *write-failed* with retry; make a table-only row by hand (add a row whose habit is not in the list), then **Load habits** → a notice counts healed habits and the card carries the hint.

```bash
git add src/types.ts src/store.ts src/view.ts src/main.ts src/views/modals.ts src/styles.css tests/storage/errors.test.ts
git commit -m "feat: tell the user what failed and offer a way out that is not deleting the data" -m "Typed error kinds carry the affected habit and date; the error card gains retry, restore and diagnostics actions, the destructive reset moves behind a typed confirmation in settings, and the loading flag finally drives a placeholder."
```

---

## Final verification

Every gate in this plan, in one pass:

```bash
npm run typecheck && npm run test && npm run build
```

Expected: typecheck silent, vitest all green with the 18 pre-existing cases intact, build ends `Build complete`.

Then the acceptance walk from spec §10, in the dev vault (`.obsidian/plugins/banshan-habit-tracker/`):

1. Add a habit, tick a day, restart the plugin (`Reload app without losing state`) → the tick is still there.
2. Rename that habit, restart → history intact under the new name and no orphan row.
3. Delete a habit with *Keep progress data*, restart, then run **Restore deleted habit** → the habit returns with its data.
4. Open `habits.md` in another editor, add a row for a habit the properties block does not list, save → the view picks it up within about half a second and flags it as needing details.
5. Toggle ten days quickly across a month boundary → all ten are on the disk afterwards.
6. Make the file read-only and toggle → *write-failed* with a working **Retry**, and the file untouched.
