# Design: Data-trust hardening for the `habits.md` storage layer

- **Date:** 2026-10-10
- **Status:** approved by the owner section-by-section (§1–§5); awaiting written-spec review
- **Track:** A (Data trust). Tracks B/C/D are parked in the backlog at the end.
- **Approach:** 1 — canonical writer, tolerant reader

## 1. Problem

The plugin stores everything in one markdown file (`habits.md` by default): a YAML frontmatter
block that lists the habits, plus one markdown table per month holding the completions. Those two
halves are written and read by different code paths that do not agree with each other.

`parseTrackerFile` builds the `completions` map **only** for habits declared in frontmatter
(`src/parser.ts:92-95`), and every table cell is dropped unless that habit key already exists
(`src/parser.ts:176`). The normal save path, `writeTrackerFile`, patches **only** the affected month
section (`src/parser.ts:381` onward) and never touches the YAML block. Any add/rename therefore
desynchronises the two halves, and the next load silently discards the orphaned history. No error is
raised, and nothing in the UI changes.

### 1.1 Verified behaviour

Confirmed by throwing vitest probes against the real `src/parser.ts` (fake `app`, headless), then
deleted; `npm run test` was green again afterwards.

| # | Probe | Result | Evidence |
|---|---|---|---|
| P1 | add a habit, record a completion, reload | **fails** | the `Meditate` row is present in the table, yet `completions.Meditate` is `undefined` after re-parse |
| P2 | rename `Reading` → `Read`, reload | **fails** | frontmatter still lists `- name: Reading`, the table row says `Read`; re-parse yields `completions: {"Reading":{}}` — history gone, orphan key left |
| P3 | custom `name` / `created` through a normal patch write | **holds** | `name: MyFitness` and `created: 2020-01-01` survived |
| P4 | deleted-habit archive written by the shape `store.persist` builds | **fails** | no trace of the deleted habit in the written content |

P3 narrows a suspicion into a precise claim: the hardcoding of `name: 'My Habits'` and
`created: today` (`src/store.ts:303-308`) only clobbers user frontmatter on the **full-regeneration**
path — when the file is absent, or when empty-table detection regenerates the document.

### 1.2 Root cause

One defect, four symptoms: the frontmatter list and the month tables are two independent
representations of the same fact, each written by its own path, and the reader treats only the
frontmatter as authoritative. Every symptom above is an instance of that split, so the design
removes the split instead of patching the symptoms.

### 1.3 Secondary facts this design must respect

- Nothing observes the vault: `registerEvent`, `vault.on` and `workspace.on` appear **zero** times in
  `src/`. Hand edits and edits arriving from Obsidian Sync never take effect until a plugin reload.
- `lintHabitsFile()` rewrites the file on **every** load, deleting month sections, and logs one
  `console.log` line per section (`src/parser.ts:557`, called from `src/store.ts:86`). With a
  sync backend active this is a conflict generator, not merely noise.
- Writes are fire-and-forget: `void persist(...)` from `toggleDay` (`src/store.ts:161`), `addHabit`,
  `renameHabit`, `deleteHabit`, `reorderHabits`, each doing an independent read-modify-write of the
  same file. Two quick toggles in different months can lose one of them.
- Failures collapse to free-form strings at two sites (`src/store.ts:138`, `src/store.ts:313`) and
  render at one (`src/view.ts:366`). The only remedy offered there is
  **"Delete habits file & reload"**, which trashes the data file (`src/view.ts:367-388`).
- `state.loading` is written (`src/store.ts:82,129,137`) and read by nothing.

## 2. Decisions taken with the owner

