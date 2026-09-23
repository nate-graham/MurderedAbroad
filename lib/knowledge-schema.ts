// Knowledge-base entry type and runtime validation for data/knowledge-base.json,
// applied by lib/knowledge-base.ts on every load.

export type KnowledgeEntry = {
  // Stable evidence ID for the passage, e.g. "govuk-lawyers-abroad".
  id: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
  content: string;
};

const knowledgeEntryFields = ['id', 'title', 'sourceName', 'sourceUrl', 'category', 'content'] as const;
const allowedFields = new Set<string>(knowledgeEntryFields);

// Lowercase kebab-case: letters and digits separated by single hyphens.
export const KNOWLEDGE_ENTRY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class KnowledgeBaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeBaseValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(value: Record<string, unknown>, field: string, index: number): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'string' || fieldValue.trim() === '') {
    throw new KnowledgeBaseValidationError(`Entry ${index} has a missing or empty "${field}"`);
  }
  return fieldValue;
}

export function parseKnowledgeEntry(value: unknown, index: number): KnowledgeEntry {
  if (!isRecord(value)) {
    throw new KnowledgeBaseValidationError(`Entry ${index} is not an object`);
  }

  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new KnowledgeBaseValidationError(`Entry ${index} has an unknown field "${field}"`);
    }
  }

  const id = readRequiredString(value, 'id', index);
  const title = readRequiredString(value, 'title', index);
  const sourceName = readRequiredString(value, 'sourceName', index);
  const sourceUrl = readRequiredString(value, 'sourceUrl', index);
  const category = readRequiredString(value, 'category', index);
  const content = readRequiredString(value, 'content', index);

  if (!KNOWLEDGE_ENTRY_ID_PATTERN.test(id)) {
    throw new KnowledgeBaseValidationError(`Entry ${index} id "${id}" must be lowercase kebab-case`);
  }

  let protocol: string;
  try {
    protocol = new URL(sourceUrl).protocol;
  } catch {
    throw new KnowledgeBaseValidationError(`Entry ${index} has an invalid sourceUrl`);
  }
  if (protocol !== 'https:') {
    throw new KnowledgeBaseValidationError(`Entry ${index} sourceUrl must use https`);
  }

  return { id, title, sourceName, sourceUrl, category, content };
}

export function parseKnowledgeBase(value: unknown): KnowledgeEntry[] {
  if (!Array.isArray(value)) {
    throw new KnowledgeBaseValidationError('Knowledge base must be an array');
  }
  if (value.length === 0) {
    throw new KnowledgeBaseValidationError('Knowledge base must not be empty');
  }

  const entries = value.map((entry, index) => parseKnowledgeEntry(entry, index));

  const firstIndexById = new Map<string, number>();
  entries.forEach((entry, index) => {
    const firstIndex = firstIndexById.get(entry.id);
    if (firstIndex !== undefined) {
      throw new KnowledgeBaseValidationError(
        `Duplicate id "${entry.id}" at entries ${firstIndex} and ${index}`
      );
    }
    firstIndexById.set(entry.id, index);
  });

  return entries;
}
