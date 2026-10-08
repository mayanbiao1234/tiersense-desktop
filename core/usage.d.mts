import type { Analytics, Log } from '../src/types';
export function summarizeUsage(entries: Log[], options?: { range?: string; providerId?: string }, now?: number): Omit<Analytics, 'history'>;
