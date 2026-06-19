import type { Habit, StreakInfo, CompletionMap } from './types';

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDayName(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getDay()];
}

function getActiveDates(habit: Habit, startDate: string, endDate: string): Date[] {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const dates: Date[] = [];
  const current = new Date(start);

  while (current <= end) {
    let isActive = false;
    if (habit.frequency === 'daily' || habit.frequency === 'weekly') {
      isActive = true;
    } else if (habit.frequency === 'specific' && habit.specificDays) {
      isActive = habit.specificDays.includes(getDayName(current));
    }
    if (isActive) {
      dates.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export function calculateStreak(habit: Habit, completions: CompletionMap): StreakInfo {
  const today = formatDate(new Date());
  const startDate = habit.startDate;

  const activeDates = getActiveDates(habit, startDate, today);
  if (activeDates.length === 0) {
    return { current: 0, longest: 0 };
  }

  const currentStreak = calcCurrentStreak(habit, activeDates, completions);
  const longestStreak = calcLongestStreak(habit, activeDates, completions);

  return { current: currentStreak, longest: longestStreak };
}

function calcCurrentStreak(habit: Habit, activeDates: Date[], completions: CompletionMap): number {
  let startIdx = activeDates.length - 1;
  while (startIdx >= 0) {
    const date = formatDate(activeDates[startIdx]);
    const status = completions[habit.name]?.[date];
    if (status !== undefined) {
      break;
    }
    startIdx--;
  }

  if (startIdx < 0) {
    return 0;
  }

  const mostRecentStatus = completions[habit.name]?.[formatDate(activeDates[startIdx])];
  if (mostRecentStatus === 'unmarked') {
    let searchIdx = startIdx;
    while (searchIdx >= 0) {
      const date = formatDate(activeDates[searchIdx]);
      const status = completions[habit.name]?.[date];
      if (status && status !== 'unmarked') {
        startIdx = searchIdx;
        break;
      }
      searchIdx--;
    }
    if (searchIdx < 0) {
      return 0;
    }
  }

  let streak = 0;
  let gapUsed = false;

  for (let i = startIdx; i >= 0; i--) {
    const date = formatDate(activeDates[i]);
    const status = completions[habit.name]?.[date] || 'unmarked';

    if (status === 'completed') {
      streak++;
      if (gapUsed) {
        gapUsed = false;
      }
    } else if (habit.streakMode === 'forgiving' && !gapUsed && (status === 'missed' || status === 'unmarked')) {
      gapUsed = true;
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function calcLongestStreak(habit: Habit, activeDates: Date[], completions: CompletionMap): number {
  let longest = 0;
  let current = 0;
  let gapUsed = false;

  for (let i = 0; i < activeDates.length; i++) {
    const date = activeDates[i];
    const dateStr = formatDate(date);
    const status = completions[habit.name]?.[dateStr] || 'unmarked';

    if (status === 'completed') {
      current++;
      longest = Math.max(longest, current);
      if (gapUsed) {
        gapUsed = false;
      }
    } else if (habit.streakMode === 'forgiving' && !gapUsed && (status === 'missed' || status === 'unmarked')) {
      const prevCompleted = i > 0 && completions[habit.name]?.[formatDate(activeDates[i - 1])] === 'completed';
      const nextCompleted = i < activeDates.length - 1 && completions[habit.name]?.[formatDate(activeDates[i + 1])] === 'completed';
      if (prevCompleted && nextCompleted) {
        gapUsed = true;
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 0;
        gapUsed = false;
      }
    } else {
      current = 0;
      gapUsed = false;
    }
  }

  return longest;
}
