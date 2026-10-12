import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import { HabitTrackerView, VIEW_TYPE_HABIT_TRACKER } from './view';
import { init, loadHabits, toggleDay, addHabit, renameHabit, deleteHabit, setHabitColor, setViewType, setSelectedHabit, setSelectedMonth, setSelectedYear, getState, reorderHabits, updateSettings, setPlugin, restoreFromBackup, restoreHabit, isSaving } from './store';
import { startWatcher } from './storage/vaultFile';
import { RestoreDataFileModal, RestoreDeletedHabitModal, ResetDataFileModal } from './views/modals';
import { DEFAULT_HABITS_FILE } from './types';
import { BackupStore } from './storage/backup';
import type { Habit, ViewType, Frequency, StreakMode, EmptyTableDetection } from './types';
import { lintHabitsFile, isTFile } from './parser';
import { Notice } from 'obsidian';

interface PluginSettings {
  habitsFilePath: string;
  todayViewDays: number;
  keepDeletedData: boolean;
  emptyTableDetection: EmptyTableDetection;
  debugMode: boolean;
}

const EMPTY_TABLE_MODES: EmptyTableDetection[] = ['onload', 'onchange', 'manual'];

// 'manual' for fresh installs: the canonical writer leaves out data-less sections, so nothing has to
// rewrite the file on load. A user who already chose a mode keeps the value they stored.
const DEFAULT_SETTINGS: PluginSettings = { habitsFilePath: DEFAULT_HABITS_FILE, todayViewDays: 7, keepDeletedData: true, emptyTableDetection: 'manual', debugMode: false };

export default class HabitTrackerPlugin extends Plugin {
  settings!: PluginSettings;
  backups!: BackupStore;
  private stopWatcher: (() => void) | null = null;

  async onload(): Promise<void> {
    try {
      // First, so anything reading the blob during load sees a store that exists.
      this.backups = new BackupStore(() => this.readBlob(), async (d) => { await this.writeBlob(d); });
      setPlugin(this);
      await this.loadSettings();

      init(this.app, this.settings.habitsFilePath, this.settings.todayViewDays, this.settings.keepDeletedData, this.settings.emptyTableDetection, this.settings.debugMode);
      updateSettings(undefined, this.settings.keepDeletedData, this.settings.emptyTableDetection, this.settings.debugMode);

      await loadHabits();

      this.setWatcherPath();

      this.registerView(VIEW_TYPE_HABIT_TRACKER, (leaf) => new HabitTrackerView(leaf, this));

      this.addRibbonIcon('calendar-check', 'Open Habit Tracker', () => this.activateView());

      this.addCommand({
        id: 'open-habit-tracker',
        name: 'Open Habit Tracker',
        callback: () => this.activateView()
      });

      this.addCommand({
        id: 'restore-data-file',
        name: 'Restore previous data file',
        callback: () => this.openRestoreBackupModal()
      });

      this.addCommand({
        id: 'restore-deleted-habit',
        name: 'Restore deleted habit',
        callback: () => {
          new RestoreDeletedHabitModal(this, async () => { await this.refreshView(); }).open();
        }
      });

      this.addCommand({
        id: 'clean-empty-sections',
        name: 'Clean empty month sections',
        callback: () => {
          void (async () => {
            const removed = await lintHabitsFile(this.app, this.settings.habitsFilePath);
            new Notice(removed ? 'Removed empty month sections' : 'No empty month sections found', 4000);
            await this.loadHabits();
          })();
        }
      });

      this.addSettingTab(new HabitTrackerSettingTab(this.app, this));
    } catch (error) {
      console.error('[HabitTracker] Failed to load:', error);
      throw error;
    }
  }

  /** The way back to a kept copy, shared by the command palette and the failure card. */
  openRestoreBackupModal(): void {
    new RestoreDataFileModal(this, async (stamp) => { await restoreFromBackup(stamp); }).open();
  }

