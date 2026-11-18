(() => {
  'use strict';
  if (globalThis.AISplitReadingWidth) return;

  // Start at the site's message text, so a width utility reused by the composer,
  // an artifact, or the sidebar keeps its native behavior.
  const messages = {
    chatgpt: '[data-message-author-role], [data-message-role], [data-content-search-unit-key$=":user"], [data-markdown-text-style="assistant-message"], [data-assistant-markdown-root], [data-message-author-role] .markdown, .user-message-bubble-color',
    claude: '[data-testid="user-message"], [data-testid="assistant-message"], [data-cds="UserMessage"], [data-cds="AssistantMessage"], .font-claude-response',
    gemini: 'model-response, user-query, model-response message-content, model-response .model-response-text, user-query .query-text, [data-testid="user-prompt-content"], [data-testid="user-prompt-bubble"], [data-testid="collapsible-response-content"], [id^="model-response-content-"], [data-testid="latest-turn-exchange"]',
    grok: '[data-testid="user-message"], [data-testid="assistant-message"], [data-message-author-role], [data-message-role], .message-bubble, .response-content-markdown',
  };
  // A turn can already span the pane while the rendered answer inside it is still limited to a short line length.
  const prose = {
    claude: '[data-cds="Prose"], .standard-markdown, .progressive-markdown, .prose, .font-claude-response',
    gemini: '.markdown-main-panel, message-content, .model-response-text, .query-text',
    grok: '.response-content-markdown, .prose, .markdown',
  };
  const outside = 'aside, nav, header, dialog, [role="dialog"], [role="complementary"], [role="navigation"], [data-testid="chat-side-pane"], form, [contenteditable="true"], textarea, [data-ai-split-bridge]';
  const sidePanel = 'aside, [role="complementary"], [data-testid="chat-side-pane"], nav, [role="navigation"]';
  const marker = 'data-asb-reading-width';
  const gutter = '--asb-reading-gutter';
  const composerMeasure = '--asb-claude-composer-measure';
  const insetLeft = '--asb-claude-inset-left', insetRight = '--asb-claude-inset-right';
  const style = document.createElement('style');
  style.textContent = `
    [${marker}] { max-width:100% !important; max-inline-size:100% !important; min-inline-size:0 !important; }
    [${marker}="column"], [${marker}="claude-column"] { inline-size:100% !important; box-sizing:border-box !important; }
    [${marker}="claude-column"] {
      --transcript-width:100% !important;
      inline-size:calc(100% - var(${insetLeft}, 0px) - var(${insetRight}, 0px)) !important;
      margin-left:var(${insetLeft}, auto) !important; margin-right:var(${insetRight}, auto) !important;
    }
    [${marker}="claude-column"] [data-chat-input-container] {
      --transcript-width:var(${composerMeasure}, 48rem) !important;
      inline-size:min(100%, var(--transcript-width, 48rem)) !important; box-sizing:border-box !important;
    }
    [${marker}="outset"] {
      inline-size:calc(100% + var(${gutter}) + var(${gutter})) !important;
      max-width:none !important; max-inline-size:none !important;
      margin-inline:calc(0px - var(${gutter})) !important; box-sizing:border-box !important;
    }`;
  let enabled = false;
  let marked = new Set();
  const awaitingLayout = new WeakSet();
  let frame = 0;
  let observer;
  let watched = new Set();

  // Return free space on both sides of a centered column. Visible neighboring
  // panes, such as a docked artifact or a sidebar, take priority over this space.
  function centeredRoom(node, allowSidePanes = true) {
    const parent = node.parentElement;
    if (!parent) return 0;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const outer = parent.getBoundingClientRect();
    const css = getComputedStyle(parent);
    let start = outer.left + (parseFloat(css.paddingLeft) || 0);
    let end = outer.right - (parseFloat(css.paddingRight) || 0);
    if (box.left - start < 20 || end - box.right < 20) return 0;
    for (const sibling of parent.children) {
      if (sibling === node) continue;
      const other = sibling.getBoundingClientRect();
      if (!other.width || !other.height || other.bottom <= box.top || other.top >= box.bottom) continue;
      if (!allowSidePanes) return 0;
      if (other.right <= box.left) start = Math.max(start, other.right);
      else if (other.left >= box.right) end = Math.min(end, other.left);
      else return 0;
    }
    const left = box.left - start, right = end - box.right;
    return Math.abs(left - right) <= 6 ? Math.max(0, Math.floor(Math.min(left, right))) : 0;
  }

  function clear(node) {
    node.removeAttribute(marker);
    for (const property of [gutter, composerMeasure, insetLeft, insetRight]) {
      if (node.style.getPropertyValue(property)) node.style.removeProperty(property);
    }
  }

  // Native pane gutters may already reserve the sidebar. Only subtract the
  // part of a positioned panel that actually covers the available content box.
  function claudeInsets(column, overlays) {
    const host = column.parentElement;
    const rect = host.getBoundingClientRect(), row = column.getBoundingClientRect();
    const css = getComputedStyle(host);
    const left = rect.left + (parseFloat(css.borderLeftWidth) || 0) + (parseFloat(css.paddingLeft) || 0);
    const right = rect.right - (parseFloat(css.borderRightWidth) || 0) - (parseFloat(css.paddingRight) || 0);
    let start = left, end = right;
    for (const box of overlays) {
      if (row.bottom <= box.top || row.top >= box.bottom || box.right <= start || box.left >= end) continue;
      // Retain the larger contiguous reading area beside an overlapping edge panel.
      if (box.left - start > end - box.right) end = box.left;
      else start = box.right;
    }
    if (end <= start && right > left) return null;
    return [Math.ceil(start - left), Math.ceil(right - end)];
  }

  function schedule() {
    if (enabled && !frame) frame = requestAnimationFrame(() => { frame = 0; refresh(true); });
  }

  function refresh(resized = false) {
    const provider = globalThis.AISplitAdapters?.provider;
    const selector = messages[provider];
    if (!enabled || !selector) return;
    if (!style.isConnected) (document.head || document.documentElement).append(style);
    const blocked = new Set(), overlays = [];
    const watch = new Set([document.documentElement]);
    // Ignore the extension's controls here: those intentionally live in turns.
    for (const control of document.querySelectorAll(outside)) {
      if (control.closest('[data-ai-split-bridge]') || control.closest(selector)) continue;
      for (let node = control; node && !blocked.has(node); node = node.parentElement) blocked.add(node);
      if (control.matches(sidePanel) && !control.closest('[hidden], [inert], [aria-hidden="true"]')) {
        const box = control.getBoundingClientRect();
        if (!box.width || !box.height || getComputedStyle(control).visibility === 'hidden' ||
          control.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) continue;
        if (control.matches('nav, [role="navigation"]') && box.width > innerWidth * .7) continue;
        for (let node = control; node && node !== document.body; node = node.parentElement) {
          if (['absolute', 'fixed'].includes(getComputedStyle(node).position)) {
            overlays.push(box);
            watch.add(control);
            break;
          }
        }
      }
    }

    const next = new Set();
    const boundaries = new Map();
    const columns = new Set();
    const bodies = prose[provider] ? `:is(${selector}) :is(${prose[provider]})` : '';
    const seeds = document.querySelectorAll(bodies ? `${selector}, ${bodies}` : selector);
    for (const message of seeds) {
      if (message.closest(outside + ', pre, code, table, [data-testid="file-card-block"]')) continue;
      for (let node = message; node && node !== document.body && !blocked.has(node); node = node.parentElement) {
        if (next.has(node)) break;
        next.add(node);
        if (blocked.has(node.parentElement)) boundaries.set(node, node.parentElement);
        // A fixed-width, centered track may have no max-width rule to relax.
        if (node.getAttribute(marker) === 'column') columns.add(node);
        else if (resized || !node.hasAttribute(marker) || awaitingLayout.has(node)) {
          const room = centeredRoom(node, false);
          // Folded turns and lazy-rendered history are first measurable on reveal.
          if (room === null) awaitingLayout.add(node);
          else {
            awaitingLayout.delete(node);
            if (room > 0) columns.add(node);
          }
        }
      }
    }

    // Claude can wrap its history and sticky input together inside a clipped
    // container. Widen the actual path to the transcript, within the chat pane;
    // a negative margin inside the clipped wrapper cannot escape its width cap.
    const claudeColumns = new Set();
    const claudeLane = '[data-claude-chat-column], [data-testid="chat-column"]';
    if (provider === 'claude') {
      for (const transcript of document.querySelectorAll('[data-testid="transcript-list"]')) {
        const column = transcript.closest(claudeLane);
        if (!column || transcript.closest(outside)) continue;
        claudeColumns.add(column);
        watch.add(column.parentElement);
        next.add(column);
        for (let node = transcript; node !== column; node = node.parentElement) {
          next.add(node);
          columns.add(node);
        }
      }
    }

    // Some layouts center the composer and history in one narrow wrapper. Reach
    // into its unused margins from the history branch only, keeping 16px gutters.
    const outsets = new Map(), measured = new Map();
    for (const [branch, shared] of boundaries) {
      if (claudeColumns.size && claudeColumns.has(branch.closest(claudeLane))) continue;
      if (!measured.has(shared)) {
        let room = 0;
        for (let node = shared; node && node !== document.body; node = node.parentElement) {
          watch.add(node);
          watch.add(node.parentElement);
          if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(node).overflowX)) break;
          room = centeredRoom(node) || 0;
          if (room) break;
        }
        measured.set(shared, Math.max(0, room - 16));
      }
      if (measured.get(shared)) outsets.set(branch, measured.get(shared));
    }

    // A positioned sidebar does not reduce its parent's width. Keep the site's
    // native limit wherever filling that parent would put text under the panel.
    const insets = new Map();
    if (overlays.length) {
      for (const column of claudeColumns) insets.set(column, claudeInsets(column, overlays));
      for (const node of next) {
        const lane = claudeColumns.size && node.closest(claudeLane);
        if (insets.has(lane)) {
          if (!insets.get(lane)) next.delete(node);
          continue;
        }
        const row = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect();
        const extra = outsets.get(node) || 0;
        if (overlays.some(box => row.bottom > box.top && row.top < box.bottom
          && parent.right + extra > box.left && parent.left - extra < box.right)) next.delete(node);
      }
    }
    for (const node of marked) if (!next.has(node)) clear(node);
    for (const node of next) {
      const size = outsets.get(node);
      const kind = size ? 'outset' : claudeColumns.has(node) ? 'claude-column' : columns.has(node) ? 'column' : 'cap';
      // Drive Claude's own width calculations (including grid and inline
      // max-width rules), while preserving its configured input measure.
      if (kind === 'claude-column' && !node.style.getPropertyValue(composerMeasure)) {
        const nativeWidth = getComputedStyle(node).getPropertyValue('--transcript-width').trim();
        node.style.setProperty(composerMeasure, nativeWidth || '48rem');
      } else if (kind !== 'claude-column' && node.style.getPropertyValue(composerMeasure)) {
        for (const property of [composerMeasure, insetLeft, insetRight]) node.style.removeProperty(property);
      }
      if (kind === 'claude-column') {
        const [left, right] = insets.get(node) || [0, 0];
        for (const [property, pixels] of [[insetLeft, left], [insetRight, right]]) {
          const value = left || right ? `${pixels}px` : '';
          if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
        }
      }
      if (node.getAttribute(marker) !== kind) node.setAttribute(marker, kind);
      if (size) {
        const value = `${size}px`;
        if (node.style.getPropertyValue(gutter) !== value) node.style.setProperty(gutter, value);
      } else if (node.style.getPropertyValue(gutter)) node.style.removeProperty(gutter);
    }
    marked = next;
    if (observer) {
      for (const node of watched) if (!watch.has(node)) observer.unobserve(node);
      for (const node of watch) if (!watched.has(node)) observer.observe(node);
      watched = watch;
    }
  }

  function setEnabled(value) {
    value = Boolean(value);
    if (enabled === value) return;
    enabled = value;
    if (enabled) {
      if (typeof ResizeObserver === 'function') {
        const widths = new WeakMap();
        observer = new ResizeObserver(entries => {
          for (const entry of entries) {
            if (widths.get(entry.target) !== entry.contentRect.width) schedule();
            widths.set(entry.target, entry.contentRect.width);
          }
        });
      }
      refresh();
      addEventListener('resize', schedule);
    } else {
      observer?.disconnect();
      observer = null;
      watched.clear();
      removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
      frame = 0;
      style.remove();
      for (const node of marked) clear(node);
      marked.clear();
    }
  }

  globalThis.AISplitReadingWidth = Object.freeze({ setEnabled, refresh });
})();
