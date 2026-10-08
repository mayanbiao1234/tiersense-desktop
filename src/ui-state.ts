import { useState } from 'react';

// View preferences live only in this renderer session, never in user config.
const values = new Map<string, unknown>();
export function useViewState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, update] = useState<T>(() => values.has(key) ? values.get(key) as T : initial);
  return [value, next => { values.set(key, next); update(next); }];
}
