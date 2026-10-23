import './core.js';

const trustedStorage = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const API = 'https://api.linear.app/graphql';
let queue = Promise.resolve();

async function graphql(key, query, variables = {}) {
  let response;
  try {
    response = await fetch(API, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
      credentials: 'omit',
      redirect: 'error'
    });
  } catch {
    throw new Error('Linear could not be reached. If you were sending, retry the same ticket to check its status safely.');
  }
  if (response.status === 401 || response.status === 403) throw new Error('Linear rejected this key. Check its permissions in extension settings.');
  if (response.status === 429) throw new Error('Linear is rate limiting requests. Wait a minute and retry.');
  if (!response.ok) throw new Error(`Linear returned HTTP ${response.status}. Retry the same ticket to check its status.`);
  let body;
  try { body = await response.json(); } catch { throw new Error('Linear returned an unreadable response. Retry the same ticket to check its status.'); }
  if (body.errors?.length) {
    // Keep remote messages out of the page; do not echo request contents or keys.
    throw new Error('Linear rejected the request. Check the API key, team access, and ticket fields.');
  }
  return body.data;
}

function safeConfig(config) {
  return { connected: Boolean(config?.key && config?.teamId), teamName: config?.teamName || '', teamKey: config?.teamKey || '', teamId: config?.teamId || '', workspaceName: config?.workspaceName || '' };
}

function validIssue(issue) {
  return issue && typeof issue.identifier === 'string' && typeof issue.url === 'string' && issue.url.startsWith('https://linear.app/');
}

async function handle(message, sender) {
  await trustedStorage;
  const isOptions = sender.url === chrome.runtime.getURL('options.html') && !sender.tab?.url?.startsWith('https://meet.google.com/');
  let isMeet = false;
  try { isMeet = new URL(sender.url).origin === 'https://meet.google.com' && Boolean(sender.tab); } catch {}
  if (!isOptions && !isMeet) throw new Error('This action is only available in Meet or extension settings.');
  const { config } = await chrome.storage.local.get('config');
  if (message.type === 'status') return safeConfig(config);
  if (message.type === 'openSettings' && isMeet) {
    await chrome.runtime.openOptionsPage();
    return {};
  }
  if (message.type === 'connect' && isOptions) {
    const key = String(message.key || '').trim();
    if (!key || key.length > 512) throw new Error('Enter your Linear personal API key.');
    if (!/^lin_api_[A-Za-z0-9_-]+$/.test(key)) throw new Error('Enter a Linear personal API key starting with lin_api_.');
    const teamId = String(message.teamId || '').trim();
    const teamKey = String(message.teamKey || '').trim().toUpperCase();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(teamId)) throw new Error('Enter the team UUID from Linear’s Copy model UUID command.');
    if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(teamKey)) throw new Error('Enter your team’s issue prefix, such as ENG.');
    const next = { key, teamId, teamKey, teamName: String(message.teamName || teamKey).trim().slice(0,100), workspaceName: String(message.workspaceName || 'Linear').trim().slice(0,100) };
    await chrome.storage.local.set({ config: next });
    return safeConfig(next);
  }
  if (message.type === 'disconnect' && isOptions) {
    await chrome.storage.local.remove(['config', 'deliveries']);
    await chrome.storage.session.remove('candidate');
    return {};
  }
  if (!['create', 'update'].includes(message.type) || !isMeet) throw new Error('Unsupported action.');
  if (!config?.key || !config.teamId) throw new Error('Connect Linear in extension settings first.');
  const title = String(message.ticket?.title || '').trim();
  const description = String(message.ticket?.description || '').trim();
  if ((message.type === 'create' || message.replaceTitle === true) && !title) throw new Error('Add a title first.');
  if (title.length > 250 || description.length > 50000) throw new Error('Use a title up to 250 characters and a description below 50,000 characters.');
  // The source comes from Chrome, never from a page-supplied message.
  const source = MeetLinearCore.meetingUrl(sender.url);
  if (!source) throw new Error('Open a Google Meet call to send a ticket.');
  const fullDescription = MeetLinearCore.descriptionWithSource(description, source);
  if (message.type === 'update') {
    const issueId = String(message.issueId || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(issueId) || issueId.slice(0,issueId.lastIndexOf('-')) !== config.teamKey) throw new Error(`Enter an issue ID from your ${config.teamKey} team, such as ${config.teamKey}-123.`);
    const input = {};
    if (message.replaceTitle === true) input.title = title;
    if (message.replaceDescription === true) input.description = fullDescription;
    if (!Object.keys(input).length) throw new Error('Choose a field to update.');
    if (message.replaceDescription === true && !description) throw new Error('Add a replacement description first.');
    const result = await graphql(config.key,
      'mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { identifier url } } }',
      { id: issueId, input });
    if (!result?.issueUpdate?.success || !validIssue(result.issueUpdate.issue)) throw new Error('Linear did not confirm the update.');
    return { issue: result.issueUpdate.issue, updated: true };
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([config.teamId, source, title, description])));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const { deliveries = {} } = await chrome.storage.local.get('deliveries');
  let delivery = deliveries[fingerprint];
  if (validIssue(delivery?.issue)) return { issue: delivery.issue, alreadySent: true };
  if (!delivery) {
    delivery = { id: crypto.randomUUID(), createdAt: Date.now() };
    deliveries[fingerprint] = delivery;
    const entries = Object.entries(deliveries).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 100);
    await chrome.storage.local.set({ deliveries: Object.fromEntries(entries) });
  }
  let data;
  try {
    data = await graphql(config.key,
      'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }',
      { input: { id: delivery.id, teamId: config.teamId, title, description: fullDescription } });
  } catch (error) {
    // Reuse the same UUID on retries, even across worker restarts. Never make a
    // second ticket if a network failure hid a successful first creation.
    throw new Error(`${error.message} If a previous send timed out, check Linear for the ticket; no second ticket will be created by retrying the same text.`);
  }
  if (!data?.issueCreate?.success || !validIssue(data.issueCreate.issue)) throw new Error('Linear did not confirm creation. Retry the same ticket to check its status.');
  delivery.issue = data.issueCreate.issue;
  // Refresh the pruned map rather than reintroducing discarded receipts.
  const stored = await chrome.storage.local.get('deliveries');
  await chrome.storage.local.set({ deliveries: { ...stored.deliveries, [fingerprint]: delivery } });
  return { issue: delivery.issue, alreadySent: false };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const run = queue.then(() => handle(message, sender));
  queue = run.catch(() => {});
  run.then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message || 'Something went wrong.' }));
  return true;
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
