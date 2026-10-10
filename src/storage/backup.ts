export const MAX_BACKUPS = 5;

export interface BackupEntry {
  stamp: string;
  at: string;
  content: string;
}

type Read = () => Promise<Record<string, unknown> | null>;
type Write = (data: Record<string, unknown>) => Promise<void>;

/**
 * Rotating copies of the data file, kept inside the plugin data blob so the vault stays clean of
 * plugin chatter. A restore addresses a copy by its stamp, so stamps have to be unique.
 */
export class BackupStore {
  constructor(private read: Read, private write: Write) {}

  /** Entries the blob actually holds, with unusable records dropped rather than trusted. */
  private async all(): Promise<BackupEntry[]> {
    const blob = await this.read();
    const raw = blob?.backups;
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is BackupEntry =>
      typeof e === 'object' && e !== null &&
      typeof (e as BackupEntry).stamp === 'string' && typeof (e as BackupEntry).content === 'string');
  }

  async list(): Promise<{ stamp: string; at: string; bytes: number }[]> {
    return (await this.all()).map(e => ({ stamp: e.stamp, at: e.at, bytes: e.content.length }));
  }

  async take(stamp: string): Promise<string | null> {
    return (await this.all()).find(e => e.stamp === stamp)?.content ?? null;
  }

  /** Store `content` as the newest copy, unless it is the same text the newest copy already holds. */
  async record(content: string): Promise<void> {
    const existing = await this.all();
    if (existing.length > 0 && existing[0].content === content) return;
    const at = new Date();
    const entry: BackupEntry = { stamp: this.stampFor(at, new Set(existing.map(e => e.stamp))), at: at.toISOString(), content };
    await this.write({ ...(await this.read()), backups: [entry, ...existing].slice(0, MAX_BACKUPS) });
  }

  /**
   * The stamp reads as a timestamp to a person picking a copy, but several records can land inside
   * the same second it shows, and a repeated stamp would make two rows restore the same copy.
   */
  private stampFor(at: Date, taken: Set<string>): string {
    const base = at.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let stamp = base;
    let n = 2;
    while (taken.has(stamp)) {
      stamp = `${base}-${n}`;
      n++;
    }
    return stamp;
  }
}
