const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_DB,
  JsonStore,
  redactUnrevealedScores
} = require("../server/store");

test("redactUnrevealedScores removes hidden scores and preserves revealed scores", () => {
  const source = structuredClone(DEFAULT_DB);
  source.fixtures = [
    {
      id: "hidden",
      result: { home: 3, away: 1, revealed: false }
    },
    {
      id: "revealed",
      result: { home: 1, away: 0, revealed: true }
    }
  ];
  source.recordings = [
    {
      id: "recording-hidden",
      score: { home: 2, away: 2, revealed: false }
    }
  ];

  const output = redactUnrevealedScores(source);

  assert.equal(output.fixtures[0].result, null);
  assert.equal(output.fixtures[0].hasHiddenResult, true);
  assert.deepEqual(output.fixtures[1].result, {
    home: 1,
    away: 0,
    revealed: true
  });
  assert.equal(output.recordings[0].score, null);
  assert.equal(output.recordings[0].hasHiddenScore, true);
  assert.deepEqual(source.fixtures[0].result, {
    home: 3,
    away: 1,
    revealed: false
  });
});

test("JsonStore removes a scheduled fixture", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "north-stand-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const store = new JsonStore(path.join(directory, "db.json"));
  await store.init();
  await store.addFixture({ id: "match-1", home: "阿森纳", away: "埃弗顿" });

  const removed = await store.removeFixture("match-1");

  assert.equal(removed.id, "match-1");
  assert.equal(store.findFixture("match-1"), undefined);
});

test("JsonStore removes a recording from the library", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "north-stand-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const store = new JsonStore(path.join(directory, "db.json"));
  await store.init();
  await store.addRecording({ id: "recording-1", title: "阿森纳 vs 埃弗顿" });

  const removed = await store.removeRecording("recording-1");

  assert.equal(removed.id, "recording-1");
  assert.equal(store.findRecording("recording-1"), undefined);
});
