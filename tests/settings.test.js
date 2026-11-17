import test from 'node:test';
import assert from 'node:assert/strict';
import { composeShare, DEFAULT_SHARE_MESSAGE, DEFAULT_PROMPT_MESSAGE, DEFAULT_CONVERSATION_MESSAGE, loadSettings, MAX_SHARE_MESSAGE, readSettings, saveSettings } from '../extension/settings.js';

const defaults = { shareMode: 'send', shareMessage: DEFAULT_SHARE_MESSAGE, promptMessage: DEFAULT_PROMPT_MESSAGE, conversationMessage: DEFAULT_CONVERSATION_MESSAGE };

const memory = (initial = {}) => {
  const data = structuredClone(initial);
  return { data, async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; }, async set(value) { Object.assign(data, structuredClone(value)); } };
};

test('by default a shared reply is sent right away inside the standard message', async () => {
  const settings = await loadSettings(memory());
  assert.deepEqual(settings, defaults);
  assert.equal(composeShare(settings.shareMessage, { assistant: 'Grok', reply: 'Hi there.' }),
    "Here is Grok's reply:\n\nHi there.\n\nWhat do you think? Please review it critically. Point out anything wrong, weak, or missing.\n\nIf there are good ideas, use them to improve your previous response. Do not just agree with it—use your own judgement.");
});

test('your own message wraps the reply, and without {reply} the reply goes at the end', () => {
  const reply = 'Use {assistant} and {reply} literally. $& $1';
  assert.equal(composeShare('Critique {assistant}:\n{reply}\n— from {assistant}', { assistant: 'Claude', reply }),
    `Critique Claude:\n${reply}\n— from Claude`, 'placeholders inside the reply are left alone');
  assert.equal(composeShare('Summarize this in one line.  \n', { assistant: 'Gemini', reply: 'Long answer.' }),
    'Summarize this in one line.\n\nLong answer.');
});

test('prompts and mixed conversations retain the correct authors instead of using the reply template', () => {
  const message = 'Critique {assistant}’s reply: {reply}';
  const prompt = 'How does {reply} work?';
  assert.equal(composeShare(message, { assistant: 'ChatGPT', reply: prompt, kind: 'prompt' }),
    `Here is my prompt from a chat with ChatGPT:\n\n${prompt}\n\nPlease respond to this prompt.`);
  const transcript = 'You:\nFirst question\n\nClaude:\nFirst answer\n\nYou:\nFollow-up';
  assert.equal(composeShare(message, { assistant: 'Claude', reply: transcript, kind: 'conversation' }),
    `Here are selected messages from my conversation with Claude:\n\n${transcript}\n\nPlease continue from this context.`);
  assert.equal(composeShare(message, { assistant: 'Claude', reply: 'Answer', kind: 'reply' }),
    'Critique Claude’s reply: Answer');
  for (const kind of ['system', 'user', '', null, 1, {}]) {
    assert.throws(() => composeShare(message, { assistant: 'Claude', reply: 'Text', kind }), /Choose a prompt, reply, or conversation/);
  }
});

test('saved settings are kept, and anything unexpected falls back to the defaults', async () => {
  const storage = memory();
  await saveSettings(storage, { shareMode: 'draft' });
  await saveSettings(storage, { shareMessage: 'Check {assistant}: {reply}' });
  assert.deepEqual(await loadSettings(storage), { ...defaults, shareMode: 'draft', shareMessage: 'Check {assistant}: {reply}' });
  await saveSettings(storage, { shareMessage: '   ' });
  assert.equal((await loadSettings(storage)).shareMessage, DEFAULT_SHARE_MESSAGE);
  for (const stored of [null, 'x', { shareMode: 'post', shareMessage: 42 }]) {
    assert.deepEqual(readSettings(stored), defaults);
  }
  assert.equal(readSettings({ shareMessage: 'x'.repeat(MAX_SHARE_MESSAGE + 10) }).shareMessage.length, MAX_SHARE_MESSAGE);
});

test('older reply settings gain separate editable prompt and conversation defaults', async () => {
  const oldDefault = "Here is {assistant}'s reply:\n\n{reply}\n\nWhat do you think? Point out anything wrong or missing.";
  const unchanged = memory({ settings: { shareMode: 'draft', shareMessage: oldDefault } });
  assert.deepEqual(await loadSettings(unchanged), { ...defaults, shareMode: 'draft' });
  await saveSettings(unchanged, { shareMode: 'send' });
  assert.equal(unchanged.data.settings.shareMessage, DEFAULT_SHARE_MESSAGE);
  assert.equal(readSettings({ shareMessage: `${oldDefault}\nFocus on feasibility.` }).shareMessage,
    `${oldDefault}\nFocus on feasibility.`, 'customized versions of the old default are preserved');
  const storage = memory({ settings: { shareMode: 'draft', shareMessage: 'Keep this reply message: {reply}' } });
  assert.deepEqual(await loadSettings(storage), { ...defaults, shareMode: 'draft', shareMessage: 'Keep this reply message: {reply}' });
  await saveSettings(storage, { conversationMessage: 'Use these messages to make a plan:\n{content}' });
  await saveSettings(storage, { promptMessage: 'Answer in bullet points:\n{content}' });
  const settings = await loadSettings(storage);
  assert.equal(settings.shareMessage, 'Keep this reply message: {reply}');
  assert.equal(settings.conversationMessage, 'Use these messages to make a plan:\n{content}');
  assert.equal(settings.promptMessage, 'Answer in bullet points:\n{content}');
  assert.equal(settings.shareMode, 'draft');
  await saveSettings(storage, { conversationMessage: ' ', promptMessage: null });
  assert.equal((await loadSettings(storage)).conversationMessage, DEFAULT_CONVERSATION_MESSAGE);
  assert.equal((await loadSettings(storage)).promptMessage, DEFAULT_PROMPT_MESSAGE);
  for (const key of ['promptMessage', 'conversationMessage']) {
    assert.equal(readSettings({ [key]: 'x'.repeat(MAX_SHARE_MESSAGE + 10) })[key].length, MAX_SHARE_MESSAGE);
  }
});

test('custom prompts and conversation messages support content placeholders without interpreting selected text', () => {
  const selected = 'You:\nUse {content}, {assistant}, and {reply} literally. $& $1\n\nClaude:\nAnswer';
  const settings = { promptMessage: 'Explain this prompt from {assistant}:\n{content}', conversationMessage: 'My notes from {assistant}:\n{reply}\nPlease check assumptions.' };
  assert.equal(composeShare(settings, { assistant: 'Claude', reply: selected, kind: 'prompt' }),
    `Explain this prompt from Claude:\n${selected}`);
  assert.equal(composeShare(settings, { assistant: 'Claude', reply: selected, kind: 'conversation' }),
    `My notes from Claude:\n${selected}\nPlease check assumptions.`);
  assert.equal(composeShare({ conversationMessage: 'Summarize the conversation.' }, { assistant: 'Grok', reply: selected, kind: 'conversation' }),
    `Summarize the conversation.\n\n${selected}`, 'selected messages remain included when the placeholder is removed');
});
