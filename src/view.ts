import { ItemView, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type HabitTrackerPlugin from './main';
import type { Habit } from './types';
import { renderTodayView } from './views/today';
import { renderMonthView } from './views/month';
import { renderYearView } from './views/year';
import { renderYearOverview } from './views/yearOverview';
import { AddHabitModal, EditHabitModal, DeleteHabitModal } from './views/modals';
import { subscribe } from './store';
import type { ViewType } from './types';

export const VIEW_TYPE_HABIT_TRACKER = 'banshan-habit-tracker-view';

export class HabitTrackerView extends ItemView {
  plugin: HabitTrackerPlugin;
  private unsubscribeStore: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: HabitTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_HABIT_TRACKER; }
  getDisplayText(): string { return 'Habit Tracker'; }
  getIcon(): string { return 'calendar-check'; }

  async onOpen(): Promise<void> {
    // Subscribe to store changes for automatic re-rendering
    this.unsubscribeStore = subscribe((payload) => {
      if (payload && payload.type === 'toggle' && payload.habitName && payload.date) {
        // Update only the affected cell(s) in place without full re-render
        this.updateCellInPlace(payload.habitName, payload.date);
      } else if (payload && payload.type === 'toggle') {
        // Toggle for a habit not in current view — skip in-place update
        // The view will be updated on next interaction or manual refresh
      } else {
        // Full re-render for other changes
        void this.render();
      }
    });
    await this.render();
  }

  async onClose(): Promise<void> {
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
  }

  /**
   * Update only the cell(s) for a toggled date without re-rendering the entire view.
   * Works for year and yearOverview views where cells have data-date attributes.
   */
  private updateCellInPlace(habitName: string, date: string): void {
    const container = this.containerEl.children[1] as HTMLElement;
    const state = this.plugin.getState();
    const habit = state.habits.find(h => h.name === habitName);
    if (!habit) return;

    const isCompleted = state.completions[habitName]?.[date] === 'completed';

    // Check if we're in the today view
    const todaySection = container.querySelector('.today-overview');
    if (todaySection) {
      this.updateTodayViewInPlace(habitName, date, isCompleted, habit);
      return;
    }

    // Find all cells for this habit with the matching data-date attribute
    const cells = container.querySelectorAll(`[data-habit="${habitName}"][data-date="${date}"]`);
    cells.forEach(cell => {
      const el = cell as HTMLElement;
      if (isCompleted) {
        el.addClass('completed');
        // Check if this is a year view cell (has opacity-based streak levels)
        const isYearCell = el.classList.contains('github-cell') || el.classList.contains('year-overview-day');
        if (isYearCell) {
          const streak = this.calcStreakForDate(habit, date);
          const opacity = this.getOpacityForStreak(streak);
          el.style.setProperty('--habit-color', habit.color, 'important');
          el.style.setProperty('--habit-opacity', String(opacity), 'important');
        } else {
          // Month/today view: just set the background color
          el.style.setProperty('--habit-color', habit.color);
          el.style.removeProperty('--habit-opacity');
        }
      } else {
        el.removeClass('completed');
        el.style.removeProperty('--habit-color');
        el.style.removeProperty('--habit-opacity');
      }
    });
  }

  private updateTodayViewInPlace(habitName: string, date: string, isCompleted: boolean, habit: Habit): void {
    const container = this.containerEl.children[1] as HTMLElement;
    const todaySection = container.querySelector('.today-overview');
    if (!todaySection) return;

    // Find the card for this habit
    const cards = todaySection.querySelectorAll('.today-card');
    let foundCard = false;
    cards.forEach(card => {
      const habitNameEl = card.querySelector('.today-habit-name');
      const cardHabitName = habitNameEl?.textContent?.trim();
      if (!cardHabitName || cardHabitName !== habitName) return;
      foundCard = true;

      const todayStr = this.formatDate(new Date());

      // Update the week squares (they're inside .today-week-row)
      const weekRow = card.querySelector('.today-week-row');
      const weekSquares = weekRow?.querySelectorAll('[data-date="' + date + '"]') || [];
      weekSquares.forEach(sq => {
        const sqEl = sq as HTMLElement;
        const isTodaySq = sqEl.classList.contains('today');
        if (isCompleted) {
          sqEl.addClass('completed');
          sqEl.style.setProperty('--habit-color', habit.color);
          sqEl.style.setProperty('--habit-shadow', `0 6px 14px ${this.hexToRgba(habit.color, 0.14)}`);
          if (isTodaySq) {
            sqEl.style.setProperty('--habit-outline', `2px solid ${this.hexToRgba(habit.color, 0.18)}`);
          }
        } else {
          sqEl.removeClass('completed');
          sqEl.style.removeProperty('--habit-color');
          sqEl.style.removeProperty('--habit-shadow');
          if (isTodaySq) {
            sqEl.style.setProperty('--habit-light-bg', this.hexToRgba(habit.color, 0.12));
            sqEl.style.setProperty('--habit-outline', `2px solid ${this.hexToRgba(habit.color, 0.18)}`);
          } else {
            sqEl.style.removeProperty('--habit-light-bg');
            sqEl.style.removeProperty('--habit-outline');
          }
        }
      });

      // Update the check button only if toggling today's date
      if (date === todayStr) {
        // Update inline check button in .today-card-middle
        const middleSection = card.querySelector('.today-card-middle');
        const inlineCheckBtnEl = middleSection?.querySelector('[data-date="' + date + '"]');
        if (inlineCheckBtnEl) {
          const inlineCheckBtn = inlineCheckBtnEl;
          const markEl = inlineCheckBtn.querySelector('.today-check-mark');
          const mark = markEl ? markEl : null;
          if (mark) mark.textContent = isCompleted ? '✓' : '';
          if (isCompleted) {
            inlineCheckBtn.addClass('active');
            card.addClass('active-today');
            card.style.setProperty('--habit-card-bg', this.hexToRgba(habit.color, 0.12));
            card.style.setProperty('--habit-text-color', this.getContrastColor(habit.color));
            inlineCheckBtn.style.setProperty('--habit-btn-bg', habit.color);
            inlineCheckBtn.style.setProperty('--habit-btn-shadow', `0 8px 20px ${this.hexToRgba(habit.color, 0.18)}`);
            inlineCheckBtn.style.setProperty('--habit-btn-border', habit.color);
          } else {
            inlineCheckBtn.removeClass('active');
            card.removeClass('active-today');
            card.style.removeProperty('--habit-card-bg');
            card.style.removeProperty('--habit-text-color');
            inlineCheckBtn.style.removeProperty('--habit-btn-bg');
            inlineCheckBtn.style.removeProperty('--habit-btn-shadow');
            inlineCheckBtn.style.removeProperty('--habit-btn-border');
          }
        }

        // Update the check button in .today-card-right
        const rightSection = card.querySelector('.today-card-right');
        const checkBtnEl = rightSection?.querySelector('[data-date="' + date + '"]');
        if (checkBtnEl) {
          const checkBtn = checkBtnEl;
          const markEl = checkBtn.querySelector('.today-check-mark');
          const mark = markEl ? markEl : null;
          if (mark) mark.textContent = isCompleted ? '✓' : '';
          if (isCompleted) {
            checkBtn.addClass('active');
          } else {
            checkBtn.removeClass('active');
          }
        }
      }

      // Update the week count by recalculating from the state
      const freshState = this.plugin.getState();
      const habitCompletions = freshState.completions[habitName] || {};
      let weekCount = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dayOfWeek = (today.getDay() + 6) % 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - dayOfWeek);
      const numDays = this.plugin.settings?.todayViewDays ?? 7;
      for (let i = 0; i < numDays; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dStr = this.formatDate(d);
        if (habitCompletions[dStr] === 'completed') weekCount++;
      }
      // Update both the count number and the /N label
      const countNumEl = card.querySelector('.today-count-number');
      if (countNumEl) countNumEl.textContent = String(weekCount);
      const countLabelEl = card.querySelector('.today-count-label');
      if (countLabelEl) countLabelEl.textContent = weekCount === 1 ? 'DAY' : 'DAYS';
      const weekCountEl = card.querySelector('.today-week-count');
      if (weekCountEl) weekCountEl.textContent = `${weekCount}/${numDays}`;
    });
  }

  private calcStreakForDate(habit: Habit, dateStr: string): number {
    const habitCompletions = this.plugin.getState().completions[habit.name];
    if (!habitCompletions || !habitCompletions[dateStr]) return 0;
    
    const targetDate = new Date(dateStr + 'T00:00:00');
    let streak = 0;
    let currentDate = new Date(targetDate);
    
    while (true) {
      const date = this.formatDate(currentDate);
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

  private getOpacityForStreak(streak: number): number {
    if (streak >= 15) return 1.0;
    if (streak >= 8) return 0.8;
    if (streak >= 5) return 0.7;
    if (streak >= 3) return 0.6;
    return 0.5;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private hexToRgba(hex: string, alpha: number): string {
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

  private getContrastColor(hex: string): string {
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

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('habit-tracker-container');

    const controlsEl = this.renderControls(container);
    const contentWrapper = container.createEl('div', { cls: 'habit-content' });

    const applyOffset = () => {
      try {
        const h = (controlsEl as HTMLElement).getBoundingClientRect().height || 0;
        const offset = Math.max(4, Math.ceil(h * 0.4));
        contentWrapper.style.setProperty('--content-offset', `${offset}px`);
      } catch { /* ignore */ }
    };

    window.requestAnimationFrame(applyOffset);
    window.addEventListener('resize', applyOffset);

    const state = this.plugin.getState();
    const habits = state.habits;

    if (state.error) {
      const errorEl = container.createEl('div', { cls: 'no-habits-message' });
      errorEl.createEl('div', { text: '⚠️ Error loading habits', cls: 'error-title' });
      errorEl.createEl('div', { text: state.error, cls: 'error-detail' });
      errorEl.createEl('button', {
        text: 'Delete habits file & reload',
        cls: 'error-retry-button'
      }).addEventListener('click', async () => {
        try {
          const file = this.app.vault.getAbstractFileByPath(state.habitsFilePath);
          if (file instanceof TFile) {
            await this.app.fileManager.trashFile(file, false);
          }
          await this.plugin.loadHabits();
          await this.render();
        } catch (e) {
          console.error('[HabitTracker] Failed to retry:', e);
        }
      });
      return;
    }

    if (habits.length === 0) {
      container.createEl('div', { text: 'No habits yet. Click "Add" to get started!', cls: 'no-habits-message' });
      return;
    }

    if (!state.selectedHabit || !habits.find(h => h.name === state.selectedHabit)) {
      this.plugin.setSelectedHabit(habits[0].name);
    }

    if (state.viewType === 'today') {
      renderTodayView(contentWrapper, this.plugin, state);
    } else if (state.viewType === 'month') {
      renderMonthView(contentWrapper, this.plugin, state);
    } else if (state.viewType === 'year') {
      renderYearView(contentWrapper, this.plugin, state);
    } else if (state.viewType === 'yearOverview') {
      renderYearOverview(contentWrapper, this.plugin, state);
    }
  }

  private renderControls(container: HTMLElement): HTMLElement {
    const controlsSection = container.createEl('div', { cls: 'habit-controls' });

    const addButton = controlsSection.createEl('button', { text: 'Add', cls: 'habit-control-button' });
    addButton.addEventListener('click', () => {
      new AddHabitModal(this.app, this.plugin, async (): Promise<void> => { await this.render(); }).open();
    });

    const habits = this.plugin.getState().habits;

    if (habits.length > 0) {
      const selectorContainer = controlsSection.createEl('div', { cls: 'habit-selector-container' });
      const customDropdown = selectorContainer.createEl('div', { cls: 'custom-habit-dropdown' });

      const dropdownButton = customDropdown.createEl('button', { cls: 'habit-dropdown-button' });
      dropdownButton.createEl('span', { text: this.plugin.getState().selectedHabit || 'Select Habit', cls: 'habit-dropdown-text' });
      dropdownButton.createEl('span', { text: '▼', cls: 'habit-dropdown-arrow' });

      const dropdownMenu = customDropdown.createEl('div', { cls: 'habit-dropdown-menu' });

      habits.forEach(habit => {
        const item = dropdownMenu.createEl('div', { cls: 'habit-dropdown-item' });
        if (habit.name === this.plugin.getState().selectedHabit) item.addClass('active');
        const habitText = item.createEl('span', { text: habit.name, cls: 'habit-item-text' });
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.plugin.setSelectedHabit(habit.name);
          dropdownMenu.toggleClass('show', false);
          void this.render();
        });
      });

      dropdownButton.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.toggleClass('show', true);
      });

      this.registerDomEvent(document, 'click', (e: MouseEvent) => {
        if (!customDropdown.contains(e.target as Node)) {
          dropdownMenu.toggleClass('show', false);
        }
      });

      const editButton = controlsSection.createEl('button', { text: 'Edit', cls: 'habit-control-button' });
      editButton.disabled = !this.plugin.getState().selectedHabit;
      editButton.addEventListener('click', () => {
        if (this.plugin.getState().selectedHabit) {
          new EditHabitModal(this.app, this.plugin, this.plugin.getState().selectedHabit, async (): Promise<void> => { await this.render(); }).open();
        }
      });

      const deleteButton = controlsSection.createEl('button', { text: 'Delete', cls: 'habit-control-button' });
      deleteButton.disabled = !this.plugin.getState().selectedHabit;
      deleteButton.addEventListener('click', () => {
        if (this.plugin.getState().selectedHabit) {
          new DeleteHabitModal(this.app, this.plugin, this.plugin.getState().selectedHabit, async (): Promise<void> => { await this.render(); }).open();
        }
      });

      const viewControlsContainer = controlsSection.createEl('div', { cls: 'view-controls-container' });
      const radioGroup = viewControlsContainer.createEl('div', { cls: 'view-radio-group' });

      const viewOptions = [
        { value: 'today', text: 'Today', title: "Today's habits overview" },
        { value: 'month', text: 'Month', title: 'Traditional monthly calendar' },
        { value: 'yearOverview', text: 'Year', title: 'All 12 months at a glance' },
        { value: 'year', text: 'All', title: 'GitHub-style contribution grid' }
      ];

      viewOptions.forEach(option => {
        const radioLabel = radioGroup.createEl('label', { cls: 'view-radio-label' });


        const radioInput = radioLabel.createEl('input', {
          type: 'radio',
          attr: { name: 'view-type', value: option.value },
          cls: 'view-radio-input'
        });

        if (option.value === this.plugin.getState().viewType) radioInput.checked = true;

        radioInput.addEventListener('change', () => {
          if (radioInput.checked) {
            this.plugin.setViewType(option.value as ViewType);
            void this.render();
          }
        });

        radioLabel.createEl('span', { text: option.text, cls: 'view-radio-text' });
        radioLabel.setAttribute('title', option.title);
      });
    }

    const controlsRight = controlsSection.createEl('div', { cls: 'controls-right' });

    const settingsBtn = controlsRight.createEl('button', { cls: 'habit-settings-button', attr: { type: 'button', title: 'Settings' } });
    setIcon(settingsBtn, 'settings');

    settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const settingManager = this.app.setting;
      settingManager.open();
      settingManager.openTabById(this.plugin.manifest.id);
    });

    return controlsSection;
  }
}
