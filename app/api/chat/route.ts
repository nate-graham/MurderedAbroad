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

// Upper bound on one invocation. The OpenAI call is aborted after PROVIDER_TIMEOUT_MS
// (20 s); the rest of the request is fast and local, so 30 s is never reached in normal
// operation and caps what a stuck request can cost.
export const maxDuration = 30;

// Chat responses are specific to one question and must never be stored by a browser,
// proxy or CDN.
function json<T>(body: T, init?: { status?: number }) {
  return NextResponse.json<T>(body, { ...init, headers: { 'Cache-Control': 'no-store' } });
}

// Operator kill switch: CHAT_GENERATION_DISABLED=true stops all OpenAI calls (for a cost
// spike or abuse) while crisis signposting and the fixed fallback keep working.
function generationDisabled() {
  return process.env.CHAT_GENERATION_DISABLED === 'true';
}

export async function POST(request: Request) {
  try {
    const parsed = await readChatRequest(request);
    if (!parsed.ok) {
      return json<ChatErrorResponse>({ error: parsed.error }, { status: parsed.status });
    }
    const { message } = parsed;

    // Crisis detection runs before the length limit so that a long message describing
    // a crisis still receives the emergency guidance rather than an error.
    if (isEmergencyMessage(message)) {
      return json<ChatSuccessResponse>(emergencyResponse());
    }

    if (isMessageTooLong(message)) {
      return json<ChatErrorResponse>({ error: MESSAGE_TOO_LONG_ERROR }, { status: 400 });
    }

    if (generationDisabled()) {
      return json<ChatSuccessResponse>(fallbackResponse());
    }

    const knowledgeBase = await loadKnowledgeBase();
    const { matches, fallbackUsed } = retrieve(message, knowledgeBase);

    if (fallbackUsed) {
      return json<ChatSuccessResponse>(fallbackResponse());
    }

    const output = await requestGroundedAnswer({ message, matches });
    const grounded = validateGroundedOutput(output, matches);

    if (grounded.outcome !== 'answered') {
      // Log only the class of failure: never the question or the model output.
      console.warn('Grounded answer not used:', grounded.outcome === 'rejected' ? grounded.reason : 'unsupported');
      return json<ChatSuccessResponse>(fallbackResponse());
    }

    const { answer, sources } = renderCitedAnswer(grounded.segments, matches);

    return json<ChatSuccessResponse>({ answer, sources, fallbackUsed });
  } catch (error) {
    console.error('/api/chat failed:', error);
    return json<ChatErrorResponse>(
      {
        error:
          'Sorry, the assistant could not respond right now. Please try again, or contact official support routes if the matter is urgent.',
      },
      { status: 500 }
    );
  }
}
