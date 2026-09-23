// Answer generation via the OpenAI Chat Completions API.
import type { KnowledgeEntry } from '@/lib/knowledge-schema';

export const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

export const SYSTEM_PROMPT = `You are a support assistant for families affected by murder or manslaughter abroad. You may only answer using the approved source context provided to you. If the answer is not clearly available in the approved context, say you do not have enough information and recommend contacting Murdered Abroad Charity, the nearest British Embassy, High Commission or Consulate, local police/authorities, or emergency services if there is immediate danger. Do not use general knowledge. Do not invent details. Do not give legal advice.

Response format:
- Start with a direct answer.
- Then give 2-4 practical next steps.
- End with who to contact if unsure.

Only cite or mention facts present in the approved source context. If approved context includes Murdered Abroad Charity contact details and the user needs direct help or the answer is uncertain, include those contact details.`;

export type ChatCompletionRequest = {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature: number;
  max_tokens: number;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export function buildContext(matches: KnowledgeEntry[]) {
  return matches
    .map(
      (entry, index) =>
        `Context ${index + 1}\nTitle: ${entry.title}\nCategory: ${entry.category}\nSource name: ${entry.sourceName}\nSource URL: ${entry.sourceUrl}\nContent: ${entry.content}`
    )
    .join('\n\n');
}

export function buildChatCompletionRequest({
  message,
  matches,
  model,
}: {
  message: string;
  matches: KnowledgeEntry[];
  model: string;
}): ChatCompletionRequest {
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `User question:\n${message}\n\nApproved source context:\n${buildContext(matches)}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 550,
  };
}

// Returns the trimmed model answer. Throws if the key is missing, the request fails
// or the answer is empty.
export async function generateAnswer({
  message,
  matches,
}: {
  message: string;
  matches: KnowledgeEntry[];
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('Missing OPENAI_API_KEY. Add it to .env.local for /api/chat.');
    throw new Error('Missing OpenAI API key');
  }

  const body = buildChatCompletionRequest({
    message,
    matches,
    model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  });

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI API request failed:', response.status, errorText);
    throw new Error('OpenAI API request failed');
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const answer = data.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error('OpenAI returned an empty answer');
  }

  return answer;
}
