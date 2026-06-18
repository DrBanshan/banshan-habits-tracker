import * as yaml from 'yaml';
import { App, TAbstractFile, TFile } from 'obsidian';
import type { Tracker, Habit, CompletionMap, CompletionStatus } from './types';

function isTFile(file: TAbstractFile | null): file is TFile {
  if (!file) return false;
  return file instanceof TFile;
}
import { DEFAULT_HABITS_FILE } from './types';

interface RawYaml {
  name: string;
  created: string;
  habits: Array<{
    name: string;
    icon: string;
    frequency: string;
    specificDays?: string[];
    streakMode: string;
    startDate: string;
    color?: string;
  }>;
}

function stripIcon(text: string): string {
  return text.replace(/[\u{100}-\u{10FFFF}]+\s*/u, '');
}

function parseHabit(raw: RawYaml['habits'][0]): Habit {
  return {
    name: raw.name,
    icon: raw.icon,
    frequency: (raw.frequency as Habit['frequency']) || 'daily',
    specificDays: raw.specificDays,
    streakMode: (raw.streakMode as Habit['streakMode']) || 'strict',
    startDate: raw.startDate,
    color: raw.color || '#0A84FF'
  };
}

function convertToISODate(dateStr: string): string {
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  
  // Old format: "Mon 6/12" or "Mon 06/12"
  const match = dateStr.match(/^[A-Za-z]+\s+(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const year = new Date().getFullYear();
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
  }
  
  // Unknown format, return as-is
  return dateStr;
}

/**
 * Parse a multi-section tracker file.
 * Sections are separated by ## headers. Each section contains a markdown table.
 * The first section is the current month, subsequent sections are previous months.
 */
export function parseTrackerFile(content: string): Tracker | null {
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!yamlMatch) return null;

  let raw: RawYaml;
  try {
    raw = yaml.parse(yamlMatch[1]) as RawYaml;
  } catch {
    return null;
  }

  if (!raw || !raw.habits || raw.habits.length === 0) return null;

  const habits = raw.habits.map(parseHabit);
  const completions: CompletionMap = {};
  for (const habit of habits) {
    completions[habit.name] = {};
  }

  const lines = content.split('\n');
  
  // Find all section headers (## Month Year format)
  const sectionHeaders: { index: number; header: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('## ')) {
      sectionHeaders.push({ index: i, header: trimmed });
    }
  }

  // Parse each section
  const tableRanges: { start: number; end: number }[] = [];
  for (let i = 0; i < sectionHeaders.length; i++) {
    const start = sectionHeaders[i].index;
    const end = i + 1 < sectionHeaders.length ? sectionHeaders[i + 1].index : lines.length;
    tableRanges.push({ start, end });
  }

  // If no section headers found, treat entire content after YAML as one table (legacy format)
  if (tableRanges.length === 0) {
    let tableStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('|') && !lines[i].trim().startsWith('|---')) {
        tableStart = i;
        break;
      }
    }
    if (tableStart !== -1) {
      parseTableSection(lines, tableStart, lines.length, habits, completions);
    }
  } else {
    for (const range of tableRanges) {
      parseTableSection(lines, range.start, range.end, habits, completions);
    }
  }

  return {
    name: raw.name,
    created: raw.created,
    habits,
    completions
  };
}

function parseTableSection(
  lines: string[],
  start: number,
  end: number,
  habits: Habit[],
  completions: CompletionMap
): void {
  let tableStart = -1;
  for (let i = start; i < end; i++) {
    if (lines[i].trim().startsWith('|') && !lines[i].trim().startsWith('|---')) {
      tableStart = i;
      break;
    }
  }

  if (tableStart === -1) return;

  const headerRow = lines[tableStart].trim();
  const headers = headerRow.split('|').map(h => h.trim()).filter(h => h && h !== 'Habit');

  for (let i = tableStart + 2; i < end; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;

    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 2) continue;

    const habitName = stripIcon(cells[1]);
    for (let j = 2; j < cells.length; j++) {
      let date = headers[j - 2] || '';
      date = convertToISODate(date);
      const rawStatus = cells[j];
      const status: CompletionStatus = rawStatus === '✓' ? 'completed' : rawStatus === '✗' ? 'missed' : 'unmarked';
      // Only store non-unmarked statuses — empty cells don't count as data
      if (completions[habitName] && status !== 'unmarked') {
        completions[habitName][date] = status;
      }
    }
  }
}

/**
 * Find months that have any data for any habit.
 * Returns sorted array of { year, month } objects.
 */
function findMonthsWithData(completions: CompletionMap): Array<{ year: number; month: number }> {
  const monthSet = new Set<string>();
  
  for (const habitName in completions) {
    const entries = completions[habitName];
    for (const dateStr in entries) {
      const status = entries[dateStr];
      // Only count months with actual data (completed or missed), not unmarked
      if (status === 'completed' || status === 'missed') {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
          const year = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          monthSet.add(`${year}-${month}`);
        }
      }
    }
  }
  
  const result: Array<{ year: number; month: number }> = [];
  for (const key of monthSet) {
    const [year, month] = key.split('-').map(Number);
    result.push({ year, month });
  }
  
  // Sort by year desc, then month desc
  result.sort((a, b) => b.year - a.year || b.month - a.month);
  return result;
}

/**
 * Generate tracker content with only months that have data.
 * Current month is always included. Each month's table only includes
 * habits that have data in that specific month.
 */
/**
 * Generate tracker content.
 * @param filterEmptyMonths - If true, only write months with actual data. If false, write all months from earliest data to current month.
 */
