# Threadport privacy policy

Effective 23 October 2026.

Threadport transfers user-selected conversation text into Linear issues. It does not operate a backend, collect analytics, record audio, or capture meeting transcripts.

## Data processed

The extension locally reads message text in the open Google Meet Gemini panel to display message controls and prepare the issue you select. When you click Send, Create, or Update, the selected title, description, relevant issue identifier, and Meet call link are transmitted directly over HTTPS to Linear’s API. Linear handles that data under its own terms and privacy policy. Gemini itself remains a Google service governed by Google’s policies.

The personal Linear API key and selected destination are stored in this extension’s local browser storage, restricted to trusted extension contexts. The key is sent only to Linear for authentication and is never placed in the Meet page or synced by the extension. Local storage is not encrypted against someone who can access the underlying OS/browser profile.

The extension stores up to 100 hashed creation receipts and corresponding issue links for duplicate protection. It does not retain message bodies, ticket descriptions, or transcripts. Drafts in the Review editor exist only in memory while the page is open.

## Controls and deletion

Nothing is sent to Linear until you click a send/create/update control. Disconnect in settings to delete the stored key, destination, and receipts. Removing the extension deletes its browser storage. Revoke the key through Linear to invalidate it. Disconnecting does not remove issues already created or updated in Linear.

## Limited use

Threadport uses data only to provide the visible issue-transfer features described above. It does not sell data, use it for advertising, train models with it, or transfer it to intermediaries. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Questions

Contact the maintainer through this project’s repository. Do not post API keys or private meeting content in public issues.
