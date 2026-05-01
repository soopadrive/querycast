// Feed orchestration: refresh subscriptions, fetch RSS for each channel
// in parallel (capped concurrency), merge new videos into IndexedDB,
// produce a renderable feed filtered through watched + not-interested.

import { fetchSubscriptions, fetchVideoMetadata, parseIsoDuration } from './youtube-api.js';
import { fetchChannelRss } from './rss-fetcher.js';
import { createQueue } from './concurrency.js';
import { put, del, getAll } from './storage.js';
import { STORES } from './defaults.js';
import { QuotaExhaustedError } from './quota.js';

const SUBSCRIPTIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RSS_CONCURRENCY = 3;
const SHORT_THRESHOLD_SECS = 60;

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
            // Don't overwrite existing enriched videos. Merge — preserve
            // duration / viewCount / liveStatus from prior enrichment.
            const existing = (await getAll(STORES.videos)).find(
              (x) => x.videoId === v.videoId
            );
            if (existing && existing.duration) {
              continue;
            }
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

  // Enrich newly-discovered videos with API metadata (duration, view count, etc).
  let enriched = 0;
  let tombstoned = 0;
  try {
    onProgress?.({ phase: 'enrich', message: 'Enriching video metadata…' });
    const result = await enrichNewVideos((p) => onProgress?.({ phase: 'enrich', ...p }));
    enriched = result.enriched;
    tombstoned = result.tombstoned;
  } catch (err) {
    if (err instanceof QuotaExhaustedError) {
      onProgress?.({
        phase: 'done',
        message: `${err.message}. Cached results still shown.`,
        quotaExhausted: true,
      });
      return { subs: subs.length, channelsOk, channelsFailed, enriched, tombstoned };
    }
    throw err;
  }

  onProgress?.({
    phase: 'done',
    message: `Refreshed ${channelsOk}/${subs.length} channels · enriched ${enriched} new videos${tombstoned ? ` · ${tombstoned} unavailable` : ''}.`,
  });

  return { subs: subs.length, channelsOk, channelsFailed, enriched, tombstoned };
}

async function enrichNewVideos(onProgress) {
  const [videos, tombstoneRows] = await Promise.all([
    getAll(STORES.videos),
    getAll(STORES.tombstones),
  ]);

  // Drop expired tombstones first — gives previously-missing videos another chance.
  const now = Date.now();
  const validTombstones = [];
  for (const t of tombstoneRows) {
    if (t.checkedAt && now - t.checkedAt < TOMBSTONE_TTL_MS) {
      validTombstones.push(t);
    } else {
      await del(STORES.tombstones, t.videoId);
    }
  }
  const tombstoneIds = new Set(validTombstones.map((t) => t.videoId));

  // Find videos lacking duration (= not yet enriched) and not tombstoned.
  const needsEnrichment = videos.filter(
    (v) => v.videoId && !v.duration && !tombstoneIds.has(v.videoId)
  );

  if (needsEnrichment.length === 0) {
    return { enriched: 0, tombstoned: 0 };
  }

  onProgress?.({
    completed: 0,
    total: needsEnrichment.length,
    message: `Enriching ${needsEnrichment.length} new videos…`,
  });

  const ids = needsEnrichment.map((v) => v.videoId);
  const metaMap = await fetchVideoMetadata(ids);

  let enriched = 0;
  let tombstoned = 0;
  for (const video of needsEnrichment) {
    const meta = metaMap.get(video.videoId);
    if (!meta) {
      // Region-locked, deleted, private, or members-only.
      await put(STORES.tombstones, {
        videoId: video.videoId,
        checkedAt: Date.now(),
      });
      tombstoned += 1;
      continue;
    }

    const duration = parseIsoDuration(meta.contentDetails?.duration);
    const viewCount = meta.statistics?.viewCount
      ? parseInt(meta.statistics.viewCount, 10)
      : video.viewCount || 0;
    const liveStatus = meta.snippet?.liveBroadcastContent || 'none';

    await put(STORES.videos, {
      ...video,
      duration,
      viewCount,
      liveStatus,
      isShort: duration > 0 && duration < SHORT_THRESHOLD_SECS,
      // Prefer API title/description over RSS (RSS truncates description).
      title: meta.snippet?.title || video.title,
      description: meta.snippet?.description || video.description,
      enrichedAt: Date.now(),
    });
    enriched += 1;
  }

  onProgress?.({
    completed: needsEnrichment.length,
    total: needsEnrichment.length,
    message: `Enriched ${enriched}; ${tombstoned} unavailable.`,
  });

  return { enriched, tombstoned };
}

export async function getRenderableFeed() {
  const [videos, watched, notInterested, tombstoneRows] = await Promise.all([
    getAll(STORES.videos),
    getAll(STORES.watched),
    getAll(STORES.notInterested),
    getAll(STORES.tombstones),
  ]);

  const watchedIds = new Set(watched.map((v) => v.videoId));
  const skippedIds = new Set(notInterested.map((v) => v.videoId));
  const tombstoneIds = new Set(tombstoneRows.map((t) => t.videoId));

  return videos
    .filter(
      (v) =>
        !watchedIds.has(v.videoId) &&
        !skippedIds.has(v.videoId) &&
        !tombstoneIds.has(v.videoId)
    )
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}
