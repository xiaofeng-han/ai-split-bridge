import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = name => readFileSync(new URL(`../extension/${name}.js`, import.meta.url), 'utf8');
const scripts = ['download-capture', 'reply-files', 'adapters'].map(source);
function setup(t, body, host = 'chatgpt.com') {
  const dom = new JSDOM(body, { url: `https://${host}/c/test`, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 40 }];
  w.Blob = Blob;
  let serial = 0;
  w.URL.createObjectURL = () => `blob:https://${host}/${++serial}`;
  w.URL.revokeObjectURL = () => {};
  w.fetch = () => { throw new Error('Unexpected network request'); };
  for (const script of scripts) w.eval(script);
  const download = (name, contents, type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') => {
    const a = w.document.createElement('a');
    a.download = name;
    a.href = w.URL.createObjectURL(new w.Blob([contents], { type }));
    a.click();
    w.URL.revokeObjectURL(a.href);
  };
  return { w, document: w.document, files: w.AISplitReplyFiles, adapter: w.AISplitAdapters, download };
}
const card = name => `<span><button aria-label="Open preview of ${name}"></button><span>${name}</span><button aria-label="Download file"></button></span>`;
const nativeCard = (title, format, kind = 'doc') => `<div data-testid="file-card-block" data-sheet-kind="${kind}"><button data-testid="file-card-open" aria-label="View ${title}"></button><span>${title}</span><span>${format}</span><button aria-label="Download ${title}">Download</button></div>`;

