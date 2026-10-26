const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto').webcrypto;
const core = require('../core.js');
const prompts = require('../prompts.js');

function harness(fetchImpl, oauth = {}) {
  const data = { config: {key:'lin_api_TEST',teamId:'fixed-team',teamName:'Engineering',teamKey:'ENG',workspaceName:'Example'} };
  let handler;
  const calls = [];
  function area(store) { return {
    setAccessLevel: async () => {},
    get: async key => key == null ? structuredClone(store) : {[key]: structuredClone(store[key])},
    set: async values => Object.assign(store, structuredClone(values)),
    remove: async keys => (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k])
  }; }
  const context = vm.createContext({
    chrome: {
      storage: {local:area(data),session:area({})},
      runtime: {getURL: file => `chrome-extension://test/${file}`,onMessage:{addListener: fn => handler = fn}},
      action: {onClicked:{addListener:()=>{}}}
    },
    fetch: async (url, options) => { calls.push({url,...options});return fetchImpl(url, options, calls.length); },
    crypto, URL, TextEncoder, AbortSignal, MeetLinearCore:core, ThreadportPrompts:prompts, LinearOAuth:oauth, console
  });
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'),'utf8').replace(/^import .*;\n/gm,''),context);
  return {data,calls,call: (message,sender={url:'https://meet.google.com/meet/rap-aqpk-umc',tab:{id:1}}) => new Promise(resolve=>handler(message,sender,resolve))};
}
const success = {ok:true,status:200,json:async()=>({data:{issueCreate:{success:true,issue:{identifier:'ENG-1',url:'https://linear.app/example/issue/ENG-1'}}}})};
const ticket = {title:'Fix checkout',description:'Retry payment'};

test('creates with configured team and trusted source, keeping credentials out of responses', async () => {
  const h=harness(async()=>success);
  const response=await h.call({type:'create',ticket,teamId:'attacker-team',source:'https://evil.test'});
  assert.equal(response.ok,true);
  const body=JSON.parse(h.calls[0].body);
  assert.equal(body.variables.input.teamId,'fixed-team');
  assert.match(body.variables.input.description,/https:\/\/meet.google.com\/rap-aqpk-umc/);
  assert.doesNotMatch(JSON.stringify(response),/lin_api/);
  assert.equal(h.calls[0].headers.Authorization,'lin_api_TEST');
  assert.equal(h.calls[0].credentials,'omit');
});
test('double-clicks are serialized and send a single mutation',async()=>{
  const h=harness(async()=>success);
  const responses=await Promise.all([h.call({type:'create',ticket}),h.call({type:'create',ticket})]);
  assert.equal(h.calls.length,1);
  assert.equal(responses[1].alreadySent,true);
  assert.doesNotMatch(JSON.stringify(h.data.deliveries),/Retry payment|Fix checkout/);
});
test('uncertain retries retain a stable issue ID and do not require Read access',async()=>{
  const h=harness(async(_url,_options,n)=>{if(n===1)throw new Error('network');return success;});
  assert.equal((await h.call({type:'create',ticket})).ok,false);
  assert.equal((await h.call({type:'create',ticket})).ok,true);
  const requests=h.calls.map(call=>JSON.parse(call.body));
  assert.equal(requests[0].variables.input.id,requests[1].variables.input.id);
  assert.ok(requests.every(request=>request.query.startsWith('mutation')));
});
test('rejects foreign origins, arbitrary messages, and home page creation',async()=>{
  const h=harness(async()=>success);
  assert.equal((await h.call({type:'create',ticket},{url:'https://evil.test',tab:{id:1}})).ok,false);
  assert.equal((await h.call({type:'connect',key:'lin_api_EVIL'})).ok,false);
  assert.equal((await h.call({type:'create',ticket},{url:'https://meet.google.com/home',tab:{id:1}})).ok,false);
  assert.equal(h.calls.length,0);
  assert.equal((await h.call({type:'status'})).key,undefined);
});
test('does not treat GraphQL HTTP 200 errors as success or echo remote errors',async()=>{
  const h=harness(async()=>({ok:true,status:200,json:async()=>({errors:[{message:'lin_api_SECRET'}]})}));
  const response=await h.call({type:'create',ticket});
  assert.equal(response.ok,false);
  assert.doesNotMatch(response.error,/SECRET/);
});
test('updates only the selected fields using the issue-only mutation',async()=>{
  const h=harness(async()=>({ok:true,status:200,json:async()=>({data:{issueUpdate:{success:true,issue:{identifier:'ENG-12',url:'https://linear.app/example/issue/ENG-12'}}}})}));
  const response=await h.call({type:'update',issueId:'eng-12',replaceTitle:false,replaceDescription:true,ticket:{title:'',description:'New acceptance criteria'}});
  assert.equal(response.updated,true);
  const body=JSON.parse(h.calls[0].body);
  assert.equal(body.variables.id,'ENG-12');
  assert.equal(body.variables.input.title,undefined);
  assert.match(body.variables.input.description,/New acceptance criteria/);
  assert.ok(body.query.includes('issueUpdate'));
});
test('rejects cross-team updates and empty replacement descriptions',async()=>{
  const h=harness(async()=>success);
  assert.equal((await h.call({type:'update',issueId:'OTHER-1',replaceTitle:true,ticket})).ok,false);
  assert.equal((await h.call({type:'update',issueId:'ENG-1',replaceDescription:true,ticket:{title:'',description:''}})).ok,false);
  assert.equal(h.calls.length,0);
});

