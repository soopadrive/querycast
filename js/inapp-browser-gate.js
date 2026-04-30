// Detects in-app browsers (Instagram, Gmail iOS, Reddit, Twitter, LinkedIn, etc.)
// where Google's OAuth flow fails with `disallowed_useragent`. ADR-001 mitigation.

const IN_APP_PATTERNS = /FBAN|FBAV|Instagram|Twitter|Line|MicroMessenger|WeChat|; wv\)|GSA\/|LinkedInApp/i;

export function isInAppBrowser() {
  return IN_APP_PATTERNS.test(navigator.userAgent);
}

export function renderInAppBrowserGate() {
  document.body.innerHTML = `
    <div class="in-app-gate">
      <h1>Open in your browser</h1>
      <p>QueryCast needs to open in Safari, Chrome, or Firefox to sign in with Google. In-app browsers (Instagram, Gmail, Reddit, Twitter, LinkedIn, etc.) block the sign-in flow.</p>
      <p><strong>How to fix:</strong> tap the menu button in your current app and choose "Open in Browser," or copy this URL and paste it into your real browser:</p>
      <code>${location.href}</code>
    </div>
  `;
}
