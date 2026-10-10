export type Writer = () => Promise<void>;

interface Lane { tail: Promise<void>; pending: number; dirty: boolean }
const lanes = new Map<string, Lane>();

/**
 * One in-flight writer per path, with coalescing: while a write is running further requests only
 * mark the lane dirty, and the flush that covers them reads state fresh at the moment it runs, so a
 * burst of toggles costs one read-modify-write against the newest state instead of one each.
 */
export function enqueue(path: string, reason: string, writer: Writer): Promise<void> {
  const lane = lanes.get(path) ?? { tail: Promise.resolve(), pending: 0, dirty: false };
  lanes.set(path, lane);
  lane.pending++;
  lane.dirty = true;
  void reason;

  lane.tail = lane.tail.then(async () => {
    if (!lane.dirty) return;                    // a running flush already covered this request
    lane.dirty = false;
    try {
      await writer();
    } catch (e) {
      // A failed write must not wedge the lane: the chain stays fulfilled and the next request runs.
      console.warn('[HabitTracker] queued write failed', e);
    }
  });

  return lane.tail.then(() => {
    lane.pending = Math.max(0, lane.pending - 1);
    if (lane.pending === 0) lanes.delete(path);
  });
}

export function pendingCount(path?: string): number {
  if (path !== undefined) return lanes.get(path)?.pending ?? 0;
  let total = 0;
  for (const lane of lanes.values()) total += lane.pending;
  return total;
}

export function hasPending(path?: string): boolean {
  return pendingCount(path) > 0;
}

export function whenIdle(path?: string): Promise<void> {
  if (path !== undefined) {
    const lane = lanes.get(path);
    return lane ? lane.tail.then((): undefined => undefined) : Promise.resolve();
  }
  const settled = [...lanes.values()].map((l): Promise<void> => l.tail.then((): undefined => undefined));
  return Promise.all(settled).then((): undefined => undefined);
}
