import type HabitTrackerPlugin from '../main';
import type { AppState, CompletionMap, Habit } from '../types';

interface HabitStats {
  habit: Habit;
  todayDone: boolean;
  weekDone: number;
  weekTotal: number;
  twentyOneDayDone: number;
  twentyOneDayTotal: number;
  yearDone: number;
  yearTotal: number;
  currentStreak: number;
  longestStreak: number;
}

export function renderDashboardView(container: HTMLElement, plugin: HabitTrackerPlugin, state: AppState): void {
  const habits = state.habits;
  if (habits.length === 0) return;

  const today = startOfDay(new Date());
  const todayStr = formatDate(today);
  const stats = habits.map(habit => getHabitStats(habit, state.completions, today));
  const todayDone = stats.filter(stat => stat.todayDone).length;
  const weekDone = sum(stats, stat => stat.weekDone);
  const weekTotal = sum(stats, stat => stat.weekTotal);
  const twentyOneDayDone = sum(stats, stat => stat.twentyOneDayDone);
  const twentyOneDayTotal = sum(stats, stat => stat.twentyOneDayTotal);
  const yearDone = sum(stats, stat => stat.yearDone);
  const yearTotal = sum(stats, stat => stat.yearTotal);
  const activeStreaks = stats.filter(stat => stat.currentStreak > 0).length;
  const bestHabit = [...stats].sort((a, b) => getRate(b.twentyOneDayDone, b.twentyOneDayTotal) - getRate(a.twentyOneDayDone, a.twentyOneDayTotal))[0];
  const weekdayStats = getWeekdayStats(habits, state.completions, today);

  const section = container.createEl('div', { cls: 'dashboard-view' });

  const overview = section.createEl('div', { cls: 'dashboard-overview-panel' });
  const header = overview.createEl('div', { cls: 'dashboard-header' });
  const headerText = header.createEl('div', { cls: 'dashboard-date-card' });
  headerText.createEl('div', { text: 'Current tracker', cls: 'dashboard-kicker' });
  headerText.createEl('h2', { text: 'Dashboard', cls: 'dashboard-title' });
  headerText.createEl('div', { text: formatLongDate(today), cls: 'dashboard-subtitle' });

  const rings = header.createEl('div', { cls: 'dashboard-rings' });
  renderProgressRing(rings, 'Today', todayDone, habits.length, 92);
  renderProgressRing(rings, '7 days', weekDone, weekTotal, 92);
  renderProgressRing(rings, '21 days', twentyOneDayDone, twentyOneDayTotal, 92);
  renderProgressRing(rings, 'Year', yearDone, yearTotal, 92);

  const statGrid = overview.createEl('div', { cls: 'dashboard-stat-grid' });
  renderMetric(statGrid, 'Habits', String(habits.length), 'Active habits in this tracker');
  renderMetric(statGrid, 'Active streaks', String(activeStreaks), 'Habits with a current streak');
  renderMetric(statGrid, 'Best habit', bestHabit ? bestHabit.habit.name : '-', bestHabit ? `${Math.round(getRate(bestHabit.twentyOneDayDone, bestHabit.twentyOneDayTotal))}% over 21 days` : 'No data');
  renderMetric(statGrid, 'Best weekday', weekdayStats.best.label, `${weekdayStats.best.done}/${weekdayStats.best.total} completed`);
  renderMetric(statGrid, 'Weakest weekday', weekdayStats.worst.label, `${weekdayStats.worst.done}/${weekdayStats.worst.total} completed`);
  renderMetric(statGrid, 'Today complete', `${todayDone}/${habits.length}`, todayStr);

  const table = section.createEl('div', { cls: 'dashboard-table' });
  const tableHeader = table.createEl('div', { cls: 'dashboard-table-row dashboard-table-header' });
  ['Habit', 'Today', '7 days', '21 days', 'Current', 'Best'].forEach((label, index) => {
    tableHeader.createEl('div', { text: label, cls: index === 0 ? 'dashboard-sticky-cell' : undefined });
  });

  stats.forEach(stat => {
    const row = table.createEl('div', { cls: 'dashboard-table-row' });
    row.style.setProperty('--habit-color', stat.habit.color);

    const habitCell = row.createEl('div', { cls: 'dashboard-habit-cell dashboard-sticky-cell' });
    habitCell.createEl('span', { text: stat.habit.icon, cls: 'dashboard-habit-icon' });
    habitCell.createEl('span', { text: stat.habit.name, cls: 'dashboard-habit-name' });

    row.createEl('div', {
      text: stat.todayDone ? 'Done' : 'Open',
      cls: stat.todayDone ? 'dashboard-status done' : 'dashboard-status open'
    });
    renderInlineRate(row, stat.weekDone, stat.weekTotal);
    renderInlineRate(row, stat.twentyOneDayDone, stat.twentyOneDayTotal);
    row.createEl('div', { text: String(stat.currentStreak), cls: 'dashboard-number-cell' });
    row.createEl('div', { text: String(stat.longestStreak), cls: 'dashboard-number-cell' });
  });
}

