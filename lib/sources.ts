// Builds the source list returned with a generated answer.
import type { ChatSource } from '@/lib/chat-types';
import type { KnowledgeEntry } from '@/lib/knowledge-schema';

// One source per source name; the first (highest-ranked) entry for each name wins.
export function buildSources(matches: KnowledgeEntry[]): ChatSource[] {
  const sourceKeys = new Set<string>();
  const sources: ChatSource[] = [];

  for (const entry of matches) {
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

  return sources;
}
