import { PROVIDERS } from './providers.js';
import { composeComparison, REVIEW_TEMPLATES } from './settings.js';

const MAX_TARGETS = 8;
const MAX_FILES = 10;

export function createBridge(api, manager, { retryDelay = 500, retryLimit = 40 } = {}) {
  const busyWindows = new Set();

  async function locked(windowId, action) {
    if (busyWindows.has(windowId)) throw new Error('Another bridge action is running in this window. Wait for it to finish.');
    busyWindows.add(windowId);
    try { return await action(); } finally { busyWindows.delete(windowId); }
  }

  async function ask(tabId, type, payload = {}) {
    let result;
    try { result = await api.tabs.sendMessage(tabId, { type, ...payload }, { frameId: 0 }); }
    catch { throw Object.assign(new Error('Chat connection unavailable. Refresh that AI tab after installing or updating the extension.'), { retry: true }); }
    if (!result?.ok) throw Object.assign(new Error(result?.error || 'The chat did not accept the action.'), { retry: !!result?.retry });
    return result;
  }

  function chosen(state, targetIds) {
    if (!Array.isArray(targetIds) || !targetIds.length) throw new Error('Choose at least one other chat.');
    if (targetIds.length > MAX_TARGETS || new Set(targetIds).size !== targetIds.length) throw new Error('Choose each chat once.');
    return targetIds.map(id => {
      const chat = state.chats.find(item => item.id === id);
      if (!chat) throw new Error('A chosen chat closed or changed. Review the list and try again.');
      if (chat.asleep) throw new Error(`${chat.name} is asleep. Open its tab once to wake it, then try again.`);
      if (chat.loading) throw new Error(`${chat.name} is still loading. Wait for the chat tab to finish navigating.`);
      return chat;
    });
  }

  async function send(sourceId, targetIds) {
    const state = await manager.context(sourceId);
    const targets = chosen(state, targetIds);
    const ids = [sourceId, ...targets.map(chat => chat.id)];
    const labels = [PROVIDERS[state.provider].name, ...targets.map(chat => chat.name)];
    const { text, files = [], notCopied = [] } = await ask(sourceId, 'ASB_READ_DRAFT');
    if (!Array.isArray(files) || !Array.isArray(notCopied) || files.length > MAX_FILES) throw new Error('The attachments could not be read. Nothing was sent.');
    if (notCopied.length) {
      throw new Error(`Nothing was sent. ${list(notCopied)} could not be copied. Remove and reattach those files in this chat, then try again. Both chats need the same context.`);
    }
    validateText(text, { allowEmpty: files.length > 0 });
    const requestId = crypto.randomUUID();
    // Copies go out once, when staging; the source keeps and sends its own attachments.
    const payload = (id, type) => id === sourceId ? { requestId, text, source: true }
      : { requestId, text, source: false, attachments: files.length, ...(type === 'ASB_STAGE' ? { files } : {}) };
    return deliverMany({ ids, labels, requestId, payload, verify: async () => chosen(await manager.context(sourceId), targetIds) });
  }

  async function deliverMany({ ids, labels, requestId, payload, verify, sendNow = true }) {
    async function phase(type) {
      // Wait for every chat even when one fails before cancelling any of them.
      const results = await Promise.allSettled(ids.map((id, i) => ask(id, type, payload(id, type, i))));
      const errors = results.flatMap((r, i) => r.status === 'rejected' ? [`${labels[i]}: ${r.reason.message}`] : []);
      if (errors.length) throw new Error(errors.join(' '));
    }
    try {
      await phase('ASB_PREPARE');
      await phase('ASB_STAGE');
      await phase('ASB_VALIDATE');
      await verify();
    } catch (error) {
      const cleanup = await Promise.allSettled(ids.map(id => ask(id, 'ASB_CANCEL', { requestId })));
      const left = labels.filter((_, i) => cleanup[i].value?.leftAttachments);
      throw new Error(`Nothing was sent. ${error.message}${left.length ? ` Remove the copied attachments still in ${list(left)}.` : ''}`);
    }
    // Separate websites cannot be submitted atomically. Never retry a click automatically.
    const results = await Promise.allSettled(ids.map(id => ask(id, sendNow ? 'ASB_COMMIT' : 'ASB_KEEP', { requestId })));
    await Promise.allSettled(ids.map(id => ask(id, 'ASB_CANCEL', { requestId })));
    const failed = results.flatMap((result, i) => result.status === 'rejected'
      ? [`${labels[i]}: ${result.reason.message} ${sendNow ? 'Delivery is unconfirmed; check this chat before sending again.' : 'Check the draft in this chat.'}`] : []);
    const sent = labels.filter((_, i) => results[i].status === 'fulfilled');
    const success = sent.length ? `${sendNow ? 'Sent to' : 'Draft ready in'} ${list(sent)}.` : '';
    return {
      ok: true, partial: failed.length > 0,
      message: [success, ...failed].filter(Boolean).join(' '),
    };
  }

  // A freshly opened page may still be loading its composer; retry only errors marked safe to retry.
  async function insertWhenReady(tabId, text, expect) {
    let lastError;
    for (let attempt = 0; attempt < retryLimit; attempt++) {
      try { return await ask(tabId, 'ASB_INSERT', { text, ...expect }); }
      catch (error) {
        if (!error.retry) throw error;
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    throw new Error(`${lastError.message} The chat opened, but the draft was not added.`);
  }

  // One destination, one staged transaction, at most one native Send click.
  async function deliver(sourceId, tabId, text, expect, { files = [], send = true, answer, verifyTarget } = {}) {
    const requestId = crypto.randomUUID();
    const payload = { requestId, text, source: false, attachments: files.length };
    try {
      for (let attempt = 1; ; attempt++) {
        try { await ask(tabId, 'ASB_PREPARE', { ...payload, ...expect, ...(answer && { answer }) }); break; }
        catch (error) {
          // Only a pane that was just opened is worth waiting for.
          if (!expect || !error.retry || attempt >= retryLimit) throw error;
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
      await ask(tabId, 'ASB_STAGE', { ...payload, ...(files.length ? { files } : {}) });
      await ask(tabId, 'ASB_VALIDATE', payload);
      if (verifyTarget) await verifyTarget();
      else chosen(await manager.context(sourceId), [tabId]);
      if (!send) {
        await ask(tabId, 'ASB_KEEP', { requestId });
        return;
      }
    } catch (error) {
      const cleanup = await ask(tabId, 'ASB_CANCEL', { requestId }).catch(() => null);
      throw new Error(`Nothing was sent. ${error.message}${cleanup?.leftAttachments ? ' Remove the copied attachments still in that chat.' : ''}`);
    }
    try { await ask(tabId, 'ASB_COMMIT', { requestId }); }
    catch (error) { throw new Error(`${error.message} Delivery is unconfirmed; check that chat before sending again.`); }
    finally { await ask(tabId, 'ASB_CANCEL', { requestId }).catch(() => {}); }
  }

  async function share(sourceId, { targetId, provider } = {}, text, { send = false, files = [] } = {}) {
    validateFiles(files);
    validateText(text, { allowEmpty: files.length > 0 });
    const state = await manager.context(sourceId);
    if (targetId !== undefined) {
      const chat = state.chats.find(item => item.id === targetId);
      if (!chat) throw new Error('That chat closed or changed. Open Share again.');
      if (chat.side || !state.peer) {
        if (chat.asleep) throw new Error(`${chat.name} is asleep. Open its tab once to wake it, then try again.`);
        const where = chat.side ? '' : ' in its tab';
        if (send) {
          await deliver(sourceId, chat.id, text, undefined, { files, send });
          return { ok: true, message: `Sent to ${chat.name}${where}.` };
        }
        if (files.length) await deliver(sourceId, chat.id, text, undefined, { files, send: false });
        else await ask(chat.id, 'ASB_INSERT', { text });
        return { ok: true, message: `Draft added to ${chat.name}${where}. Review it, then send it there.` };
      }
    } else if (!Object.hasOwn(PROVIDERS, provider)) {
      throw new Error('Choose a supported assistant.');
    } else if (!state.peer) {
      throw new Error('Put this chat in Split View to open another assistant beside it.');
    }
    const shown = await manager.replace(state.peer.id, { tabId: targetId, provider });
    const expect = { provider: shown.provider, notPage: shown.previousPage };
    const name = PROVIDERS[shown.provider].name;
    if (send) {
      await deliver(sourceId, shown.tabId, text, expect, { files, send });
      return { ok: true, message: `Sent to ${name}, now on the ${state.peer.side}.` };
    }
    if (files.length) await deliver(sourceId, shown.tabId, text, expect, { files, send: false });
    else await insertWhenReady(shown.tabId, text, expect);
    return { ok: true, message: `${name} is on the ${state.peer.side} with the draft ready. Review it, then send it there.` };
  }

  async function comparisonPair(sourceId, { peerId, peerProvider }, menu) {
    const state = await manager.context(sourceId);
    if (!state.native || !state.peer) throw new Error(`Open two supported AI chats in Chrome Split View to use ${menu}.`);
    if (state.peer.id !== peerId || (peerProvider && state.peer.provider !== peerProvider)) {
      throw new Error(`The other pane changed. Open ${menu} again in the current split.`);
    }
    chosen(state, [peerId]);
    const peer = await manager.supported(peerId);
    if (peer.splitViewId !== state.source.splitViewId || peer.windowId !== state.source.windowId) {
      throw new Error(`The split changed. Open ${menu} again.`);
    }
    return [state.source, peer].map((tab, index) => ({
      id: tab.id, url: tab.url, split: tab.splitViewId, windowId: tab.windowId,
      name: index ? state.peer.name : PROVIDERS[state.provider].name,
      side: index ? state.peer.side : state.side,
    }));
  }

  function reviewResults(pair, { read, reviewId }) {
    return Promise.all(pair.map((chat, i) => ask(chat.id, 'ASB_REVIEW_RESULT', { peerId: pair[1 - i].id, read, ...(reviewId && { reviewId }) })));
  }

  async function compareStatus(sourceId, choice, menu = 'Compare') {
    try {
      const pair = await comparisonPair(sourceId, choice, menu);
      const [statuses, reviews] = await Promise.all([
        Promise.all(pair.map(chat => ask(chat.id, 'ASB_COMPARE_STATUS'))),
        menu === 'Cross-review' ? reviewResults(pair, { read: false }) : [],
      ]);
      const pending = reviews.find(review => review.pending);
      if (pending) return { ok: true, ready: false, message: pending.message || 'Send both review drafts and wait for both critiques to finish.' };
      const unavailable = statuses.find(status => !status.ready || !status.turn);
      if (unavailable) return { ok: true, ready: false, message: unavailable.message || `Wait for both assistants to finish, then open ${menu} again.` };
      const turns = statuses.map(status => status.turn);
      const status = { ok: true, ready: true, turns };
      if (reviews.length && reviews[0].reviewId && reviews.every((review, i) =>
        review.ready && review.reviewId === reviews[0].reviewId && review.turn === turns[i])) {
        status.revision = { reviewId: reviews[0].reviewId, turns };
      }
      return status;
    } catch (error) { return { ok: true, ready: false, message: error.message }; }
  }

  async function readAnswers(pair, turns, menu) {
    const answers = await Promise.all(pair.map(chat => ask(chat.id, 'ASB_COMPARE_READ')));
    for (const [i, answer] of answers.entries()) {
      if (!answer.turn || answer.url !== pair[i].url || (turns && turns[i] !== answer.turn)) {
        throw new Error(`An answer or conversation changed. Open ${menu} again.`);
      }
      if (typeof answer.text !== 'string' || !answer.text.trim()) throw new Error(`${pair[i].name} has no answer text to use.`);
    }
    return answers;
  }

  async function verifyAnswers(pair, choice, answers, menu) {
    const current = await comparisonPair(pair[0].id, choice, menu);
    if (current.some((chat, i) => chat.url !== pair[i].url || chat.split !== pair[i].split || chat.windowId !== pair[i].windowId || chat.side !== pair[i].side)) {
      throw new Error(`The split changed. Open ${menu} again.`);
    }
    await Promise.all(pair.map((chat, i) => ask(chat.id, 'ASB_COMPARE_CHECK', answers[i])));
  }

  async function compare(sourceId, choice, settings) {
    const pair = await comparisonPair(sourceId, choice, 'Compare');
    const reviewer = pair.findIndex(chat => chat.id === choice.targetId);
    if (reviewer < 0) throw new Error('Choose one of the two chats in this split to compare the answers.');
    const answers = await readAnswers(pair, choice.turns, 'Compare');
    const sections = pair.map((chat, i) => `${chat.name} (${chat.side} pane)\n${answers[i].text}`);
    if (pair[0].side === 'right') sections.reverse();
    const text = composeComparison(settings, { answers: sections.join('\n\n') });
    if (text.length > 60000) throw new Error('The comparison exceeds 60,000 characters. Shorten your comparison instructions or share selected excerpts.');
    const verifyTarget = () => verifyAnswers(pair, choice, answers, 'Compare');
    const target = pair[reviewer];
    const send = settings.shareMode === 'send';
    await deliver(sourceId, target.id, text, undefined, { send, answer: answers[reviewer], verifyTarget });
    return { ok: true, message: send ? `Comparison sent to ${target.name}.` : `Comparison draft added to ${target.name}. Review it, then send it there.` };
  }

  function requireReviewTurns(turns) {
    if (!Array.isArray(turns) || turns.length !== 2 || !turns.every(turn => typeof turn === 'string' && turn)) {
      throw new Error('Open Cross-review again to choose the current answers.');
    }
  }

  async function crossReview(sourceId, choice, action, settings) {
    if (typeof action !== 'string' || !Object.hasOwn(REVIEW_TEMPLATES, action)) throw new Error('Choose Critique, Find errors, or Suggest improvements.');
    requireReviewTurns(choice.turns);
    const pair = await comparisonPair(sourceId, choice, 'Cross-review');
    const answers = await readAnswers(pair, choice.turns, 'Cross-review');
    const reviewId = crypto.randomUUID();
    const instructions = [settings.reviewGuidance, settings[REVIEW_TEMPLATES[action].key]]
      .map(value => value.trim().replace(/\r\n?/g, '\n')).filter(Boolean).join('\n\n') + '\n\n';
    const prompts = pair.map((_, i) => {
      const peer = pair[1 - i];
      const text = instructions + `Answer from ${peer.name} (${peer.side} pane)\n${answers[1 - i].text}`;
      validateText(text);
      return text;
    });
    const sendNow = settings.shareMode === 'send';
    const result = await deliverMany({
      ids: pair.map(chat => chat.id), labels: pair.map(chat => `${chat.name} (${chat.side} pane)`), requestId: reviewId, sendNow,
      payload: (_id, type, i) => ({
        requestId: reviewId, text: prompts[i], attachments: 0, source: false,
        ...(type === 'ASB_PREPARE' && { answer: answers[i], review: { reviewId, peerId: pair[1 - i].id, quotedStart: instructions.length } }),
      }),
      verify: () => verifyAnswers(pair, choice, answers, 'Cross-review'),
    });
    if (!result.partial) result.message = sendNow
      ? 'Cross-review sent to both chats. Each critique will appear in its own pane.'
      : 'Review drafts are ready in both panes. Send each draft to receive its critique.';
    return result;
  }

  async function revise(sourceId, choice, reviewId, settings) {
    requireReviewTurns(choice.turns);
    if (typeof reviewId !== 'string' || !reviewId || reviewId.length > 160) throw new Error('Open a completed Cross-review to revise an answer.');
    const pair = await comparisonPair(sourceId, choice, 'Cross-review');
    const i = pair.findIndex(chat => chat.id === choice.targetId);
    if (i < 0) throw new Error('Choose the answer to revise in one of these two chats.');
    const reviews = await reviewResults(pair, { read: true, reviewId });
    if (reviews.some((review, index) => !review.ready || review.reviewId !== reviewId || review.turn !== choice.turns[index] ||
      review.url !== pair[index].url || typeof review.text !== 'string' || !review.text.trim() ||
      typeof review.original !== 'string' || !review.original.trim())) {
      throw new Error('The two critiques for this review are no longer current. Open Cross-review again.');
    }
    const peer = pair[1 - i], target = pair[i];
    const text = [
      'Revise your original answer using the critique below. Draw on your own critique of the other answer where useful. Use your own judgment about which suggestions the evidence supports, correct any errors, and give a standalone revised answer.',
      `Your original answer (${target.name}, ${target.side} pane)\n${reviews[i].original}`,
      `Critique of your answer from ${peer.name} (${peer.side} pane)\n${reviews[1 - i].text}`,
    ].join('\n\n');
    validateText(text);
    const snapshots = reviews.map(({ turn, url, text }) => ({ turn, url, text }));
    const send = settings.shareMode === 'send';
    await deliver(sourceId, target.id, text, undefined, {
      send, answer: snapshots[i], verifyTarget: () => verifyAnswers(pair, choice, snapshots, 'Cross-review'),
    });
    return { ok: true, message: send ? `Revision requested from ${target.name}.` : `Revision draft added to ${target.name}.` };
  }

  async function show(sourceId, { targetId, provider } = {}) {
    const state = await manager.context(sourceId);
    if (!state.peer) throw new Error('Put this chat in Split View to open another assistant beside it.');
    const { message } = await manager.replace(state.peer.id, { tabId: targetId, provider });
    return { ok: true, message };
  }

  return { send, share, show, compare, compareStatus, crossReview, revise, locked };
}

function list(names) {
  return names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export function validateText(text, { allowEmpty = false } = {}) {
  if (typeof text !== 'string' || (!allowEmpty && !text.trim())) throw new Error('Write a message in the chat composer first.');
  if (text.length > 60000) throw new Error('Keep shared text under 60,000 characters for this prototype.');
}

export function validateFiles(files) {
  if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error('Share up to 10 files at a time. Nothing was sent.');
  let total = 0;
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255
      || typeof file.data !== 'string' || file.data.length > 4 * Math.ceil(20 * 1024 * 1024 / 3)
      || file.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
      || (file.type !== undefined && (typeof file.type !== 'string' || file.type.length > 200))) {
      throw new Error('A shared file is invalid or exceeds 20 MB. Nothing was sent.');
    }
    const bytes = file.data.length / 4 * 3 - (file.data.endsWith('==') ? 2 : file.data.endsWith('=') ? 1 : 0);
    total += bytes;
    if (bytes > 20 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error('Shared files must fit within 20 MB each and 32 MB in total. Nothing was sent.');
  }
}
