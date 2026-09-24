const originalFetch = globalThis.fetch;
const viberBaseUrl = process.env.TEST_VIBER_BASE_URL || '';

if (viberBaseUrl) {
  globalThis.fetch = function babyparkTestFetch(input, init) {
    const sourceUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(sourceUrl);
    if (url.origin === 'https://chatapi.viber.com') {
      const redirected = new URL(url.pathname + url.search, viberBaseUrl);
      return originalFetch(redirected, init);
    }
    return originalFetch(input, init);
  };
}
