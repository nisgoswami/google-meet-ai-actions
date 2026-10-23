(() => {
  if (globalThis.__meetLinearInstalled) return;
  globalThis.__meetLinearInstalled = true;
  const { clean, parseTicket } = MeetLinearCore;
  const markdown = ThreadportMarkdown;
  const adapter = globalThis.ThreadportAdapters.find(adapter => adapter.id === 'google-meet');
  const host = document.createElement('div');
  host.id = 'meet-to-linear';
  host.style.cssText = 'position:fixed;z-index:2147483646;display:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { color-scheme:dark; font:13px/1.4 Arial,sans-serif; color:#eee; }
      * {box-sizing:border-box} [hidden] {display:none!important}
      .prompts {display:flex;gap:4px;justify-content:flex-end;margin-bottom:5px}.prompts button{font-weight:500;font-size:11px;padding:6px 8px;background:#202124;border:1px solid #55565d;border-radius:16px}.bar {display:flex;align-items:center;gap:6px;padding:6px;background:#202124;border:1px solid #55565d;border-radius:10px;box-shadow:0 4px 14px #0004;}
      button {font:600 12px/1.2 Arial,sans-serif;border:0;border-radius:6px;padding:9px 10px;cursor:pointer;color:#dadce0;background:transparent;white-space:nowrap}
      button:hover {background:#3c4043} button.primary {background:#c4b5fd;color:#211537;flex:1} button.primary:hover {background:#d7ccff}
      button:disabled {opacity:.6;cursor:wait} button:focus-visible,input:focus-visible,textarea:focus-visible {outline:2px solid #b3b9ff;outline-offset:2px}
      .toast {background:#202124;border-radius:8px;padding:10px;margin-top:6px;max-width:360px;box-shadow:0 4px 14px #0006;overflow-wrap:anywhere} a {color:#c4b5fd}
      dialog {position:fixed;inset:0;width:min(540px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:#202124;color:#eee;border:1px solid #55565d;border-radius:14px;padding:24px;box-shadow:0 14px 60px #0009;font:14px/1.5 Arial,sans-serif}
      dialog::backdrop {background:#0007} h2 {margin:0 0 8px;font-size:21px} p {color:#bdc1c6;margin:6px 0 18px}
      label {display:block;margin:16px 0 6px;font-weight:600} input,textarea,select {width:100%;font:14px/1.5 Arial,sans-serif;padding:10px;background:#151619;color:#eee;border:1px solid #5f6368;border-radius:7px} textarea {min-height:200px;resize:vertical} input[type=checkbox] {width:auto;margin-right:8px} .fields label {margin:8px 0;font-weight:400}
      .actions {display:flex;gap:8px;justify-content:flex-end;margin-top:18px}.hint {font-size:12px;color:#bdc1c6}.error {color:#f2b8b5}
    </style>
    <div class="bar" id="bar" aria-label="Meet to Linear">
      <button class="primary" id="send" title="Send selected text or the latest Gemini answer to Linear">Send to Linear ↗</button>
      <button id="review" title="Review or paste a ticket before sending">Review</button>
      <button id="settings" aria-label="Linear connection settings" title="Connection settings">⚙</button>
    </div>
    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    <dialog id="editor" aria-labelledby="editor-title">
      <h2 id="editor-title">Send to Linear</h2><p id="destination">One ticket from the text you choose.</p>
      <label for="mode">Action</label><select id="mode"><option value="" disabled>Choose an action</option><option value="create">Create a new ticket</option><option value="update">Replace an existing ticket description</option><option value="append">Append to an existing ticket description</option></select>
      <div id="update-fields" hidden>
        <label for="issue-id">Existing issue ID</label><input id="issue-id" placeholder="ENG-123" autocomplete="off" spellcheck="false">
        <div class="fields"><label><input id="replace-title" type="checkbox">Replace title</label><label><input id="replace-description" type="checkbox" checked>Replace description</label></div>
        <p class="hint" id="update-hint">Only checked fields are replaced.</p>
        <div id="append-fields" hidden><label for="existing-description">Current ticket description</label><textarea id="existing-description" placeholder="Paste the current description from Linear"></textarea><p class="hint">Paste the latest description to preserve it. Appending keeps your API key permissions unchanged. For an empty description, choose Replace.</p></div>
      </div>
      <label for="title">Title</label><input id="title" maxlength="250" autocomplete="off" placeholder="Page or Feature - Improvement or Bug Fix"><p class="hint">Example: Instagram Review - Match comment previews to Instagram</p>
      <label for="description">Description</label><textarea id="description" maxlength="50000" placeholder="Paste or edit the ticket details…"></textarea>
      <p class="hint">Your Meet link is included. Only these fields go to Linear.</p>
      <div id="editor-status" role="status" aria-live="polite"></div>
      <div class="actions"><button id="cancel">Cancel</button><button class="primary" id="create">Create ticket ↗</button></div>
    </dialog>`;
  const promptHost = document.createElement('div');
  promptHost.id = 'threadport-prompts';
  promptHost.style.cssText = 'display:none;position:fixed;z-index:2147483645;box-sizing:border-box;';
  const promptShadow = promptHost.attachShadow({ mode: 'closed' });
  promptShadow.innerHTML = `<style>:host{color-scheme:dark}.prompts{display:flex;align-items:center;gap:4px}button{flex:1;min-width:0;font:500 10px/1.2 Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:7px 6px;border:1px solid #55565d;border-radius:18px;background:#202124;color:#dadce0;cursor:pointer}button:hover{background:#3c4043}button:focus-visible{outline:2px solid #c4b5fd;outline-offset:2px}</style><div class="prompts" aria-label="Gemini ticket prompts"><button id="ask-ticket" title="Prepare a ticket prompt in Ask Gemini">Ask for ticket</button><button id="ask-update" title="Prepare an issue update prompt in Ask Gemini">Ask for update</button></div>`;
  const $ = id => shadow.getElementById(id) || promptShadow.getElementById(id);
  const buttons = [$('send'), $('create')];
  let input, panel, busy = false, captured = '', config = null, toastTimer, pendingIntent = 'create';
  const updateResponses = new WeakSet();
  const messageButtons = new Map();

  async function sendMessage(message) {
    let result;
    try { result = await chrome.runtime.sendMessage(message); }
    catch { throw new Error('Extension updated. Reload this Meet tab when convenient.'); }
    if (!result?.ok) throw new Error(result?.error || 'Could not contact the extension.');
    return result;
  }
  const visible = adapter.visible;
  function selection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return '';
    // Only Gemini selections count; never accidentally submit chat, participants or captions.
    if (!panel?.contains(sel.anchorNode) || !panel.contains(sel.focusNode)) return '';
    if (input?.contains(sel.anchorNode) || input?.contains(sel.focusNode)) return '';
    const selected = document.createElement('div');
    selected.append(sel.getRangeAt(0).cloneContents());
    return markdown(selected);
  }
  function latestResponse() {
    if (!panel) return '';
    const observedResponse = adapter.latestResponse(panel);
    if (observedResponse) return markdown(observedResponse);
    const selectors = [
      '[data-generation-index] .pA4Vnf',
      '[data-linear-gemini-response]',
      '[data-message-author-role="assistant"]',
      '[data-response-id] .markdown',
      '[data-response-id]',
      '[data-is-user-message="false"]',
      '.model-response-text',
      '.markdown-main-panel',
      '[class*="markdown"]'
    ];
    for (const selector of selectors) {
      const elements = Array.from(panel.querySelectorAll(selector)).filter(e => visible(e) && !e.closest('footer') && !e.contains(input));
      const last = elements.at(-1);
      if (last && clean(last.innerText)) {
        if (last.closest('[aria-busy="true"]')) throw new Error('Wait for Gemini to finish its response.');
        return markdown(last);
      }
    }
    // Fail closed rather than guessing a container that could include older responses.
    return '';
  }
  function sourceText() {
    return captured || selection() || latestResponse();
  }
  function notify(text, issue) {
    clearTimeout(toastTimer);
    $('toast').replaceChildren(document.createTextNode(text));
    if (issue) {
      const a = document.createElement('a');
      a.href = issue.url; a.textContent = ` ${issue.identifier} ↗`; a.target = '_blank'; a.rel = 'noopener noreferrer';
      $('toast').append(a);
    }
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, issue ? 18000 : 12000);
  }
  async function status() {
    config = await sendMessage({ type: 'status' });
    $('send').textContent = config.connected ? 'Send to Linear ↗' : 'Connect Linear ↗';
    $('send').title = config.connected ? `Send to ${config.workspaceName} / ${config.teamName}` : 'Choose your Linear team once';
    $('destination').textContent = config.connected ? `${config.workspaceName} / ${config.teamName}` : 'Connect Linear using the settings button first.';
    if (config.teamKey) $('issue-id').placeholder = `${config.teamKey}-123`;
    return config;
  }
  function showEditor(text = sourceText(), intent = 'create') {
    let draft;
    try { draft = parseTicket(text); }
    catch { draft = { title: '', description: text }; }
    $('title').value = draft.title;
    $('description').value = draft.description;
    const updating = Boolean(draft.issueId) || intent === 'update';
    $('mode').value = updating ? 'update' : '';
    $('existing-description').value = '';
    syncActionUI();
    $('issue-id').value = draft.issueId || '';
    $('replace-title').checked = false;
    $('replace-description').checked = true;
    $('editor-status').textContent = '';
    if (!$('editor').open) $('editor').showModal();
    $('title').focus();
    captured = '';
    status().catch(error => $('editor-status').textContent = error.message);
  }
  async function create(ticket, update = null) {
    if (busy) return;
    busy = true;
    buttons.forEach(button => button.disabled = true);
    notify(update ? 'Updating in Linear…' : 'Sending to Linear…');
    try {
      const result = await sendMessage(update ? { type: 'update', ticket, ...update } : { type: 'create', ticket });
      $('editor').close();
      notify(result.updated ? 'Updated:' : result.alreadySent ? 'Already sent:' : 'Created:', result.issue);
      captured = '';
    } catch (error) {
      notify(error.message);
      $('editor-status').textContent = error.message;
    } finally {
      busy = false;
      buttons.forEach(button => button.disabled = false);
      syncActionUI();
    }
  }
  async function sendText(text, intent = 'create') {
    if (busy) return;
    try {
      if (!(await status()).connected) return void await sendMessage({ type: 'openSettings' });
      if (!text) { showEditor(''); notify('Select Gemini’s ticket text, or paste it into Review.'); return; }
      showEditor(text, intent);
    } catch (error) { notify(error.message); }
  }
  function updateMessageButtons() {
    const cards = adapter.cards(panel);
    const current = new Set(cards);
    for (const [card, entry] of messageButtons) {
      if (!current.has(card) || !entry.host.isConnected || !entry.content.isConnected) { entry.host.remove(); messageButtons.delete(card); }
    }
    for (const card of cards) {
      if (messageButtons.has(card)) continue;
      const content = adapter.textElement(card);
      if (pendingIntent === 'update' && card.querySelector('.pA4Vnf')) updateResponses.add(card);
      const messageHost = document.createElement('div');
      messageHost.className = 'meet-linear-message';
      const isPrompt = Boolean(card.querySelector('[jsname="DPm3Gf"]')) && !card.querySelector('.pA4Vnf');
      messageHost.style.cssText = isPrompt
        ? 'display:block;position:relative;z-index:1;flex:0 0 auto;align-self:flex-end;margin:4px 0 0 6px;'
        : 'display:block;position:relative;z-index:1;margin:6px 8px 6px 0;';
      const root = messageHost.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>:host{color-scheme:dark}div{display:flex;justify-content:flex-end;gap:4px}button{font:500 12px Arial,sans-serif;line-height:1.3;border:1px solid #5c5570;border-radius:6px;padding:6px 9px;background:#292633;color:#d4c7ff;cursor:pointer}button:hover{background:#40384e}button:focus-visible{outline:2px solid #c4b5fd}button:disabled{opacity:.5;cursor:wait}</style><div><button class="review" title="Review this message as a ticket">Review</button><button class="send" title="Send only this message to Linear">Send to Linear ↗</button></div>`;
      if (isPrompt) {
        // Fixed-size icons keep Gemini's flex prompt row from stretching the actions.
        const linearIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"/></svg>`;
        const reviewIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7"/><path d="m16 3 5 5M10 14l1-4 7-7a2.1 2.1 0 0 1 3 3l-7 7-4 1Z"/></svg>`;
        root.innerHTML = `<style>:host{color-scheme:dark;flex-shrink:0}div{display:flex;align-items:center;justify-content:flex-end;gap:2px;white-space:nowrap}button{display:inline-flex;align-items:center;justify-content:center;flex:0 0 30px;width:30px;height:30px;padding:6px;border:0;border-radius:7px;background:transparent;color:#bdc1c6;cursor:pointer}button:hover{background:#ffffff12;color:#e8eaed}button:focus-visible{outline:2px solid #c4b5fd;outline-offset:1px}button:disabled{opacity:.5;cursor:wait}svg{display:block;flex:none;pointer-events:none}</style><div><button class="send" aria-label="Send to Linear ↗" title="Send only this message to Linear">${linearIcon}</button><button class="review" aria-label="Review" title="Review this message as a ticket">${reviewIcon}</button></div>`;
      }
      // Match the requested position: bottom right of the message bubble/card.
      adapter.mount(card).append(messageHost);
      const send = root.querySelector('.send');
      const review = root.querySelector('.review');
      send.addEventListener('click', async event => {
        event.stopPropagation();
        if (!event.isTrusted || busy) return;
        const text = markdown(content);
        if (card.querySelector('[aria-busy="true"]')) { notify('Wait for Gemini to finish.'); return; }
        send.disabled = true;
        try { await sendText(text, updateResponses.has(card) ? 'update' : 'create'); } finally { send.disabled = false; }
      });
      review.addEventListener('click', event => {
        event.stopPropagation();
        if (event.isTrusted && !busy) showEditor(markdown(content), updateResponses.has(card) ? 'update' : 'create');
      });
      messageButtons.set(card, { host: messageHost, content });
    }
    $('bar').hidden = cards.length > 0;
  }
  // Preserve a user selection before clicking moves browser focus.
  shadow.addEventListener('pointerdown', event => {
    if (!event.isTrusted) return;
    if (event.composedPath().some(e => e === $('send') || e === $('review'))) captured = selection();
  });
  $('send').addEventListener('click', async event => {
    if (!event.isTrusted || busy) return;
    await sendText(sourceText());
  });
  $('review').addEventListener('click', event => { if (event.isTrusted && !busy) showEditor(); });
  $('settings').addEventListener('click', event => {
    if (event.isTrusted) sendMessage({ type: 'openSettings' }).catch(error => notify(error.message));
  });
  $('cancel').addEventListener('click', () => { if (!busy) $('editor').close(); });
  function syncActionUI() {
    const mode = $('mode').value;
    const updating = mode === 'update' || mode === 'append';
    $('update-fields').hidden = !updating;
    $('append-fields').hidden = mode !== 'append';
    $('replace-title').disabled = mode === 'append';
    $('replace-description').disabled = mode === 'append';
    if (mode === 'append') { $('replace-title').checked = false; $('replace-description').checked = true; }
    $('update-hint').textContent = mode === 'append' ? 'Existing title is kept. New details are added after the current description.' : 'Only checked fields are replaced. Existing text is not fetched.';
    $('create').textContent = mode === 'append' ? 'Append to ticket ↗' : mode === 'update' ? 'Replace selected fields ↗' : mode === 'create' ? 'Create ticket ↗' : 'Choose an action';
    $('create').disabled = !mode || busy;
  }
  $('mode').addEventListener('change', () => {
    syncActionUI();
    if ($('mode').value !== 'create') $('issue-id').focus();
  });
  $('editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('create').addEventListener('click', event => {
    if (!event.isTrusted || busy) return;
    const mode = $('mode').value;
    if (!mode) return;
    const updating = mode !== 'create';
    if (!updating || $('replace-title').checked) {
      if (!/^.+ - .+$/.test($('title').value.trim())) { $('title').focus(); $('editor-status').textContent = 'Use Page or Feature - Improvement or Bug Fix for the title.'; return; }
    }
    const update = updating ? { issueId: $('issue-id').value, replaceTitle: $('replace-title').checked, replaceDescription: $('replace-description').checked, append: mode === 'append', existingDescription: $('existing-description').value } : null;
    create({ title: $('title').value.trim(), description: $('description').value.trim() }, update);
  });

  function askGemini(updating) {
    if (!input) return;
    pendingIntent = updating ? 'update' : 'create';
    const context = clean(input.innerText || input.value);
    const prefix = config?.teamKey || 'ENG';
    const task = updating
      ? `Draft updated details for one existing Linear issue from this meeting. Ask for its actual issue ID if missing; never invent one. Do not claim to read Linear. Include an "issueId" property in your output with the actual ID (for example ${prefix}-123). The user will choose whether to replace the description or append the new details.`
      : 'Draft one actionable Linear ticket from this meeting. Use only discussed facts and mark unknowns as open questions.';
    const format = {
      title: 'Page or Feature Name - Functionality to Improve or Bug to Fix',
      description: '## Summary\nOne concise paragraph explaining the change and why.\n\n## Requirements\n- Specific work to do\n\n## Acceptance criteria\n- Observable, testable outcome'
    };
    const prompt = `${task}\n\nThe title MUST always be "Page or Feature Name - Functionality to Improve or Bug to Fix", using a plain hyphen with spaces. Example: "Instagram Review - Match comment previews to Instagram". Name the real page or feature and use a specific improvement or bug fix, not these placeholders.\n\nReturn ONLY a valid JSON object with separate "title" and "description" fields${updating ? ' and "issueId"' : ''}. Use escaped newline characters inside the JSON description. The description must contain clean Markdown with separate paragraphs, headings, and bullet lists. Do not put "Title:", "Description:", or the ticket title inside the description. Use Summary, Requirements, and Acceptance criteria. For bugs, include Steps to reproduce, Expected behavior, and Actual behavior only when discussed. Omit empty sections and placeholders. Never concatenate labels and headings such as "Description:## Context". No commentary outside the JSON.\n\nExample structure:\n${JSON.stringify(format, null, 2)}${context ? `\n\nMy instructions or existing issue text:\n${context}` : ''}`;

    input.focus();
    if (input.matches('textarea,input')) {
      const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
      setter.call(input, prompt);
    } else {
      const range = document.createRange(); range.selectNodeContents(input);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, prompt)) input.textContent = prompt;
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    notify('Prompt ready. Send it to Gemini when ready.');
  }
  $('ask-ticket').addEventListener('click', event => { if (event.isTrusted && !busy) askGemini(false); });
  $('ask-update').addEventListener('click', event => { if (event.isTrusted && !busy) askGemini(true); });

  function reposition() {
    input = adapter.input();
    // Meet changes data-feed-title to the conversation title after the first prompt.
    panel = adapter.panel(input);
    updateMessageButtons();
    if (!input || !panel || !visible(panel)) {
      host.style.display = 'none';
      promptHost.remove();
      return;
    }
    // Keep the controls outside Gemini's rerendered footer, aligned with its menu.
    const anchor = adapter.promptAnchor(input);
    if (!promptHost.isConnected) document.documentElement.append(promptHost);
    promptHost.style.display = 'none';
    if (anchor && visible(anchor) && anchor.getAttribute('aria-expanded') !== 'true') {
      const menuBox = anchor.getBoundingClientRect();
      const textBox = input.getBoundingClientRect();
      const available = menuBox.left - textBox.left - 44;
      const promptWidth = Math.min(180, available);
      if (promptWidth > 100) {
        promptHost.style.width = `${promptWidth}px`;
        promptHost.style.left = `${menuBox.left - promptWidth - 8}px`;
        promptHost.style.display = 'block';
        promptHost.style.top = `${menuBox.top + (menuBox.height - promptHost.getBoundingClientRect().height) / 2}px`;
      }
    }
    if (!host.isConnected) document.documentElement.append(host);
    const box = (input.closest('footer') || input.parentElement).getBoundingClientRect();
    const inputBox = input.getBoundingClientRect();
    host.style.display = 'block';
    const width = Math.min(360, Math.max(270, box.width - 24));
    host.style.width = `${width}px`;
    host.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, inputBox.left))}px`;
    // Above the composer: never cover Gemini's native send button or editor.
    host.style.top = `${Math.max(8, box.top - 52)}px`;
  }
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; reposition(); });
  }
  // Do not observe our own UI, which lives in its shadow root.
  new MutationObserver(records => {
    if (records.some(record => record.target !== host && record.target !== promptHost && !record.target.closest?.('.meet-linear-message'))) schedule();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded'] });
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('focus', () => { status().catch(() => {}); schedule(); });
  status().catch(() => {});
  reposition();
})();