test('Claude native cards preserve different generated formats and their real download names', async t => {
  const types = [
    ['Data table', 'CSV', 'sheet', 'data-table.csv', 'text/csv', 'marker,value\nCSV-TOKEN,1'],
    ['Json data', 'JSON', 'doc', 'json_data.json', 'application/json', '{"marker":"JSON-TOKEN"}'],
    ['Gpt oss slot probe', 'IPYNB', 'doc', 'gpt_oss_slot_probe.ipynb', 'application/json', '{"cells":[{"source":"NOTEBOOK-TOKEN"}]}'],
    ['Gpu probe', 'ZIP', 'archive', 'gpu-probe.zip', 'application/zip', new Uint8Array([80, 75, 3, 4, 0, 255])],
    ['Picture', 'PNG', 'image', 'picture.png', 'image/png', new Uint8Array([137, 80, 78, 71, 0, 255])],
    ['Deck', 'PPTX', 'slides', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', new Uint8Array([80, 75, 3, 4])],
    ['Report', 'PDF', 'doc', 'report.pdf', 'application/pdf', '%PDF-1.7\nsynthetic'],
    ['Source', 'PY', 'code', 'source.py', 'text/x-python', 'print("SOURCE-TOKEN")'],
    ['Workbook', 'XLSX', 'sheet', 'workbook.xlsx', 'application/octet-stream', new Uint8Array([80, 75, 3, 4, 1, 2])],
    ['Data segment', 'PARQUET', 'file', 'data_segment.parquet', 'application/octet-stream', new Uint8Array([80, 65, 82, 49, 255])],
  ];
  const f = setup(t, `<div data-testid="assistant-message">${types.map(([title, format, kind]) => nativeCard(title, format, kind)).join('')}<button>Download all</button></div>`, 'claude.ai');
  for (const [title, , , filename, mime, bytes] of types) {
    f.document.querySelector(`button[aria-label="Download ${title}"]`).onclick = () => f.download(filename, bytes, mime);
  }
  const reply = f.adapter.getResponse();
  assert.equal(reply.files.length, types.length, 'Download all is not copied as another file');
  const copies = await f.files.read(reply.files);
  assert.deepEqual(Array.from(copies, file => file.name), types.map(type => type[3]));
  for (let i = 0; i < copies.length; i++) assert.deepEqual(Buffer.from(copies[i].data, 'base64'), Buffer.from(types[i][5]));
});

test('Content-Disposition names and generic MIME types are retained correctly', async t => {
  const f = setup(t, '<a download href="https://chatgpt.com/file">Spreadsheet</a>');
  f.w.fetch = async () => new Response(new Uint8Array([80, 75, 3, 4]), { headers: {
    'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''results%20%E6%B5%8B%E8%AF%95.xlsx",
  } });
  const [copy] = await f.files.read(f.files.list(f.document.body));
  assert.equal(copy.name, 'results 测试.xlsx');
  assert.equal(copy.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('files with the same display title but different formats remain separate', t => {
  const f = setup(t, `<div data-testid="assistant-message">${nativeCard('Bridge data', 'Table<span>·</span>CSV', 'csv')}${nativeCard('Bridge data', 'Code<span>·</span>JSON', 'json')}</div>`, 'claude.ai');
  assert.deepEqual(Array.from(f.adapter.getResponse().files, file => file.name), ['Bridge data.csv', 'Bridge data.json']);
});

test('ChatGPT sibling file cards share actual bytes, not just their labels; duplicate links and citations stay scoped', async t => {
  const f = setup(t, `<div data-chatgpt-selection-message-id="one"><div data-markdown-text-style="assistant-message"><p>Here is the report.</p><a href="https://example.com/source.pdf">Source</a></div>${card('report.docx')}</div>
    <div data-chatgpt-selection-message-id="two">${card('other.docx')}</div>`);
  let reads = 0;
  f.document.querySelector('button[aria-label="Download file"]').onclick = () => { reads++; f.download('report.docx', new Uint8Array([0, 255, 1, 2, 128])); };
  const reply = f.adapter.replyText(f.document.querySelector('[data-markdown-text-style]'));
  assert.deepEqual(Array.from(reply.files, x => x.name), ['report.docx']);
  assert.equal(reads, 0, 'opening Share only discovers the files');
  const click = f.w.HTMLAnchorElement.prototype.click;
  const createURL = f.w.URL.createObjectURL;
  const copies = await f.adapter.readReplyFiles(reply.files);
  assert.equal(reads, 1);
  assert.equal(copies[0].name, 'report.docx');
  assert.deepEqual([...Buffer.from(copies[0].data, 'base64')], [0, 255, 1, 2, 128]);
  assert.equal(f.w.HTMLAnchorElement.prototype.click, click, 'native download behavior is restored');
  assert.equal(f.w.URL.createObjectURL, createURL);
  assert.equal(f.document.querySelector('[data-asb-file-capture]'), null);
});

test('explicit download links deduplicate by URL; sandbox downloads use the site handler', async t => {
  const f = setup(t, `<div data-message-author-role="assistant"><div class="markdown"><a href="sandbox:/mnt/data/report.pdf">Report</a><a href="sandbox:/mnt/data/report.pdf">Again</a><a href="https://example.com/source.pdf">Citation</a></div></div>`);
  const a = f.document.querySelector('a');
  a.onclick = event => { event.preventDefault(); f.download('report.pdf', '%PDF synthetic', 'application/pdf'); };
  const reply = f.adapter.getResponse();
  assert.equal(reply.files.length, 1);
  assert.equal(Buffer.from((await f.files.read(reply.files))[0].data, 'base64').toString(), '%PDF synthetic');
});

test('selected text excludes documents, while an otherwise empty reply can share its file', t => {
  const f = setup(t, `<div data-message-author-role="assistant"><div class="markdown"><p>A selected sentence.</p></div>${card('report.docx')}</div>`);
  const markdown = f.document.querySelector('.markdown');
  const range = f.document.createRange();
  range.selectNodeContents(markdown.querySelector('p'));
  f.w.getSelection().addRange(range);
  const selected = f.adapter.getResponse();
  assert.equal(selected.partial, true);
  assert.equal(selected.files, undefined);
  f.w.getSelection().removeAllRanges();
  markdown.replaceChildren();
  const reply = f.adapter.getResponse();
  assert.equal(reply.text, '');
  assert.equal(reply.files[0].name, 'report.docx');
});

test('Claude Docs opens its export dialog, exports Word and closes only that dialog', async t => {
  const f = setup(t, `<div data-testid="assistant-message"><p>Updated the document.</p><div data-sheet-kind="doc"><button data-testid="frame-card-open" aria-label="View Course plan"></button><button data-testid="frame-card-share" aria-label="Share Course plan"></button></div><div data-sheet-kind="doc">A cited source with no export control</div></div>`, 'claude.ai');
  let exports = 0, closed = 0;
  f.document.querySelector('[data-testid="frame-card-share"]').onclick = () => {
    const dialog = f.document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Course plan');
    dialog.innerHTML = '<button role="radio">Export</button><button aria-label="Close">Close</button>';
    dialog.querySelector('[role="radio"]').onclick = () => {
      const word = f.document.createElement('button');
      word.textContent = 'Word , Editable .docx document';
      word.onclick = () => { exports++; f.download('Course plan.docx', 'the complete course plan'); };
      dialog.append(word);
    };
    dialog.querySelector('[aria-label="Close"]').onclick = () => { closed++; dialog.remove(); };
    f.document.body.append(dialog);
  };
  const reply = f.adapter.getResponse();
  assert.equal(reply.files.length, 1);
  assert.equal(exports, 0);
  const copies = await f.files.read(reply.files);
  assert.equal(exports, 1);
  assert.equal(closed, 1);
  assert.equal(copies[0].name, 'Course plan.docx');
  assert.equal(Buffer.from(copies[0].data, 'base64').toString(), 'the complete course plan');
});

test('unreadable and oversized files fail before sharing and restore the native downloader', async t => {
  for (const fail of ['expired', 'oversized']) {
    const f = setup(t, `<div>${card('report.docx')}</div>`);
    const click = f.w.HTMLAnchorElement.prototype.click;
    f.document.querySelector('[aria-label="Download file"]').onclick = () => {
      if (fail === 'expired') {
        const a = f.document.createElement('a');
        a.download = 'report.docx'; a.href = 'https://chatgpt.com/expired';
        f.w.fetch = async () => new Response('Expired', { status: 403 });
        a.click();
      } else f.download('report.docx', new Uint8Array(20 * 1024 * 1024 + 1));
    };
    await assert.rejects(f.files.read(f.files.list(f.document.body)), /Nothing was sent.*(expired|exceeds 20 MB).*attach this file manually/);
    assert.equal(f.w.HTMLAnchorElement.prototype.click, click);
  }
});

test('Claude Docs exports through its same-origin artifact frame and releases both download hooks', async t => {
  const f = setup(t, `<div data-testid="assistant-message"><div data-sheet-kind="doc"><button data-testid="frame-card-open" aria-label="View Plan"></button><button data-testid="frame-card-share" aria-label="Share Plan"></button></div></div><iframe src="/code/artifact/fixture-doc"></iframe>`, 'claude.ai');
  const frame = f.document.querySelector('iframe');
  const frameDocument = frame.contentDocument, view = frame.contentWindow;
  frameDocument.open(); frameDocument.write('<html><body></body></html>'); frameDocument.close();
  view.Blob = Blob;
  view.URL.createObjectURL = () => 'blob:https://claude.ai/frame-file';
  view.URL.revokeObjectURL = () => {};
  const topClick = f.w.HTMLAnchorElement.prototype.click, frameClick = view.HTMLAnchorElement.prototype.click;
  f.document.querySelector('[data-testid="frame-card-share"]').onclick = () => {
    // Opening an artifact can change the preview query without changing conversations.
    f.w.history.replaceState({}, '', '/c/test?artifact=fixture-doc');
    frameDocument.body.innerHTML = '<div role="dialog"><h2>Plan</h2><span role="radio">Export</span><button>Word, Editable .docx document</button><button aria-label="Close"></button></div>';
    frameDocument.querySelector('button').onclick = () => {
      const a = frameDocument.createElement('a');
      a.download = 'Plan.docx';
      a.href = view.URL.createObjectURL(new view.Blob(['frame document bytes']));
      a.click(); view.URL.revokeObjectURL(a.href);
    };
    frameDocument.querySelector('[aria-label="Close"]').onclick = () => frameDocument.body.replaceChildren();
  };
  const copies = await f.files.read(f.adapter.getResponse().files);
  assert.equal(Buffer.from(copies[0].data, 'base64').toString(), 'frame document bytes');
  assert.equal(frameDocument.querySelector('[role="dialog"]'), null);
  assert.equal(f.w.HTMLAnchorElement.prototype.click, topClick);
  assert.equal(view.HTMLAnchorElement.prototype.click, frameClick);
});

test('a native download timeout restores normal page behavior and leaves no capture marker', async t => {
  const f = setup(t, card('report.docx'));
  const schedule = f.w.setTimeout;
  f.w.setTimeout = (fn, ms) => schedule(fn, ms === 30_000 ? 0 : ms);
  const click = f.w.HTMLAnchorElement.prototype.click;
  const createURL = f.w.URL.createObjectURL;
  await assert.rejects(f.files.read(f.files.list(f.document.body)), /readable download in time/);
  assert.equal(f.w.HTMLAnchorElement.prototype.click, click);
  assert.equal(f.w.URL.createObjectURL, createURL);
  assert.equal(f.document.querySelector('[data-asb-file-capture]'), null);
});

test('an unrelated simultaneous blob download is left alone and cannot replace the chosen file', async t => {
  const f = setup(t, card('report.docx'));
  let unrelated = 0;
  f.document.querySelector('[aria-label="Download file"]').onclick = () => {
    const other = f.document.createElement('a');
    other.download = 'unrelated.docx';
    other.href = f.w.URL.createObjectURL(new f.w.Blob(['wrong file']));
    other.addEventListener('click', event => { unrelated++; event.preventDefault(); });
    other.click();
    f.download('report.docx', 'chosen file');
  };
  const copies = await f.files.read(f.files.list(f.document.body));
  assert.equal(unrelated, 1);
  assert.equal(Buffer.from(copies[0].data, 'base64').toString(), 'chosen file');
});

test('direct downloads reject login HTML and stop at the byte limit even with no Content-Length', async t => {
  const f = setup(t, '<a download="report.docx" href="https://chatgpt.com/report">Download</a>');
  f.w.fetch = async () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(f.files.read(f.files.list(f.document.body)), /page instead of the file/);
  f.w.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1)); controller.close(); } }));
  await assert.rejects(f.files.read(f.files.list(f.document.body)), /exceeds 20 MB/);
});

