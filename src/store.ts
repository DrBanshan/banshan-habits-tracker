import type { App } from 'obsidian';
import type { Tracker, Habit, CompletionMap, StreakInfo, CompletionStatus, ViewType, AppState } from './types';
import { parseTrackerFile, writeTrackerFile, ensureDefaultTracker, readTrackerFile, lintHabitsFile } from './parser';
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

export async function loadHabits() {
  if (!appRef) return;
  setState(s => ({ ...s, loading: true, error: null }));
  try {
    // Lint first: remove empty month sections before parsing
    try {
      const linted = await lintHabitsFile(appRef, habitsFilePath);
      if (isDebug()) console.log('[HabitTracker] Lint result:', linted);
    } catch (e) {
      console.warn('[HabitTracker] Lint failed:', e);
    }

    let content: string;
    const existing = appRef.vault.getAbstractFileByPath(habitsFilePath);
    if (existing) {
      // File exists in vault index - read and parse it
      content = await appRef.vault.read(existing as any);
    } else {
      // File not in vault index - try to read directly via adapter
      // (bypasses vault index which may not have caught up yet)
      try {
        content = await appRef.vault.adapter.read(habitsFilePath);
      } catch {
        // File truly doesn't exist - create default tracker
        const result = await ensureDefaultTracker(appRef, habitsFilePath);
        if (!result) {
          throw new Error(`Failed to create default tracker at: ${habitsFilePath}`);
        }
        content = result.content;
      }
    }
    // Parse the content
    const tracker = parseTrackerFile(content);
    if (!tracker) {
      throw new Error(`Failed to parse tracker file: ${habitsFilePath}`);
    }
    const streaks: Record<string, StreakInfo> = {};
    for (const habit of tracker.habits) {
      streaks[habit.name] = calculateStreak(habit, tracker.completions);
    }
    const selectedHabit = tracker.habits.length > 0 ? tracker.habits[0].name : null;
    const deletedHabits = tracker.deletedHabits || [];

    setState(s => ({
      ...s,
      habits: tracker.habits,
      completions: tracker.completions,
      streaks,
      selectedHabit,
      loading: false,
      deletedHabits,
      keepDeletedData: s.keepDeletedData !== undefined ? s.keepDeletedData : true,
      emptyTableDetection: s.emptyTableDetection || 'onload'
    }));
  } catch (e) {
    setState(s => ({
      ...s,
      loading: false,
      error: e instanceof Error ? e.message : 'Unknown error'
    }));
  }
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
  void persist(newCompletions, current.habits, date);
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
  void persist(newCompletions, newHabits);
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
  void persist(newCompletions, newHabits);
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
    newDeletedHabits.push({ name: habitName, deletedAt: new Date().toISOString() });
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
  void persist(newCompletions, newHabits);
}

export function setHabitColor(habitName: string, color: string) {
  const current = getState();
  const newHabits = current.habits.map(h => h.name === habitName ? { ...h, color } : h);
  setState(s => ({ ...s, habits: newHabits }));
  void persist(current.completions, newHabits);
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
  setState(s => ({ ...s, habits: newHabits }), { type: 'reorder' });
  void persist(current.completions, newHabits);
}

async function persist(completions: CompletionMap, habits: Habit[], affectedDate?: string) {
  if (!appRef) return;
  if (isDebug()) console.log('[HabitTracker] persist called, date=' + (affectedDate || 'none'));
  const current = getState();
  const filterEmptyMonths = current.emptyTableDetection === 'onchange';
  const tracker: Tracker = {
    name: 'My Habits',
    created: new Date().toISOString().split('T')[0],
    habits,
    completions
  };
  try {
    await writeTrackerFile(appRef, habitsFilePath, tracker, undefined, filterEmptyMonths, affectedDate);
  } catch (e) {
    setState(s => ({ ...s, error: e instanceof Error ? e.message : 'Failed to save' }));
  }
}