| Topic | Decision |
|---|---|
| Status of `habits.md` | **shared with the user** — it stays a plain markdown note that may be hand-edited and synced; the reader is forgiving and self-heals |
| Safety net | **rotating backups + a Restore command** |
| Storage approach | **1 — canonical writer, tolerant reader** (2's parse-back verification adopted as a hard gate; 3, a versioned format, deferred) |
| CI | `release.yml` stays exactly as the Obsidian guide defines it; no additional CI workflow in this scope |

## 3. Goals and non-goals

**Goals**
1. No user data can be lost by add / rename / delete / reorder / toggle, in any order or burst.
2. Vaults already desynchronised by a released build heal on the next save, without data loss.
3. One deterministic serialisation step, so the format has a single author and can be property-tested.
4. Concurrent and re-entrant writes are serialised; a bad transform cannot reach the disk.
5. Hand edits and synced arrivals become visible without restarting the plugin.
6. Failure states are typed, name the affected habit/date, and never propose deleting the data file.

**Non-goals** (explicitly out of this spec)
- New habit semantics: weekly targets, count-based goals, rest/skip days, the duplicated streak
  engines in `src/views/dashboard.ts:164` versus `src/streak.ts:36` → Track B.
- Multi-tracker switcher, `{{BanshanToday}}` inline variables → Track C.
- Keyboard/bulk marking, ARIA audit, `activeWindow` timers, `versions.json`, ESLint, log cleanup
  beyond §4 → Track D. The only logging change included here is the one the lint path forces (§2 step 6).
- Changing the on-disk layout: v1 markdown tables stay, so files remain readable in any editor and
  remain openable by older plugin versions.

## 4. §1 Architecture and module boundaries

All format knowledge leaves `src/parser.ts` (627 lines holding parse + generate + patch-write +
lint + bootstrap) and `src/store.ts`, and concentrates in a pure, Obsidian-free document model that
both ends must pass through.

```
            ┌─────────────────────────┐
  store.ts ─▶│ model/tracker.ts (pure)│  TrackerDoc + invariants
            └─────────────────────────┘
                 ▲                │
     ┌───────────────┐   ┌────────────────┐
     │ storage/       │   │ storage/        │
     │  deserialize   │◀──│  serialize      │  both pure, string in/out
     └───────────────┘   └────────────────┘
                 ▲                │
            ┌─────────────────────────┐
            │ storage/vaultFile (obsd)│  read · queued write · backup · lint
            └─────────────────────────┘
```

| Unit | Sole responsibility | Depends on |
|---|---|---|
| `src/model/tracker.ts` | `TrackerDoc` type and `assertInvariants(doc)`: every habit has a completions entry; every completions key belongs to a known or deleted habit; every date key is `YYYY-MM-DD` | nothing |
| `src/storage/deserialize.ts` | content → `TrackerDoc`, tolerant: table-only habits merged and flagged | `model`, `yaml` |
| `src/storage/serialize.ts` | `serialize(doc, existingContent)` → content; derives the YAML list from the doc, preserves unknown frontmatter keys, keeps untouched month sections byte-stable | `model`, `yaml` |
| `src/storage/writeQueue.ts` | one in-flight writer per path, coalescing bursts | nothing |
| `src/storage/vaultFile.ts` | the only module touching `app.vault`: read, queued write, backups, lint, watcher | the three above, `obsidian` |
| `src/parser.ts` | re-export façade keeping `parseTrackerFile` / `generateTrackerContent` / `isTFile` importable so `tests/parser.test.ts` and current imports keep working | `storage/*` |

Conventions stay as they are: module-level exported functions, no classes, no `this`, matching the
existing style; `storage/*` and `model/*` import `obsidian` types only, mirroring `src/parser.ts:2`
so they stay unit-testable head-lessly.

`TrackerDoc` widens `Tracker` (`src/types.ts:16-25`) with `needsDefinition?: string[]` (habits merged
from tables) and `pendingData?: string[]` (completions keys without a definition), and carries the
`formatVersion` marker described in §6.

## 5. §2 Data flow and the write pipeline

Mutations keep today's shape: state updates synchronously, the view patches in place
(`src/view.ts:40-56`). Writing stops being fire-and-forget.

```
toggle / add / rename / delete / reorder
        │  state updated synchronously, as today
        ▼
  requestWrite(reason) ──▶ writeQueue.enqueue(path)
                                 │  drain loop, one in-flight write per path
                                 ▼
   1 snapshot      take TrackerDoc from *current* state at flush time
                   (not at enqueue time → a burst cannot resurrect stale data)
   2 read          vault.read(path)
   3 serialize     serialize(doc, existingContent)
   4 parse-back    deserialize(out) ⇒ assertInvariants ⇒ diff against doc
                    abort when: a habit would disappear / a completion would disappear /
                               a date is unparseable
   5 backup        first write of the session, and any full rewrite
   6 vault.modify  one write; remember sha256 of the accepted content
```

| Concern | Decision |
|---|---|
| Bursts | coalesced into one flush; each flush snapshots fresh state, replacing today's independent `void persist(...)` races |
| Parse-back gate | hard abort: file untouched, error surfaced, logged once per kind per session |
| Backups | last **5** copies of `habits.md` inside plugin `saveData` (`data.json`), not a vault folder → no clutter, no sync churn; `Restore previous data file…` lists timestamps |
| Live reload | `registerEvent(app.vault.on('modify'))` filtered to the data path, ≈500 ms debounce; **skipped while the queue is non-empty**; own writes suppressed by sha256 comparison against the last accepted content |
| Empty-table cleanup | the two existing modes keep working; a third mode `'manual'` (deletion only via the explicit `Clean empty month sections` command) becomes the default for fresh installs, because the canonical writer already omits data-less sections |
| Lint diagnostics | the per-section `console.log` in `lintHabitsFile` moves behind `isDebug()` |

No Obsidian API newer than the declared `minAppVersion: 1.12.7` is introduced: `Notice`,
`registerEvent`, `vault.on('modify')` and `loadData`/`saveData` are all older than that floor.

## 6. §3 Reader self-heal and compatibility rules

Applied in this order:

| Situation | Resolution |
|---|---|
| Habit in frontmatter **and** in a table | frontmatter wins for attributes, the table wins for completions |
| Habit **only** in a table (today silently discarded) | synthesised into state: `frequency: 'daily'`, `streakMode: 'strict'`, icon `'❔'`, colour `DEFAULT_COLORS[hash(name) % length]`, `startDate` = earliest dated cell holding data; tagged `needsDefinition`, shown with a subtle hint to confirm details |
| Habit **only** in frontmatter, no rows | kept as a zero-completion habit; data is never fabricated |
| Completions key with no definition anywhere (P2's `{"Reading":{}}`) | retained as `pendingData`; never deleted as a side effect of a definition mismatch; re-attaches to the table-only habit above when a row carries it |
| `habits:` empty or all deleted | yields an empty `TrackerDoc` instead of today's `null` (`src/parser.ts:89`), so such a file no longer presents as corrupt |
| `deletedHabits` | written to frontmatter with `deletedAt`; still rendered as the `🗑` row per month (`src/parser.ts:289-298`); new `Restore deleted habit…` command moves the name back and keeps its data |
| Unknown frontmatter keys | preserved through `yaml.parse → mutate → stringify`; `name` / `created` are filled only when absent |
| Legacy `Mon 6/10` headers | still accepted (`src/parser.ts:47-66`); the writer always emits ISO `YYYY-MM-DD` |
| Format marker | `formatVersion: 1` written and accepted; absence is treated as 1. It exists so a later versioned-format migration has a hook, and nothing else reads it |

Known limitation, stated rather than silently "fixed": `convertToISODate` assumes
`new Date().getFullYear()` for legacy dates (`src/parser.ts:56`), so a legacy table from a past year
lands its data in the current year. Guessing a past year could move data somewhere worse; the plan is
to surface it if hit.

Migration is not a step: enabling the plugin performs no rewrite. Self-healing happens on the next
genuine write, so simply loading the plugin stays read-only.

## 7. §4 Error handling and user-visible surfaces

`TrackerErrorKind` replaces the two collapsed strings, and each error carries `occurredAt` plus
optional `habit` / `date` so the message can name the affected habit instead of "Failed to save".

| Kind | Severity | Actions offered |
|---|---|---|
| `parse-failed` (frontmatter is not valid YAML) | blocking | Retry · Open `habits.md` · Copy diagnostics |
| `write-aborted-safety` (parse-back gate tripped) | blocking, file untouched | list of what would have been lost · Retry · Restore previous copy |
| `write-failed` (vault error: locked, read-only, deleted mid-write) | blocking | Retry · Open file · Restore previous copy |
| `external-edit-conflict` (inbound modify while queue pending) | deferred, auto-resolved once drained | none, informational |
| `drift-healed` (count of merged table-only habits) | notice | none, auto-dismiss |
| `file-missing-uncreatable` | blocking | Retry · Restore previous copy |

- The card replaces `src/view.ts:366-388`; **no error state may propose deleting the data file**.
- Today's "Delete habits file & reload" moves into the settings tab as `Reset data file`, behind a
  double confirmation, next to the new `Restore previous data file…`.
- Failures log once per kind per session; notices use `Notice`.
- `state.loading` drives a placeholder so a slow read cannot flash "No habits yet".

## 8. §5 Testing strategy (test-first)

Step 0 pins §1.1: four tests written before implementation, red for the right reason (a lost
completions assertion, not an exception): `add habit survives reload`, `rename habit preserves
history`, `deletedHabits round-trips`, `parse-back gate aborts without touching the file`. Today the
two functions that mutate user files, `writeTrackerFile` and `lintHabitsFile`, have zero coverage out
of the 18 existing tests.

| Layer | Cases |
|---|---|
| `serialize` | YAML list derived from the doc; unknown frontmatter keys preserved; `name`/`created` filled only when absent; byte-stability `serialize(doc, serialize(doc, ""))` leaves untouched sections identical; ISO headers always |
| `deserialize` | table-only synthesis (defaults, `needsDefinition`, inferred `startDate`); precedence rules; `pendingData`; empty `habits:` yields an empty doc; legacy `Mon 6/10` accepted |
| Round-trip property | seeded pseudo-random docs (frequency × streak mode × `specificDays`, spanning month ends, leap Feb, Dec→Jan) ⇒ `parse(serialize(doc))` preserves habits and completions exactly; deterministic seed, printed on failure |
| `writeQueue` | fake timers; two same-tick cross-month toggles both survive; a burst coalesces to one write; snapshot at flush, not at enqueue |
| Watcher | inbound `modify` reloads; own write suppressed by sha256; reload deferred while the queue is non-empty |
| `backup` | cap at 5, rotation order, one copy per session start / full rewrite (no per-toggle storm), `Restore` returns the prior bytes |
| Errors | gate tripped ⇒ file byte-identical and `write-aborted-safety`; `write-failed` offers retry; no error state offers deletion |

Fixtures stay synthetic — never the repository's `habits.md`. The harness needs no Obsidian runtime:
the probes drove the real parser head-lessly with a fake `app` object, so `storage/*` and `model/*`
stay unit-testable. Loop commands: `npm run test` and `npm run typecheck`, green before and after
each step (AGENTS.md §3 makes the existing suite the refactor safety net).

## 9. Delivery

**New:** `src/model/tracker.ts`, `src/storage/serialize.ts`, `src/storage/deserialize.ts`,
`src/storage/writeQueue.ts`, `src/storage/vaultFile.ts`, `src/storage/backup.ts`,
`tests/storage/*.test.ts`.
**Modified:** `src/parser.ts` (facade), `src/store.ts` (actions route through the queue; `persist`
retired; typed errors), `src/types.ts` (`TrackerDoc`, `TrackerErrorKind`, `'manual'` mode),
`src/main.ts` (watcher registration, commands, settings default), `src/view.ts` (error card, loading
placeholder), `src/views/modals.ts` (Restore/Reset entries), `src/styles.css` (error card, hint).

**Build order** (each stage lands green, so the existing suite is the safety net at every step)

1. Pure core: `model/tracker.ts`, `deserialize.ts`, `serialize.ts` + their unit and round-trip tests. No behaviour change yet; `parser.ts` becomes the façade.
2. Pin the four §1.1 probes as failing tests, then route saving through `serialize` + the parse-back gate and retire `store.persist`'s hand-built `Tracker`.
3. `writeQueue` + `vaultFile`, replacing the five `void persist(...)` call sites; backup rotation and the Restore command.
4. Vault watcher with sha256 self-suppression, the `'manual'` cleanup mode, and the lint log behind `isDebug()`.
5. Typed errors, the error card, the settings `Reset data file` relocation, and the loading placeholder.

**Risks**

| Risk | Mitigation |
|---|---|
| Full regeneration produces noisy diffs, aggravating sync conflicts | byte-stability assertion in §8; only data-bearing months are emitted; untouched sections must not change |
| Lenient reader hides a genuinely corrupt file | `needsDefinition` / `pendingData` surfaced, never silently repaired; gate blocks writes that would lose data |
| Watcher reacts to the plugin's own write | sha256 suppression plus the non-empty-queue guard |
| Behaviour change for existing users (`'manual'` default) | default applies to fresh installs only; saved settings keep their stored value |
| Regressions in untested UI paths | typecheck plus the existing 18 tests stay green at every step; UI changes limited to §4 |

**Out of scope, carried forward:** Track B (real weekly targets — `weekly` is a no-op at
`src/streak.ts:23` —, count-based goals, a reachable rest/missed state, one streak engine),
Track C (multi-tracker switcher, `{{BanshanToday}}` variables; `setHabitsFilePath` at
`src/store.ts:264` is still dead code), Track D (quick marking, ARIA, `activeWindow` timers,
`versions.json`, ESLint, package version drift).

## 10. Verification

```bash
npm run typecheck        # tsc --noEmit clean
npm run test             # existing 18 plus the new storage suites green
```

Acceptance is behaviour-based, not file-based: after performing add / rename / delete / reorder and
restarting the plugin, `habits.md` re-parses to the same habits and completions it held before the
restart, and the four pinned probes from §1.1 pass.