test('navigation or a removed reply invalidates the file selection; existing dialogs stay untouched', async t => {
  const f = setup(t, `<div data-sheet-kind="doc"><button data-testid="frame-card-open" aria-label="View Plan"></button><button data-testid="frame-card-share" aria-label="Share Plan"></button></div>`, 'claude.ai');
  const files = f.files.list(f.document.body);
  const dialog = f.document.createElement('div'); dialog.setAttribute('role', 'dialog');
  f.document.body.append(dialog);
  await assert.rejects(f.files.read(files), /Close the open dialog/);
  assert.equal(dialog.isConnected, true);
  files[0].element.remove();
  await assert.rejects(f.files.read(files), /reply changed|no longer in this reply/);
});

test('a recognized file card without a downloader is reported instead of silently sharing text', async t => {
  const f = setup(t, '<div data-message-author-role="assistant"><div class="markdown">The file is ready.</div><span class="group/resource-row"><button aria-label="Open preview of unavailable.docx"></button></span></div>');
  const reply = f.adapter.getResponse();
  assert.equal(reply.files.length, 1);
  await assert.rejects(f.files.read(reply.files), /no download control/);
});

test('inline references to uploaded files are not mistaken for generated downloads', t => {
  const f = setup(t, '<div data-message-author-role="assistant"><div class="markdown"><table><tr><td><button aria-label="Open preview of uploaded.csv">uploaded.csv</button></td><td>A verified result.</td></tr></table></div></div>');
  assert.equal(f.adapter.getResponse().files, undefined);
});

