import type HabitTrackerPlugin from '../main';
import type { AppState, Habit, CompletionMap } from '../types';

export function renderYearView(container: HTMLElement, plugin: HabitTrackerPlugin, state: AppState): void {
  const habits = state.habits;
  if (habits.length === 0) return;

  const currentYear = new Date().getFullYear();

  habits.forEach((habit, idx) => {
    const section = container.createEl('div', { cls: 'habit-section github-style habit-drag-item' });
    section.setAttribute('draggable', 'true');
    section.setAttribute('data-habit-index', String(idx));
    
    const header = section.createEl('div', { cls: 'github-header' });
    header.createEl('div', { text: habit.name, cls: 'habit-name' });

    const headerYearSelector = header.createEl('div', { cls: 'github-year-selector' });

    const yearContainer = section.createEl('div', { cls: 'github-year-container' });

    const graphContainer = yearContainer.createEl('div', { cls: 'github-graph-container' });
    
    const grid = graphContainer.createEl('div', { cls: 'github-square-grid' });


    const startDate = new Date(state.selectedYear, 0, 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build the grid with CSS auto-fill for dynamic column wrapping
    grid.empty();
    const daysInYear = (new Date(state.selectedYear + 1, 0, 1).getTime() - new Date(state.selectedYear, 0, 1).getTime()) / (24 * 60 * 60 * 1000);

    const totalCells = Math.ceil(daysInYear);

    for (let i = 0; i < totalCells; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);
      const dateStr = formatDate(currentDate);

      const cell = grid.createEl('div', { cls: 'github-cell', attr: { 'data-date': dateStr, 'data-habit': habit.name } });

      if (currentDate.getFullYear() !== state.selectedYear) {
        cell.addClass('outside-year');
      } else {
        const isCompleted = isHabitCompleted(plugin, habit.name, dateStr);
        if (isCompleted) {
          cell.addClass('completed');
          const streak = getStreakLength(habit, state.completions, dateStr);
          const opacity = getOpacityForStreak(streak);
          cell.style.setProperty('--habit-color', habit.color, 'important');
          cell.style.setProperty('--habit-opacity', String(opacity), 'important');
        }

        if (isSameDay(currentDate, today)) {
          cell.addClass('today');
          if (!isCompleted) {
            cell.style.setProperty('--habit-light-bg', hexToRgba(habit.color, 0.12));
            cell.style.setProperty('--habit-outline', `2px solid ${hexToRgba(habit.color, 0.18)}`);
          }
        }

        cell.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          plugin.toggleDay(habit.name, dateStr);
        });
      }
    }

    const earliestYear = getEarliestYearWithData(plugin, habit.name);
    const startYear = Math.min(earliestYear, currentYear);

    for (let year = startYear; year <= currentYear; year++) {
      const yearButton = headerYearSelector.createEl('button', {
        text: String(year),
        cls: 'github-year-button'
      });
      if (year === state.selectedYear) yearButton.addClass('active');
      if (year === currentYear) yearButton.addClass('current-year');

      yearButton.addEventListener('click', () => {
        plugin.setSelectedYear(year);
        void plugin.refreshView();
      });
    }

    // Drag events for reordering
    section.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/plain', String(idx));
      e.dataTransfer!.effectAllowed = 'move';
    });
  });

  // Drop zone handling on the container
  let draggedItem: HTMLElement | null = null;
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    const items = container.querySelectorAll('.habit-drag-item');
    for (const item of items) {
      item.classList.remove('drag-over-top', 'drag-over-bottom');
    }
    // Find the closest section to the cursor with a generous zone
    let bestItem: HTMLElement | null = null;
    let bestDist = Infinity;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(e.clientY - centerY);
      if (item !== draggedItem && dist < bestDist) {
        bestDist = dist;
        bestItem = item;
      }
    }
    if (bestItem) {
      const rect = bestItem.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        bestItem.classList.add('drag-over-top');
      } else {
        bestItem.classList.add('drag-over-bottom');
      }
    }
  });

  // Track the dragged item
  container.addEventListener('dragstart', (e) => {
    const target = e.target as Element;
    draggedItem = target.closest('.habit-drag-item');
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const fromIdx = parseInt(e.dataTransfer!.getData('text/plain'));
    const target = e.target as Element;
    const closestItem = target.closest('.habit-drag-item');
    if (!closestItem || closestItem === draggedItem) return;
    const toItems = container.querySelectorAll('.habit-drag-item');
    let toIdx = toItems.indexOf(closestItem);
    const rect = closestItem.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY > midY) toIdx++;
    if (fromIdx !== toIdx) {
      plugin.reorderHabits(fromIdx, toIdx);
    }
  });
}

function isHabitCompleted(plugin: HabitTrackerPlugin, habitName: string, date: string): boolean {
  const state = plugin.getState();
  return state.completions[habitName]?.[date] === 'completed';
}

function getStreakLength(habit: Habit, completions: CompletionMap, dateStr: string): number {
  const habitCompletions = completions[habit.name];
  if (!habitCompletions || !habitCompletions[dateStr]) return 0;
  
  // Parse the date and count consecutive completed days backwards
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
  if (streak >= 15) return 1.0;  // L5: 100%
  if (streak >= 8) return 0.8;   // L4: 80%
  if (streak >= 5) return 0.7;   // L3: 70%
  if (streak >= 3) return 0.6;   // L2: 60%
  return 0.5;                     // L1: 50% (1-2 days)
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
