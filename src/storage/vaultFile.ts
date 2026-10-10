import type { App } from 'obsidian';
import { assertInvariants, diffDocs } from '../model/tracker';
import type { DocDiff, TrackerDoc, TrackerError, TrackerErrorKind } from '../model/tracker';
import { deserialize } from './deserialize';
import { serialize } from './serialize';
import { hash32 } from './format';

export interface SaveOptions {
  changedMonths?: Set<string>;
  /** The document the gate must not let this write fall behind, usually last-known-good state. */
  protectAgainst?: TrackerDoc;
  onNotice?: (kind: TrackerErrorKind, message: string) => void;
  /**
   * Called with the text about to be overwritten, immediately before the write, so the caller can
   * rotate a copy into the backup rotation. Best-effort: failing here must not lose the save.
   */
  record?: (previous: string) => Promise<void>;
}

export interface FileResult {
  ok: boolean;
  doc: TrackerDoc | null;
  acceptedContent?: string;
  loss?: DocDiff;
  error?: TrackerError;
}

const lastWritten = new Map<string, number>();

function fail(kind: TrackerErrorKind, message: string, habit?: string, date?: string): TrackerError {
  return { kind, message, occurredAt: new Date().toISOString(), ...(habit ? { habit } : {}), ...(date ? { date } : {}) };
}

export async function readDoc(app: App, path: string): Promise<FileResult> {
  const viaIndex = app.vault.getAbstractFileByPath(path);
  if (viaIndex) {
    const file = viaIndex as Parameters<App['vault']['read']>[0];
    const content = await app.vault.read(file);
    return fromText(content, path);
  }
  try {
    return fromText(await app.vault.adapter.read(path), path);
  } catch {
    return { ok: false, doc: null, error: fail('file-missing-uncreatable', `No data file at ${path} and none could be created`) };
  }
}

function fromText(content: string, path: string): FileResult {
  const { doc, failure, healed } = deserialize(content);
  if (!doc || failure) {
    return { ok: false, doc: null, error: fail('parse-failed', `${path}: ${failure === 'bad-yaml' ? 'the properties block is not valid YAML' : failure === 'no-habits' ? 'the properties block lists no habits' : 'the file has no properties block'}`) };
  }
  try {
    assertInvariants(doc, 'read');
  } catch (e) {
    return { ok: false, doc: null, error: fail('parse-failed', e instanceof Error ? e.message : 'invalid document') };
  }
  if (healed.length > 0) {
    lastWritten.set(path, hash32(content));
    // A dynamic import on purpose: it keeps storage -> store out of the import graph.
    void import('../store').then(m => m.reportDrift(healed)).catch(() => { /* surfaced by store */ });
  }
  return { ok: true, doc, acceptedContent: content };
}