function renderProgressRing(container: HTMLElement, label: string, done: number, total: number, size: number): void {
  const percent = getRate(done, total);
  const radius = 36;
  const circumference = 2 * Math.PI * radius;

  const card = container.createEl('div', { cls: 'dashboard-ring-card' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'dashboard-ring');

  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', String(size / 2));
  track.setAttribute('cy', String(size / 2));
  track.setAttribute('r', String(radius));
  track.setAttribute('class', 'dashboard-ring-track');

  const value = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  value.setAttribute('cx', String(size / 2));
  value.setAttribute('cy', String(size / 2));
  value.setAttribute('r', String(radius));
  value.setAttribute('class', 'dashboard-ring-value');
  value.setAttribute('stroke-dasharray', String(circumference));
  value.setAttribute('stroke-dashoffset', String(circumference - (percent / 100) * circumference));

  svg.appendChild(track);
  svg.appendChild(value);
  card.appendChild(svg);

  const text = card.createEl('div', { cls: 'dashboard-ring-text' });
  text.createEl('div', { text: `${Math.round(percent)}%`, cls: 'dashboard-ring-percent' });
  card.createEl('div', { text: label, cls: 'dashboard-ring-label' });
}

function renderMetric(container: HTMLElement, label: string, value: string, detail: string): void {
  const card = container.createEl('div', { cls: 'dashboard-metric' });
  card.createEl('div', { text: label, cls: 'dashboard-metric-label' });
  card.createEl('div', { text: value, cls: 'dashboard-metric-value' });
  card.createEl('div', { text: detail, cls: 'dashboard-metric-detail' });
}

function renderInlineRate(container: HTMLElement, done: number, total: number): void {
  const cell = container.createEl('div', { cls: 'dashboard-rate-cell' });
  cell.createEl('span', { text: `${Math.round(getRate(done, total))}%` });
  cell.createEl('small', { text: `${done}/${total}` });
}

function getHabitStats(habit: Habit, completions: CompletionMap, today: Date): HabitStats {
  const weekDates = getDateWindow(today, 7);
  const twentyOneDayDates = getDateWindow(today, 21);
  const yearDates = getCalendarYearWindow(today);
  const streak = getStreaks(habit, completions, today);

  const week = countCompleted(habit, completions, weekDates);
  const twentyOneDay = countCompleted(habit, completions, twentyOneDayDates);
  const year = countCompleted(habit, completions, yearDates);

  return {
    habit,
    todayDone: completions[habit.name]?.[formatDate(today)] === 'completed',
    weekDone: week.done,
    weekTotal: week.total,
    twentyOneDayDone: twentyOneDay.done,
    twentyOneDayTotal: twentyOneDay.total,
    yearDone: year.done,
    yearTotal: year.total,
    currentStreak: streak.current,
    longestStreak: streak.longest
  };
}

function countCompleted(habit: Habit, completions: CompletionMap, dates: Date[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const date of dates) {
    if (!isActiveDate(habit, date)) continue;
    total++;
    if (completions[habit.name]?.[formatDate(date)] === 'completed') done++;
  }
  return { done, total };
}

function getStreaks(habit: Habit, completions: CompletionMap, today: Date): { current: number; longest: number } {
  const habitCompletions = completions[habit.name] || {};
  const dates = getDateWindow(today, 365).filter(date => isActiveDate(habit, date));
  let current = 0;
  let longest = 0;
  let run = 0;
  let gapUsed = false;

  for (const date of dates) {
    const completed = habitCompletions[formatDate(date)] === 'completed';
    if (completed) {
      run++;
      longest = Math.max(longest, run);
    } else if (habit.streakMode === 'forgiving' && !gapUsed) {
      gapUsed = true;
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
      gapUsed = false;
    }
  }

  gapUsed = false;
  for (let i = dates.length - 1; i >= 0; i--) {
    const completed = habitCompletions[formatDate(dates[i])] === 'completed';
    if (completed) {
      current++;
    } else if (habit.streakMode === 'forgiving' && !gapUsed) {
      gapUsed = true;
      current++;
    } else {
      break;
    }
  }

  return { current, longest };
}

function getWeekdayStats(habits: Habit[], completions: CompletionMap, today: Date): { best: WeekdayStat; worst: WeekdayStat } {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const stats = labels.map(label => ({ label, done: 0, total: 0 }));
  for (const habit of habits) {
    for (const date of getDateWindow(today, 30)) {
      if (!isActiveDate(habit, date)) continue;
      const idx = (date.getDay() + 6) % 7;
      stats[idx].total++;
      if (completions[habit.name]?.[formatDate(date)] === 'completed') stats[idx].done++;
    }
  }
  const withTotals = stats.filter(stat => stat.total > 0);
  if (withTotals.length === 0) return { best: stats[0], worst: stats[0] };
  return {
    best: [...withTotals].sort((a, b) => getRate(b.done, b.total) - getRate(a.done, a.total))[0],
    worst: [...withTotals].sort((a, b) => getRate(a.done, a.total) - getRate(b.done, b.total))[0]
  };
}

interface WeekdayStat {
  label: string;
  done: number;
  total: number;
}

function getDateWindow(today: Date, days: number): Date[] {
  const dates: Date[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    dates.push(date);
  }
  return dates;
}

function getCalendarYearWindow(today: Date): Date[] {
  const dates: Date[] = [];
  const date = new Date(today.getFullYear(), 0, 1);
  const end = new Date(today.getFullYear(), 11, 31);
  while (date <= end) {
    dates.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

function isActiveDate(habit: Habit, date: Date): boolean {
  const startDate = new Date(habit.startDate + 'T00:00:00');
  if (date < startDate) return false;
  if (habit.frequency === 'specific' && habit.specificDays) {
    return habit.specificDays.includes(getDayName(date));
  }
  return true;
}

function getDayName(date: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

function getRate(done: number, total: number): number {
  if (total <= 0) return 0;
  return (done / total) * 100;
}

function sum(stats: HabitStats[], selector: (stat: HabitStats) => number): number {
  return stats.reduce((total, stat) => total + selector(stat), 0);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatLongDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
}
