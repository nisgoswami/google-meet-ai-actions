// Convert only the chosen message locally; never send HTML or fetch linked content.
(() => {
  const converter = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**' });
  converter.addRule('safeLinks', {
    filter: 'a',
    replacement(content, node) {
      const href = node.getAttribute('href') || '';
      return /^(https?:|mailto:)/i.test(href) ? `[${content}](${href.replace(/\)/g, '%29')})` : content;
    }
  });
  converter.remove(['script', 'style', 'button', 'svg']);
  globalThis.ThreadportMarkdown = element => {
    // Gemini sometimes renders JSON as spans and line breaks rather than code.
    // Preserve its raw escapes; Markdown conversion would double the backslashes.
    const raw = MeetLinearCore.clean(element.innerText ?? element.textContent);
    if (raw.replace(/^```(?:json)?\s*\n?/i, '').startsWith('{')) return raw;
    const copy = element.cloneNode(true);
    copy.querySelectorAll('.meet-linear-message,[aria-hidden="true"]').forEach(node => node.remove());
    // Meet uses styled AST spans for some headings instead of semantic H tags.
    for (const span of copy.querySelectorAll('span[data-ast-node-id]')) {
      if (span.closest('li,p,pre,code,a') || !/^(Summary|Context|Requirements|Acceptance criteria|Steps to reproduce|Expected behavior|Actual behavior|Open questions)$/i.test(span.textContent.trim())) continue;
      const heading = document.createElement('h2'); heading.textContent = span.textContent.trim(); span.replaceWith(heading);
    }
    if (!copy.querySelector('p,br,h1,h2,h3,h4,h5,h6,strong,b,em,i,ul,ol,pre,code,a,blockquote,hr')) {
      return MeetLinearCore.clean(element.innerText ?? element.textContent);
    }
    return MeetLinearCore.clean(converter.turndown(copy));
  };
})();
