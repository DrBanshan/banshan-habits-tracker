# Banshan Habits Tracker

An interactive habit tracking plugin for Obsidian with a Today view, monthly and yearly heatmap views, streak tracking (strict/forgiving), and multiple tracker support -- all powered by readable Markdown files.

> **Based on [Obsidian-Tracker](https://github.com/Nodeencoder/Obsidian-Tracker)** by Nodeencoder. This project extends and enhances the original with additional views, settings, and improved data management.

## Features

### Tracking
- **Interactive Daily Toggles** -- Click day blocks in a 7-day or 21-day rolling window to mark habits as complete or unmarked
- **Streak Tracking** -- Strict mode (missed day breaks streak) and Forgiven mode (1-day grace period within 2 days)
- **Heatmap Visualization** -- GitHub-style contribution graph with Year view (dynamic column wrapping)
- **Multiple Trackers** -- Create separate tracker notes for different life areas (fitness, reading, work, etc.)

### Scheduling
- **Flexible Scheduling** -- Daily, weekly, or specific-day-of-week frequency per habit
- **Deleted Habit Data Handling** -- Choose to keep or delete historical data when removing a habit

### Views
- **Dashboard View** -- Summary screen with progress rings, completion rates, streak counts, best/weakest weekday, and per-habit analytics
- **Today View** -- Quick daily overview with habit cards, inline toggle buttons, and day blocks showing completion counts
- **Month View** -- Calendar-style grid for the selected month
- **Year View** -- Full-year heatmap with responsive wrapping (adapts to window width)
- **Year Overview** -- Per-habit monthly mini heatmaps

### Data Management
- **Readable Data** -- YAML frontmatter + markdown tables stored as plain Markdown files, fully readable in any Markdown editor
- **Dynamic Month Saving** -- Only months with actual data are written to the tracker file
- **Empty Table Detection** -- Choose "On the fly" (filters on every change) or "Once upon reloading" (cleans up on plugin load)

### Habit Management
- **Add / Edit / Delete Habits** -- Via modal dialogs with name, icon, color (preset or custom), frequency, streak mode, and specific days
- **Habit Selection Dropdown** -- Switch between habits in the current tracker file
- **Drag-to-Reorder** -- Drag habit cards to reorder them within any view (Today, Month, Year)

### Settings
- **Today View Days** -- Switch between 7-day and 21-day rolling windows
- **Keep Deleted Data Toggle** -- Per-delete confirmation to preserve or remove historical data
- **Empty Table Detection Mode** -- Control when empty month tables are cleaned up
- **Debug Mode** -- Optional console logging for troubleshooting

## Future Features

The following features are planned but not yet implemented:

- **Multi-Tracker Dashboard** -- Aggregate completion stats, mini heatmaps, and streak summaries across multiple tracker files

## Installation

### Manual

1. Build the plugin:
   ```bash
   npm install
   npm run build
   ```

2. Copy the output to your Obsidian vault's plugins folder:
   ```
   .obsidian/plugins/banshan-habit-tracker/
   ```

3. Enable the plugin in **Settings -> Community plugins -> Turn on community plugins**, then find and enable **Banshan Habit Tracker**.

### Development Mode

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the dev watch server:
   ```bash
   npm run dev
   ```

3. Open your Obsidian vault and enable **Banshan Habit Tracker** from community plugins. The watch server will rebuild automatically on file changes.

## Usage

### Creating a Tracker Note

Create a new Markdown note in your vault with YAML frontmatter and a markdown table:

```markdown
---
name: "Fitness Tracker"
created: "2026-06-10"
habits:
  - name: "Morning Run"
    icon: "🏃"
    frequency: "daily"
    streakMode: "strict"
    startDate: "2026-06-10"
  - name: "Evening Stretch"
    icon: "🧘"
    frequency: "daily"
    streakMode: "forgiving"
    startDate: "2026-06-10"
  - name: "Weight Lifting"
    icon: "💪"
    frequency: "specific"
    specificDays: ["Mon", "Wed", "Fri"]
    streakMode: "strict"
    startDate: "2026-06-10"
---

| Habit | Mon 6/10 | Tue 6/11 | Wed 6/12 |
|-------|----------|----------|----------|
| 🏃 Morning Run | ✓ | | ✓ |
| 🧘 Evening Stretch | ✓ | ✓ | ✓ |
| 💪 Weight Lifting | ✓ | | ✓ |
```

### Using the Plugin

1. **Open the plugin** -- Click the calendar ribbon icon in the left sidebar, or use the command palette (`Ctrl+P` / `Cmd+P`):
   - `Habit Tracker: Open Habit Tracker`

2. **Tracker View** -- A single tracker view with:
   - **Controls bar**: Add/Edit/Delete habit buttons, habit selection dropdown, and view toggle (Dashboard/Today/Month/Year/All)
   - **Main area**: One card per habit with:
     - Week completion count (X/Y days)
     - Inline toggle button for today
     - Habit name
     - Day blocks showing the rolling window
     - Frequency badge and streak mode indicator

3. **Adding Habits** -- Click `+ Add Habit` to create a new habit with name, icon, color (preset or custom), frequency, streak mode, and specific days.

### Habit Configuration

| Field | Values | Description |
|-------|--------|-------------|
| `name` | Any string | Display name for the habit |
| `icon` | Any emoji | Visual icon shown in the UI |
| `frequency` | `daily`, `weekly`, `specific` | How often the habit occurs |
| `specificDays` | `["Mon", "Wed", "Fri"]` | Days of the week (used with `specific` frequency) |
| `streakMode` | `strict`, `forgiving` | Strict: any missed day breaks streak. Forgiven: 1-day grace period allowed |
| `startDate` | `YYYY-MM-DD` | When to start tracking |

### Completion Symbols

| Symbol | Status |
|--------|--------|
| `✓` | Completed |
| `✗` | Missed |
| (empty) | Unmarked |

## Project Structure

```
Obsidian-Habit-tracker/
├── src/
│   ├── main.ts              # Plugin entry point, settings tab, commands
│   ├── view.ts              # Custom Obsidian view with controls and view switching
│   ├── types.ts             # TypeScript interfaces (Habit, Tracker, AppState, etc.)
│   ├── streak.ts            # Streak calculation (strict & forgiving modes)
│   ├── parser.ts            # YAML frontmatter + markdown table reader/writer
│   ├── store.ts             # State management with habit actions
│   ├── styles.css           # Plugin stylesheet
│   └── views/
│       ├── modals.ts        # Add/Edit/Delete habit modals
│       ├── dashboard.ts     # Dashboard summary and analytics rendering
│       ├── today.ts         # Today view rendering
│       ├── month.ts         # Month view rendering
│       ├── year.ts          # Year heatmap view rendering
│       └── yearOverview.ts  # Per-habit monthly overview rendering
├── tests/
│   ├── streak.test.ts       # 6 tests for streak calculation
│   ├── parser.test.ts       # 8 tests for YAML/table parsing & generation
│   └── store.test.ts        # 5 tests for store actions
├── package.json
├── package-lock.json
├── tsconfig.json            # TypeScript config
├── build.js                 # esbuild build script
├── vite.config.ts           # Vite config (legacy)
├── vitest.config.ts         # Vitest test config
└── manifest.json            # Obsidian plugin manifest
```

## Testing

Run all tests:

```bash
npm test
# or
npx vitest run
```

Run a specific test file:

```bash
npx vitest run streak
npx vitest run parser
npx vitest run store
```

Run tests in watch mode:

```bash
npx vitest
```

### Test Coverage

| Module | Tests | Description |
|--------|-------|-------------|
| `streak.test.ts` | 6 | Current streak, longest streak, strict mode, forgiving mode, unmarked days, specific frequency filtering |
| `parser.test.ts` | 8 | YAML parsing, table parsing, null handling, round-trip generation, column count |
| `store.test.ts` | 5 | Toggle day, add habit, delete habit, heatmap view switching |

**Total: 19 tests**

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Production build to `.obsidian/plugins/banshan-habit-tracker/` |
| `npm run dev` | Watch mode -- rebuilds on file changes |
| `npm test` | Run all tests |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | TypeScript type check only |

## Building

```bash
# Production build
npm run build

# TypeScript type check only
npm run typecheck
```

Output is placed in `.obsidian/plugins/banshan-habit-tracker/`:
- `main.js` -- Bundled plugin code
- `styles.css` -- Stylesheet
- `manifest.json` -- Plugin manifest (copied from root)

## Dependencies

| Package | Purpose |
|---------|---------|
| `obsidian` | Obsidian API types (runtime) |
| `js-yaml` | YAML parsing/generation (runtime) |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `esbuild` ^0.20.0 | Bundling and minification |
| `vitest` ^1.0.0 | Testing framework |
| `typescript` ^5.3.0 | Type checking |

## Troubleshooting

- **Plugin not showing** -- Ensure the output is in `.obsidian/plugins/banshan-habit-tracker/` and the plugin is enabled in settings
- **Tracker not discovered** -- The file must contain `habits:` in the YAML frontmatter and have `.md` extension
- **Streaks showing 0** -- Make sure you have completed entries for recent days; streaks count backward from the most recent recorded day
