const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_DB = {
  settings: {
    displayName: "北看台",
    spoilerMode: true,
    burnInMask: false,
    recordingDir: "./recordings",
    m3uUrl: "",
    preRollMinutes: 5,
    postRollMinutes: 15,
    mask: {
      x: 3.5,
      y: 3,
      width: 37,
      height: 11,
      color: "#05070a"
    },
    diskWarningGb: 20
  },
  fixtures: [],
  recordings: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function redactUnrevealedScores(db) {
  const output = clone(db);

  for (const fixture of output.fixtures) {
    if (fixture.result && !fixture.result.revealed) {
      fixture.result = null;
      fixture.hasHiddenResult = true;
    }
  }

  for (const recording of output.recordings) {
    if (recording.score && !recording.score.revealed) {
      recording.score = null;
      recording.hasHiddenScore = true;
    }
  }

  return output;
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.writeChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.data = JSON.parse(raw);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      this.data = clone(DEFAULT_DB);
      await this.persist();
    }

    this.data.settings = {
      ...DEFAULT_DB.settings,
      ...this.data.settings,
      mask: {
        ...DEFAULT_DB.settings.mask,
        ...(this.data.settings?.mask || {})
      }
    };
    this.data.fixtures ||= [];
    this.data.recordings ||= [];
    return this;
  }

  async persist() {
    const snapshot = JSON.stringify(this.data, null, 2);
    const tempPath = `${this.filePath}.tmp`;

    this.writeChain = this.writeChain.then(async () => {
      await fs.writeFile(tempPath, snapshot, "utf8");
      await fs.rename(tempPath, this.filePath);
    });

    return this.writeChain;
  }

  snapshot({ redact = true } = {}) {
    return redact ? redactUnrevealedScores(this.data) : clone(this.data);
  }

  get settings() {
    return this.data.settings;
  }

  get fixtures() {
    return this.data.fixtures;
  }

  get recordings() {
    return this.data.recordings;
  }

  findFixture(id) {
    return this.data.fixtures.find((fixture) => fixture.id === id);
  }

  findRecording(id) {
    return this.data.recordings.find((recording) => recording.id === id);
  }

  async updateSettings(patch) {
    this.data.settings = {
      ...this.data.settings,
      ...patch,
      mask: {
        ...this.data.settings.mask,
        ...(patch.mask || {})
      }
    };
    await this.persist();
    return clone(this.data.settings);
  }

  async addFixture(fixture) {
    this.data.fixtures.push(fixture);
    await this.persist();
    return clone(fixture);
  }

  async updateFixture(id, patch) {
    const fixture = this.findFixture(id);
    if (!fixture) {
      return null;
    }
    Object.assign(fixture, patch);
    await this.persist();
    return clone(fixture);
  }

  async removeFixture(id) {
    const index = this.data.fixtures.findIndex((fixture) => fixture.id === id);
    if (index < 0) {
      return null;
    }
    const [fixture] = this.data.fixtures.splice(index, 1);
    await this.persist();
    return clone(fixture);
  }

  async addRecording(recording) {
    this.data.recordings.unshift(recording);
    await this.persist();
    return clone(recording);
  }

  async updateRecording(id, patch) {
    const recording = this.findRecording(id);
    if (!recording) {
      return null;
    }
    Object.assign(recording, patch);
    await this.persist();
    return clone(recording);
  }

  async removeRecording(id) {
    const index = this.data.recordings.findIndex((recording) => recording.id === id);
    if (index < 0) {
      return null;
    }
    const [recording] = this.data.recordings.splice(index, 1);
    await this.persist();
    return clone(recording);
  }
}

module.exports = {
  DEFAULT_DB,
  JsonStore,
  redactUnrevealedScores
};
