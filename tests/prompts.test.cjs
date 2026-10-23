const {test}=require('node:test');
const assert=require('node:assert/strict');
const prompts=require('../prompts.js');
test('templates focus on call changes and substitute ticket data without evaluating or expanding it',()=>{
  assert.match(prompts.defaults.create,/changes and decisions actually discussed in this call/);
  assert.match(prompts.defaults.update,/Preserve requirements/);
  assert.equal(prompts.render('Topic {{topic}}; body {{issueDescription}}',{topic:'Checkout',issueDescription:'Keep {{topic}} literally'}),'Topic Checkout; body Keep {{topic}} literally');
});
