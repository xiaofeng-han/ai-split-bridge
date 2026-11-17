import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const page = `<main>
  <article class="reply"><p>First answer.</p><div class="actions"><span class="copy"><button>Copy</button></span><button>Like</button></div></article>
  <article class="reply"><p>Second answer.</p><div class="actions"><span class="copy"><button>Copy</button></span><button>Like</button></div></article>
</main>
<form><textarea id="site-composer"></textarea><div id="group"><button type="button" id="site-voice">Voice</button><button type="button" id="site-send">Send</button></div></form>`;

function split() {
  return {
    ok: true, selfId: 1, provider: 'chatgpt', side: 'left', native: true, canManageSplit: false, switchMode: 'navigate',
    peer: { id: 2, provider: 'claude', name: 'Claude', title: 'Chat two', side: 'right' },
    chats: [
      { id: 2, provider: 'claude', name: 'Claude', title: 'Chat two', side: 'right' },
      { id: 3, provider: 'gemini', name: 'Gemini', title: 'Trip ideas', side: null },
      { id: 4, provider: 'grok', name: 'Grok', title: 'Grok', side: null, asleep: true },
    ],
    closed: [],
  };
}

function setup(t, context = split()) {
  const dom = new JSDOM(page, { url: 'https://chatgpt.com/c/example', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const calls = [];
  let listener;
  const model = {
    context,
    respond(message) { return message.type === 'ASB_CONTEXT' ? this.context : { ok: true, message: 'Done.' }; },
  };
  const adapter = {
    provider: 'chatgpt', name: 'ChatGPT',
    getDraft() {
      if (!document.querySelector('#site-composer')) throw new Error('ChatGPT composer was not found.');
      return { ok: true, text: document.querySelector('#site-composer').value };
    },
    composerAnchor: () => document.querySelector('#group') && { parent: document.querySelector('#group'), before: document.querySelector('#site-send') },
    replyAnchors: () => [...document.querySelectorAll('.reply')].map(response => ({ parent: response.querySelector('.actions'), before: response.querySelector('.copy').nextElementSibling, response })),
    replyText: response => ({ ok: true, text: response.querySelector('p').textContent, partial: false }),
    getResponse: () => adapter.replyText([...document.querySelectorAll('.reply')].at(-1)),
    ownsEditor: node => node === document.querySelector('#site-composer'),
    canLeave: () => ({ ok: true, page: 1 }),
  };
  dom.window.AISplitAdapters = adapter;
  dom.window.chrome = { runtime: { id: 'extension', onMessage: { addListener(fn) { listener = fn; } }, async sendMessage(message) { calls.push(JSON.parse(JSON.stringify(message))); return model.respond(message); } } };
  dom.window.eval(source);
  const hosts = kind => [...document.querySelectorAll(`ai-split-bridge[data-ai-split-bridge='${kind}']`)];
  const layer = hosts('layer')[0].shadowRoot;
  const composer = () => hosts('composer')[0];
  const pill = () => composer().shadowRoot;
  const menu = layer.querySelector('[role=menu]');
  const toast = layer.querySelector('[role=status]');
  const rows = () => [...menu.querySelectorAll('.item, button.row')];
  const row = name => rows().find(node => node.querySelector('.name')?.textContent === name);
  const sent = type => calls.filter(message => message.type === type);
  const refresh = () => new Promise(resolve => listener({ type: 'ASB_REFRESH' }, { id: 'extension' }, resolve));
  const click = async node => { node.click(); await settle(); };
  return { dom, document, model, adapter, calls, hosts, composer, pill, menu, toast, row, sent, refresh, click, get listener() { return listener; } };
}

test('a Send both pill sits just before the site’s own Send button and leaves the site’s send alone', async t => {
  const view = setup(t);
  await settle();
  const site = view.document.querySelector('#site-send');
  assert.equal(view.composer().nextSibling, site);
  assert.equal(view.composer().style.display, 'inline-flex');
  assert.equal(view.pill().querySelector('.send').textContent, 'Send both');
  assert.match(view.pill().querySelector('.send').title, /Send here and to Claude/);
  site.click();
  view.document.querySelector('#site-composer').dispatchEvent(new view.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.deepEqual(view.calls.map(message => message.type), ['ASB_CONTEXT']);
  const press = new view.dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
  view.pill().querySelector('.send').dispatchEvent(press);
  assert.equal(press.defaultPrevented, true, 'the site composer keeps its caret');
  await view.click(view.pill().querySelector('.send'));
  assert.deepEqual(view.sent('ASB_SEND'), [{ type: 'ASB_SEND', targetIds: [2] }]);
  assert.equal(view.toast.textContent, 'Done.');
  view.dom.window.eval(source);
  assert.equal(view.hosts('composer').length, 1);
  assert.equal(view.hosts('layer').length, 1);
});

test('the chooser adds chats from other tabs, skips sleeping ones, and labels the pill to match', async t => {
  const view = setup(t);
  await settle();
  await view.click(view.pill().querySelector('.more'));
  assert.equal(view.menu.hidden, false);
  assert.equal(view.menu.querySelector('.heading').textContent, 'Send this prompt to');
  const check = name => view.row(name).querySelector('[role=menuitemcheckbox]');
  assert.deepEqual(['Claude', 'Gemini', 'Grok'].map(name => check(name).getAttribute('aria-checked')), ['true', 'false', 'false']);
  assert.equal(view.row('Claude').querySelector('.detail').textContent, 'Right side · Chat two');
  assert.equal(view.row('Gemini').querySelector('.detail').textContent, 'Other tab · Trip ideas');
  assert.equal(check('Grok').disabled, true);
  assert.equal(view.row('Grok').querySelector('.detail').textContent, 'Asleep · open its tab first');
  await view.click(check('Gemini'));
  assert.equal(view.pill().querySelector('.send').textContent, 'Send all');
  assert.equal(view.menu.querySelector('.primary').textContent, 'Send all');
  await view.click(view.menu.querySelector('.primary'));
  assert.deepEqual(view.sent('ASB_SEND').map(message => message.targetIds), [[2, 3]]);
  assert.equal(view.menu.hidden, true);
  assert.equal(view.pill().querySelector('.send').textContent, 'Send all', 'choices survive a refresh');
  await view.click(view.pill().querySelector('.more'));
  await view.click(check('Claude'));
  assert.equal(view.pill().querySelector('.send').textContent, 'Send both');
  await view.click(check('Gemini'));
  assert.equal(view.pill().querySelector('.send').textContent, 'Send to…');
  assert.equal(view.menu.querySelector('.primary').disabled, true);
  await view.click(view.pill().querySelector('.more'));
  assert.equal(view.menu.hidden, true);
  await view.click(view.pill().querySelector('.send'));
  assert.equal(view.menu.hidden, false, 'with nothing chosen the pill opens the chooser instead of sending');
  assert.equal(view.sent('ASB_SEND').length, 1);
});

test('hidden and closed chats can be shown on the other side; outside a split there is nothing to show', async t => {
  const context = split();
  context.closed = [{ provider: 'grok', name: 'Grok', remembered: true }];
  context.chats = context.chats.filter(chat => chat.provider !== 'grok');
  const view = setup(t, context);
  await settle();
  await view.click(view.pill().querySelector('.more'));
  assert.equal(view.row('Claude').querySelector('.show'), null, 'the visible side needs no Show button');
  assert.equal(view.row('Gemini').querySelector('.show').getAttribute('aria-label'), 'Show Gemini on the right');
  assert.equal(view.row('Grok').querySelector('.detail').textContent, 'Earlier chat');
  await view.click(view.row('Gemini').querySelector('.show'));
  assert.deepEqual(view.sent('ASB_SHOW'), [{ type: 'ASB_SHOW', targetId: 3 }]);
  await view.click(view.pill().querySelector('.more'));
  await view.click(view.row('Grok').querySelector('.show'));
  assert.deepEqual(view.sent('ASB_SHOW').at(-1), { type: 'ASB_SHOW', provider: 'grok' });

  view.model.context = { ...split(), side: null, peer: null, chats: split().chats.map(chat => ({ ...chat, side: null })), closed: context.closed };
  await view.refresh();
  assert.equal(view.pill().querySelector('.send').textContent, 'Send to…');
  await view.click(view.pill().querySelector('.more'));
  assert.equal(view.menu.querySelectorAll('.show').length, 0);
  assert.equal(view.row('Grok').querySelector('.detail').textContent, 'Asleep · open its tab first');
});

test('each reply gets a Share button after its Copy button that hands the reply to the chosen chat', async t => {
  const view = setup(t);
  await settle();
  const shares = view.hosts('share');
  assert.equal(shares.length, 2);
  assert.deepEqual(shares.map(node => node.previousSibling.className), ['copy', 'copy']);
  await view.click(shares[0].shadowRoot.querySelector('.share-button'));
  assert.equal(view.menu.querySelector('.heading').textContent, 'Send this reply to');
  assert.match(view.menu.querySelector('.hint').textContent, /^Sent right away/);
  assert.equal(view.row('Claude').querySelector('.detail').textContent, 'Right side · Chat two');
  assert.equal(view.row('Gemini').querySelector('.detail').textContent, 'Opens on the right · Trip ideas');
  assert.equal(view.row('Grok').querySelector('.detail').textContent, 'Opens on the right');
  assert.equal(view.row('Grok').disabled, false, 'a sleeping hidden tab is opened, not skipped');
  await view.click(view.row('Gemini'));
  assert.deepEqual(view.sent('ASB_SHARE'), [{ type: 'ASB_SHARE', targetId: 3, reply: 'First answer.' }],
    'the page sends only the reply; the extension adds your message');
  assert.equal(view.calls.some(message => ['ASB_SEND', 'ASB_COMMIT'].includes(message.type)), false);
  view.model.context = { ...split(), shareMode: 'draft' };
  await view.refresh();
  await view.click(shares[1].shadowRoot.querySelector('.share-button'));
  assert.equal(view.menu.querySelector('.heading').textContent, 'Share this reply with');
  assert.match(view.menu.querySelector('.hint').textContent, /^Added as a draft/);
  view.model.context = split();
  view.document.querySelectorAll('.reply')[0].remove();
  await view.refresh();
  assert.equal(view.hosts('share').length, 1);
  view.model.context = { ...split(), chats: [], closed: [] };
  await view.refresh();
  assert.equal(view.hosts('share')[0].style.display, 'none');
  assert.equal(view.composer().style.display, 'none');
});

test('a menu that fits on neither side opens on the roomier side and scrolls instead of covering its button', async t => {
  const view = setup(t);
  await settle();
  Object.defineProperty(view.dom.window, 'innerHeight', { value: 440, configurable: true });
  Object.defineProperty(view.menu, 'offsetHeight', { get: () => 255, configurable: true });
  const share = view.hosts('share')[0].shadowRoot.querySelector('.share-button');
  share.getBoundingClientRect = () => ({ top: 162, bottom: 194, left: 60, right: 160 });
  await view.click(share);
  assert.equal(view.menu.style.top, '202px');
  assert.equal(view.menu.style.maxHeight, '230px');
  await view.click(share);
  const more = view.pill().querySelector('.more');
  more.getBoundingClientRect = () => ({ top: 330, bottom: 362, left: 60, right: 92 });
  await view.click(more);
  assert.equal(view.menu.style.top, '67px', 'the send menu still prefers to open above the composer');
  assert.equal(view.menu.style.maxHeight, '');
});

test('without Copy buttons the chooser can still share the latest reply', async t => {
  const view = setup(t);
  view.adapter.replyAnchors = () => [];
  await view.refresh();
  await view.click(view.pill().querySelector('.more'));
  await view.click(view.menu.querySelector('.link'));
  assert.equal(view.menu.querySelector('.heading').textContent, 'Send this reply to');
  await view.click(view.row('Claude'));
  assert.equal(view.sent('ASB_SHARE')[0].reply, 'Second answer.');
  assert.equal(view.sent('ASB_SHARE')[0].targetId, 2);
});

test('the shortcut sends from the site composer only, and pending work blocks a second send', async t => {
  const view = setup(t);
  await settle();
  let finish;
  view.model.respond = function (message) { return message.type === 'ASB_CONTEXT' ? this.context : new Promise(resolve => { finish = resolve; }); };
  const press = target => {
    const event = new view.dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  assert.equal(press(view.document.querySelector('#site-voice')).defaultPrevented, false);
  assert.equal(press(view.document.querySelector('#site-composer')).defaultPrevented, true);
  await settle();
  assert.equal(view.pill().querySelector('.send').textContent, 'Working…');
  assert.equal(view.pill().querySelector('.send').disabled, true);
  press(view.document.querySelector('#site-composer'));
  await view.click(view.pill().querySelector('.send'));
  assert.equal(view.sent('ASB_SEND').length, 1);
  finish({ ok: false, error: 'Claude still has a draft.' });
  await settle();
  assert.equal(view.toast.textContent, 'Claude still has a draft.');
  assert.equal(view.toast.classList.contains('error'), true);
  assert.equal(view.pill().querySelector('.send').disabled, false);
});

test('without an anchor the pill floats over a composer, and disappears when there is no composer', async t => {
  const view = setup(t);
  view.adapter.composerAnchor = () => null;
  await view.refresh();
  assert.equal(view.composer().parentNode, view.document.documentElement);
  assert.match(view.composer().style.cssText, /position: fixed/);
  view.document.querySelector('form').remove();
  await view.refresh();
  assert.equal(view.composer(), undefined);
});

test('only explicit extension-owned adapter requests are accepted', async t => {
  const view = setup(t);
  await settle();
  for (const [type, id] of [['ASB_COMMIT', 'other'], ['toString', 'extension'], ['constructor', 'extension']]) {
    assert.equal(view.listener({ type }, { id }, () => assert.fail()), false);
  }
  const result = await new Promise(resolve => view.listener({ type: 'ASB_CAN_LEAVE' }, { id: 'extension' }, resolve));
  assert.equal(result.ok, true);
  view.adapter.insert = () => { throw Object.assign(new Error('Claude is still opening.'), { retry: true }); };
  const failure = await new Promise(resolve => view.listener({ type: 'ASB_INSERT', text: 'x' }, { id: 'extension' }, resolve));
  assert.deepEqual({ ...failure }, { ok: false, error: 'Claude is still opening.', retry: true });
});

function conversation(view) {
  const replies = [...view.document.querySelectorAll('.reply')];
  const prompt = view.document.createElement('article');
  prompt.innerHTML = '<p>My original question.</p><div class="actions"><span class="copy"><button>Copy prompt</button></span><button>Edit</button></div>';
  replies[0].before(prompt);
  const entries = [
    { element: prompt, role: 'user', text: 'My original question.' },
    ...replies.map(element => ({ element, role: 'assistant', text: element.querySelector('p').textContent })),
  ];
  const reads = [];
  view.adapter.messages = () => entries;
  view.adapter.readMessages = async elements => {
    reads.push(elements);
    return { ok: true, text: elements.map(element => {
      const entry = entries.find(item => item.element === element);
      return `${entry.role === 'user' ? 'You' : 'ChatGPT'}: ${entry.text}`;
    }).join('\n\n'), partial: false, conversation: true };
  };
  view.adapter.promptAnchors = () => prompt.isConnected ? [{ parent: prompt.querySelector('.actions'), before: prompt.querySelector('.copy').nextElementSibling, response: prompt }] : [];
  view.adapter.readMessage = async element => ({ ok: true, text: element.querySelector('p').textContent, partial: false, prompt: true });
  return { entries, reads, prompt };
}

test('historical prompts have a share action that preserves their role', async t => {
  const view = setup(t);
  const chat = conversation(view);
  await view.refresh();
  const host = view.hosts('share').find(node => node.dataset.shareRole === 'user');
  assert.equal(host.previousSibling.className, 'copy');
  await view.click(host.shadowRoot.querySelector('.share-button'));
  assert.equal(view.menu.querySelector('.heading').textContent, 'Send this prompt to');
  await view.click(view.row('Claude'));
  assert.deepEqual(view.sent('ASB_SHARE'), [{type:'ASB_SHARE',targetId:2,reply:'My original question.',kind:'prompt'}]);
  assert.equal(view.sent('ASB_SEND').length,0);
  chat.prompt.remove();await view.refresh();
  assert.equal(view.hosts('share').filter(node=>node.dataset.shareRole==='user').length,0);
});

test('selected prompts and replies are read in conversation order and shared as one conversation', async t => {
  const view = setup(t);
  const chat = conversation(view);
  await view.refresh();
  await view.click(view.pill().querySelector('.more'));
  await view.click(view.menu.querySelector('.select-messages'));
  const checks = [...view.menu.querySelectorAll('.message-choice input')];
  assert.equal(checks.length,3);
  assert.equal(view.menu.querySelector('.primary').disabled,true);
  assert.equal(chat.reads.length,0);
  // Click out of order; the transcript must still retain the conversation's order.
  await view.click(checks[2]);await view.click(checks[0]);
  assert.equal(view.menu.querySelector('.primary').textContent,'Share 2 messages…');
  await view.click(view.menu.querySelector('.primary'));
  assert.deepEqual([...chat.reads[0]],[chat.entries[0].element,chat.entries[2].element]);
  assert.equal(view.menu.querySelector('.heading').textContent,'Send the selected messages to');
  assert.equal(view.sent('ASB_SHARE').length,0,'choosing messages does not send');
  await view.click(view.row('Gemini'));
  assert.deepEqual(view.sent('ASB_SHARE'),[{type:'ASB_SHARE',targetId:3,reply:'You: My original question.\n\nChatGPT: Second answer.',kind:'conversation'}]);
});

test('select all, clear, and back never transfer messages', async t => {
  const view=setup(t);conversation(view);await view.refresh();
  await view.click(view.pill().querySelector('.more'));await view.click(view.menu.querySelector('.select-messages'));
  const actions=[...view.menu.querySelectorAll('.selection-actions button')];
  await view.click(actions[0]);assert.equal(view.menu.querySelectorAll('.message-choice input:checked').length,3);
  await view.click(actions[1]);assert.equal(view.menu.querySelectorAll('.message-choice input:checked').length,0);
  assert.equal(view.menu.querySelector('.primary').disabled,true);
  await view.click(view.menu.querySelector('.footer .link'));
  assert.equal(view.menu.querySelector('.heading').textContent,'Send this prompt to');
  assert.equal(view.sent('ASB_SHARE').length,0);
});

test('changing conversations invalidates message selection before any read or send', async t => {
  const view=setup(t);const chat=conversation(view);await view.refresh();
  await view.click(view.pill().querySelector('.more'));await view.click(view.menu.querySelector('.select-messages'));
  await view.click(view.menu.querySelector('.message-choice input'));
  view.dom.window.history.pushState({},'', '/c/another');
  await view.click(view.menu.querySelector('.primary'));
  assert.equal(chat.reads.length,0);assert.equal(view.sent('ASB_SHARE').length,0);
  assert.match(view.toast.textContent,/conversation changed/);
});

test('a message selection with generated files uses the existing file controls', async t => {
  const view=setup(t);conversation(view);await view.refresh();
  let fileReads=0;
  view.adapter.readMessages=async()=>({ok:true,text:'You: question\nChatGPT: document',files:[{name:'draft.md'}],partial:false,conversation:true});
  view.adapter.readReplyFiles=async()=>{fileReads++;return [{name:'draft.md',data:'dGVzdA==',type:'text/markdown'}];};
  await view.click(view.pill().querySelector('.more'));await view.click(view.menu.querySelector('.select-messages'));
  await view.click(view.menu.querySelector('.message-choice input'));await view.click(view.menu.querySelector('.primary'));
  assert.match(view.menu.querySelector('.file-option').textContent,/Include 1 file/);
  await view.click(view.row('Claude'));
  assert.equal(fileReads,1);assert.equal(view.sent('ASB_SHARE')[0].files[0].name,'draft.md');
  assert.equal(view.sent('ASB_SHARE')[0].kind,'conversation');
});

test('navigation while selected messages are being read discards the completed result', async t => {
  const view=setup(t);conversation(view);await view.refresh();
  let finish;
  view.adapter.readMessages=()=>new Promise(resolve=>{finish=resolve;});
  await view.click(view.pill().querySelector('.more'));await view.click(view.menu.querySelector('.select-messages'));
  await view.click(view.menu.querySelector('.message-choice input'));await view.click(view.menu.querySelector('.primary'));
  assert.equal(view.menu.querySelector('.primary').textContent,'Preparing…');
  view.dom.window.history.pushState({},'', '/c/another');
  finish({ok:true,text:'Old conversation',conversation:true});await settle();
  assert.equal(view.menu.hidden,true);assert.equal(view.menu.querySelector('button.row'),null);
  assert.match(view.toast.textContent,/conversation changed/);
  assert.equal(view.sent('ASB_SHARE').length,0);
  assert.equal(view.pill().querySelector('.send').disabled,false);
});

test('transparent neighbouring controls never supply invisible ink to the extension', async t => {
  const view=setup(t);await settle();
  view.document.querySelector('#site-send').style.cssText='color:rgba(255,255,255,0);background-color:transparent';
  await view.refresh();
  assert.equal(view.pill().querySelector('.root').style.getPropertyValue('--ink'),'');
  assert.match(view.pill().querySelector('style').textContent,/color:var\(--fg\); -webkit-text-fill-color:currentColor/);
});

test('a site revealing a different composer control through attributes triggers remounting', async t => {
  const view=setup(t);await settle();
  const group=view.document.createElement('div');group.id='revealed-group';view.document.querySelector('form').append(group);
  view.adapter.composerAnchor=()=>view.document.querySelector('#site-send').hidden ? {parent:group,before:null} : {parent:view.document.querySelector('#group'),before:view.document.querySelector('#site-send')};
  view.document.querySelector('#site-send').hidden=true;
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(view.composer().parentNode,group);
});
