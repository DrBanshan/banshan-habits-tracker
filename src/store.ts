import type { App } from 'obsidian';
import type { Habit, CompletionMap, StreakInfo, CompletionStatus, ViewType, AppState } from './types';
import type { TrackerDoc, TrackerErrorKind } from './model/tracker';
import { emptyDoc, normalizeDoc } from './model/tracker';
import { readDoc, saveDoc } from './storage/vaultFile';
import { enqueue, hasPending, whenIdle } from './storage/writeQueue';
import type { BackupStore } from './storage/backup';
import { ensureDefaultTracker } from './parser';
import { calculateStreak } from './streak';
import { DEFAULT_HABITS_FILE } from './types';

interface ChangePayload {
  type: 'toggle' | 'addHabit' | 'deleteHabit' | 'renameHabit' | 'colorChange' | 'viewChange' | 'monthChange' | 'yearChange' | 'load' | 'reorder';
  habitName?: string;
  date?: string;
}

type Listener = (payload?: ChangePayload) => void;

// Module-level state (no class, no `this`)
let appRef: App | null = null;
let habitsFilePath: string = DEFAULT_HABITS_FILE;
let listeners: Listener[] = [];

// Deferred reports from the storage layer, shown once the store has finished loading.
let notices: { kind: TrackerErrorKind; message: string }[] = [];

export function reportDrift(healed: string[]): void {
  notices.push({ kind: 'drift-healed', message: `${healed.length} habit(s) were present only as a table row: ${healed.join(', ')}` });
}

export function takeNotices(): { kind: TrackerErrorKind; message: string }[] {
  const out = notices;
  notices = [];
  return out;
}

/** The last document the file was known to hold; the gate never lets a write fall behind it. */
let lastGoodDoc: TrackerDoc | null = null;

export function getLastGoodDoc(): TrackerDoc | null {
  return lastGoodDoc ? normalizeDoc({ ...lastGoodDoc }) : null;
}

let backupHost: { backups: BackupStore } | null = null;
let backedUpThisSession = false;

/** Handed the plugin once, so the store can reach the backup rotation without importing main.ts. */
export function setPlugin(host: { backups: BackupStore } | null): void {
  backupHost = host;
  backedUpThisSession = false;
}

// A copy is only worth rotating in if it could actually be restored: frontmatter first, then a table.
const BACKUP_ELIGIBLE = /^---\r?\n[\s\S]*?\r?\n---/;

async function recordBackup(previous: string, changedMonths: Set<string> | undefined): Promise<void> {
  if (!backupHost) return;
  if (backedUpThisSession && changedMonths !== undefined) return;   // first write of the session, or a full rewrite
  if (!BACKUP_ELIGIBLE.test(previous)) return;
  await backupHost.backups.record(previous);
  backedUpThisSession = true;
}

/** Put a kept copy back and re-read it, for recovering from a write that lost data. */
export async function restoreFromBackup(stamp: string): Promise<void> {
  if (!appRef) return;
  const content = await backupHost?.backups.take(stamp);
  if (content === null) {
    notices.push({ kind: 'file-missing-uncreatable', message: 'That backup is no longer available.' });
    return;
  }
  try {
    const abstract = appRef.vault.getAbstractFileByPath(habitsFilePath);
    if (abstract) {
      await appRef.vault.modify(abstract as Parameters<App['vault']['modify']>[0], content);
    } else {
      await appRef.vault.adapter.write(habitsFilePath, content);
    }
  } catch (e) {
    notices.push({ kind: 'write-failed', message: e instanceof Error ? e.message : 'the vault refused the restore' });
    return;
  }
  await loadHabits();
}

let state: AppState = {
  habits: [],
  completions: {},
  streaks: {},
  selectedHabit: null,
  viewType: 'today',
  selectedMonth: new Date(),
  selectedYear: new Date().getFullYear(),
  loading: false,
  error: null,
  habitsFilePath: DEFAULT_HABITS_FILE,
  todayViewDays: 7,
  deletedHabits: [],
  keepDeletedData: true,
  emptyTableDetection: 'onload',
  debugMode: false
};

function notify(payload?: ChangePayload) {
  for (const fn of listeners) fn(payload);
}

function setState(updater: (s: AppState) => AppState, payload?: ChangePayload) {
  state = updater(state);
  notify(payload);
}

