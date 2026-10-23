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
      globalThis.testRequests=[]; globalThis.testReadRequests=[];
      globalThis.fetch=async(url,options)=>{
        const body=JSON.parse(options.body);
        if (body.query.startsWith('query')) {
          globalThis.testReadRequests.push(body);
          const issue={identifier:'ENG-42',title:'Checkout - Fix payment retries',description:'## Existing requirements\n- Preserve payment checks.',createdAt:'2026-10-23T10:00:00Z',updatedAt:'2026-10-23T11:00:00Z',url:'https://linear.app/example/issue/ENG-42',team:{id:'00000000-0000-4000-8000-000000000001'}};
          let data;
          if(body.query.includes('issues(')){
            const newer={...issue,identifier:'ENG-43',title:'Checkout - Improve receipts',url:'https://linear.app/example/issue/ENG-43',createdAt:'2026-10-24T10:00:00Z'};
            data={issues:{nodes:body.variables.filter.or ? [issue] : [issue,newer],pageInfo:{hasNextPage:false,endCursor:null}}};
          } else data={issue};
          return new Response(JSON.stringify({data}),{status:200,headers:{'Content-Type':'application/json'}});
        }
        globalThis.testRequests.push(body);
        const action=body.query.includes('issueUpdate')?'issueUpdate':'issueCreate';
        return new Response(JSON.stringify({data:{[action]:{success:true,issue:{identifier:'ENG-42',url:'https://linear.app/example/issue/ENG-42'}}}}),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });
    const page=await context.newPage();
    page.on('pageerror',err=>errors.push(err.message));
    // Open shadow roots in this test only so Playwright can inspect the UI.
    await page.addInitScript(()=>{const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};});
    await page.route('https://meet.google.com/**',route=>route.fulfill({contentType:'text/html',body:fixture}));
    await page.goto('https://meet.google.com/rap-aqpk-umc');
    const answer=page.locator('[data-generation-index="1"]');
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Send to Linear ↗',exact:true}).count(),2); // two message controls; global fallback is hidden
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
    await page.getByRole('button',{name:'Create ticket ↗',exact:true}).click();
    await page.getByText('Created:',{exact:false}).waitFor();
    let requests=await worker.evaluate(()=>testRequests);
    assert.equal(requests.length,1);
    assert.equal(requests[0].variables.input.title,'Checkout - Fix payment retries');
    assert.match(requests[0].variables.input.description,/No duplicate charges/);
    assert.doesNotMatch(requests[0].variables.input.description,/Draft a ticket/);
    await answer.getByRole('button',{name:'Send to Linear ↗',exact:true}).click();
    await page.locator('#mode').selectOption('create');
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
    await page.locator('#mode').selectOption('append');
    await page.locator('#issue-id').fill('ENG-42');
    await page.locator('#existing-description').fill('## Existing requirements\n- Keep this requirement.');
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
    // The key cannot be read by the content script's isolated world.
    assert.deepEqual(errors,[]);
    console.log('PASS: popup before writes, create/replace/append, JSON field separation, Markdown, prompt templates, 320/390px menu-aligned floating layout and footer rerender, duplicate protection, and no scripted sends. No real Linear calls.');
  } finally { await context.close(); fs.rmSync(profile,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