export async function saveDoc(app: App, path: string, doc: TrackerDoc, options: SaveOptions = {}): Promise<FileResult> {
  try {
    assertInvariants(doc, 'write');
  } catch (e) {
    return { ok: false, doc: null, error: fail('write-aborted-safety', e instanceof Error ? e.message : 'invalid document') };
  }

  const existing = await readExisting(app, path);
  let content: string;
  try {
    content = serialize(doc, { existingContent: existing ?? undefined, changedMonths: options.changedMonths });
  } catch (e) {
    return { ok: false, doc, error: fail('write-aborted-safety', e instanceof Error ? e.message : 'serialisation failed') };
  }

  const check = deserialize(content);
  if (!check.doc || check.failure) {
    return { ok: false, doc, acceptedContent: existing ?? undefined, error: fail('write-aborted-safety', `the produced file would not read back (${check.failure ?? 'unknown'})`) };
  }
  const baseline = options.protectAgainst ?? doc;
  const loss = diffDocs(baseline, check.doc);
  if (loss.lostHabits.length > 0 || loss.lostCompletions.length > 0) {
    const detail = [
      ...loss.lostHabits.map(n => `habit "${n}"`),
      ...loss.lostCompletions.slice(0, 5).map(l => `${l.habit} ${l.date}`)
    ].join(', ');
    return {
      ok: false, doc, acceptedContent: existing ?? undefined, loss,
      error: fail('write-aborted-safety', `write refused: it would drop ${detail}${loss.lostCompletions.length > 5 ? ` and ${loss.lostCompletions.length - 5} more` : ''}`, loss.lostCompletions[0]?.habit, loss.lostCompletions[0]?.date)
    };
  }

  // Recorded before the comparison with what is on disk: this text is now what this process
  // accepts for that path, whether or not the vault had to be asked to store it.
  lastWritten.set(path, hash32(content));
  if (content === existing) return { ok: true, doc, acceptedContent: content };

  // Rotated against the text about to be replaced, and only for a write that really changes it.
  if (options.record && existing !== null) {
    await options.record(existing).catch(() => { /* best-effort: a failed rotation must not lose the save */ });
  }

  try {
    const abstract = app.vault.getAbstractFileByPath(path);
    if (abstract) {
      await app.vault.modify(abstract as Parameters<App['vault']['modify']>[0], content);
    } else {
      await app.vault.adapter.write(path, content);
    }
  } catch (e) {
    return { ok: false, doc, error: fail('write-failed', e instanceof Error ? e.message : 'the vault refused the write') };
  }

  return { ok: true, doc, acceptedContent: content };
}

async function readExisting(app: App, path: string): Promise<string | null> {
  const abstract = app.vault.getAbstractFileByPath(path);
  if (abstract) return app.vault.read(abstract as Parameters<App['vault']['read']>[0]);
  try {
    return await app.vault.adapter.read(path);
  } catch {
    return null;
  }
}

/** True when this text is byte-for-byte what this process last accepted for that path. */
export function isOwnWrite(path: string, content: string): boolean {
  return lastWritten.get(path) === hash32(content);
}

export function forgetWrite(path: string): void {
  lastWritten.delete(path);
}

export interface WatcherHandlers {
  /** Called once per settled external edit, after the debounce, with the data file path. */
  onExternalEdit: (path: string) => void;
  /** True while a local save is in flight; the reload is held rather than raced against it. */
  isBusy?: () => boolean;
  debounceMs?: number;
}

// At the production debounce this is around fifteen seconds of waiting on a save that never clears,
// after which the watcher stops asking rather than polling for the rest of the session.
const MAX_HELD_ROUNDS = 30;

/**
 * Watches the data file for edits made outside the plugin. Our own writes echo back as modify
 * events, so the echo is recognised by content fingerprint rather than by timing, which is the only
 * comparison that holds when several writes and edits are in flight at once.
 */
export function startWatcher(app: App, path: string, handlers: WatcherHandlers): () => void {
  const debounceMs = handlers.debounceMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heldRounds = 0;
  let stopped = false;

  const flush = () => {
    timer = null;
    if (stopped) return;
    if (handlers.isBusy?.() === true) {
      if (heldRounds >= MAX_HELD_ROUNDS) return;
      heldRounds++;
      timer = setTimeout(flush, debounceMs);          // hold the reload until the save drains
      return;
    }
    heldRounds = 0;
    handlers.onExternalEdit(path);
  };

  const onModify = (data: { file?: { path?: string } }) => {
    if (data?.file?.path !== path) return;
    void (async () => {
      if (stopped) return;
      const text = await readExisting(app, path);
      if (text !== null && isOwnWrite(path, text)) return;
      if (timer !== null) clearTimeout(timer);
      heldRounds = 0;
      timer = setTimeout(flush, debounceMs);
    })();
  };

  const ref = app.vault.on('modify', onModify as (...data: unknown[]) => unknown);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    // offref takes the reference on() handed back, and nothing else.
    app.vault.offref(ref);
  };
}
