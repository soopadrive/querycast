// Fetch and parse YouTube per-channel RSS feeds. The fetch goes through
// the Rust shell (CORS bypass); parsing happens in JS via DOMParser.

const { invoke } = window.__TAURI__.core;

const ATOM_NS = 'http://www.w3.org/2005/Atom';
const YT_NS = 'http://www.youtube.com/xml/schemas/2015';
const MEDIA_NS = 'http://search.yahoo.com/mrss/';

export async function fetchChannelRss(channelId) {
  let xml;
  try {
    xml = await invoke('fetch_rss', { channelId });
  } catch (err) {
    if (String(err) === 'not_found') return [];
    throw err;
  }
  return parseRssFeed(xml);
}

function parseRssFeed(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('RSS feed parse error');
  }

  const entries = Array.from(doc.getElementsByTagNameNS(ATOM_NS, 'entry'));

  return entries.map((entry) => {
    const videoId = textNS(entry, YT_NS, 'videoId');
    const channelId = textNS(entry, YT_NS, 'channelId');
    const title = textNS(entry, ATOM_NS, 'title');
    const published = textNS(entry, ATOM_NS, 'published');

    const authorEl = entry.getElementsByTagNameNS(ATOM_NS, 'author')[0];
    const channelTitle = authorEl ? textNS(authorEl, ATOM_NS, 'name') : '';

    const groupEl = entry.getElementsByTagNameNS(MEDIA_NS, 'group')[0];
    const description = groupEl ? textNS(groupEl, MEDIA_NS, 'description') : '';

    const thumbEls = groupEl ? groupEl.getElementsByTagNameNS(MEDIA_NS, 'thumbnail') : [];
    const thumbnailUrl = thumbEls.length ? thumbEls[0].getAttribute('url') || '' : '';

    const statsEl = groupEl ? groupEl.getElementsByTagNameNS(MEDIA_NS, 'statistics')[0] : null;
    const viewCount = statsEl ? parseInt(statsEl.getAttribute('views') || '0', 10) : null;

    return {
      videoId,
      channelId,
      channelTitle,
      title,
      description,
      publishedAt: published,
      thumbnailUrl,
      viewCount,
      fetchedAt: Date.now(),
    };
  }).filter((v) => v.videoId);
}

function textNS(parent, ns, tag) {
  const el = parent.getElementsByTagNameNS(ns, tag)[0];
  return el ? el.textContent || '' : '';
}
