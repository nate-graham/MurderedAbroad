// Rendering tests for the chat source list: grounded citations and the fixed
// fallback/emergency contact source.
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import type { ChatSource } from '@/lib/chat-types';

// tsx compiles JSX to React.createElement; Next.js uses the automatic runtime, so the
// component does not import React itself.
Object.assign(globalThis, { React });

async function render(sources: ChatSource[]) {
  const { SourceList } = await import('@/components/support-assistant/source-list');
  return renderToStaticMarkup(React.createElement(SourceList, { messageId: 'm1', sources }));
}

describe('SourceList', () => {
  test('shows citation number, approved title, publisher and an accessible link', async () => {
    const html = await render([
      {
        citation: 1,
        title: 'Lawyers abroad',
        sourceName: 'GOV.UK',
        sourceUrl: 'https://www.gov.uk/guide',
        category: 'lawyers',
      },
    ]);

    assert.match(html, /aria-label="Sources used"/);
    assert.match(html, /\[1\]/);
    assert.match(html, /<a href="https:\/\/www\.gov\.uk\/guide" rel="noreferrer" target="_blank">Lawyers abroad<\/a>/);
    assert.match(html, /GOV\.UK/);
    assert.doesNotMatch(html, /govuk-lawyers-abroad/);
  });

  test('still renders the fixed contact source without a citation number', async () => {
    const html = await render([
      {
        title: 'How to contact Murdered Abroad Charity',
        sourceName: 'Murdered Abroad Charity',
        sourceUrl: 'https://www.murdered-abroad.org.uk/contact',
        category: 'charity_contact',
      },
    ]);

    assert.match(html, /<a href="https:\/\/www\.murdered-abroad\.org\.uk\/contact"[^>]*>Murdered Abroad Charity<\/a>/);
    assert.doesNotMatch(html, /\[\d+\]/);
  });

  test('escapes text rather than rendering markup', async () => {
    const html = await render([
      { citation: 1, title: '<b>Title</b>', sourceName: 'Publisher', sourceUrl: 'https://example.org/', category: 'x' },
    ]);
    assert.match(html, /&lt;b&gt;Title&lt;\/b&gt;/);
  });

  test('renders nothing for no sources', async () => {
    assert.equal(await render([]), '');
  });
});
