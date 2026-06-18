import { Plugin, WorkspaceLeaf, PluginSettingTab, Setting } from 'obsidian';
import { HabitTrackerView, VIEW_TYPE_HABIT_TRACKER } from './view';
import { init, loadHabits, toggleDay, addHabit, renameHabit, deleteHabit, setHabitColor, setViewType, setSelectedHabit, setSelectedMonth, setSelectedYear, clearError, setHabitsFilePath, getState, reorderHabits, updateSettings } from './store';
import { DEFAULT_HABITS_FILE } from './types';
import type { Habit } from './types';

export default class HabitTrackerPlugin extends Plugin {
  settings: { habitsFilePath: string; todayViewDays: number; keepDeletedData: boolean; emptyTableDetection: 'onload' | 'onchange'; debugMode: boolean } = { habitsFilePath: DEFAULT_HABITS_FILE, todayViewDays: 7, keepDeletedData: true, emptyTableDetection: 'onload', debugMode: false };

  async onload(): Promise<void> {
    console.log('[HabitTracker] Loading plugin...');
    try {
      await this.loadSettings();
      console.log('[HabitTracker] Settings loaded');

      init(this.app, this.settings.habitsFilePath, this.settings.todayViewDays, this.settings.keepDeletedData, this.settings.emptyTableDetection, this.settings.debugMode);
      updateSettings(undefined, this.settings.keepDeletedData, this.settings.emptyTableDetection, this.settings.debugMode);
      console.log('[HabitTracker] Store initialized');

      await loadHabits();
      console.log('[HabitTracker] Habits loaded');

      this.registerView(VIEW_TYPE_HABIT_TRACKER, (leaf) => new HabitTrackerView(leaf, this));
      console.log('[HabitTracker] View registered');

      this.addRibbonIcon('calendar-check', 'Open Habit Tracker', () => this.activateView());
      console.log('[HabitTracker] Ribbon icon added');

      this.addCommand({
        id: 'open-habit-tracker',
        name: 'Open Habit Tracker',
        callback: () => this.activateView()
      });
      console.log('[HabitTracker] Command added');

      this.addSettingTab(new HabitTrackerSettingTab(this.app, this));
      console.log('[HabitTracker] Settings tab added');
    } catch (error) {
      console.error('[HabitTracker] Failed to load:', error);
      throw error;
    }
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_HABIT_TRACKER)[0];

    if (!leaf) {
      // Open in the main editor area (like Graph view)
      leaf = workspace.getLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_HABIT_TRACKER, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async refreshView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HABIT_TRACKER);
    for (const leaf of leaves) {
      const view = leaf.view as HabitTrackerView;
      await view.render();
    }
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = {
      habitsFilePath: data?.habitsFilePath || DEFAULT_HABITS_FILE,
      todayViewDays: data?.todayViewDays ?? 7,
      keepDeletedData: data?.keepDeletedData ?? true,
      emptyTableDetection: data?.emptyTableDetection ?? 'onload',
      debugMode: data?.debugMode ?? false
    };
  }

  async saveSettings(): Promise<void> {
    await super.saveData(this.settings);
  }

  getState() { return getState(); }
  async loadHabits() { await loadHabits(); this.refreshView(); }
  toggleDay(habitName: string, date: string) { toggleDay(habitName, date); }
  addHabit(habit: Habit) { addHabit(habit); this.refreshView(); }
  renameHabit(oldName: string, newName: string) { renameHabit(oldName, newName); this.refreshView(); }
  deleteHabit(habitName: string, keepData?: boolean) { deleteHabit(habitName, keepData); this.refreshView(); }
  updateHabitDetails(name: string, icon: string, color: string, frequency: string, streakMode: string, specificDays?: string[]) {
    setHabitColor(name, color);
    this.refreshView();
  }
  getHabit(name: string) { return getState().habits.find(h => h.name === name); }
  setViewType(viewType: string) { setViewType(viewType as any); this.refreshView(); }
  setSelectedHabit(habitName: string) { setSelectedHabit(habitName); this.refreshView(); }
  setSelectedMonth(month: Date) { setSelectedMonth(month); this.refreshView(); }
  setSelectedYear(year: number) { setSelectedYear(year); this.refreshView(); }
  reorderHabits(fromIndex: number, toIndex: number) { reorderHabits(fromIndex, toIndex); this.refreshView(); }

  onunload(): void {
    // Cleanup handled by store subscription management
  }
}

class HabitTrackerSettingTab extends PluginSettingTab {
  plugin: HabitTrackerPlugin;

  constructor(app: any, plugin: HabitTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('Habit Tracker').setHeading();

    new Setting(containerEl)
      .setName('Habits File Path')
      .setDesc('Path to the markdown file containing your habits (e.g., habits.md)')
      .addText(text => text
        .setPlaceholder('habits.md')
        .setValue(this.plugin.settings.habitsFilePath)
        .onChange(async (value) => {
          this.plugin.settings.habitsFilePath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Today View Days')
      .setDesc('Number of days to display in the Today view (7 or 21)')
      .addDropdown(dd => dd
        .addOptions({ 7: '7 days', 21: '21 days' })
        .setValue(String(this.plugin.settings.todayViewDays))
        .onChange(async (value) => {
          this.plugin.settings.todayViewDays = parseInt(value, 10);
          await this.plugin.saveSettings();
          updateSettings(this.plugin.settings.todayViewDays);
          await this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName('Keep data when deleting habits')
      .setDesc('When deleting a habit, keep its historical data in the file (shown with 🗑️ icon).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.keepDeletedData)
        .onChange(async (value) => {
          this.plugin.settings.keepDeletedData = value;
          await this.plugin.saveSettings();
          updateSettings(undefined, value);
        }));

    new Setting(containerEl)
      .setName('Empty table detection')
      .setDesc('On the fly → filters empty tables on every data change; Once upon reloading → only cleans up when plugin reloads (better performance)')
      .addDropdown(dd => dd
        .addOption('onchange', 'On the fly')
        .addOption('onload', 'Once upon reloading')
        .setValue(this.plugin.settings.emptyTableDetection)
        .onChange(async (value) => {
          this.plugin.settings.emptyTableDetection = value;
          await this.plugin.saveSettings();
          updateSettings(undefined, undefined, value);
        }));

    new Setting(containerEl)
      .setName('Debug mode')
      .setDesc('Print debug messages to the browser console.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
          updateSettings(undefined, undefined, undefined, value);
        }));
  }
}

