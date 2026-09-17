const crypto = require("node:crypto");

const HASH_LENGTH = 32;

function hashPassword(password, username) {
  return crypto
    .scryptSync(String(password), `north-stand:${username}`, HASH_LENGTH)
    .toString("hex");
}

function parseBasicUsers(value) {
  const users = new Map();
  for (const entry of String(value || "").split(",")) {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const username = entry.slice(0, separator).trim();
    const passwordHash = entry.slice(separator + 1).trim().toLowerCase();
    if (username && /^[a-f0-9]{64}$/.test(passwordHash)) {
      users.set(username, passwordHash);
    }
  }
  return users;
}

function createBasicAuth({ users, realm = "North Stand DVR" }) {
  return function basicAuth(request, response, next) {
    if (!users.size) {
      next();
      return;
    }

    const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization || "");
    if (match) {
      const decoded = Buffer.from(match[1], "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        const username = decoded.slice(0, separator);
        const password = decoded.slice(separator + 1);
        const expected = users.get(username);
        if (expected) {
          const actual = hashPassword(password, username);
          if (
            actual.length === expected.length &&
            crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
          ) {
            next();
            return;
          }
        }
      }
    }

    response.setHeader("WWW-Authenticate", `Basic realm="${realm}", charset="UTF-8"`);
    response.status(401).send("Authentication required");
  };
}

module.exports = {
  createBasicAuth,
  hashPassword,
  parseBasicUsers
};
