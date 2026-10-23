/* Shared pure text handling; no network or page permissions. */
(function (root) {
  function clean(text) {
    return String(text || '').replace(/\r\n?/g, '\n').replace(/\u200b/g, '').trim();
  }
  function parseTicket(text) {
    text = clean(text);
    if (!text) throw new Error('Ask Gemini to draft a ticket, or select the text you want to send.');
    if (text.length > 50000) throw new Error('Select a shorter passage (up to 50,000 characters).');
    // Accept structured output without requiring a model/API subscription.
    const unfenced = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    if (unfenced.startsWith('{')) {
      try {
        const obj = JSON.parse(unfenced);
        if (typeof obj.title === 'string' && typeof obj.description === 'string') {
          const title = clean(obj.title);
          if (!title || title.length > 250) throw new Error('The ticket title must be 1–250 characters.');
          return { title, description: clean(obj.description) };
        }
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
      }
    }
    const lines = text.split('\n');
    const titleLine = lines.findIndex(line => /^(?:#{1,6}\s*)?(?:\*\*)?(?:ticket\s+)?title(?:\*\*)?\s*:/i.test(line.trim()));
    let title, description;
    if (titleLine >= 0) {
      title = lines[titleLine].trim().replace(/^(?:#{1,6}\s*)?(?:\*\*)?(?:ticket\s+)?title(?:\*\*)?\s*:\s*/i, '').replace(/^\*\*|\*\*$/g, '').trim();
      description = lines.slice(titleLine + 1).join('\n').replace(/^\s*(?:#{1,6}\s*)?(?:\*\*)?description(?:\*\*)?\s*:\s*(?:\*\*)?\s*/i, '').trim();
    } else {
      const heading = lines.findIndex(line => /^#{1,6}\s+\S/.test(line));
      // A heading is safe as a title only when it begins the selected response.
      const first = lines.findIndex(line => line.trim());
      if (heading === first) {
        title = lines[first].replace(/^#{1,6}\s+/, '').trim();
        description = lines.slice(first + 1).join('\n').trim();
      } else {
        title = lines[first].replace(/^[*\-•]\s+/, '').replace(/^\*\*|\*\*$/g, '').trim();
        description = text;
      }
    }
    if (!title || title.length > 250) throw new Error('Use Review to give this ticket a short title (up to 250 characters).');
    const issueId = text.match(/^\s*(?:\*\*)?Issue ID:(?:\*\*)?\s*([A-Z][A-Z0-9]*-\d+)\s*$/im)?.[1];
    return issueId ? { title, description, issueId: issueId.toUpperCase() } : { title, description };
  }
  function meetingUrl(url) {
    const value = new URL(url);
    const match = value.pathname.match(/^\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/);
    if (value.origin !== 'https://meet.google.com' || !match) return '';
    return value.origin + '/' + match[1];
  }
  function descriptionWithSource(description, url) {
    const source = meetingUrl(url);
    return clean(description) + (source ? `\n\n---\nSource: [Google Meet](${source})` : '');
  }
  const api = { clean, parseTicket, meetingUrl, descriptionWithSource };
  root.MeetLinearCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
