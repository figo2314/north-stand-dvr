const crypto = require("node:crypto");

function tvTokenMatches(provided, expected) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(expected || ""));
  return (
    left.length > 0 &&
    right.length > 0 &&
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmltvDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    " +0000"
  ].join("");
}

function tvChannels(channels) {
  return channels.filter((channel) => !channel.group.startsWith("体育-"));
}

function buildM3u(channels, baseUrl, token) {
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
  const lines = [
    `#EXTM3U x-tvg-url="${baseUrl}/api/tv/epg.xml${tokenQuery}"`
  ];
  for (const channel of channels) {
    lines.push(
      `#EXTINF:-1 tvg-id="${xmlEscape(channel.id)}" tvg-name="${xmlEscape(
        channel.name
      )}" tvg-logo="${xmlEscape(channel.logo || "")}" group-title="${xmlEscape(
        channel.group
      )}",${channel.name}`
    );
    lines.push(
      `${baseUrl}/api/tv/stream/${encodeURIComponent(
        channel.id
      )}${tokenQuery}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function buildXmltv(channels, epg, baseUrl) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tv generator-info-name="North Stand DVR" source-info-url="${xmlEscape(
      baseUrl
    )}">`
  ];
  for (const channel of channels) {
    lines.push(`  <channel id="${xmlEscape(channel.id)}">`);
    lines.push(`    <display-name>${xmlEscape(channel.name)}</display-name>`);
    if (channel.logo) {
      lines.push(`    <icon src="${xmlEscape(channel.logo)}" />`);
    }
    lines.push("  </channel>");
  }
  for (const channel of channels) {
    const guide =
      epg[channel.tvgId] || epg[channel.tvgName] || epg[channel.name] || null;
    const programmes = [guide?.current, guide?.next].filter(Boolean);
    const seen = new Set();
    for (const programme of programmes) {
      const key = `${programme.start}|${programme.stop}|${programme.title}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      lines.push(
        `  <programme start="${xmltvDate(
          programme.start
        )}" stop="${xmltvDate(programme.stop)}" channel="${xmlEscape(
          channel.id
        )}">`
      );
      lines.push(`    <title>${xmlEscape(programme.title)}</title>`);
      lines.push("  </programme>");
    }
  }
  lines.push("</tv>");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildM3u,
  buildXmltv,
  tvChannels,
  tvTokenMatches,
  xmlEscape,
  xmltvDate
};
