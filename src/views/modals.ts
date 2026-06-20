import { App, ColorComponent, Modal, Setting } from 'obsidian';
import type { TextComponent } from 'obsidian';
import type HabitTrackerPlugin from '../main';
import { DEFAULT_COLORS } from '../types';
import type { Frequency, StreakMode } from '../types';

export class AddHabitModal extends Modal {
  plugin: HabitTrackerPlugin;
  onSubmit: () => Promise<void>;

  constructor(app: App, plugin: HabitTrackerPlugin, onSubmit: () => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Add Habit' });

    let name = '';
    let icon = '🏃';
    let color = DEFAULT_COLORS[0];
    let frequency: Frequency = 'daily';
    let streakMode: StreakMode = 'strict';
    let specificDays: string[] = [];
    let textInput: TextComponent | undefined;

    const emojiContainer = contentEl.createDiv({ cls: 'habit-icon-picker' });
    const EMOJI_OPTIONS = ['🏃', '📖', '💧', '🧘', '💪', '🥗', '😴', '✍️', '🎵', '💊', '🌅', '🚶', '🏋️', '📝', '🧹'];
    EMOJI_OPTIONS.forEach(emoji => {
      const btn = emojiContainer.createEl('button', { cls: 'emoji-option', text: emoji });
      btn.addEventListener('click', () => {
        icon = emoji;
        emojiContainer.querySelectorAll('.emoji-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        if (textInput !== undefined) textInput.setValue(icon);
      });
    });

    const specificDaysSetting = new Setting(contentEl)
      .setName('Days')
      .addText(text => {
        text.setPlaceholder('Mon,Wed,Fri').onChange(v => specificDays = v.split(',').map(d => d.trim()));
      });
    specificDaysSetting.settingEl.addClass('habit-dynamic-display');

    new Setting(contentEl)
      .setName('Name')
      .addText(text => text
        .setPlaceholder('e.g., Exercise, Read')
        .onChange(v => name = v)
        .inputEl.addEventListener('keypress', e => { if (e.key === 'Enter') this.submit(name, icon, color, frequency, streakMode, specificDays); }));

    const textSetting = new Setting(contentEl)
      .setName('Icon (emoji)')
      .addText(text => {
        textInput = text.setValue(icon).onChange(v => icon = v);
        text.inputEl.addClass('habit-text-input');
      });
    textSetting.settingEl.addClass('habit-text-setting');

    // Color picker with label
    let currentColor = color;
    const colorSetting = new Setting(contentEl).setName('Color:');
    let colorPickerRef: ColorComponent | undefined;
    colorSetting.addColorPicker(cb => {
      cb.setValue(currentColor);
      colorPickerRef = cb;
    });
    if (colorPickerRef) {
      colorPickerRef.onChange((value) => {
        currentColor = value;
        color = value;
      });
    }

    new Setting(contentEl)
      .setName('Frequency')
      .addDropdown(dd => dd.addOptions({ daily: 'Daily', weekly: 'Weekly', specific: 'Specific' }).setValue('daily').onChange(v => {
        frequency = v as Frequency;
        specificDaysSetting.settingEl.toggleClass('show', frequency === 'specific');
      }));

    new Setting(contentEl)
      .setName('Streak Mode')
      .addDropdown(dd => dd.addOptions({ strict: 'Strict', forgiving: 'Forgiving' }).setValue('strict').onChange(v => streakMode = v as StreakMode));

    const btnRow = contentEl.createDiv({ cls: 'modal-button-row' });
    const addBtn = btnRow.createEl('button', { text: 'Add', cls: 'modal-btn modal-btn-cta' });
    addBtn.addEventListener('click', () => this.submit(name, icon, color, frequency, streakMode, specificDays));
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'modal-btn' });
    cancelBtn.addEventListener('click', () => this.close());
  }

  submit(name: string, icon: string, color: string, frequency: Frequency, streakMode: StreakMode, specificDays: string[]) {
    if (!name.trim()) return;
    this.plugin.addHabit({
      name: name.trim(),
      icon,
      frequency,
      streakMode,
      startDate: new Date().toISOString().split('T')[0],
      color,
      ...(frequency === 'specific' && specificDays.length > 0 ? { specificDays } : {})
    });
    this.close();
    void this.onSubmit();
  }
}

export class EditHabitModal extends Modal {
  plugin: HabitTrackerPlugin;
  habitName: string;
  onSubmit: () => Promise<void>;

