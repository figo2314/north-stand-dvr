const crypto = require("node:crypto");
const { fetchM3u, probeStream, sanitizeFfmpegOutput } = require("./m3u");

function channelHealthKey(streamUrl) {
  return crypto
    .createHash("sha1")
    .update(String(streamUrl || ""))
    .digest("hex")
    .slice(0, 20);
}

function parseVideoMetadata(message) {
  const text = String(message || "");
  const resolution = /Video:.*?(\d{3,4})x(\d{3,4})/i.exec(text);
  const codec = /Video:\s*([a-z0-9_]+)/i.exec(text)?.[1] || "";
  return {
    codec,
    width: resolution ? Number(resolution[1]) : 0,
    height: resolution ? Number(resolution[2]) : 0
  };
}

function formatHeight(height) {
  const value = Number(height) || 0;
  if (value >= 2160) return "4K";
  if (value >= 1080) return "1080p";
  if (value >= 720) return "720p";
  if (value >= 576) return "576p";
  if (value >= 480) return "480p";
  return value ? `${value}p` : "";
}

function normalizeSource(source, index = 0) {
  return {
    id: String(source.id || `source-${index + 1}`).trim().slice(0, 80),
    label: String(source.label || `直播源 ${index + 1}`).trim().slice(0, 60),
    url: String(source.url || "").trim().slice(0, 1000),
    fallbackUrl: String(source.fallbackUrl || "").trim().slice(0, 1000),
    enabled: source.enabled !== false,
    builtIn: Boolean(source.builtIn),
    priority: Math.max(0, Math.min(1000, Number(source.priority) || 0))
  };
}

function mergeChannelPlaylists(playlists) {
  const seen = new Set();
  const channels = [];

  for (const playlist of playlists) {
    for (const channel of playlist.channels || []) {
      const key = `${channel.name}|${channel.streamUrl}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      channels.push({
        ...channel,
        sourceId: playlist.source.id,
        sourceLabel: playlist.source.label,
        sourcePriority: playlist.source.priority
      });
    }
  }

  return channels;
}

async function loadChannelCatalog(sources, { fetchPlaylist = fetchM3u } = {}) {
  const enabledSources = sources
    .map(normalizeSource)
    .filter((source) => source.enabled && source.url)
    .sort((left, right) => right.priority - left.priority);

  const results = await Promise.all(
    enabledSources.map(async (source) => {
      let lastError = null;
      for (const url of [source.url, source.fallbackUrl].filter(Boolean)) {
        try {
          const playlist = await fetchPlaylist(url);
          return {
            source,
            url: playlist.url || url,
            count: playlist.channels.length,
            channels: playlist.channels,
            epgUrls: playlist.epgUrls || [],
            error: null
          };
        } catch (error) {
          lastError = error;
        }
      }
      return {
        source,
        url: source.url,
        count: 0,
        channels: [],
        epgUrls: [],
        error: lastError?.message || "直播源读取失败"
      };
    })
  );

  return {
    channels: mergeChannelPlaylists(results),
    epgUrls: [
      ...new Set(results.flatMap((result) => result.epgUrls || []))
    ],
    sources: results.map((result) => ({
      id: result.source.id,
      label: result.source.label,
      url: result.source.url,
      enabled: result.source.enabled,
      builtIn: result.source.builtIn,
      priority: result.source.priority,
      count: result.count,
      error: result.error
    }))
  };
}

function enrichChannels(channels, health) {
  return channels.map((channel) => {
    const key = channelHealthKey(channel.streamUrl);
    const entry = health[key] || null;
    return {
      ...channel,
      healthKey: key,
      health: entry
    };
  });
}

function scoreHealth(entry) {
  if (!entry) {
    return 0;
  }
  const playablePenalty = entry.playable === false ? -10_000 : 2_000;
  const latencyScore = Math.max(0, 1_200 - (Number(entry.latencyMs) || 0) / 20);
  const resolutionScore = Math.min(600, (Number(entry.height) || 0) / 2);
  const successScore = Math.min(100, (Number(entry.successes) || 0) * 4);
  const failureScore = Math.min(2_000, (Number(entry.failures) || 0) * 40);
  return Math.round(
    playablePenalty + latencyScore + resolutionScore + successScore - failureScore
  );
}

async function probeChannelHealth({
  streamUrl,
  current = null,
  probe = probeStream,
  now = Date.now()
}) {
  const startedAt = Date.now();
  const result = await probe({
    url: streamUrl,
    inputFormat: "hls",
    durationSeconds: 4,
    frames: 1
  });
  const metadata = parseVideoMetadata(result.message);
  const latencyMs = Math.max(0, Date.now() - startedAt);
  const checkedAt = new Date(now).toISOString();
  const quality = result.ok ? formatHeight(metadata.height) || "已连接" : "离线";
  const health = {
    checkedAt,
    playable: Boolean(result.ok),
    latencyMs,
    codec: metadata.codec,
    width: metadata.width,
    height: metadata.height,
    quality,
    successes: (Number(current?.successes) || 0) + (result.ok ? 1 : 0),
    failures: (Number(current?.failures) || 0) + (result.ok ? 0 : 1),
    lastError: result.ok ? null : sanitizeFfmpegOutput(result.message),
    history: [
      ...(Array.isArray(current?.history) ? current.history.slice(-9) : []),
      {
        checkedAt,
        playable: Boolean(result.ok),
        latencyMs,
        quality
      }
    ]
  };
  return { result, health, score: scoreHealth(health) };
}

module.exports = {
  channelHealthKey,
  enrichChannels,
  formatHeight,
  loadChannelCatalog,
  mergeChannelPlaylists,
  normalizeSource,
  parseVideoMetadata,
  probeChannelHealth,
  scoreHealth
};
