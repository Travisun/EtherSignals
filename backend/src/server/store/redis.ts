/**
 * Optional Redis coordination for multi-replica deployments (docker-compose).
 * Used for engine leader election: when REDIS_URL is set and several app
 * containers share the database, only the lock holder runs the trading engine.
 *
 * Trading semantics: exclusivity beats availability. If Redis becomes
 * unreachable the lock is treated as LOST (never "keep leading") — two live
 * engines double-fire real orders, which is strictly worse than pausing.
 */

const LOCK_KEY = 'gtrading:engine:leader';
const LOCK_TTL_MS = 15_000;

/** atomic compare-and-expire: renew only if we still own the lock */
const RENEW_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

interface LeaderHandle {
  isLeader: boolean;
  stop: () => void;
}

export async function acquireLeadership(onLost?: (isLeader: boolean) => void): Promise<LeaderHandle | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const tryAcquire = async (): Promise<boolean> => {
      try {
        const res = await client.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
        if (res === 'OK') return true;
        // atomic renew (Lua) — no GET→PEXPIRE race window
        const renewed = await client.eval(RENEW_LUA, 1, LOCK_KEY, token, String(LOCK_TTL_MS));
        return renewed === 1;
      } catch {
        // Redis unreachable → fail-closed: treat as lock lost
        return false;
      }
    };

    let isLeader = await tryAcquire();
    let lost = !isLeader;
    const timer = setInterval(async () => {
      try {
        isLeader = await tryAcquire();
      } catch {
        isLeader = false;
      }
      if (!isLeader && !lost) {
        lost = true;
        console.warn('[redis] leadership lost to another replica; parking engine');
        onLost?.(false);
      } else if (isLeader && lost) {
        lost = false;
        console.log('[redis] leadership re-acquired');
        onLost?.(true);
      }
    }, Math.floor(LOCK_TTL_MS / 3));

    console.log(`[redis] leader election active — leading=${isLeader}`);
    return {
      isLeader,
      stop: () => {
        clearInterval(timer);
        void client.quit().catch(() => undefined);
      },
    };
  } catch (e) {
    console.warn('[redis] unavailable, running single-instance mode:', (e as Error).message);
    return null;
  }
}
