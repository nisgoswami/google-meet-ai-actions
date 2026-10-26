const {test} = require('node:test');
const assert = require('node:assert/strict');
const config = {token:'test-token',publisherId:'publisher',extensionId:'bhpafemdklaoobpenkfnhbdabahinfbm',version:'1.4.1'};

function api(responses) {
  const calls = [];
  return { calls, deps: {
    fetchImpl: async (url, options) => {
      calls.push({url,...options});
      assert.ok(responses.length, 'No unexpected API requests');
      return new Response(JSON.stringify(responses.shift()), {status:200});
    },
    sleep: async () => {}, readZip: async () => Buffer.from('test-zip')
  }};
}

test('manual verification only reads store status', async () => {
  const {publishStore} = await import('../scripts/publish-store.mjs');
  const mock = api([{submittedItemRevisionStatus:{state:'PENDING_REVIEW'}}]);
  assert.equal((await publishStore({...config,verify:true}, mock.deps)).mode, 'verify');
  assert.equal(mock.calls.length, 1);
  assert.ok(mock.calls[0].url.endsWith(':fetchStatus'));
});
test('publishing polls uploads before submitting for review', async () => {
  const {publishStore} = await import('../scripts/publish-store.mjs');
  const mock = api([{}, {uploadState:'IN_PROGRESS'}, {lastAsyncUploadState:'SUCCEEDED'}, {state:'PENDING_REVIEW'}]);
  assert.equal((await publishStore(config, mock.deps)).state, 'PENDING_REVIEW');
  assert.match(mock.calls[1].url, /\/upload\/v2\/.+:upload$/);
  assert.deepEqual(JSON.parse(mock.calls[3].body), {publishType:'DEFAULT_PUBLISH',skipReview:false,blockOnWarnings:true});
});
test('pending review blocks another upload; same-version retries are idempotent', async () => {
  const {publishStore} = await import('../scripts/publish-store.mjs');
  const mock = api([{submittedItemRevisionStatus:{state:'PENDING_REVIEW',distributionChannels:[{crxVersion:'1.4.0'}]}}]);
  await assert.rejects(publishStore(config,mock.deps), /Another store submission/);
  assert.equal(mock.calls.length,1);
  const retry = api([{submittedItemRevisionStatus:{state:'PENDING_REVIEW',distributionChannels:[{crxVersion:config.version}]}}]);
  assert.equal((await publishStore(config,retry.deps)).mode,'already-submitted');
  assert.equal(retry.calls.length,1);
});
test('failed uploads never send a publish request', async () => {
  const {publishStore} = await import('../scripts/publish-store.mjs');
  const mock = api([{}, {uploadState:'FAILED'}]);
  await assert.rejects(publishStore(config,mock.deps), /No publish request sent/);
  assert.equal(mock.calls.length,2);
});
