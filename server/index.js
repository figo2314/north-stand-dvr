const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { loadEnvFile } = require("./env");

loadEnvFile(path.resolve(__dirname, "..", ".env"));

const ffmpegPath = process.env.FFMPEG_BIN || require("ffmpeg-static");
const { createBasicAuth, parseBasicUsers } = require("./auth");
const {
  enrichChannels,
  loadChannelCatalog,
  normalizeSource,
  probeChannelHealth
} = require("./channels");
const { loadEpg } = require("./epg");
const { createLiveProxy } = require("./live");
const { EventLog } = require("./logger");
const {
  lineupRefreshDue,
  parseManualTeam,
  refreshFixtureLineup,
  setLineupStoreUpdater
} = require("./lineups");
const { JsonStore } = require("./store");
const {
  buildM3u,
  buildXmltv,
  tvChannels,
  tvTokenMatches
} = require("./tv");
const {
  getActiveJobs,
  getRecordingWindow,
  safeFilename,
  scanLibrary,
  startRecording,
  stopRecording,
  stopAll
} = require("./dvr");
const { fetchM3u, probeStream, validateHttpUrl } = require("./m3u");
const { buildAvailableReplays } = require("./replays");
const { buildVersion } = require("./version");

const PORT = Number(process.env.PORT || 4173);
const HOST =
  process.env.HOST || (process.argv.includes("--lan") ? "0.0.0.0" : "127.0.0.1");
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "db.json");
const PACKAGE_VERSION = require(path.join(ROOT, "package.json")).version;
const APP_VERSION = buildVersion(ROOT, PACKAGE_VERSION);
const store = new JsonStore(DB_PATH);
const eventLog = new EventLog(path.join(ROOT, "data", "logs.jsonl"));
const liveProxy = createLiveProxy();

setLineupStoreUpdater(async (fixture, lineup, providerFixtureId) => {
  await store.updateFixture(fixture.id, {
    lineup,
    providerFixtureId: providerFixtureId || fixture.providerFixtureId || null
  });
});

const processingJobs = new Map();
const CHANNEL_CATALOG_TTL_MS = 5 * 60 * 1000;
let channelCatalogCache = null;
let schedulerTimer = null;
let lastSchedulerError = null;

async function getChannelCatalog({ force = false } = {}) {
  if (
    !force &&
    channelCatalogCache &&
    Date.now() - channelCatalogCache.loadedAt < CHANNEL_CATALOG_TTL_MS
  ) {
    return channelCatalogCache;
  }
  const catalog = await loadChannelCatalog(store.channelSources);
  channelCatalogCache = {
    ...catalog,
    loadedAt: Date.now()
  };
  return channelCatalogCache;
}

function invalidateChannelCatalog() {
  channelCatalogCache = null;
}

function lanIpv4() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (
        address.family === "IPv4" &&
        !address.internal &&
        address.address.startsWith("192.168.")
      ) {
        return address.address;
      }
    }
  }
  return null;
}

