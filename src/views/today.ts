import type HabitTrackerPlugin from '../main';
import type { AppState } from '../types';

export function renderTodayView(container: HTMLElement, plugin: HabitTrackerPlugin, state: AppState): void {
  const habits = state.habits;
  if (habits.length === 0) return;

  // Cache drag items list to avoid DOM queries on every dragover event

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const numDays = plugin.settings?.todayViewDays ?? 7;
  const dayOfWeek = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek);

  const weekDates: Date[] = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDates.push(d);
  }

  const todayStr = formatDate(today);

  // Generate day labels cycling through the week
  const getDayLabel = (offset: number) => {
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    return days[(offset % 7 + 7) % 7];
  };

  const todaySection = container.createEl('div', { cls: 'today-overview' });
  const titleRow = todaySection.createEl('div', { cls: 'today-title-row' });
  titleRow.createEl('h2', { text: 'Today', cls: 'today-title' });
  const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
  titleRow.createEl('span', { text: dateStr, cls: 'today-date-label' });

  const cardsContainer = todaySection.createEl('div', { cls: 'today-cards-container habit-draggable' });

  // Apply compact-mode class based on actual container width (not viewport)
  const COMPACT_WIDTH_THRESHOLD = 500;
  const applyCompactMode = () => {
    const width = cardsContainer.getBoundingClientRect().width;
    todaySection.classList.toggle('compact-mode', width <= COMPACT_WIDTH_THRESHOLD);
  };
  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      applyCompactMode();
    });
    resizeObserver.observe(cardsContainer);
    (cardsContainer as HTMLElement & { __compactObserver?: ResizeObserver }).__compactObserver = resizeObserver;
  }

  // Initial check
  applyCompactMode();

  // Cache drag items list to avoid DOM queries on every dragover event
  let cachedItems: HTMLElement[] = [];

  habits.forEach((habit, idx) => {
    let weekCount = 0;
    weekDates.forEach(d => {
      if (isHabitCompleted(plugin, habit.name, formatDate(d))) weekCount++;
    });

    const card = cardsContainer.createEl('div', { cls: 'today-card habit-section habit-drag-item' });
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-habit-index', String(idx));
    const isTodayCompleted = isHabitCompleted(plugin, habit.name, todayStr);

    // Column 1: streak day count
    const left = card.createEl('div', { cls: 'today-card-left' });
    left.createEl('div', { text: String(weekCount), cls: 'today-count-number' });
    left.createEl('div', { text: weekCount === 1 ? 'DAY' : 'DAYS', cls: 'today-count-label' });

    // Column 2: today toggle
    const checkBtn = card.createEl('button', { cls: 'today-check-button-inline' });
    checkBtn.createEl('span', { text: isTodayCompleted ? '✓' : '', cls: 'today-check-mark' });
    if (isTodayCompleted) checkBtn.addClass('active');

    // Column 3: habit name
    const habitNameEl = card.createEl('div', { text: habit.name, cls: 'today-habit-name' });

    // Column 4: day blocks
    const blocksContainer = card.createEl('div', { cls: 'today-blocks-container' });
    for (let w = 0; w < numDays; w += 7) {
      const weekRow = blocksContainer.createEl('div', { cls: 'today-week-row' });
      for (let i = w; i < Math.min(w + 7, numDays); i++) {
        const d = weekDates[i];
        const dStr = formatDate(d);
        const sq = weekRow.createEl('div', { cls: 'today-week-square' });
        sq.createEl('span', { text: getDayLabel(i), cls: 'today-week-initial' });

        const completed = isHabitCompleted(plugin, habit.name, dStr);
        // Clear any leftover inline styles from previous renders
        sq.style.removeProperty('--habit-color');
        sq.style.removeProperty('--habit-shadow');
        sq.style.removeProperty('--habit-outline');
        sq.style.removeProperty('--habit-light-bg');

        if (isSameDay(d, today)) {
          sq.addClass('today');
          if (completed) {
            sq.addClass('completed');
            sq.style.setProperty('--habit-color', habit.color);
            sq.style.setProperty('--habit-shadow', `0 6px 14px ${hexToRgba(habit.color, 0.14)}`);
            sq.style.setProperty('--habit-outline', `2px solid ${hexToRgba(habit.color, 0.18)}`);
          } else {
            sq.style.setProperty('--habit-light-bg', hexToRgba(habit.color, 0.12));
            sq.style.setProperty('--habit-outline', `2px solid ${hexToRgba(habit.color, 0.18)}`);
          }
        } else if (completed) {
          sq.addClass('completed');
          sq.style.setProperty('--habit-color', habit.color);
          sq.style.setProperty('--habit-shadow', `0 6px 14px ${hexToRgba(habit.color, 0.14)}`);
        }

        sq.addEventListener('click', () => {
          const wasCompleted = isHabitCompleted(plugin, habit.name, dStr);
          plugin.toggleDay(habit.name, dStr);
          // Update visual state immediately without full re-render
          const newState = !wasCompleted;
          if (isSameDay(d, today)) {
            sq.classList.toggle('completed', newState);
            if (newState) {
              sq.style.setProperty('--habit-color', habit.color);
              sq.style.setProperty('--habit-shadow', `0 6px 14px ${hexToRgba(habit.color, 0.14)}`);
              sq.style.setProperty('--habit-outline', `2px solid ${hexToRgba(habit.color, 0.18)}`);
            } else {
              sq.style.setProperty('--habit-light-bg', hexToRgba(habit.color, 0.12));
              sq.style.setProperty('--habit-outline', `2px solid ${hexToRgba(habit.color, 0.18)}`);
            }
          } else {
            sq.classList.toggle('completed', newState);
            if (newState) {
              sq.style.setProperty('--habit-color', habit.color);
              sq.style.setProperty('--habit-shadow', `0 6px 14px ${hexToRgba(habit.color, 0.14)}`);
            } else {
              sq.style.removeProperty('--habit-color');
              sq.style.removeProperty('--habit-shadow');
            }
          }
        });
        sq.setAttribute('data-date', dStr);
      }
    }

    // Column 5: total day count
    const weekCountEl = card.createEl('div', { text: `${weekCount}/${numDays}`, cls: 'today-week-count-inline' });

    if (isTodayCompleted) {
      card.addClass('active-today');
      card.style.setProperty('--habit-card-bg', hexToRgba(habit.color, 0.12));
      card.style.setProperty('--habit-text-color', getContrastColor(habit.color));
      checkBtn.style.setProperty('--habit-btn-bg', habit.color);
      checkBtn.classList.add('active');
      checkBtn.style.setProperty('--habit-btn-shadow', `0 8px 20px ${hexToRgba(habit.color, 0.18)}`);
    }

    checkBtn.addEventListener('click', () => {
      const wasCompleted = isHabitCompleted(plugin, habit.name, todayStr);
      plugin.toggleDay(habit.name, todayStr);
      // Update button visual state immediately without full re-render
      const newState = !wasCompleted;
      checkBtn.classList.toggle('active', newState);
      if (newState) {
        checkBtn.style.setProperty('--habit-btn-bg', habit.color);
        checkBtn.style.setProperty('--habit-btn-shadow', `0 8px 20px ${hexToRgba(habit.color, 0.18)}`);
        checkBtn.style.setProperty('--habit-btn-border', habit.color);
      } else {
        checkBtn.style.removeProperty('--habit-btn-bg');
        checkBtn.style.removeProperty('--habit-btn-shadow');
        checkBtn.style.removeProperty('--habit-btn-border');
      }
      // Update card state
      if (newState) {
        card.addClass('active-today');
        card.style.setProperty('--habit-card-bg', hexToRgba(habit.color, 0.12));
        card.style.setProperty('--habit-text-color', getContrastColor(habit.color));
      } else {
        card.removeClass('active-today');
        card.style.removeProperty('--habit-card-bg');
        card.style.removeProperty('--habit-text-color');
      }
    });
    checkBtn.setAttribute('data-date', todayStr);

    // Drag events for reordering
    card.addEventListener('dragstart', (e: DragEvent) => {
      card.addClass('dragging');
      e.dataTransfer.setData('text/plain', String(idx));
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.removeClass('dragging');
      cardsContainer.querySelectorAll('.habit-drag-item').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
    });
  });

  // Populate cache after all drag items are created
  cachedItems = Array.from(cardsContainer.querySelectorAll<HTMLElement>('.habit-drag-item'));

  // Drop zone handling on the container
  let draggedItem: HTMLElement | null = null;
  let rafId: number | null = null;
  cardsContainer.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Throttle to one layout calculation per frame
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      const items = cachedItems;
      for (const item of items) {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      }
      // Find the closest card to the cursor with a generous zone
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
  });

  // Track the dragged item via dragstart on the container
  cardsContainer.addEventListener('dragstart', (e: DragEvent) => {
    const target = e.target as Element;
    draggedItem = target.closest('.habit-drag-item');
  });

  cardsContainer.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
    const target = e.target as Element;
    const closestItem = target.closest('.habit-drag-item');
    if (!closestItem || closestItem === draggedItem) return;
    const closestItemHtEl = closestItem as HTMLElement;
    const toItems = cachedItems;
    let toIdx = toItems.indexOf(closestItemHtEl);
    const rect = closestItem.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY > midY) toIdx++;
    if (fromIdx !== toIdx) {
      // Reorder DOM nodes in place first (avoids full re-render)
      const fromItem = cardsContainer.children[fromIdx];
      const toItem = cardsContainer.children[toIdx];
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
