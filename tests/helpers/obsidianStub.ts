/**
 * The published `obsidian` package ships types only (`"main": ""`), so a run-time lookup of the
 * Obsidian UI cannot resolve under vitest. Production bundles already treat obsidian as external,
 * so this exists purely so the headless suite can drive the code paths that reach for it.
 * Add members here when a test actually needs them, not before.
 */
export class Notice {
  constructor(_message: string | DocumentFragment, _duration?: number) {
    // Headless: a notice has nothing to display into.
  }

  setMessage(_message: string | DocumentFragment): this {
    return this;
  }

  setNoticeClass(_class: string): this {
    return this;
  }
}
