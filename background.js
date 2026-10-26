import './core.js';
import './prompts.js';
import './oauth-config.js';
import './oauth.js';

const trustedStorage = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const API = 'https://api.linear.app/graphql';
let queue = Promise.resolve();

async function graphql(key, query, variables = {}) {
  if (key === 'oauth') key = `Bearer ${await LinearOAuth.accessToken()}`;
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
  if (response.status === 401 || response.status === 403) throw new Error('Linear rejected this connection. Sign in again or check your API key permissions in extension settings.');
  if (response.status === 429) throw new Error('Linear is rate limiting requests. Wait a minute and retry.');
  if (!response.ok) throw new Error(`Linear returned HTTP ${response.status}. Retry the same ticket to check its status.`);
  let body;
  try { body = await response.json(); } catch { throw new Error('Linear returned an unreadable response. Retry the same ticket to check its status.'); }
  if (body.errors?.length) {
    // Keep remote messages out of the page; do not echo request contents or keys.
    throw new Error(query.trim().startsWith('query') ? 'Could not read Linear tickets. The picker needs Read permission on the configured team. Check your connection in extension settings.' : 'Linear rejected the request. Check your connection, team access, and ticket fields.');
  }
  return body.data;
}

function safeConfig(config) {
  return { connected: Boolean(config?.key && config?.teamId), authType:config?.authType || 'apiKey', teamName: config?.teamName || '', teamKey: config?.teamKey || '', teamId: config?.teamId || '', workspaceName: config?.workspaceName || '' };
}

function validIssue(issue) {
  return issue && typeof issue.identifier === 'string' && typeof issue.url === 'string' && issue.url.startsWith('https://linear.app/');
}

function issueIdentifier(value, config) {
  const id = String(value || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(id) || id.slice(0,id.lastIndexOf('-')) !== config.teamKey) throw new Error(`Choose an issue from the ${config.teamKey} team.`);
  return id;
}
async function readIssue(config, value) {
  const id = issueIdentifier(value, config);
  const result = await graphql(config.key, 'query($id: String!) { issue(id: $id) { identifier title description createdAt updatedAt url state { id name } assignee { id name } team { id } } }', {id});
  const issue = result?.issue;
  if (!validIssue(issue) || issue.identifier !== id || issue.team?.id !== config.teamId) throw new Error('This ticket is not in the configured team.');
  if ((issue.description || '').length > 50000) throw new Error('This ticket is too large to prepare an update in Google Meet AI Actions.');
  return {identifier:issue.identifier,title:issue.title,description:issue.description || '',createdAt:issue.createdAt,updatedAt:issue.updatedAt,url:issue.url,state:issue.state,assignee:issue.assignee};
}

let teamOptionsCache = null;
async function teamOptions(config) {
  if (teamOptionsCache?.teamId===config.teamId && teamOptionsCache?.key===config.key && Date.now()-teamOptionsCache.time<60000) return teamOptionsCache.value;
  const members = new Map(); let after = null, states = [];
  do {
    const data = await graphql(config.key,'query($id: String!, $after: String) { team(id: $id) { id states(first: 100) { nodes { id name type position } } members(first: 100, after: $after) { nodes { id name displayName active } pageInfo { hasNextPage endCursor } } } }',{id:config.teamId,after});
    const team = data?.team;
    if (team?.id!==config.teamId || !team.states?.nodes || !team.members?.nodes) throw new Error('Could not load statuses and people for the configured team.');
    states = team.states.nodes.map(({id,name,type,position})=>({id,name,type,position})).sort((a,b)=>a.position-b.position);
    for (const member of team.members.nodes) if(member.active!==false) members.set(member.id,{id:member.id,name:member.displayName || member.name});
    const next = team.members.pageInfo;
    if (next?.hasNextPage && (!next.endCursor || next.endCursor===after)) throw new Error('Could not load the next page of team members.');
    after=next?.hasNextPage ? next.endCursor : null;
  } while(after);
  const value={states,members:[...members.values()].sort((a,b)=>a.name.localeCompare(b.name))};
  teamOptionsCache={teamId:config.teamId,key:config.key,time:Date.now(),value};
  return value;
}
async function validateProperties(config, properties) {
  if (!Object.keys(properties).length) return properties;
  const options = await teamOptions(config);
  if (properties.stateId && !options.states.some(state=>state.id===properties.stateId)) throw new Error('Choose a status from your configured team.');
  if (properties.assigneeId && !options.members.some(member=>member.id===properties.assigneeId)) throw new Error('Choose an active assignee from your configured team.');
  return properties;
}

