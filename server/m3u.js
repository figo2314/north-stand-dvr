const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const ffmpegPath = require("ffmpeg-static");

const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;

function validateHttpUrl(value) {
  const url = new URL(String(value));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("直播源只支持 HTTP 或 HTTPS");
  }
  return url;
}

function parseAttributes(line) {
  const attributes = {};
  const source = line.slice(line.indexOf(":") + 1, line.lastIndexOf(","));
  const pattern = /([\w-]+)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

function parseM3u(text, baseUrl) {
  if (!String(text).trimStart().startsWith("#EXTM3U")) {
    throw new Error("返回内容不是有效的 M3U 播放列表");
  }

  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const channels = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXTINF")) {
      continue;
    }

    const attributes = parseAttributes(line);
    const commaIndex = line.lastIndexOf(",");
    const displayName =
      commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : attributes["tvg-name"];
    let source = "";
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (!lines[cursor].startsWith("#")) {
        source = lines[cursor];
        index = cursor;
        break;
      }
    }
    if (!source || !displayName) {
      continue;
    }

    let streamUrl;
    try {
      streamUrl = new URL(source, baseUrl).toString();
    } catch {
      continue;
    }

    channels.push({
      id: crypto
        .createHash("sha1")
        .update(`${attributes["tvg-id"] || displayName}|${streamUrl}`)
        .digest("hex")
        .slice(0, 16),
      name: displayName,
      tvgName: attributes["tvg-name"] || displayName,
      tvgId: attributes["tvg-id"] || "",
      group: attributes["group-title"] || "未分组",
      logo: attributes["tvg-logo"] || "",
      streamUrl
    });
  }

  return channels;
}

async function fetchM3u(urlValue) {
  const url = validateHttpUrl(urlValue);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "NorthStandDVR/1.0"
      }
    });
    if (!response.ok) {
      throw new Error(`直播源返回 HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_PLAYLIST_BYTES) {
      throw new Error("播放列表超过 5 MB，已拒绝加载");
    }

    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_PLAYLIST_BYTES) {
      throw new Error("播放列表超过 5 MB，已拒绝加载");
    }
    return {
      url: response.url || url.toString(),
      channels: parseM3u(text, response.url || url.toString())
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeFfmpegOutput(value) {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, "[stream-url]")
    .replace(/(userid|assertID|SecurityKey|encrypt|mtv_session)=[^&\s]+/gi, "$1=[redacted]")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-2)
    .join(" ");
}

function probeStream({ url, inputFormat = "auto", durationSeconds = 4 }) {
  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    const args = [
      "-hide_banner",
      "-loglevel",
      "info",
      "-rw_timeout",
      "15000000"
    ];
    if (inputFormat === "hls") {
      args.push("-f", "hls");
    }
    args.push(
      "-i",
      url,
      "-t",
      String(Math.max(2, Math.min(10, durationSeconds))),
      "-f",
      "null",
      "-"
    );

    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        ok: false,
        message: "测试超时，流没有在 25 秒内开始传输"
      });
    }, 25_000);

    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12_000);
    });

    child.once("error", (error) => {
      finish({ ok: false, message: error.message });
    });

    child.once("close", (code, signal) => {
      if (code === 0) {
        const videoLine =
          stderr
            .split(/\r?\n/)
            .find((line) => line.includes("Video:")) || "已成功读取视频流";
        finish({
          ok: true,
          message: sanitizeFfmpegOutput(videoLine)
        });
        return;
      }
      finish({
        ok: false,
        message:
          sanitizeFfmpegOutput(stderr) ||
          `FFmpeg 退出码 ${code}${signal ? `，信号 ${signal}` : ""}`
      });
    });
  });
}

module.exports = {
  fetchM3u,
  parseAttributes,
  parseM3u,
  probeStream,
  sanitizeFfmpegOutput,
  validateHttpUrl
};
