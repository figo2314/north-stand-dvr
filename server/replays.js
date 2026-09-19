const crypto = require("node:crypto");
const { channelHealthKey } = require("./channels");

const DEFAULT_REPLAY_TTL_MS = 6 * 60 * 60 * 1000;
const REPLAY_PATTERN = /全场回放|回放|重播|集锦|录像|highlight/i;
const FOOTBALL_PATTERN =
  /足球|英超|西甲|德甲|意甲|法甲|欧冠|欧联|世界杯|欧洲杯|中超|亚冠|世预赛|友谊赛/;

function isReplayChannel(channel) {
  const text = `${channel?.name || ""} ${channel?.group || ""}`;
  return REPLAY_PATTERN.test(text) && FOOTBALL_PATTERN.test(text);
}

function normalizeReplayTitle(name) {
  return String(name || "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+\d{1,2}:\d{2}\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function replayGroupKey(channel) {
  return normalizeReplayTitle(channel.name).toLocaleLowerCase("zh-CN");
}

function replayScore(entry, channel) {
  return (
    Math.min(600, Number(entry?.height) || 0) +
    Math.min(300, (Number(entry?.successes) || 0) * 60) -
    Math.min(600, Math.round((Number(entry?.latencyMs) || 0) / 10)) -
    Math.min(500, (Number(entry?.failures) || 0) * 50) +
    (entry?.playable === true ? 1000 : 0) +
    (channel?.logo ? 20 : 0)
  );
}

function freshPlayableHealth(channel, health, now, ttlMs) {
  const entry = health[channelHealthKey(channel.streamUrl)];
  if (!entry || entry.playable !== true) {
    return null;
  }
  const checkedAt = Date.parse(entry.checkedAt || "");
  if (!Number.isFinite(checkedAt) || now - checkedAt > ttlMs) {
    return null;
  }
  return entry;
}

function competitionFromTitle(title) {
  const match = /^(英超|西甲|德甲|意甲|法甲|欧冠|欧联|世界杯|欧洲杯|中超|亚冠|世预赛|友谊赛)/u.exec(
    title
  );
  return match?.[1] || "足球回放";
}

function commentaryFromName(name) {
  const match = /[（(]([^）)]+)[）)]/u.exec(String(name || ""));
  return match?.[1]?.trim() || "";
}

function buildAvailableReplays(
  channels,
  health = {},
  { now = Date.now(), ttlMs = DEFAULT_REPLAY_TTL_MS } = {}
) {
  const groups = new Map();

  for (const channel of channels || []) {
    if (!isReplayChannel(channel)) {
      continue;
    }
    const entry = freshPlayableHealth(channel, health, now, ttlMs);
    if (!entry) {
      continue;
    }
    const title = normalizeReplayTitle(channel.name);
    const key = replayGroupKey(channel);
    const current = groups.get(key);
    const candidate = {
      channel,
      entry,
      score: replayScore(entry, channel)
    };
    if (!current) {
      groups.set(key, {
        key,
        title,
        candidates: [candidate]
      });
      continue;
    }
    current.candidates.push(candidate);
  }

  return [...groups.values()]
    .map((group) => {
      const candidates = group.candidates.sort(
        (left, right) => right.score - left.score
      );
      const best = candidates[0];
      const channel = best.channel;
      const variants = candidates.map((candidate) => ({
        channelId: candidate.channel.id,
        label:
          commentaryFromName(candidate.channel.name) ||
          "默认解说",
        commentary: commentaryFromName(candidate.channel.name),
        quality: candidate.entry.quality || "已连接",
        latencyMs: Number(candidate.entry.latencyMs) || 0,
        sourceLabel: candidate.channel.sourceLabel || "直播源",
        streamUrl: `/api/replays/${encodeURIComponent(
          candidate.channel.id
        )}/stream`
      }));
      const id = crypto
        .createHash("sha1")
        .update(group.key)
        .digest("hex")
        .slice(0, 16);
      return {
        id: `replay-${id}`,
        channelId: channel.id,
        title: group.title,
        competition: competitionFromTitle(group.title),
        playedAt: best.entry.checkedAt,
        checkedAt: best.entry.checkedAt,
        durationSeconds: 0,
        sizeBytes: 0,
        status: "ready",
        thumbnail:
          channel.logo ||
          "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1200&q=82",
        mediaUrl: `/api/replays/${encodeURIComponent(channel.id)}/stream`,
        inputFormat: "hls",
        sourceType: "channel-replay",
        sourceLabel: channel.sourceLabel || "直播源",
        quality: best.entry.quality || "已连接",
        commentary: commentaryFromName(channel.name),
        variants,
        variantCount: variants.length,
        watchedSeconds: 0,
        score: null
      };
    })
    .sort(
      (left, right) =>
        Date.parse(right.checkedAt || 0) - Date.parse(left.checkedAt || 0)
    );
}

module.exports = {
  buildAvailableReplays,
  isReplayChannel,
  normalizeReplayTitle
};
