import { DEFAULT_COLORS } from '../types';

export const CELL_DONE = '✓';
export const CELL_MISS = '✗';
export const DELETED_ICON = '🗑';
export const SYNTHESISED_ICON = '❔';
export const DELETED_COLOR = '#999999';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LEGACY_DATE = /^[A-Za-z]+\s+(\d{1,2})\/(\d{1,2})$/;

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseIsoDate(text: string): Date | null {
  const m = ISO_DATE.exec(text);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Accepts canonical ISO and the legacy "Mon 6/10" form, which carries no year. */
export function toIsoDate(header: string, fallbackYear = new Date().getFullYear()): string | null {
  if (ISO_DATE.test(header)) return header;
  const legacy = LEGACY_DATE.exec(header.trim());
  if (legacy) return `${fallbackYear}-${pad2(Number(legacy[1]))}-${pad2(Number(legacy[2]))}`;
  return null;
}

export function dayName(date: Date): string {
  return DAY_NAMES[date.getDay()];
}

export function buildMonthHeader(year: number, month: number): string {
  return `## ${MONTHS[month]} ${year}`;
}

export function isKnownMonthHeader(line: string): boolean {
  return parseMonthHeader(line) !== null;
}

export function parseMonthHeader(line: string): { year: number; month: number } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('## ')) return null;
  const parts = trimmed.slice(3).trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const month = MONTHS.indexOf(parts[0]);
  const year = Number(parts[1]);
  if (month < 0 || !Number.isInteger(year)) return null;
  return { year, month };
}

/** 'YYYY-MM', the key form used by the queue and section index. */
export function monthKeyFor(date: string): string {
  return date.slice(0, 7);
}

export function daysOfMonth(year: number, month: number): string[] {
  const count = new Date(year, month + 1, 0).getDate();
  const dates: string[] = [];
  for (let day = 1; day <= count; day++) dates.push(formatDate(new Date(year, month, day)));
  return dates;
}

/** Habit cells are "<emoji> <name>"; name may legitimately contain no leading symbol. */
export function stripIcon(cell: string): string {
  return cell.replace(/^[^\p{L}\p{Nd}]+/gu, '').trim();
}

export function colourFor(name: string): string {
  return DEFAULT_COLORS[hash32(name) % DEFAULT_COLORS.length];
}

/** Shared with the write queue's self-write suppression, hence exported. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
