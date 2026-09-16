const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseAttributes,
  parseM3u,
  sanitizeFfmpegOutput,
  validateHttpUrl
} = require("../server/m3u");

test("parseM3u reads channels and resolves relative stream URLs", () => {
  const channels = parseM3u(
    [
      '#EXTM3U x-tvg-url="http://example.com/epg.xml"',
      '#EXTINF:-1 tvg-id="arsenal" tvg-name="阿森纳直播" group-title="体育",阿森纳 vs 曼城',
      "/live/arsenal"
    ].join("\n"),
    "https://example.com/list.m3u"
  );

  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, "阿森纳 vs 曼城");
  assert.equal(channels[0].group, "体育");
  assert.equal(channels[0].streamUrl, "https://example.com/live/arsenal");
});

test("parseM3u ignores malformed entries", () => {
  const channels = parseM3u("#EXTM3U\n#EXTINF:-1,No URL", "https://example.com");
  assert.deepEqual(channels, []);
});

test("validateHttpUrl rejects unsupported protocols", () => {
  assert.throws(() => validateHttpUrl("file:///etc/passwd"), /HTTP/);
});

test("sanitizeFfmpegOutput removes stream credentials", () => {
  const output = sanitizeFfmpegOutput(
    "Opening https://example.com/live.m3u8?userid=123&encrypt=secret Video: h264"
  );
  assert.equal(output, "Opening [stream-url] Video: h264");
  assert.equal(output.includes("userid=123"), false);
  assert.equal(output.includes("secret"), false);
});

test("parseAttributes preserves M3U metadata", () => {
  assert.deepEqual(
    parseAttributes(
      '#EXTINF:-1 tvg-id="CCTV5" group-title="央视",CCTV5体育'
    ),
    {
      "tvg-id": "CCTV5",
      "group-title": "央视"
    }
  );
});
