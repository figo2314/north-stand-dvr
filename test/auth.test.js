const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createBasicAuth,
  hashPassword,
  parseBasicUsers
} = require("../server/auth");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    }
  };
}

test("parseBasicUsers accepts hashed credentials and ignores malformed entries", () => {
  const hash = hashPassword("test-password-42", "heiwa");
  const users = parseBasicUsers(`heiwa:${hash},broken,other:not-a-hash`);

  assert.equal(users.size, 1);
  assert.equal(users.get("heiwa"), hash);
});

test("basic auth accepts the configured user and rejects bad passwords", () => {
  const hash = hashPassword("test-password-42", "heiwa");
  const basicAuth = createBasicAuth({
    users: parseBasicUsers(`heiwa:${hash}`),
    realm: "Test Realm"
  });

  let accepted = false;
  basicAuth(
    {
      headers: {
        authorization: `Basic ${Buffer.from(
          "heiwa:test-password-42"
        ).toString("base64")}`
      }
    },
    createResponse(),
    () => {
      accepted = true;
    }
  );
  assert.equal(accepted, true);

  const response = createResponse();
  basicAuth(
    {
      headers: {
        authorization: `Basic ${Buffer.from("heiwa:wrong").toString("base64")}`
      }
    },
    response,
    () => {
      throw new Error("wrong password should not be accepted");
    }
  );
  assert.equal(response.statusCode, 401);
  assert.match(response.headers["WWW-Authenticate"], /Test Realm/);
});
