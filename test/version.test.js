const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildVersion } = require("../server/version");

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "north-stand-version-"));
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.mkdirSync(path.join(root, "server"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), '{"version":"1.2.3"}');
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
  fs.writeFileSync(path.join(root, "server", "index.js"), "console.log(1);");
  fs.writeFileSync(path.join(root, "public", "app.js"), "console.log(2);");
  return root;
}

test("buildVersion changes when deployed source changes", () => {
  const root = fixtureRoot();
  try {
    const first = buildVersion(root, "1.2.3");
    const second = buildVersion(root, "1.2.3");
    assert.equal(first, second);
    assert.match(first, /^1\.2\.3\+[a-f0-9]{8}$/);

    fs.writeFileSync(path.join(root, "public", "app.js"), "console.log(3);");
    const changed = buildVersion(root, "1.2.3");
    assert.notEqual(changed, first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
