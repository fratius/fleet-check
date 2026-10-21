import Anthropic from '@anthropic-ai/sdk';
import { HttpsError } from 'firebase-functions/https';
import { logger } from 'firebase-functions';

import type { Sent } from './images';
import { MODELS, costOf, round, type Tier, type Usage } from './models';

let client: Anthropic | null = null;
let clientKey = '';
function getClient(key: string) {
  if (!key) throw new HttpsError('failed-precondition', 'The AI key isn\'t set. Add the ANTHROPIC_API_KEY secret in GitHub and run the Deploy workflow.');
  if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 240_000 }); clientKey = key; }
  return client;
}

export interface Part { label?: string; image: Sent }
export interface Answer<T> { obj: T; usage: Usage; model: string }

/**
 * One call to Claude with images and a prompt. Asks for JSON that matches `schema`
 * (structured output), and falls back to plain JSON in the text if the model rejects the schema.
 */
export async function ask<T>(key: string, tier: Tier, parts: Part[], prompt: string, schema: object, maxTokens: number): Promise<Answer<T>> {
  if (process.env.FUNCTIONS_EMULATOR === 'true' && key === 'not-used-in-tests') return testAnswer<T>(tier, parts, schema);
  const c = getClient(key);
  const model = MODELS[tier].id;
  const content: Anthropic.ContentBlockParam[] = [];
  for (const p of parts) {
    if (p.label) content.push({ type: 'text', text: p.label });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.image.data } });
  }
  const t0 = Date.now();
  const send = (structured: boolean) => c.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: [...content, { type: 'text', text: structured ? prompt : `${prompt}\n\nReply with only JSON that matches this schema:\n${JSON.stringify(schema)}` }] }],
    ...(structured ? { output_config: { format: { type: 'json_schema' as const, schema: schema as Record<string, unknown> } } } : {}),
  });
  let res: Anthropic.Message;
  try {
    try {
      res = await send(true);
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && /output_config|format|schema/i.test(e.message)) {
        logger.warn('Structured output rejected, retrying with plain JSON', { model, message: e.message });
        res = await send(false);
      } else throw e;
    }
  } catch (e) {
    throw toHttps(e);
  }
  const ms = Date.now() - t0;
  const u = res.usage;
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const outTok = u.output_tokens || 0;
  const usage: Usage = { ms, calls: 1, images: parts.length, inTok, outTok, cost: round(costOf(tier, inTok, outTok)) };
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  if (res.stop_reason === 'refusal') throw new HttpsError('aborted', 'The AI declined to answer for these photos. Try other photos.');
  let obj: T;
  try { obj = parseJSON(text) as T; } catch {
    logger.error('Unreadable answer', { model, stop: res.stop_reason, text: text.slice(0, 500) });
    throw new HttpsError('aborted', res.stop_reason === 'max_tokens' ? 'The AI answer was cut off. Try again.' : 'The AI answer couldn\'t be read. Try again.');
  }
  logger.info('claude call', { model, ms, images: parts.length, inTok, outTok, cost: usage.cost });
  return { obj, usage, model };
}

export function parseJSON(t: string): unknown {
  t = String(t || '');
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) t = m[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no json');
  return JSON.parse(t.slice(a, b + 1));
}

function toHttps(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new HttpsError('deadline-exceeded', 'The AI took too long to answer. Try again.');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new HttpsError('failed-precondition', 'The Anthropic API key was refused. Check the ANTHROPIC_API_KEY secret in GitHub and run the Deploy workflow again.');
  }
  if (e instanceof Anthropic.RateLimitError) return new HttpsError('resource-exhausted', 'Too many AI checks at once. Wait a minute and try again.');
  if (e instanceof Anthropic.APIError) {
    const msg = String(e.message || '');
    logger.error('Anthropic API error', { status: e.status, message: msg });
    if (/credit balance|billing/i.test(msg)) return new HttpsError('resource-exhausted', 'The Anthropic account is out of credit. Add credit in the Claude Console.');
    if (e.status === 400) return new HttpsError('invalid-argument', `The AI rejected the request: ${msg.slice(0, 200)}`);
    if (e.status === 404) return new HttpsError('failed-precondition', 'This AI model isn\'t available on the Anthropic account. Pick another model in Account.');
    return new HttpsError('unavailable', 'The AI service is busy or down. Try again in a minute.');
  }
  if (e instanceof Anthropic.APIConnectionError) return new HttpsError('unavailable', 'Couldn\'t reach the AI service. Try again.');
  logger.error('Unexpected error', e as Error);
  return new HttpsError('internal', 'Something went wrong on the server. Try again.');
}

/**
 * The emulator tests run without the Claude API (their key is "not-used-in-tests"): a fixed answer that fits the
 * schema, with made-up usage, so the checks can be tested end to end. Never used outside the emulator.
 */
function testAnswer<T>(tier: Tier, parts: Part[], schema: object): Answer<T> {
  const props = (schema as { properties?: Record<string, unknown> }).properties || {};
  const obj = 'spots' in props
    ? { spots: [{ image: 1, box: [0.3, 0.35, 0.5, 0.5], panel: 'front bumper', type: 'scratch', sizeCm: 6, confidence: 0.8, mightBe: null, closeup: 'Low, straight on.' }], notVisible: [] }
    : 'verdict' in props
      ? { verdict: 'damage', type: 'scratch', sizeCm: 6, severity: 'cosmetic', confidence: 0.9, reason: 'Test answer.', closeupBox: [0.3, 0.3, 0.6, 0.6] }
      : { class: 'large_van', confidence: 0.9, make: 'Test', model: 'Van', roof: 'high', slidingDoorLeft: 'no', slidingDoorRight: 'yes', rearDoors: 'barn', alternatives: [], photoIssues: [], reason: 'Test answer.' };
  const inTok = 1500 * parts.length, outTok = 200;
  return { obj: obj as T, usage: { ms: 1234, calls: 1, images: parts.length, inTok, outTok, cost: round(costOf(tier, inTok, outTok)) }, model: MODELS[tier].id };
}
