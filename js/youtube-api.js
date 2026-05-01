// YouTube Data API client. Uses the user's OAuth access token for auth.
// Per ADR-001, googleapis.com endpoints are CORS-enabled and reachable
// directly from WebView2 — no proxy needed.

import { getValidAccessToken } from './auth.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export async function fetchSubscriptions() {
  const all = [];
  let pageToken = null;
  let page = 0;

  do {
    const params = new URLSearchParams({
      mine: 'true',
      part: 'snippet',
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });

    const token = await getValidAccessToken();
    const resp = await fetch(`${API_BASE}/subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(
        `subscriptions.list failed (page ${page}): ${err.error?.message || resp.status}`
      );
    }

    const data = await resp.json();
    for (const item of data.items || []) {
      // resourceId.channelId is the SUBSCRIBED channel.
      // snippet.channelId would be the user's own channel — not what we want.
      const channelId = item.snippet.resourceId?.channelId;
      if (!channelId) continue;
      all.push({
        channelId,
        title: item.snippet.title || '',
        thumbnail: item.snippet.thumbnails?.default?.url || '',
        cachedAt: Date.now(),
      });
    }

    pageToken = data.nextPageToken;
    page += 1;
  } while (pageToken);

  return all;
}
