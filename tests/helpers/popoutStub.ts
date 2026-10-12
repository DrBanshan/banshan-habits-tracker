/**
 * The headless suite has no focused window, and the plugin reaches one for its timers and frames, so a
 * run installs a host whose members forward to the process timers. Loaded as a setup file, ahead of any
 * test that could reach src/dom or the views.
 */
const host = {
  setTimeout: (handler: () => void, timeout: number) => setTimeout(handler, timeout) as unknown as number,
  clearTimeout: (handle: number) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0) as unknown as number
};

(globalThis as { activeWindow?: unknown }).activeWindow = host;

export {};
