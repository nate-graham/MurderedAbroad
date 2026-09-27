// Rendering tests for the support assistant's initial (server-rendered) state after the
// Phase 4A presentation pass: welcome copy, the immediate-help panel built from the
// signposting configuration, no prototype-only navigation, and accessible controls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import { getContactMethod, signposting } from '@/lib/signposting';

// tsx compiles JSX to React.createElement; Next.js uses the automatic runtime.
Object.assign(globalThis, { React });

async function render() {
  const { SupportAssistantChat } = await import('@/components/support-assistant/support-assistant-chat');
  return renderToStaticMarkup(React.createElement(SupportAssistantChat));
}

const EXAMPLE_QUESTIONS = [
  'What should I do first?',
  'Who should I contact if this happened abroad?',
  'Can the embassy help me?',
  'What if I do not speak the language?',
  'Who can help with repatriation?',
];

type ViewProps = import('@/components/support-assistant/support-assistant-chat').SupportAssistantViewProps;

// Renders the page for a given conversation state, as the chat shows it after questions
// have been asked.
async function renderView(overrides: Partial<ViewProps>) {
  const { SupportAssistantView } = await import('@/components/support-assistant/support-assistant-chat');
  const noop = () => {};
  const props: ViewProps = {
    messages: [],
    input: '',
    loading: false,
    error: '',
    helpOpen: false,
    onAsk: noop,
    onSubmit: noop,
    onInputChange: noop,
    onShowHelp: noop,
    onToggleHelp: noop,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(SupportAssistantView, props));
}

// The suggested-question buttons, in order, with whether each is disabled.
function suggestions(html: string) {
  const group = html.match(/<div class="example-questions" aria-label="Example questions" role="group">(.*?)<\/div>/)?.[1] ?? '';
  return [...group.matchAll(/<button class="example-question"( disabled="")? type="button">([^<]*)<\/button>/g)].map(
    (match) => ({ question: decode(match[2]), disabled: Boolean(match[1]) })
  );
}

const ANSWERED_CONVERSATION: ViewProps['messages'] = [
  { id: 'u1', role: 'user', content: 'Can the embassy help me?' },
  {
    id: 'a1',
    role: 'assistant',
    content: 'The embassy can offer consular support. [1]',
    sources: [{ citation: 1, title: 'Consular support', sourceName: 'GOV.UK', sourceUrl: 'https://www.gov.uk/x', category: 'embassy_consulate' }],
    fallbackUsed: false,
  },
];

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

describe('support assistant: initial state', () => {
  test('shows the assistant heading and the approved welcome copy', async () => {
    const html = decode(await render());
    assert.match(html, /<h1 id="chat-title">Support Assistant<\/h1>/);
    assert.match(html, /Guidance when you need it most/);
    assert.match(html, /<h2>Here to help you understand what to do next\.<\/h2>/);
    assert.match(
      html,
      /I'm here to help guide you through the practical and emotional steps that can\s+follow a death abroad\. You can ask about legal processes, repatriation, financial or\s+practical support, and what to do next\./
    );
    assert.doesNotMatch(html, /safe space/i);
  });

  test('shows every suggested question, in order and enabled', async () => {
    assert.deepEqual(
      suggestions(await render()),
      EXAMPLE_QUESTIONS.map((question) => ({ question, disabled: false }))
    );
  });

  test('keeps the source notice and no longer shows the prototype footnote', async () => {
    const html = decode(await render());
    assert.match(html, /Answers are generated from approved source material from GOV\.UK and Murdered\s+Abroad Charity\./);
    assert.doesNotMatch(html, /This prototype is for demonstration purposes only/);
    assert.doesNotMatch(html, /not a substitute for/);
    assert.doesNotMatch(html, /prototype-notice/);
  });

  test('renders no conversation, loading indicator or fabricated assistant message before a question', async () => {
    const html = await render();
    assert.match(html, /<div aria-label="Conversation" aria-live="polite" class="message-history" role="log"><\/div>/);
    assert.doesNotMatch(html, /chat-message/);
    assert.doesNotMatch(html, /typing-indicator/);
  });

  test('shows no timestamps and no prototype-only navigation', async () => {
    const html = await render();
    assert.doesNotMatch(html, /\b\d{1,2}:\d{2}\b/);
    assert.doesNotMatch(html, /href="#"/);
    assert.doesNotMatch(html, /<nav\b/);
    assert.doesNotMatch(html, />(Home|Chat|Guide|Directory)</);
  });
});