function sessionKey(sender, config) {
  const source = MeetLinearCore.meetingUrl(sender.url);
  if (!source) throw new Error('Open a Google Meet call to view session tickets.');
  return `${sender.tab.id}|${source}|${config.teamId}`;
}
async function sessionTickets(sender, config, entry = null) {
  const key = sessionKey(sender, config);
  const {meetingTickets = {}} = await chrome.storage.session.get('meetingTickets');
  const tickets = meetingTickets[key] || [];
  if (entry && !tickets.some(ticket => ticket.identifier === entry.identifier)) {
    tickets.push(entry);
    meetingTickets[key] = tickets.slice(-100);
    await chrome.storage.session.set({meetingTickets});
  }
  return tickets.slice(-100);
}

async function handle(message, sender) {
  await trustedStorage;
  const isOptions = sender.url === chrome.runtime.getURL('options.html') && !sender.tab?.url?.startsWith('https://meet.google.com/');
  let isMeet = false;
  try { isMeet = new URL(sender.url).origin === 'https://meet.google.com' && Boolean(sender.tab); } catch {}
  if (!isOptions && !isMeet) throw new Error('This action is only available in Meet or extension settings.');
  const { config } = await chrome.storage.local.get('config');
  if (message.type === 'status') return safeConfig(config);
  if (message.type === 'oauthConnect' && isOptions) {
    const old = (await chrome.storage.session.get('oauthCandidate')).oauthCandidate;
    if (old) await LinearOAuth.revoke(old.tokens);
    await chrome.storage.session.remove('oauthCandidate');
    const tokens = await LinearOAuth.authorize();
    try {
      const teams = []; let after = null, workspaceName = '';
      do {
        const data = await graphql(`Bearer ${tokens.accessToken}`, 'query($after: String) { organization { name } teams(first: 100, after: $after) { nodes { id name key } pageInfo { hasNextPage endCursor } } }', {after});
        if (!data?.organization?.name || !Array.isArray(data.teams?.nodes)) throw new Error('Could not load your Linear teams.');
        workspaceName = data.organization.name;
        for (const team of data.teams.nodes) {
          if (!/^[a-f0-9-]{36}$/i.test(team.id || '') || !/^[A-Z][A-Z0-9_]{0,19}$/i.test(team.key || '') || !team.name) throw new Error('Linear returned an invalid team.');
          teams.push({id:team.id,name:team.name,key:team.key});
        }
        const page = data.teams.pageInfo;
        if (page?.hasNextPage && (!page.endCursor || page.endCursor === after)) throw new Error('Could not load the next page of Linear teams.');
        after = page?.hasNextPage ? page.endCursor : null;
      } while (after);
      if (!teams.length) throw new Error('No accessible teams were found in this Linear workspace.');
      const candidate = {id:crypto.randomUUID(),createdAt:Date.now(),tokens,workspaceName,teams};
      await chrome.storage.session.set({oauthCandidate:candidate});
      return {candidateId:candidate.id,workspaceName,teams};
    } catch (error) { await LinearOAuth.revoke(tokens); throw error; }
  }
  if (message.type === 'oauthSelectTeam' && isOptions) {
    const {oauthCandidate:candidate} = await chrome.storage.session.get('oauthCandidate');
    if (!candidate || candidate.id !== message.candidateId || Date.now()-candidate.createdAt > 600000) throw new Error('Sign in with Linear again to select a team.');
    const team = candidate.teams.find(team => team.id === message.teamId);
    if (!team) throw new Error('Choose one of the teams returned by Linear.');
    const next = {key:'oauth',authType:'oauth',teamId:team.id,teamKey:team.key.toUpperCase(),teamName:team.name,workspaceName:candidate.workspaceName};
    const previous = (await chrome.storage.local.get('linearOAuth')).linearOAuth;
    await chrome.storage.local.set({config:next,linearOAuth:candidate.tokens});
    await chrome.storage.session.remove('oauthCandidate');
    teamOptionsCache = null;
    if (previous && previous.refreshToken !== candidate.tokens.refreshToken) await LinearOAuth.revoke(previous);
    return safeConfig(next);
  }
  if (message.type === 'oauthCancel' && isOptions) {
    const {oauthCandidate} = await chrome.storage.session.get('oauthCandidate');
    await chrome.storage.session.remove('oauthCandidate');
    if (oauthCandidate) await LinearOAuth.revoke(oauthCandidate.tokens);
    return {};
  }
  if (['getTeamOptions','saveIssueDefaults'].includes(message.type)) {
    if (!config?.key || !config.teamId) throw new Error('Connect Linear in extension settings first.');
    const options=await teamOptions(config);
    if(message.type==='saveIssueDefaults') {
      if(!isOptions) throw new Error('Defaults can only be saved in extension settings.');
      const properties={stateId:String(message.stateId||''),assigneeId:message.assigneeId ? String(message.assigneeId) : null};
      await validateProperties(config,properties);
      await chrome.storage.local.set({issueDefaults:{teamId:config.teamId,...properties}});
    }
    const {issueDefaults}=await chrome.storage.local.get('issueDefaults');
    return {...options,defaults:issueDefaults?.teamId===config.teamId ? {stateId:issueDefaults.stateId,assigneeId:issueDefaults.assigneeId} : {stateId:options.states.find(state=>state.type==='backlog')?.id || '',assigneeId:null}};
  }

  if (message.type === 'getPrompts') {
    const {prompts} = await chrome.storage.local.get('prompts');
    return {prompts:{...ThreadportPrompts.defaults,...prompts}};
  }
  if (message.type === 'savePrompts' && isOptions) {
    const prompts = {};
    for (const name of ['create','update']) {
      const value = message.prompts?.[name];
      if (typeof value !== 'string' || !value.trim() || value.length > 12000) throw new Error('Each prompt must contain 1 to 12,000 characters.');
      prompts[name] = value.trim();
    }
    await chrome.storage.local.set({prompts});
    return {};
  }

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
    const next = { key, authType:'apiKey', teamId, teamKey, teamName: String(message.teamName || teamKey).trim().slice(0,100), workspaceName: String(message.workspaceName || 'Linear').trim().slice(0,100) };
    await chrome.storage.local.set({ config: next });
    const {linearOAuth} = await chrome.storage.local.get('linearOAuth');
    if (linearOAuth) { await LinearOAuth.revoke(linearOAuth); await chrome.storage.local.remove('linearOAuth'); }
    const {oauthCandidate} = await chrome.storage.session.get('oauthCandidate');
    if (oauthCandidate) { await LinearOAuth.revoke(oauthCandidate.tokens); await chrome.storage.session.remove('oauthCandidate'); }
    teamOptionsCache = null;
    return safeConfig(next);
  }
  if (message.type === 'disconnect' && isOptions) {
    const {linearOAuth} = await chrome.storage.local.get('linearOAuth');
    const revoked = linearOAuth ? await LinearOAuth.revoke(linearOAuth) : true;
    const {oauthCandidate} = await chrome.storage.session.get('oauthCandidate');
    if (oauthCandidate) await LinearOAuth.revoke(oauthCandidate.tokens);
    await chrome.storage.local.remove(['config', 'deliveries','issueDefaults','linearOAuth']);
    await chrome.storage.session.remove(['candidate','oauthCandidate','meetingTickets']);
    teamOptionsCache = null;
    return {revoked};
  }
  if (!['create', 'update', 'listIssues', 'getIssue','findMatchingIssues','sessionTickets','clearSessionTickets'].includes(message.type) || !isMeet) throw new Error('Unsupported action.');
  if (!config?.key || !config.teamId) throw new Error('Connect Linear in extension settings first.');
  if (message.type === 'sessionTickets') return {tickets:await sessionTickets(sender, config)};
  if (message.type === 'clearSessionTickets') {
    const {meetingTickets = {}} = await chrome.storage.session.get('meetingTickets');
    delete meetingTickets[sessionKey(sender, config)];
    await chrome.storage.session.set({meetingTickets});
    return {};
  }
  if (message.type === 'getIssue') return {issue:await readIssue(config,message.issueId)};
  if (message.type==='findMatchingIssues') {
    const title=String(message.title||'').trim();
    if(!title || title.length>250) return {issues:[]};
    const data=await graphql(config.key,'query($filter: IssueFilter!) { issues(first: 10, filter: $filter, orderBy: createdAt) { nodes { identifier title createdAt url team { id } } } }',{filter:{team:{id:{eq:config.teamId}},title:{eq:title}}});
    if(!data?.issues?.nodes || data.issues.nodes.some(issue=>!validIssue(issue)||issue.team?.id!==config.teamId)) throw new Error('Could not check existing tickets in the configured team.');
    return {issues:data.issues.nodes.map(({identifier,title,createdAt,url})=>({identifier,title,createdAt,url}))};
  }

  if (message.type === 'listIssues') {
    const search = String(message.search || '').trim().slice(0,200);
    const after = typeof message.after === 'string' ? message.after.slice(0,1000) : null;
    const filter = {team:{id:{eq:config.teamId}}};
    if (/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/i.test(search)) {
      issueIdentifier(search,config);
      filter.number = {eq:Number(search.slice(search.lastIndexOf('-')+1))};
    } else if (search) filter.or = [{title:{containsIgnoreCase:search}},{description:{containsIgnoreCase:search}}];
    const data = await graphql(config.key,'query($filter: IssueFilter!, $after: String) { issues(first: 25, after: $after, filter: $filter, orderBy: createdAt) { nodes { identifier title createdAt updatedAt url team { id } } pageInfo { hasNextPage endCursor } } }',{filter,after});
    if (!data?.issues?.nodes || data.issues.nodes.some(issue=>!validIssue(issue) || issue.team?.id!==config.teamId)) throw new Error('Linear returned tickets outside the configured team.');
    return {issues:data.issues.nodes.map(({identifier,title,createdAt,updatedAt,url})=>({identifier,title,createdAt,updatedAt,url})).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)),pageInfo:data.issues.pageInfo};
  }

  const title = String(message.ticket?.title || '').trim();
  const description = String(message.ticket?.description || '').trim();
  if ((message.type === 'create' || message.replaceTitle === true) && !title) throw new Error('Add a title first.');
  if (title.length > 250 || description.length > 50000) throw new Error('Use a title up to 250 characters and a description below 50,000 characters.');
  // The source comes from Chrome, never from a page-supplied message.
  const source = MeetLinearCore.meetingUrl(sender.url);
  if (!source) throw new Error('Open a Google Meet call to send a ticket.');
  const fullDescription = MeetLinearCore.descriptionWithSource(description, source);
  const properties={};
  if(typeof message.stateId==='string' && message.stateId) properties.stateId=message.stateId;
  if(Object.hasOwn(message,'assigneeId')) {
    if(message.assigneeId!==null && (typeof message.assigneeId!=='string' || !message.assigneeId)) throw new Error('Choose a valid assignee.');
    properties.assigneeId=message.assigneeId;
  }
  if(message.type==='create' && !Object.keys(properties).length) {
    const {issueDefaults}=await chrome.storage.local.get('issueDefaults');
    if(issueDefaults?.teamId===config.teamId) {if(issueDefaults.stateId)properties.stateId=issueDefaults.stateId;properties.assigneeId=issueDefaults.assigneeId||null;}
  }
  await validateProperties(config,properties);

  if (message.type === 'update') {
    const issueId = String(message.issueId || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(issueId) || issueId.slice(0,issueId.lastIndexOf('-')) !== config.teamKey) throw new Error(`Enter an issue ID from your ${config.teamKey} team, such as ${config.teamKey}-123.`);
    let currentIssue = null;
    if (message.expectedUpdatedAt) {
      currentIssue = await readIssue(config,issueId);
      if (currentIssue.updatedAt !== message.expectedUpdatedAt) throw new Error('This ticket changed in Linear after it was selected. Use Ask for update to reload the latest ticket before sending.');
    }
    const input = {...properties};
    if (message.replaceTitle === true) input.title = title;
    if (message.append === true) {
      const existing = currentIssue ? currentIssue.description.trim() : typeof message.existingDescription === 'string' ? message.existingDescription.trim() : '';
      if (!existing && !currentIssue) throw new Error('Paste the current ticket description before appending. Choose Replace if it is empty.');
      if (!description) throw new Error('Add the details to append.');
      input.description = existing ? existing + '\n\n---\n\n' + fullDescription : fullDescription;
      if (input.description.length > 50000) throw new Error('The combined description exceeds 50,000 characters.');
      delete input.title; // Append always preserves the existing title.
    } else if (message.replaceDescription === true) input.description = fullDescription;
    if (!Object.keys(input).length) throw new Error('Choose a field to update.');
    if (message.replaceDescription === true && !description) throw new Error('Add a replacement description first.');
    const result = await graphql(config.key,
      'mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { identifier url } } }',
      { id: issueId, input });
    if (!result?.issueUpdate?.success || !validIssue(result.issueUpdate.issue)) throw new Error('Linear did not confirm the update.');
    return { issue: result.issueUpdate.issue, updated: true };
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([config.teamId, source, title, description, properties])));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const { deliveries = {} } = await chrome.storage.local.get('deliveries');
  let delivery = deliveries[fingerprint];
  if (validIssue(delivery?.issue)) {
    await sessionTickets(sender, config, {...delivery.issue,title,description:description.slice(0,4000),descriptionTruncated:description.length>4000,createdAt:delivery.createdAt});
    return { issue: delivery.issue, alreadySent: true };
  }
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
      { input: { id: delivery.id, teamId: config.teamId, title, description: fullDescription, ...properties } });
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
  await sessionTickets(sender, config, {...delivery.issue,title,description:description.slice(0,4000),descriptionTruncated:description.length>4000,createdAt:delivery.createdAt});
  return { issue: delivery.issue, alreadySent: false };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const run = queue.then(() => handle(message, sender));
  queue = run.catch(() => {});
  run.then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message || 'Something went wrong.' }));
  return true;
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// The list survives page/worker reloads, and ends when its Meet tab closes.
chrome.tabs?.onRemoved.addListener(tabId => {
  const cleanup = queue.then(async () => {
    const {meetingTickets = {}} = await chrome.storage.session.get('meetingTickets');
    for (const key of Object.keys(meetingTickets)) if (key.startsWith(`${tabId}|`)) delete meetingTickets[key];
    await chrome.storage.session.set({meetingTickets});
  });
  queue = cleanup.catch(() => {});
});
