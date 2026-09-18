const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

class EventLog {
  constructor(filePath, { limit = 1000, maxBytes = 2 * 1024 * 1024 } = {}) {
    this.filePath = filePath;
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.entries = [];
    this.writeChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.entries = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-this.limit)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    return this;
  }

  async record(level, event, message, context = {}) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      ...context
    };
    this.entries.push(entry);
    const trimmed = this.entries.length > this.limit;
    if (trimmed) {
      this.entries = this.entries.slice(-this.limit);
    }

    this.writeChain = this.writeChain
      .then(async () => {
        const line = `${JSON.stringify(entry)}\n`;
        if (trimmed || Buffer.byteLength(line) > this.maxBytes) {
          await fs.writeFile(
            this.filePath,
            this.entries.map((item) => JSON.stringify(item)).join("\n") + "\n",
            "utf8"
          );
          return;
        }
        const stats = await fs.stat(this.filePath).catch(() => null);
        if (stats?.size > this.maxBytes) {
          await fs.writeFile(
            this.filePath,
            this.entries.map((item) => JSON.stringify(item)).join("\n") + "\n",
            "utf8"
          );
          return;
        }
        await fs.appendFile(this.filePath, line, "utf8");
      })
      .catch((error) => {
        console.error("[logger]", error);
      });

    return this.writeChain.then(() => entry);
  }

  list({ limit = 200, level, fixtureId } = {}) {
    return this.entries
      .filter((entry) => !level || entry.level === level)
      .filter((entry) => !fixtureId || entry.fixtureId === fixtureId)
      .slice(-Math.max(1, Math.min(1000, Number(limit) || 200)))
      .reverse();
  }

  async clear() {
    this.entries = [];
    this.writeChain = this.writeChain.then(() => fs.writeFile(this.filePath, "", "utf8"));
    await this.writeChain;
  }
}

module.exports = {
  EventLog
};
