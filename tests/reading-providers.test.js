import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const widthScript = await readFile(new URL('../extension/reading-width.js', import.meta.url), 'utf8');

// Gemini's public ChatTranscript and ModelResponseContentView components also
// render semantic sections. The prompt and answer share a 708px exchange lane.
const layouts = [
  { provider: 'gemini', name: 'Gemini section transcript', lane: '708px', exchange: 'data-testid="latest-turn-exchange"', markup: `
    <section data-turn-content-visibility="auto" style="max-width:85%"><div data-testid="user-prompt-bubble"><div data-testid="user-prompt-content">Question</div></div></section>
    <section data-turn-content-visibility="auto"><div data-testid="collapsible-response-content" class="copy">Answer</div><div role="toolbar" data-testid="chat-response-action-bar"></div></section>` },
  { provider: 'gemini', name: 'Gemini custom-element transcript', lane: '690px', markup: `
    <user-query><div class="query-text">Question</div></user-query>
    <model-response><message-content><div class="markdown-main-panel copy">Answer</div></message-content></model-response>` },
  { provider: 'grok', name: 'Grok message bubble', lane: '720px', markup: `
    <div data-message-role="user"><p>Question</p></div>
    <div class="message-bubble"><div class="response-content-markdown"><div class="prose copy">Answer</div></div></div>` },
];

for (const { provider, name, lane, exchange = '', markup } of layouts) {
  test(`${name}: release both the exchange and nested text width while preserving other panes`, t => {
    const window = new JSDOM(`<!doctype html><style>
      .exchange { width:100%; max-width:${lane}; margin-inline:auto }
      .copy { max-width:65ch } form { width:100%; max-width:660px }
    </style><main><div id="history"><div class="exchange" ${exchange}>${markup}</div></div>
    <form><textarea></textarea></form></main><aside>${markup}</aside>`, { runScripts: 'outside-only', pretendToBeVisual: true }).window;
    t.after(() => window.close());
    window.AISplitAdapters = { provider };
    window.eval(widthScript);
    const max = selector => window.getComputedStyle(window.document.querySelector(selector)).maxWidth;
    assert.equal(max('#history .exchange'), lane);
    assert.equal(max('#history .copy'), '65ch');
    window.AISplitReadingWidth.setEnabled(true);
    assert.equal(max('#history .exchange'), '100%');
    assert.equal(max('#history .copy'), '100%');
    assert.equal(max('form'), '660px');
    assert.equal(max('aside .copy'), '65ch');
    window.AISplitReadingWidth.setEnabled(false);
    assert.equal(max('#history .exchange'), lane);
    assert.equal(max('#history .copy'), '65ch');
  });
}
