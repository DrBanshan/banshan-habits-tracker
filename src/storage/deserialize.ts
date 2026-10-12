import * as yaml from 'yaml';
import type { CompletionStatus, Habit } from '../types';
import { emptyDoc, normalizeDoc } from '../model/tracker';
import type { TrackerDoc } from '../model/tracker';
import { CELL_DONE, CELL_MISS, SYNTHESISED_ICON, colourFor, parseMonthHeader, stripIcon, toIsoDate } from './format';

export type DeserializeFailure = 'no-frontmatter' | 'bad-yaml' | 'no-habits';

export interface DeserializeResult {
  doc: TrackerDoc | null;
  failure: DeserializeFailure | null;
  /** Names merged in from a table row that frontmatter never listed. */
  healed: string[];
}

const HABIT_KEYS = ['name', 'icon', 'frequency', 'specificDays', 'streakMode', 'startDate', 'color'];
const DOC_KEYS = ['name', 'created', 'habits', 'deletedHabits', 'formatVersion', ...HABIT_KEYS];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractFrontmatter(content: string): string | null {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  return match ? match[1] : null;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function toHabit(raw: Record<string, unknown>): Habit | null {
  const name = asString(raw.name, '');
  if (!name) return null;
  const frequency = raw.frequency === 'weekly' || raw.frequency === 'specific' ? raw.frequency : 'daily';
  const streakMode = raw.streakMode === 'forgiving' ? 'forgiving' : 'strict';
  const days = Array.isArray(raw.specificDays)
    ? raw.specificDays.filter((d): d is string => typeof d === 'string')
    : undefined;
  return {
    name,
    icon: asString(raw.icon, SYNTHESISED_ICON),
    frequency,
    ...(frequency === 'specific' && days && days.length > 0 ? { specificDays: days } : {}),
    streakMode,
    startDate: asString(raw.startDate, new Date().toISOString().split('T')[0]),
    color: asString(raw.color, colourFor(name))
  };
}

/** A habit name can be any text, so an inherited map member has to be replaced, not read. */
function cellMap(target: TrackerDoc, name: string): Record<string, CompletionStatus> {
  if (!Object.prototype.hasOwnProperty.call(target.completions, name)) target.completions[name] = {};
  return target.completions[name];
}

/** Column dates of a section, in table order, skipping unparseable headers. */
function readColumnDates(lines: string[], start: number, end: number, fallbackYear: number): { column: number; date: string }[] {
  for (let i = start; i < end; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    const cells = lines[i].trim().split('|').map(c => c.trim());
    const out: { column: number; date: string }[] = [];
    for (let j = 2; j < cells.length; j++) {
      const iso = toIsoDate(cells[j], fallbackYear);
      if (iso) out.push({ column: j, date: iso });
    }
    return out;
  }
  return [];
}

/** Sections to scan: a `## Month Year` heading, or one bare table for the pre-month-section format. */
interface Scan { start: number; end: number; fallbackYear: number }

function yearOf(created: string): number {
  const match = /^(\d{4})/.exec(created);
  const year = match ? Number(match[1]) : NaN;
  return Number.isInteger(year) && year > 0 ? year : new Date().getFullYear();
}

function scansFor(lines: string[], created: string): Scan[] {
  const scans: Scan[] = [];
  for (let s = 0; s < lines.length; s++) {
    const header = parseMonthHeader(lines[s]);
    if (!header) continue;
    let end = lines.length;
    for (let i = s + 1; i < lines.length; i++) {
      if (parseMonthHeader(lines[i])) { end = i; break; }
    }
    scans.push({ start: s + 1, end, fallbackYear: header.year });
  }
  if (scans.length > 0) return scans;

  // The format from before month sections: frontmatter then one table, no headings.
  const first = lines.findIndex(line => line.trim().startsWith('|'));
  return first === -1 ? [] : [{ start: first, end: lines.length, fallbackYear: yearOf(created) }];
}

export function deserialize(content: string): DeserializeResult {
  const fmText = extractFrontmatter(content);
  if (fmText === null) return { doc: null, failure: 'no-frontmatter', healed: [] };

  let raw: unknown;
  try {
    raw = yaml.parse(fmText);
  } catch {
    return { doc: null, failure: 'bad-yaml', healed: [] };
  }
  if (!isRecord(raw)) return { doc: null, failure: 'no-habits', healed: [] };
  if (!Array.isArray(raw.habits)) return { doc: null, failure: 'no-habits', healed: [] };

  const doc = emptyDoc(asString(raw.name, 'My Habits'));
  doc.created = asString(raw.created, new Date().toISOString().split('T')[0]);
  doc.formatVersion = typeof raw.formatVersion === 'number' ? raw.formatVersion : doc.formatVersion;

  for (const rawHabit of raw.habits) {
    if (!isRecord(rawHabit)) continue;
    const habit = toHabit(rawHabit);
    if (habit && !doc.habits.some(h => h.name === habit.name)) doc.habits.push(habit);
  }
  if (Array.isArray(raw.deletedHabits)) {
    for (const entry of raw.deletedHabits) {
      if (!isRecord(entry)) continue;
      const name = asString(entry.name, '');
      if (name) doc.deletedHabits.push({ name, deletedAt: asString(entry.deletedAt, '') });
    }
  }
  for (const key of Object.keys(raw)) {
    if (!DOC_KEYS.includes(key)) doc.extra[key] = raw[key];
  }

  const lines = content.split('\n');
  const defined = new Set([...doc.habits.map(h => h.name), ...doc.deletedHabits.map(d => d.name)]);
  const healed = new Set<string>();

  for (const scan of scansFor(lines, doc.created)) {
    const { start, end, fallbackYear } = scan;
    const columns = readColumnDates(lines, start, end, fallbackYear);

    let row = start;
    while (row < end && !lines[row].trim().startsWith('|')) row++;
    row += 2;                                   // skip the header row and the separator row

    for (; row < end; row++) {
      const line = lines[row].trim();
      if (!line.startsWith('|')) break;
      const cells = line.split('|').map(c => c.trim());
      if (cells.length < 3) continue;
      const name = stripIcon(cells[1]);
      if (!name) continue;

      if (!defined.has(name)) {
        defined.add(name);
        healed.add(name);
        // A row alone does not define the habit: the UI has to ask the user to confirm details.
        doc.needsDefinition.push(name);
        const first = columns
          .filter(c => cells[c.column] === CELL_DONE || cells[c.column] === CELL_MISS)
          .map(c => c.date).sort()[0];
        doc.habits.push({
          name, icon: SYNTHESISED_ICON, frequency: 'daily', streakMode: 'strict',
          startDate: first ?? doc.created, color: colourFor(name)
        });
      }

      for (const { column, date } of columns) {
        const cell = cells[column];
        if (cell === undefined) continue;
        const status: CompletionStatus | null = cell === CELL_DONE ? 'completed' : cell === CELL_MISS ? 'missed' : null;
        if (!status) continue;
        cellMap(doc, name)[date] = status;
      }
    }
  }

  return { doc: normalizeDoc(doc), failure: null, healed: [...healed] };
}
