/** Put `key` last (newest) and drop the oldest entries beyond `max`. */
export function rememberNewest<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  for (const old of map.keys()) {
    if (map.size <= max) break;
    map.delete(old);
  }
}

/**
 * `id` worked on at `now`: the record to save (newest `max` kept), or null when nothing changes enough to write
 * (it is already the newest, within `resolutionMs`).
 */
export function noteRecent(all: Record<string, number>, id: number, now: number, resolutionMs: number, max: number): Record<string, number> | null {
  const times = Object.values(all);
  if (now - (all[id] ?? Number.NEGATIVE_INFINITY) < resolutionMs && Math.max(...times) === all[id]) return null;
  const next: Record<string, number> = { ...all, [id]: now };
  return Object.fromEntries(Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, max));
}
