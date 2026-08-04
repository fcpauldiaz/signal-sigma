type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/** Process-wide TTL cache with single-flight loaders. */
export class TtlCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>
  ): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value as T;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      return pending as Promise<T>;
    }

    const promise = loader()
      .then((value) => {
        this.entries.set(key, {
          value,
          expiresAt: Date.now() + ttlMs,
        });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  invalidate(prefixOrKey?: string): void {
    if (!prefixOrKey) {
      this.entries.clear();
      return;
    }

    for (const key of this.entries.keys()) {
      if (key === prefixOrKey || key.startsWith(prefixOrKey)) {
        this.entries.delete(key);
      }
    }
  }
}
