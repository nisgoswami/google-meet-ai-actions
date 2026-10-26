// Platform adapter: no network, keys, or Linear-specific behavior.
(() => {
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length && element.getBoundingClientRect().width > 0);
  const adapter = {
    id: 'google-meet',
    visible,
    input(doc = document) {
      return Array.from(doc.querySelectorAll('[aria-label="Ask Gemini"][contenteditable="true"],textarea[aria-label="Ask Gemini"],input[aria-label="Ask Gemini"],textarea[placeholder="Ask Gemini"],input[placeholder="Ask Gemini"],[contenteditable="true"][data-placeholder="Ask Gemini"]')).find(visible);
    },
    launcher(doc = document) {
      return Array.from(doc.querySelectorAll('button, [role="button"]')).find(element => visible(element) &&
        (element.getAttribute('aria-label')?.trim() === 'Ask Gemini' || element.textContent.trim() === 'Ask Gemini'));
    },
    promptAnchor(input) { return input?.closest('footer')?.querySelector('button[aria-label="More actions"]'); },
    panel(input) { return input?.closest('[data-feed-title]'); },
    cards(panel) {
      return panel ? Array.from(panel.querySelectorAll('[role="listitem"]')).filter(card => this.textElement(card)) : [];
    },
    textElement(card) { return card.querySelector('.pA4Vnf, [jsname="DPm3Gf"]'); },
    mount(card) { return card.querySelector('[role="heading"]') || card; },
    latestResponse(panel) {
      return Array.from(panel?.querySelectorAll('[data-generation-index] .pA4Vnf') || []).filter(visible).at(-1);
    }
  };
  globalThis.ThreadportAdapters = [...(globalThis.ThreadportAdapters || []), adapter];
})();
