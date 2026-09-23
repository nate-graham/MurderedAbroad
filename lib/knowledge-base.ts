// Loads and validates the checked-in knowledge base.
import { promises as fs } from 'fs';
import path from 'path';
import { parseKnowledgeBase, type KnowledgeEntry } from '@/lib/knowledge-schema';

// Read on every call. Throws KnowledgeBaseValidationError if the checked-in data is invalid.
export async function loadKnowledgeBase(): Promise<KnowledgeEntry[]> {
  const filePath = path.join(process.cwd(), 'data', 'knowledge-base.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return parseKnowledgeBase(JSON.parse(raw));
}
