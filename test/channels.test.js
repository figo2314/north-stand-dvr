const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  channelHealthKey,
  enrichChannels,
  loadChannelCatalog,
  mergeChannelPlaylists,
  parseVideoMetadata,
  probeChannelHealth,
  scoreHealth
} = require("../server/channels");
const { JsonStore } = require("../server/store");

test("mergeChannelPlaylists keeps the first channel and source metadata", () => {
  const channels = mergeChannelPlaylists([
    {
      source: { id: "primary", label: "主源", priority: 100 },
      channels: [
        {
          id: "one",
          name: "CCTV1",
          streamUrl: "https://example.com/one.m3u8"
        }
      ]
    },
    {
      source: { id: "backup", label: "备用", priority: 50 },
      channels: [
        {
          id: "duplicate",
          name: "CCTV1",
          streamUrl: "https://example.com/one.m3u8"
        },
        {
          id: "two",
          name: "CCTV2",
          streamUrl: "https://example.com/two.m3u8"
        }
      ]
    }
  ]);

  assert.equal(channels.length, 2);
  assert.equal(channels[0].sourceId, "primary");
  assert.equal(channels[1].sourceId, "backup");
});

test("loadChannelCatalog falls back to the secondary source URL", async () => {
  const requests = [];
  const catalog = await loadChannelCatalog(
    [
      {
        id: "source-a",
        label: "Source A",
        url: "https://example.com/primary.m3u",
        fallbackUrl: "https://example.com/fallback.m3u",
        enabled: true,
        priority: 100
      }
    ],
    {
      fetchPlaylist: async (url) => {
        requests.push(url);
        if (url.includes("primary")) {
          throw new Error("primary unavailable");
        }
        return {
          url,
          channels: [{ id: "one", name: "One", streamUrl: "https://x/one" }]
        };
      }
    }
  );

  assert.deepEqual(requests, [
    "https://example.com/primary.m3u",
    "https://example.com/fallback.m3u"
  ]);
  assert.equal(catalog.channels.length, 1);
  assert.equal(catalog.sources[0].count, 1);
  assert.equal(catalog.sources[0].error, null);
});

test("probeChannelHealth records latency, resolution, and failures", async () => {
  const now = Date.now();
  const result = await probeChannelHealth({
    streamUrl: "https://example.com/live.m3u8",
    current: { successes: 2, failures: 1 },
    now,
    probe: async () => ({
      ok: true,
      message: "Video: h264, 1920x1080"
    })
  });

  assert.equal(result.health.playable, true);
  assert.equal(result.health.height, 1080);
  assert.equal(result.health.quality, "1080p");
  assert.equal(result.health.successes, 3);
  assert.equal(result.health.failures, 1);
  assert.equal(result.health.history.length, 1);
  assert.equal(result.health.history[0].playable, true);
  assert.ok(result.health.latencyMs >= 0);
  assert.ok(result.score > 0);
});

test("channel health helpers parse metadata and score unplayable entries below playable ones", () => {
  assert.deepEqual(parseVideoMetadata("Video: hevc, 3840x2160"), {
    codec: "hevc",
    width: 3840,
    height: 2160
  });
  assert.ok(
    scoreHealth({ playable: true, height: 1080, latencyMs: 300 }) >
      scoreHealth({ playable: false, height: 1080, latencyMs: 300 })
  );
});

test("JsonStore initializes channel source and health registries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "north-stand-store-"));
  const store = new JsonStore(path.join(root, "db.json"));
  await store.init();

  assert.equal(store.channelSources.length, 1);
  assert.equal(store.channelSources[0].id, "myiptv-ipv4");
  assert.deepEqual(store.channelHealth, {});
  assert.match(store.settings.tvToken, /^[0-9a-f]{48}$/);

  const key = channelHealthKey("https://example.com/live.m3u8");
  await store.updateChannelHealth(key, { playable: true });
  assert.equal(store.channelHealth[key].playable, true);

  await store.replaceChannelSources([
    {
      id: crypto.randomUUID(),
      label: "Custom",
      url: "https://example.com/source.m3u",
      enabled: true,
      priority: 10
    }
  ]);
  assert.equal(store.channelSources.length, 1);
  assert.equal(store.channelSources[0].label, "Custom");
});

test("enrichChannels attaches health by stream URL", () => {
  const streamUrl = "https://example.com/live.m3u8";
  const key = channelHealthKey(streamUrl);
  const channels = enrichChannels(
    [{ id: "one", name: "One", streamUrl }],
    { [key]: { playable: true, quality: "720p" } }
  );
  assert.equal(channels[0].healthKey, key);
  assert.equal(channels[0].health.quality, "720p");
});
