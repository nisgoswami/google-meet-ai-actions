import { readFile } from 'node:fs/promises';

const json = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
const [manifest, pkg, lock] = await Promise.all(['manifest.json', 'package.json', 'package-lock.json'].map(json));
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version) || pkg.version !== version || lock.version !== version || lock.packages[''].version !== version) {
  throw new Error('Manifest, package, and lockfile versions must match.');
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error(`Release tag must be v${version}.`);
}
console.log(`Release version: ${version}`);
