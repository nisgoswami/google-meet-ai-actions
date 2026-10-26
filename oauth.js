// Public-client OAuth with PKCE. No client secret or developer backend.
(() => {
  const clientId = LinearOAuthConfig.clientId;
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
  let refreshing;

  async function exchange(parameters) {
    let response;
    try {
      response = await fetch('https://api.linear.app/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, ...parameters }).toString(),
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000)
      });
    } catch { throw new Error('Could not reach Linear sign-in. Please try again.'); }
    if (!response.ok) throw new Error('Linear sign-in could not be completed. Sign in with Linear again.');
    let value;
    try { value = await response.json(); } catch { throw new Error('Linear returned an invalid sign-in response.'); }
    if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 4096 ||
        typeof value.refresh_token !== 'string' || !value.refresh_token || value.refresh_token.length > 4096 ||
        String(value.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(value.expires_in) || value.expires_in < 60) {
      throw new Error('Linear returned an invalid sign-in response.');
    }
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: Date.now() + value.expires_in * 1000 };
  }

  async function authorize() {
    if (!clientId) throw new Error('Linear login is not configured in this build. You can use your own API key.');
    const verifier = random();
    const state = random();
    const redirect = chrome.identity.getRedirectURL('linear');
    const challenge = encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const url = new URL('https://linear.app/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirect, response_type: 'code',
      scope: 'read,write', actor: 'user', state, prompt: 'consent',
      code_challenge: challenge, code_challenge_method: 'S256'
    }).toString();
    let returned;
    try { returned = await chrome.identity.launchWebAuthFlow({url: url.href, interactive: true}); }
    catch { throw new Error('Linear sign-in was cancelled or could not be completed.'); }
    let callback;
    try { callback = new URL(returned); } catch { throw new Error('Linear sign-in did not return a valid callback.'); }
    const expected = new URL(redirect);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.searchParams.get('state') !== state) {
      throw new Error('Linear sign-in verification failed. Please start again.');
    }
    const code = callback.searchParams.get('code');
    if (callback.searchParams.has('error') || !code || code.length > 2048) throw new Error('Linear access was not granted.');
    return exchange({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier });
  }

  async function accessToken() {
    const { linearOAuth } = await chrome.storage.local.get('linearOAuth');
    if (!linearOAuth?.refreshToken) throw new Error('Sign in with Linear in extension settings first.');
    if (linearOAuth.accessToken && linearOAuth.expiresAt > Date.now() + 60000) return linearOAuth.accessToken;
    if (!refreshing) {
      refreshing = (async () => {
        const next = await exchange({ grant_type: 'refresh_token', refresh_token: linearOAuth.refreshToken });
        await chrome.storage.local.set({linearOAuth: next});
        return next.accessToken;
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function revoke(tokens) {
    if (!tokens?.refreshToken) return true;
    try {
      const response = await fetch('https://api.linear.app/oauth/revoke', {
        method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'},
        body: new URLSearchParams({token:tokens.refreshToken, token_type_hint:'refresh_token', client_id:clientId}).toString(),
        credentials:'omit', redirect:'error', signal:AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch { return false; }
  }

  globalThis.LinearOAuth = {authorize, accessToken, revoke, configured: Boolean(clientId)};
})();