test('sharing expands ChatGPT resource lists before discovering every generated file', async t => {
  const f = setup(t, `<div data-message-author-role="assistant"><div class="markdown">Five generated files.</div><div id="resources">${card('report.docx')}${card('sheet.xlsx')}${card('slides.pptx')}<span hidden id="extra">${card('report.pdf')}${card('image.png')}</span><button aria-controls="extra" aria-expanded="false">2 more</button></div></div>`);
  const expand = f.document.querySelector('[aria-expanded]');
  let clicks = 0;
  expand.onclick = () => { clicks++; expand.setAttribute('aria-expanded', 'true'); f.document.querySelector('#extra').hidden = false; };
  const reply = await f.adapter.readResponse();
  assert.equal(clicks, 1);
  assert.deepEqual(Array.from(reply.files, file => file.name), ['report.docx', 'sheet.xlsx', 'slides.pptx', 'report.pdf', 'image.png']);
});

test('a native download may rerender the file controls without changing the logical reply', async t => {
  const f = setup(t, `<div data-chatgpt-selection-message-id="stable"><div data-markdown-text-style="assistant-message">Two files.</div>${card('report.docx')}${card('sheet.xlsx')}</div>`);
  let downloads = 0;
  function wire() {
    const buttons = f.document.querySelectorAll('[aria-label="Download file"]');
    buttons.forEach((button, index) => { button.onclick = () => {
      const names = ['report.docx', 'sheet.xlsx'];
      downloads++;
      f.download(names[index], `file ${index}`);
      // Current ChatGPT redraws its resource rows after requesting a download.
      const scope = f.document.querySelector('[data-chatgpt-selection-message-id]');
      scope.outerHTML = `<div data-chatgpt-selection-message-id="stable"><div data-markdown-text-style="assistant-message">Two files.</div>${card('report.docx')}${card('sheet.xlsx')}</div>`;
      wire();
    }; });
  }
  wire();
  const reply = await f.adapter.readResponse();
  const copies = await f.files.read(reply.files);
  assert.equal(downloads, 2);
  assert.deepEqual(Array.from(copies, file => Buffer.from(file.data, 'base64').toString()), ['file 0', 'file 1']);
});
