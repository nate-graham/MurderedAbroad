// Shared request/response contract for POST /api/chat.
// These types mirror the JSON the route currently returns; they are not yet
// imported by the route or the chat component.

export type ChatRequest = {
  message: string;
};

export type ChatSource = {
  title: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
};

export type ChatSuccessResponse = {
  answer: string;
  sources: ChatSource[];
  fallbackUsed: boolean;
};

export type ChatErrorResponse = {
  error: string;
};

export type ChatResponse = ChatSuccessResponse | ChatErrorResponse;

export function isChatErrorResponse(value: ChatResponse): value is ChatErrorResponse {
  return 'error' in value;
}