export function init(app: App, filePath?: string, todayViewDays?: number, keepDeletedData?: boolean, emptyTableDetection?: 'onload' | 'onchange', debugMode?: boolean) {
  appRef = app;
  if (filePath) {
    habitsFilePath = filePath;
    state.habitsFilePath = filePath;
    // A different file has a different last-known-good document; keeping the old one would make
    // the gate compare against unrelated data.
    lastGoodDoc = null;
  }
  if (todayViewDays) {
    state.todayViewDays = todayViewDays;
  }
  if (keepDeletedData !== undefined) {
    state.keepDeletedData = keepDeletedData;
  }
  if (emptyTableDetection) {
    state.emptyTableDetection = emptyTableDetection;
  }
  if (debugMode !== undefined) {
    state.debugMode = debugMode;
  }
}

export function isDebug(): boolean {
  return state.debugMode === true;
}

export function getState(): AppState {
  return { ...state, selectedMonth: new Date(state.selectedMonth) };
}

export function subscribe(fn: Listener) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

export async function loadHabits(): Promise<void> {
  if (!appRef) return;
  setState(s => ({ ...s, loading: true, error: null, errorInfo: null }));
  let out = await readDoc(appRef, habitsFilePath);
  if (!out.ok && out.error?.kind === 'file-missing-uncreatable') {
    // First run for this path: seed the file the plugin has always created, then read it back.
    await ensureDefaultTracker(appRef, habitsFilePath);
    out = await readDoc(appRef, habitsFilePath);
  }
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


export function toggleDay(habitName: string, date: string) {
  const current = getState();
  const habitStatus = current.completions[habitName] || {};
  const currentStatus = habitStatus[date] || 'unmarked';
  const newStatus: CompletionStatus = currentStatus === 'completed' ? 'unmarked' : 'completed';
  const newCompletions = {
    ...current.completions,
    [habitName]: { ...habitStatus, [date]: newStatus }
  };
  const newStreaks: Record<string, StreakInfo> = {};
  for (const habit of current.habits) {
    newStreaks[habit.name] = calculateStreak(habit, newCompletions);
  }
  setState(s => ({ ...s, completions: newCompletions, streaks: newStreaks }), {
    type: 'toggle',
    habitName,
    date
  });
  requestSave([date]);
}

export function addHabit(habit: Habit) {
  const current = getState();
  if (current.habits.some(h => h.name === habit.name)) return;
  const newHabits = [...current.habits, habit];
  const newCompletions = { ...current.completions };
  newCompletions[habit.name] = {};
  const newStreaks = { ...current.streaks };
  newStreaks[habit.name] = { current: 0, longest: 0 };
  setState(s => ({
    ...s,
    habits: newHabits,
    completions: newCompletions,
    streaks: newStreaks,
    selectedHabit: habit.name
  }));
  requestSave([]);
}

export function renameHabit(oldName: string, newName: string) {
  const current = getState();
  const habitIndex = current.habits.findIndex(h => h.name === oldName);
  if (habitIndex === -1) return;
  const newHabits = [...current.habits];
  newHabits[habitIndex] = { ...newHabits[habitIndex], name: newName };
  const newCompletions = { ...current.completions };
  newCompletions[newName] = newCompletions[oldName];
  delete newCompletions[oldName];
  const newStreaks = { ...current.streaks };
  newStreaks[newName] = newStreaks[oldName];
  delete newStreaks[oldName];
  setState(s => ({
    ...s,
    habits: newHabits,
    completions: newCompletions,
    streaks: newStreaks,
    selectedHabit: s.selectedHabit === oldName ? newName : s.selectedHabit
  }));
  requestSave([]);
}

export function deleteHabit(habitName: string, keepData?: boolean) {
  const current = getState();
  const shouldKeepData = keepData !== undefined ? keepData : current.keepDeletedData;
  
  const newHabits = current.habits.filter(h => h.name !== habitName);
  let newCompletions: CompletionMap;
  let newStreaks: Record<string, StreakInfo>;
  const newDeletedHabits = [...(current.deletedHabits || [])];

  if (shouldKeepData) {
    // Keep the completion data but remove habit from active list
    newCompletions = { ...current.completions };
    newStreaks = { ...current.streaks };
    newDeletedHabits.push({ name: habitName, deletedAt: new Date().toISOString().split('T')[0] });
  } else {
    // Delete everything
    newCompletions = { ...current.completions };
    delete newCompletions[habitName];
    newStreaks = { ...current.streaks };
    delete newStreaks[habitName];
  }

  setState(s => ({
    ...s,
    habits: newHabits,
    completions: newCompletions,
    streaks: newStreaks,
    selectedHabit: s.selectedHabit === habitName ? (newHabits.length > 0 ? newHabits[0].name : null) : s.selectedHabit,
    deletedHabits: newDeletedHabits
  }), { type: 'deleteHabit', habitName });
  requestSave([]);
}

export function setHabitColor(habitName: string, color: string) {
  const current = getState();
  const newHabits = current.habits.map(h => h.name === habitName ? { ...h, color } : h);
  setState(s => ({ ...s, habits: newHabits }));
  requestSave([]);
}

export function setViewType(viewType: ViewType) {
  setState(s => ({ ...s, viewType }));
}

export function setSelectedHabit(habitName: string) {
  setState(s => ({ ...s, selectedHabit: habitName }));
}

export function setSelectedMonth(month: Date) {
  setState(s => ({ ...s, selectedMonth: new Date(month) }));
}

export function setSelectedYear(year: number) {
  setState(s => ({ ...s, selectedYear: year }));
}

export function clearError() {
  setState(s => ({ ...s, error: null }));
}

export function setHabitsFilePath(path: string) {
  habitsFilePath = path;
  setState(s => ({ ...s, habitsFilePath: path }));
}

export function updateSettings(todayViewDays?: number, keepDeletedData?: boolean, emptyTableDetection?: 'onload' | 'onchange', debugMode?: boolean) {
  if (todayViewDays !== undefined) {
    state.todayViewDays = todayViewDays;
  }
  if (keepDeletedData !== undefined) {
    state.keepDeletedData = keepDeletedData;
  }
  if (emptyTableDetection) {
    state.emptyTableDetection = emptyTableDetection;
  }
  if (debugMode !== undefined) {
    state.debugMode = debugMode;
  }
}

export function getTodayViewDays(): number {
  return state.todayViewDays;
}

export function reorderHabits(fromIndex: number, toIndex: number) {
  const current = getState();
  const newHabits = [...current.habits];
  const [moved] = newHabits.splice(fromIndex, 1);
  newHabits.splice(toIndex, 0, moved);
  // Notify without triggering a full re-render — the view handles DOM reordering directly
  setState(s => ({ ...s, habits: newHabits }), { type: 'reorder' });
  requestSave([]);
}

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
  for (const date of changedDates) pendingDates.add(date);
  void enqueue(habitsFilePath, 'save', async () => {
    // Snapshot at flush time, not at request time: that is what lets a burst coalesce onto the
    // newest state instead of each request carrying a stale copy of the document.
    const dates = [...pendingDates];
    pendingDates.clear();
    await saveNow(dates);
  }).catch(() => { /* surfaced by saveNow */ });
}

