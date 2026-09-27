'use client';

import { FormEvent, type RefObject, useEffect, useRef, useState } from 'react';
import type { ChatErrorResponse, ChatSource, ChatSuccessResponse } from '@/lib/chat-types';
import { signposting } from '@/lib/signposting';
import {
  AlertIcon,
  BuildingIcon,
  ChatIcon,
  ChevronIcon,
  ExternalIcon,
  HeartIcon,
  LogoIcon,
  SendIcon,
  ShieldIcon,
} from './icons';
import { SourceList } from './source-list';

type ChatRole = 'assistant' | 'user';

export type ChatMessage = {
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

// Icons for the configured signposting routes. Only the charity has a configured web
// address; the other routes are shown as guidance, not links.
const contactIcons: Record<string, typeof HeartIcon> = {
  'murdered-abroad-charity': HeartIcon,
  'british-embassy': BuildingIcon,
  'local-police': ShieldIcon,
  'emergency-services': AlertIcon,
};

function contactUrl(contactId: string) {
  const contact = signposting.contacts.find((candidate) => candidate.id === contactId);
  const method = contact?.methods.find((candidate) => candidate.kind === 'url');
  return method?.value;
}

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SupportAssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // On small screens the help panel sits above the chat: open until the first question,
  // then collapsed so the conversation has room. It is always open on wide screens.
  const [helpOpen, setHelpOpen] = useState(true);
  const latestMessageRef = useRef<HTMLDivElement | null>(null);
  const helpPanelRef = useRef<HTMLElement | null>(null);

  const conversationStarted = messages.length > 0;

  useEffect(() => {
    if (!conversationStarted && !loading) return;
    latestMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, loading, conversationStarted]);

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

    if (!conversationStarted) setHelpOpen(false);
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

      const data = (await response.json()) as Partial<ChatSuccessResponse> &
        Partial<ChatErrorResponse>;

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

  // "Need help now?": open the help panel, bring it into view and move focus to it.
  function showHelp() {
    setHelpOpen(true);
    requestAnimationFrame(() => {
      const panel = helpPanelRef.current;
      if (!panel) return;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      panel.focus({ preventScroll: true });
    });
  }

  return (
    <SupportAssistantView
      error={error}
      helpOpen={helpOpen}
      helpPanelRef={helpPanelRef}
      input={input}
      latestMessageRef={latestMessageRef}
      loading={loading}
      messages={messages}
      onAsk={(question) => void sendMessage(question)}
      onInputChange={setInput}
      onShowHelp={showHelp}
      onSubmit={handleSubmit}
      onToggleHelp={() => setHelpOpen((open) => !open)}
    />
  );
}