  constructor(app: App, plugin: HabitTrackerPlugin, habitName: string, onSubmit: () => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.habitName = habitName;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Edit Habit' });

    const habit = this.plugin.getHabit(this.habitName);
    if (!habit) return;

    let name = habit.name;
    let icon = habit.icon;
    let color = habit.color;
    let frequency: Frequency = habit.frequency;
    let streakMode: StreakMode = habit.streakMode;
    let specificDays: string[] = habit.specificDays || [];
    let textInput: TextComponent | undefined;

    const emojiContainer = contentEl.createDiv({ cls: 'habit-icon-picker' });
    const EMOJI_OPTIONS = ['🏃', '📖', '💧', '🧘', '💪', '🥗', '😴', '✍️', '🎵', '💊', '🌅', '🚶', '🏋️', '📝', '🧹'];
    EMOJI_OPTIONS.forEach(emoji => {
      const btn = emojiContainer.createEl('button', { cls: 'emoji-option', text: emoji });
      btn.addEventListener('click', () => {
        icon = emoji;
        emojiContainer.querySelectorAll('.emoji-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        if (textInput !== undefined) textInput.setValue(icon);
      });
    });

    new Setting(contentEl)
      .setName('Name')
      .addText(text => text.setValue(name).onChange(v => name = v));

    const textSetting = new Setting(contentEl)
      .setName('Icon (emoji)')
      .addText(text => {
        textInput = text.setValue(icon).onChange(v => icon = v);
        text.inputEl.addClass('habit-text-input');
      });
    textSetting.settingEl.addClass('habit-text-setting');

    // Color picker with label
    let currentColor = color;
    const colorSetting2 = new Setting(contentEl).setName('Color:');
    let colorPickerRef2: ColorComponent | undefined;
    colorSetting2.addColorPicker(cb => {
      cb.setValue(currentColor);
      colorPickerRef2 = cb;
    });
    if (colorPickerRef2) {
      colorPickerRef2.onChange((value) => {
        currentColor = value;
        color = value;
      });
    }

    new Setting(contentEl)
      .setName('Frequency')
      .addDropdown(dd => dd.addOptions({ daily: 'Daily', weekly: 'Weekly', specific: 'Specific' }).setValue(frequency).onChange(v => { frequency = v as Frequency; this.onFrequencyChange(); }));

    const daysSetting = contentEl.createDiv({ cls: 'habit-dynamic-display' });
    const daysText = daysSetting.createEl('input', { type: 'text' });
    daysText.placeholder = 'Mon,Wed,Fri';
    daysText.value = specificDays.join(',');
    daysText.addEventListener('input', () => specificDays = daysText.value.split(',').map(d => d.trim()));

    this.onFrequencyChange = () => {
      daysSetting.toggleClass('show', frequency === 'specific');
    };

    new Setting(contentEl)
      .setName('Streak Mode')
      .addDropdown(dd => dd.addOptions({ strict: 'Strict', forgiving: 'Forgiving' }).setValue(streakMode).onChange(v => streakMode = v as StreakMode));

    const btnRow2 = contentEl.createDiv({ cls: 'modal-button-row' });
    const saveBtn = btnRow2.createEl('button', { text: 'Save', cls: 'modal-btn modal-btn-cta' });
    saveBtn.addEventListener('click', () => {
      if (name.trim() && name !== this.habitName) {
        this.plugin.renameHabit(this.habitName, name.trim());
      }
      if (name.trim() && name === this.habitName) {
        this.plugin.updateHabitDetails(name.trim(), icon, color, frequency, streakMode, specificDays);
      }
      this.close();
      void this.onSubmit();
    });
    const cancelBtn2 = btnRow2.createEl('button', { text: 'Cancel', cls: 'modal-btn' });
    cancelBtn2.addEventListener('click', () => this.close());
  }

  onFrequencyChange: () => void = () => {};
}

export class DeleteHabitModal extends Modal {
  plugin: HabitTrackerPlugin;
  habitName: string;
  onSubmit: () => Promise<void>;

  constructor(app: App, plugin: HabitTrackerPlugin, habitName: string, onSubmit: () => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.habitName = habitName;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Delete Habit' });
    contentEl.createEl('p', { text: `Are you sure you want to delete "${this.habitName}"?` });

    let keepData = this.plugin.getState().keepDeletedData ?? true;
    new Setting(contentEl)
      .setName('Keep progress data')
      .setDesc('If enabled, historical data is kept in the file but the habit is removed from active lists.')
      .addToggle(toggle => toggle.setValue(keepData).onChange(v => { keepData = v; }));

    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('Delete').setWarning().onClick(async () => {
        this.plugin.deleteHabit(this.habitName, keepData);
        this.close();
        await this.onSubmit();
      }))
      .addButton(btn => btn.setButtonText('Cancel').onClick(() => this.close()));
  }
}
