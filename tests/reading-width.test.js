import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const script = await readFile(new URL('../extension/reading-width.js', import.meta.url), 'utf8');
const turns = {
  chatgpt: '<article><div data-message-author-role="assistant"><div class="markdown">Answer</div></div></article>',
  claude: '<div data-testid="assistant-message"><div class="font-claude-response">Answer</div></div>',
  gemini: '<model-response><message-content>Answer</message-content></model-response>',
  grok: '<div class="message-bubble"><div class="response-content-markdown">Answer</div></div>',
};
const marker = 'data-asb-reading-width';

function setup(t, provider, body) {
  const dom = new JSDOM(`<!doctype html><style>.reading-column, .composer, .preview {max-width:650px}</style>${body}`, {
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.AISplitAdapters = { provider };
  window.eval(script);
  return { document: window.document, api: window.AISplitReadingWidth, css: el => window.getComputedStyle(el) };
}

function rect(node, left, right, top = 0, bottom = 100) {
  node.getBoundingClientRect = () => ({ left, right, top, bottom, width: right - left, height: bottom - top });
}

for (const [provider, message] of Object.entries(turns)) {
  test(`${provider}: reading width follows message columns and restores native styles`, t => {
    const { api, document, css } = setup(t, provider, `
      <main><div id="history" class="reading-column">${message}</div><form class="composer"><textarea></textarea></form></main>
      <aside><div class="preview">${message}</div></aside><div role="dialog">${message}</div>`);
    const history = document.getElementById('history');
    assert.equal(css(history).maxWidth, '650px');
    api.setEnabled(true);
    assert.equal(css(history).maxWidth, '100%');
    assert.equal(document.querySelector('main').hasAttribute(marker), false);
    assert.equal(css(document.querySelector('form')).maxWidth, '650px');
    assert.equal(document.querySelector(`aside [${marker}], [role="dialog"] [${marker}]`), null);
    const next = history.cloneNode(true);
    next.removeAttribute(marker);
    next.innerHTML = message;
    history.replaceWith(next);
    api.refresh();
    assert.equal(css(next).maxWidth, '100%');
    api.setEnabled(false);
    assert.equal(css(next).maxWidth, '650px');
    assert.equal(document.querySelector(`[${marker}]`), null);
    assert.equal(history.hasAttribute(marker), false);
  });
}

test('a shared centered wrapper expands only the history into available space and respects a neighboring pane', t => {
  const { api, document } = setup(t, 'chatgpt', `
    <div id="pane"><main class="reading-column"><section id="history">${turns.chatgpt}</section>
      <form class="composer"><textarea></textarea></form></main><aside></aside></div>`);
  const main = document.querySelector('main'), history = document.querySelector('#history');
  const pane = document.querySelector('#pane'), side = document.querySelector('aside');
  rect(pane, 0, 1200);
  rect(main, 80, 720);
  rect(side, 800, 1200);
  api.setEnabled(true);
  assert.equal(history.getAttribute(marker), 'outset');
  assert.equal(history.style.getPropertyValue('--asb-reading-gutter'), '64px');
  assert.equal(main.hasAttribute(marker), false);
  assert.equal(document.querySelector('form').hasAttribute(marker), false);
  // Closing the sidebar and resizing the split leaves no spare margin.
  rect(pane, 0, 660);
  rect(main, 10, 650);
  rect(side, 0, 0);
  api.refresh();
  assert.equal(history.getAttribute(marker), 'cap');
  assert.equal(history.style.getPropertyValue('--asb-reading-gutter'), '');
  api.setEnabled(false);
});

test('a constrained scroll container never gives a message width outside of its clipping region', t => {
  const { api, document } = setup(t, 'gemini', `<main style="overflow-x:hidden" class="reading-column">
    <section id="history">${turns.gemini}</section><form><textarea></textarea></form></main>`);
  rect(document.body, 0, 1000);
  rect(document.querySelector('main'), 150, 850);
  api.setEnabled(true);
  assert.equal(document.querySelector('#history').getAttribute(marker), 'cap');
});

test('revealing a folded fixed-width turn discovers its centered column without a window resize', t => {
  const { api, document } = setup(t, 'claude', `<main><section id="history"><article style="width:300px;margin:auto">
    ${turns.claude}</article></section><form><textarea></textarea></form></main>`);
  const turn = document.querySelector('article');
  rect(document.querySelector('#history'), 0, 900);
  rect(turn, 300, 600, 0, 0);
  api.setEnabled(true);
  assert.equal(turn.getAttribute(marker), 'cap');
  rect(turn, 300, 600);
  api.refresh();
  assert.equal(turn.getAttribute(marker), 'column');
});

test('a positioned artifact pane cannot be covered by relaxing a native message width cap', t => {
  const { api, document, css } = setup(t, 'claude', `<main id="pane">
    <div id="track"><section id="history" class="reading-column" style="width:100%">${turns.claude}</section></div>
    <aside data-testid="chat-side-pane" style="position:absolute;right:0">Artifact</aside></main>`);
  const pane = document.querySelector('#pane'), track = document.querySelector('#track');
  const history = document.querySelector('#history'), side = document.querySelector('aside');
  rect(pane, 0, 1000); rect(track, 0, 1000); rect(history, 175, 825);
  rect(side, 0, 0);
  api.setEnabled(true);
  assert.equal(css(history).maxWidth, '100%');
  // The new panel overlays the existing track instead of participating in flex layout.
  rect(side, 825, 1000);
  api.refresh();
  assert.equal(history.hasAttribute(marker), false);
  assert.equal(css(history).maxWidth, '650px');
  assert.equal(track.hasAttribute(marker), false);
  rect(side, 0, 0);
  api.refresh();
  assert.equal(css(history).maxWidth, '100%');
});

test('renders the full Claude prose column even when its outer turn already spans the pane', t => {
  const { api, document, css } = setup(t, 'claude', `
    <style>
      .standard-markdown { max-width: 64ch; }
      .file-body { max-width: 24rem; }
    </style>
    <main><div aria-label="Chat messages" role="log">
      <div data-turn-key="reply"><div data-cds="AssistantMessage">
        <div data-reply-scope><div class="standard-markdown" data-cds="Prose"><p>Long answer</p></div></div>
        <div data-testid="file-card-block"><div class="prose file-body">File preview</div></div>
      </div></div></div><form class="composer"><textarea></textarea></form></main>`);
  const text = document.querySelector('.standard-markdown'), file = document.querySelector('.file-body');
  api.setEnabled(true);
  assert.equal(css(text).maxWidth, '100%');
  assert.equal(css(file).maxWidth, '24rem');
  assert.equal(css(document.querySelector('form')).maxWidth, '650px');
  api.setEnabled(false);
  assert.equal(css(text).maxWidth, '64ch');
});

test('Claude widens its native two nested transcript caps inside the scrollport and keeps its sticky input at the native measure', t => {
  const { api, document, css } = setup(t, 'claude', `
    <style>
      [data-claude-chat-column] { width:100%; max-width:calc(var(--transcript-width, 48rem) + 2.5rem); padding-inline:20px; box-sizing:border-box; }
      [data-testid="transcript-list"] { width:100%; max-width:var(--transcript-width, 48rem); }
      [data-chat-input-container] { width:100%; position:sticky; bottom:0; }
    </style>
    <main data-fc-chat-column><div data-testid="chat-column-body"><div data-autoscroll-container style="overflow-x:hidden;overflow-y:auto">
      <div id="pane-gutters" style="padding-inline:12px"><div data-testid="chat-column" data-claude-chat-column>
        <div data-testid="transcript-list"><article data-testid="transcript-row"><div data-reply-scope><div data-testid="assistant-message" data-cds="AssistantMessage">
          <div data-cds="Prose"><p>A long reply</p></div></div></div></article></div>
        <div data-chat-input-container><form><textarea></textarea></form></div>
      </div></div>
    </div></div></main><aside data-testid="chat-side-pane"></aside>`);
  const column = document.querySelector('[data-claude-chat-column]'), list = document.querySelector('[data-testid="transcript-list"]');
  const input = document.querySelector('[data-chat-input-container]'), scroll = document.querySelector('[data-autoscroll-container]');
  const gutters = document.querySelector('#pane-gutters');
  const original = [css(column).maxWidth, css(list).maxWidth, css(input).inlineSize];
  api.setEnabled(true);
  assert.equal(column.getAttribute(marker), 'claude-column');
  assert.equal(css(column).maxWidth, '100%');
  assert.equal(css(list).maxWidth, '100%');
  assert.match(css(input).inlineSize, /min\(100%, var\(--transcript-width, 48rem\)\)/);
  assert.equal(css(input).position, 'sticky');
  assert.equal(css(scroll).overflowX, 'hidden');
  assert.equal(css(gutters).paddingInline, '12px');
  assert.equal(document.querySelector(`aside [${marker}], form[${marker}]`), null);
  api.setEnabled(false);
  assert.deepEqual([css(column).maxWidth, css(list).maxWidth, css(input).inlineSize], original);
});

test('Claude can widen a nested, clipped transcript without widening its sticky input or the artifact pane', t => {
  const { api, document, css } = setup(t, 'claude', `
    <style>
      [data-testid="chat-column"], #wrap { max-width:808px; }
      [data-testid="transcript-list"] { width:100%; max-width:768px; }
    </style>
    <main><section data-testid="chat-column" id="chat"><div id="wrap" style="overflow-x:clip">
      <div data-testid="transcript-list"><article>${turns.claude}</article></div>
      <div data-chat-input-container><form><textarea></textarea></form></div>
    </div></section></main>
    <aside><div data-testid="chat-column"><div data-testid="transcript-list">${turns.claude}</div></div></aside>`);
  api.setEnabled(true);
  assert.equal(document.querySelector('#chat').getAttribute(marker), 'claude-column');
  assert.equal(css(document.querySelector('#wrap')).maxWidth, '100%');
  assert.equal(css(document.querySelector('#wrap')).overflowX, 'clip');
  assert.match(css(document.querySelector('[data-chat-input-container]')).inlineSize, /var\(--transcript-width, 48rem\)/);
  assert.equal(document.querySelector(`aside [${marker}]`), null);
  api.setEnabled(false);
  assert.equal(css(document.querySelector('#wrap')).maxWidth, '808px');
});

test('Claude uses its native transcript sizing variable and preserves the configured input measure on toggles', t => {
  const { api, document, css } = setup(t, 'claude', `
    <style>[data-claude-chat-column] { --transcript-width:42rem }</style>
    <main data-autoscroll-container><div data-claude-chat-column style="max-width:calc(var(--transcript-width) + 40px) !important">
      <div data-testid="transcript-list" style="max-width:var(--transcript-width) !important">${turns.claude}</div>
      <div data-chat-input-container><form><textarea></textarea></form></div>
    </div></main>`);
  const column = document.querySelector('[data-claude-chat-column]');
  const composer = document.querySelector('[data-chat-input-container]');
  api.setEnabled(true);
  assert.equal(css(column).getPropertyValue('--transcript-width'), '100%');
  assert.equal(column.style.getPropertyValue('--asb-claude-composer-measure'), '42rem');
  assert.match(css(composer).getPropertyValue('--transcript-width'), /--asb-claude-composer-measure/);
  api.refresh();
  api.setEnabled(false);
  assert.equal(css(column).getPropertyValue('--transcript-width'), '42rem');
  assert.equal(column.style.getPropertyValue('--asb-claude-composer-measure'), '');
  assert.equal(column.style.getPropertyPriority('max-width'), 'important');
});

test('Claude keeps the native column active beside an overlay and counts only unreserved space', t => {
  const { api, document } = setup(t, 'claude', `
    <main><div data-autoscroll-container><div id="gutters">
      <div data-claude-chat-column><div data-testid="transcript-list">${turns.claude}</div>
      <div data-chat-input-container><form><textarea></textarea></form></div></div>
    </div></div></main><aside style="position:fixed;right:0"></aside>`);
  const parent = document.querySelector('#gutters'), lane = document.querySelector('[data-claude-chat-column]');
  const side = document.querySelector('aside'), inset = () => lane.style.getPropertyValue('--asb-claude-inset-right');
  rect(parent, 0, 1570); rect(lane, 381, 1189); rect(side, 1330, 1570);
  api.setEnabled(true);
  assert.equal(lane.getAttribute(marker), 'claude-column');
  assert.equal(inset(), '240px');
  parent.style.paddingRight = '100px';
  api.refresh();
  assert.equal(inset(), '140px');
  parent.style.paddingRight = '240px';
  api.refresh();
  assert.equal(inset(), '');
  // A collapsed navigation peek must not veto the entire transcript.
  parent.style.paddingRight = '';
  rect(side, 1566, 1570);
  api.refresh();
  assert.equal(inset(), '4px');
  side.setAttribute('inert', '');
  api.refresh();
  assert.equal(inset(), '');
  assert.equal(lane.getAttribute(marker), 'claude-column');
  side.removeAttribute('inert');
  rect(side, 0, 1570);
  api.refresh();
  assert.equal(lane.hasAttribute(marker), false);
  api.setEnabled(false);
  assert.equal(lane.style.getPropertyValue('--asb-claude-composer-measure'), '');
});