  /** Show the data file in the main area, for when the right advice is to go and look at it. */
  async openDataFile(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.settings.habitsFilePath);
    if (!isTFile(file)) return;
    const leaf = this.app.workspace.getLeaf(true);
    await leaf?.openFile(file);
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
      void workspace.revealLeaf(leaf);
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
    const raw: unknown = await this.loadData();
    if (!raw) {
      this.settings = DEFAULT_SETTINGS;
      return;
    }
    const safe = raw as Partial<PluginSettings> | null;
    if (!safe) {
      this.settings = DEFAULT_SETTINGS;
      return;
    }
    this.settings = {
      habitsFilePath: safe.habitsFilePath || DEFAULT_HABITS_FILE,
      todayViewDays: safe.todayViewDays ?? 7,
      keepDeletedData: safe.keepDeletedData ?? true,
      emptyTableDetection: EMPTY_TABLE_MODES.includes(safe.emptyTableDetection as EmptyTableDetection)
        ? (safe.emptyTableDetection as EmptyTableDetection)
        : 'onload',
      debugMode: safe.debugMode ?? false
    };
  }

  async saveSettings(): Promise<void> {
    await this.writeBlob({ ...this.settings });
  }

  /**
   * The data blob holds the settings and the backup rotation, so both go through one accessor:
   * saving settings as the whole blob would drop the `backups` key along with it.
   */
  async readBlob(): Promise<Record<string, unknown> | null> {
    // loadData is typed loosely in the SDK, so it comes in as unknown and is narrowed here rather
    // than being allowed to flow on untyped through the merge below.
    const raw: unknown = await this.loadData();
    return typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  }

  async writeBlob(patch: Record<string, unknown>): Promise<void> {
    const merged = { ...await this.readBlob(), ...patch };
    await super.saveData(merged);
  }

  getState() { return getState(); }
  async loadHabits() { await loadHabits(); void this.refreshView(); }
  toggleDay(habitName: string, date: string) { toggleDay(habitName, date); }
  addHabit(habit: Habit) { addHabit(habit); void this.refreshView(); }
  renameHabit(oldName: string, newName: string) { renameHabit(oldName, newName); void this.refreshView(); }
  deleteHabit(habitName: string, keepData?: boolean) { deleteHabit(habitName, keepData); void this.refreshView(); }
  updateHabitDetails(name: string, icon: string, color: string, frequency: Frequency, streakMode: StreakMode, specificDays?: string[]) {
    setHabitColor(name, color);
    void this.refreshView();
  }
  getHabit(name: string): Habit | undefined { return getState().habits.find(h => h.name === name); }
  setViewType(viewType: ViewType) {
    setViewType(viewType);
    void this.refreshView();
  }
  setSelectedHabit(habitName: string) { setSelectedHabit(habitName); void this.refreshView(); }
  setSelectedMonth(month: Date) { setSelectedMonth(month); void this.refreshView(); }
  setSelectedYear(year: number) { setSelectedYear(year); void this.refreshView(); }
  reorderHabits(fromIndex: number, toIndex: number) { reorderHabits(fromIndex, toIndex); void this.refreshView(); }

  restoreHabit(name: string) { restoreHabit(name); void this.refreshView(); }

  /**
   * (Re)attaches the vault watcher for the current data file path. A settings change to the path has
   * to come through here, or the old listener keeps watching a file the plugin no longer uses.
   */
  setWatcherPath(): void {
    this.stopWatcher?.();
    this.stopWatcher = startWatcher(this.app, this.settings.habitsFilePath, {
      onExternalEdit: () => { void this.loadHabits(); },
      isBusy: () => isSaving()
    });
  }

  onunload(): void {
    this.stopWatcher?.();
    this.stopWatcher = null;
    // Remaining cleanup is handled by store subscription management
  }
}

class HabitTrackerSettingTab extends PluginSettingTab {
  plugin: HabitTrackerPlugin;

  constructor(app: App, plugin: HabitTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('Habit Tracker').setHeading();
    this.rowHabitsFilePath(new Setting(containerEl));
    this.rowTodayViewDays(new Setting(containerEl));
    this.rowKeepDeletedData(new Setting(containerEl));
    this.rowEmptyTableDetection(new Setting(containerEl));
    this.rowDebugMode(new Setting(containerEl));
    this.rowResetDataFile(new Setting(containerEl));
  }

