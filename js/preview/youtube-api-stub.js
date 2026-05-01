// Static preview stub — feed is pre-seeded; refresh / enrichment never
// run, so these are no-ops returning shapes the callers expect.

export async function fetchSubscriptions() {
  return [];
}

export async function fetchVideoMetadata() {
  return new Map();
}

export function parseIsoDuration() {
  return 0;
}
