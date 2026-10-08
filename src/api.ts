import type { State } from './types';
import { defaultTiers } from '../core/policy.mjs';
import { version } from '../package.json';
export const preview = !window.tierflow;
export const platform = window.tierflow?.platform ?? (new URLSearchParams(location.search).get('platform') === 'darwin' || /Mac/.test(navigator.userAgent) ? 'darwin' : 'win32');
export const previewState: State = {
  version, platform, providers: [], models: [], routing: { tiers: defaultTiers(), rules: [] }, onboardingCompleted: false,
  settings: { port: 18420, autoStart: false, zoomFactor: 1, scoreTimeoutMs: 15000, requestTimeoutMs: 180000, allowEscalation: true, failureMode: 'block', fallbackModelId: '', tiersenseUrl: 'https://tierflow.cn/tiersense/v1/score' },
  hasTiersenseKey: false, account: { connected: false, backendAvailable: false, planPrice: 12.9 },
  history: { count: 0, limit: 10000, days: 90, revision: 0, oldest: null, error: '' }, balances: {},
  gateway: { running: false, port: 18420, active: 0, startedAt: null, total: 0, totalTokens: null }, logs: [], dataDir: platform === 'darwin' ? '~/Library/Application Support/TierFlow' : '%APPDATA%\\TierFlow（以桌面端实际位置为准）',
};
export async function invoke<T = State>(action: string, input?: unknown): Promise<T> {
  if (!window.tierflow) {
    if (action === 'snapshot') return structuredClone(previewState) as T;
    throw new Error('这是界面预览，请在桌面客户端中完成此操作');
  }
  return window.tierflow.invoke<T>(action, input);
}
