const MAX_EPG_BYTES = 20 * 1024 * 1024;
const EPG_TTL_MS = 10 * 60 * 1000;
const epgCache = new Map();

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16))
    );
}

function parseXmltvDate(value) {
  const match =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/.exec(
      String(value || "").trim()
    );
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second, offset] = match;
  const zone = offset
    ? `${offset.slice(0, 3)}:${offset.slice(3)}`
    : "Z";
  const timestamp = Date.parse(
    `${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`
  );
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function parseXmltv(xml, now = Date.now()) {
  const programmes = new Map();
  const pattern = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let match;
  while ((match = pattern.exec(String(xml || "")))) {
    const attributes = match[1];
    const body = match[2];
    const channel = /\bchannel="([^"]+)"/i.exec(attributes)?.[1];
    const start = parseXmltvDate(
      /\bstart="([^"]+)"/i.exec(attributes)?.[1]
    );
    const stop = parseXmltvDate(
      /\bstop="([^"]+)"/i.exec(attributes)?.[1]
    );
    const title = decodeXml(
      /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(body)?.[1] || ""
    ).trim();
    if (!channel || !start || !stop || !title) {
      continue;
    }
    const startMs = Date.parse(start);
    const stopMs = Date.parse(stop);
    if (stopMs < now - 6 * 60 * 60 * 1000) {
      continue;
    }
    if (startMs > now + 24 * 60 * 60 * 1000) {
      continue;
    }
    const list = programmes.get(channel) || [];
    list.push({ title, start, stop });
    programmes.set(channel, list);
  }

  const output = {};
  for (const [channel, list] of programmes) {
    list.sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
    const currentIndex = list.findIndex(
      (programme) =>
        Date.parse(programme.start) <= now && Date.parse(programme.stop) > now
    );
    const current = currentIndex >= 0 ? list[currentIndex] : null;
    const next =
      list.find((programme) => Date.parse(programme.start) > now) || null;
    output[channel] = { current, next };
  }
  return output;
}

async function fetchXmltv(url) {
  const cached = epgCache.get(url);
  if (cached && Date.now() - cached.loadedAt < EPG_TTL_MS) {
    return cached.programmes;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "NorthStandDVR/1.0" }
    });
    if (!response.ok) {
      throw new Error(`节目单返回 HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_EPG_BYTES) {
      throw new Error("节目单超过 20 MB，已拒绝加载");
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_EPG_BYTES) {
      throw new Error("节目单超过 20 MB，已拒绝加载");
    }
    const programmes = parseXmltv(text);
    epgCache.set(url, { loadedAt: Date.now(), programmes });
    return programmes;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadEpg(urls) {
  const uniqueUrls = [...new Set((urls || []).filter(Boolean))].slice(0, 5);
  const results = await Promise.allSettled(uniqueUrls.map((url) => fetchXmltv(url)));
  const channels = {};
  const errors = [];
  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(result.reason.message);
      continue;
    }
    for (const [channelId, programmes] of Object.entries(result.value)) {
      const existing = channels[channelId] || { current: null, next: null };
      channels[channelId] = {
        current: existing.current || programmes.current,
        next: existing.next || programmes.next
      };
    }
  }
  return { channels, errors };
}

module.exports = {
  decodeXml,
  loadEpg,
  parseXmltv,
  parseXmltvDate
};
