/** Put `key` last (newest) and drop the oldest entries beyond `max`. */
export function rememberNewest<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  for (const old of map.keys()) {
    if (map.size <= max) break;
    map.delete(old);
  }
}
