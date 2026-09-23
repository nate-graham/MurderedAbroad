import { NextResponse } from 'next/server';
import type { ChatErrorResponse, ChatSuccessResponse } from '@/lib/chat-types';
import { emergencyResponse, fallbackResponse } from '@/lib/fixed-responses';
import { generateAnswer } from '@/lib/generation';
import { loadKnowledgeBase } from '@/lib/knowledge-base';
import { retrieve } from '@/lib/retrieval';
import { isEmergencyMessage } from '@/lib/safety';
import { buildSources } from '@/lib/sources';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: unknown };
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!message) {
      return NextResponse.json<ChatErrorResponse>({ error: 'Please enter a question.' }, { status: 400 });
    }

    if (isEmergencyMessage(message)) {
      return NextResponse.json<ChatSuccessResponse>(emergencyResponse());
    }

    const knowledgeBase = await loadKnowledgeBase();
    const { matches, fallbackUsed } = retrieve(message, knowledgeBase);

    if (fallbackUsed) {
      return NextResponse.json<ChatSuccessResponse>(fallbackResponse());
    }

    const answer = await generateAnswer({ message, matches });

    return NextResponse.json<ChatSuccessResponse>({
      answer,
      sources: buildSources(matches),
      fallbackUsed,
    });
  } catch (error) {
    console.error('/api/chat failed:', error);
    return NextResponse.json<ChatErrorResponse>(
      {
        error:
          'Sorry, the assistant could not respond right now. Please try again, or contact official support routes if the matter is urgent.',
      },
      { status: 500 }
    );
  }
}
