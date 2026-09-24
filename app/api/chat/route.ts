import { NextResponse } from 'next/server';
import type { ChatErrorResponse, ChatSuccessResponse } from '@/lib/chat-types';
import { renderCitedAnswer } from '@/lib/citations';
import { emergencyResponse, fallbackResponse } from '@/lib/fixed-responses';
import { requestGroundedAnswer } from '@/lib/generation';
import { validateGroundedOutput } from '@/lib/grounding';
import { loadKnowledgeBase } from '@/lib/knowledge-base';
import { retrieve } from '@/lib/retrieval';
import { isEmergencyMessage } from '@/lib/safety';

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

    const output = await requestGroundedAnswer({ message, matches });
    const grounded = validateGroundedOutput(output, matches);

    if (grounded.outcome !== 'answered') {
      // Log only the class of failure: never the question or the model output.
      console.warn('Grounded answer not used:', grounded.outcome === 'rejected' ? grounded.reason : 'unsupported');
      return NextResponse.json<ChatSuccessResponse>(fallbackResponse());
    }

    const { answer, sources } = renderCitedAnswer(grounded.segments, matches);

    return NextResponse.json<ChatSuccessResponse>({ answer, sources, fallbackUsed });
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
