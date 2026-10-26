import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function publishStore({ token, publisherId, extensionId, version, verify = false }, {
  fetchImpl = fetch, readZip = readFile, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  if (!token || !publisherId || !/^[a-p]{32}$/.test(extensionId || '')) throw new Error('Missing or invalid Chrome Web Store configuration.');
  const base = `https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(publisherId)}/items/${extensionId}`;
  async function request(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers },
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`Chrome Web Store request failed: HTTP ${response.status}. Check the API response in the developer dashboard.`);
    return response.json();
  }
  const status = await request(`${base}:fetchStatus`);
  if (verify) return { mode: 'verify', ...status };
  const revisions = [status.publishedItemRevisionStatus, status.submittedItemRevisionStatus];
  if (revisions.some(revision => !['REJECTED', 'CANCELLED'].includes(revision?.state) && revision?.distributionChannels?.some(channel => channel.crxVersion === version))) {
    return { mode: 'already-submitted', version, ...status };
  }
  if (status.submittedItemRevisionStatus && !['REJECTED', 'CANCELLED', 'PUBLISHED'].includes(status.submittedItemRevisionStatus.state)) {
    throw new Error('Another store submission exists. Resolve it in the dashboard before releasing a new version.');
  }
  const zip = await readZip(new URL(`../dist/google-meet-ai-actions-${version}.zip`, import.meta.url));
  const uploaded = await request(base.replace('/v2/', '/upload/v2/') + ':upload', {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zip
  });
  let uploadState = uploaded.uploadState;
  for (let attempt = 0; ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploadState) && attempt < 36; attempt++) {
    await sleep(5000);
    uploadState = (await request(`${base}:fetchStatus`)).lastAsyncUploadState;
  }
  if (uploadState !== 'SUCCEEDED') throw new Error(`Package upload did not succeed: ${uploadState || 'unknown state'}. No publish request sent.`);
  const result = await request(`${base}:publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true })
  });
  return { mode: 'submitted', version, ...result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const result = await publishStore({
    token: process.env.CWS_ACCESS_TOKEN, publisherId: process.env.CWS_PUBLISHER_ID,
    extensionId: process.env.CWS_EXTENSION_ID, version, verify: process.argv.includes('--verify')
  });
  console.log(JSON.stringify(result, null, 2));
}
