const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventLog } = require("../server/logger");

test("EventLog persists, filters, reloads, and clears entries", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "north-stand-log-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "logs.jsonl");

  const logger = await new EventLog(filePath, { limit: 10 }).init();
  await logger.record("info", "recording.start", "开始录制", {
    fixtureId: "match-1"
  });
  await logger.record("error", "recording.failed", "录制失败", {
    fixtureId: "match-2"
  });

  assert.equal(logger.list()[0].event, "recording.failed");
  assert.equal(logger.list({ fixtureId: "match-1" }).length, 1);
  assert.equal(logger.list({ level: "error" }).length, 1);

  const reloaded = await new EventLog(filePath, { limit: 10 }).init();
  assert.equal(reloaded.list().length, 2);

  await reloaded.clear();
  assert.equal(reloaded.list().length, 0);
  assert.equal(await fs.readFile(filePath, "utf8"), "");
});