test('appends to the supplied current description without broader permissions', async () => {
  const h=harness(async()=>({ok:true,status:200,json:async()=>({data:{issueUpdate:{success:true,issue:{identifier:'ENG-12',url:'https://linear.app/example/issue/ENG-12'}}}})}));
  const response=await h.call({type:'update',issueId:'ENG-12',append:true,replaceDescription:true,ticket,existingDescription:'## Existing\n- Preserve this'});
  assert.equal(response.updated,true);
  const body=JSON.parse(h.calls[0].body);
  assert.match(body.variables.input.description,/^## Existing\n- Preserve this\n\n---\n\nRetry payment/);
  assert.equal(body.variables.input.title,undefined);
  assert.equal(h.calls.length,1);
  assert.ok(body.query.startsWith('mutation'));
  assert.equal((await h.call({type:'update',issueId:'ENG-12',append:true,replaceDescription:true,ticket})).ok,false);
  assert.equal(h.calls.length,1);
});

test('lists scoped tickets newest first and forwards search and pagination as variables', async () => {
  const h=harness(async(_url,options)=>{
    const request=JSON.parse(options.body);
    assert.equal(request.variables.filter.team.id.eq,'fixed-team');
    assert.equal(request.variables.filter.or[0].title.containsIgnoreCase,'checkout');
    assert.equal(request.variables.after,'next-page');
    assert.match(request.query,/orderBy: createdAt/);
    return {ok:true,status:200,json:async()=>({data:{issues:{nodes:[
      {identifier:'ENG-1',title:'Old',createdAt:'2026-01-01T00:00:00Z',url:'https://linear.app/x/issue/ENG-1',team:{id:'fixed-team'}},
      {identifier:'ENG-2',title:'New',createdAt:'2026-02-01T00:00:00Z',url:'https://linear.app/x/issue/ENG-2',team:{id:'fixed-team'}}
    ],pageInfo:{hasNextPage:true,endCursor:'page-two'}}}})};
  });
  const result=await h.call({type:'listIssues',search:'checkout',after:'next-page',teamId:'foreign'});
  assert.equal(result.ok,true);
  assert.equal(result.issues[0].identifier,'ENG-2');
  assert.equal(result.pageInfo.endCursor,'page-two');
  assert.doesNotMatch(JSON.stringify(result),/lin_api|description/);
});
test('rejects foreign ticket bodies and cross-team issue ID searches', async () => {
  const h=harness(async()=>({ok:true,status:200,json:async()=>({data:{issue:{identifier:'ENG-1',title:'Foreign',description:'secret',url:'https://linear.app/x/issue/ENG-1',team:{id:'other'}}}})}));
  assert.equal((await h.call({type:'getIssue',issueId:'ENG-1'})).ok,false);
  assert.equal((await h.call({type:'listIssues',search:'OTHER-1'})).ok,false);
  assert.equal(h.calls.length,1);
});
test('changed selected tickets stop before any update mutation', async () => {
  const h=harness(async()=>({ok:true,status:200,json:async()=>({data:{issue:{identifier:'ENG-1',title:'Changed',description:'New edits',updatedAt:'new',url:'https://linear.app/x/issue/ENG-1',team:{id:'fixed-team'}}}})}));
  const result=await h.call({type:'update',issueId:'ENG-1',replaceDescription:true,expectedUpdatedAt:'old',ticket});
  assert.equal(result.ok,false);
  assert.match(result.error,/changed in Linear/);
  assert.equal(h.calls.length,1);
  assert.ok(JSON.parse(h.calls[0].body).query.startsWith('query'));
});
test('only extension settings can save prompt templates', async () => {
  const h=harness(async()=>success);
  assert.equal((await h.call({type:'savePrompts',prompts:{create:'A',update:'B'}})).ok,false);
  const options={url:'chrome-extension://test/options.html'};
  assert.equal((await h.call({type:'savePrompts',prompts:{create:'Topic: {{topic}}',update:'{{issueDescription}}'}},options)).ok,true);
  assert.equal((await h.call({type:'getPrompts'})).prompts.create,'Topic: {{topic}}');
  assert.equal((await h.call({type:'savePrompts',prompts:{create:'',update:'B'}},options)).ok,false);
});

function metadataResult(){return {ok:true,status:200,json:async()=>({data:{team:{id:'fixed-team',states:{nodes:[{id:'backlog',name:'Backlog',type:'backlog',position:0},{id:'started',name:'In Progress',type:'started',position:1}]},members:{nodes:[{id:'member-1',name:'Alex',active:true}],pageInfo:{hasNextPage:false}}}}})};}
test('validates statuses and assignees against the configured team before writing',async()=>{
  const h=harness(async(_url,options)=>JSON.parse(options.body).query.includes('team(id:') ? metadataResult() : success);
  const result=await h.call({type:'create',ticket,stateId:'backlog',assigneeId:'member-1'});
  assert.equal(result.ok,true);
  const input=JSON.parse(h.calls.at(-1).body).variables.input;
  assert.equal(input.stateId,'backlog');assert.equal(input.assigneeId,'member-1');
  const count=h.calls.length;
  assert.equal((await h.call({type:'create',ticket,stateId:'foreign-state'})).ok,false);
  assert.equal((await h.call({type:'create',ticket,assigneeId:'foreign-user'})).ok,false);
  assert.equal(h.calls.length,count);
});
test('saved defaults apply to creation while updates preserve omitted properties',async()=>{
  const h=harness(async(_url,options)=>{
    const q=JSON.parse(options.body).query;
    if(q.includes('team(id:')) return metadataResult();
    return q.includes('issueUpdate') ? {ok:true,status:200,json:async()=>({data:{issueUpdate:{success:true,issue:{identifier:'ENG-1',url:'https://linear.app/example/issue/ENG-1'}}}})} : success;
  });
  const options={url:'chrome-extension://test/options.html'};
  assert.equal((await h.call({type:'saveIssueDefaults',stateId:'backlog',assigneeId:'member-1'},options)).ok,true);
  assert.equal((await h.call({type:'saveIssueDefaults',stateId:'started'})).ok,false);
  await h.call({type:'create',ticket});
  assert.equal(JSON.parse(h.calls.at(-1).body).variables.input.assigneeId,'member-1');
  await h.call({type:'update',issueId:'ENG-1',replaceDescription:true,ticket});
  const input=JSON.parse(h.calls.at(-1).body).variables.input;
  assert.equal(input.stateId,undefined);assert.equal(input.assigneeId,undefined);
});
test('exact-title update matching is team-scoped',async()=>{
  const h=harness(async(_url,options)=>{
    const variables=JSON.parse(options.body).variables;
    assert.equal(variables.filter.team.id.eq,'fixed-team');
    assert.equal(variables.filter.title.eq,'Feature - Improve layout');
    return {ok:true,status:200,json:async()=>({data:{issues:{nodes:[{identifier:'ENG-12',title:'Feature - Improve layout',url:'https://linear.app/example/issue/ENG-12',team:{id:'fixed-team'}}]}}})};
  });
  const result=await h.call({type:'findMatchingIssues',title:'Feature - Improve layout'});
  assert.equal(result.issues[0].identifier,'ENG-12');
});

test('OAuth is settings-only, keeps tokens private, and binds the saved team to Linear results', async () => {
  const team={id:'00000000-0000-4000-8000-000000000001',name:'Personal team',key:'NIS'};
  let authorized=0;
  const h=harness(async(_url,options)=>JSON.parse(options.body).query.includes('organization { name }') ? {
    ok:true,status:200,json:async()=>({data:{organization:{name:'Personal'},teams:{nodes:[team],pageInfo:{hasNextPage:false}}}})
  } : success,{
    authorize:async()=>{authorized++;return {accessToken:'private-access',refreshToken:'private-refresh',expiresAt:Date.now()+3600000};},
    accessToken:async()=> 'private-access',revoke:async()=>true
  });
  assert.equal((await h.call({type:'oauthConnect'})).ok,false);
  assert.equal(authorized,0);
  const sender={url:'chrome-extension://test/options.html'};
  const result=await h.call({type:'oauthConnect'},sender);
  assert.equal(result.ok,true);
  assert.doesNotMatch(JSON.stringify(result),/private-access|private-refresh/);
  assert.equal(h.data.config.key,'lin_api_TEST','A pending login does not replace the current connection');
  assert.equal((await h.call({type:'oauthSelectTeam',candidateId:result.candidateId,teamId:'foreign-team'},sender)).ok,false);
  const saved=await h.call({type:'oauthSelectTeam',candidateId:result.candidateId,teamId:team.id},sender);
  assert.equal(saved.connected,true);assert.equal(saved.authType,'oauth');
  assert.doesNotMatch(JSON.stringify(saved),/private-access|private-refresh/);
  assert.equal(h.data.config.key,'oauth');assert.equal(h.data.linearOAuth.refreshToken,'private-refresh');
  const created=await h.call({type:'create',ticket});assert.equal(created.ok,true);
  assert.equal(h.calls.at(-1).headers.Authorization,'Bearer private-access');
  const disconnected=await h.call({type:'disconnect'},sender);assert.equal(disconnected.ok,true);assert.equal(h.data.linearOAuth,undefined);
});
