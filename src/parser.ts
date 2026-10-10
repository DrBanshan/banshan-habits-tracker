import * as yaml from 'yaml';
import type { App, TAbstractFile, TFile } from 'obsidian';
import type { Tracker } from './types';
import { DEFAULT_HABITS_FILE } from './types';
import { emptyDoc, normalizeDoc } from './model/tracker';
import { deserialize } from './storage/deserialize';
import { serialize } from './storage/serialize';
import { buildMonthHeader, daysOfMonth } from './storage/format';

// Runtime-safe check for TFile without requiring the obsidian package at build time
function isTFileType(file: TAbstractFile | null): boolean {
  if (!file) return false;
  // In Obsidian, TFile instances have constructor name 'TFile'; in tests they won't
  return file.constructor.name === 'TFile';
}

export function isTFile(file: TAbstractFile | null): file is TFile {
  return isTFileType(file);
}

/**
 * Read a habits file through the tolerant reader, so every existing call site gains the
 * table-only merge and the no-loss guarantees without changing.
 */
export function parseTrackerFile(content: string): Tracker | null {
  const { doc, failure } = deserialize(content);
  if (!doc || failure) return null;
  return { name: doc.name, created: doc.created, habits: doc.habits, completions: doc.completions };
}

/**
 * Author a whole habits file from one document. `daysToShow` and `filterEmptyMonths` stay in the
 * signature for call-site compatibility; the writer decides which months deserve a section.
 */
export function generateTrackerContent(tracker: Tracker, daysToShow = 21, filterEmptyMonths = true): string {
  return serialize(normalizeDoc({
    ...emptyDoc(tracker.name), created: tracker.created,
    habits: tracker.habits, completions: tracker.completions
  }));
}


export async function readTrackerFile(app: App, path: string): Promise<Tracker | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!isTFile(file)) return null;
  const content = await app.vault.read(file);
  return parseTrackerFile(content);
}

/**
 * Build a month section string for the given year/month and habits. Used only by the legacy
 * single-section write path in writeTrackerFile, which Task 7 retires.
 */
function buildMonthSection(tracker: Tracker, year: number, month: number): string {
  const monthDates = daysOfMonth(year, month);
  const lines: string[] = [];

  lines.push(buildMonthHeader(year, month));
  lines.push(`| Habit | ${monthDates.join(' | ')} |`);
  lines.push(`| ${Array(monthDates.length + 1).fill('---').join(' | ')} |`);

  for (const habit of tracker.habits) {
    const cells = [`${habit.icon} ${habit.name}`];
    for (const date of monthDates) {
      const status = tracker.completions[habit.name]?.[date];
      cells.push(status === 'completed' ? '✓' : status === 'missed' ? '✗' : '');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}

export async function writeTrackerFile(app: App, path: string, tracker: Tracker, daysToShow: number = 21, filterEmptyMonths: boolean = true, affectedDate?: string): Promise<void> {
  const { isDebug } = await import('./store');
  if (isDebug()) console.log('[HabitTracker] writeTrackerFile filterEmptyMonths=' + filterEmptyMonths + ' affectedDate=' + (affectedDate || 'none'));

  // Determine which month to write
  let writeYear: number;
  let writeMonth: number;

  if (affectedDate) {
    const parts = affectedDate.split('-');
    writeYear = parseInt(parts[0], 10);
    writeMonth = parseInt(parts[1], 10) - 1;
  } else {
    const today = new Date();
    writeYear = today.getFullYear();
    writeMonth = today.getMonth();
  }

  // Read existing file
  let content: string;
  const abstractFile = app.vault.getAbstractFileByPath(path);
  if (!isTFile(abstractFile)) {
    // File doesn't exist yet - generate full content
    content = generateTrackerContent(tracker, daysToShow, filterEmptyMonths);
    await app.vault.adapter.write(path, content);
    return;
  }
  const file = abstractFile; // narrowed to TFile by isTFile guard
  content = await app.vault.read(file);

  const lines = content.split('\n');

  const targetHeader = buildMonthHeader(writeYear, writeMonth);

  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === targetHeader) {
      headerIndex = i;
      break;
    }
  }

  // Build the new month section
  const newSection = buildMonthSection(tracker, writeYear, writeMonth);

  if (headerIndex !== -1) {
    // Replace existing section: find its end
    let sectionEnd = lines.length;
    for (let i = headerIndex + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('## ')) {
        sectionEnd = i;
        break;
      }
    }
    // Replace the old section with the new one
    const before = lines.slice(0, headerIndex);
    const after = lines.slice(sectionEnd);
    content = [...before, newSection, ...after].join('\n');
  } else {
    // No existing section - append before any existing month sections or at end
    let insertIndex = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('## ')) {
        insertIndex = i;
        break;
      }
    }
    const before = lines.slice(0, insertIndex);
    const after = lines.slice(insertIndex);
    content = [...before, newSection, ...after].join('\n');
  }

  // If filterEmptyMonths is on, also remove empty sections
  if (isDebug()) console.log('[HabitTracker] writeTrackerFile filterEmptyMonths=' + filterEmptyMonths);
  if (filterEmptyMonths) {
    const updatedLines = content.split('\n');
    const sectionHeaders: { index: number; header: string }[] = [];
    for (let i = 0; i < updatedLines.length; i++) {
      const trimmed = updatedLines[i].trim();
      if (trimmed.startsWith('## ')) {
        sectionHeaders.push({ index: i, header: trimmed });
      }
    }

    const sectionsToRemove: number[] = [];
    for (let i = 0; i < sectionHeaders.length; i++) {
      const start = sectionHeaders[i].index;
      const end = i + 1 < sectionHeaders.length ? sectionHeaders[i + 1].index : updatedLines.length;

      let hasData = false;
      for (let j = start + 1; j < end && !hasData; j++) {
        const line = updatedLines[j];
        if (!line.trim().startsWith('|')) continue;
        const trimmedLine = line.trim();
        if (trimmedLine.includes('---') || trimmedLine.includes('| Habit')) continue;
        const cells = line.split('|');
        for (let k = 2; k < cells.length && !hasData; k++) {
          if (cells[k].trim().length > 0) {
            hasData = true;
          }
        }
      }
      if (!hasData) sectionsToRemove.push(i);
    }

    if (sectionsToRemove.length > 0) {
      const finalLines = [...updatedLines];
      for (const idx of sectionsToRemove.reverse()) {
        const start = sectionHeaders[idx].index;
        const end = idx + 1 < sectionHeaders.length
          ? sectionHeaders[idx + 1].index
          : updatedLines.length;
        finalLines.splice(start, end - start);
      }
      content = finalLines.join('\n');
    }
  }

  await app.vault.modify(file, content);
}

