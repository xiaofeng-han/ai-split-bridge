# AI Split Bridge

Use ChatGPT, Claude, Gemini, and Grok in Chrome’s native Split View. Ask two assistants the same question in their own chats, then decide whether to share a reply, compare their answers, or ask for a second opinion.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/ai-split-bridge/blpbjnnhonpljglaffglpopmonamlgap)** · Desktop Chrome 140+ with Split View

![ChatGPT and Gemini side by side, with Send both beside each chat’s regular Send button](figs/screnshot.png)

## Try it with two chats

1. Open two supported AI sites in the same Chrome window and sign in if needed. Refresh any tabs that were open when you installed the extension.
2. Right-click a chat tab and use Chrome’s Split View option to put the chats side by side.
3. Type in either chat and click **Send both**. Links and supported local attachments go with the prompt. To follow up with just one assistant, use its regular Send button.

For **Send both**, you can also press **⌘+Shift+Enter** on Mac or **Ctrl+Shift+Enter** on Windows and Linux.

## Compare answers or get a critique

Say you ask both assistants, “How would you teach spreadsheets to beginners in a one-hour workshop?” One suggests a live demo. The other starts with a hands-on exercise. Once both have answered, you have two options.

- Click **Compare** and choose one assistant to read both plans. It looks for disagreements, gaps, and claims worth checking, including claims both assistants make.
- Click **Cross-review** to have each assistant critique the other’s plan. Read the critiques side by side, then choose which assistant should revise its answer. The arrow beside **Cross-review** also offers **Find errors** and **Suggest improvements**.

You can edit the sharing, comparison, and review instructions in the extension settings. Turn off **Send right away** to edit the draft before sending.

## Share a message or switch chats

- **Share with…** sends your prompt, an assistant’s reply, or a highlighted passage to another chat. You can include supported files generated in a reply.
- Open the arrow beside **Send both** to share several messages in order, send a prompt to more tabs, or bring another conversation into the opposite pane.
- For long chats, turn on **Wider messages** or **Message tools** in settings. You can collapse a reply or bookmark one you want to find again.

## Privacy and local setup

The extension runs in your browser and needs no separate account or API key. The assistants you choose receive the content you share. Files upload to the destination chat even when you leave the message as a draft. [Privacy policy](PRIVACY.md)

To run the source locally, enable **Developer mode** at `chrome://extensions`, choose **Load unpacked**, and select the [extension folder](extension/). [Testing guide](docs/TESTING.md)
