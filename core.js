/* Shared ticket and image validation; no network or page permissions. */
(function (root) {
  function clean(text) {
    return String(text || '').replace(/\r\n?/g, '\n').replace(/\u200b/g, '').trim();
  }
  function withoutRepeatedTitle(description, title) {
    const normalize = value => clean(value).replace(/^#{1,6}\s*/, '').replace(/^(?:\*\*|__|`)|(?:\*\*|__|`)$/g, '').replace(/\\([\\`*{}_\[\]()#+.!>-])/g, '$1').normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
    const expected = normalize(title);
    const lines = clean(description).split('\n');
    while (lines.length && normalize(lines[0]) === expected) {
      lines.shift();
      while (lines.length && !lines[0].trim()) lines.shift();
    }
    return clean(lines.join('\n'));
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
          const result = { title, description: withoutRepeatedTitle(obj.description,title) };
          if (typeof obj.issueId === 'string' && /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/i.test(obj.issueId.trim())) result.issueId = obj.issueId.trim().toUpperCase();
          return result;
        }
        throw new Error('The JSON ticket needs separate title and description fields.');
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        throw new Error('Could not read the JSON ticket. Use Review to enter the title and description separately.');
      }
    }
    // Repair Gemini's occasionally glued field labels before splitting fields.
    text = text.replace(/(Description\s*:)\s*(?:\\#){1,6}\s*/gi, '$1\n## ').replace(/(Description\s*:)\s*(#{1,6})\s*/gi, '$1\n$2 ');
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
        description = lines.slice(first + 1).join('\n').trim();
      }
    }
    if (!title || title.length > 250) throw new Error('Use Review to give this ticket a short title (up to 250 characters).');
    const issueId = text.match(/^\s*(?:\*\*)?Issue ID:(?:\*\*)?\s*([A-Z][A-Z0-9]*-\d+)\s*$/im)?.[1];
    if (issueId) description = description.replace(/^\s*(?:\*\*)?Issue ID:(?:\*\*)?\s*[A-Z][A-Z0-9_]*-\d+\s*$/im, '').trim();
    description = withoutRepeatedTitle(description,title);
    return issueId ? { title, description, issueId: issueId.toUpperCase() } : { title, description };
  }
  function detectUpdate(text, teamPrefix) {
    const ids = [...new Set((String(text).match(/\b[A-Z][A-Z0-9_]*-[1-9][0-9]*\b/gi) || []).map(id=>id.toUpperCase()))].filter(id=>!teamPrefix || id.startsWith(teamPrefix.toUpperCase()+'-'));
    return {issueId:ids.length===1 ? ids[0] : '', ids, updating:ids.length>0 || /\b(?:update|revise|amend|append to)\s+(?:(?:the|this|an|existing)\s+)*(?:ticket|issue)\b|\b(?:ticket|issue)\s+update\b/i.test(String(text))};
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
  // Linear ingests inline image data URLs into its private file storage.
  const screenshotLimits = { count: 3, bytes: 2 * 1024 * 1024 };
  function validateScreenshots(images = []) {
    if (!Array.isArray(images) || images.length > screenshotLimits.count) throw new Error('Attach up to 3 screenshots.');
    return images.map(image => {
      if (typeof image !== 'string' || image.length > 4 * Math.ceil(screenshotLimits.bytes / 3) + 30) throw new Error('Each screenshot must be 2 MB or smaller.');
      const match = image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match || match[2].length % 4) throw new Error('Choose a PNG, JPEG, or WebP screenshot.');
      let bytes;
      try { bytes = atob(match[2]); } catch { throw new Error('Could not read this screenshot.'); }
      if (!bytes.length || bytes.length > screenshotLimits.bytes) throw new Error('Each screenshot must be 2 MB or smaller.');
      const valid = match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
        : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff')
        : bytes.startsWith('RIFF') && bytes.slice(8,12) === 'WEBP';
      if (!valid || btoa(bytes) !== match[2]) throw new Error('The screenshot contents do not match its image format.');
      return image;
    });
  }
  const api = { clean, withoutRepeatedTitle, parseTicket, detectUpdate, meetingUrl, descriptionWithSource, screenshotLimits, validateScreenshots };
  root.MeetLinearCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
