// One small adapter for the AI provider, with cost tracking and a monthly cap per client.
import { db, env, HttpError, insert } from './core';

/**
 * Works with every Claude Console key type: classic keys ("sk-ant-api…") in x-api-key, and personal or
 * service-account keys as a bearer token. A key not scoped to a workspace also needs ANTHROPIC_WORKSPACE_ID.
 */
function anthropicHeaders(): Record<string, string> {
  const key = env('ANTHROPIC_API_KEY');
  const ws = env('ANTHROPIC_WORKSPACE_ID');
  return {
    ...(key.startsWith('sk-ant-api') ? { 'x-api-key': key } : { Authorization: `Bearer ${key}` }),
    ...(ws ? { 'anthropic-workspace-id': ws } : {}),
    'anthropic-version': '2023-06-01', 'content-type': 'application/json',
  };
}

export interface AiResult {
  text: string;
  citations: { title: string; url: string }[];
  usage: { input: number; output: number; searches: number; costUsd: number };
}

interface AiCall {
  userId: string | null;
  agent: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  webSearch?: { maxUses: number; country?: string };
  fast?: boolean;   // quick replies (chat, brief, intros) use the faster, cheaper model
}

const modelFor = (c: AiCall, provider: string) => c.fast
  ? env('AI_FAST_MODEL', provider === 'anthropic' ? 'claude-haiku-5-5' : env('AI_MODEL'))
  : env('AI_MODEL', provider === 'anthropic' ? 'claude-sonnet-5-5' : '');

const priceIn = () => Number(env('AI_PRICE_IN_PER_MTOK', '3'));
const priceOut = () => Number(env('AI_PRICE_OUT_PER_MTOK', '15'));
const pricePerSearch = () => Number(env('AI_PRICE_PER_SEARCH', '0.01'));

export function estimateCost(input: number, output: number, searches: number): number {
  return Math.round(((input / 1e6) * priceIn() + (output / 1e6) * priceOut() + searches * pricePerSearch()) * 10000) / 10000;
}

/** Fails closed when a client has used their monthly AI allowance. */
export async function checkCap(userId: string | null) {
  if (!userId) return;
  const cap = Number(env('AI_MONTHLY_CAP_USD', '8'));
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const rows = await db<any[]>(`ai_usage?select=cost_usd&user_id=eq.${userId}&created_at=gte.${start.toISOString()}`);
  const spent = rows.reduce((a, r) => a + Number(r.cost_usd), 0);
  if (spent >= cap) throw new HttpError(429, 'You’ve reached this month’s research allowance. It resets on the 1st, or contact hello@gainora.co.uk to raise it.');
}

async function callAnthropic(c: AiCall): Promise<AiResult> {
  const tools = c.webSearch ? [{
    type: 'web_search_20250305', name: 'web_search', max_uses: c.webSearch.maxUses,
    user_location: { type: 'approximate', country: c.webSearch.country || 'GB', timezone: 'Europe/London' },
  }] : undefined;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: anthropicHeaders(),
    body: JSON.stringify({ model: modelFor(c, 'anthropic'), max_tokens: c.maxTokens ?? 1500, system: c.system, messages: c.messages, ...(tools ? { tools } : {}) }),
    signal: AbortSignal.timeout(c.webSearch ? 600_000 : 90_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[gainora] anthropic error', res.status, data?.error?.type);
    throw new HttpError(502, 'The AI service did not respond. Try again in a minute.');
  }
  const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  const citations: { title: string; url: string }[] = [];
  for (const b of data.content || []) for (const ci of b.citations || []) if (ci.url) citations.push({ title: ci.title || ci.url, url: ci.url });
  const input = data.usage?.input_tokens ?? 0;
  const output = data.usage?.output_tokens ?? 0;
  const searches = data.usage?.server_tool_use?.web_search_requests ?? 0;
  return { text, citations, usage: { input, output, searches, costUsd: estimateCost(input, output, searches) } };
}

async function callOpenAI(c: AiCall): Promise<AiResult> {
  const model = modelFor(c, 'openai');
  if (!model) throw new HttpError(503, 'Set AI_MODEL when using OpenAI.');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, instructions: c.system, max_output_tokens: c.maxTokens ?? 1500,
      input: c.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(c.webSearch ? { tools: [{ type: 'web_search', user_location: { type: 'approximate', country: c.webSearch.country || 'GB' } }] } : {}),
    }),
    signal: AbortSignal.timeout(c.webSearch ? 600_000 : 90_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('[gainora] openai error', res.status); throw new HttpError(502, 'The AI service did not respond. Try again in a minute.'); }
  let text = ''; const citations: { title: string; url: string }[] = []; let searches = 0;
  for (const item of data.output || []) {
    if (item.type === 'web_search_call') searches++;
    if (item.type === 'message') for (const part of item.content || []) {
      if (part.type === 'output_text') { text += part.text; for (const a of part.annotations || []) if (a.type === 'url_citation') citations.push({ title: a.title || a.url, url: a.url }); }
    }
  }
  const input = data.usage?.input_tokens ?? 0; const output = data.usage?.output_tokens ?? 0;
  return { text, citations, usage: { input, output, searches, costUsd: estimateCost(input, output, searches) } };
}

export async function ai(c: AiCall): Promise<AiResult> {
  const provider = env('AI_PROVIDER', env('ANTHROPIC_API_KEY') ? 'anthropic' : 'openai');
  if (provider === 'anthropic' && !env('ANTHROPIC_API_KEY')) throw new HttpError(503, 'AI is not set up yet (ANTHROPIC_API_KEY).');
  if (provider === 'openai' && !env('OPENAI_API_KEY')) throw new HttpError(503, 'AI is not set up yet (OPENAI_API_KEY).');
  await checkCap(c.userId);
  const r = provider === 'openai' ? await callOpenAI(c) : await callAnthropic(c);
  await insert('ai_usage', {
    user_id: c.userId, agent: c.agent, model: modelFor(c, provider),
    input_tokens: r.usage.input, output_tokens: r.usage.output, searches: r.usage.searches, cost_usd: r.usage.costUsd,
  }).catch((e) => console.error('[gainora] usage log failed', e?.message));
  return r;
}

/** Pulls the first JSON object or array out of a model reply. */
export function extractJson<T = any>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start === -1) throw new Error('no json');
  const open = raw[start]; const close = open === '{' ? '}' : ']';
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(raw.slice(start, i + 1));
  }
  throw new Error('unterminated json');
}

/** Words and claims the agents must never use when writing to clients. */
export const BANNED = [/guarantee(d)?/i, /\b100% (sure|certain)\b/i, /\brisk[- ]free\b/i, /\bdouble your\b/i, /\bskyrocket/i, /\bas an ai\b/i, /\bI cannot browse\b/i];
export function hasBanned(text: string): boolean { return BANNED.some((r) => r.test(text)); }

/** The business context every agent prompt starts with. */
export const HOUSE_STYLE = `Write in plain UK English, like a sharp, friendly business adviser who knows this business well. Be specific and practical. Never invent facts, numbers, results or testimonials. If you are not sure, say so briefly. No hype, no exclamation marks, no emojis, no "as an AI". Use "you" for the owner.`;