function tvBaseUrl(request) {
  const host = request.get("host") || `127.0.0.1:${PORT}`;
  if (/^(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?$/i.test(host)) {
    const address = lanIpv4();
    if (address) {
      return `${request.protocol}://${address}:${PORT}`;
    }
  }
  return `${request.protocol}://${host}`;
}

function requireTvAuthorization(request) {
  if (
    store.settings.tvRequireToken === true &&
    !tvTokenMatches(request.query.token, store.settings.tvToken)
  ) {
    throw forbidden("电视访问令牌无效");
  }
}

function fixtureLogContext(fixture) {
  return {
    fixtureId: fixture.id,
    fixture: `${fixture.home} vs ${fixture.away}`,
    competition: fixture.competition || "足球比赛"
  };
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function requireString(value, label, maxLength = 200) {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${label}不能为空`);
  }
  return value.trim().slice(0, maxLength);
}

function requireLiveSourceUrl(value, label, maxLength = 1000) {
  const text = requireString(value, label, maxLength);
  try {
    return validateHttpUrl(text).toString();
  } catch {
    throw badRequest(`${label}只支持 HTTP 或 HTTPS`);
  }
}

function parseDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`${label}不是有效时间`);
  }
  return date.toISOString();
}

function publicMediaUrl(recording) {
  if (!recording.localPath) {
    return recording.mediaUrl || null;
  }
  return `/api/recordings/${encodeURIComponent(recording.id)}/stream`;
}

function pathIsInside(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function publicState() {
  const state = store.snapshot({ redact: true });
  for (const recording of state.recordings) {
    recording.mediaUrl = publicMediaUrl(recording);
    delete recording.localPath;
  }
  return state;
}

async function getDiskStatus() {
  const recordingDir = path.resolve(
    ROOT,
    store.settings.recordingDir || "./recordings"
  );
  await fsp.mkdir(recordingDir, { recursive: true });
  const stats = await fsp.statfs(recordingDir);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  return {
    totalBytes,
    freeBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
    recordingDir
  };
}

async function healthSnapshot() {
  let disk = null;
  let diskError = null;
  try {
    disk = await getDiskStatus();
  } catch (error) {
    diskError = error.message;
  }

  return {
    version: APP_VERSION,
    ffmpeg: {
      available: Boolean(ffmpegPath && fs.existsSync(ffmpegPath)),
      path: ffmpegPath || null
    },
    disk,
    diskError,
    activeJobs: getActiveJobs(),
    lastSchedulerError
  };
}

function recordingFromFinishedJob(fixture, recordingId, details) {
  const fixtureDate = new Date(fixture.kickoffAt);
  const postRollSeconds =
    fixture.captureMode === "replay"
      ? 0
      : Number(store.settings.postRollMinutes || 0) * 60;
  return {
    id: recordingId,
    fixtureId: fixture.id,
    title: `${fixture.home} vs ${fixture.away}`,
    competition: fixture.competition || "足球比赛",
    playedAt: fixtureDate.toISOString(),
    durationSeconds:
      Number(details.durationSeconds) ||
      Math.round(Number(fixture.durationMinutes || 120) * 60 + postRollSeconds),
    sizeBytes: details.sizeBytes,
    status: "ready",
    thumbnail:
      "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1200&q=82",
    mediaUrl: null,
    localPath: details.outputPath,
    watchedSeconds: 0,
    createdAt: new Date().toISOString(),
    captureMode: fixture.captureMode || "live",
    score: null
  };
}

async function attemptScheduledRecording(fixture, { bypassWindow = false } = {}) {
  if (fixture.status === "recording" && processingJobs.has(fixture.id)) {
    return { started: false, reason: "already-recording" };
  }

  if (!bypassWindow) {
    const window = getRecordingWindow(fixture, store.settings);
    if (window.state === "waiting") {
      return { started: false, reason: "waiting" };
    }
    if (window.state === "expired") {
      await store.updateFixture(fixture.id, { status: "missed" });
      await eventLog.record(
        "warning",
        "recording.missed",
        "录制窗口已经结束",
        fixtureLogContext(fixture)
      );
      return { started: false, reason: "expired" };
    }
  }
  if (!fixture.streamUrl) {
    await store.updateFixture(fixture.id, { status: "needs-source" });
    await eventLog.record(
      "warning",
      "recording.needs_source",
      "比赛没有配置直播流地址",
      fixtureLogContext(fixture)
    );
    return { started: false, reason: "missing-stream-url" };
  }

  const recordingId = crypto.randomUUID();
  const result = await startRecording({
    fixture,
    settings: store.settings,
    captureDurationSeconds: bypassWindow
      ? Number(fixture.durationMinutes || 150) * 60
      : undefined,
    onComplete: async (details) => {
      processingJobs.delete(fixture.id);
      const recording = recordingFromFinishedJob(fixture, recordingId, details);
      await store.addRecording(recording);
      await store.updateFixture(fixture.id, {
        status: "recorded",
        recordingId
      });
      await eventLog.record(
        "info",
        "recording.completed",
        "录像已保存",
        {
          ...fixtureLogContext(fixture),
          recordingId,
          sizeBytes: details.sizeBytes,
          durationSeconds: recording.durationSeconds
        }
      );
    },
    onError: async (error) => {
      processingJobs.delete(fixture.id);
      lastSchedulerError = error.message;
      await store.updateFixture(fixture.id, {
        status: "failed",
        failureReason: error.message
      });
      await eventLog.record(
        "error",
        "recording.failed",
        error.message,
        fixtureLogContext(fixture)
      );
    },
    onCanceled: async () => {
      processingJobs.delete(fixture.id);
      await eventLog.record(
        "warning",
        "recording.canceled",
        "录制已取消，临时文件已删除",
        fixtureLogContext(fixture)
      );
      await store.removeFixture(fixture.id);
    }
  });

  if (result.started) {
    processingJobs.set(fixture.id, recordingId);
    await store.updateFixture(fixture.id, { status: "recording" });
    await eventLog.record(
      "info",
      "recording.started",
      "FFmpeg 已开始录制",
      {
        ...fixtureLogContext(fixture),
        outputPath: result.outputPath,
        durationSeconds: result.durationSeconds
      }
    );
    return { started: true };
  }

  const statusByReason = {
    "missing-stream-url": "needs-source",
    "ffmpeg-unavailable": "ffmpeg-unavailable",
    "already-recording": "recording"
  };
  await store.updateFixture(fixture.id, {
    status: statusByReason[result.reason] || "failed"
  });
  if (result.reason !== "already-recording") {
    lastSchedulerError = result.reason;
    await eventLog.record(
      "error",
      "recording.start_failed",
      result.reason || "录制启动失败",
      fixtureLogContext(fixture)
    );
  }
  return { started: false, reason: result.reason || "recording-failed" };
}

async function runScheduler() {
  try {
    lastSchedulerError = null;
    const scheduled = store.fixtures.filter(
      (fixture) =>
        fixture.record &&
        fixture.captureMode !== "replay" &&
        !fixture.recordingId &&
        [
          "scheduled",
          "recording",
          "needs-source",
          "ffmpeg-unavailable",
          "failed"
        ].includes(fixture.status)
    );
    for (const fixture of scheduled) {
      await attemptScheduledRecording(fixture);
    }
    if (process.env.FOOTBALL_API_KEY) {
      const lineupTargets = store.fixtures
        .filter((fixture) => lineupRefreshDue(fixture))
        .slice(0, 3);
      for (const fixture of lineupTargets) {
        const previousStatus = fixture.lineup?.status || null;
        try {
          const lineup = await refreshFixtureLineup(fixture);
          if (
            lineup.status === "confirmed" &&
            previousStatus !== "confirmed"
          ) {
            await eventLog.record(
              "info",
              "lineup.confirmed",
              "已获取官方首发阵容",
              fixtureLogContext(fixture)
            );
          }
        } catch (error) {
          await eventLog.record(
            "warning",
            "lineup.failed",
            error.message,
            fixtureLogContext(fixture)
          );
        }
      }
    }
  } catch (error) {
    lastSchedulerError = error.message;
    console.error("[scheduler]", error);
    await eventLog.record("error", "scheduler.failed", error.message);
  }
}

async function recoverInterruptedRecordings() {
  const interrupted = store.fixtures.filter(
    (fixture) => fixture.status === "recording" && !processingJobs.has(fixture.id)
  );
  for (const fixture of interrupted) {
    await store.updateFixture(fixture.id, {
      status: "failed",
      failureReason: "服务重启，上一次录制未完成"
    });
    await eventLog.record(
      "warning",
      "recording.interrupted",
      "服务重启，上一次录制未完成",
      fixtureLogContext(fixture)
    );
  }
}

function parseTeamTitle(title) {
  const delimiter = title.match(/\s+(?:vs|VS|v|对|对阵)\s+/);
  if (!delimiter || delimiter.index == null) {
    return { home: title, away: "待识别" };
  }
  return {
    home: title.slice(0, delimiter.index).trim() || "主队",
    away: title.slice(delimiter.index + delimiter[0].length).trim() || "客队"
  };
}

async function addImportedRecording({
  absolutePath,
  title,
  sizeBytes,
  createdAt
}) {
  const teams = parseTeamTitle(title);
  const id = crypto.randomUUID();
  const recording = {
    id,
    fixtureId: null,
    title: `${teams.home} vs ${teams.away}`,
    competition: "本地录像",
    playedAt: createdAt,
    durationSeconds: 0,
    sizeBytes,
    status: "ready",
    thumbnail:
      "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&w=1200&q=82",
    mediaUrl: null,
    localPath: absolutePath,
    watchedSeconds: 0,
    createdAt: new Date().toISOString(),
    score: null
  };
  await store.addRecording(recording);
  return recording;
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
const basicAuth = createBasicAuth({
  users: parseBasicUsers(process.env.APP_BASIC_USERS),
  realm: process.env.APP_BASIC_REALM || "North Stand DVR"
});
app.use((request, response, next) => {
  const publicTvPath =
    request.path === "/api/tv/playlist.m3u" ||
    request.path === "/api/tv/epg.xml" ||
    request.path.startsWith("/api/tv/stream/");
  if (
    request.path === "/api/health" ||
    (publicTvPath &&
      (store.settings?.tvRequireToken !== true ||
        tvTokenMatches(request.query.token, store.settings?.tvToken))) ||
    (request.path === "/api/live/proxy" && request.query.session)
  ) {
    next();
    return;
  }
  basicAuth(request, response, next);
});
app.use(express.json({ limit: "256kb" }));
app.get(["/library", "/library.html"], (_request, response) => {
  response.sendFile(path.join(ROOT, "public", "index.html"));
});

app.use(express.static(path.join(ROOT, "public")));
app.get("/vendor/lucide.js", (request, response) => {
  response.sendFile(path.join(ROOT, "node_modules", "lucide", "dist", "umd", "lucide.min.js"));
});
app.get("/vendor/hls.js", (request, response) => {
  response.sendFile(path.join(ROOT, "node_modules", "hls.js", "dist", "hls.min.js"));
});

app.get(
  "/api/state",
  asyncRoute(async (request, response) => {
    response.json({
      ...publicState(),
      health: await healthSnapshot()
    });
  })
);

app.get(
  "/api/health",
  asyncRoute(async (request, response) => {
    response.json(await healthSnapshot());
  })
);

app.get(
  "/api/tv/config",
  asyncRoute(async (request, response) => {
    const baseUrl = tvBaseUrl(request);
    const token = store.settings.tvRequireToken
      ? store.settings.tvToken
      : "";
    const tokenQuery = token
      ? `?token=${encodeURIComponent(token)}`
      : "";
    response.json({
      token,
      requireToken: store.settings.tvRequireToken,
      playlistUrl: `${baseUrl}/api/tv/playlist.m3u${tokenQuery}`,
      epgUrl: `${baseUrl}/api/tv/epg.xml${tokenQuery}`
    });
  })
);

app.post(
  "/api/tv/token/regenerate",
  asyncRoute(async (request, response) => {
    const tvToken = crypto.randomBytes(24).toString("hex");
    await store.updateSettings({ tvToken });
    response.json({ tvToken });
  })
);

app.get(
  "/api/tv/playlist.m3u",
  asyncRoute(async (request, response) => {
    requireTvAuthorization(request);
    const catalog = await getChannelCatalog();
    const channels = tvChannels(catalog.channels);
    response.setHeader("Content-Type", "audio/x-mpegurl; charset=utf-8");
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.send(
      buildM3u(
        channels,
        tvBaseUrl(request),
        store.settings.tvRequireToken ? store.settings.tvToken : ""
      )
    );
  })
);

app.get(
  "/api/tv/epg.xml",
  asyncRoute(async (request, response) => {
    requireTvAuthorization(request);
    const catalog = await getChannelCatalog();
    const channels = tvChannels(catalog.channels);
    const epg = await loadEpg(catalog.epgUrls || []);
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.send(
      buildXmltv(channels, epg.channels || {}, tvBaseUrl(request))
    );
  })
);

app.get(
  "/api/tv/stream/:id",
  asyncRoute(async (request, response) => {
    requireTvAuthorization(request);
    const catalog = await getChannelCatalog();
    const channel = catalog.channels.find(
      (item) => item.id === request.params.id
    );
    if (!channel) {
      throw notFound("没有找到这个电视频道");
    }
    request.liveSourceUrl = channel.streamUrl;
    await liveProxy(request, response);
  })
);

app.get(
  "/api/logs",
  asyncRoute(async (request, response) => {
    response.json({
      entries: eventLog.list({
        limit: request.query.limit,
        level: request.query.level,
        fixtureId: request.query.fixtureId
      })
    });
  })
);

app.delete(
  "/api/logs",
  asyncRoute(async (request, response) => {
    await eventLog.clear();
    response.status(204).end();
  })
);

app.get("/api/live/proxy", asyncRoute(liveProxy));

app.get(
  "/api/system/diagnostics",
  asyncRoute(async (request, response) => {
    const ffmpeg = {
      path: ffmpegPath || null,
      exists: Boolean(ffmpegPath && fs.existsSync(ffmpegPath))
    };
    if (ffmpeg.exists) {
      const result = spawnSync(ffmpegPath, ["-version"], {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true
      });
      ffmpeg.exitCode = result.status;
      ffmpeg.signal = result.signal;
      ffmpeg.error = result.error?.message || null;
      ffmpeg.stdout = String(result.stdout || "")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, 2);
      ffmpeg.stderr = String(result.stderr || "").trim().slice(0, 2000);
    }

    response.json({
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        totalBytes: os.totalmem(),
        freeBytes: os.freemem(),
        processRssBytes: process.memoryUsage().rss
      },
      ffmpeg
    });
  })
);

app.post(
  "/api/settings",
  asyncRoute(async (request, response) => {
    const body = request.body || {};
    const patch = {};

    if ("displayName" in body) {
      patch.displayName = requireString(body.displayName, "名称", 40);
    }
    if ("spoilerMode" in body) {
      patch.spoilerMode = Boolean(body.spoilerMode);
    }
    if ("burnInMask" in body) {
      patch.burnInMask = Boolean(body.burnInMask);
    }
    if ("recordingDir" in body) {
      patch.recordingDir = requireString(body.recordingDir, "录像目录", 300);
    }
    if ("m3uUrl" in body) {
      patch.m3uUrl = String(body.m3uUrl || "").trim().slice(0, 1000);
    }
    if ("tvRequireToken" in body) {
      patch.tvRequireToken = Boolean(body.tvRequireToken);
    }
    if ("preRollMinutes" in body) {
      patch.preRollMinutes = Math.max(0, Math.min(60, Number(body.preRollMinutes) || 0));
    }
    if ("postRollMinutes" in body) {
      patch.postRollMinutes = Math.max(
        0,
        Math.min(90, Number(body.postRollMinutes) || 0)
      );
    }
    if ("diskWarningGb" in body) {
      patch.diskWarningGb = Math.max(1, Math.min(1000, Number(body.diskWarningGb) || 20));
    }
    if (body.mask && typeof body.mask === "object") {
      patch.mask = {};
      for (const key of ["x", "y", "width", "height"]) {
        if (key in body.mask) {
          patch.mask[key] = Math.max(0, Math.min(100, Number(body.mask[key]) || 0));
        }
      }
      if ("color" in body.mask) {
        const color = String(body.mask.color);
        if (!/^#[0-9a-f]{6}$/i.test(color)) {
          throw badRequest("遮罩颜色必须是十六进制颜色");
        }
        patch.mask.color = color;
      }
    }

    const settings = await store.updateSettings(patch);
    await eventLog.record("info", "settings.updated", "设置已更新");
    response.json({ settings });
  })
);

app.post(
  "/api/fixtures",
  asyncRoute(async (request, response) => {
    const body = request.body || {};
    const fixture = {
      id: crypto.randomUUID(),
      home: requireString(body.home, "主队", 60),
      away: requireString(body.away, "客队", 60),
      competition: requireString(body.competition || "足球比赛", "赛事", 80),
      kickoffAt: parseDate(body.kickoffAt, "开球时间"),
      durationMinutes: Math.max(30, Math.min(240, Number(body.durationMinutes) || 120)),
      record: body.record !== false,
      status: "scheduled",
      streamUrl: typeof body.streamUrl === "string" ? body.streamUrl.trim() : "",
      inputFormat: body.inputFormat === "hls" ? "hls" : "auto",
      sourceLabel:
        typeof body.sourceLabel === "string"
          ? body.sourceLabel.trim().slice(0, 40)
          : "",
      recordingId: null,
      isDemo: false,
      result: null
    };
    await store.addFixture(fixture);
    await eventLog.record(
      "info",
      "fixture.created",
      "已加入录制日程",
      fixtureLogContext(fixture)
    );
    response.status(201).json({ fixture });
    await runScheduler();
  })
);

app.post(
  "/api/fixtures/:id/lineup/refresh",
  asyncRoute(async (request, response) => {
    const fixture = store.findFixture(request.params.id);
    if (!fixture) {
      throw notFound("没有找到这场比赛");
    }
    const lineup = await refreshFixtureLineup(fixture, { force: true });
    response.json({ lineup });
  })
);

app.post(
  "/api/fixtures/:id/lineup/manual",
  asyncRoute(async (request, response) => {
    const fixture = store.findFixture(request.params.id);
    if (!fixture) {
      throw notFound("没有找到这场比赛");
    }
    const home = parseManualTeam(
      requireString(request.body?.homeText, "主队首发", 8000)
    );
    const away = parseManualTeam(
      requireString(request.body?.awayText, "客队首发", 8000)
    );
    if (home.startXI.length < 7 || away.startXI.length < 7) {
      throw badRequest("双方首发至少需要各识别出 7 名球员");
    }
    const lineup = {
      status: "manual",
      provider: "manual",
      fetchedAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      attempts: 0,
      quotaRemaining: fixture.lineup?.quotaRemaining ?? null,
      home,
      away,
      error: null
    };
    await store.updateFixture(fixture.id, { lineup });
    await eventLog.record(
      "info",
      "lineup.manual",
      "已保存手动录入的首发阵容",
      fixtureLogContext(fixture)
    );
    response.json({ lineup });
  })
);

app.get(
  "/api/lineups/status",
  asyncRoute(async (request, response) => {
    const quotas = store.fixtures
      .map((fixture) => Number(fixture.lineup?.quotaRemaining))
      .filter(Number.isFinite);
    response.json({
      configured: Boolean(process.env.FOOTBALL_API_KEY),
      provider: process.env.FOOTBALL_API_PROVIDER || "api-football",
      quotaRemaining: quotas.length ? Math.min(...quotas) : null,
      confirmed: store.fixtures.filter(
        (fixture) => fixture.lineup?.status === "confirmed"
      ).length
    });
  })
);

app.post(
  "/api/replays",
  asyncRoute(async (request, response) => {
    const body = request.body || {};
    const fixture = {
      id: crypto.randomUUID(),
      home: requireString(body.home, "主队", 60),
      away: requireString(body.away, "客队", 60),
      competition: requireString(body.competition || "足球比赛", "赛事", 80),
      kickoffAt: parseDate(body.kickoffAt, "比赛时间"),
      durationMinutes: Math.max(1, Math.min(240, Number(body.durationMinutes) || 150)),
      record: true,
      status: "scheduled",
      streamUrl: requireString(body.streamUrl, "回放流地址", 2000),
      inputFormat: body.inputFormat === "hls" ? "hls" : "auto",
      sourceLabel:
        typeof body.sourceLabel === "string"
          ? body.sourceLabel.trim().slice(0, 40)
          : "",
      captureMode: "replay",
      recordingId: null,
      isDemo: false,
      result: null
    };

    await store.addFixture(fixture);
    const result = await attemptScheduledRecording(fixture, { bypassWindow: true });
    if (!result.started) {
      await store.removeFixture(fixture.id);
      const messages = {
        "missing-stream-url": "回放地址不能为空",
        "ffmpeg-unavailable": "当前环境没有可用的 FFmpeg",
        "already-recording": "这场比赛已经在录制",
        "recording-failed": lastSchedulerError || "回放录制启动失败"
      };
      response.status(422).json({
        error: messages[result.reason] || "回放录制启动失败"
      });
      return;
    }

    response.status(202).json({
      fixture: store.findFixture(fixture.id),
      active: processingJobs.has(fixture.id)
    });
  })
);

app.delete(
  "/api/fixtures/:id",
  asyncRoute(async (request, response) => {
    const fixture = store.findFixture(request.params.id);
    if (!fixture) {
      throw notFound("没有找到这场比赛");
    }
    if (fixture.recordingId || fixture.status === "recorded") {
      throw badRequest("这场比赛已经录制完成，不能从日程中移除");
    }
    if (fixture.status === "recording" || processingJobs.has(fixture.id)) {
      throw badRequest("这场比赛正在录制，暂时不能取消");
    }

    await store.removeFixture(fixture.id);
    await eventLog.record(
      "info",
      "fixture.removed",
      "已从录制日程移除",
      fixtureLogContext(fixture)
    );
    response.status(204).end();
  })
);

app.patch(
  "/api/fixtures/:id",
  asyncRoute(async (request, response) => {
    const fixture = store.findFixture(request.params.id);
    if (!fixture) {
      throw notFound("没有找到这场比赛");
    }
    const body = request.body || {};
    const patch = {};

    if ("home" in body) patch.home = requireString(body.home, "主队", 60);
    if ("away" in body) patch.away = requireString(body.away, "客队", 60);
    if ("competition" in body) {
      patch.competition = requireString(body.competition, "赛事", 80);
    }
    if ("kickoffAt" in body) {
      patch.kickoffAt = parseDate(body.kickoffAt, "开球时间");
      patch.status = "scheduled";
    }
    if ("durationMinutes" in body) {
      patch.durationMinutes = Math.max(
        30,
        Math.min(240, Number(body.durationMinutes) || 120)
      );
    }
    if ("record" in body) patch.record = Boolean(body.record);
    if ("streamUrl" in body) {
      patch.streamUrl = String(body.streamUrl || "").trim();
      if (fixture.status !== "recorded") patch.status = "scheduled";
    }
    if ("inputFormat" in body) {
      patch.inputFormat = body.inputFormat === "hls" ? "hls" : "auto";
    }

    const updated = await store.updateFixture(fixture.id, patch);
    response.json({ fixture: updated });
    await runScheduler();
  })
);

app.post(
  "/api/fixtures/:id/record-now",
  asyncRoute(async (request, response) => {
    const fixture = store.findFixture(request.params.id);
    if (!fixture) {
      throw notFound("没有找到这场比赛");
    }
    if (!fixture.streamUrl) {
      throw badRequest("请先填写直播流地址");
    }
    fixture.status = "scheduled";
    await attemptScheduledRecording(fixture);
    const updated = store.findFixture(fixture.id);
    response.json({
      fixture: updated,
      active: processingJobs.has(fixture.id)
    });
  })
);

app.post(
  "/api/fixtures/:id/stop-recording",
  asyncRoute(async (request, response) => {
    const result = stopRecording(request.params.id);
    if (!result) {
      throw badRequest("这场比赛当前没有在录制");
    }
    response.json({ stopping: true, discard: false });
  })
);

app.post(
  "/api/fixtures/:id/cancel-recording",
  asyncRoute(async (request, response) => {
    const result = stopRecording(request.params.id, { discard: true });
    if (!result) {
      throw badRequest("这场比赛当前没有在录制");
    }
    response.json({ stopping: true, discard: true });
  })
);

app.get(
  "/api/fixtures/:id/preview",
  asyncRoute(async (request, response) => {
    const job = getActiveJobs().find(
      (activeJob) => activeJob.fixtureId === request.params.id
    );
    if (!job || !fs.existsSync(job.outputPath)) {
      throw notFound("这段录像还没有可用的预览画面");
    }

    const previewDirectory = path.join(ROOT, "data", "previews");
    await fsp.mkdir(previewDirectory, { recursive: true });
    const previewPath = path.join(
      previewDirectory,
      `${safeFilename(request.params.id)}.jpg`
    );
    const previewStats = fs.existsSync(previewPath)
      ? fs.statSync(previewPath)
      : null;

    if (!previewStats || Date.now() - previewStats.mtimeMs > 1200) {
      const baseArgs = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y"
      ];
      const outputArgs = [
        "-frames:v",
        "1",
        "-vf",
        "scale=720:-2",
        "-q:v",
        "4",
        previewPath
      ];
      let result = spawnSync(
        ffmpegPath,
        [...baseArgs, "-sseof", "-2", "-i", job.outputPath, ...outputArgs],
        { timeout: 6000, windowsHide: true }
      );
      if (result.status !== 0 || !fs.existsSync(previewPath)) {
        result = spawnSync(
          ffmpegPath,
          [...baseArgs, "-i", job.outputPath, ...outputArgs],
          { timeout: 6000, windowsHide: true }
        );
      }
      if (result.status !== 0 || !fs.existsSync(previewPath)) {
        throw notFound("预览画面还没有生成");
      }
    }

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Content-Type", "image/jpeg");
    response.sendFile(previewPath);
  })
);

app.post(
  "/api/channels/probe",
  asyncRoute(async (request, response) => {
    const streamUrl = requireLiveSourceUrl(
      request.body?.url,
      "频道地址",
      2000
    );
    const key = requireString(
      request.body?.healthKey || "",
      "健康记录标识",
      80
    );
    const current = store.channelHealth[key] || null;
    const { result, health, score } = await probeChannelHealth({
      streamUrl,
      current
    });
    await store.updateChannelHealth(key, health);
    response.status(result.ok ? 200 : 422).json({
      ...result,
      health,
      score,
      key
    });
  })
);

app.get(
  "/api/channels",
  asyncRoute(async (request, response) => {
    const force = request.query.refresh === "1";
    const catalog = await getChannelCatalog({ force });
    response.json({
      count: catalog.channels.length,
      channels: enrichChannels(catalog.channels, store.channelHealth),
      sources: catalog.sources,
      epgUrls: catalog.epgUrls || [],
      cachedAt: new Date(catalog.loadedAt).toISOString()
    });
  })
);

app.get(
  "/api/replays/available",
  asyncRoute(async (request, response) => {
    const catalog = await getChannelCatalog({
      force: request.query.refresh === "1"
    });
    const replays = buildAvailableReplays(
      catalog.channels,
      store.channelHealth
    );
    response.json({ count: replays.length, replays });
  })
);

app.get(
  "/api/replays/:id/stream",
  asyncRoute(async (request, response) => {
    const catalog = await getChannelCatalog();
    const channel = catalog.channels.find(
      (item) => item.id === request.params.id
    );
    if (!channel) {
      throw notFound("没有找到这个回放线路");
    }
    request.liveSourceUrl = channel.streamUrl;
    return liveProxy(request, response);
  })
);

app.post(
  "/api/epg",
  asyncRoute(async (request, response) => {
    const urls = Array.isArray(request.body?.urls)
      ? request.body.urls
          .slice(0, 5)
          .map((url) => requireLiveSourceUrl(url, "节目单地址", 1000))
      : [];
    response.json(await loadEpg(urls));
  })
);

app.get(
  "/api/channel-sources",
  asyncRoute(async (request, response) => {
    response.json({
      sources: store.channelSources.map((source) => normalizeSource(source))
    });
  })
);

app.post(
  "/api/channel-sources",
  asyncRoute(async (request, response) => {
    const body = request.body || {};
    const id = String(body.id || "").trim().slice(0, 80);
    const existing = id
      ? store.channelSources.find((source) => source.id === id)
      : null;
    const source = normalizeSource({
      id: existing?.id || id || `source-${crypto.randomUUID().slice(0, 8)}`,
      label: requireString(body.label, "直播源名称", 60),
      url: requireLiveSourceUrl(body.url, "直播源地址"),
      fallbackUrl: body.fallbackUrl
        ? requireLiveSourceUrl(body.fallbackUrl, "备用直播源地址")
        : "",
      enabled: body.enabled !== false,
      builtIn: existing?.builtIn,
      priority: body.priority
    });
    const sources = existing
      ? store.channelSources.map((item) => (item.id === id ? source : item))
      : [...store.channelSources, source];
    await store.replaceChannelSources(sources);
    invalidateChannelCatalog();
    response.status(existing ? 200 : 201).json({ source });
  })
);

app.delete(
  "/api/channel-sources/:id",
  asyncRoute(async (request, response) => {
    const source = store.channelSources.find(
      (item) => item.id === request.params.id
    );
    if (!source) {
      throw notFound("没有找到这个直播源");
    }
    if (source.builtIn) {
      throw badRequest("内置直播源不能删除，可以将其停用");
    }
    await store.replaceChannelSources(
      store.channelSources.filter((item) => item.id !== source.id)
    );
    invalidateChannelCatalog();
    response.status(204).end();
  })
);

app.post(
  "/api/sources/m3u",
  asyncRoute(async (request, response) => {
    const sourceUrl = requireString(request.body?.url, "直播源地址", 1000);
    const playlist = await fetchM3u(sourceUrl);
    response.json({
      url: playlist.url,
      count: playlist.channels.length,
      channels: playlist.channels
    });
  })
);

app.post(
  "/api/sources/probe",
  asyncRoute(async (request, response) => {
    const streamUrl = requireString(request.body?.url, "频道地址", 2000);
    const inputFormat = request.body?.inputFormat === "hls" ? "hls" : "auto";
    const quick = request.body?.quick === true;
    const result = await probeStream({
      url: streamUrl,
      inputFormat,
      durationSeconds: 4,
      frames: quick ? 1 : 0
    });
    response.status(result.ok ? 200 : 422).json(result);
  })
);

app.post(
  "/api/recordings/:id/reveal",
  asyncRoute(async (request, response) => {
    const recording = store.findRecording(request.params.id);
    if (!recording) {
      throw notFound("没有找到这段录像");
    }

    let score = recording.score;
    const fixture = recording.fixtureId
      ? store.findFixture(recording.fixtureId)
      : null;
    if (!score && fixture?.result) {
      score = fixture.result;
    }
    if (!score) {
      throw badRequest("这段录像还没有录入赛果");
    }

    const revealedScore = { ...score, revealed: true };
    await store.updateRecording(recording.id, { score: revealedScore });
    if (fixture?.result) {
      await store.updateFixture(fixture.id, {
        result: { ...fixture.result, revealed: true }
      });
    }
    response.json({ score: revealedScore });
  })
);

app.patch(
  "/api/recordings/:id/progress",
  asyncRoute(async (request, response) => {
    const recording = store.findRecording(request.params.id);
    if (!recording) {
      throw notFound("没有找到这段录像");
    }
    const watchedSeconds = Math.max(0, Number(request.body?.watchedSeconds) || 0);
    const updated = await store.updateRecording(recording.id, { watchedSeconds });
    response.json({ recording: { id: updated.id, watchedSeconds: updated.watchedSeconds } });
  })
);

app.delete(
  "/api/recordings/:id",
  asyncRoute(async (request, response) => {
    const recording = store.findRecording(request.params.id);
    if (!recording) {
      throw notFound("没有找到这段录像");
    }

    let fileDeleted = false;
    if (recording.localPath) {
      const recordingRoot = path.resolve(
        ROOT,
        store.settings.recordingDir || "./recordings"
      );
      const absolutePath = path.resolve(recording.localPath);
      if (pathIsInside(recordingRoot, absolutePath)) {
        await fsp.rm(absolutePath, { force: true });
        fileDeleted = true;
      }
    }

    await store.removeRecording(recording.id);
    await eventLog.record("info", "recording.deleted", "录像已从库中删除", {
      recordingId: recording.id,
      fixtureId: recording.fixtureId,
      title: recording.title
    });
    if (recording.fixtureId) {
      const fixture = store.findFixture(recording.fixtureId);
      if (fixture) {
        await store.removeFixture(fixture.id);
      }
    }

    response.json({ deleted: true, fileDeleted });
  })
);

app.post(
  "/api/library/scan",
  asyncRoute(async (request, response) => {
    const discovered = await scanLibrary(store.settings, store.recordings);
    const imported = [];
    for (const file of discovered) {
      imported.push(await addImportedRecording(file));
    }
    response.json({ imported, count: imported.length });
  })
);

app.post(
  "/api/recordings/import",
  asyncRoute(async (request, response) => {
    const inputPath = requireString(request.body?.localPath, "录像路径", 1000);
    const absolutePath = path.resolve(inputPath);
    const stats = await fsp.stat(absolutePath).catch(() => null);
    if (!stats?.isFile()) {
      throw badRequest("指定的录像文件不存在");
    }
    const extension = path.extname(absolutePath).toLowerCase();
    if (![".mp4", ".mkv", ".mov", ".ts", ".m4v", ".webm"].includes(extension)) {
      throw badRequest("暂不支持这个视频格式");
    }
    const recording = await addImportedRecording({
      absolutePath,
      title: safeFilename(path.basename(absolutePath, extension)),
      sizeBytes: stats.size,
      createdAt: stats.birthtime.toISOString()
    });
    response.status(201).json({ recording });
  })
);

app.get(
  "/api/recordings/:id/stream",
  asyncRoute(async (request, response) => {
    const recording = store.findRecording(request.params.id);
    if (!recording?.localPath) {
      throw notFound("这段录像没有可用的本地文件");
    }

    const absolutePath = path.resolve(recording.localPath);
    const stats = await fsp.stat(absolutePath).catch(() => null);
    if (!stats?.isFile()) {
      throw notFound("录像文件已移动或删除");
    }

    const range = request.headers.range;
    const extension = path.extname(absolutePath).toLowerCase();
    const contentTypes = {
      ".mp4": "video/mp4",
      ".m4v": "video/mp4",
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".mkv": "video/x-matroska",
      ".ts": "video/mp2t"
    };
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", contentTypes[extension] || "application/octet-stream");

    if (!range) {
      response.setHeader("Content-Length", stats.size);
      fs.createReadStream(absolutePath).pipe(response);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.status(416).end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stats.size - 1;
    if (start > end || start >= stats.size) {
      response.setHeader("Content-Range", `bytes */${stats.size}`);
      response.status(416).end();
      return;
    }
    const boundedEnd = Math.min(end, stats.size - 1);
    response.status(206);
    response.setHeader("Content-Range", `bytes ${start}-${boundedEnd}/${stats.size}`);
    response.setHeader("Content-Length", boundedEnd - start + 1);
    fs.createReadStream(absolutePath, { start, end: boundedEnd }).pipe(response);
  })
);

app.post(
  "/api/system/scan",
  asyncRoute(async (request, response) => {
    await runScheduler();
    response.json(await healthSnapshot());
  })
);

app.use((request, response) => {
  response.status(404).json({ error: "没有找到这个接口" });
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  const status = Number(error.status) || 500;
  if (status >= 500) {
    console.error(error);
  }
  eventLog
    .record(status >= 500 ? "error" : "warning", "request.failed", error.message, {
      method: request.method,
      path: request.path,
      status
    })
    .catch(() => {});
  response.status(status).json({
    error: status >= 500 ? "服务器处理失败" : error.message
  });
});

async function boot() {
  await store.init();
  await eventLog.init();
  await fsp.mkdir(path.resolve(ROOT, store.settings.recordingDir), { recursive: true });
  await recoverInterruptedRecordings();
  await eventLog.record("info", "app.started", "北看台服务已启动", {
    host: HOST,
    port: PORT,
    pid: process.pid
  });
  schedulerTimer = setInterval(runScheduler, 30_000);
  schedulerTimer.unref();
  await runScheduler();

  const server = app.listen(PORT, HOST, () => {
    console.log(`北看台已启动：http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    clearInterval(schedulerTimer);
    stopAll();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

boot().catch((error) => {
  console.error(error);
  process.exit(1);
});
