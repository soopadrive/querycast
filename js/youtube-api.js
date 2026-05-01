// YouTube Data API client. Uses the user's OAuth access token for auth.
// Per ADR-001, googleapis.com endpoints are CORS-enabled and reachable
// directly from WebView2 — no proxy needed.
// Quota is per-call: subscriptions.list = 1 unit/page, videos.list = 1 unit/call.

import { getValidAccessToken } from './auth.js';
import { checkQuota, incrementQuota } from './quota.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

const VIDEOS_LIST_BATCH = 50;

export async function fetchSubscriptions() {
  const all = [];
  let pageToken = null;
  let page = 0;

  do {
    await checkQuota();

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

    await incrementQuota(1);

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

// Returns Map<videoId, item> for the IDs that exist + are visible to this user.
// IDs absent from the result map are missing — caller should tombstone them.
export async function fetchVideoMetadata(videoIds) {
  const map = new Map();
  if (!videoIds || videoIds.length === 0) return map;

  for (let i = 0; i < videoIds.length; i += VIDEOS_LIST_BATCH) {
    const chunk = videoIds.slice(i, i + VIDEOS_LIST_BATCH);
    await checkQuota();

    const params = new URLSearchParams({
      id: chunk.join(','),
      part: 'snippet,contentDetails,statistics',
      maxResults: String(VIDEOS_LIST_BATCH),
    });

    const token = await getValidAccessToken();
    const resp = await fetch(`${API_BASE}/videos?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`videos.list failed: ${err.error?.message || resp.status}`);
    }

    await incrementQuota(1);

    const data = await resp.json();
    for (const item of data.items || []) {
      map.set(item.id, item);
    }
  }

  return map;
}

// Parses ISO 8601 duration (PT4M13S, PT1H23M45S, PT45S) to seconds.
// YouTube uses a small subset — hours/minutes/seconds only, no days.
export function parseIsoDuration(s) {
  if (!s) return 0;
  const m = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const sec = parseInt(m[3] || '0', 10);
  return h * 3600 + min * 60 + sec;
}
