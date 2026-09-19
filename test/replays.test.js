const test = require("node:test");
const assert = require("node:assert/strict");
const { channelHealthKey } = require("../server/channels");
const {
  buildAvailableReplays,
  normalizeReplayTitle
} = require("../server/replays");

function channel(id, name, streamUrl, group = "体育-今天09-19", logo = "") {
  return { id, name, streamUrl, group, logo, sourceLabel: "测试源" };
}

function healthFor(item, overrides = {}) {
  return {
    checkedAt: "2026-09-19T03:00:00.000Z",
    playable: true,
    quality: "1080p",
    height: 1080,
    latencyMs: 1200,
    successes: 2,
    failures: 0,
    ...overrides
  };
}

test("normalizeReplayTitle removes commentary and kickoff time", () => {
  assert.equal(
    normalizeReplayTitle(
      "英超 布伦特福德VS切尔西 全场回放（颜强、贺宇） 02:45"
    ),
    "英超 布伦特福德VS切尔西 全场回放"
  );
});

test("buildAvailableReplays keeps fresh playable football replays and groups variants", () => {
  const first = channel(
    "chelsea-a",
    "英超 布伦特福德VS切尔西 全场回放（颜强、贺宇） 02:45",
    "https://example.com/chelsea-a.m3u8"
  );
  const second = channel(
    "chelsea-b",
    "英超 布伦特福德VS切尔西 全场回放（江忠德） 02:45",
    "https://example.com/chelsea-b.m3u8"
  );
  const offline = channel(
    "offline",
    "西甲 皇家贝蒂斯VS赫塔菲 全场回放 00:45",
    "https://example.com/offline.m3u8"
  );
  const stale = channel(
    "stale",
    "西甲 马拉加VS比利亚雷亚尔 全场回放 03:15",
    "https://example.com/stale.m3u8"
  );
  const channels = [first, second, offline, stale];
  const health = {
    [channelHealthKey(first.streamUrl)]: healthFor(first, {
      latencyMs: 1800
    }),
    [channelHealthKey(second.streamUrl)]: healthFor(second, {
      latencyMs: 900
    }),
    [channelHealthKey(offline.streamUrl)]: healthFor(offline, {
      playable: false,
      quality: "离线"
    }),
    [channelHealthKey(stale.streamUrl)]: healthFor(stale, {
      checkedAt: "2026-09-18T03:00:00.000Z"
    })
  };

  const replays = buildAvailableReplays(channels, health, {
    now: Date.parse("2026-09-19T04:00:00.000Z"),
    ttlMs: 6 * 60 * 60 * 1000
  });

  assert.equal(replays.length, 1);
  assert.equal(replays[0].title, "英超 布伦特福德VS切尔西 全场回放");
  assert.equal(replays[0].variantCount, 2);
  assert.equal(replays[0].channelId, "chelsea-b");
  assert.equal(replays[0].commentary, "江忠德");
  assert.deepEqual(
    replays[0].variants.map((variant) => variant.commentary).sort(),
    ["江忠德", "颜强、贺宇"]
  );
  assert.match(replays[0].mediaUrl, /^\/api\/replays\//);
});
