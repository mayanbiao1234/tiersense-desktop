export type ProviderPresetId = 'tierflow' | 'deepseek' | 'zhipu' | 'bailian' | 'ark' | 'moonshot' | 'minimax' | 'hunyuan' | 'siliconflow' | 'custom';
export interface ProviderPreset { id: ProviderPresetId; name: string; detail: string; baseUrl: string; logo: string; hint: string }
export const PROVIDER_PRESETS: ProviderPreset[];
export function getProviderPreset(id?: string): ProviderPreset;
export function providerOriginChanged(previous: string | undefined, next: string): boolean;
