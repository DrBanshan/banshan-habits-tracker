export type Frequency = 'daily' | 'weekly' | 'specific';
export type StreakMode = 'strict' | 'forgiving';
export type CompletionStatus = 'completed' | 'missed' | 'unmarked';
export type ViewType = 'dashboard' | 'today' | 'month' | 'year' | 'yearOverview';

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
  /** How to handle empty month tables: 'onload' only cleans on plugin load, 'onchange' filters on every data change */
  emptyTableDetection?: 'onload' | 'onchange';
  /** Whether to print debug messages to the console */
  debugMode?: boolean;
}

export const DEFAULT_HABITS_FILE = 'habits.md';

export const DEFAULT_COLORS = ['#0A84FF', '#26A641', '#FF3B30', '#FF9F0A', '#AF52DE', '#5AC8FA', '#FF2D55'];
