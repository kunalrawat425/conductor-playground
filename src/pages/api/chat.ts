import type { APIRoute } from 'astro';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

const SYSTEM = `You are a helpful assistant for Relifish, a fresh seafood marketplace in India.
Relifish connects buyers directly with local fish sellers for same-day and pre-order delivery.
Answer questions about how the app works, pricing, availability, and ordering process.
Be concise and friendly. If you don't know something specific, say so honestly.`;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { messages } = await request.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages required' }), { status: 400 });
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
