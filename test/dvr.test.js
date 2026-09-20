const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildFfmpegArgs,
  buildFaststartArgs,
  buildMaskFilter,
  getRecordingWindow,
  resolveCaptureDurationSeconds,
  resolveRecordingPath,
  safeFilename
} = require("../server/dvr");

test("safeFilename removes characters that are invalid on Windows", () => {
  assert.equal(
    safeFilename('Arsenal: vs "Forest" / 03:00?'),
    "Arsenal- vs -Forest- - 03-00-"
  );
});

test("getRecordingWindow includes pre-roll and post-roll", () => {
  const fixture = {
    kickoffAt: "2026-09-15T19:00:00.000Z",
    durationMinutes: 120
  };
  const settings = {
    preRollMinutes: 5,
    postRollMinutes: 15
  };

  assert.equal(
    getRecordingWindow(fixture, settings, new Date("2026-09-15T18:54:59.000Z")).state,
    "waiting"
  );
  assert.equal(
    getRecordingWindow(fixture, settings, new Date("2026-09-15T18:55:00.000Z")).state,
    "within"
  );
  assert.equal(
    getRecordingWindow(fixture, settings, new Date("2026-09-15T21:14:59.000Z")).state,
    "within"
  );
  assert.equal(
    getRecordingWindow(fixture, settings, new Date("2026-09-15T21:15:00.000Z")).state,
    "expired"
  );
});

test("resolveCaptureDurationSeconds keeps a full replay from collapsing to one second", () => {
  const duration = resolveCaptureDurationSeconds({
    fixture: {
      kickoffAt: "2026-09-15T19:00:00.000Z",
      durationMinutes: 150
    },
    settings: {
      postRollMinutes: 15
    },
    captureDurationSeconds: 150 * 60,
    now: Date.parse("2026-09-16T12:00:00.000Z")
  });

  assert.equal(duration, 9000);
});

test("resolveRecordingPath keeps alternate match feeds in separate files", () => {
  const outputPath = resolveRecordingPath(
    { recordingDir: "./recordings" },
    {
      kickoffAt: "2026-09-15T19:00:00.000Z",
      home: "巴塞罗那",
      away: "皇家马德里",
      sourceLabel: "赛场原声"
    }
  );

  assert.match(outputPath, /2026-09-15 巴塞罗那 vs 皇家马德里 赛场原声\.mp4$/);
});

test("buildMaskFilter converts percentages into ffmpeg expressions", () => {
  assert.equal(
    buildMaskFilter({ x: 3.5, y: 4, width: 37, height: 11 }),
    "drawbox=x=iw*0.035:y=ih*0.04:w=iw*0.37:h=ih*0.11:color=black@1:t=fill"
  );
});

test("buildFfmpegArgs copies streams unless burn-in masking is enabled", () => {
  const base = {
    streamUrl: "https://example.com/live.m3u8",
    durationSeconds: 7200,
    outputPath: "match.mp4",
    mask: { x: 3.5, y: 3, width: 37, height: 11 }
  };
  const copyArgs = buildFfmpegArgs({ ...base, burnInMask: false });
  const maskArgs = buildFfmpegArgs({ ...base, burnInMask: true });

  assert.ok(copyArgs.includes("-c"));
  assert.equal(copyArgs[copyArgs.indexOf("-c") + 1], "copy");
  assert.equal(copyArgs[copyArgs.indexOf("-bsf:a") + 1], "aac_adtstoasc");
  assert.equal(
    copyArgs[copyArgs.indexOf("-movflags") + 1],
    "+frag_keyframe+empty_moov+default_base_moof"
  );
  assert.equal(copyArgs[copyArgs.indexOf("-progress") + 1], "pipe:1");
  assert.ok(maskArgs.includes("-vf"));
  assert.ok(!maskArgs.includes("-c"));
});

test("buildFfmpegArgs can force an HLS input without a .m3u8 suffix", () => {
  const args = buildFfmpegArgs({
    streamUrl: "https://example.com/967624940",
    durationSeconds: 600,
    outputPath: "match.mp4",
    burnInMask: false,
    mask: null,
    inputFormat: "hls"
  });

  assert.deepEqual(args.slice(args.indexOf("-f"), args.indexOf("-f") + 4), [
    "-f",
    "hls",
    "-i",
    "https://example.com/967624940"
  ]);
});

test("buildFfmpegArgs can limit replay input duration before opening it", () => {
  const args = buildFfmpegArgs({
    streamUrl: "https://example.com/replay",
    durationSeconds: 60,
    outputPath: "replay.mp4",
    burnInMask: false,
    mask: null,
    inputFormat: "hls",
    limitInputDuration: true
  });

  assert.ok(args.indexOf("-t") < args.indexOf("-i"));
  assert.equal(args[args.indexOf("-t") + 1], "60");
});

test("buildFaststartArgs remuxes a completed recording for browser playback", () => {
  const args = buildFaststartArgs("match.mp4", "match.faststart.tmp.mp4");

  assert.equal(args[args.indexOf("-c") + 1], "copy");
  assert.equal(args[args.indexOf("-movflags") + 1], "+faststart");
  assert.equal(args[args.indexOf("-f") + 1], "mp4");
  assert.equal(args.at(-1), "match.faststart.tmp.mp4");
});