const pendingDates = new Set<string>();

/** Resolves once no write is queued or running for the data file. */
export function whenSaved(): Promise<void> {
  return whenIdle(habitsFilePath);
}

export function isSaving(): boolean {
  return hasPending(habitsFilePath);
}

async function saveNow(changedDates: string[]): Promise<void> {
  if (!appRef) return;
  const changedMonths = changedDates.length > 0 ? new Set(changedDates.map(d => d.slice(0, 7))) : undefined;
  // The document being saved is the baseline: the file must not lose what it claims. A caller that
  // knows nothing was meant to move (a reload merge, a restore) passes the older document explicitly.
  const out = await saveDoc(appRef, habitsFilePath, currentDoc(), {
    changedMonths,
    record: (prev) => recordBackup(prev, changedMonths)
  });
  if (out.ok) {
    if (out.doc) lastGoodDoc = out.doc;
    return;
  }
  if (out.error) {
    setState(s => ({ ...s, errorInfo: out.error ?? null, error: out.error?.message ?? 'Failed to save' }));
    console.warn(`[HabitTracker] ${out.error.kind}: ${out.error.message}`);
  }
}

async function flushNotices(): Promise<void> {
  const pending = takeNotices();
  if (pending.length === 0) return;
  try {
    const { Notice } = await import('obsidian');
    for (const n of pending) new Notice(n.message, 6000);
  } catch {
    // A Notice is a courtesy; the state already carries what the view needs.
  }
}