/**
 * Lint the habits file: remove month sections that have no data in any row.
 * Returns true if the file was modified.
 */
export async function lintHabitsFile(app: App, path: string): Promise<boolean> {
  let content: string;
  // Try vault read first (Obsidian-indexed), fall back to adapter (raw filesystem)
  const file = app.vault.getAbstractFileByPath(path);
  if (isTFile(file)) {
    content = await app.vault.read(file);
  } else {
    try {
      content = await app.vault.adapter.read(path);
    } catch {
      return false;
    }
  }
  const lines = content.split('\n');

  // Find all section headers
  const sectionHeaders: { index: number; header: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('## ')) {
      sectionHeaders.push({ index: i, header: trimmed });
    }
  }

  if (sectionHeaders.length === 0) return false;

  // For each section, check if any row has a non-empty cell (excluding the Habit column)
  const sectionsToRemove: number[] = [];

  for (let i = 0; i < sectionHeaders.length; i++) {
    const start = sectionHeaders[i].index;
    const end = i + 1 < sectionHeaders.length ? sectionHeaders[i + 1].index : lines.length;

    let hasData = false;
    for (let j = start + 1; j < end && !hasData; j++) {
      const line = lines[j];
      if (!line.trim().startsWith('|')) continue;
      // Skip header and separator rows
      const trimmedLine = line.trim();
      if (trimmedLine.includes('---') || trimmedLine.includes('| Habit')) continue;
      
      // Check if this data row has any non-empty, non-whitespace cell after the habit name column
      const cells = line.split('|');
      for (let k = 2; k < cells.length && !hasData; k++) {
        const cellContent = cells[k].trim();
        if (cellContent.length > 0) {
          hasData = true;
        }
      }
    }

    console.log('[HabitTracker] Lint: section=' + sectionHeaders[i].header + ' hasData=' + hasData);

    if (!hasData) {
      sectionsToRemove.push(i);
    }
  }

  if (sectionsToRemove.length === 0) return false;

  // Remove empty sections in reverse order to preserve indices
  const newLines = [...lines];
  for (const idx of sectionsToRemove.reverse()) {
    const start = sectionHeaders[idx].index;
    const end = idx + 1 < sectionHeaders.length
      ? sectionHeaders[idx + 1].index
      : lines.length;
    
    // Remove the header line and all data lines up to next section or end
    newLines.splice(start, end - start);
    // Adjust section headers for remaining sections
    for (let h = idx; h < sectionHeaders.length; h++) {
      sectionHeaders[h].index -= (end - start);
    }
  }

  const newContent = newLines.join('\n');
  if (isTFile(file)) {
    await app.vault.modify(file, newContent);
  } else {
    await app.vault.adapter.write(path, newContent);
  }
  console.log('[HabitTracker] Lint: removed ' + sectionsToRemove.length + ' empty month section(s)');
  return true;
}

export async function ensureDefaultTracker(app: App, habitsFilePath: string = DEFAULT_HABITS_FILE): Promise<{ content: string; path: string } | null> {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 20);

  const dates: string[] = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }

  const yamlContent = yaml.stringify({
    name: 'My Habits',
    created: new Date().toISOString().split('T')[0],
    habits: [
      { name: 'Reading', icon: '📚', frequency: 'daily', streakMode: 'strict', startDate: new Date().toISOString().split('T')[0], color: '#0A84FF' },
      { name: 'Exercise', icon: '🏃', frequency: 'daily', streakMode: 'strict', startDate: new Date().toISOString().split('T')[0], color: '#26A641' }
    ]
  });

  const lines: string[] = [];
  lines.push(`| Habit | ${dates.join(' | ')} |`);
  lines.push(`| ${Array(dates.length + 1).fill('---').join(' | ')} |`);
  lines.push(`| 📚 Reading | ${Array(dates.length).fill('').join(' | ')} |`);
  lines.push(`| 🏃 Exercise | ${Array(dates.length).fill('').join(' | ')} |`);

  const content = `---\n${yamlContent}---\n\n` + lines.join('\n') + '\n';
  
  await app.vault.create(habitsFilePath, content);
  console.log('[HabitTracker] Created default tracker:', habitsFilePath);
  return { content, path: habitsFilePath };
}