export function generateTrackerContent(tracker: Tracker, daysToShow: number = 21, filterEmptyMonths: boolean = true): string {
  const yamlContent = yaml.stringify({
      name: tracker.name,
      created: tracker.created,
      habits: tracker.habits.map(h => ({
        name: h.name,
        icon: h.icon,
        frequency: h.frequency,
        specificDays: h.specificDays,
        streakMode: h.streakMode,
        startDate: h.startDate,
        color: h.color
      }))
    });

  const lines: string[] = [];
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();

  let allMonths: Array<{ year: number; month: number }>;

  if (filterEmptyMonths) {
    // Only write months with actual data, plus current month
    const monthsWithData = findMonthsWithData(tracker.completions);
    const monthSet = new Set(monthsWithData.map(m => `${m.year}-${m.month}`));
    monthSet.add(`${currentYear}-${currentMonth}`);
    allMonths = Array.from(monthSet).map(key => {
      const [year, month] = key.split('-').map(Number);
      return { year, month };
    });
    allMonths.sort((a, b) => b.year - a.year || b.month - a.month);
  } else {
    // Write all months from earliest data month to current month
    const monthsWithData = findMonthsWithData(tracker.completions);
    if (monthsWithData.length === 0) {
      // No data at all, just write current month
      allMonths = [{ year: currentYear, month: currentMonth }];
    } else {
      const minYear = Math.min(...monthsWithData.map(m => m.year));
      const minMonth = monthsWithData.filter(m => m.year === minYear).reduce((a, b) => Math.min(a, b.month), 11);
      allMonths = [];
      for (let year = currentYear; year >= minYear; year--) {
        const startMonth = year === currentYear ? currentMonth : 11;
        const endMonth = year === minYear ? minMonth - 1 : -1;
        for (let month = startMonth; month > endMonth; month--) {
          allMonths.push({ year, month });
        }
      }
    }
  }

  for (const { year, month } of allMonths) {
    const monthDates = generateMonthDates(year, month);
    
    // Find habits that have data in this month
    let activeHabits: Habit[];
    if (filterEmptyMonths) {
      // Only include habits with data in this month
      activeHabits = tracker.habits.filter(h => {
        const habitDates = Object.keys(tracker.completions[h.name] || {});
        return habitDates.some(d => {
          const parts = d.split('-');
          return parseInt(parts[0], 10) === year && (parseInt(parts[1], 10) - 1) === month;
        });
      });

      // Also include deleted habits that have data in this month
      if (tracker.deletedHabits) {
        for (const dh of tracker.deletedHabits) {
          const habitDates = Object.keys(tracker.completions[dh.name] || {});
          const hasData = habitDates.some(d => {
            const parts = d.split('-');
            return parseInt(parts[0], 10) === year && (parseInt(parts[1], 10) - 1) === month;
          });
          if (hasData) {
            activeHabits.push({
              name: dh.name,
              icon: '🗑️',
              frequency: 'daily' as const,
              streakMode: 'strict' as const,
              startDate: '',
              color: '#999999'
            });
          }
        }
      }

      if (activeHabits.length === 0) continue;
    } else {
      // Write all months with all habits (even if no data in this specific month)
      activeHabits = [...tracker.habits];
    }

    lines.push(`## ${getMonthName(month)} ${year}`);
    lines.push(`| Habit | ${monthDates.join(' | ')} |`);
    lines.push(`| ${Array(monthDates.length + 1).fill('---').join(' | ')} |`);

    for (const habit of activeHabits) {
      const cells = [`${habit.icon} ${habit.name}`];
      for (const date of monthDates) {
        const status = tracker.completions[habit.name]?.[date];
        cells.push(status === 'completed' ? '✓' : status === 'missed' ? '✗' : '');
      }
      lines.push(`| ${cells.join(' | ')} |`);
    }
  }

  return `---\n${yamlContent}---\n\n` + lines.join('\n') + '\n';
}

function generateMonthDates(year: number, month: number): string[] {
  const dates: string[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${dd}`);
  }
  return dates;
}

function getMonthName(month: number): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month];
}

export async function readTrackerFile(app: App, path: string): Promise<Tracker | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!isTFile(file)) return null;
  const content = await app.vault.read(file);
  return parseTrackerFile(content);
}

/**
 * Build a month section string for the given year/month and habits.
 */
function buildMonthSection(tracker: Tracker, year: number, month: number): string {
  const monthDates = generateMonthDates(year, month);
  const lines: string[] = [];

  lines.push(`## ${getMonthName(month)} ${year}`);
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
  console.log('[HabitTracker] writeTrackerFile START path=' + path + ' filterEmptyMonths=' + filterEmptyMonths + ' affectedDate=' + (affectedDate || 'none'));
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
  console.log('[HabitTracker] writeTrackerFile abstractFile=' + (abstractFile ? abstractFile.name : 'null') + ' type=' + (abstractFile ? abstractFile.constructor.name : 'null') + ' isTFile=' + isTFile(abstractFile));
  if (isTFile(abstractFile)) {
    content = await app.vault.read(abstractFile as TFile);
  } else {
    // File doesn't exist yet - generate full content
    content = generateTrackerContent(tracker, daysToShow, filterEmptyMonths);
    await app.vault.create(path, content);
    return;
  }

  const lines = content.split('\n');

  const targetHeader = `## ${getMonthName(writeMonth)} ${writeYear}`;

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

  await app.vault.modify(abstractFile as TFile, content);
}

/**
 * Lint the habits file: remove month sections that have no data in any row.
 * Returns true if the file was modified.
 */
export async function lintHabitsFile(app: App, path: string): Promise<boolean> {
  let content: string;
  // Try vault read first (Obsidian-indexed), fall back to adapter (raw filesystem)
  const file = app.vault.getAbstractFileByPath(path);
  let targetFile: TFile | null = isTFile(file) ? (file as TFile) : null;
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
  if (targetFile) {
    await app.vault.modify(targetFile, newContent);
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
