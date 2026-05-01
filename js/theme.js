// Theme system (Stage 8a). Two themes: dark (default) and light. The
// chosen theme is applied via [data-theme] on the <html> element so
// CSS-variable overrides cascade naturally. Persisted in localStorage
// rather than IndexedDB because (1) it's a UI preference, not user
// data; (2) we want to apply the theme synchronously *before* the
// stylesheet parses (no flash-of-wrong-theme), and IDB is async.

const STORAGE_KEY = 'querycast.theme';
const VALID = new Set(['dark', 'light']);

export function getTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function setTheme(name) {
  if (!VALID.has(name)) return;
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* private browsing / quota — fall through, attribute still updates */
  }
  document.documentElement.setAttribute('data-theme', name);
  syncToggleIcon(name);
}

export function toggleTheme() {
  setTheme(getTheme() === 'light' ? 'dark' : 'light');
}

// Wire the toolbar toggle button. The button's text content is the
// *target* theme's icon — sun when in dark mode (click to go light),
// moon when in light mode (click to go dark). aria-label always
// describes the action.
export function bindThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  syncToggleIcon(getTheme());
  btn.addEventListener('click', toggleTheme);
}

function syncToggleIcon(theme) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const targetingLight = theme === 'dark'; // clicking would go light
  btn.textContent = targetingLight ? '☀' : '☾';
  btn.setAttribute(
    'aria-label',
    targetingLight ? 'Switch to light theme' : 'Switch to dark theme'
  );
  btn.title = targetingLight ? 'Switch to light theme' : 'Switch to dark theme';
}
