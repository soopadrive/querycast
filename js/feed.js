// Feed orchestration: refresh subscriptions, fetch RSS for each channel
// in parallel (capped concurrency), merge new videos into IndexedDB,
// produce a renderable feed filtered through watched + not-interested.

import { fetchSubscriptions } from './youtube-api.js';
import { fetchChannelRss } from './rss-fetcher.js';
import { createQueue } from './concurrency.js';
import { put, del, getAll, STORES } from './storage.js';

const SUBSCRIPTIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RSS_CONCURRENCY = 3;

export async function getSubscriptionsCached(forceRefresh = false) {
  const cached = await getAll(STORES.subscriptions);

  if (!forceRefresh && cached.length > 0) {
    const oldest = Math.min(...cached.map((s) => s.cachedAt || 0));
    if (Date.now() - oldest < SUBSCRIPTIONS_TTL_MS) {
      return cached;
    }
  }

  const fresh = await fetchSubscriptions();
  const freshIds = new Set(fresh.map((s) => s.channelId));

  // Drop channels the user unsubscribed from.
  for (const old of cached) {
    if (!freshIds.has(old.channelId)) {
      await del(STORES.subscriptions, old.channelId);
    }
  }
  for (const sub of fresh) {
    await put(STORES.subscriptions, sub);
  }
  return fresh;
}

export async function refreshFeed(onProgress) {
  onProgress?.({ phase: 'subs', message: 'Loading subscriptions…' });
  const subs = await getSubscriptionsCached(true);

  if (subs.length === 0) {
    onProgress?.({ phase: 'done', message: 'No subscriptions found.' });
    return { subs: 0, channelsOk: 0, channelsFailed: 0 };
  }

  onProgress?.({
    phase: 'rss',
    message: `Fetching RSS for ${subs.length} channels…`,
    completed: 0,
    total: subs.length,
  });

  const queue = createQueue(RSS_CONCURRENCY);
  let completed = 0;
  let channelsOk = 0;
  let channelsFailed = 0;

  await Promise.all(
    subs.map((sub) =>
      queue.add(async () => {
        try {
          const videos = await fetchChannelRss(sub.channelId);
          for (const v of videos) {
            await put(STORES.videos, v);
          }
          channelsOk += 1;
        } catch (err) {
          console.warn(`RSS failed for ${sub.title} (${sub.channelId}):`, err);
          channelsFailed += 1;
        } finally {
          completed += 1;
          onProgress?.({
            phase: 'rss',
            completed,
            total: subs.length,
          });
        }
      })
    )
  );

  onProgress?.({
    phase: 'done',
    message: `Refreshed ${channelsOk}/${subs.length} channels.`,
  });

  return { subs: subs.length, channelsOk, channelsFailed };
}

export async function getRenderableFeed() {
  const [videos, watched, notInterested] = await Promise.all([
    getAll(STORES.videos),
    getAll(STORES.watched),
    getAll(STORES.notInterested),
  ]);

  const watchedIds = new Set(watched.map((v) => v.videoId));
  const skippedIds = new Set(notInterested.map((v) => v.videoId));

  return videos
    .filter((v) => !watchedIds.has(v.videoId) && !skippedIds.has(v.videoId))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}