describe('support assistant: immediate help', () => {
  test('lists exactly the configured signposting routes, in order', async () => {
    const html = decode(await render());
    const names = [...html.matchAll(/<span class="help-route-name">([^<]*)<\/span>/g)].map((match) => match[1]);
    assert.deepEqual(
      names,
      signposting.contacts.map((contact) => contact.name)
    );
    for (const contact of signposting.contacts) {
      if (contact.description) assert.ok(html.includes(contact.description), contact.description);
    }
  });

  test('links only to the configured charity contact page and invents no phone or email actions', async () => {
    const html = await render();
    const links = [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => match[1]);
    assert.deepEqual(links, ['#support-assistant-input', getContactMethod(signposting.primaryContact, 'url')]);
    assert.doesNotMatch(html, /tel:|mailto:/);
    assert.ok(!html.includes(getContactMethod(signposting.primaryContact, 'phone')));
    assert.match(html, /\(opens in a new tab\)/);
  });

  test('"Need help now?" and the collapsible help panel are wired to the panel and expanded initially', async () => {
    const html = await render();
    assert.match(html, /<button aria-controls="immediate-help" class="help-now" type="button">Need help now\?<\/button>/);
    assert.match(html, /<aside aria-labelledby="immediate-help-title" class="help-panel" id="immediate-help" tabindex="-1">/);
    assert.match(html, /<h2 id="immediate-help-title">Need immediate help\?<\/h2>/);
    assert.match(html, /aria-controls="immediate-help-routes" aria-expanded="true"/);
    assert.match(html, /id="immediate-help-routes"/);
  });
});

describe('support assistant: composer', () => {
  test('has a labelled question field and a disabled send button until text is entered', async () => {
    const html = await render();
    assert.match(html, /<label class="sr-only" for="support-assistant-input">Ask a question<\/label>/);
    assert.match(html, /<textarea id="support-assistant-input" placeholder="Ask a question about what to do next\.\.\." rows="2">/);
    assert.match(html, /<button class="send-button" disabled="" type="submit">.*<span class="send-label">Send<\/span><\/button>/);
  });

  test('icons are decorative and hidden from assistive technology', async () => {
    const html = await render();
    const svgs = html.match(/<svg[^>]*>/g) ?? [];
    assert.ok(svgs.length > 0);
    for (const svg of svgs) assert.match(svg, /aria-hidden="true"/);
  });
});

describe('layout', () => {
  test('never disables zoom and loads fonts through next/font, not a runtime stylesheet', () => {
    const layout = readFileSync('app/layout.tsx', 'utf8');
    assert.doesNotMatch(layout, /maximumScale|userScalable|user-scalable|maximum-scale/);
    assert.match(layout, /from 'next\/font\/google'/);
    assert.doesNotMatch(layout, /fonts\.googleapis|<link/);
  });
});

describe('support assistant: suggested questions during a conversation', () => {
  test('sit above the conversation, outside the disappearing welcome state', async () => {
    const html = await render();
    const suggestionsAt = html.indexOf('class="example-questions"');
    assert.ok(suggestionsAt > html.indexOf('id="chat-title"'), 'after the chat heading');
    assert.ok(suggestionsAt < html.indexOf('class="message-area"'), 'before the conversation');
    const welcome = html.slice(html.indexOf('class="welcome"'), html.indexOf('role="log"'));
    assert.doesNotMatch(welcome, /example-question/);
  });

  test('all remain visible and enabled after a question has been asked and answered', async () => {
    const html = await renderView({ messages: ANSWERED_CONVERSATION });
    assert.doesNotMatch(html, /class="welcome"/, 'the welcome state has gone');
    assert.match(html, /chat-message-user/);
    assert.deepEqual(
      suggestions(html),
      EXAMPLE_QUESTIONS.map((question) => ({ question, disabled: false }))
    );
  });

  test('the suggestion that was used stays available alongside the others', async () => {
    const used = await renderView({
      messages: [
        ...ANSWERED_CONVERSATION,
        { id: 'u2', role: 'user', content: 'Who can help with repatriation?' },
        { id: 'a2', role: 'assistant', content: 'Answer. [1]', sources: [], fallbackUsed: false },
      ],
    });
    assert.deepEqual(suggestions(used).map((suggestion) => suggestion.question), EXAMPLE_QUESTIONS);
    assert.ok(suggestions(used).every((suggestion) => !suggestion.disabled));
  });

  test('stay visible while an answer is pending (disabled only until it arrives, as before)', async () => {
    const html = await renderView({ messages: [ANSWERED_CONVERSATION[0]], loading: true });
    assert.match(html, /typing-indicator/);
    assert.deepEqual(
      suggestions(html),
      EXAMPLE_QUESTIONS.map((question) => ({ question, disabled: true }))
    );
  });

  test('no footnote in an active conversation either', async () => {
    const html = await renderView({ messages: ANSWERED_CONVERSATION });
    assert.doesNotMatch(html, /This prototype is for demonstration purposes only/);
  });
});
