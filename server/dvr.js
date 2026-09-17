const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const ffmpegPath = process.env.FFMPEG_BIN || require("ffmpeg-static");

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".mov", ".ts", ".m4v", ".webm"]);
const activeJobs = new Map();

function safeFilename(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function getRecordingWindow(fixture, settings, now = new Date()) {
  const kickoff = new Date(fixture.kickoffAt);
  const preRollMs = Number(settings.preRollMinutes || 0) * 60_000;
  const postRollMs = Number(settings.postRollMinutes || 0) * 60_000;
  const startAt = new Date(kickoff.getTime() - preRollMs);
  const endAt = new Date(
    kickoff.getTime() + Number(fixture.durationMinutes || 120) * 60_000 + postRollMs
  );

  if (now < startAt) {
    return { state: "waiting", startAt, endAt };
  }
  if (now >= endAt) {
    return { state: "expired", startAt, endAt };
  }
  return { state: "within", startAt, endAt };
}

function buildMaskFilter(mask) {
  if (!mask) {
    return null;
  }
  const x = Math.max(0, Math.min(100, Number(mask.x || 0))) / 100;
  const y = Math.max(0, Math.min(100, Number(mask.y || 0))) / 100;
  const width = Math.max(0, Math.min(100, Number(mask.width || 0))) / 100;
  const height = Math.max(0, Math.min(100, Number(mask.height || 0))) / 100;

  if (!width || !height) {
    return null;
  }

  return [
    `drawbox=x=iw*${x}`,
    `y=ih*${y}`,
    `w=iw*${width}`,
    `h=ih*${height}`,
    "color=black@1",
    "t=fill"
  ].join(":");
}

function buildFfmpegArgs({
  streamUrl,
  durationSeconds,
  outputPath,
  burnInMask,
  mask,
  inputFormat = "auto",
  limitInputDuration = false
}) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-progress",
    "pipe:1",
    "-nostats",
    "-y"
  ];

  if (inputFormat === "hls") {
    args.push("-f", "hls");
  }

  if (limitInputDuration) {
    args.push("-t", String(Math.max(1, Math.ceil(durationSeconds))));
  }

  args.push("-i", streamUrl);

  if (!limitInputDuration) {
    args.push("-t", String(Math.max(1, Math.ceil(durationSeconds))));
  }

  const filter = burnInMask ? buildMaskFilter(mask) : null;
  if (filter) {
    args.push("-vf", filter);
  } else {
    args.push("-c", "copy");
    args.push("-bsf:a", "aac_adtstoasc");
  }

  args.push("-movflags", "+frag_keyframe+empty_moov+default_base_moof", outputPath);
  return args;
}

function resolveRecordingPath(settings, fixture) {
  const root = path.resolve(process.cwd(), settings.recordingDir || "./recordings");
  const date = new Date(fixture.kickoffAt);
  const dateStamp = date.toISOString().slice(0, 10);
  const sourceLabel = fixture.sourceLabel
    ? ` ${safeFilename(fixture.sourceLabel)}`
    : "";
  const name = `${dateStamp} ${safeFilename(
    `${fixture.home} vs ${fixture.away}`
  )}${sourceLabel}.mp4`;
  return path.join(root, name);
}

async function ensureDirectory(directoryPath) {
  await fsp.mkdir(directoryPath, { recursive: true });
}

function resolveCaptureDurationSeconds({
  fixture,
  settings,
  captureDurationSeconds,
  now = Date.now()
}) {
  if (Number(captureDurationSeconds) > 0) {
    return Math.max(1, Number(captureDurationSeconds));
  }
  const endAt =
    new Date(fixture.kickoffAt).getTime() +
    Number(fixture.durationMinutes || 120) * 60_000 +
    Number(settings.postRollMinutes || 0) * 60_000;
  return Math.max(1, (endAt - now) / 1000);
}

