// Server-side citations for grounded answers. Numbers and source metadata are derived
// from validated evidence IDs and the approved corpus, never from model output.
import type { ChatSource } from '@/lib/chat-types';
import type { GroundedSegment } from '@/lib/grounding';
import type { KnowledgeEntry } from '@/lib/knowledge-schema';

// Evidence ID -> citation number, numbered in order of first use.
export function assignCitationNumbers(segments: GroundedSegment[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const segment of segments) {
    for (const id of segment.evidenceIds) {
      if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
    }
  }
  return numbers;
}

// The answer text with citation markers after each segment, and one source per cited
// passage in citation order. Only cited passages are listed. Throws if a segment cites
// evidence outside the selected entries (validation should already have rejected it).
export function renderCitedAnswer(
  segments: GroundedSegment[],
  selectedEntries: KnowledgeEntry[]
): { answer: string; sources: ChatSource[] } {
  const entriesById = new Map(selectedEntries.map((entry) => [entry.id, entry]));
  const numbers = assignCitationNumbers(segments);

  const sources: ChatSource[] = [];
  for (const [id, citation] of numbers) {
    const entry = entriesById.get(id);
    if (!entry) throw new Error('Cited evidence is not in the selected evidence');
    sources.push({
      citation,
      title: entry.title,
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl,
      category: entry.category,
    });
  }

  const answer = segments
    .map((segment) => {
      const markers = [...numbers]
        .filter(([id]) => segment.evidenceIds.includes(id))
        .map(([, citation]) => `[${citation}]`)
        .join('');
      return `${segment.text} ${markers}`;
    })
    .join('\n\n');

  return { answer, sources };
}
