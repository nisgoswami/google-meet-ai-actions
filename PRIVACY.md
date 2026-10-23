# Google Meet AI Actions privacy policy

Effective 24 October 2026.

Google Meet AI Actions transfers user-selected conversation text into Linear issues. It does not operate a backend, collect analytics, record audio, or capture meeting transcripts.

## Data processed

The extension locally reads message text in the open Google Meet Gemini panel to display message controls and prepare the issue you select. When you click Send, Create, or Update, the selected title, description, relevant issue identifier, selected status/assignee IDs, and Meet call link are transmitted directly over HTTPS to Linear’s API. Linear handles that data under its own terms and privacy policy. Gemini itself remains a Google service governed by Google’s policies.

Opening Send or Review checks issue references and exact titles against the configured team to detect an existing ticket. The extension also reads that team’s workflow statuses and active member names/IDs for the status and assignee selectors. Creation defaults store only the selected status/assignee IDs locally.

When you open the update picker, search terms are sent directly to Linear and recent ticket identifiers, titles, and timestamps are fetched for your configured team. Choosing a ticket fetches its current title, description, and update timestamp. That content is inserted into the Gemini composer, and is sent to Google only when you submit the prepared prompt. Ticket reads require team-restricted Read permission. Before writing a selected update, the extension reads it again to check for newer edits.

The personal Linear API key, editable prompt templates, default status/assignee IDs, and selected destination are stored in this extension’s local browser storage, restricted to trusted extension contexts. The key is sent only to Linear for authentication and is never placed in the Meet page or synced by the extension. Local storage is not encrypted against someone who can access the underlying OS/browser profile.

The extension stores up to 100 hashed creation receipts and corresponding issue links for duplicate protection. It does not retain message bodies, ticket descriptions, or transcripts. Drafts, selected ticket content, and picker results exist only in memory while the page is open. Prompt templates intentionally saved by the user remain in local storage until changed or the extension is removed.

## Controls and deletion

Searches and ticket reads occur when you use the update picker. Linear tickets are written only after you confirm a create/replace/append action in Review. Disconnect in settings to delete the stored key, destination, and receipts. Removing the extension deletes its browser storage. Revoke the key through Linear to invalidate it. Disconnecting does not remove issues already created or updated in Linear.

## Limited use

Google Meet AI Actions uses data only to provide the visible issue-transfer features described above. It does not sell data, use it for advertising, train models with it, or transfer it to intermediaries. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Questions

Contact the maintainer through this project’s repository. Do not post API keys or private meeting content in public issues.
