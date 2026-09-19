const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const VERSION_FILES = [
  "package.json",
  "package-lock.json",
  "server/auth.js",
  "server/channels.js",
  "server/dvr.js",
  "server/env.js",
  "server/epg.js",
  "server/index.js",
  "server/lineups.js",
  "server/live.js",
  "server/logger.js",
  "server/m3u.js",
  "server/replays.js",
  "server/store.js",
  "server/tv.js",
  "server/version.js"
];

function collectPublicFiles(root) {
  const publicRoot = path.join(root, "public");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (/\.(?:css|html|js|json|svg|webmanifest)$/i.test(entry.name)) {
        files.push(path.relative(root, absolutePath));
      }
    }
  };
  if (fs.existsSync(publicRoot)) {
    visit(publicRoot);
  }
  return files;
}

function buildVersion(root, baseVersion) {
  const files = [...VERSION_FILES, ...collectPublicFiles(root)].sort();
  const hash = crypto.createHash("sha256");
  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    hash.update(relativePath.replaceAll(path.sep, "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(absolutePath));
    hash.update("\0");
  }
  return `${baseVersion}+${hash.digest("hex").slice(0, 8)}`;
}

module.exports = {
  buildVersion
};
