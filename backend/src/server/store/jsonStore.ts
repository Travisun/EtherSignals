import fs from 'fs';
import path from 'path';

/**
 * Minimal durable JSON store with atomic writes and debounced flush.
 * Zero native dependencies; the repository interface below is the only
 * contract consumers rely on, so it can be swapped for SQLite later.
 */
export class JsonStore {
  /** pending debounced flush per file name — the LAST snapshot always wins */
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; data: () => unknown }>();

  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(name: string) {
    if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`invalid store name: ${name}`);
    return path.join(this.dir, `${name}.json`);
  }

  /** file mtime (0 when missing) — lets per-module-instance caches detect
   *  writes made by ANOTHER instance of this store (dev module duplication) */
  mtime(name: string): number {
    try {
      return fs.statSync(this.file(name)).mtimeMs;
    } catch {
      return 0;
    }
  }

  read<T>(name: string, defaultValue: T): T {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file(name), 'utf8');
    } catch {
      // missing file = first run — legitimate default
      return defaultValue;
    }
    if (!raw.trim()) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // corrupted store: NEVER silently overwrite user data with defaults —
      // park the broken file next to the original so it can be recovered
      const backup = `${this.file(name)}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.file(name), backup);
        console.error(`[store] ${name}.json was corrupted — moved to ${backup}; continuing with defaults`);
      } catch (e) {
        console.error(`[store] ${name}.json is corrupted AND could not be backed up — refusing to overwrite:`, e);
        throw new Error(`corrupted store ${name}; manual intervention required`);
      }
      return defaultValue;
    }
  }

  /** Immediate synchronous write (atomic via tmp file + rename). */
  write<T>(name: string, data: T) {
    const target = this.file(name);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      // best effort on platforms without chmod
    }
    fs.renameSync(tmp, target);
  }

  /**
   * Debounced write. One pending entry per name: re-scheduling cancels the
   * previous flush; the snapshot provider is invoked at flush time so the
   * LAST data always lands.
   */
  writeDebounced<T>(name: string, data: T, ms = 400) {
    const prev = this.pending.get(name);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      this.pending.delete(name);
      try {
        this.write(name, data);
      } catch (e) {
        console.error(`[store] failed to write ${name}:`, e);
      }
    }, ms);
    this.pending.set(name, { timer, data: () => data });
  }

  /** Flush pending debounced writes synchronously (shutdown safety). */
  flushAll() {
    for (const [name, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(name);
      try {
        this.write(name, entry.data());
      } catch (e) {
        console.error(`[store] flush ${name} failed:`, e);
      }
    }
  }
}

export function getDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data');
}

let store: JsonStore | null = null;

export function getStore(): JsonStore {
  if (!store) store = new JsonStore(getDataDir());
  return store;
}
