const crypto = require("node:crypto");
const net = require("node:net");
const { Readable } = require("node:stream");

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

function liveError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isPrivateAddress(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    return true;
  }
  if (net.isIPv4(lower)) {
    const parts = lower.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (net.isIPv6(lower)) {
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }
  return false;
}

function validateLiveUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw liveError("直播地址无效");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw liveError("直播地址只支持 HTTP 或 HTTPS");
  }
  if (url.username || url.password || isPrivateAddress(url.hostname)) {
    throw liveError("直播地址不允许访问本机或私网地址");
  }
  return url;
}

function proxyUrl(session, targetUrl) {
  return `/api/live/proxy?session=${encodeURIComponent(
    session.id
  )}&url=${encodeURIComponent(String(targetUrl))}`;
}

function rewriteUri(session, value, baseUrl) {
  try {
    const target = new URL(value, baseUrl);
    session.allowedHosts.add(target.hostname);
    return proxyUrl(session, target);
  } catch {
    return value;
  }
}

function rewritePlaylist(text, baseUrl, session) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => {
          return `URI="${rewriteUri(session, uri, baseUrl)}"`;
        });
      }
      return rewriteUri(session, trimmed, baseUrl);
    })
    .join("\n");
}

async function peekBody(body) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  while (size < 16) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk = Buffer.from(result.value);
    chunks.push(chunk);
    size += chunk.length;
  }
  return {
    reader,
    chunks,
    prefix: Buffer.concat(chunks)
  };
}

async function readPlaylistBody(reader, chunks) {
  const buffers = [...chunks];
  let size = buffers.reduce((sum, chunk) => sum + chunk.length, 0);
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk = Buffer.from(result.value);
    buffers.push(chunk);
    size += chunk.length;
    if (size > 5 * 1024 * 1024) {
      throw liveError("直播播放列表超过 5 MB", 502);
    }
  }
  return Buffer.concat(buffers).toString("utf8");
}

async function* iterateBody(reader, chunks) {
  for (const chunk of chunks) {
    yield chunk;
  }
  while (true) {
    const result = await reader.read();
    if (result.done) {
      return;
    }
    yield Buffer.from(result.value);
  }
}

async function fetchFollowingRedirects(url, session) {
  let current = url;
  for (let redirects = 0; redirects <= 8; redirects += 1) {
    session.allowedHosts.add(current.hostname);
    const headers = new Headers({
      "User-Agent": "NorthStandDVR/1.0",
      Accept: "*/*"
    });
    const response = await fetch(current, {
      redirect: "manual",
      headers
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw liveError("直播源重定向缺少目标地址", 502);
      }
      current = validateLiveUrl(new URL(location, current));
      session.allowedHosts.add(current.hostname);
      continue;
    }
    return { response, finalUrl: current.toString() };
  }
  throw liveError("直播源重定向次数过多", 502);
}

function createLiveProxy() {
  const sessions = new Map();
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, session] of sessions) {
      if (session.lastAccess < cutoff) {
        sessions.delete(id);
      }
    }
  }, 30 * 60 * 1000);
  cleanup.unref?.();

  return async function liveProxy(request, response) {
    const requestedUrl = request.liveSourceUrl || request.query.url;
    let session = request.query.session
      ? sessions.get(String(request.query.session))
      : null;
    if (request.query.session && !session) {
      throw liveError("直播会话已过期，请重新打开", 410);
    }
    if (!session) {
      const initialUrl = validateLiveUrl(requestedUrl);
      session = {
        id: crypto.randomBytes(12).toString("hex"),
        allowedHosts: new Set([initialUrl.hostname]),
        lastAccess: Date.now()
      };
      sessions.set(session.id, session);
    }

    const targetUrl = validateLiveUrl(
      request.query.session ? request.query.url : requestedUrl
    );
    if (!session.allowedHosts.has(targetUrl.hostname)) {
      throw liveError("直播会话不允许访问这个地址", 403);
    }
    session.lastAccess = Date.now();

    const { response: upstream, finalUrl } = await fetchFollowingRedirects(
      targetUrl,
      session
    );
    session.allowedHosts.add(new URL(finalUrl).hostname);

    if (upstream.status >= 400) {
      throw liveError(`直播源返回 HTTP ${upstream.status}`, 502);
    }

    if (!upstream.body) {
      response.end();
      return;
    }
    const peeked = await peekBody(upstream.body);
    if (peeked.prefix.subarray(0, 7).toString("ascii") === "#EXTM3U") {
      const text = await readPlaylistBody(peeked.reader, peeked.chunks);
      response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      response.setHeader("Cache-Control", "no-store, max-age=0");
      response.send(rewritePlaylist(text, finalUrl, session));
      return;
    }

    response.status(upstream.status);
    for (const header of [
      "content-type",
      "content-length",
      "accept-ranges",
      "content-range"
    ]) {
      const value = upstream.headers.get(header);
      if (value) {
        response.setHeader(header, value);
      }
    }
    Readable.from(iterateBody(peeked.reader, peeked.chunks)).pipe(response);
  };
}

module.exports = {
  createLiveProxy,
  rewritePlaylist,
  validateLiveUrl
};
