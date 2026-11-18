(() => {
  "use strict";

  // These selectors are intentionally narrow. A changed site should fail visibly,
  // rather than send a message through an unrelated control.
  // `voice` and `group` only position the extension's button; they are never clicked.
  // `ignore` lists reply decorations, such as citation badges, left out of shared text.
  // `prompts` match the user's own messages; one after a reply shows that reply is finished.
  const providers = {
    chatgpt: {
      name: "ChatGPT",
      hosts: ["chatgpt.com", "chat.openai.com"],
      editors: ["#prompt-textarea[contenteditable='true']", "textarea#prompt-textarea", "[contenteditable='true'][aria-label='Ask ChatGPT']", "textarea[name='prompt']", "[contenteditable='true'][data-composer-markdown]", "[contenteditable='true'][aria-label^='New chat in ' i]", "textarea[placeholder^='New chat in ' i]", "[contenteditable='true'][data-placeholder^='New chat in ' i]"],
      send: ["button[data-testid='send-button']", "button[aria-label='Send prompt']", "button[aria-label='Send message']", "button[data-composer-submit]:not([aria-label^='Stop'])", "button[aria-label='Send']"],
      stop: ["button[data-testid='stop-button']", "button[aria-label='Stop generating']", "button[aria-label='Stop streaming']", "button[aria-label='Stop']"],
      voice: ["button[data-testid='composer-speech-button']", "button[aria-label^='Start voice' i]", "button[aria-label^='Start dictation' i]", "button[aria-label^='Dictate' i]", "button[data-start-dictation]"],
      responses: ["[data-markdown-text-style='assistant-message']", "[data-assistant-markdown-root]", "[data-message-author-role='assistant'] .markdown", "[data-message-author-role='assistant']", "[data-message-role='assistant']", "[data-content-search-unit-key$=':assistant']", "[data-turn='assistant']"],
      prompts: ["[data-message-author-role='user']", "[data-message-role='user']", "[data-content-search-unit-key$=':user']"],
      ignore: ["[data-d-component='badge']"],
    },
    claude: {
      name: "Claude",
      hosts: ["claude.ai"],
      editors: ["[contenteditable='true'][data-testid='chat-input']", "[contenteditable='true'][aria-label='Write your prompt to Claude']", ".ProseMirror[contenteditable='true']", "[contenteditable='true'][role='textbox']"],
      send: ["button[data-testid='chat-input-send']", "button[aria-label='Send message']", "button[aria-label='Send Message']", "button[data-testid='send-button']"],
      stop: ["button[aria-label='Stop response']", "button[aria-label='Stop Response']", "button[aria-label='Stop generating']", "button[data-testid='stop-button']"],
      voice: ["button[aria-label='Use voice mode']", "button[aria-label^='Dictat']"],
      responses: ["[data-testid='assistant-message']", ".font-claude-response"],
      prompts: ["[data-testid='user-message']"],
    },
    gemini: {
      name: "Gemini",
      hosts: ["gemini.google.com"],
      editors: ["rich-textarea .ql-editor[contenteditable='true']", "rich-textarea [contenteditable='true']", ".ql-editor[contenteditable='true']"],
      send: ["button.send-button", "button[data-test-id='send-button']", "button[aria-label='Send message' i]", "button[aria-label='Send' i]", "button[aria-label='Submit prompt' i]"],
      stop: ["button.stop-button", "button[data-test-id='stop-button']", "button[aria-label='Stop response' i]", "button[aria-label='Stop generating' i]", "button[aria-label='Stop' i]", "button[aria-label='停止回答']", "button[aria-label='停止回复']", "button[aria-label='停止生成']"],
      voice: ["button[aria-label^='Dictate']", "button[aria-label='Microphone']"],
      group: [".input-buttons-wrapper-bottom"],
      responses: ["model-response .model-response-text", "model-response message-content", "model-response .markdown-main-panel"],
      prompts: ["user-query"],
    },
    grok: {
      name: "Grok",
      hosts: ["grok.com"],
      editors: ["[contenteditable='true'][aria-label='Ask Grok anything']", "[contenteditable='true'][data-testid='chat-input']", "textarea[placeholder='Ask anything']", "textarea[aria-label='Ask anything']", "textarea[placeholder='What do you want to know?']", "[contenteditable='true'][data-testid='composer']", "[contenteditable='true'][role='textbox']"],
      send: ["button[data-testid='chat-submit']", "button[aria-label='Send message']", "button[aria-label='Submit']", "button[aria-label='Send']", "button[data-testid='send-button']"],
      stop: ["button[aria-label='Stop response']", "button[aria-label='Stop generating']", "button[aria-label='Stop']", "button[data-testid='stop-button']"],
      voice: ["button[aria-label^='Enter voice mode' i]", "button[aria-label^='Voice mode' i]", "button[aria-label^='Dictation' i]"],
      responses: ["[data-testid='assistant-message']", "[data-message-author-role='assistant']", ".message-bubble .response-content-markdown"],
      prompts: ["[data-testid='user-message']", "[data-message-author-role='user']", "[data-message-role='user']"],
    },
  };
  const copySelectors = [
    "button[data-testid='copy-turn-action-button']", "button[data-testid='action-bar-copy']",
    "button[data-test-id='copy-button']", "button[data-copy-message]",
  ].join(", ");
  // Feedback, regenerate and read-aloud controls only appear under the assistant's replies,
  // which tells a reply's action bar apart from the bar under the user's own message.
  const REPLY_ACTION = /good response|bad response|rate response|thumbs? ?(up|down)|^(like|dislike)$|feedback|^redo$|^retry\b|regenerate|try again|read aloud/i;
  const MORE_ACTION = /^(more|more actions|more options|show more options)$/i;

  const provider = Object.keys(providers).find((key) => providers[key].hosts.includes(location.hostname));
  if (!provider || globalThis.AISplitAdapters) return;
  const config = providers[provider];
  const transactions = new Map();
  const finished = new Map();
  let lastReview = null;
  let reviewObserver = null;
  function clearReview() {
    reviewObserver?.disconnect();
    reviewObserver = null;
    lastReview = null;
  }
  const forgetDepartedReview = () => {
    if (lastReview && location.href !== lastReview.answer.url) clearReview();
  };
  globalThis.navigation?.addEventListener("currententrychange", forgetDepartedReview);
  addEventListener("popstate", forgetDepartedReview);
  addEventListener("pagehide", clearReview);
  const TRANSACTION_TTL = 60_000;
  const FINISHED_TTL = 5 * 60_000;
  const MAX_TEXT_LENGTH = 60_000;
  const MAX_FILES = 10;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  // Copies travel through extension messaging, which caps a message at 64 MiB of base64.
  const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
  const previewSelectors = [
    "[data-testid='file-thumbnail']", "[data-testid='attachment-preview']",
    "[data-testid='file-preview']", "[data-testid='file-pill']",
    "[data-testid='composer-file']", "[data-testid='attachment']",
    "file-preview", "image-preview", "attachment-preview",
    ".composer-attachment-surface", "uploader-file-preview", "gem-attachment",
    "[data-cds-attachment]",
    "[role='list'][aria-label='Conversation attachments'] > [role='listitem']",
  ].join(", ");
  const FILE_WORD = /\b(files?|attachments?|images?|photos?|pictures?|documents?|uploads?|pdf)\b/i;
  const URL_LIKE = /^https?:\/\//i;
  const DOMAIN_LIKE = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/;
  const MEDIA = "img:not(.ProseMirror-separator), video, audio, canvas";

  function normalize(text) {
    return String(text ?? "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim();
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(check, timeout, step = 100) {
    for (const end = Date.now() + timeout; ; await wait(step)) {
      if (check()) return true;
      if (Date.now() >= end) return false;
    }
  }

  // A link keeps its address: a shortened label becomes the address, any other label gains it in brackets.
  function linkText(link, label) {
    const href = link.getAttribute("href") || "";
    const shown = normalize(label);
    if (!URL_LIKE.test(href) || URL_LIKE.test(shown) || shown.includes(href)) return label;
    if (!shown || (DOMAIN_LIKE.test(shown) && href.includes(shown))) return href;
    return `${label} (${href})`;
  }

  // Marks conditions a page that is still opening can outgrow, so the bridge may try again.
  function retryable(message) {
    return Object.assign(new Error(message), { retry: true });
  }

  const ours = (node) => node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-ai-split-bridge");

  function checkedText(text, allowEmpty = false) {
    if (typeof text !== "string" || (!allowEmpty && !normalize(text))) throw new Error("Type a text prompt first.");
    if (text.length > MAX_TEXT_LENGTH) throw new Error("This prototype supports up to 60,000 characters per prompt.");
    return normalize(text);
  }

  function shown(element, allowTransparent) {
    if (!element?.isConnected || element.hidden || element.closest("[hidden], [inert]")) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
        || (!allowTransparent && style.opacity === "0") || style.contentVisibility === "hidden") return false;
    }
    return element.getClientRects().length > 0;
  }
  const visible = element => shown(element, false);
  // Reply toolbars often fade out until hovered. Keep their message boundaries
  // and injected actions stable; the site's own hover styling reveals them.
  const laidOut = element => shown(element, true);

  function firstMatch(selectors, root = document) {
    for (const selector of selectors) {
      const matches = [...root.querySelectorAll(selector)].filter(visible);
      if (matches.length > 1) throw new Error(`${config.name} has multiple matching chat controls. Open one conversation and try again.`);
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  function getEditor() {
    const editor = firstMatch(config.editors);
    if (!editor) throw retryable(`Cannot find ${config.name}'s text composer. Open a conversation and sign in. The site's layout may have changed.`);
    if (editor.disabled || editor.readOnly || editor.getAttribute("aria-disabled") === "true") {
      throw new Error(`${config.name}'s composer is unavailable right now.`);
    }
    return editor;
  }

  // Links, mentions, and tool chips read as text; emoji pictures read as their alt text.
  // `verify` reads a link chip as its bare address, which is how a site may display a pasted URL.
  function readEditor(editor, verify = false) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return normalize(editor.value);
    // innerText adds layout-dependent newlines around empty editable blocks.
    // Read editing lines directly so a blank paragraph stays one blank line.
    function editingText(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (node.tagName === "BR") return "\n";
      if (node.tagName === "IMG") return node.alt || "";
      const children = [...node.childNodes];
      if (children.length === 1 && children[0].nodeName === "BR") return "";
      if (node.getAttribute("contenteditable") === "false") {
        const label = children.map(editingText).join("").replace(/\s+/g, " ").trim();
        const link = node.matches("a[href]") ? node : node.querySelector("a[href]");
        if (!link) return label;
        return verify && URL_LIKE.test(link.getAttribute("href")) ? link.getAttribute("href") : linkText(link, label);
      }
      let text = "";
      children.forEach((child, index) => {
        const block = /^(P|DIV|LI|PRE|BLOCKQUOTE|H[1-6])$/.test(child.nodeName);
        if (block && index && !text.endsWith("\n")) text += "\n";
        text += editingText(child);
        if (block && index < children.length - 1) text += "\n";
      });
      return node.tagName === "A" && !verify ? linkText(node, text) : text;
    }
    return normalize(editingText(editor));
  }

  const matchesDraft = (editor, text) => readEditor(editor) === text || readEditor(editor, true) === text;
  const blankEditor = (editor) => !readEditor(editor) && !(editor.querySelector?.(MEDIA));

  function composerRoot(editor) {
    return editor.closest("form, [data-testid='composer'], [data-testid='chat-input-container'], [data-cds='ChatComposer'], [data-composer-body], .rounded-composer, .query-bar, .text-input-field, .input-area-container, .input-area") || editor.parentElement;
  }

  function busy() {
    return config.stop.some((selector) => [...document.querySelectorAll(selector)].some(visible));
  }

  function assertIdle() {
    if (busy()) throw retryable(`${config.name} is still responding. Wait for it to finish.`);
  }

  // ---------- Attachments ----------
  // The box holding the editor, its attachment tiles, and its Send controls.
  function attachmentScope(editor) {
    const controls = [...config.send, ...config.stop, ...(config.voice || [])].join(", ");
    let scope = composerRoot(editor);
    for (let depth = 0; depth < 6 && scope.parentElement && scope !== document.body && !scope.querySelector(controls); depth++) scope = scope.parentElement;
    return scope;
  }

  const outsideEditor = (node, editor) => !editor.contains(node) && !node.closest("[data-ai-split-bridge]") && visible(node);

  function isRemover(node, editor) {
    const label = normalize(node.getAttribute("aria-label") || node.title || "");
    if (/^close\b/i.test(label) && node.closest('uploader-file-preview, gem-attachment')) return true;
    if (!/^(remove|delete|cancel)\b/i.test(label)) return false;
    if (FILE_WORD.test(label)) return true;
    // A bare "Remove" counts when it sits on a tile showing a thumbnail or a file name.
    for (let tile = node.parentElement, depth = 0; tile && depth < 3 && !tile.contains(editor); tile = tile.parentElement, depth++) {
      if (tile.querySelector(MEDIA) || /\.\w{2,5}\b/.test(tile.textContent)) return true;
    }
    return false;
  }

  function removers(editor) {
    return [...attachmentScope(editor).querySelectorAll("button, [role='button']")]
      .filter((node) => outsideEditor(node, editor) && isRemover(node, editor));
  }

  function attachmentTiles(editor) {
    const tiles = [...attachmentScope(editor).querySelectorAll(previewSelectors)].filter((node) => outsideEditor(node, editor));
    return tiles.filter((node) => !tiles.some((other) => other !== node && other.contains(node)));
  }

  function attachmentCount(editor) {
    return Math.max(removers(editor).length, attachmentTiles(editor).length);
  }

  function assertNoAttachments(editor) {
    if (attachmentCount(editor)) throw new Error(`${config.name} already has attachments in its composer. Send or remove them first; they have been kept.`);
  }

  function assertUploadsAccepted(editor) {
    for (const tile of attachmentTiles(editor)) {
      if (tile.matches('[data-state="failed"], [data-state="error"]') || tile.querySelector('[data-state="failed"], [data-state="error"]')) {
        throw new Error(`${config.name} rejected an attachment. ${normalize(tile.textContent).slice(0,160)} Check or remove it before trying again.`);
      }
    }
  }

  function uploadsPending(editor) {
    const pending = '[aria-busy="true"], [data-state="pending"], [data-state="uploading"], [data-state="processing"], [role="progressbar"]';
    return attachmentTiles(editor).some(tile => tile.matches(pending) || [...tile.querySelectorAll(pending)].some(visible));
  }

  // Files are readable only while they are being attached, so remember each one as the site receives it.
  const tray = [];
  let injecting = false;
  function composerEditor() {
    try { return firstMatch(config.editors); } catch { return null; }
  }
  function remember(files) {
    if (injecting || !files?.length) return;
    for (const transaction of transactions.values()) transaction.attachmentsEdited = true;
    const editor = composerEditor();
    // Tiles render after this event, so an empty composer means earlier files were sent or removed.
    if (!editor || !attachmentCount(editor)) tray.length = 0;
    for (const file of files) if (file instanceof File && !tray.includes(file)) tray.push(file);
  }
  document.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "file") remember(event.target.files);
  }, true);
  document.addEventListener("paste", (event) => remember(event.clipboardData?.files), true);
  document.addEventListener("drop", (event) => remember(event.dataTransfer?.files), true);
  // Tiles list files in the order they were added, so a removed tile tells which file left.
  document.addEventListener("click", (event) => {
    const editor = composerEditor();
    const button = editor && event.target instanceof Element && event.target.closest("button, [role='button']");
    if (!button || injecting || !isRemover(button, editor)) return;
    const list = removers(editor);
    const index = list.indexOf(button);
    if (index >= 0) for (const transaction of transactions.values()) transaction.attachmentsEdited = true;
    if (index >= 0 && list.length === tray.length) tray.splice(index, 1);
  }, true);

  function attachedFiles(editor) {
    const count = attachmentCount(editor);
    if (!count) {
      tray.length = 0;
      return { files: [], unknown: 0 };
    }
    if (tray.length <= count) return { files: tray.slice(), unknown: count - tray.length };
    // More files were attached than are still shown: keep the ones named on a tile, then the latest.
    const scope = attachmentScope(editor);
    const labels = [scope.textContent.replace(editor.textContent, ""),
      ...[...scope.querySelectorAll("[aria-label], [title], [alt]")].filter((node) => !editor.contains(node))
        .map((node) => [node.getAttribute("aria-label"), node.title, node.getAttribute("alt")].join(" "))].join(" ").toLowerCase();
    const named = tray.filter((file) => file.name && labels.includes(file.name.toLowerCase())).slice(-count);
    const rest = tray.filter((file) => !named.includes(file));
    const latest = new Set(rest.slice(rest.length - (count - named.length)));
    return { files: tray.filter((file) => named.includes(file) || latest.has(file)), unknown: 0 };
  }

  function encode(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  function decode({ name, type, lastModified, data }) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name, { type: type || "", lastModified: Number(lastModified) || Date.now() });
  }

  function checkedFiles(files, expected) {
    if (files === undefined && !expected) return [];
    if (!Array.isArray(files) || files.length !== expected || files.length > MAX_FILES
      || !files.every((file) => typeof file?.name === "string" && file.name.length <= 255 && typeof file.data === "string")) {
      throw new Error("The attachments to copy did not arrive intact. Nothing was sent.");
    }
    return files.map(decode);
  }

  // Reads the prompt to send: its text plus copies of the attachments this page saw being added.
  async function readPrompt() {
    let editor = getEditor();
    assertIdle();
    assertUploadsAccepted(editor);
    // ChatGPT folds a long paste into a separate card. Its preview is truncated,
    // and clipboard files do not contain this text. Use the site's own expansion
    // action so both chats receive the full prompt, including after a page reload.
    if (provider === 'chatgpt') {
      for (let i = 0; i < MAX_FILES; i++) {
        const scope = attachmentScope(editor);
        const cards = [...scope.querySelectorAll("button[aria-label='Remove pasted text attachment']")];
        if (!cards.length) break;
        const card = cards[0].parentElement;
        const expand = [...card.querySelectorAll('button')].find(button => normalize(button.textContent) === 'Show in text field');
        if (!expand || expand.disabled) throw new Error('The pasted text is still loading. Wait until “Show in text field” is available, then try again.');
        expand.click();
        if (!await until(() => !card.isConnected, 5000)) throw new Error('Could not expand the pasted text. Choose “Show in text field” before sending to both. Nothing was sent.');
        editor = getEditor();
      }
      if (attachmentScope(editor).querySelector("button[aria-label='Remove pasted text attachment']")) {
        throw new Error('Expand the remaining pasted text using “Show in text field” before sending to both.');
      }
    }
    const text = readEditor(editor);
    const { files, unknown } = attachedFiles(editor);
    const copies = [];
    const notCopied = [];
    let total = 0;
    for (const file of files) {
      if (copies.length >= MAX_FILES) { notCopied.push(file.name || "an attachment"); continue; }
      if (file.size > MAX_FILE_BYTES || total + file.size > MAX_TOTAL_BYTES) { notCopied.push(`${file.name} (too large to copy)`); continue; }
      try {
        copies.push({ name: file.name, type: file.type, lastModified: file.lastModified, data: encode(new Uint8Array(await file.arrayBuffer())) });
        total += file.size;
      } catch {
        notCopied.push(`${file.name} (could not be read)`);
      }
    }
    if (unknown) notCopied.push(`${unknown} attachment${unknown === 1 ? "" : "s"} added before the extension could read ${unknown === 1 ? "it" : "them"}`);
    return { ok: true, text, files: copies, notCopied };
  }

  function fileInput(editor, files) {
    const allows = (input, file) => !input.accept || input.accept.split(",").some((rule) => {
      rule = rule.trim().toLowerCase();
      if (!rule || rule === '*/*') return true;
      if (rule.startsWith(".")) return file.name.toLowerCase().endsWith(rule);
      return rule.endsWith("/*") ? file.type.startsWith(rule.slice(0, -1)) : file.type === rule;
    });
    const inputs = [...document.querySelectorAll("input[type='file']")]
      .filter((input) => !input.disabled && (files.length === 1 || input.multiple) && files.every((file) => allows(input, file)));
    const scope = attachmentScope(editor);
    return inputs.find((input) => scope.contains(input)) || (inputs.length === 1 ? inputs[0] : null);
  }

  // Prefer the actual upload input, including Claude's hidden file-upload input.
  // An unrelated DOM mutation is not upload acknowledgement. Hand off once and
  // wait for attachment tiles; trying a second route can duplicate a slow upload.
  async function attach(transaction) {
    const { editor, files } = transaction;
    const start = attachmentCount(editor);
    transaction.removersBefore = new Set(removers(editor));
    transaction.attachmentsBefore = start;
    const bundle = () => {
      const data = new DataTransfer();
      for (const file of files) data.items.add(file);
      return data;
    };
    const input = fileInput(editor, files);
    injecting = true;
    try {
      if (input) {
        input.files = bundle().files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        transaction.input = input;
      } else {
        editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: bundle(), bubbles: true, cancelable: true }));
      }
    } finally {
      injecting = false;
    }
    const arrived = await until(() => {
      assertUnchanged(transaction, transaction.text);
      return attachmentCount(editor) >= start + files.length;
    }, 30_000);
    if (transaction.input) transaction.input.value = "";
    if (!arrived) throw new Error(`${config.name} did not show the copied attachments. It may not accept these files.`);
  }

  // Removes only the tiles this request added; returns how many could not be removed.
  async function detach(transaction) {
    const added = () => removers(transaction.editor).filter((button) => !transaction.removersBefore.has(button));
    for (let tries = 0; tries <= transaction.files.length + 1 && added().length; tries++) {
      injecting = true;
      try { added().at(-1).click(); } finally { injecting = false; }
      await wait(150);
    }
    if (transaction.input) transaction.input.value = "";
    return Math.max(added().length, attachmentCount(transaction.editor) - transaction.attachmentsBefore);
  }

  // Gemini can put the action row outside the text field and switch the trailing
  // action from a microphone to Send after the editor processes a paste.
  function geminiSendButton(editor) {
    const pageBoundary = "main, body, html, [role='main'], [role='log'], nav, aside, [role='navigation']";
    const controlOwner = "form, input-area-v2, input-area, .composer, [data-testid='composer'], aside, nav, [role='dialog'], [role='search'], [role='region'], [role='complementary']";
    const sendName = /^(?:(?:send|submit)(?: (?:message|prompt|query))?(?: to Gemini)?|(?:发送|發送|傳送|提交)(?:消息|訊息|提示(?:詞|词)?)?)\s*(?:[（(][^()（）]+[)）])?$/i;
    for (let root = editor.parentElement, depth = 0; root && depth < 10; root = root.parentElement, depth++) {
      if (root.matches(pageBoundary) || root.querySelector("model-response, user-query, [role='log']")) break;
      const otherEditor = [...root.querySelectorAll("[contenteditable='true']")]
        .some(other => other !== editor && !editor.contains(other) && !other.contains(editor) && visible(other));
      if (otherEditor) break;
      const candidates = [...root.querySelectorAll("button, [role='button']")].filter(button => {
        const owner = button.closest(controlOwner);
        if ((owner && !owner.contains(editor)) || editor.contains(button)
          || button.closest("[data-ai-split-bridge], [role='menu'], [aria-hidden='true']")) return false;
        // A shared send/stop slot may retain its CSS class after changing actions.
        // Prefer the current accessible name whenever the page provides one.
        const labelledBy = (button.getAttribute("aria-labelledby") || "").split(/\s+/)
          .map(id => id && document.getElementById(id)?.textContent).filter(Boolean).join(" ");
        const name = normalize(labelledBy || button.getAttribute("aria-label") || button.title || button.getAttribute("mattooltip"));
        const isSend = name ? sendName.test(name)
          : sendName.test(normalize(button.textContent)) || button.matches("button.send-button, [data-test-id='send-button'], [data-testid='send-button']")
            || !!button.querySelector("[data-mat-icon-name='send'], [fonticon='send']");
        return isSend && visible(button);
      });
      if (candidates.length > 1) throw new Error("Gemini has multiple Send buttons in this composer. Open one conversation and try again.");
      if (candidates.length) return candidates[0];
      if (root.matches("form, input-area-v2, .composer, [data-testid='composer'], [role='dialog']")) break;
    }
    return null;
  }

  function sendButton(editor, waitForRender = false) {
    const scope = composerRoot(editor);
    const button = provider === "gemini" ? geminiSendButton(editor) : firstMatch(config.send, scope) || firstMatch(config.send);
    if (!button) {
      if (waitForRender) return null;
      throw new Error(`Cannot identify ${config.name}'s Send button. Nothing was sent from this tab.`);
    }
    if (button.disabled || button.getAttribute("aria-disabled") === "true" || button.closest("[inert]")) {
      if (waitForRender) return null;
      throw new Error(`${config.name}'s Send button is not ready. Nothing was sent from this tab.`);
    }
    return button;
  }

  function prune() {
    const now = Date.now();
    for (const [id, time] of finished) if (now - time > FINISHED_TTL) finished.delete(id);
    for (const [id, transaction] of transactions) {
      if (now > transaction.expires) {
        transactions.delete(id);
        finished.set(id, now);
      }
    }
  }

  function requestId(id) {
    if (typeof id !== "string" || id.length < 1 || id.length > 160) throw new Error("Invalid collaboration request.");
    return id;
  }

  function transactionFor(id) {
    prune();
    requestId(id);
    const transaction = transactions.get(id);
    if (!transaction) throw new Error("This send request expired or was already handled. Check both chats before trying again.");
    return transaction;
  }

  function assertUnchanged(transaction, expected) {
    if (location.href !== transaction.url || !transaction.editor.isConnected || getEditor() !== transaction.editor) {
      throw new Error("The conversation changed during the request. Nothing further will be sent.");
    }
    if (!matchesDraft(transaction.editor, expected)) throw new Error("A draft changed during the request. Your edits have been kept; nothing further will be sent.");
    if (transaction.attachmentsEdited) throw new Error('Attachments changed during the request. Your edits have been kept; nothing further will be sent.');
    assertIdle();
    // Once copies are being attached, the tiles are this request's own.
    if (!transaction.source && !transaction.removersBefore) assertNoAttachments(transaction.editor);
  }

  async function writeEditor(editor, text) {
    editor.focus({ preventScroll: true });
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(editor, text);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } else {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      let inputFired = false;
      const onInput = () => { inputFired = true; };
      editor.addEventListener("input", onInput);
      let inserted;
      try {
        // Use the browser editing pipeline so ProseMirror/Quill receive an edit.
        inserted = document.execCommand("insertText", false, text);
      } finally {
        editor.removeEventListener("input", onInput);
      }
      if (!inserted) throw new Error(`Could not safely edit ${config.name}'s composer. Check its draft before continuing.`);
      if (!inputFired) editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    // Give controlled editors a chance to render their authoritative state.
    await wait(100);
    if (!editor.isConnected || getEditor() !== editor || !matchesDraft(editor, normalize(text))) {
      throw new Error(`Could not verify the draft in ${config.name}. Check its composer; nothing was sent from this tab.`);
    }
  }

  // After a pane navigates, the outgoing page can still answer briefly; it must not take the message.
  function assertExpectedPage(expected, notPage) {
    if ((expected && expected !== provider) || (notPage !== undefined && notPage === performance.timeOrigin)) {
      throw retryable(`${config.name} is still opening.`);
    }
  }

  function preflight({ requestId: id, text, source = false, attachments = 0, provider: expected, notPage, answer, review }) {
    assertExpectedPage(expected, notPage);
    const originalTurn = answer && checkedAnswerElement(answer);
    if (review !== undefined) {
      if (!answer || source || attachments || !Number.isSafeInteger(review?.peerId) || review.peerId < 0) {
        throw new Error("Invalid cross-review request.");
      }
      requestId(review.reviewId);
      if (lastReview?.sent && lastReview.answer.url === location.href && lastReview.answer.text === answer.text &&
          sameReviewSource(lastReview, originalTurn)) {
        throw new Error(`A cross-review was already sent to ${config.name} for this answer. Check the chat before starting another.`);
      }
    }
    prune();
    requestId(id);
    if (transactions.has(id) || finished.has(id)) throw new Error("This request was already handled. Check both chats before trying again.");
    if (transactions.size) throw new Error("Another collaboration request is in progress. Wait for it to finish.");
    if (!Number.isInteger(attachments) || attachments < 0 || attachments > MAX_FILES) throw new Error("Invalid collaboration request.");
    const editor = getEditor();
    assertIdle();
    const attached = source ? attachmentCount(editor) : attachments;
    text = checkedText(text, attached > 0);
    const original = readEditor(editor);
    if (source && original !== text) throw new Error("Your prompt changed. Review it and click Send to both again.");
    if (!source && !blankEditor(editor)) throw new Error(`${config.name} already has a draft. Send or clear it first; your draft has been kept.`);
    if (!source) assertNoAttachments(editor);
    // Send stays disabled while the site uploads attachments; validation waits for it.
    if (source && !attached) sendButton(editor);
    transactions.set(id, { editor, text, original, source, answer, review, reviewSource: review && reviewTurnKey(originalTurn), attachments, sourceAttachments: source ? attached : 0, files: [], url: location.href, state: "prepared", expires: Date.now() + TRANSACTION_TTL + (attached ? 90_000 : 0) });
    return { ok: true };
  }

  async function stage({ requestId: id, text, source = false, files }) {
    const transaction = transactionFor(id);
    if (transaction.state !== "prepared" || checkedText(text, true) !== transaction.text || source !== transaction.source) throw new Error("This request no longer matches the prepared draft.");
    const copies = source ? [] : checkedFiles(files, transaction.attachments);
    assertUnchanged(transaction, transaction.original);
    // Mark before editing so cancellation can safely remove a verified staged draft
    // even when the editor's input event handler reports an error.
    transaction.state = "staged";
    if (!transaction.source) {
      if (transaction.text) await writeEditor(transaction.editor, transaction.text);
      if (copies.length) {
        transaction.files = copies;
        await attach(transaction);
      }
    }
    assertUnchanged(transaction, transaction.text);
    return { ok: true };
  }

  function ready(transaction) {
    if (transaction.state !== "staged") throw new Error("The draft has not been staged.");
    assertUnchanged(transaction, transaction.text);
    assertUploadsAccepted(transaction.editor);
    if (uploadsPending(transaction.editor)) throw new Error(`${config.name} is still processing the attachments. Wait for them to finish.`);
    const expected = transaction.source ? transaction.sourceAttachments : transaction.attachments;
    if (attachmentCount(transaction.editor) !== expected) throw new Error(`${config.name}'s attachments changed or an upload failed. Check its composer; nothing further was sent.`);
    return sendButton(transaction.editor);
  }

  async function validate({ requestId: id }) {
    const transaction = transactionFor(id);
    if (transaction.files.length || attachmentCount(transaction.editor)) {
      // Uploads keep Send disabled for a while after the tiles appear.
      await until(() => {
        assertUnchanged(transaction, transaction.text);
        assertUploadsAccepted(transaction.editor);
        try { return !!ready(transaction); } catch { return false; }
      }, 60_000, 250);
    } else if (provider === "gemini") {
      await until(() => {
        assertUnchanged(transaction, transaction.text);
        return !!sendButton(transaction.editor, true);
      }, 4000);
    }
    ready(transaction);
    // Other chats may still be uploading; keep this one's request alive until they are ready too.
    transaction.expires = Date.now() + TRANSACTION_TTL + (transaction.attachments || transaction.sourceAttachments ? 90_000 : 0);
    return { ok: true };
  }

  function commit({ requestId: id }) {
    const transaction = transactionFor(id);
    if (transaction.answer) checkCompareAnswer(transaction.answer);
    const button = ready(transaction);
    // A click can synchronously navigate or throw after reaching a page handler.
    // Remember the attempt before clicking and never retry it automatically.
    transactions.delete(id);
    finished.set(id, Date.now());
    button.click();
    rememberReview(transaction, true);
    return { ok: true, status: "clicked" };
  }

  // Release a verified shared draft without clicking Send or rolling back its files.
  function keep({ requestId: id }) {
    const transaction = transactionFor(id);
    if (transaction.answer) checkCompareAnswer(transaction.answer);
    ready(transaction);
    transactions.delete(id);
    finished.set(id, Date.now());
    rememberReview(transaction, false);
    return { ok: true };
  }

  async function cancel({ requestId: id }) {
    requestId(id);
    const transaction = transactions.get(id);
    transactions.delete(id);
    finished.set(id, Date.now());
    let leftAttachments = 0;
    if (transaction && !transaction.source && transaction.state === "staged"
      && location.href === transaction.url && transaction.editor.isConnected
      && !transaction.attachmentsEdited
      && matchesDraft(transaction.editor, transaction.text)) {
      // Never erase a user edit, or touch the source prompt during rollback.
      if (transaction.removersBefore) leftAttachments = await detach(transaction);
      if (transaction.text) await writeEditor(transaction.editor, transaction.original);
    } else if (transaction?.removersBefore && transaction.editor.isConnected && location.href === transaction.url) {
      leftAttachments = Math.max(0, attachmentCount(transaction.editor) - transaction.attachmentsBefore);
    }
    return { ok: true, leftAttachments };
  }

  async function insert({ text, provider: expected, notPage }) {
    assertExpectedPage(expected, notPage);
    prune();
    if (transactions.size) throw new Error("Another collaboration request is in progress.");
    text = checkedText(text);
    const editor = getEditor();
    assertIdle();
    if (!blankEditor(editor)) throw new Error(`${config.name} already has a draft. Send or clear it first; your draft has been kept.`);
    assertNoAttachments(editor);
    await writeEditor(editor, text);
    return { ok: true };
  }

  function responseText(element) {
    const clone = element.cloneNode(true);
    const hidden = ["button", "input", "textarea", "nav", "time", "style", "script", "template", "[hidden]",
      "[role='button']", "[role='toolbar']", "[aria-hidden='true']", ".sr-only", ".visually-hidden", ".cdk-visually-hidden", ...(config.ignore || [])];
    clone.querySelectorAll(hidden.join(", ")).forEach((node) => node.remove());
    const block = /^(P|DIV|PRE|LI|UL|OL|H[1-6]|BLOCKQUOTE|TABLE|SECTION)$/;
    function serialize(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (node.tagName === "BR") return "\n";
      if (node.tagName === "PRE") return `\n${node.textContent}\n`;
      if (node.tagName === "TR") return `${[...node.children].map((cell) => normalize(serialize(cell))).join(" | ")}\n`;
      const text = [...node.childNodes].map(serialize).join("");
      if (node.tagName === "A") return linkText(node, text);
      return block.test(node.tagName) ? `\n${text}\n` : text;
    }
    return normalize(serialize(clone).replace(/\n{3,}/g, "\n\n"));
  }

  function rawResponses() {
    // Different renderers can coexist in a conversation. Collect every turn in DOM order.
    const found = [...document.querySelectorAll(config.responses.join(", "))].filter(node => {
      if (provider !== "chatgpt") return visible(node);
      if (node.closest("aside, nav, [role='dialog'], [role='complementary'], [data-testid='chat-side-pane'], [contenteditable='true']")) return false;
      // A display:contents wrapper has no box of its own even when its text is visible.
      return visible(node) || (getComputedStyle(node).display === "contents"
        && [...node.querySelectorAll("*")].some(visible));
    });
    return found.filter(node => !found.some(other => other !== node && other.contains(node)));
  }

  function promptElements() {
    const found = [...document.querySelectorAll(config.prompts.join(", "))].filter(visible);
    // Grok also renders user bubbles without a role attribute. An Edit action identifies
    // those bubbles, while an assistant markdown block or another turn stops the search.
    if (provider === "grok") {
      for (const button of document.querySelectorAll("button")) {
        if (!/^edit(?: message| prompt)?$/i.test(actionLabel(button))) continue;
        for (let node = button.parentElement, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
          if (node.querySelector(config.responses.join(", ")) || node.querySelector("[contenteditable='true'], textarea")) break;
          const bubbles = [...node.querySelectorAll(".message-bubble")].filter(visible);
          if (bubbles.length > 1) break;
          if (bubbles.length === 1) { found.push(bubbles[0]); break; }
        }
      }
    }
    return [...new Set(found)].filter(node => !found.some(other => other !== node && other.contains(node)));
  }

  // Claude can render several Markdown blocks and file cards before one action bar.
  // Stop at a user turn, composer, or a second action bar so neighbouring replies never merge.
  function replyScope(element, raw, bars) {
    const semantic = element.closest("[data-chatgpt-selection-message-id], [data-message-author-role='assistant'], [data-message-role='assistant'], [data-testid='assistant-message'], model-response");
    if (provider === "chatgpt") {
      return semantic || element.closest("[data-content-search-unit-key$=':assistant'], [data-turn='assistant']") || element;
    }
    if (provider !== "claude") return semantic || element;
    raw ??= rawResponses();
    bars ??= actionBars(raw);
    let grouped = semantic || element;
    for (let node = element, depth = 0; node && node !== document.body && node.tagName !== "MAIN" && depth < 8; node = node.parentElement, depth++) {
      if (node.querySelector(config.prompts.join(", ")) || node.querySelector("[contenteditable='true'], textarea")) break;
      const ownBars = bars.filter(bar => node.contains(bar));
      if (ownBars.length > 1) break;
      if (ownBars.length === 1) return node;
      if (raw.filter(response => node.contains(response)).length > 1) grouped = node;
    }
    return grouped;
  }

  function responseElements(raw = rawResponses()) {
    const bars = provider === "claude" ? actionBars(raw) : [];
    return [...new Set(raw.map(element => replyScope(element, raw, bars)))];
  }

  function replyBody(element, raw = rawResponses()) {
    if (provider !== "claude" && provider !== "gemini") return responseText(element);
    const blocks = raw.filter(node => node === element || element.contains(node));
    return blocks.length ? blocks.map(responseText).filter(Boolean).join("\n\n") : responseText(element);
  }

  function selectedWithin(element) {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return "";
    return normalize(selection.toString());
  }

  // A newer prompt or reply after this one means it is finished, even while the site writes the next reply.
  function followedByNewer(element) {
    return [...responseElements(), ...promptElements()].some((node) => !element.contains(node) && !node.contains(element)
      && !!(element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
  }

  // Reads a whole reply, or only the part explicitly selected on the page.
  function replyText(element, { whole = false } = {}) {
    element = replyScope(element);
    const selected = whole ? "" : selectedWithin(element);
    if (selected) return { ok: true, text: checkedText(selected), partial: true };
    if (!followedByNewer(element)) assertIdle();
    const files = globalThis.AISplitReplyFiles?.list(element) || [];
    const text = replyBody(element);
    if (!text && !files.length) throw new Error(`This ${config.name} reply has no text or files to share. Select the text you want, then try again.`);
    return { ok: true, text: checkedText(text, files.length > 0), partial: false, ...(files.length ? { files } : {}) };
  }

  async function readReply(element, options = {}) {
    element = replyScope(element);
    if (!options.whole && selectedWithin(element)) return replyText(element);
    if (!followedByNewer(element)) assertIdle();
    await globalThis.AISplitReplyFiles?.expand(replyScope(element));
    if (!element.isConnected) throw new Error("This reply changed while reading it. Select it again.");
    return replyText(element, options);
  }

  function latestReply() {
    return responseElements().at(-1) || replyAnchors().at(-1)?.response || null;
  }

  // Read only the latest turn's rendered answer, independent of text selection and file controls.
  const compareTurns = new WeakMap();
  function currentAnswer() {
    const raw = rawResponses();
    const latest = messageElements({ raw, withReplyTools: true }).at(-1);
    const answer = completedAnswer(latest, raw);
    return { answer, element: latest.element };
  }
  const compareAnswer = () => currentAnswer().answer;

  function completedAnswer(latest, raw) {
    assertIdle();
    if (latest?.role !== "assistant") {
      throw new Error(`Wait for an answer to the latest prompt in ${config.name}, then open Compare again.`);
    }
    const element = latest.element;
    const streaming = "[data-is-streaming='true'], [data-is-loading='true'], [aria-busy='true']";
    if (element.closest(streaming) || element.querySelector(streaming)) throw new Error(`${config.name} is still responding. Wait for it to finish.`);
    const text = replyBody(element, raw);
    if (!text) throw new Error(`${config.name}'s latest answer has no text to compare.`);
    if (text.length > MAX_TEXT_LENGTH) throw new Error(`${config.name}'s latest answer exceeds the 60,000-character comparison limit.`);
    let identity = compareTurns.get(element);
    if (identity?.url !== location.href || identity.text !== text) {
      identity = { turn: crypto.randomUUID(), url: location.href, text };
      compareTurns.set(element, identity);
    }
    return { ok: true, ...identity };
  }

  function reviewTurnKey(element) {
    const attributes = ['data-message-id', 'data-chatgpt-selection-message-id', 'data-turn-key', 'data-content-search-unit-key', 'data-turn-id', 'data-response-id'];
    const selector = attributes.map(key => `[${key}]`).join(',');
    const marker = element.closest(selector) || element.querySelector(selector);
    if (marker) {
      const key = attributes.find(attribute => marker.getAttribute(attribute));
      if (key) return key + '/' + marker.getAttribute(key);
    }
    return element.closest('.conversation-container[id]')?.id || null;
  }

  const oneLine = value => normalize(value).replace(/\s+/g, " ");
  const sameReviewSource = (record, element) => compareTurns.get(element)?.turn === record.answer.turn ||
    !!record.sourceKey && record.sourceKey === reviewTurnKey(element);
  function matchesReviewRequest(record, text) {
    if (record.prompt) return text === record.prompt.text;
    if (text === record.request) return true;
    // In draft mode the user can edit their instructions around the complete labelled peer answer.
    return !record.sent && !!record.quote && (` ${text} `).includes(` ${record.quote} `);
  }

  function bindReviewPrompt(record, turns, raw) {
    const end = turns.length - (turns.at(-1)?.role === "assistant" ? 2 : 1);
    const prompt = turns[end];
    if (prompt?.role !== "user") return false;
    const element = prompt.element;
    const body = provider === "gemini" ? element.querySelector(".query-content") || element : element;
    const text = oneLine(responseText(body));
    if (!matchesReviewRequest(record, text)) return false;
    if (record.prompt) {
      const bound = record.prompt.node.deref();
      if (bound === element) return true;
      if (bound?.isConnected || !record.prompt.key || record.prompt.key !== reviewTurnKey(element)) return false;
      record.prompt.node = new WeakRef(element);
      return true;
    }
    const previous = turns[end - 1];
    if (previous?.role !== "assistant") return false;
    if (!sameReviewSource(record, previous.element) || replyBody(previous.element, raw) !== record.answer.text) return false;
    record.prompt = { node: new WeakRef(element), key: reviewTurnKey(element), text };
    record.sent = true;
    reviewObserver?.disconnect();
    reviewObserver = null;
    return true;
  }

  function rememberReview(transaction, sent) {
    if (!transaction.review || location.href !== transaction.url) return;
    clearReview();
    const { reviewId, peerId, quotedStart } = transaction.review;
    const quote = Number.isSafeInteger(quotedStart) && quotedStart > 0 && quotedStart < transaction.text.length
      ? oneLine(transaction.text.slice(quotedStart)) : '';
    const record = { reviewId, peerId, answer: transaction.answer, sourceKey: transaction.reviewSource,
      request: oneLine(transaction.text), sent, quote, prompt: null };
    lastReview = record;
    const bind = () => {
      forgetDepartedReview();
      if (lastReview !== record) return;
      const raw = rawResponses();
      bindReviewPrompt(record, messageElements({ raw, withReplyTools: true }), raw);
    };
    // Bind when the native user turn appears, while long virtualized chats still have the original in view.
    // Ignore assistant token streaming and disconnect as soon as the request has a verified turn.
    const selector = [...config.prompts, ...(provider === 'grok' ? ['.message-bubble'] : [])].join(',');
    reviewObserver = new MutationObserver(changes => {
      for (const change of changes) {
        const target = change.target.nodeType === Node.ELEMENT_NODE ? change.target : change.target.parentElement;
        if (target?.closest(selector) || [...change.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE &&
          (node.matches(selector) || node.querySelector(selector)))) { bind(); break; }
      }
    });
    reviewObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    bind();
  }

  // Only an answer directly following this round's own submitted request is a critique.
  // Whitespace can change when the site renders a draft as message paragraphs.
  function reviewResult({ peerId, read = false, reviewId }) {
    forgetDepartedReview();
    const record = lastReview;
    const unavailable = { ok: true, ready: false };
    if (!record || record.peerId !== peerId || ((read || reviewId !== undefined) && record.reviewId !== reviewId)) return unavailable;
    const raw = rawResponses();
    const turns = messageElements({ raw, withReplyTools: true });
    const latest = turns.at(-1);
    if (!latest) return unavailable;
    const originalStillLatest = latest.role === "assistant" && sameReviewSource(record, latest.element);
    if (originalStillLatest && replyBody(latest.element, raw) === record.answer.text) {
      if (record.sent) return { ...unavailable, pending: true, message: `Waiting for ${config.name} to answer the cross-review request.` };
      const editor = firstMatch(config.editors);
      return editor && matchesReviewRequest(record, oneLine(readEditor(editor)))
        ? { ...unavailable, pending: true, message: `Send the cross-review draft in ${config.name} to get its critique.` } : unavailable;
    }
    if (!bindReviewPrompt(record, turns, raw)) return unavailable;
    if (latest.role === "user") return { ...unavailable, pending: true, message: `Waiting for ${config.name}'s critique.` };
    let answer;
    try { answer = completedAnswer(latest, raw); }
    catch (error) { return { ...unavailable, pending: true, message: error.message }; }
    const result = { ok: true, ready: true, reviewId: record.reviewId, turn: answer.turn };
    return read ? { ...result, url: answer.url, text: answer.text, original: record.answer.text } : result;
  }

  function compareStatus() {
    try { return { ok: true, ready: true, turn: compareAnswer().turn }; }
    catch (error) { return { ok: true, ready: false, message: error.message }; }
  }

  function checkedAnswerElement(snapshot) {
    const { answer: current, element } = currentAnswer();
    if (snapshot.turn !== current.turn || snapshot.url !== current.url || snapshot.text !== current.text) {
      throw new Error(`The answer in ${config.name} changed. Open Compare again to use the current answers.`);
    }
    return element;
  }
  function checkCompareAnswer(snapshot) {
    checkedAnswerElement(snapshot);
    return { ok: true };
  }

  function getResponse() {
    const latest = latestReply();
    if (!latest) throw new Error(`Could not find a reply from ${config.name}. Select the reply text on the page, then try again.`);
    // While the newest reply is still being written, an older one must not be passed off as the latest.
    if (!selectedWithin(latest) && followedByNewer(latest)) assertIdle();
    return replyText(latest);
  }

  // Climbs past single-child wrappers so the extension's button sits beside the site's control, not inside it.
  function slotFor(node, scope) {
    let slot = node;
    while (slot.parentElement && slot.parentElement !== scope
      && [...slot.parentElement.children].filter((child) => !ours(child)).length === 1) slot = slot.parentElement;
    return slot;
  }

  const iconOnly = (slot) => !ours(slot) && !normalize(slot.textContent)
    && (slot.matches("button") ? 1 : slot.querySelectorAll("button").length) === 1;

  // Sits in front of the row of icon buttons (mic, voice, send) that ends the composer, keeping them together.
  function beforeIcons(slot) {
    let first = slot;
    for (let node = slot.previousElementSibling; node && iconOnly(node); node = node.previousElementSibling) first = node;
    return { parent: first.parentElement, before: first };
  }

  function composerAnchor() {
    let editor;
    try { editor = firstMatch(config.editors); } catch { return null; }
    if (!editor) return null;
    const buttons = [...config.send, ...config.stop, ...(config.voice || [])];
    const scopes = [];
    for (let scope = editor.parentElement; scope && scopes.length < 8; scope = scope.parentElement) scopes.push(scope);
    for (const scope of scopes) {
      const group = (config.group || []).flatMap((selector) => [...scope.querySelectorAll(selector)]).find(visible);
      if (group) return { parent: group, before: [...group.children].find((child) => !ours(child)) || null };
      const button = buttons.flatMap((selector) => [...scope.querySelectorAll(selector)]).find(visible);
      if (button) return beforeIcons(slotFor(button, scope));
    }
    // An unrecognized layout: use the last button after the editor, which is where every site puts Send.
    for (const scope of scopes) {
      const trailing = [...scope.querySelectorAll("button")].filter((node) => visible(node) && !editor.contains(node)
        && (editor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (trailing.length) return beforeIcons(slotFor(trailing.at(-1), scope));
    }
    return null;
  }

  const actionLabel = (button) => normalize(button.getAttribute("aria-label") || button.title || "");
  const isCopy = (button) => button.matches(copySelectors)
    || (provider === "gemini" && !!button.closest("message-actions copy-button"))
    || (/^copy\b/i.test(actionLabel(button)) && !/\b(code|prompt|link|table|image)\b/i.test(actionLabel(button)));
  const isAction = (button) => isCopy(button) || REPLY_ACTION.test(actionLabel(button)) || MORE_ACTION.test(actionLabel(button));

  // A reply's action bar is the smallest container around its feedback or regenerate control that holds other reply actions.
  function actionBars(known) {
    const bars = new Set();
    for (const button of document.querySelectorAll("button")) {
      if (!REPLY_ACTION.test(actionLabel(button)) || button.closest("pre, [contenteditable='true'], [aria-hidden='true']") || !laidOut(button)) continue;
      for (let node = button.parentElement, depth = 0; node && node !== document.body && depth < 5; node = node.parentElement, depth++) {
        if (known.some((response) => node.contains(response))) break;
        const buttons = [...node.querySelectorAll("button")];
        // An inline writing block has its own Copy and occasionally Read aloud.
        // Its editor actions belong to the document inside the assistant reply.
        if (provider === "chatgpt" && buttons.some(control =>
          /^(?:open editor|save as page)$/i.test(actionLabel(control) || normalize(control.textContent)))) break;
        if (buttons.filter(isAction).length > 1) {
          bars.add(node);
          break;
        }
      }
    }
    return [...bars];
  }

  // The reply a bar acts on: the one wrapping it, or the nearest one before it within the same turn.
  function replyFor(bar, bars, known) {
    const owner = known.find((response) => response.contains(bar));
    if (owner) return owner;
    const turn = provider === "chatgpt"
      ? bar.closest("[data-talvt-turn-state], [data-turn-id], [data-testid^='conversation-turn-'], article")
      : null;
    const local = turn ? known.filter(response => turn.contains(response)) : known;
    let child = bar;
    for (let node = bar.parentElement, depth = 0; node && node !== document.body && node !== turn?.parentElement && depth < 8; child = node, node = node.parentElement, depth++) {
      if (bars.some((other) => other !== bar && node.contains(other))) return null;
      const earlier = local.filter((response) => node.contains(response) && (response.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (earlier.length) return earlier.at(-1);
      if (local.length) continue;
      for (let sibling = child.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        // A shared turn can contain a user prompt, its reply, then reply actions.
        // An empty reply must never assign these actions to that earlier prompt.
        if (provider === "chatgpt" && (sibling.matches(config.prompts.join(", ")) || sibling.querySelector(config.prompts.join(", ")))) return null;
        if (!ours(sibling) && visible(sibling) && normalize(sibling.textContent)) return sibling;
      }
    }
    return null;
  }

  // Share goes into the bar itself, right after Copy, or before More when the reply has no Copy.
  function placeInBar(bar) {
    const slot = (node) => { while (node.parentElement !== bar) node = node.parentElement; return node; };
    const buttons = [...bar.querySelectorAll("button")].filter((button) => !button.closest("pre"));
    const copy = buttons.find(isCopy);
    if (copy) {
      let next = slot(copy).nextElementSibling;
      while (next && ours(next)) next = next.nextElementSibling;
      return { parent: bar, before: next };
    }
    const more = buttons.find((button) => MORE_ACTION.test(actionLabel(button)));
    return { parent: bar, before: more ? slot(more) : null };
  }

  function replyAnchors(known = responseElements()) {
    if (provider === "gemini") {
      return known.map(response => {
        const actions = response.querySelector("message-actions");
        const bar = actions?.querySelector(".buttons-container-v2, .buttons-container") || actions;
        // Compact layouts may defer the native toolbar. Keep sharing on this turn.
        const place = bar && laidOut(bar) ? placeInBar(bar) : { parent: response, before: null };
        return { ...place, response };
      });
    }
    const bars = actionBars(known);
    const anchors = new Map();
    for (const bar of bars) {
      const response = replyFor(bar, bars, known);
      if (response && !anchors.has(response)) anchors.set(response, placeInBar(bar));
    }
    return [...anchors].map(([response, place]) => ({ ...place, response }));
  }

  function promptAnchors() {
    const prompts = promptElements(), replies = responseElements(), anchors = [];
    for (const response of prompts) {
      if (provider === "gemini") {
        const copy = response.querySelector("[data-test-id='prompt-copy-button']");
        const row = copy?.closest(".luminous-actions-container") || copy?.parentElement;
        if (row && laidOut(row)) {
          const slot = slotFor(copy, row);
          let before = slot.nextElementSibling;
          while (before && ours(before)) before = before.nextElementSibling;
          anchors.push({ parent: row, before, response });
        } else {
          anchors.push({ parent: response, before: null, response });
        }
        continue;
      }
      for (let scope = response, depth = 0; scope && scope !== document.body && depth < 5; scope = scope.parentElement, depth++) {
        if (prompts.some(other => other !== response && scope.contains(other)) || replies.some(reply => scope.contains(reply))) break;
        const copy = [...scope.querySelectorAll("button")].find(button => laidOut(button)
          && (isCopy(button) || /^copy (message|prompt)$/i.test(actionLabel(button))));
        if (!copy) continue;
        // Single-child tooltip wrappers are common in action rows.
        const slot = slotFor(copy, scope);
        anchors.push({ ...placeInBar(slot.parentElement), response });
        break;
      }
    }
    return anchors;
  }

  function messageElements({ raw = rawResponses(), withReplyTools = false } = {}) {
    const replies = responseElements(raw);
    const prompts = promptElements();
    const entries = new Map(replies.map(element => [element, { element, role: "assistant" }]));
    // ChatGPT can put Copy/Rate/Read aloud outside the Markdown container.
    // Reuse the same native reply-to-toolbar association as Share with….
    if (withReplyTools && provider === "chatgpt") {
      for (const { response, parent } of replyAnchors(replies)) {
        if (prompts.some(prompt => prompt.contains(response) || response.contains(prompt))) continue;
        entries.set(response, { element: response, role: "assistant", toolbar: parent });
      }
    }
    return [
      ...prompts.map(element => ({ element, role: "user" })),
      ...entries.values(),
    ].sort((a, b) =>
      a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  function messages() {
    const raw = rawResponses();
    return messageElements({ raw }).map(({element, role}) => role === "user"
      ? { element, role, text: responseText(element) }
      : { element, role, text: replyBody(element, raw), files: globalThis.AISplitReplyFiles?.list(element) || [] }
    ).filter(entry => entry.text || entry.files?.length);
  }

  async function readMessage(element) {
    const entry = messages().find(message => message.element === element);
    if (!entry) throw new Error("This message is no longer on the page. Select it again.");
    if (entry.role === "assistant") return readReply(element);
    const selected = selectedWithin(element);
    return { ok: true, text: checkedText(selected || entry.text), partial: !!selected, prompt: true };
  }

  async function readMessages(elements) {
    if (!Array.isArray(elements) || !elements.length) throw new Error("Select at least one message to share.");
    const wanted = new Set(elements), available = messages();
    const selected = available.filter(entry => wanted.has(entry.element));
    if (selected.length !== wanted.size) throw new Error("Some selected messages are no longer on the page. Select them again.");
    const url = location.href, parts = [], files = [];
    for (const entry of selected) {
      // Checkbox selection always means the whole message, regardless of highlighted text.
      const result = entry.role === "assistant" ? await readReply(entry.element, { whole: true })
        : { text: responseText(entry.element) };
      if (location.href !== url || !selected.every(item => item.element.isConnected)) {
        throw new Error("The conversation changed while reading it. Select the messages again.");
      }
      parts.push(`${entry.role === "user" ? "You" : config.name}:\n${result.text || "[Generated files attached]"}`);
      files.push(...(result.files || []));
    }
    return { ok: true, text: checkedText(parts.join("\n\n---\n\n")), files, partial: false, conversation: true };
  }

  // The composer carries the site's real UI font and colors; some sites leave the page body at browser defaults.
  function styleSource() {
    try { return firstMatch(config.editors) || document.body; } catch { return document.body; }
  }

  function ownsEditor(node) {
    try {
      const editor = firstMatch(config.editors);
      return !!editor && (editor === node || editor.contains(node));
    } catch { return false; }
  }

  function canLeave() {
    assertIdle();
    // Sign-in and landing pages have no composer; they must not trap the pane.
    const editor = firstMatch(config.editors);
    if (editor) {
      if (!blankEditor(editor)) throw new Error(`Send or clear ${config.name}'s draft before switching. The draft has been kept.`);
      if (attachmentCount(editor)) throw new Error(`Send or remove ${config.name}'s attachments before switching. They have been kept.`);
    } else if ([...document.querySelectorAll("textarea, [contenteditable='true']")].some((node) => visible(node) && readEditor(node))) {
      throw new Error(`This page has unsent text that ${config.name}'s adapter does not recognize. Clear it before switching.`);
    }
    const persistent = { chatgpt: /\/c\/[^/]+/, claude: /\/chat\/[^/]+/, gemini: /\/app\/[^/]+/, grok: /\/c\/[^/]+/ }[provider].test(location.pathname);
    const hasReply = config.responses.some((selector) => [...document.querySelectorAll(selector)].some(visible));
    if ((hasReply && !persistent) || new URL(location.href).searchParams.get("temporary-chat") === "true") {
      throw new Error(`${config.name}'s chat has no saved conversation link. Open a saved conversation before switching so you can return to it.`);
    }
    return { ok: true, page: performance.timeOrigin };
  }

  globalThis.AISplitAdapters = Object.freeze({
    provider,
    name: config.name,
    getDraft: () => ({ ok: true, text: readEditor(getEditor()) }),
    readPrompt, canLeave, preflight, stage, validate, commit, keep, cancel, insert, getResponse, replyText,
    readReplyFiles: files => globalThis.AISplitReplyFiles.read(files),
    readReply, messageElements, messages, readMessage, readMessages, promptAnchors,
    compareStatus, readCompareAnswer: compareAnswer, checkCompareAnswer, reviewResult,
    readResponse: async () => { getResponse(); return readReply(latestReply()); },
    composerAnchor, replyAnchors, ownsEditor, styleSource, busy,
  });
})();
