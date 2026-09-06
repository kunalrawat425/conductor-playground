import type { APIRoute } from 'astro';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

export const prerender = false;

const SYSTEM = `You are a helpful assistant for Relifish, a fresh seafood marketplace in India.
Relifish connects buyers directly with local fish sellers for same-day and pre-order delivery.
Answer questions about how the app works, pricing, availability, and ordering process.
Be concise and friendly. If you don't know something specific, say so honestly.`;

// BUG-15 fix: in-memory sliding-window rate limit per client IP.
// 8 requests / 60s. Each chat call burns ~500 Anthropic tokens ($). Without
// this, anyone could POST a loop and rack up bill.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;
const rateBuckets = new Map<string, number[]>();

function clientKey(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "anon";
}

function overLimit(key: string): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  arr.push(now);
  rateBuckets.set(key, arr);
  return arr.length > RATE_LIMIT_MAX;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const ip = clientKey(request);
    if (overLimit(ip)) {
      return new Response(JSON.stringify({ error: 'Too many requests. Try again in a minute.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }
    const { messages } = await request.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages required' }), { status: 400 });
    }
    // Cap conversation length so a huge history doesn't blow tokens.
    if (messages.length > 30) {
      return new Response(JSON.stringify({ error: 'Conversation too long. Start a new session.' }), { status: 400 });
    }
    // Cap individual message content length
    for (const m of messages) {
      if (typeof m?.content === 'string' && m.content.length > 2000) {
        return new Response(JSON.stringify({ error: 'Message too long' }), { status: 400 });
      }
    }

    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM,
      messages,
      maxTokens: 300,
    });

    return new Response(JSON.stringify({ content: text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to get response' }), { status: 500 });
  }
};
