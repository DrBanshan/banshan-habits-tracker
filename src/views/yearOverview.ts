import type HabitTrackerPlugin from '../main';
import type { AppState, Habit, CompletionMap } from '../types';

export function renderYearOverview(container: HTMLElement, plugin: HabitTrackerPlugin, state: AppState): void {
  const habits = state.habits;
  if (habits.length === 0) return;

  const habitName = state.selectedHabit || habits[0].name;
  const habit = habits.find(h => h.name === habitName);
  if (!habit) return;

  const section = container.createEl('div', { cls: 'habit-section year-overview' });

  
  const header = section.createEl('div', { cls: 'year-overview-header' });

  const headerLeft = header.createEl('div', { cls: 'year-overview-header-left' });
  headerLeft.createEl('div', { text: habitName, cls: 'habit-name' });

  const habitNav = headerLeft.createEl('div', { cls: 'habit-year-nav' });
  const currentIndex = habits.indexOf(habit);

  const prevHabitBtn = habitNav.createEl('button', { text: '◀', cls: 'habit-nav-button' });
  prevHabitBtn.disabled = currentIndex <= 0;
  prevHabitBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
      plugin.setSelectedHabit(habits[currentIndex - 1].name);
      void plugin.refreshView();
    }
  });

  const nextHabitBtn = habitNav.createEl('button', { text: '▶', cls: 'habit-nav-button' });
  nextHabitBtn.disabled = currentIndex >= habits.length - 1;
  nextHabitBtn.addEventListener('click', () => {
    if (currentIndex < habits.length - 1) {
      plugin.setSelectedHabit(habits[currentIndex + 1].name);
      void plugin.refreshView();
    }
  });

  const yearSelector = header.createEl('div', { cls: 'github-year-selector' });
  
  const earliestYear = getEarliestYearWithData(plugin, habitName);
  const startYear = Math.min(earliestYear, state.selectedYear);

  for (let year = startYear; year <= state.selectedYear; year++) {
    const yearButton = yearSelector.createEl('button', {
      text: String(year),
      cls: 'github-year-button'
    });
    if (year === state.selectedYear) yearButton.addClass('active');
    if (year === new Date().getFullYear()) yearButton.addClass('current-year');

    yearButton.addEventListener('click', () => {
      plugin.setSelectedYear(year);
      void plugin.refreshView();
    });
  }

  const yearContainer = section.createEl('div', { cls: 'year-overview-container' });

  
  const yearGrid = yearContainer.createEl('div', { cls: 'year-overview-grid' });

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const isCurrentYear = state.selectedYear === currentYear;
  const lastMonth = isCurrentYear ? currentMonth : 11;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDate = today.getDate();

  for (let month = 0; month < 12; month++) {
    const monthContainer = yearGrid.createEl('div', { cls: 'year-overview-month' });

    monthContainer.createEl('div', { text: monthNames[month], cls: 'year-overview-month-name' });
    const monthDays = monthContainer.createEl('div', { cls: 'year-overview-days' });

    const daysInMonth = new Date(state.selectedYear, month + 1, 0).getDate();
    const isCurrentMonth = isCurrentYear && month === currentMonth;
    const lastDay = daysInMonth;

    const firstOfMonth = new Date(state.selectedYear, month, 1);
    const startingDayOfWeek = (firstOfMonth.getDay() + 6) % 7;

    for (let day = 1; day <= lastDay; day++) {
      const currentDate = new Date(state.selectedYear, month, day);
      const dateStr = formatDate(currentDate);
      const dayCell = monthDays.createEl('div', { cls: 'year-overview-day', attr: { 'data-date': dateStr, 'data-habit': habitName } });

      const offset = startingDayOfWeek + (day - 1);
      const col = (offset % 7) + 1;
      const row = Math.floor(offset / 7) + 1;
      dayCell.style.gridColumn = `${col}`;
      dayCell.style.gridRow = `${row}`;

      const isCompleted = isHabitCompleted(plugin, habitName, dateStr);
      if (isCompleted) {
        dayCell.addClass('completed');
        const streak = getStreakLength(habit, state.completions, dateStr);
        const opacity = getOpacityForStreak(streak);
        dayCell.style.setProperty('--habit-color', habit.color, 'important');
        dayCell.style.setProperty('--habit-opacity', String(opacity), 'important');
      }

      if (isSameDay(currentDate, today)) {
        dayCell.addClass('today');
        if (!isCompleted) {
          dayCell.style.setProperty('--habit-light-bg', hexToRgba(habit.color, 0.12));
          dayCell.style.setProperty('--habit-outline', `2px solid ${hexToRgba(habit.color, 0.18)}`);
        }
      }

      dayCell.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        plugin.toggleDay(habitName, dateStr);
      });
    }
  }
}

function isHabitCompleted(plugin: HabitTrackerPlugin, habitName: string, date: string): boolean {
  const state = plugin.getState();
  return state.completions[habitName]?.[date] === 'completed';
}

function getStreakLength(habit: Habit, completions: CompletionMap, dateStr: string): number {
  const habitCompletions = completions[habit.name];
  if (!habitCompletions || !habitCompletions[dateStr]) return 0;
  
  const targetDate = new Date(dateStr + 'T00:00:00');
  let streak = 0;
  let currentDate = new Date(targetDate);
  
  while (true) {
    const date = formatDate(currentDate);
    const status = habitCompletions[date];
    
    if (status === 'completed') {
      streak++;
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return streak;
}

function getOpacityForStreak(streak: number): number {
  if (streak >= 15) return 1.0;
  if (streak >= 8) return 0.8;
  if (streak >= 5) return 0.7;
  if (streak >= 3) return 0.6;
  return 0.5;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').trim();
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isSameDay(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate();
}

function getEarliestYearWithData(plugin: HabitTrackerPlugin, habitName: string): number {
  const currentYear = new Date().getFullYear();
  const state = plugin.getState();
  const habitData = state.completions[habitName];
  if (!habitData || typeof habitData !== 'object') return currentYear;
  const dates = Object.keys(habitData);
  if (dates.length === 0) return currentYear;
  let earliestYear = currentYear;
  dates.forEach(dateStr => {
    const year = parseInt(dateStr.split('-')[0]);
    if (year < earliestYear) earliestYear = year;
  });
  return earliestYear;
}
