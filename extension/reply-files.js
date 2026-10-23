(() => {
  'use strict';
  if (globalThis.AISplitReplyFiles) return;
  const MAX_FILES = 10;
  const MAX_BYTES = 32 * 1024 * 1024;
  const cleanName = value => String(value || 'generated-file').split(/[\\/]/).at(-1).replace(/[\x00-\x1f]/g, '').trim().slice(0, 255) || 'generated-file';
  const label = node => node.getAttribute('aria-label') || node.textContent.trim();
  const visible = node => !node.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(node).display !== 'none';

  function dialogs() {
    const roots = [document];
    // Claude renders its export dialog in a same-origin artifact shell. Never read
    // the cross-origin user-content frame nested inside that shell.
    for (const frame of document.querySelectorAll('iframe[src]')) {
      try {
        const url = new URL(frame.getAttribute('src'), location.href);
        if (url.origin === location.origin && url.pathname.startsWith('/code/artifact/') && frame.contentDocument) roots.push(frame.contentDocument);
      } catch { /* inaccessible frame */ }
    }
    return roots.flatMap(root => [...root.querySelectorAll('[role="dialog"], dialog')]).filter(visible);
  }

  // Only explicit downloads count. Ordinary citations, even links ending in .pdf, stay text.
  function list(scope) {
    const files = [], seen = new Set();
    const attribute = ['data-chatgpt-selection-message-id', 'data-message-id', 'data-turn-key'].find(name => scope.hasAttribute(name));
    const source = { element: scope, ...(attribute ? { attribute, value: scope.getAttribute(attribute) } : {}) };
    const add = (key, name, element, kind = 'download', matchName) => {
      if (!seen.has(key)) { seen.add(key); files.push({ key, source, name: cleanName(name), element, kind, ...(matchName ? { matchName } : {}) }); }
    };
    for (const link of scope.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      let url;
      try { url = new URL(href, location.href); } catch { continue; }
      if (visible(link) && (link.hasAttribute('download') || /^(sandbox:|blob:)/.test(href)
        || (url.origin === location.origin && /^\/api\/.*\/download-file$/.test(url.pathname)))) {
        let path;
        try { path = decodeURIComponent(new URL(href, location.href).pathname); } catch { path = href; }
        const name = link.getAttribute('download') || (path.includes('.') ? path.split('/').at(-1) : link.textContent);
        add(href, name, link);
      }
    }
    // Claude's ordinary outputs (CSV, notebooks, archives, images, Office files,
    // source code, and others) have native file cards, independently of Docs.
    for (const card of scope.querySelectorAll('[data-testid="file-card-block"]')) {
      const view = card.querySelector('button[data-testid="file-card-open"]');
      if (!view || !visible(card)) continue;
      const title = label(view).replace(/^View /, '');
      const download = [...card.querySelectorAll('button')].find(node => /^Download(?:\s|$)/i.test(label(node)));
      // The visible format label is just a filename hint. The actual download's
      // name and MIME type take precedence, with no restriction to these formats.
      const extension = [...card.querySelectorAll('*')].filter(node => !node.closest('button'))
        .map(node => node.textContent.trim()).map(text => text.match(/(?:^|[·•])\s*([A-Z][A-Z0-9]{0,11})$/)?.[1])
        .find(text => text && text !== title);
      const name = /\.[a-z0-9]{1,12}$/i.test(title) || !extension ? title : `${title}.${extension.toLowerCase()}`;
      add(`file:${title}:${extension || card.getAttribute('data-sheet-kind')}`, name, download || view, download ? 'download' : 'unavailable', title);
    }
    // Current ChatGPT resource cards put the file beside the markdown, with no href.
    for (const preview of scope.querySelectorAll('button[aria-label^="Open preview of "]')) {
      if (!visible(preview)) continue;
      const name = label(preview).slice('Open preview of '.length);
      const row = preview.parentElement;
      const download = row.querySelector('button[aria-label="Download file"]');
      // Inline references to an uploaded file also say "Open preview of ...".
      // They are citations, not generated output cards.
      if (!download && !row.classList.contains('group/resource-row')) continue;
      add(`card:${name}`, name, download || preview, download ? 'download' : 'unavailable');
    }
    // Claude Docs exports are reached through the card's own Share/export dialog.
    // Use only cards with that control; source-document citations are not generated outputs.
    for (const card of scope.querySelectorAll('[data-sheet-kind="doc"]')) {
      const share = card.querySelector('button[data-testid="frame-card-share"]');
      const view = card.querySelector('button[data-testid="frame-card-open"]');
      if (share && view && visible(card)) {
        const title = label(view).replace(/^View /, '');
        add(`doc:${title}`, `${title}.docx`, share, 'claude-doc');
      }
    }
    return files;
  }

  async function waitFor(find) {
    const end = Date.now() + 8000;
    do {
      const found = find();
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < end);
    throw new Error('The document export controls did not open.');
  }

  async function expand(scope) {
    for (const control of scope.querySelectorAll('button[aria-controls][aria-expanded="false"]')) {
      const count = label(control).match(/^(\d+) more$/i);
      const card = control.parentElement;
      const selector = 'button[aria-label^="Open preview of "]';
      const previews = () => [...card.querySelectorAll(selector)].filter(visible).length;
      if (!count || !previews()) continue;
      const expected = previews() + Number(count[1]);
      control.click();
      await waitFor(() => control.getAttribute('aria-expanded') === 'true' && previews() >= expected);
    }
  }

  async function currentFile(file) {
    const { source } = file;
    if (!source) {
      if (!file.element.isConnected) throw new Error('The reply changed. Open Share again.');
      return file;
    }
    const scope = source.attribute ? [...document.querySelectorAll(`[${source.attribute}]`)]
      .find(node => node.getAttribute(source.attribute) === source.value) : source.element;
    if (!scope?.isConnected) throw new Error('The reply changed. Open Share again.');
    await expand(scope);
    const current = list(scope).find(item => item.key === file.key);
    if (!current) throw new Error('The file is no longer in this reply. Open Share again.');
    return current;
  }

  function capture(element, name, matchName) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const attr = 'data-asb-file-capture';
      const finish = (error, file) => {
        clearTimeout(timer);
        document.removeEventListener('asb-file-result', receive);
        element.removeAttribute(attr);
        error ? reject(new Error(error)) : resolve(file);
      };
      const receive = event => {
        let result;
        try { result = JSON.parse(event.detail); } catch { return; }
        if (result.id !== id) return;
        finish(result.error, result.file);
      };
      const timer = setTimeout(() => finish('The file download could not be read. Refresh this AI tab after updating the extension.'), 35_000);
      document.addEventListener('asb-file-result', receive);
      element.setAttribute(attr, id);
      document.dispatchEvent(new CustomEvent('asb-file-request', { detail: JSON.stringify({ id, name, matchName }) }));
    });
  }

  async function read(files) {
    if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error('Share up to 10 generated files at a time. Nothing was sent.');
    const pageKey = () => {
      const url = new URL(location.href);
      url.hash = '';
      if (url.hostname === 'claude.ai') url.searchParams.delete('artifact');
      return url.href;
    };
    const page = pageKey();
    const copies = [];
    let total = 0;
    for (const file of files) {
      let dialog;
      try {
        if (pageKey() !== page) throw new Error('The reply changed. Open Share again.');
        const current = await currentFile(file);
        if (current.kind === 'unavailable') throw new Error('The file card has no download control.');
        let download = current.element;
        if (current.kind === 'claude-doc') {
          if (dialogs().length) throw new Error('Close the open dialog before sharing a document.');
          current.element.click();
          const title = label(current.element).replace(/^Share /, '');
          dialog = await waitFor(() => dialogs().find(node => node.getAttribute('aria-label') === title
            || node.querySelector('h1, h2, [role="heading"]')?.textContent.trim() === title));
          const exportTab = [...dialog.querySelectorAll('[role="radio"], button')].find(node => label(node) === 'Export');
          if (!exportTab) throw new Error('Could not find the document Export tab.');
          exportTab.click();
          download = await waitFor(() => [...dialog.querySelectorAll('button')].find(node => /^Word\b/.test(label(node)) && /\.docx/.test(label(node))));
        }
        const copy = await capture(download, file.name, file.matchName);
        if (pageKey() !== page) throw new Error('The reply changed while its file was being read.');
        await currentFile(file);
        if (!copy || typeof copy.data !== 'string') throw new Error('The file contents were unavailable.');
        total += copy.data.length / 4 * 3 - (copy.data.endsWith('==') ? 2 : copy.data.endsWith('=') ? 1 : 0);
        if (total > MAX_BYTES) throw new Error('Generated files exceed the 32 MB total limit.');
        copies.push(copy);
      } catch (error) {
        throw new Error(`Nothing was sent. ${file.name}: ${error.message} Download and attach this file manually, or uncheck generated files to share text only.`);
      } finally {
        // Close only the export dialog opened by this action.
        [...(dialog?.querySelectorAll('button') || [])].find(node => label(node) === 'Close')?.click();
      }
    }
    return copies;
  }

  globalThis.AISplitReplyFiles = Object.freeze({ list, read, expand });
})();
