<img src="extension/icons/tile-128.png" width="96" height="96" alt="AI Split Bridge icon">

# AI Split Bridge

A small Chrome extension for using ChatGPT, Claude, Gemini, and Grok together **in Chrome’s native Split View**. Conversations stay on their own websites. No dashboard, embedded chats, AI API keys, or server.

Use each site’s normal Send button or Enter to message that assistant. The extension adds sharing and comparison controls inside the same chat.

![ChatGPT and Gemini side by side in Chrome Split View. Send both sits beside each composer, and Share with… sits in each reply toolbar.](figs/screnshot.png)

## What it does

- **Send both**: a pill beside each site’s Send button. Type in the site’s usual composer and click **Send both** to send the same prompt here and to the chat on the other side of the split. Shortcut: **⌘⇧↩** (Ctrl+Shift+Enter on Windows/Linux) in the composer.
  - **Links and chips** go along as text: a pasted link keeps its full address, and chips such as ChatGPT’s “Create image” are sent as their label.
  - **Attachments** are copied too. Attach files the usual way (pick, paste, or drop) and each other chat gets its own copy, uploaded before anything is sent. A prompt can even be files only.
  - **Long pasted text**: ChatGPT’s collapsed “Show in text field” card is expanded before the prompt is read, so the complete text goes to the other chats.
- **Send to more chats**: the arrow next to **Send both** lists every AI chat open in this window, including tabs outside the split (for example Gemini or Grok in another tab). Tick the ones you want and the pill becomes **Send all** or **Send to N**. Sleeping tabs are greyed out until you open them once.
- **Show a chat on the other side**: in the same list, the small split icon next to a hidden chat shows it on the other side of the split, in place of the current one. Assistants that aren’t open yet are listed too, and open their earlier conversation if there was one.
- **Share with…**: a button beside Copy in a reply’s or your own message’s toolbar (or before ⋯ More when a reply has no Copy). Choose a chat to share that message. Replies use your editable share message, which by default asks for a critical review, independent judgement, and useful ideas to improve the receiving assistant’s previous response. Your own prompts are labelled as your prompt and ask the other assistant to respond. If the chat isn’t visible, it is shown on the other side first. Highlight part of a message first to share only that text. Finished replies can be shared even while their chat writes a newer one; only the chat you send *to* must be idle.
  - **Generated files**: when a reply contains recognized download cards, the share menu lists them with an **Include generated files** checkbox, checked by default. Multiple Markdown files are included separately, including Claude’s compact file rows. For Markdown artifacts without an inline download, the extension uses the file viewer’s **Download as MD** action. Uncheck the checkbox to share text only. The site’s download/export controls supply the files; an unreadable file stops the share instead of silently omitting it. Each destination must accept the file types you include.
  - On Gemini, look for **Share with…** under your prompt or the reply, including in the Chinese interface. You can also open the composer’s arrow menu and choose **Share this chat’s latest reply…**.
- **Compare** brings together the latest completed answer from each side of a native split. Click **Compare** beside the latest reply, or **Compare latest answers…** in the composer menu. Choose either assistant to identify agreements, disagreements, omissions and claims worth verifying. The default instructions ask what evidence would settle each important claim and explain that agreement alone cannot establish correctness. Edit them under **Sharing → Message for → Compare** in the extension popup. The chosen chat receives the two answer texts, labelled by assistant and pane. Turn off **Send right away** to edit the comparison as a draft first.
- **Cross-review** lets both assistants review each other. When both panes have a completed answer, click **Cross-review** beside the latest reply to start a critique in one click. Its arrow lets you choose **Critique**, **Find errors**, or **Suggest improvements**. The same choices are available from the composer menu. Each assistant receives the text of the other pane’s original answer. Read the two critiques side by side in the same chats.
  - Set a shared role, language or review standard in **Sharing → Message for → Cross-review → All review modes**. For example, ask both assistants to write in Chinese and distinguish evidence from assumptions. You can also edit **Critique**, **Find errors** and **Suggest improvements** separately. Each chat receives the shared guidance, the selected mode’s instructions and the other assistant’s labelled answer in one chat message.
  - With **Send right away** off, each pane gets a review draft. You can edit the instructions before sending each draft. Keep the quoted answer and its label so the extension can match the critique to this round.
  - Once both critiques are complete, click **Cross-review** again. Under **Revise an answer**, pick the assistant whose original answer you want to improve. It receives that answer and the other assistant’s critique. Choose the revision while both critiques are the latest turns in the same two open pages. Reloading a page clears its review record.
