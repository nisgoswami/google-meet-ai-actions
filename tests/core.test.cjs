const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

test('extracts the actual Gemini sample into title and description', () => {
  assert.deepEqual(core.parseTicket('Title: Meet to Linear connection test\n\nDescription: Verifying a browser button can transfer this draft to Linear.'), {
    title: 'Meet to Linear connection test', description: 'Verifying a browser button can transfer this draft to Linear.'
  });
});
test('supports bold labels, Markdown headings, and JSON output', () => {
  assert.deepEqual(core.parseTicket('**Title:** Fix checkout\n**Description:** Keep **emphasis**.'), {title:'Fix checkout',description:'Keep **emphasis**.'});
  assert.deepEqual(core.parseTicket('# Fix checkout\n\n## Acceptance criteria\n- Retry succeeds'), {title:'Fix checkout',description:'## Acceptance criteria\n- Retry succeeds'});
  assert.deepEqual(core.parseTicket('```json\n{"title":"A","description":"B"}\n```'), {title:'A',description:'B'});
});
test('never silently truncates large titles or descriptions', () => {
  assert.throws(() => core.parseTicket('x'.repeat(251)), /250/);
  assert.throws(() => core.parseTicket('x'.repeat(50001)), /50,000/);
  assert.throws(() => core.parseTicket(''), /draft/);
});
test('canonicalizes observed Meet URL and removes tracking parameters', () => {
  assert.equal(core.meetingUrl('https://meet.google.com/meet/rap-aqpk-umc?authuser=0'), 'https://meet.google.com/rap-aqpk-umc');
  assert.equal(core.meetingUrl('https://meet.google.com/rap-aqpk-umc'), 'https://meet.google.com/rap-aqpk-umc');
  assert.equal(core.meetingUrl('https://meet.google.com/home'), '');
  assert.equal(core.meetingUrl('https://meet.google.com.evil.test/rap-aqpk-umc'), '');
});

test('recognizes generated updates without losing their Markdown body', () => {
  assert.deepEqual(core.parseTicket('Issue ID: ENG-42\nTitle: Fix checkout\nDescription:\n## Requirements\n- Keep **formatting**'), {title:'Fix checkout', description:'## Requirements\n- Keep **formatting**', issueId:'ENG-42'});
});

test('separates glued description headings and structured JSON update fields', () => {
  const draft = core.parseTicket('Title: Instagram Review - Match native previews\n\nDescription:## Context\nActual details');
  assert.equal(draft.description, '## Context\nActual details');
  const escaped = core.parseTicket('Title: Feature - Fix bug\nDescription:\\#\\# Summary\nActual details');
  assert.equal(escaped.description, '## Summary\nActual details');
  assert.deepEqual(core.parseTicket(JSON.stringify({title:'Feature - Fix bug',description:'## Summary\nDetails',issueId:'eng-42'})), {title:'Feature - Fix bug',description:'## Summary\nDetails',issueId:'ENG-42'});
});
