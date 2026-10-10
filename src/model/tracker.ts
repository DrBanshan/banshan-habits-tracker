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
 * Habit and date keys come from user text, so a map lookup can hit an inherited member
 * (`toString`, `valueOf`, `hasOwnProperty`) instead of missing. Every presence test on a
 * completions map goes through this, or such a row reads as present and is silently dropped.
 */
function owns(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * Repairs the two representable inconsistencies: a habit with no completions entry,
 * and completions held under a name nothing defines (kept as pendingData, never dropped).
 */
export function normalizeDoc(doc: TrackerDoc): TrackerDoc {
  const completions: CompletionMap = {};
  for (const h of doc.habits) completions[h.name] = { ...(owns(doc.completions, h.name) ? doc.completions[h.name] : {}) };
  const pendingData = [...doc.pendingData];
  for (const d of doc.deletedHabits) {
    // A deleted habit keeps its rows so its history stays recoverable: seed from what is
    // already held for it instead of blanking it out.
    if (!owns(completions, d.name)) {
      completions[d.name] = { ...(owns(doc.completions, d.name) ? doc.completions[d.name] : {}) };
    }
  }
  for (const [name, cells] of Object.entries(doc.completions)) {
    if (owns(completions, name)) continue;
    completions[name] = { ...cells };
    if (!pendingData.includes(name)) pendingData.push(name);
  }
  const needsDefinition = doc.needsDefinition.filter(n => doc.habits.some(h => h.name === n));
  return { ...doc, completions, needsDefinition, pendingData };
}

export function assertInvariants(doc: TrackerDoc, where: string): void {
  for (const h of doc.habits) {
    if (!owns(doc.completions, h.name)) {
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
    const actualCells = owns(actual.completions, name) ? actual.completions[name] : undefined;
    for (const [date, status] of Object.entries(cells)) {
      if (actualCells?.[date] !== status) {
        lostCompletions.push({ habit: name, date, status });
      }
    }
  }
  return { lostHabits, lostCompletions };
}
