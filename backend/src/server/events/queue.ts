/**
 * In-process job queue (Laravel queue analogue) with retry + backoff.
 * Used for mail deliveries, backtest runs and any fire-and-forget work.
 */
export interface Job<T = unknown> {
  id: string;
  name: string;
  payload: T;
  run: (payload: T) => Promise<void>;
  retriesLeft: number;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export class Queue {
  private queue: Job[] = [];
  private processing = false;
  depth = 0;

  constructor(private concurrency = 1) {}

  push<T>(name: string, payload: T, run: (payload: T) => Promise<void>, opts: { retries?: number; onDone?: () => void; onError?: (e: Error) => void } = {}): string {
    const job: Job<T> = {
      id: `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      payload,
      run,
      retriesLeft: opts.retries ?? 2,
      onDone: opts.onDone,
      onError: opts.onError,
    };
    this.queue.push(job as Job);
    this.depth = this.queue.length;
    setImmediate(() => this.drain());
    return job.id;
  }

  private async drain() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, this.concurrency);
        this.depth = this.queue.length;
        await Promise.all(batch.map((job) => this.runJob(job)));
      }
    } finally {
      this.processing = false;
      this.depth = this.queue.length;
    }
  }

  private async runJob(job: Job) {
    try {
      await job.run(job.payload);
      job.onDone?.();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (job.retriesLeft > 0) {
        job.retriesLeft -= 1;
        const backoff = 2_000 * (job.retriesLeft + 1);
        setTimeout(() => {
          this.queue.push(job);
          this.depth = this.queue.length;
          setImmediate(() => this.drain());
        }, backoff);
      } else {
        console.error(`[queue] job ${job.name} failed permanently:`, e.message);
        job.onError?.(e);
      }
    }
  }
}

export const queue = new Queue(2);
