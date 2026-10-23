const $ = id => document.getElementById(id);
async function message(payload) {
  const result = await chrome.runtime.sendMessage(payload);
  if (!result?.ok) throw new Error(result?.error || 'The extension is unavailable. Reload this page.');
  return result;
}
function showConfig(config) {
  $('current').hidden = !config.connected;
  $('destination').textContent = `${config.workspaceName} / ${config.teamName}`;
  if (config.connected) {
    $('workspace').value = config.workspaceName;
    $('team-name').value = config.teamName;
    $('team-key').value = config.teamKey;
    $('team-id').value = config.teamId;
  }
}
message({ type: 'status' }).then(showConfig).catch(err => $('status').textContent = err.message);
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('connect').disabled = true;
  try {
    const result = await message({ type: 'connect', key: $('key').value, workspaceName: $('workspace').value, teamName: $('team-name').value, teamKey: $('team-key').value, teamId: $('team-id').value });
    $('key').value = '';
    showConfig(result);
    $('status').textContent = 'Saved. Return to Meet. The key is verified by Linear when you send a ticket.';
  } catch (err) { $('status').textContent = err.message; }
  finally { $('connect').disabled = false; }
});
$('disconnect').addEventListener('click', async () => {
  try {
    await message({ type: 'disconnect' });
    showConfig({ connected: false });
    $('status').textContent = 'Disconnected. You can revoke the key in Linear settings.';
  } catch (err) { $('status').textContent = err.message; }
});

message({type:'getPrompts'}).then(({prompts})=>{
  $('create-prompt').value=prompts.create;
  $('update-prompt').value=prompts.update;
}).catch(error=>$('prompts-status').textContent=error.message);
$('preset-create').addEventListener('click',()=>{ $('create-prompt').value=ThreadportPrompts.defaults.create; $('prompts-status').textContent='Ticket preset filled. Save to apply.'; });
$('preset-update').addEventListener('click',()=>{ $('update-prompt').value=ThreadportPrompts.defaults.update; $('prompts-status').textContent='Update preset filled. Save to apply.'; });
$('prompts-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try {await message({type:'savePrompts',prompts:{create:$('create-prompt').value,update:$('update-prompt').value}});$('prompts-status').textContent='Prompt templates saved.';}
  catch(error){$('prompts-status').textContent=error.message;}
});
