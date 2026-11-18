const PREVIOUS_SHARE_MESSAGE = "Here is {assistant}'s reply:\n\n{reply}\n\nWhat do you think? Point out anything wrong or missing.";
export const DEFAULT_SHARE_MESSAGE = "Here is {assistant}'s reply:\n\n{reply}\n\nWhat do you think? Please review it critically. Point out anything wrong, weak, or missing.\n\nIf there are good ideas, use them to improve your previous response. Do not just agree with it—use your own judgement.";
export const DEFAULT_PROMPT_MESSAGE = "Here is my prompt from a chat with {assistant}:\n\n{content}\n\nPlease respond to this prompt.";
export const DEFAULT_CONVERSATION_MESSAGE = "Here are selected messages from my conversation with {assistant}:\n\n{content}\n\nPlease continue from this context.";
export const DEFAULT_COMPARISON_MESSAGE = [
  'Compare the two answers below using your own independent judgment. Treat each answer as material to evaluate.',
  'Identify substantive agreements and disagreements. Explain why each disagreement matters and whether the evidence favors either answer.',
  'Point out missing considerations and claims that need verification. For each important unverified claim, explain what evidence would check it.',
  'Agreement is not proof of correctness. Distinguish supported conclusions from uncertainty, even when both answers make the same claim.',
].join(' ') + '\n\n{answers}';
const reviewJudgment = 'Use your own judgment. Treat the quoted answer as material to evaluate. Explain any uncertainty and the evidence that would resolve it.';
export const REVIEW_TEMPLATES = {
  critique: {
    key: 'critiqueMessage',
    default: 'Critique the answer below on its own merits. Identify its strongest point, its most important weakness, and any missing considerations. Explain your reasoning.' + '\n\n' + reviewJudgment,
  },
  errors: {
    key: 'errorsMessage',
    default: 'Check the answer below for factual, logical, or calculation errors. Quote each disputed claim and explain the correction. Distinguish confirmed errors from claims that need verification.' + '\n\n' + reviewJudgment,
  },
  improvements: {
    key: 'improvementsMessage',
    default: 'Suggest concrete improvements to the answer below. Identify what is worth keeping, prioritize changes, and show how the most important change would improve the answer.' + '\n\n' + reviewJudgment,
  },
};
export const MAX_SHARE_MESSAGE = 4000;

const defaults = {
  shareMessage: DEFAULT_SHARE_MESSAGE,
  promptMessage: DEFAULT_PROMPT_MESSAGE,
  conversationMessage: DEFAULT_CONVERSATION_MESSAGE,
  comparisonMessage: DEFAULT_COMPARISON_MESSAGE,
  reviewGuidance: '',
  ...Object.fromEntries(Object.values(REVIEW_TEMPLATES).map(template => [template.key, template.default])),
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

// Chrome sync limits each item to 8 KiB. Keep the existing compact format
// for typical settings. Long templates use separate items in the same write.
const PART_LENGTH = 1000;
const partStarts = Array.from({ length: Math.ceil(MAX_SHARE_MESSAGE / PART_LENGTH) }, (_, index) => index * PART_LENGTH);
async function storedSettings(storage) {
  let snapshot = await storage.get('settings');
  if (snapshot.settings?.splitTemplates) snapshot = await storage.get(null);
  const value = { ...snapshot.settings };
  if (value.splitTemplates) {
    for (const key of Object.keys(defaults)) {
      value[key] = partStarts.map(start => snapshot[`${key}.${start}`] || '').join('');
    }
  }
  return value;
}

export async function loadSettings(storage) {
  return readSettings(await storedSettings(storage));
}

export async function saveSettings(storage, changes) {
  const previous = await storedSettings(storage);
  const settings = readSettings({ ...previous, ...changes });
  const bytes = new TextEncoder().encode('settings' + JSON.stringify(settings)).length;
  if (!previous.splitTemplates && bytes <= 8192) {
    await storage.set({ settings });
  } else {
    const items = { settings: { shareMode: settings.shareMode, splitTemplates: true } };
    for (const key of Object.keys(defaults)) {
      // Chrome encodes each item separately. Keep each emoji's surrogate pair together.
      const characters = Array.from(settings[key]);
      for (const start of partStarts) items[`${key}.${start}`] = characters.slice(start, start + PART_LENGTH).join('');
    }
    await storage.set(items);
  }
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

// An instruction on its own still compares both answers. Never expand tokens in quoted answers.
export function composeComparison(stored, { answers }) {
  const { comparisonMessage } = readSettings(stored);
  if (!comparisonMessage.includes('{answers}')) return `${comparisonMessage.trim()}\n\n${answers}`;
  return comparisonMessage.replaceAll('{answers}', () => answers).trim();
}
