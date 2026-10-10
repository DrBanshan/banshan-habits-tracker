import * as yaml from 'yaml';
import type { TrackerDoc } from '../model/tracker';
import { CELL_DONE, CELL_MISS, DELETED_ICON, buildMonthHeader, daysOfMonth, monthKeyFor, parseMonthHeader } from './format';

export interface SerializeOptions {
  /** Existing file text; untouched month sections are copied out of it verbatim. */
  existingContent?: string;
  /** 'YYYY-MM' keys whose rendered text may differ this flush. Undefined means all months. */
  changedMonths?: Set<string>;
}


function habitToYaml(h: { name: string; icon: string; frequency: string; streakMode: string; startDate: string; color: string; specificDays?: string[] }): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: h.name, icon: h.icon, frequency: h.frequency, streakMode: h.streakMode,
    startDate: h.startDate, color: h.color
  };
  if (h.frequency === 'specific' && h.specificDays && h.specificDays.length > 0) out.specificDays = h.specificDays;
  return out;
}

function buildFrontmatter(doc: TrackerDoc): string {
  const canonical: Record<string, unknown> = {
    formatVersion: doc.formatVersion,
    name: doc.name,
    created: doc.created,
    habits: doc.habits.map(habitToYaml)
  };
  if (doc.deletedHabits.length > 0) {
    canonical.deletedHabits = doc.deletedHabits.map(d => ({ name: d.name, deletedAt: d.deletedAt }));
  }
  const merged = { ...doc.extra, ...canonical };   // canonical keys always win over preserved keys
  return yaml.stringify(merged, { lineWidth: 0 });
}

/** Habit names are free text, so a map read must not be able to land on an inherited member. */
function statusOf(doc: TrackerDoc, name: string, date: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(doc.completions, name)) return undefined;
  const cells = doc.completions[name];
  return Object.prototype.hasOwnProperty.call(cells, date) ? cells[date] : undefined;
}

function hasRow(doc: TrackerDoc, name: string, dates: string[]): boolean {
  return dates.some(date => statusOf(doc, name, date) === 'completed' || statusOf(doc, name, date) === 'missed');
}

function monthsWithData(doc: TrackerDoc): Set<string> {
  const keys = new Set<string>();
  for (const cells of Object.values(doc.completions)) {
    for (const [date, status] of Object.entries(cells)) {
      if (status === 'completed' || status === 'missed') keys.add(monthKeyFor(date));
    }
  }
  return keys;
}

function renderSection(doc: TrackerDoc, year: number, month: number): string {
  const dates = daysOfMonth(year, month);
  const lines: string[] = [];
  lines.push(buildMonthHeader(year, month));
  lines.push(`| Habit | ${dates.join(' | ')} |`);
  lines.push(`| ${Array(dates.length + 1).fill('---').join(' | ')} |`);

  const rows = [
    ...doc.habits.map(h => ({ name: h.name, icon: h.icon })),
    ...doc.deletedHabits
      .filter(d => hasRow(doc, d.name, dates))
      .map(d => ({ name: d.name, icon: DELETED_ICON }))
  ];
  for (const row of rows) {
    const cells = [`${row.icon} ${row.name}`];
    for (const date of dates) {
      const status = statusOf(doc, row.name, date);
      cells.push(status === 'completed' ? CELL_DONE : status === 'missed' ? CELL_MISS : '');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function existingSections(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const header = parseMonthHeader(lines[i]);
    if (!header) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (parseMonthHeader(lines[j])) { end = j; break; }
    }
    out.set(monthKeyFor(`${header.year}-${String(header.month + 1).padStart(2, '0')}-01`), lines.slice(i, end).join('\n'));
  }
  return out;
}

export function serialize(doc: TrackerDoc, options: SerializeOptions = {}): string {
  const withData = monthsWithData(doc);
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const keys = new Set([...withData, currentKey]);

  const wanted = [...keys]
    .map(key => ({ key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1 }))
    .sort((a, b) => a.key < b.key ? 1 : a.key > b.key ? -1 : 0);

  const carried = options.existingContent ? existingSections(options.existingContent) : new Map<string, string>();

  const sections: string[] = [];
  for (const { key, year, month } of wanted) {
    const unchanged = options.changedMonths !== undefined && !options.changedMonths.has(key);
    const previous = carried.get(key);
    sections.push(unchanged && previous !== undefined ? previous : renderSection(doc, year, month));
  }

  return `---\n${buildFrontmatter(doc)}---\n\n${sections.join('\n')}\n`;
}