export type SupportAssistantViewProps = {
  messages: ChatMessage[];
  input: string;
  loading: boolean;
  error: string;
  helpOpen: boolean;
  latestMessageRef?: RefObject<HTMLDivElement | null>;
  helpPanelRef?: RefObject<HTMLElement | null>;
  onAsk: (question: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInputChange: (value: string) => void;
  onShowHelp: () => void;
  onToggleHelp: () => void;
};

// The page itself, rendered from the chat state. Kept separate from the state and send
// logic above so it can be rendered directly for any conversation state.
export function SupportAssistantView({
  messages,
  input,
  loading,
  error,
  helpOpen,
  latestMessageRef,
  helpPanelRef,
  onAsk,
  onSubmit,
  onInputChange,
  onShowHelp,
  onToggleHelp,
}: SupportAssistantViewProps) {
  const conversationStarted = messages.length > 0;

  return (
    <div className="app">
      <a className="skip-link" href="#support-assistant-input">
        Skip to question
      </a>

      <header className="site-header">
        <div className="brand">
          <LogoIcon className="brand-logo" />
          <span className="brand-name">Murdered Abroad</span>
        </div>
        <button aria-controls="immediate-help" className="help-now" onClick={onShowHelp} type="button">
          Need help now?
        </button>
      </header>

      <main className="page">
        <aside
          aria-labelledby="immediate-help-title"
          className={`help-panel${helpOpen ? '' : ' is-collapsed'}`}
          id="immediate-help"
          ref={helpPanelRef}
          tabIndex={-1}
        >
          <div className="help-heading">
            <AlertIcon className="help-heading-icon" />
            <h2 id="immediate-help-title">Need immediate help?</h2>
            <button
              aria-controls="immediate-help-routes"
              aria-expanded={helpOpen}
              className="help-toggle"
              onClick={onToggleHelp}
              type="button"
            >
              <span className="sr-only">{helpOpen ? 'Hide' : 'Show'} help routes</span>
              <ChevronIcon className="help-toggle-icon" />
            </button>
          </div>
          <div className="help-body" id="immediate-help-routes">
            <p className="help-intro">Please use these routes if you need urgent help.</p>
            <ul className="help-routes">
              {signposting.contacts.map((contact) => {
                const ContactIcon = contactIcons[contact.id] ?? HeartIcon;
                const url = contactUrl(contact.id);
                const content = (
                  <>
                    <span className={`help-route-icon help-route-icon-${contact.id}`}>
                      <ContactIcon />
                    </span>
                    <span className="help-route-text">
                      <span className="help-route-name">{contact.name}</span>
                      {contact.description ? (
                        <span className="help-route-description">{contact.description}</span>
                      ) : null}
                    </span>
                  </>
                );
                return (
                  <li key={contact.id}>
                    {url ? (
                      <a className="help-route help-route-link" href={url} rel="noreferrer" target="_blank">
                        {content}
                        <ExternalIcon className="help-route-external" />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <div className="help-route">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <section aria-labelledby="chat-title" className={`chat-panel${conversationStarted ? ' is-active' : ''}`}>
          <header className="chat-header">
            <h1 id="chat-title">Support Assistant</h1>
            <p>Guidance when you need it most</p>
          </header>

          {/* Always available, before and throughout the conversation. */}
          <div className="example-questions" aria-label="Example questions" role="group">
            {exampleQuestions.map((question) => (
              <button
                className="example-question"
                disabled={loading}
                key={question}
                onClick={() => onAsk(question)}
                type="button"
              >
                {question}
              </button>
            ))}
          </div>

          <div className="message-area">
            {conversationStarted ? null : (
              <div className="welcome">
                <div className="welcome-icon">
                  <ChatIcon />
                </div>
                <h2>Here to help you understand what to do next.</h2>
                <p>
                  I&apos;m here to help guide you through the practical and emotional steps that can
                  follow a death abroad. You can ask about legal processes, repatriation, financial or
                  practical support, and what to do next.
                </p>
              </div>
            )}

            <div aria-label="Conversation" aria-live="polite" className="message-history" role="log">
              {messages.map((message, index) => (
                <article
                  className={`chat-message chat-message-${message.role}`}
                  key={message.id}
                  ref={index === messages.length - 1 ? latestMessageRef : undefined}
                >
                  <span className="sr-only">{message.role === 'assistant' ? 'Assistant:' : 'You:'}</span>
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
                  {message.sources ? <SourceList messageId={message.id} sources={message.sources} /> : null}
                </article>
              ))}
              {loading ? (
                <div className="typing-indicator" ref={latestMessageRef}>
                  <span aria-hidden="true" className="typing-dots">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="sr-only">Searching the approved source material...</span>
                </div>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="chat-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="composer">
            <form className="chat-form" onSubmit={onSubmit}>
              <label className="sr-only" htmlFor="support-assistant-input">
                Ask a question
              </label>
              <textarea
                id="support-assistant-input"
                onChange={(event) => onInputChange(event.target.value)}
                placeholder="Ask a question about what to do next..."
                rows={2}
                value={input}
              />
              <button className="send-button" disabled={loading || !input.trim()} type="submit">
                <SendIcon className="send-icon" />
                <span className="send-label">{loading ? 'Sending...' : 'Send'}</span>
              </button>
            </form>
            <p className="source-notice">
              Answers are generated from approved source material from GOV.UK and Murdered
              Abroad Charity.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