  /**
   * Declared for 1.13.0 and later, where the framework renders settings itself and builds the settings
   * search from these definitions: leave them out and a user searching for one of these rows never finds it,
   * because display() is opaque to that index. The rows come from the very builders display() uses, so the
   * indexed text and the rendered control cannot drift apart.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      items: [
        {
          name: 'Habits File Path',
          desc: 'Path to the markdown file containing your habits (e.g., habits.md)',
          aliases: ['data file', 'habits.md', 'tracker file'],
          render: (setting) => this.rowHabitsFilePath(setting)
        },
        {
          name: 'Today View Days',
          desc: 'Number of days to display in the Today view (7 or 21)',
          aliases: ['days shown', 'today view'],
          render: (setting) => this.rowTodayViewDays(setting)
        },
        {
          name: 'Keep data when deleting habits',
          desc: 'When deleting a habit, keep its historical data in the file (shown with 🗑️ icon).',
          aliases: ['archive', 'delete habit', 'history'],
          render: (setting) => this.rowKeepDeletedData(setting)
        },
        {
          name: 'Empty table detection',
          desc: 'On the fly → filters empty tables on every data change; Once upon reloading → only cleans up when plugin reloads; Manually → nothing is removed until you run Clean empty month sections',
          aliases: ['empty month', 'clean up', 'lint', 'sections'],
          render: (setting) => this.rowEmptyTableDetection(setting)
        },
        {
          name: 'Debug mode',
          desc: 'Print debug messages to the browser console.',
          aliases: ['verbose', 'developer'],
          render: (setting) => this.rowDebugMode(setting)
        },
        {
          name: 'Reset the data file',
          desc: 'Moves the current data file to the trash and starts a fresh one. Your habits and history are deleted.',
          aliases: ['delete data', 'start over', 'trash'],
          render: (setting) => this.rowResetDataFile(setting)
        }
      ]
    }];
  }

  /**
   * The rows below each render into the Setting handed them, which is what lets display() and the
   * declarative definitions above share one source. Each keeps its own change handler, since a change to
   * any of them has to reach the store as well as the file.
   */
  private rowHabitsFilePath(setting: Setting): void {
    setting
      .setName('Habits File Path')
      .setDesc('Path to the markdown file containing your habits (e.g., habits.md)')
      .addText(text => text
        .setPlaceholder('habits.md')
        .setValue(this.plugin.settings.habitsFilePath)
        .onChange(async (value) => {
          this.plugin.settings.habitsFilePath = value;
          await this.plugin.saveSettings();
          // The watcher has to follow the path, or it keeps watching the file the plugin left behind.
          this.plugin.setWatcherPath();
        }));
  }

  private rowTodayViewDays(setting: Setting): void {
    setting
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
  }

  private rowKeepDeletedData(setting: Setting): void {
    setting
      .setName('Keep data when deleting habits')
      .setDesc('When deleting a habit, keep its historical data in the file (shown with 🗑️ icon).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.keepDeletedData)
        .onChange(async (value) => {
          this.plugin.settings.keepDeletedData = value;
          await this.plugin.saveSettings();
          updateSettings(undefined, value);
        }));
  }

  private rowEmptyTableDetection(setting: Setting): void {
    setting
      .setName('Empty table detection')
      .setDesc('On the fly → filters empty tables on every data change; Once upon reloading → only cleans up when plugin reloads (better performance); Manually → nothing is removed until you run Clean empty month sections')
      .addDropdown(dd => dd
        .addOption('onchange', 'On the fly')
        .addOption('onload', 'Once upon reloading')
        .addOption('manual', 'Manually')
        .setValue(this.plugin.settings.emptyTableDetection)
        .onChange(async (value) => {
          const detectionValue = value as EmptyTableDetection;
          this.plugin.settings.emptyTableDetection = detectionValue;
          await this.plugin.saveSettings();
          updateSettings(undefined, undefined, detectionValue);
        }));
  }

  private rowDebugMode(setting: Setting): void {
    setting
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

  // The destructive path, moved here from the error card where it sat in front of someone whose data
  // had just failed to load. It goes through the file manager to the trash, so the platform keeps a
  // way back, and cannot be confirmed without typing the file name.
  private rowResetDataFile(setting: Setting): void {
    setting
      .setName('Reset the data file')
      .setDesc('Moves the current data file to the trash and starts a fresh one. Your habits and history are deleted.')
      .addButton(btn => btn.setButtonText('Reset…').setDestructive().onClick(() => {
        new ResetDataFileModal(this.app, this.plugin, async () => {
          const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.habitsFilePath);
          if (isTFile(file)) await this.app.fileManager.trashFile(file);
          await this.plugin.loadHabits();
          await this.plugin.refreshView();
        }).open();
      }));
  }
}

