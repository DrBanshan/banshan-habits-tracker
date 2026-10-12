/**
 * The window the plugin's timers and frames have to belong to.
 *
 * A bare setTimeout or requestAnimationFrame binds to whichever window the module was first evaluated in,
 * which is the wrong one whenever the plugin is open in a popout: the schedule then keeps running on the
 * main window while the view it serves lives somewhere else. The app exposes the focused window for
 * exactly this reason, so every timer and frame in the plugin goes through it here.
 *
 * That window carries these helpers at run time, but they lag in the installed typings, so the shape is
 * spelled out rather than picked up by name. The typeof test is for headless runs, which have no focused
 * window at all and would otherwise throw on a name that does not exist.
 */
export interface PopoutWindow {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(handle: number): void;
  requestAnimationFrame(callback: () => void): number;
}

export function timerHost(): PopoutWindow {
  return (typeof activeWindow === 'undefined' ? globalThis : activeWindow) as unknown as PopoutWindow;
}
