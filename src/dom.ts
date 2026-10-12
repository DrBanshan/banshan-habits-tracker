/**
 * The window the plugin's timers and frames have to belong to.
 *
 * A bare setTimeout or requestAnimationFrame binds to whichever window the module was first evaluated in,
 * which is the wrong one whenever the plugin is open in a popout: the schedule then keeps running on the
 * main window while the view it serves lives somewhere else. The app exposes the focused window for
 * exactly this reason, so every timer and frame in the plugin goes through it here.
 *
 * Those members are missing from the shipped typings, so the handful the plugin uses is declared here
 * rather than picked up by name. The headless suite has no focused window of its own, so it installs one
 * before these calls are reached.
 */
export interface PopoutWindow {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(handle: number): void;
  requestAnimationFrame(callback: () => void): number;
}

export function timerHost(): PopoutWindow {
  return activeWindow;
}
