import type { Dimension, Routing, RouteDecision, Scores, State, TierDefinition, Model } from '../src/types';
export const FEATURES: Record<Dimension, string>;
export function defaultTiers(): TierDefinition[];
export function scoreTier(score: number, tiers: TierDefinition[]): string;
export function selectRoute(scores: Scores, routing: Routing, models?: Model[]): RouteDecision;
export function readiness(config: State): { providers: boolean; models: boolean; tiersense: boolean; uncovered: string[] };
