import { NextResponse } from 'next/server';
import { isMessageTooLong, MESSAGE_TOO_LONG_ERROR, readChatRequest } from '@/lib/chat-request';
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
    const parsed = await readChatRequest(request);
    if (!parsed.ok) {
      return NextResponse.json<ChatErrorResponse>({ error: parsed.error }, { status: 400 });
    }
    const { message } = parsed;

    // Crisis detection runs before the length limit so that a long message describing
    // a crisis still receives the emergency guidance rather than an error.
    if (isEmergencyMessage(message)) {
      return NextResponse.json<ChatSuccessResponse>(emergencyResponse());
    }

    if (isMessageTooLong(message)) {
      return NextResponse.json<ChatErrorResponse>({ error: MESSAGE_TOO_LONG_ERROR }, { status: 400 });
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
