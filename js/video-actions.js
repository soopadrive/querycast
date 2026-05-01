// Per-video actions (Stage 6b): mark watched / save / not-interested.
// Pure storage writes — UI render + toast / undo orchestration lives in
// main.js.

import { put, del } from './storage.js';
import { STORES } from './defaults.js';

export async function markWatched(videoId) {
  if (!videoId) return;
  await put(STORES.watched, { videoId, watchedAt: Date.now() });
}
export async function unmarkWatched(videoId) {
  if (!videoId) return;
  await del(STORES.watched, videoId);
}

export async function saveVideo(videoId) {
  if (!videoId) return;
  await put(STORES.saved, { videoId, savedAt: Date.now() });
}
export async function unsaveVideo(videoId) {
  if (!videoId) return;
  await del(STORES.saved, videoId);
}

export async function markNotInterested(videoId) {
  if (!videoId) return;
  await put(STORES.notInterested, { videoId, skippedAt: Date.now() });
}
export async function unmarkNotInterested(videoId) {
  if (!videoId) return;
  await del(STORES.notInterested, videoId);
}
