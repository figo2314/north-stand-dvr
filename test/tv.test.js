const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildM3u,
  buildXmltv,
  tvChannels,
  tvTokenMatches,
  xmltvDate
} = require("../server/tv");

const channels = [
  {
    id: "jade-1080",
    name: "TVB翡翠台 1080P",
    group: "港澳台频道",
    tvgId: "jade",
    logo: "https://example.com/jade.png",
    streamUrl: "https://origin.example.com/jade.m3u8"
  },
  {
    id: "sports",
    name: "足球直播",
    group: "体育-今天",
    streamUrl: "https://origin.example.com/sports.m3u8"
  }
];

test("tvTokenMatches requires an exact non-empty token", () => {
  assert.equal(tvTokenMatches("token-123", "token-123"), true);
  assert.equal(tvTokenMatches("token-123", "token-124"), false);
  assert.equal(tvTokenMatches("", ""), false);
});

test("buildM3u creates absolute server stream URLs without exposing origins", () => {
  const output = buildM3u(
    tvChannels(channels),
    "https://tv.example.com",
    "secret"
  );
  assert.match(output, /x-tvg-url="https:\/\/tv\.example\.com\/api\/tv\/epg\.xml/);
  assert.match(
    output,
    /https:\/\/tv\.example\.com\/api\/tv\/stream\/jade-1080\?token=secret/
  );
  assert.equal(output.includes("origin.example.com"), false);
  assert.equal(output.includes("足球直播"), false);
});

test("buildM3u omits token query when public TV access is enabled", () => {
  const output = buildM3u(
    tvChannels(channels),
    "https://tv.example.com",
    ""
  );
  assert.match(output, /api\/tv\/stream\/jade-1080\n/);
  assert.equal(output.includes("?token="), false);
});

test("buildXmltv writes current and next programmes using channel IDs", () => {
  const output = buildXmltv(
    tvChannels(channels),
    {
      jade: {
        current: {
          title: "新闻 <直播>",
          start: "2026-09-19T04:00:00.000Z",
          stop: "2026-09-19T05:00:00.000Z"
        },
        next: null
      }
    },
    "https://tv.example.com"
  );
  assert.match(output, /<channel id="jade-1080">/);
  assert.match(output, /新闻 &lt;直播&gt;/);
  assert.match(output, /channel="jade-1080"/);
  assert.equal(xmltvDate("2026-09-19T04:00:00.000Z"), "20260919040000 +0000");
});
