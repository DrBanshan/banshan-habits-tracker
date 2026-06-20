import type HabitTrackerPlugin from '../main';
import type { AppState, Habit } from '../types';

export function renderMonthView(container: HTMLElement, plugin: HabitTrackerPlugin, state: AppState): void {
  const habits = state.habits;
  if (habits.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Use CSS grid for dynamic wrapping
  container.addClass('month-grid-container');

  // Cache drag items list to avoid DOM queries on every dragover event
  let cachedItems: HTMLElement[] = [];

  habits.forEach((habit, idx) => {
    const habitBlock = container.createEl('div', { cls: 'month-habit-block habit-drag-item' });
    habitBlock.setAttribute('draggable', 'true');
    habitBlock.setAttribute('data-habit-index', String(idx));
    renderMonthCalendar(habitBlock, habit, today, plugin, state);

    // Drag events for reordering
    habitBlock.addEventListener('dragstart', (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', String(idx));
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  // Populate cache after all drag items are created
  cachedItems = Array.from(container.querySelectorAll<HTMLElement>('.habit-drag-item'));

  // Drop zone handling on the container
  let draggedItem: HTMLElement | null = null;
  let rafId: number | null = null;
  container.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Throttle to one layout calculation per frame
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      const items = cachedItems;
      for (const item of items) {
        item.classList.remove('drag-over-right', 'drag-over-left');
      }
      // Find the closest block to the cursor with a generous zone
      let bestItem: HTMLElement | null = null;
      let bestDist = Infinity;
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const dist = Math.abs(e.clientX - centerX);
        if (item !== draggedItem && dist < bestDist) {
          bestDist = dist;
          bestItem = item;
        }
      }
      if (bestItem) {
        const rect = bestItem.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (e.clientX < midX) {
          bestItem.classList.add('drag-over-left');
        } else {
          bestItem.classList.add('drag-over-right');
        }
      }
    });
  });

  // Track the dragged item
  container.addEventListener('dragstart', (e: DragEvent) => {
    const target = e.target as Element;
    draggedItem = target.closest('.habit-drag-item');
  });

  container.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
    const target = e.target as Element;
    const closestItem = target.closest('.habit-drag-item');
    if (!closestItem || closestItem === draggedItem) return;
    const closestItemHtEl = closestItem as HTMLElement;
    const toItems = cachedItems;
    let toIdx = toItems.indexOf(closestItemHtEl);
    const rect = closestItem.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (e.clientX > midX) toIdx++;
    if (fromIdx !== toIdx) {
      // Reorder DOM nodes in place first (avoids full re-render)
      const fromItem = container.children[fromIdx];
      const toItem = container.children[toIdx];
      if (fromIdx < toIdx) {
        toItem.after(fromItem);
      } else {
        toItem.before(fromItem);
      }
      // Then update the store
      plugin.reorderHabits(fromIdx, toIdx);
    }
  });
}

function renderMonthCalendar(container: HTMLElement, habit: Habit, today: Date, plugin: HabitTrackerPlugin, state: AppState): void {
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Habit name header
  const habitHeader = container.createEl('div', { cls: 'month-habit-header' });
  habitHeader.createEl('div', { text: `${habit.icon} ${habit.name}`, cls: 'month-habit-name' });

  // Month navigation
  const nav = habitHeader.createEl('div', { cls: 'month-nav' });
  const prevBtn = nav.createEl('button', { text: '◀', cls: 'month-nav-btn' });
  const monthLabel = nav.createEl('span', { cls: 'month-label' });
  const nextBtn = nav.createEl('button', { text: '▶', cls: 'month-nav-btn' });

  const updateMonthLabel = () => {
    const m = state.selectedMonth;
    monthLabel.textContent = `${monthNamesShort[m.getMonth()]} ${m.getFullYear()}`;
  };
  updateMonthLabel();

  prevBtn.addEventListener('click', () => {
    const m = new Date(state.selectedMonth);
    m.setMonth(m.getMonth() - 1);
    plugin.setSelectedMonth(m);
    void plugin.refreshView();
  });

  nextBtn.addEventListener('click', () => {
    const m = new Date(state.selectedMonth);
    m.setMonth(m.getMonth() + 1);
    plugin.setSelectedMonth(m);
    void plugin.refreshView();
  });

  // Calendar grid
  const calendar = container.createEl('div', { cls: 'month-calendar' });
  
  // Weekday headers
  const weekHeader = calendar.createEl('div', { cls: 'month-weekdays' });
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(day => {
    weekHeader.createEl('div', { text: day, cls: 'month-weekday' });
  });

  // Days grid
  const daysGrid = calendar.createEl('div', { cls: 'month-days' });

  const year = state.selectedMonth.getFullYear();
  const month = state.selectedMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startingDayOfWeek = (firstDay.getDay() + 6) % 7;

  // Empty cells for days before the 1st
  for (let i = 0; i < startingDayOfWeek; i++) {
    daysGrid.createEl('div', { cls: 'month-day empty' });
  }

  // Day cells
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const currentDate = new Date(year, month, day);
    const dateStr = formatDate(currentDate);
    const dayCell = daysGrid.createEl('div', { cls: 'month-day', attr: { 'data-date': dateStr, 'data-habit': habit.name } });
    dayCell.createEl('div', { text: String(day), cls: 'month-day-num' });

    const isCompleted = isHabitCompleted(plugin, habit.name, dateStr);
    if (isCompleted) {
      dayCell.addClass('completed');
      dayCell.style.setProperty('--habit-color', habit.color);
      dayCell.style.setProperty('--habit-text-color', getContrastColor(habit.color));
      const numEl = dayCell.querySelector('.month-day-num');
      if (numEl) {
        numEl.addClass('today');
      }
    }

    if (isSameDay(currentDate, today)) {
      dayCell.addClass('today');
      if (!isCompleted) {
        dayCell.style.setProperty('--habit-outline', `2px solid ${habit.color}`);
      }
    }

    dayCell.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      plugin.toggleDay(habit.name, dateStr);
    });
  }
}

function isHabitCompleted(plugin: HabitTrackerPlugin, habitName: string, date: string): boolean {
  const state = plugin.getState();
  return state.completions[habitName]?.[date] === 'completed';
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getContrastColor(hex: string): string {
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
  const l = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
  return l > 0.6 ? '#000' : '#fff';
}

function isSameDay(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate();
}