- **Select messages…**: in the composer’s arrow menu, choose several prompts and replies, then a destination chat. Messages keep their conversation order and speaker labels (**You:**, **Claude:**, etc.), regardless of selection order. By default they ask the other assistant to continue from that context; you can edit this instruction in the popup. Only messages currently loaded on the page are listed.
- **Reading**: open the extension popup and turn on **Wider messages** to use more of each chat pane. Enable **Message tools** to collapse individual prompts or replies and bookmark them. Click **Show prompt** or **Show reply** to expand one. Click a message under **Bookmarks in this chat** in the popup to jump back and expand it. Saved chats remember these choices on this device. If a long conversation unloads a bookmarked turn, the extension can use its last position to find it again during that visit. After a reload, the site must first load the message to show its preview.
- **Popup**: a small settings sheet in the style of ChatGPT’s settings. It opens an assistant, creates a native split when this Chrome allows extensions to do so, and holds the share settings:
  - **Send right away** (on by default): turn it off to add shared messages as a draft you review and send yourself.
  - **Message for**: choose **Replies**, **My prompts**, **Selected messages**, or **Compare**, then edit the accompanying message. For example, replace “Please continue from this context” with “Check these messages for missing requirements.” Each type saves separately. **{assistant}** inserts the source assistant’s name. **{reply}** or **{content}** inserts the shared message. In **Compare**, **{answers}** inserts both answers with their assistant and pane labels. Without a text placeholder, the shared text is added at the end. **Reset** restores only the selected type’s default. Settings save as you type and sync with your Chrome profile.

The controls are styled to fit each site: ChatGPT’s soft pill buttons and rounded menus, Claude’s warm colours and squarer corners, Gemini’s tonal buttons and blue accent, and Grok’s round buttons. They also copy the size, corner shape, and icon colour of the buttons beside them, follow the site’s light or dark theme, and show collaboration controls when another AI chat is available. Reading tools also work in a single chat.

## Install locally

1. Open `chrome://extensions` in desktop Chrome.
2. Enable **Developer mode**, click **Load unpacked**, and select the [`extension`](extension) folder in this repository. Select that folder, not the repository root.
3. Open and sign in to the assistants you use. **Refresh AI tabs that were already open before installation.**
4. Put two chats side by side: right-click a chat tab and choose Chrome’s Split View option (or use the popup, if it offers **Create split**).
5. Type in either chat and use **Send both**, or use **Share with…** in a reply’s toolbar.

No build step or Node installation is needed to load the extension. After source edits or an update, click its **Reload** button on `chrome://extensions` and refresh the AI tabs.

## Chrome support and feasibility

Chrome reports which tabs share a split through `Tab.splitViewId` (Chrome 140+). That is all the extension needs to tell left from right. The management APIs (`tabs.createSplit`, `tabs.unsplit`) are documented for Chrome 155+, but they are also gated by Chromium’s `ApiTabsSplitView` feature flag, so a version number alone is not enough. The extension checks at runtime. [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) · [Chromium feature definitions](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/api/_api_features.json)

