const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
// Use an installed Playwright, or set PLAYWRIGHT_PATH to its module entry.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const sourcePath = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'meetline-test-'));
const extensionPath = path.join(profile,'extension');
fs.cpSync(sourcePath,extensionPath,{recursive:true,filter:p=>!p.includes('/node_modules')&&!p.includes('/.git')&&!p.includes('/dist')});
// Relax only shadow visibility in the disposable test copy, never production.
const contentPath=path.join(extensionPath,'content.js');
fs.writeFileSync(contentPath,fs.readFileSync(contentPath,'utf8').replaceAll("mode: 'closed'","mode: 'open'"));
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#161718;color:#eee;font:15px/1.6 Arial}aside{position:absolute;left:12px;top:12px;width:390px;height:730px;background:#202124;padding:16px;box-sizing:border-box}header{font-size:20px} .bubble{margin:20px 0 16px 80px;background:#303134;border-radius:12px;padding:14px;font-weight:400} .pA4Vnf{margin:16px 0 4px;white-space:pre-line}footer{position:absolute;bottom:16px;left:16px;right:16px;background:#141414;border-radius:10px;padding:16px}[contenteditable]{min-height:40px}.native-actions{display:flex;gap:8px;align-items:center;height:32px}.native-actions button{width:32px;height:32px}.spark{margin-right:auto;width:20px}.messages{max-height:510px;overflow:auto}.copy{color:#aaa;margin-top:12px}
</style></head><body><aside data-feed-title="A meeting conversation" data-msl-viewport="true"><header>Gemini</header><div class="messages" role="list"><div role="listitem"><div class="bubble" role="heading"><span jsname="DPm3Gf">Draft a ticket for fixing checkout retries.</span></div></div><div role="listitem" data-generation-index="1"><div class="pA4Vnf">Title: Checkout - Fix payment retries\n\nDescription: Retry failed payments once.\n\nAcceptance criteria:\n- No duplicate charges.</div><div class="copy">Copy · Report</div></div></div><div class="suggestions"><button>Summarize the discussion so far</button><button>What was discussed in the last two minutes?</button></div><footer><div contenteditable="true" aria-label="Ask Gemini" role="combobox">Ask Gemini</div><div class="native-actions"><span class="spark">✦</span><button aria-label="More actions" aria-expanded="false">⋮</button><button aria-label="Submit">↑</button></div></footer></aside></body></html>`;
(async()=>{
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true,
    ignoreDefaultArgs:['--disable-extensions'],
    args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`],
    viewport:{width:1280,height:900}
  });
  try {
    const errors=[];
    let worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id=worker.url().split('/')[2];
    const setup=await context.newPage();
    await setup.goto(`chrome-extension://${id}/options.html`);
    setup.on('pageerror',err=>errors.push(err.message));
    await setup.getByText('Bring your own API key',{exact:true}).click();
    await setup.locator('#key').fill('lin_api_TEST');
    await setup.locator('#workspace').fill('Example');
    await setup.locator('#team-name').fill('Engineering');
    await setup.locator('#team-key').fill('ENG');
    await setup.locator('#team-id').fill('00000000-0000-4000-8000-000000000001');
    await setup.getByRole('button',{name:'Save connection',exact:true}).click();
    await setup.getByText('Saved. Return to Meet.',{exact:false}).waitFor();
    await setup.locator('#create-prompt').waitFor();
    await setup.getByRole('button',{name:'Fill ticket preset',exact:true}).click();
    await setup.locator('#create-prompt').fill((await setup.locator('#create-prompt').inputValue())+'\nCustom instruction: keep the ticket focused.');
    await setup.getByRole('button',{name:'Save prompt templates',exact:true}).click();
    await setup.getByText('Prompt templates saved.',{exact:true}).waitFor();
    await setup.reload();
    assert.match(await setup.locator('#create-prompt').inputValue(),/Custom instruction/);
    await worker.evaluate(()=>{
      globalThis.testRequests=[]; globalThis.testReadRequests=[]; globalThis.testOAuthRequests=[];
      chrome.identity.launchWebAuthFlow=async ({url}) => {
        const authorization = new URL(url);
        const callback = new URL(authorization.searchParams.get('redirect_uri'));
        callback.searchParams.set('state',authorization.searchParams.get('state'));
        callback.searchParams.set('code','TEST_CODE');
        return callback.href;
      };
      globalThis.fetch=async(url,options)=>{
        if(url.includes('/oauth/')) {
          const form=Object.fromEntries(new URLSearchParams(options.body));
          globalThis.testOAuthRequests.push({url,form});
          return new Response(JSON.stringify(url.endsWith('/token') ? {access_token:'TEST_ACCESS',refresh_token:'TEST_REFRESH',token_type:'Bearer',expires_in:3600} : {}),{status:200,headers:{'Content-Type':'application/json'}});
        }
        const body=JSON.parse(options.body);
        if (body.query.startsWith('query')) {
          globalThis.testReadRequests.push(body);
          const issue={identifier:'ENG-42',title:'Checkout - Fix payment retries',description:'## Existing requirements\n- Preserve payment checks.',createdAt:'2026-10-23T10:00:00Z',updatedAt:'2026-10-23T11:00:00Z',url:'https://linear.app/example/issue/ENG-42',team:{id:'00000000-0000-4000-8000-000000000001'}};
          let data;
          if(body.query.includes('organization { name }')) {
            data={organization:{name:'Personal test workspace'},teams:{nodes:[{id:'00000000-0000-4000-8000-000000000001',name:'Personal team',key:'ENG'}],pageInfo:{hasNextPage:false}}};
          } else if(body.query.includes('team(id:')) {
            data={team:{id:'00000000-0000-4000-8000-000000000001',states:{nodes:[{id:'backlog',name:'Backlog',type:'backlog',position:0},{id:'started',name:'In Progress',type:'started',position:1}]},members:{nodes:[{id:'member-1',name:'Alex',displayName:'Alex',active:true},{id:'member-2',name:'Sam',displayName:'Sam',active:true}],pageInfo:{hasNextPage:false,endCursor:null}}}};
          } else if(body.query.includes('issues(')){
            const newer={...issue,identifier:'ENG-43',title:'Checkout - Improve receipts',url:'https://linear.app/example/issue/ENG-43',createdAt:'2026-10-24T10:00:00Z'};
            data={issues:{nodes:body.variables.filter.title ? body.variables.filter.title.eq==='Matched Feature - Update requirements' ? [issue] : [] : body.variables.filter.or ? [issue] : [issue,newer],pageInfo:{hasNextPage:false,endCursor:null}}};
          } else data={issue};
          return new Response(JSON.stringify({data}),{status:200,headers:{'Content-Type':'application/json'}});
        }
        globalThis.testRequests.push(body);
        const action=body.query.includes('issueUpdate')?'issueUpdate':'issueCreate';
        return new Response(JSON.stringify({data:{[action]:{success:true,issue:{identifier:'ENG-42',url:'https://linear.app/example/issue/ENG-42'}}}}),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });
    await setup.getByRole('button',{name:'Load team statuses and people',exact:true}).click();
    await setup.getByText('Team options loaded.',{exact:true}).waitFor();
    await setup.locator('#default-state').selectOption('backlog');
    await setup.locator('#default-assignee').selectOption('member-1');
    await setup.getByRole('button',{name:'Save ticket defaults',exact:true}).click();
    await setup.getByText('Ticket defaults saved.',{exact:true}).waitFor();
    const page=await context.newPage();
    page.on('pageerror',err=>errors.push(err.message));
    // Open shadow roots in this test only so Playwright can inspect the UI.
    await page.addInitScript(()=>{const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};});
    await page.route('https://meet.google.com/**',route=>route.fulfill({contentType:'text/html',body:fixture}));
    await page.goto('https://meet.google.com/rap-aqpk-umc');
    const answer=page.locator('[data-generation-index="1"]');
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Send to Linear ↗',exact:true}).count(),2); // two message controls; global fallback is hidden
    // Loading can temporarily remove the composer while keeping the conversation.
    // Controls on existing messages must retain their DOM identity throughout.
    await page.evaluate(() => {
      window.loadingControls = Array.from(document.querySelectorAll('.meet-linear-message'));
      window.savedFooter = document.querySelector('footer');
      window.savedFooter.remove();
    });
    await page.locator('#threadport-prompts').waitFor({state:'hidden'});
    for (let frame = 0; frame < 3; frame++) {
      await page.evaluate(frame => {
        const response = document.querySelector('.pA4Vnf');
        response.setAttribute('aria-busy', 'true');
        response.dataset.loadingFrame = frame;
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, frame);
      assert.equal(await page.evaluate(() => window.loadingControls.every(el => el.isConnected)), true, 'Loading must retain existing message controls');
    }
    await page.evaluate(() => {
      document.querySelector('.pA4Vnf').removeAttribute('aria-busy');
      document.querySelector('aside').append(window.savedFooter);
    });
    await page.getByRole('button',{name:'Ask for ticket',exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.loadingControls.every(el => el.isConnected)), true);
    for (const width of [390, 320]) {
      await page.locator('aside').evaluate((el, width) => el.style.width = width + 'px', width);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const prompts = await page.locator('#threadport-prompts').boundingBox();
      const inputBox = await page.locator('[aria-label="Ask Gemini"]').boundingBox();
      const menu = await page.getByRole('button',{name:'More actions',exact:true}).boundingBox();
      const spark = await page.locator('.spark').boundingBox();
      assert.ok(Math.abs(prompts.y + prompts.height / 2 - menu.y - menu.height / 2) < 2, 'Prompt row must align with three dots');
      assert.ok(prompts.x + prompts.width <= menu.x - 7, 'Prompt row must leave the menu uncovered');
      assert.ok(prompts.x >= spark.x + spark.width, 'Prompt row must leave Gemini icon uncovered');
      assert.ok(prompts.y >= inputBox.y + inputBox.height, 'Prompt row belongs below the text entry');
      assert.equal(await page.locator('#threadport-prompts').evaluate(el => getComputedStyle(el).position), 'fixed');
    }
    await page.locator('aside').evaluate(el => el.style.width = '390px');
    await page.getByRole('button',{name:'More actions',exact:true}).evaluate(el => el.setAttribute('aria-expanded','true'));
    await page.locator('#threadport-prompts').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'More actions',exact:true}).evaluate(el => el.setAttribute('aria-expanded','false'));
    await page.getByRole('button',{name:'Ask for ticket',exact:true}).waitFor();
    await page.locator('footer').evaluate(el => el.outerHTML = el.outerHTML);
    await page.getByRole('button',{name:'Ask for ticket',exact:true}).waitFor();
    await page.screenshot({path:path.join(sourcePath,'preview.png')});
    // Scripted events must never send user data.
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).evaluate(el=>el.click());
    assert.equal(await worker.evaluate(()=>testRequests.length),0);
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    assert.equal(await worker.evaluate(()=>testRequests.length),0);
    await page.locator('#mode').selectOption('create');
    await page.getByText('Defaults apply to new tickets.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Create ticket ↗',exact:true}).click();
    await page.getByText('Created:',{exact:false}).waitFor();
    let requests=await worker.evaluate(()=>testRequests);
    assert.equal(requests.length,1);
    assert.equal(requests[0].variables.input.title,'Checkout - Fix payment retries');
    assert.equal(requests[0].variables.input.stateId,'backlog');
    assert.equal(requests[0].variables.input.assigneeId,'member-1');
    assert.match(requests[0].variables.input.description,/No duplicate charges/);
    assert.doesNotMatch(requests[0].variables.input.description,/Draft a ticket/);
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    await page.locator('#mode').selectOption('create');
    await page.getByText('Defaults apply to new tickets.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Create ticket ↗',exact:true}).click();
    await page.getByText('Already sent:',{exact:false}).waitFor();
    assert.equal(await worker.evaluate(()=>testRequests.length),1);
    await answer.getByRole('button',{name:'Review',exact:true}).click();
    await page.locator('#mode').selectOption('update');
    await page.locator('#issue-id').fill('ENG-42');
    await page.locator('#description').fill('Revised acceptance criteria.');
    await page.screenshot({path:path.join(sourcePath,'preview-review.png')});
    await page.getByRole('button',{name:'Replace selected fields ↗',exact:true}).click();
    await page.getByText('Updated:',{exact:false}).waitFor();
    requests=await worker.evaluate(()=>testRequests);
    assert.equal(requests[1].variables.id,'ENG-42');
    assert.equal(requests[1].variables.input.title,undefined);
    assert.equal(requests[1].variables.input.stateId,undefined);
    assert.equal(requests[1].variables.input.assigneeId,undefined);
    assert.match(requests[1].variables.input.description,/Revised acceptance/);
    // Re-rendering a card, and changing Gemini's conversation title, retains controls.
    await page.locator('[data-generation-index="1"] .pA4Vnf').evaluate(el=>el.outerHTML='<div class="pA4Vnf">Title: A new draft\nDescription: New details</div>');
    await answer.getByRole('button',{name:'Review',exact:true}).click();
    assert.equal(await page.locator('#title').inputValue(),'A new draft');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    // Rich Gemini output retains Markdown in the issue body.
    await answer.locator('.pA4Vnf').evaluate(el => el.innerHTML = '<h2>Title: Format ticket</h2><p><strong>Description:</strong></p><h3>Requirements</h3><ul><li>Keep <strong>bold</strong> text<ul><li>Nested item</li></ul></li></ul><p><a href="https://example.com/spec">Specification</a></p>');
    await answer.getByRole('button',{name:'Review',exact:true}).click();
    assert.equal(await page.locator('#title').inputValue(), 'Format ticket');
    const formatted = await page.locator('#description').inputValue();
    assert.match(formatted, /### Requirements/);
    assert.match(formatted, /- +Keep \*\*bold\*\*/);
    assert.match(formatted, /\[Specification\]\(https:\/\/example.com\/spec\)/);
    assert.match(formatted, / {2,}- +Nested item/);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    // Structured updates require review and never create a new issue by mistake.
    await answer.locator('.pA4Vnf').evaluate(el => el.textContent = 'Issue ID: ENG-42\nTitle: Existing issue\nDescription: Updated requirements');
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    assert.equal(await page.locator('#mode').inputValue(), 'update');
    assert.equal(await page.locator('#issue-id').inputValue(), 'ENG-42');
    assert.equal(await worker.evaluate(()=>testRequests.length), 2);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    const composer = page.locator('[aria-label="Ask Gemini"]');
    await composer.fill('Focus on checkout');
    await page.getByRole('button',{name:'Ask for ticket',exact:true}).click();
    // Simulate Meet shortcuts that see a shadow host rather than an input.
    // Real keystrokes exercise default text insertion; fill() would miss this bug.
    await page.evaluate(() => {
      window.testShortcutEvents = [];
      window.testMeetShortcut = event => {
        if (event.target.matches('input, textarea, [contenteditable="true"]')) return;
        window.testShortcutEvents.push(event.type + ':' + event.key);
        if (event.key.toLowerCase() === 'c') event.preventDefault();
      };
      for (const type of ['keydown', 'keypress', 'keyup']) document.addEventListener(type, window.testMeetShortcut);
    });
    await page.locator('#new-topic').fill('');
    await page.locator('#new-topic').pressSequentially('Checkout Screen cC');
    await page.locator('#new-topic').press('ArrowLeft');
    await page.locator('#new-topic').press('Backspace');
    assert.equal(await page.locator('#new-topic').inputValue(), 'Checkout Screen C');
    assert.deepEqual(await page.evaluate(() => window.testShortcutEvents), []);
    await page.locator('#new-topic').press('Escape');
    await page.locator('#topic-dialog').waitFor({state:'hidden'});
    // Shortcuts outside the extension still reach the host page.
    await page.locator('body').evaluate(el => { el.tabIndex = -1; el.focus(); });
    await page.keyboard.press('ArrowLeft');
    assert.ok((await page.evaluate(() => window.testShortcutEvents.length)) > 0);
    await page.evaluate(() => {
      for (const type of ['keydown', 'keypress', 'keyup']) document.removeEventListener(type, window.testMeetShortcut);
    });
    await composer.fill('Focus on checkout');
    await page.getByRole('button',{name:'Ask for ticket',exact:true}).click();
    await page.getByRole('button',{name:'Prepare prompt',exact:true}).click();
    assert.match(await composer.innerText(), /Page or Feature - Functionality to Improve or Bug to Fix/);
    assert.match(await composer.innerText(), /changes and decisions actually discussed in this call/);
    assert.match(await composer.innerText(), /Do not output JSON/);
    assert.match(await composer.innerText(), /Focus on checkout/);
    assert.match(await composer.innerText(), /Custom instruction/);
    await composer.fill('ENG-42 existing issue text');
    await page.getByRole('button',{name:'Ask for update',exact:true}).click();
    await page.getByRole('button',{name:'ENG-43 Checkout - Improve receipts',exact:false}).waitFor();
    const ticketButtons=page.locator('#ticket-list button');
    assert.match(await ticketButtons.first().innerText(),/^ENG-43/);
    await page.locator('#ticket-search').fill('payment');
    await page.getByRole('button',{name:'ENG-43 Checkout - Improve receipts',exact:false}).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'ENG-42 Checkout - Fix payment retries',exact:false}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="Ask Gemini"]').innerText.includes('Existing issue ID: ENG-42'));
    assert.match(await composer.innerText(), /Existing issue ID: ENG-42/);
    assert.match(await composer.innerText(), /Preserve payment checks/);
    assert.match(await composer.innerText(), /ENG-42 existing issue text/);
    assert.equal(await worker.evaluate(()=>testRequests.length), 2);
    // Append combines the explicit current body with the new details, keeping the title.
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#meet-to-linear').shadowRoot.getElementById('existing-description').value.includes('Preserve payment checks'));
    await page.locator('#mode').selectOption('append');
    await page.locator('#issue-id').fill('ENG-42');
    await page.waitForFunction(()=>document.querySelector('#meet-to-linear').shadowRoot.getElementById('existing-description').value.includes('Preserve payment checks'));
    assert.equal(await page.locator('#existing-description').getAttribute('readonly'),'');
    await page.getByRole('button',{name:'Append to ticket ↗',exact:true}).click();
    await page.getByText('Updated:',{exact:false}).waitFor();
    requests = await worker.evaluate(()=>testRequests);
    assert.equal(requests.length, 3);
    assert.match(requests[2].variables.input.description, /^## Existing requirements/);
    assert.match(requests[2].variables.input.description, /Updated requirements/);
    assert.equal(requests[2].variables.input.title, undefined);
    // JSON output goes into the correct fields without literal field labels.
    await answer.locator('.pA4Vnf').evaluate(el => { el.innerHTML = '<pre><code class="language-json"></code></pre>'; el.querySelector('code').textContent = JSON.stringify({title:'Instagram Review - Match native comment previews', description:'## Summary\nImprove preview fidelity.\n\n## Acceptance criteria\n- Matches the native layout.'}); });
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    assert.equal(await page.locator('#title').inputValue(),'Instagram Review - Match native comment previews');
    assert.match(await page.locator('#description').inputValue(), /^## Summary/);
    assert.doesNotMatch(await page.locator('#description').inputValue(), /Description:|Title:/);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    // Live Gemini JSON is often spans with BR wrappers, not a code block.
    await answer.locator('.pA4Vnf').evaluate(el => {
      const draft = {title:'Auto-Selling - Align replies inside cards', description:'## Summary\nAlign cards.\n\n## Requirements\n- Replies stay inside cards.'};
      el.replaceChildren();
      for (const line of JSON.stringify(draft, null, 2).split('\n')) {
        const span = document.createElement('span'); span.textContent = line; el.append(span);
        const gap = document.createElement('div'); gap.append(document.createElement('br')); el.append(gap);
      }
    });
    await answer.getByRole('button',{name:'Review',exact:true}).click();
    assert.equal(await page.locator('#title').inputValue(),'Auto-Selling - Align replies inside cards');
    assert.equal(await page.locator('#description').inputValue(),'## Summary\nAlign cards.\n\n## Requirements\n- Replies stay inside cards.');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    // A new Gemini response keeps the selected ticket and its freshness snapshot.
    await page.locator('.messages').evaluate(el=>el.insertAdjacentHTML('beforeend','<div role="listitem" data-generation-index="2"><div class="pA4Vnf"># Checkout - Fix payment retries\n\n## Requirements\n- Updated payment checks.</div></div>'));
    const generated=page.locator('[data-generation-index="2"]');
    await generated.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    assert.equal(await page.locator('#issue-id').inputValue(),'ENG-42');
    assert.match(await page.locator('#existing-description').inputValue(),/Preserve payment checks/);
    await page.getByRole('button',{name:'Replace selected fields ↗',exact:true}).click();
    await page.getByText('Updated:',{exact:false}).waitFor();
    assert.equal(await worker.evaluate(()=>testRequests.at(-1).variables.id),'ENG-42');
    assert.ok(await worker.evaluate(()=>testReadRequests.filter(r=>r.query.includes('issue(id:')).length>=2));
    // Live Gemini's title and section headings can be AST spans rather than headings.
    await answer.locator('.pA4Vnf').evaluate(el=>el.innerHTML='<div><span data-ast-node-id="0">Social Engagement Agent - UI Layout and Header Alignment Updates</span><div><br></div><span data-ast-node-id="1">Summary</span><div><br></div><span data-ast-node-id="2">Fix the alignment.</span><div><br></div><span data-ast-node-id="3">Requirements</span><ul><li><span data-ast-node-id="4">Align the header.</span></li></ul></div>');
    await answer.getByRole('button',{name:'Review',exact:true}).click();
    assert.equal(await page.locator('#title').inputValue(),'Social Engagement Agent - UI Layout and Header Alignment Updates');
    assert.match(await page.locator('#description').inputValue(), /^## Summary/);
    assert.match(await page.locator('#description').inputValue(), /## Requirements/);
    assert.doesNotMatch(await page.locator('#description').inputValue(), /Social Engagement Agent/);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    // Matching titles and links are detected as updates before any write.
    await answer.locator('.pA4Vnf').evaluate(el=>el.textContent='# Matched Feature - Update requirements\n\n## Summary\nNew details.');
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#meet-to-linear').shadowRoot.getElementById('issue-id').value==='ENG-42');
    assert.equal(await page.locator('#mode').inputValue(),'update');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await answer.locator('.pA4Vnf').evaluate(el=>el.textContent='# Feature - Improve layout\n\nUpdate the existing ticket https://linear.app/example/issue/ENG-42/details');
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    assert.equal(await page.locator('#issue-id').inputValue(),'ENG-42');
    assert.equal(await page.locator('#mode').inputValue(),'update');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    // Per-send status and assignee overrides reach the create mutation.
    await answer.locator('.pA4Vnf').evaluate(el=>el.textContent='# Other Feature - Improve navigation\n\n## Summary\nNew navigation work.');
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    await page.locator('#mode').selectOption('create');
    await page.getByText('Defaults apply to new tickets.',{exact:false}).waitFor();
    await page.locator('#issue-state').selectOption('started');
    await page.locator('#assignee-search').pressSequentially('sAM');
    assert.deepEqual(await page.locator('#issue-assignee option:not([hidden])').allTextContents(), ['Unassigned', 'Sam']);
    await page.locator('#issue-assignee').selectOption('member-2');
    await page.locator('#assignee-search').fill('no such person');
    await page.getByText('No matching people. Selected: Sam.', {exact:true}).waitFor();
    assert.equal(await page.locator('#issue-assignee').inputValue(), 'member-2', 'Searching must preserve the chosen assignee');
    await page.locator('#assignee-search').fill('');
    assert.deepEqual(await page.locator('#issue-assignee option:not([hidden])').allTextContents(), ['Unassigned', 'Alex', 'Sam']);
    await page.getByRole('button',{name:'Create ticket ↗',exact:true}).click();
    await page.getByText('Created:',{exact:false}).waitFor();
    const override=await worker.evaluate(()=>testRequests.at(-1).variables.input);
    assert.equal(override.stateId,'started');assert.equal(override.assigneeId,'member-2');
    // Reassignment is also sent as assigneeId on an existing issue update.
    await answer.locator('.pA4Vnf').evaluate(el => el.textContent = 'Issue ID: ENG-42\nTitle: Checkout - Fix payment retries\nDescription: Assign the follow-up.');
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    await page.getByText('Defaults apply to new tickets.',{exact:false}).waitFor();
    assert.equal(await page.locator('#assignee-search').inputValue(), '');
    await page.locator('#assignee-search').fill('alex');
    await page.locator('#issue-assignee').selectOption('member-1');
    await page.getByRole('button',{name:'Replace selected fields ↗',exact:true}).click();
    await page.getByText('Updated:',{exact:false}).waitFor();
    assert.equal(await worker.evaluate(() => testRequests.at(-1).variables.input.assigneeId), 'member-1');
    // Compact Gemini has neither a feed panel nor a footer/menu anchor.
    const writesBeforeCompact = await worker.evaluate(() => testRequests.length);
    for (const field of ['<textarea placeholder="Ask Gemini"></textarea>', '<div contenteditable="true" aria-label="Ask Gemini"></div>']) {
      await page.locator('body').evaluate((body, field) => {
        body.innerHTML = `<form style="position:fixed;left:24px;bottom:80px;width:360px;display:flex;align-items:center;background:#242424;padding:12px;border-radius:32px"><span>✦</span>${field}<button type="button" aria-label="Submit">↑</button></form>`;
        body.querySelector('textarea, [contenteditable]').style.cssText = 'box-sizing:border-box;resize:none;width:280px;height:40px;min-height:40px;border:0;background:transparent;color:white;';
      }, field);
      await page.getByRole('button',{name:'Ask for ticket',exact:true}).waitFor();
      await page.waitForFunction(() => document.querySelector('#threadport-prompts').getBoundingClientRect().top >= document.querySelector('form').getBoundingClientRect().bottom + 7);
      const prompts = await page.locator('#threadport-prompts').boundingBox();
      const form = await page.locator('form').boundingBox();
      assert.ok(prompts.y >= form.y + form.height + 7, `Compact actions sit below the composer: ${JSON.stringify({prompts, form})}`);
      assert.ok(prompts.x >= 0 && prompts.x + prompts.width <= 1280, 'Compact actions stay in the viewport');
      await page.getByRole('button',{name:'Ask for ticket',exact:true}).click();
      await page.locator('#new-topic').pressSequentially('Checkout screen');
      await page.getByRole('button',{name:'Prepare prompt',exact:true}).click();
      const compactInput = page.locator('form textarea, form [contenteditable]');
      const prompt = await compactInput.evaluate(el => el.value ?? el.innerText);
      assert.match(prompt, /Checkout screen/);
      await page.getByRole('button',{name:'Ask for update',exact:true}).click();
      await page.getByRole('button',{name:'ENG-42 Checkout - Fix payment retries',exact:false}).click();
      await page.waitForFunction(() => {
        const el = document.querySelector('form textarea, form [contenteditable]');
        return (el.value ?? el.innerText).includes('Existing issue ID: ENG-42');
      });
      // Composer near the bottom leaves space for the actions above instead.
      await page.locator('form').evaluate(el => el.style.bottom = '0px');
      await page.waitForFunction(() => document.querySelector('#threadport-prompts').getBoundingClientRect().bottom < document.querySelector('form').getBoundingClientRect().top);
    }
    await page.locator('body').evaluate(body => {
      body.innerHTML = '<button id="gemini-launcher" style="position:fixed;left:24px;bottom:80px;width:360px;height:48px">Ask Gemini</button>';
      body.querySelector('button').addEventListener('click', event => {
        event.currentTarget.outerHTML = '<form style="position:fixed;left:24px;bottom:80px;width:360px"><textarea aria-label="Ask Gemini"></textarea></form>';
      });
    });
    await page.waitForFunction(() => document.querySelector('#threadport-prompts').getBoundingClientRect().top > document.querySelector('#gemini-launcher').getBoundingClientRect().bottom);
    await page.getByRole('button',{name:'Ask for ticket',exact:true}).click();
    await page.locator('#new-topic').fill('Compact launcher');
    await page.getByRole('button',{name:'Prepare prompt',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Ask Gemini"]')?.value.includes('Compact launcher'));
    assert.equal(await worker.evaluate(() => testRequests.length), writesBeforeCompact);
    // Both connection choices remain available. OAuth stores no credentials in
    // UI responses and uses the selected API-returned team rather than a typed ID.
    const oauthSetup = await context.newPage();
    oauthSetup.on('pageerror',err=>errors.push(err.message));
    await oauthSetup.goto(`chrome-extension://${id}/options.html`);
    await oauthSetup.getByRole('button',{name:'Sign in with Linear',exact:true}).waitFor();
    await oauthSetup.getByText('Bring your own API key',{exact:true}).waitFor();
    await oauthSetup.screenshot({path:'/tmp/threadport-login-options.png'});
    await oauthSetup.getByRole('button',{name:'Sign in with Linear',exact:true}).click();
    await oauthSetup.getByText('Signed in. Choose the team to use for tickets.',{exact:true}).waitFor();
    assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('config')).config.key),'lin_api_TEST');
    await oauthSetup.locator('#oauth-team').selectOption('00000000-0000-4000-8000-000000000001');
    await oauthSetup.getByRole('button',{name:'Use this team',exact:true}).click();
    await oauthSetup.getByText('Connected with Linear login. Return to Meet.',{exact:true}).waitFor();
    const oauthStatus = await oauthSetup.evaluate(()=>chrome.runtime.sendMessage({type:'status'}));
    assert.equal(oauthStatus.authType,'oauth');assert.equal(oauthStatus.teamName,'Personal team');
    assert.doesNotMatch(JSON.stringify(oauthStatus),/TEST_ACCESS|TEST_REFRESH/);
    await worker.evaluate(async()=>{const {linearOAuth}=await chrome.storage.local.get('linearOAuth');linearOAuth.expiresAt=0;await chrome.storage.local.set({linearOAuth});});
    assert.equal((await oauthSetup.evaluate(()=>chrome.runtime.sendMessage({type:'getTeamOptions'}))).ok,true);
    const tokenRequests = await worker.evaluate(()=>testOAuthRequests);
    assert.equal(tokenRequests.length,2);assert.equal(tokenRequests[1].form.grant_type,'refresh_token');
    assert.ok(tokenRequests.every(request=>!Object.hasOwn(request.form,'client_secret')));
    await oauthSetup.getByRole('button',{name:'Disconnect',exact:true}).click();
    await oauthSetup.getByText('Disconnected. You can also manage access in Linear settings.',{exact:true}).waitFor();
    assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('linearOAuth')).linearOAuth),undefined);
    // The key cannot be read by the content script's isolated world.
    assert.deepEqual(errors,[]);
    console.log('PASS: popup before writes, create/replace/append, JSON field separation, Markdown, prompt templates, compact composer actions, 320/390px menu-aligned floating layout and footer rerender, duplicate protection, and no scripted sends. No real Linear calls.');
  } finally { await context.close(); fs.rmSync(profile,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
