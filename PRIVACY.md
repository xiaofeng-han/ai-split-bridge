# AI Split Bridge privacy policy

Last updated: 18 November 2026

AI Split Bridge is a Chrome extension for sending one prompt to several AI chats and sharing selected prompts, replies, and generated files between them. It runs entirely in your browser. The developer runs no server and receives none of your data.

## What the extension handles

- **Composer content**: text, links, and attached files in ChatGPT, Claude, Gemini, or Grok, transferred when you click **Send both** or another send control, or use its shortcut. The extension also checks the composer to protect existing drafts. Files added while the extension is loaded are held by reference in page memory; their bytes are read when you send them.
- **Selected messages**: rendered text from your prompts and the assistants’ replies, read when you use **Share with…** or **Select messages…**. The picker lists messages currently loaded on the page. It does not retrieve unloaded history or original attachments from past prompts.
- **Answer comparisons** use the latest completed reply in each pane of the current split. Opening **Compare** checks readiness and returns temporary turn identifiers. Choosing a reviewer transfers both answer texts into its chat according to your send or draft setting. The comparison includes only answer text.
- **Cross-reviews** exchange the two latest completed answers when you choose a review action. Each provider receives your shared cross-review guidance, the selected review instructions and the other provider’s answer in a chat message. Each page temporarily remembers its original answer and its review request so the extension can match the resulting critiques. Choosing a revision sends the selected assistant its original answer and the other assistant’s critique. The send or draft setting applies to both steps.
- **Generated files**: when you choose a destination with the share menu’s files checkbox enabled, the extension uses recognized download/export controls in the selected replies to read the files. This can request a download from the source provider or its file host; same-origin downloads use your existing site session. File contents are held in memory for transfer, not saved to your Downloads folder by the extension.
- **Open AI tabs**: the titles and addresses of ChatGPT, Claude, Gemini, and Grok tabs in the current window, used to list the chats you can send to and to tell which side of Split View each one is on. Other tabs and sites are not accessed.
- **Reading tools**: when enabled, the extension identifies messages to widen, fold, or bookmark. It reads short previews from the open page for the bookmark list.
- **Share settings**: whether shared messages are sent right away, and your templates for sharing replies, prompts and selected conversations, and your instructions for comparing and reviewing answers.

## How it is used

Only to carry out the action you clicked. Selected text and file copies pass between content scripts and the extension's service worker, then into each chat you chose. Shared text can be left as a draft or submitted using the site's own Send button. Files are uploaded to the destination provider when staged, even in draft mode or if the later submission fails. The source site's downloads and destination site's uploads and messages are handled under those providers' privacy policies.

## Where it is stored

- **Share settings** are saved in Chrome's sync storage, so they follow your Chrome profile if Chrome sync is on.
- **Reading preferences, folds and bookmarks** are stored locally on this device. Saved conversations use their site and path together with a message identifier or text fingerprint. Short bookmark previews and their last scroll positions are held in page memory during a visit. In temporary chats, folds and bookmarks last only on the page.
- **Session memory**: recently used tab IDs and, when a pane has to be navigated, the conversation address each pane showed. These are kept in Chrome's session storage for the current window, removed when the window closes, and cleared when Chrome quits.
- **Prompts, replies, and file contents are not saved in extension storage.** Composer file references and temporary transfer copies stay in memory. Content placed in a destination chat may be retained by that provider, including uploaded files in an unsent draft.

## What it does not do

- It sends nothing to the developer or analytics services. Network activity is limited to the source site's file downloads and the AI sites you choose for uploads and messages.
- It has no analytics, tracking, advertising, or remote code.
- The developer does not sell your data, use it for advertising or creditworthiness, use it for unrelated purposes, or read your conversations. Each AI provider's own data practices still apply.

## Limited Use

The use of information received through this extension adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Permissions

- `storage`: for sharing preferences, local reading settings and markers, and temporary tab memory.
- Access to `chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com`, and `grok.com`: to add the controls, read selected messages and generated downloads, and protect and fill composers. No broad browsing, clipboard, or downloads permission is requested. Generated files may be downloaded from a file URL supplied by the source site.

## Your choices

You can change or reset the share settings in the extension's popup. Removing the extension deletes everything it stored.

## Contact

Questions about this policy can be sent to the contact email shown on the extension's Chrome Web Store page.
