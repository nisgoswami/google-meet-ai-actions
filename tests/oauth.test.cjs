const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {webcrypto, createHash} = require('node:crypto');

function harness({callback, fetchImpl, stored} = {}) {
  const data = stored || {};
  const calls = []; let authorization;
  const redirect = 'https://bhpafemdklaoobpenkfnhbdabahinfbm.chromiumapp.org/linear';
  const context = vm.createContext({
    crypto:webcrypto, URL, URLSearchParams, TextEncoder, AbortSignal, btoa,
    LinearOAuthConfig:{clientId:'public-client'},
    chrome:{
      identity:{getRedirectURL:() => redirect,launchWebAuthFlow:async options => {
        authorization = new URL(options.url);
        return callback ? callback(authorization,redirect) : `${redirect}?code=test-code&state=${authorization.searchParams.get('state')}`;
      }},
      storage:{local:{get:async key => ({[key]:data[key]}),set:async values => Object.assign(data,values)}}
    },
    fetch:async (url,options) => {
      calls.push({url,...options});
      return fetchImpl ? fetchImpl(url,options) : {ok:true,json:async () => ({access_token:'access-test',refresh_token:'refresh-test',token_type:'Bearer',expires_in:3600})};
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../oauth.js'),'utf8'),context);
  return {auth:context.LinearOAuth,data,calls,get authorization(){return authorization;}};
}

test('OAuth uses S256, random state, exact callback, and no client secret',async () => {
  const h=harness();const tokens=await h.auth.authorize();
  assert.equal(tokens.accessToken,'access-test');
  assert.equal(h.authorization.searchParams.get('scope'),'read,write');
  assert.equal(h.authorization.searchParams.get('code_challenge_method'),'S256');
  assert.ok(h.authorization.searchParams.get('state').length >= 43);
  const form=new URLSearchParams(h.calls[0].body);
  assert.equal(form.get('client_id'),'public-client');
  assert.equal(form.has('client_secret'),false);
  assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),h.authorization.searchParams.get('code_challenge'));
  assert.equal(h.calls[0].credentials,'omit');
  assert.equal(h.data.linearOAuth,undefined,'Authorization is not persisted until a team is chosen');
});

test('wrong state, callback origin, or callback path never exchange tokens',async () => {
  for(const callback of [
    (_url,redirect)=>`${redirect}?code=x&state=wrong`,
    url=>`https://evil.test/linear?code=x&state=${url.searchParams.get('state')}`,
    (url,redirect)=>`${redirect}/other?code=x&state=${url.searchParams.get('state')}`
  ]) {
    const h=harness({callback});await assert.rejects(h.auth.authorize(),/verification failed/);assert.equal(h.calls.length,0);
  }
});

test('refresh rotates tokens once for concurrent requests without a client secret',async () => {
  const h=harness({stored:{linearOAuth:{accessToken:'expired',refreshToken:'old-refresh',expiresAt:0}}});
  assert.deepEqual(await Promise.all([h.auth.accessToken(),h.auth.accessToken()]),['access-test','access-test']);
  assert.equal(h.calls.length,1);
  const form=new URLSearchParams(h.calls[0].body);
  assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('refresh_token'),'old-refresh');assert.equal(form.has('client_secret'),false);
  assert.equal(h.data.linearOAuth.refreshToken,'refresh-test');
});

test('denials and remote errors do not leak tokens or remote descriptions',async () => {
  const denied=harness({callback:(url,redirect)=>`${redirect}?error=access_denied&state=${url.searchParams.get('state')}`});
  await assert.rejects(denied.auth.authorize(),/not granted/);assert.equal(denied.calls.length,0);
  const rejected=harness({fetchImpl:async()=>({ok:false,json:async()=>({error:'secret-value'})})});
  await assert.rejects(rejected.auth.authorize(),error=>!/secret-value/.test(error.message));
});