async function startRecording({
  fixture,
  settings,
  captureDurationSeconds,
  onComplete,
  onCanceled,
  onError
}) {
  if (activeJobs.has(fixture.id)) {
    return { started: false, reason: "already-recording" };
  }
  if (!fixture.streamUrl) {
    return { started: false, reason: "missing-stream-url" };
  }
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    return { started: false, reason: "ffmpeg-unavailable" };
  }

  const outputPath = resolveRecordingPath(settings, fixture);
  await ensureDirectory(path.dirname(outputPath));

  const durationSeconds = resolveCaptureDurationSeconds({
    fixture,
    settings,
    captureDurationSeconds
  });
  const args = buildFfmpegArgs({
    streamUrl: fixture.streamUrl,
    durationSeconds,
    outputPath,
    burnInMask: settings.burnInMask,
    mask: settings.mask,
    inputFormat: fixture.inputFormat,
    limitInputDuration: Number(captureDurationSeconds) > 0
  });

  const child = spawn(ffmpegPath, args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stderr = "";
  let progressBuffer = "";
  const job = {
    child,
    outputPath,
    startedAt: new Date().toISOString(),
    durationSeconds: Math.round(durationSeconds),
    progressSeconds: 0,
    speed: null,
    discard: false
  };
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-5000);
  });
  child.stdout.on("data", (chunk) => {
    progressBuffer = `${progressBuffer}${chunk.toString()}`;
    const lines = progressBuffer.split(/\r?\n/);
    progressBuffer = lines.pop() || "";
    for (const line of lines) {
      const separator = line.indexOf("=");
      if (separator < 0) {
        continue;
      }
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (key === "out_time_us" || key === "out_time_ms") {
        job.progressSeconds = Math.max(0, Number(value) / 1_000_000);
      } else if (key === "speed" && value !== "N/A") {
        job.speed = value;
      }
    }
  });

  activeJobs.set(fixture.id, job);

  let settled = false;
  const finish = (callback) => {
    if (settled) {
      return;
    }
    settled = true;
    activeJobs.delete(fixture.id);
    callback();
  };

  child.once("error", (error) => {
    finish(() => onError?.(error));
  });

  child.once("close", (code, signal) => {
    const stats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
    if (job.discard) {
      if (stats) {
        fs.rmSync(outputPath, { force: true });
      }
      finish(() => onCanceled?.());
      return;
    }
    if (code === 0 && stats?.size > 0) {
      finish(() =>
        onComplete?.({
          outputPath,
          sizeBytes: stats.size,
          durationSeconds: Math.round(job.progressSeconds || durationSeconds)
        })
      );
      return;
    }
    finish(() =>
      onError?.(
        new Error(
          stderr ||
            `FFmpeg exited with code ${code}${signal ? ` signal ${signal}` : ""}`
        ),
        outputPath
      )
    );
  });

  return {
    started: true,
    outputPath,
    durationSeconds: Math.round(durationSeconds)
  };
}

function getActiveJobs() {
  return Array.from(activeJobs.entries()).map(([fixtureId, job]) => ({
    fixtureId,
    startedAt: job.startedAt,
    outputPath: job.outputPath,
    durationSeconds: job.durationSeconds,
    progressSeconds: Math.round(job.progressSeconds),
    speed: job.speed,
    previewUrl: `/api/fixtures/${encodeURIComponent(fixtureId)}/preview`
  }));
}

function stopRecording(fixtureId, { discard = false } = {}) {
  const job = activeJobs.get(fixtureId);
  if (!job) {
    return null;
  }
  job.discard = discard;
  if (job.child.stdin?.writable) {
    job.child.stdin.write("q\n");
  } else {
    job.child.kill("SIGTERM");
  }
  return {
    fixtureId,
    discard,
    outputPath: job.outputPath
  };
}

function stopAll() {
  for (const [, job] of activeJobs) {
    if (job.child.stdin?.writable) {
      job.child.stdin.write("q\n");
    } else {
      job.child.kill("SIGTERM");
    }
  }
}

async function scanLibrary(settings, existingRecordings) {
  const root = path.resolve(process.cwd(), settings.recordingDir || "./recordings");
  await ensureDirectory(root);
  const discovered = [];
  const knownPaths = new Set(
    existingRecordings.map((recording) => recording.localPath).filter(Boolean).map(path.resolve)
  );
  const pending = [root];

  while (pending.length) {
    const current = pending.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      if (knownPaths.has(path.resolve(absolutePath))) {
        continue;
      }

      const stats = await fsp.stat(absolutePath);
      discovered.push({
        absolutePath,
        title: path.basename(entry.name, path.extname(entry.name)),
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString()
      });
    }
  }

  return discovered;
}

module.exports = {
  buildFfmpegArgs,
  buildMaskFilter,
  getActiveJobs,
  getRecordingWindow,
  resolveCaptureDurationSeconds,
  resolveRecordingPath,
  safeFilename,
  scanLibrary,
  startRecording,
  stopRecording,
  stopAll
};
