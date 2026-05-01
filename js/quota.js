// Client-side daily quota counter. Per ADR-007 (and Stage 4 of the plan),
// 200 units/day is a defensive cap to prevent runaway API loops from
// burning the user's full 10K daily allowance. Realistic usage is
// 5–20 units/day. Counter resets at local midnight.

import { get, put } from './storage.js';
import { STORES } from './defaults.js';
import { DAILY_QUOTA_CAP } from './config.js';

export class QuotaExhaustedError extends Error {
  constructor(used, cap) {
    super(`Daily API quota reached (${used}/${cap} units used today)`);
    this.name = 'QuotaExhaustedError';
    this.used = used;
    this.cap = cap;
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getDailyUsage() {
  const row = await get(STORES.quota, todayKey());
  return row?.units || 0;
}

export async function checkQuota() {
  const used = await getDailyUsage();
  if (used >= DAILY_QUOTA_CAP) {
    throw new QuotaExhaustedError(used, DAILY_QUOTA_CAP);
  }
  return used;
}

export async function incrementQuota(units = 1) {
  const today = todayKey();
  const current = await getDailyUsage();
  const next = current + units;
  await put(STORES.quota, { date: today, units: next });
  return next;
}

export function getQuotaCap() {
  return DAILY_QUOTA_CAP;
}
