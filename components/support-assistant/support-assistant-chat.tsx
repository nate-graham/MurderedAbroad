'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type ChatRole = 'assistant' | 'user';

type ChatSource = {
  title: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
};

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sources?: ChatSource[];
  fallbackUsed?: boolean;
};

const exampleQuestions = [
  'What should I do first?',
  'Who should I contact if this happened abroad?',
  'Can the embassy help me?',
  'What if I do not speak the language?',
  'Who can help with repatriation?',
];

const initialMessage: ChatMessage = {
  id: 'initial-assistant-message',
  role: 'assistant',
  content:
    'I can help you find calm, practical next steps from approved GOV.UK and Murdered Abroad Charity source material. Ask what happened or choose an example question.',
};

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SupportAssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const latestMessageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    latestMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function sendMessage(nextMessage: string) {
    const trimmed = nextMessage.trim();

    if (!trimmed || loading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: 'user',
      content: trimmed,
    };

    setMessages((current) => [...current, userMessage]);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = (await response.json()) as {
        answer?: string;
        sources?: ChatSource[];
        fallbackUsed?: boolean;
        error?: string;
      };

      if (!response.ok || !data.answer) {
        throw new Error(data.error || 'The assistant could not respond.');
      }

      const assistantAnswer = data.answer;

      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: 'assistant',
          content: assistantAnswer,
          sources: data.sources,
          fallbackUsed: data.fallbackUsed,
        },
      ]);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <main className="support-assistant-page">
      <section className="support-assistant-shell" aria-label="Support Assistant">
        <header className="support-assistant-header">
          <div>
            <h1>Support Assistant</h1>
            <p>Guidance for families affected by murder or manslaughter abroad</p>
          </div>
          <aside className="prototype-notice">
            This prototype is for demonstration purposes only and is not a substitute for
            emergency, legal, medical, or official consular advice.
          </aside>
        </header>

        <div className="support-assistant-layout">
          <section className="chat-panel" aria-label="Chat messages">
            <div className="example-questions" aria-label="Example questions">
              {exampleQuestions.map((question) => (
                <button
                  className="example-question"
                  disabled={loading}
                  key={question}
                  onClick={() => void sendMessage(question)}
                  type="button"
                >
                  {question}
                </button>
              ))}
            </div>

            <div className="message-history">
              {messages.map((message, index) => (
                <article
                  className={`chat-message chat-message-${message.role}`}
                  key={message.id}
                  ref={index === messages.length - 1 ? latestMessageRef : undefined}
                >
                  <div className="message-role">
                    {message.role === 'assistant' ? 'Assistant' : 'You'}
                  </div>
                  <div className="message-content">
                    {message.content.split('\n').map((line, lineIndex) => (
                      <p key={`${message.id}-${lineIndex}`}>{line}</p>
                    ))}
                  </div>
                  {message.fallbackUsed ? (
                    <p className="fallback-note">
                      The assistant could not find a clear answer in the approved source
                      material.
                    </p>
                  ) : null}
                  {message.sources?.length ? (
                    <div className="source-list" aria-label="Sources used">
                      <span>Sources</span>
                      <ul>
                        {message.sources.map((source) => (
                          <li key={`${message.id}-${source.category}-${source.title}`}>
                            <a href={source.sourceUrl} rel="noreferrer" target="_blank">
                              {source.sourceName}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              ))}
              {loading ? (
                <div className="chat-message chat-message-assistant" ref={latestMessageRef}>
                  <div className="message-role">Assistant</div>
                  <div className="message-content">
                    <p>Searching the approved source material...</p>
                  </div>
                </div>
              ) : null}
            </div>

            {error ? <div className="chat-error">{error}</div> : null}

            <form className="chat-form" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="support-assistant-input">
                Ask a question
              </label>
              <textarea
                id="support-assistant-input"
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask what to do next..."
                rows={3}
                value={input}
              />
              <button disabled={loading || !input.trim()} type="submit">
                {loading ? 'Sending...' : 'Send'}
              </button>
            </form>
          </section>

          <aside className="support-contact-box">
            <h2>Not sure who to contact?</h2>
            <ul>
              <li>Murdered Abroad Charity</li>
              <li>British Embassy, High Commission or Consulate</li>
              <li>Local police or authorities</li>
              <li>Emergency services if there is immediate danger</li>
            </ul>
          </aside>
        </div>

        <footer className="source-notice">
          Answers are generated from approved source material from GOV.UK and Murdered
          Abroad Charity.
        </footer>
      </section>
    </main>
  );
}
