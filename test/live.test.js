const test = require("node:test");
const assert = require("node:assert/strict");
const { rewritePlaylist, validateLiveUrl } = require("../server/live");

test("validateLiveUrl accepts public HTTP sources and rejects private targets", () => {
  assert.equal(
    validateLiveUrl("https://example.com/live.m3u8").hostname,
    "example.com"
  );
  assert.throws(() => validateLiveUrl("ftp://example.com/live"), /只支持/);
  assert.throws(() => validateLiveUrl("http://127.0.0.1/live"), /私网/);
  assert.throws(() => validateLiveUrl("http://192.168.1.10/live"), /私网/);
});

test("rewritePlaylist proxies segment URIs and encryption keys", () => {
  const session = {
    id: "session-1",
    allowedHosts: new Set(["example.com"])
  };
  const output = rewritePlaylist(
    [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      "#EXTINF:6,",
      "segment-1.ts"
    ].join("\n"),
    "https://example.com/live/index.m3u8",
    session
  );

  assert.match(output, /session=session-1/);
  assert.match(output, /url=https%3A%2F%2Fexample\.com%2Flive%2Fkey\.bin/);
  assert.match(output, /url=https%3A%2F%2Fexample\.com%2Flive%2Fsegment-1\.ts/);
});
