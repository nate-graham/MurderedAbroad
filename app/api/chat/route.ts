import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

type KnowledgeEntry = {
  title: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
  content: string;
};

type ChatSource = {
  title: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
};

const emergencyPattern =
  /\b(immediate danger|danger now|urgent danger|emergency|suicide|self[-\s]?harm|kill myself|end my life|threat|threatened|violence happening|being attacked|attack happening|unsafe now|right now)\b/i;

const fallbackAnswer =
  'I could not find a clear answer in the approved source material.\n\nThe safest next step is to contact Murdered Abroad Charity directly: support@murdered-abroad.org.uk or helpline 0845 123 2384.\n\nYou can also contact the nearest British Embassy, High Commission or Consulate, or local police/authorities in the country involved. If there is immediate danger, contact emergency services immediately.';

const murderedAbroadContactSource: ChatSource = {
  title: 'How to contact Murdered Abroad Charity',
  sourceName: 'Murdered Abroad Charity',
  sourceUrl: 'https://www.murdered-abroad.org.uk/contact',
  category: 'charity_contact',
};

const stopWords = new Set([
  'a',
  'about',
  'after',
  'an',
  'and',
  'are',
  'can',
  'do',
  'for',
  'from',
  'has',
  'have',
  'help',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'or',
  'our',
  'should',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'who',
  'with',
]);

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function scoreEntry(entry: KnowledgeEntry, messageTokens: string[]) {
  const title = tokenize(entry.title);
  const category = tokenize(entry.category);
  const sourceName = tokenize(entry.sourceName);
  const content = tokenize(entry.content);

  return messageTokens.reduce((score, token) => {
    let nextScore = score;
    if (title.includes(token)) nextScore += 5;
    if (category.includes(token)) nextScore += 4;
    if (sourceName.includes(token)) nextScore += 2;
    if (content.includes(token)) nextScore += 1;
    return nextScore;
  }, 0);
}

async function loadKnowledgeBase() {
  const filePath = path.join(process.cwd(), 'data', 'knowledge-base.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as KnowledgeEntry[];
}

function getEmergencyResponse() {
  return {
    answer:
      'If there is immediate danger, contact emergency services immediately.\n\n1. Contact local emergency services now.\n2. Contact local police or authorities in the country involved.\n3. Once the immediate danger is being handled, contact Murdered Abroad Charity at support@murdered-abroad.org.uk or helpline 0845 123 2384, or contact the nearest British Embassy, High Commission or Consulate for support routes.\n\nIf you are unsure who to contact, contact emergency services first if anyone is at immediate risk.',
    sources: [murderedAbroadContactSource],
    fallbackUsed: true,
  };
}

async function callOpenAI({
  message,
  matches,
}: {
  message: string;
  matches: KnowledgeEntry[];
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('Missing OPENAI_API_KEY. Add it to .env.local for /api/chat.');
    throw new Error('Missing OpenAI API key');
  }

  const context = matches
    .map(
      (entry, index) =>
        `Context ${index + 1}\nTitle: ${entry.title}\nCategory: ${entry.category}\nSource name: ${entry.sourceName}\nSource URL: ${entry.sourceUrl}\nContent: ${entry.content}`
    )
    .join('\n\n');

  const systemPrompt = `You are a support assistant for families affected by murder or manslaughter abroad. You may only answer using the approved source context provided to you. If the answer is not clearly available in the approved context, say you do not have enough information and recommend contacting Murdered Abroad Charity, the nearest British Embassy, High Commission or Consulate, local police/authorities, or emergency services if there is immediate danger. Do not use general knowledge. Do not invent details. Do not give legal advice.

Response format:
- Start with a direct answer.
- Then give 2-4 practical next steps.
- End with who to contact if unsure.

Only cite or mention facts present in the approved source context. If approved context includes Murdered Abroad Charity contact details and the user needs direct help or the answer is uncertain, include those contact details.`;

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `User question:\n${message}\n\nApproved source context:\n${context}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 550,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
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

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: unknown };
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!message) {
      return NextResponse.json({ error: 'Please enter a question.' }, { status: 400 });
    }

    if (emergencyPattern.test(message)) {
      return NextResponse.json(getEmergencyResponse());
    }

    const knowledgeBase = await loadKnowledgeBase();
    const messageTokens = tokenize(message);
    const scored = knowledgeBase
      .map((entry) => ({ entry, score: scoreEntry(entry, messageTokens) }))
      .sort((a, b) => b.score - a.score);

    const topScore = scored[0]?.score ?? 0;
    const fallbackUsed = topScore < 4;

    if (fallbackUsed) {
      return NextResponse.json({
        answer: fallbackAnswer,
        sources: [murderedAbroadContactSource],
        fallbackUsed: true,
      });
    }

    const matches = scored.filter((item) => item.score > 0).slice(0, 5).map((item) => item.entry);

    const answer = await callOpenAI({ message, matches });

    if (!answer) {
      throw new Error('OpenAI returned an empty answer');
    }

    const sourceKeys = new Set<string>();
    const sources: ChatSource[] = [];

    for (const entry of matches.slice(0, 5)) {
      const key = entry.sourceName;
      if (sourceKeys.has(key)) continue;
      sourceKeys.add(key);
      sources.push({
        title: entry.title,
        sourceName: entry.sourceName,
        sourceUrl: entry.sourceUrl,
        category: entry.category,
      });
    }

    return NextResponse.json({ answer, sources, fallbackUsed });
  } catch (error) {
    console.error('/api/chat failed:', error);
    return NextResponse.json(
      {
        error:
          'Sorry, the assistant could not respond right now. Please try again, or contact official support routes if the matter is urgent.',
      },
      { status: 500 }
    );
  }
}
