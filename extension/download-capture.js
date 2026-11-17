// Runs in the page's MAIN world. It has no extension APIs or access to tab messages.
// A marked native download control is clicked only for an explicit file-share request.
(() => {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  let active = false;
  document.addEventListener('asb-file-request', event => {
    let request;
    try { request = JSON.parse(event.detail); } catch { return; }
    const { id, name, matchName } = request || {};
    if (active || typeof id !== 'string' || !/^[\w-]{1,160}$/.test(id) || typeof name !== 'string' || name.length > 255) return;
    if (matchName !== undefined && (typeof matchName !== 'string' || matchName.length > 255)) return;
    const roots = [document];
    for (const frame of document.querySelectorAll('iframe[src]')) {
      try {
        const url = new URL(frame.getAttribute('src'), location.href);
        if (url.origin === location.origin && url.pathname.startsWith('/code/artifact/') && frame.contentDocument) roots.push(frame.contentDocument);
      } catch { /* inaccessible frame */ }
    }
    const control = roots.map(root => root.querySelector(`[data-asb-file-capture="${id}"]`)).find(Boolean);
    // Claude's artifact export menu uses custom menuitems; compact controls may
    // likewise be spans with button semantics. Only the explicitly marked
    // interactive element may start a download, never its surrounding card.
    if (!control || !control.matches('a[href], button, [role="button"], [role="menuitem"]')
      || typeof control.click !== 'function') return;
    active = true;
    const realms = [...new Set([window, control.ownerDocument.defaultView])].map(view => ({
      view, click: view.HTMLAnchorElement.prototype.click, createURL: view.URL.createObjectURL,
    }));
    const blobs = new Map();
    const controller = new AbortController();
    let claimed = false, claimedURL, done = false;

    const restore = () => {
      for (const realm of realms) {
        if (realm.view.HTMLAnchorElement.prototype.click === realm.interceptedClick) realm.view.HTMLAnchorElement.prototype.click = realm.click;
        if (realm.view.URL.createObjectURL === realm.trackedURL) realm.view.URL.createObjectURL = realm.createURL;
        realm.view.document.removeEventListener('click', interceptEvent, true);
      }
    };
    const finish = (error, file) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      restore();
      controller.abort();
      blobs.clear();
      active = false;
      document.dispatchEvent(new CustomEvent('asb-file-result', { detail: JSON.stringify({ id, ...(error ? { error } : { file }) }) }));
    };
    const timer = setTimeout(() => finish('The site did not provide a readable download in time.'), 30_000);

    const cleanName = value => value.split(/[\\/]/).at(-1).replace(/[\x00-\x1f]/g, '').trim().slice(0, 255);
    const contentName = header => {
      const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      if (encoded) { try { return decodeURIComponent(encoded); } catch { /* try plain filename */ } }
      return header?.match(/filename\s*=\s*"([^"]+)"/i)?.[1] || header?.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim();
    };
    // Browsers sometimes supply a generic MIME type for a correctly named file.
    // Keep unknown formats intact; this map only helps the destination's picker.
    const mimeFor = filename => ({
      pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
      json: 'application/json', jsonl: 'application/x-ndjson', ipynb: 'application/x-ipynb+json',
      zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', html: 'text/html',
      py: 'text/x-python', js: 'text/javascript', css: 'text/css', xml: 'application/xml',
      mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4',
    })[filename.split('.').at(-1).toLowerCase()] || 'application/octet-stream';

    async function read(url, downloadName) {
      try {
        let bytes, type, filename = downloadName;
        const blob = blobs.get(url);
        // Start before returning to the site: it may revoke its blob URL immediately.
        if (blob) {
          if (blob.size > MAX_BYTES) throw new Error('The file exceeds 20 MB.');
          type = blob.type;
          bytes = new Uint8Array(await blob.arrayBuffer());
        } else {
          const response = await fetch(url, { credentials: new URL(url, location.href).origin === location.origin ? 'same-origin' : 'omit', signal: controller.signal });
          if (!response.ok) throw new Error('The download expired or was refused.');
          if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('The file exceeds 20 MB.');
          type = response.headers.get('content-type')?.split(';')[0] || '';
          filename ||= contentName(response.headers.get('content-disposition'));
          const reader = response.body.getReader(), chunks = [];
          let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_BYTES) { await reader.cancel(); throw new Error('The file exceeds 20 MB.'); }
            chunks.push(value);
          }
          bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        }
        filename = cleanName(filename || name) || name;
        // A notebook, GeoJSON, or another generated format may legitimately be
        // served as JSON. Only reject HTML disguised as a non-HTML download.
        if (type === 'text/html' && !/\.html?$/i.test(filename)) throw new Error('The site returned a page instead of the file.');
        if (!type || type === 'application/octet-stream') type = mimeFor(filename);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        finish(null, { name: filename, type, data: btoa(binary), lastModified: Date.now() });
      } catch (error) { finish(error.message || 'The download could not be read.'); }
    }

    function intercept(anchor) {
      if (claimed || !realms.some(realm => anchor instanceof realm.view.HTMLAnchorElement)) return false;
      const url = anchor.href;
      if (!/^(https?:|blob:|data:)/.test(url)) return false;
      const stem = value => value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
      const filename = anchor.getAttribute('download');
      // Ignore unrelated links and downloads while the provider prepares this file.
      const matches = filename && (stem(filename) === stem(name)
        || (matchName && stem(filename.replace(/\.[^.]+$/, '')) === stem(matchName.replace(/\.[^.]+$/, ''))));
      if (anchor !== control && (filename ? !matches : !blobs.has(url))) return false;
      claimed = true;
      claimedURL = url;
      // Keep the wrappers until completion to suppress duplicate site download clicks.
      void read(url, filename);
      return true;
    }
    function interceptEvent(event) {
      const anchor = event.target.closest?.('a[href]');
      if ((claimed && anchor?.href === claimedURL) || intercept(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
    try {
      for (const realm of realms) {
        realm.interceptedClick = function () {
          if (claimed && this.href === claimedURL) return;
          if (!intercept(this)) return realm.click.call(this);
        };
        realm.trackedURL = function (blob) {
          const url = realm.createURL.call(realm.view.URL, blob);
          if (blob instanceof realm.view.Blob) blobs.set(url, blob);
          return url;
        };
        realm.view.HTMLAnchorElement.prototype.click = realm.interceptedClick;
        realm.view.URL.createObjectURL = realm.trackedURL;
        realm.view.document.addEventListener('click', interceptEvent, true);
      }
      control.click();
    } catch (error) { finish(error.message); }
  });
})();
