import type { Provider } from '../src/types';
export function balanceCapability(provider: Pick<Provider, 'preset' | 'baseUrl'>): { supported: boolean; reason: string; url?: string };
