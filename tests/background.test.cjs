const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto').webcrypto;
const core = require('../core.js');

function harness(fetchImpl) {
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
    crypto, URL, TextEncoder, AbortSignal, MeetLinearCore:core, console
  });
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'),'utf8').replace("import './core.js';",''),context);
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
