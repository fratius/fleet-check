/** The three model tiers the app offers. Same table as src/lib/types.ts in the app. */
export type Tier = 'quick' | 'default' | 'complex';
export const TIERS: Tier[] = ['quick', 'default', 'complex'];

interface Price { inPerM: number; outPerM: number }
interface Model { id: string; base: Price; /** Higher rate for the whole request when the prompt is longer than `over` tokens. */ long?: Price & { over: number } }

/** List prices in US dollars per million tokens (October 2026). */
export const MODELS: Record<Tier, Model> = {
  quick: { id: 'claude-haiku-5-5', base: { inPerM: 0.1, outPerM: 0.5 }, long: { over: 100_000, inPerM: 0.5, outPerM: 2.5 } },
  default: { id: 'claude-sonnet-5-5', base: { inPerM: 2, outPerM: 10 } },
  complex: { id: 'claude-opus-5-5', base: { inPerM: 4, outPerM: 20 } },
};

export function costOf(tier: Tier, inTok: number, outTok: number): number {
  const m = MODELS[tier];
  const p = m.long && inTok > m.long.over ? m.long : m.base;
  return (inTok * p.inPerM + outTok * p.outPerM) / 1e6;
}

export interface Usage { ms: number; calls: number; images: number; inTok: number; outTok: number; cost: number }
export const noUsage = (): Usage => ({ ms: 0, calls: 0, images: 0, inTok: 0, outTok: 0, cost: 0 });
export function addUsage(a: Usage, b: Usage): Usage {
  return { ms: a.ms + b.ms, calls: a.calls + b.calls, images: a.images + b.images, inTok: a.inTok + b.inTok, outTok: a.outTok + b.outTok, cost: round(a.cost + b.cost) };
}
export const round = (v: number) => Math.round(v * 1e6) / 1e6;
