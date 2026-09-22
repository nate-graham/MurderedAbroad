// Knowledge-base entry type and runtime validation for data/knowledge-base.json.
// Describes the current entry shape; the knowledge base itself is not yet
// loaded through this module.

export type KnowledgeEntry = {
  title: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
  content: string;
};

const requiredStringFields = ['title', 'sourceName', 'sourceUrl', 'category', 'content'] as const;

export class KnowledgeBaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeBaseValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseKnowledgeEntry(value: unknown, index: number): KnowledgeEntry {
  if (!isRecord(value)) {
    throw new KnowledgeBaseValidationError(`Entry ${index} is not an object`);
  }

  for (const field of requiredStringFields) {
    const fieldValue = value[field];
    if (typeof fieldValue !== 'string' || fieldValue.trim() === '') {
      throw new KnowledgeBaseValidationError(`Entry ${index} has a missing or empty "${field}"`);
    }
  }

  const sourceUrl = value.sourceUrl as string;
  let protocol: string;
  try {
    protocol = new URL(sourceUrl).protocol;
  } catch {
    throw new KnowledgeBaseValidationError(`Entry ${index} has an invalid sourceUrl`);
  }
  if (protocol !== 'https:') {
    throw new KnowledgeBaseValidationError(`Entry ${index} sourceUrl must use https`);
  }

  return {
    title: value.title as string,
    sourceName: value.sourceName as string,
    sourceUrl,
    category: value.category as string,
    content: value.content as string,
  };
}

export function parseKnowledgeBase(value: unknown): KnowledgeEntry[] {
  if (!Array.isArray(value)) {
    throw new KnowledgeBaseValidationError('Knowledge base must be an array');
  }
  if (value.length === 0) {
    throw new KnowledgeBaseValidationError('Knowledge base must not be empty');
  }
  return value.map((entry, index) => parseKnowledgeEntry(entry, index));
}
