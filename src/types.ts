export type Frequency = 'daily' | 'weekly' | 'specific';
export type StreakMode = 'strict' | 'forgiving';
export type CompletionStatus = 'completed' | 'missed' | 'unmarked';
import type { TrackerError } from './model/tracker';

export type ViewType = 'dashboard' | 'today' | 'month' | 'year' | 'yearOverview';
/**
 * How empty month sections are cleaned up. 'manual' is the default for fresh installs: the canonical
 * writer already omits data-less sections, so nothing has to rewrite the file behind the user's back.
 */
export type EmptyTableDetection = 'onload' | 'onchange' | 'manual';

export interface Habit {
  name: string;
  icon: string;
  frequency: Frequency;
  specificDays?: string[];
  streakMode: StreakMode;
  startDate: string;
  color: string;
}

export interface Tracker {
  name: string;
  created: string;
  habits: Habit[];
  completions: CompletionMap;
  /** Names of deleted habits whose data is kept */
  deletedHabits?: { name: string; deletedAt: string }[];
}

export interface CompletionMap {
  [habitName: string]: {
    [date: string]: CompletionStatus;
  };
}

export interface StreakInfo {
  current: number;
  longest: number;
}

export interface AppState {
  habits: Habit[];
  completions: CompletionMap;
  streaks: Record<string, StreakInfo>;
  selectedHabit: string | null;
  viewType: ViewType;
  selectedMonth: Date;
  selectedYear: number;
  loading: boolean;
  error: string | null;
  habitsFilePath: string;
  todayViewDays: number;
  /** Names of deleted habits whose data is kept */
  deletedHabits?: { name: string; deletedAt: string }[];
  /** Whether to keep data when deleting a habit */
  keepDeletedData?: boolean;
  /** How to handle empty month tables; see EmptyTableDetection. */
  emptyTableDetection?: EmptyTableDetection;
  /** Whether to print debug messages to the console */
  debugMode?: boolean;
  /** What the storage layer last refused, so the UI can offer the right way out. */
  errorInfo?: TrackerError | null;
  /** Habits merged in from a table row only; the UI asks the user to confirm their details. */
  needsDefinition?: string[];
  /** Completions held for a name that has no definition anywhere. */
  pendingData?: string[];
}

export const DEFAULT_HABITS_FILE = 'habits.md';

export const DEFAULT_COLORS = ['#0A84FF', '#26A641', '#FF3B30', '#FF9F0A', '#AF52DE', '#5AC8FA', '#FF2D55'];
