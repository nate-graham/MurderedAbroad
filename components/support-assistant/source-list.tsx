import type { ChatSource } from '@/lib/chat-types';

// Sources shown under an assistant message. Cited evidence shows its citation number,
// approved title and publisher; the fixed contact source shows its publisher.
export function SourceList({ messageId, sources }: { messageId: string; sources: ChatSource[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="source-list" aria-label="Sources used">
      <span>Sources</span>
      <ul>
        {sources.map((source) => (
          <li key={`${messageId}-${source.citation ?? source.category}-${source.title}`}>
            {source.citation ? <span className="source-citation">[{source.citation}] </span> : null}
            <a href={source.sourceUrl} rel="noreferrer" target="_blank">
              {source.citation ? source.title : source.sourceName}
            </a>
            {source.citation ? <span className="source-publisher"> — {source.sourceName}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