- **With the management APIs**, “show on the other side” swaps live tabs: the outgoing tab stays open with its draft. Swapping uses unsplit → arrange → split and may reset a dragged divider. Native split creation needs adjacent tabs in the same window with matching group and pinned state; resolve conflicting groups or pinned states yourself. [Split View for extensions](https://developer.chrome.com/blog/split-view-api-extensions)
- **Without them** (most Chrome builds today), the pane is navigated to the chosen chat instead. The outgoing conversation’s URL is remembered for this window, so it can be shown again later. To avoid losing work, the pane refuses to change while it has a draft, an attachment, a reply in progress, or an unsaved (temporary) conversation. Sign-in and landing pages never block it.

Site interaction uses content scripts and extension messages. Each website controls its own conversation and model settings. Only the prompts and replies you choose are transferred; model memory is not synchronized. [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) · [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)

## Prototype boundaries

- **Text up to 60,000 characters, plus up to 10 attachments** (20 MB each, 32 MB in total). Voice, tool modes, project context, and system instructions are not copied; a tool chip arrives as its label.
- **Attachments are copied only if the page saw them being added.** Files attached before the extension loaded (or before the tab was refreshed after installing), or picked from a site’s cloud library, can’t be read. Oversized files cannot be copied either. If any file is unavailable, nothing is sent: remove and reattach it after refreshing, or use a smaller file. Each destination must accept the files and show their tiles before sending. Recognized failed uploads block submission. Cancellation removes the extension’s copies when possible; if the page changed or you edited its attachments, the notice asks you to check the remaining copies.
- **Website adapters can break.** The sites have no stable interface for extensions. Layout changes, alternate account UIs, and non-English labels can require selector updates. **Share with…** uses recognized message toolbars; code-block Copy buttons do not get a separate share control. If no Send, mic or trailing composer button can be found, the pill floats at the bottom right of the page instead. If no reply toolbar is found, the arrow menu offers **Share this chat’s latest reply**. Unrecognized controls show an error instead of using synthetic Enter presses.
- **Every chosen chat must be ready.** Each must be signed in, have finished replying, and have an empty composer with no attachments of its own. Existing drafts are never replaced. If any chat isn’t ready, nothing is sent and staged text is removed. Sharing with **Send right away** on uses the same checks for the one chat it sends to.
- **Sending is not atomic.** Each website receives a separate click. A network error, navigation, or site rejection can leave only some chats submitted. The notice reports which chats were clicked, not whether the server accepted them. Check the chats before retrying; there are no automatic retries.
- **Sharing uses loaded, rendered messages and recognized generated downloads.** It does not retrieve unloaded conversation history or the original attachments from your past prompts. Formatting, equations, citations, and virtualized content may not transfer fully; tables become `a | b` rows, and links become `label (address)`. Highlighted excerpts share text only. Generated files use the same size limits as composer attachments and must be accepted by the destination. Turn off **Send right away** if you want to review each share before it is sent.
- **The same conversation is never sent to twice.** Two tabs on the same conversation count as one chat.
- **Memory lasts for the browser session** and is cleared when the window closes.
- Supported sites: `chatgpt.com`, legacy `chat.openai.com`, `claude.ai`, `gemini.google.com`, and `grok.com`. Grok embedded in X is not included.

## Privacy and permissions

Access is limited to those five AI hosts plus the `storage` permission. No clipboard, debugging, all-site, or broad browsing permission is requested. Messages and files are transferred only when you use a bridge control. Composer files are held by reference in memory and read when you send; generated files are read through the source site’s download/export controls when you share with files included. The extension may fetch the download supplied by the site. Text and file copies pass locally between content scripts and the service worker. Files reach the destination provider during upload, including when sharing as a draft; text is submitted through its normal chat controls. The extension adds no analytics or stored transcripts and sends nothing to the developer. Sync storage holds the delivery mode and your sharing, comparison and cross-review instructions. Session storage holds recently used tab IDs and, in navigation mode, conversation URLs per window; these are removed when the window closes, and session storage clears on browser exit. Local storage holds reading preferences, conversation identifiers, and the identifiers of messages you fold or bookmark. See the full [privacy policy](PRIVACY.md).

## Development and verification

With Node 22+ installed:

```sh
npm ci
npm test
npm run check
npm run preview   # local fixture at http://127.0.0.1:4173
```

The extension has no runtime dependencies. `jsdom` is a development dependency for DOM fixture tests.

Tests cover several areas using simulated Chrome APIs and DOM fixtures:

- sides and hidden chats
- tab swapping and navigation memory
- the send and share phases and their failure paths
- share settings and how your share message is filled in
- draft protection
- where controls attach on each site
- the injected controls themselves

The local fixture runs the real adapter and controls in Chrome with ChatGPT-, Claude-, Gemini- and Grok-like markup, including two PDF copies, long prompts, byte-for-byte file checks, and rollback. Live inspection confirmed Gemini’s nested PDF tiles, Claude’s completed/failed upload tiles, and ChatGPT’s collapsed pasted-text cards. A live synthetic PDF send from Claude to Grok succeeded on the previously installed build: both returned the token contained only in the PDF. This does not establish live success for every provider or the updated build; run the [manual smoke test](docs/TESTING.md) after reloading it.

Files:

- `background.js` routes requests.
- `tabs.js` finds chats and sides and shows a chat on the other side.
- `bridge.js` coordinates sending and sharing.
- `settings.js` stores the share settings and builds the shared message.
- `adapters.js` contains each site’s selectors and editor handling.
- `reply-files.js` finds generated download cards; `download-capture.js` reads their files when you choose to include them in a share.
- `content.js` adds the on-page controls.
- `popup.*` opens assistants, creates splits, and edits the share settings.
- `icons/` holds the toolbar icon (the bare mark, 16–64 px) and the app icon for `chrome://extensions` and the install dialog (the dark tile, 48 and 128 px). Both are made from the artwork in [`figs`](figs).
