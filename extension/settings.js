const PREVIOUS_SHARE_MESSAGE = "Here is {assistant}'s reply:\n\n{reply}\n\nWhat do you think? Point out anything wrong or missing.";
export const DEFAULT_SHARE_MESSAGE = "Here is {assistant}'s reply:\n\n{reply}\n\nWhat do you think? Please review it critically. Point out anything wrong, weak, or missing.\n\nIf there are good ideas, use them to improve your previous response. Do not just agree with it—use your own judgement.";
export const DEFAULT_PROMPT_MESSAGE = "Here is my prompt from a chat with {assistant}:\n\n{content}\n\nPlease respond to this prompt.";
export const DEFAULT_CONVERSATION_MESSAGE = "Here are selected messages from my conversation with {assistant}:\n\n{content}\n\nPlease continue from this context.";
export const MAX_SHARE_MESSAGE = 4000;

const defaults = {
  shareMessage: DEFAULT_SHARE_MESSAGE,
  promptMessage: DEFAULT_PROMPT_MESSAGE,
  conversationMessage: DEFAULT_CONVERSATION_MESSAGE,
};

// Stored values come from sync storage, so anything unexpected falls back to the defaults.
export function readSettings(stored) {
  const value = stored && typeof stored === 'object' ? stored : {};
  const messages = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    // Earlier settings saves also stored the default. Upgrade that exact text
    // while preserving any message the user customized.
    const message = key === 'shareMessage' && value[key] === PREVIOUS_SHARE_MESSAGE ? fallback : value[key];
    return [key, typeof message === 'string' && message.trim() ? message.slice(0, MAX_SHARE_MESSAGE) : fallback];
  }));
  return { shareMode: value.shareMode === 'draft' ? 'draft' : 'send', ...messages };
}

export async function loadSettings(storage) {
  const { settings } = await storage.get('settings');
  return readSettings(settings);
}

export async function saveSettings(storage, changes) {
  const settings = readSettings({ ...(await loadSettings(storage)), ...changes });
  await storage.set({ settings });
  return settings;
}

// Placeholders are filled in one pass, so braces inside the reply are never treated as placeholders.
export function composeShare(stored, { assistant, reply, kind = 'reply' }) {
  if (!['reply', 'prompt', 'conversation'].includes(kind)) throw new Error('Choose a prompt, reply, or conversation to share.');
  // Older callers may still pass the reply template directly. New kinds have
  // their own defaults, so existing reply settings never mislabel a user prompt.
  const settings = readSettings(typeof stored === 'string' ? { shareMessage: stored } : stored);
  const key = { reply: 'shareMessage', prompt: 'promptMessage', conversation: 'conversationMessage' }[kind];
  const message = settings[key];
  const template = /\{(reply|content)\}/.test(message) ? message : `${message.trimEnd()}\n\n{content}`;
  return template.replace(/\{(assistant|reply|content)\}/g, (_, token) => token === 'assistant' ? assistant : reply).trim();
}
