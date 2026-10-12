import type { TrackerErrorKind } from '../model/tracker';

export type ErrorAction = 'retry' | 'open-file' | 'restore' | 'diagnostics';

const LABELS: Record<ErrorAction, string> = {
  retry: 'Retry',
  'open-file': 'Open data file',
  restore: 'Restore previous data file',
  diagnostics: 'Copy diagnostics'
};

/**
 * What the card offers for each failure the storage layer can report. Deliberately contains nothing
 * that destroys the data file: while the data looks broken is the worst moment to offer it, so the
 * destructive reset lives in settings behind a typed confirmation instead. Kept apart from the view
 * so these rules can be asserted rather than read out of DOM code.
 */
const BY_KIND: Record<TrackerErrorKind, ErrorAction[]> = {
  // The file is there and unreadable: worth seeing, and worth coming back from a kept copy.
  'parse-failed': ['retry', 'open-file', 'restore', 'diagnostics'],
  // A write was refused for risking data; the kept copy is the way out, never deleting the file.
  'write-aborted-safety': ['retry', 'restore', 'diagnostics'],
  'write-failed': ['retry', 'diagnostics'],
  'external-edit-conflict': ['retry', 'open-file', 'restore', 'diagnostics'],
  // A report of what was repaired, not a fault: nothing to restore from, nothing to open.
  'drift-healed': ['retry', 'diagnostics'],
  // Nothing to open and nothing kept to restore from yet.
  'file-missing-uncreatable': ['retry', 'diagnostics']
};

export function actionsFor(kind: TrackerErrorKind): ErrorAction[] {
  return [...BY_KIND[kind]];
}

export function labelFor(action: ErrorAction): string {
  return LABELS[action];
}
