# Threadport

Turn conversation text into work items. The first integration adds **Send to Linear** and **Review** buttons to messages in Google Meet’s Gemini panel.

No extra AI service, transcript capture, intermediary server, or remotely loaded scripts. Formatting is converted to Markdown locally using the bundled MIT-licensed Turndown library. Gemini drafts; Threadport transfers the fields you choose.

## Try it locally

1. Download or clone the project.
2. In Chrome/Chromium, open `chrome://extensions` in the profile where you use Meet. Enable **Developer mode** and click **Load unpacked**. Choose the project directory containing `manifest.json`.
3. Open **Threadport settings** from the extension’s toolbar icon.
4. Create a Linear personal API key with **Read** and **Create issues**, restricted to the desired team, to enable the searchable update picker. Do not enable general Write, Create comments, or Admin. Read is optional for creation and manual replacement only. Linear labels this capability “Create and update issues”; it is used for both operations.
5. Enter the key, workspace name, team name, issue prefix (for example `ENG`), and team UUID, then save. In Linear’s team view, press Ctrl/Cmd+K → **Copy model UUID** → choose the **Team** entry. The key and picker remain restricted to this team.
6. Reload Meet when convenient, or start your next call. Open **Ask Gemini**.

Configuration stays in the extension’s local storage in that browser profile. The API key is checked by Linear on the first send. It is not embedded in project files.

## Create a ticket

Use **Ask for ticket** beside Gemini’s three-dot control at the bottom of the chatbox, enter the topic discussed in the call, and prepare the prompt. Send it using Gemini. The preset focuses on changes and decisions discussed about that topic, rather than a generic meeting summary.

In **Threadport settings**, edit and save the ticket and update prompt templates. **Fill ticket preset** and **Fill update preset** restore editable defaults before saving. Supported template values are `{{topic}}`, `{{issueId}}`, `{{issueTitle}}`, `{{issueDescription}}`, and `{{teamPrefix}}`. Templates stay in local browser storage.

Or ask Gemini: “Draft one Linear ticket from this discussion. Return a short `Title:` followed by `Description:` with context and acceptance criteria.”

Click **Send to Linear** at the bottom right of the message you want to send. It opens a review dialog for that message. Choose **Create a new ticket**, **Replace an existing ticket description**, or **Append to an existing ticket description**, then confirm. No Linear write happens on the first click. The success notice links to the issue. Use **Review** first if you want to edit the title and description.

Preset titles follow `Page or Feature - Improvement or Bug Fix`. Presets produce a readable Markdown ticket. The first heading becomes the Linear title; the remaining sections become the description. Field labels and update issue IDs are excluded from the description.

Supports `Title:`/`Description:` labels, Markdown headings, plain text, and JSON containing `title` and `description`. Long titles require review rather than being silently truncated. One message creates one ticket, not a ticket for each bullet.

## Update an issue

Click **Ask for update** to open a searchable, paginated list of tickets from your configured team, newest by creation date first. Search title/description text or an exact issue ID. Choose a topic to focus on, or leave it blank to use the selected ticket title. Selecting a ticket fetches its current title and description and inserts them into your configurable update prompt. Send the prompt using Gemini.

The generated response remembers the selected ticket, fills its ID in Review, and defaults to replacing its description. The preset produces a complete updated description preserving requirements that the call did not change. Review and confirm before writing. A freshness check stops the write if the ticket has changed since selection; use Ask for update again to reload it. This check reduces stale writes but is not an atomic server-side lock.

Click **Review** on the message. Choose **Replace an existing ticket description**, enter its ID (for example `ENG-123`), and check the fields to replace. **Replace description** is selected by default; **Replace title** is off.

**Append** keeps the existing title and adds new details after the existing description. For a ticket selected with Ask for update, its current description is prefilled and refreshed before appending. With a create-only key and a manually entered ID, paste the latest existing description into the append field. Reusing an outdated copy can overwrite concurrent edits. Choosing Replace supports an empty existing description.

Unchecked fields are preserved. Manually entered issue IDs do not automatically load existing text. The searchable update flow fetches the selected ticket. A replacement description includes the current Meet link. Issue IDs must match your configured team prefix; the team-scoped API key enforces access at Linear as well.

## Data handling

Ticket searches, selected issue reads, and the chosen title, description (including existing text for append), issue ID, and canonical Meet call link are sent directly to `https://api.linear.app/graphql`, when you use the picker or confirm a create/update. Selected ticket content is copied into Gemini only when you choose that ticket; Gemini receives it when you send the prepared prompt.

- No extra model calls, audio recording, caption capture, analytics, cookies, clipboard permission, remote scripts, or intermediary uploads.
- API key is in extension-local storage restricted to trusted extension contexts. It is never synced or returned to content scripts.
- Local storage is not encrypted against someone with OS/browser-profile access. Revoke your key in Linear if that profile is compromised.
- The worker accepts only its own settings page and Meet content scripts. Content messages cannot change the configured destination or send arbitrary GraphQL.
- Up to 100 hashed delivery receipts and issue links are stored for duplicate protection. No ticket text or transcript history is stored. Editable prompt templates are stored locally; avoid putting secrets into templates.
- Create retries reuse a stable issue UUID, including after network failures or worker restarts. With a create-only key, Threadport cannot look up a ticket after a lost response. If a retry reports an error, check Linear before changing the text and resending.
- Updates replace selected fields and can be retried safely with the same field values. Any independent edits made to those same fields can be overwritten.

See [PRIVACY.md](PRIVACY.md).

## Extend it

`adapters/google-meet.js` handles platform-specific input, panel, message text, and button placement. `content.js` owns the UI, `prompts.js` provides editable template defaults, `core.js` handles ticket text, and `background.js` implements Linear operations and credential boundaries. Add platform adapters and narrow manifest permissions deliberately; no additional hosts are enabled by default.

## Development

```sh
npm install
npm test
npm run test:browser
```

Browser tests use Chromium at `/usr/bin/chromium` or `CHROMIUM_PATH`. Set `PLAYWRIGHT_PATH` to use another installed Playwright module. Tests load a disposable extension copy with inspectable shadow roots; the production roots remain closed. The Linear API is mocked, so tests create no real tickets. `preview.png` is generated locally.

## Limits

Desktop Chrome/Chromium only. This cannot modify the Android/iOS Meet app. You need Google’s eligible Ask Gemini access; the extension does not provide it. Gemini’s DOM was inspected on 23 October 2026 and may change. Review supports manual pasting if detection breaks.

Not affiliated with or endorsed by Google or Linear. MIT licensed. Chrome Web Store publication is deferred until the local extension has been reviewed.

API reference: https://linear.app/developers/graphql
