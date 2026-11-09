const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function setup(options = {}) {
  const calls = [], notifications = [], completed = [];
  const Page = {
    site_info: { auth_address: "epix1test", xid_directory: "writer.epix" },
    cmd(name, params, cb) {
      calls.push({ name, params });
      if (name === "recordSign") {
        cb(Object.hasOwn(options, "signResult") ? options.signResult : { ...params[0], author: "epix1test", sign: "test signature" });
      } else if (name === "fileWrite") cb("ok");
      else if (name === "fileGet") cb('{"record_format":"epix-orset-1","post":[]}');
      else if (name === "sitePublish") cb(Object.hasOwn(options, "publishResult") ? options.publishResult : "ok");
      else if (name === "wrapperNotification") notifications.push(params);
      else throw new Error("Unexpected command: " + name);
    },
  };
  const context = vm.createContext({
    window: { crypto: { getRandomValues(bytes) { return bytes.fill(7); } } },
    Page, $: () => ({ on() {} }), LogMixin: {},
    Time: { timestamp: () => 1000 },
    Text: { jsonEncode: data => Buffer.from(JSON.stringify(data)).toString("base64") },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/User.js"), "utf8"), context);
  const user = context.window.User;
  user.checkCert = () => {};
  const create = () => user.createRecord("topics", { topic_id: 1001, title: "A new topic" }, result => completed.push(result));
  return { calls, notifications, completed, create };
}

for (const signResult of [{ error: "xID required: select or link an identity for this xite" }, null]) {
  test("failed record signing explains that no record was signed", () => {
    const h = setup({ signResult });
    h.create();
    assert.deepEqual(h.completed, [false]);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0][0], "error");
    assert.match(h.notifications[0][1], /not signed/i);
    if (signResult) assert.ok(h.notifications[0][1].includes(signResult.error));
    assert.equal(h.calls.filter(c => c.name === "recordSign").length, 1);
    assert.equal(h.calls.some(c => c.name === "fileWrite" || c.name === "sitePublish"), false);
  });
}

const publicationErrors = [
  "crypto: xID name 'writer' not found on chain",
  "crypto: Identity epix1test was revoked at 500 but content was modified at 1000",
  "unverified parent: data/users/content.json",
  "crypto: Valid signs: 0/1",
];
for (const error of publicationErrors) {
  test("publication failure preserves the backend explanation: " + error, () => {
    const h = setup({ publishResult: { error } });
    h.create();
    assert.deepEqual(h.completed, [false]);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0][0], "error");
    assert.match(h.notifications[0][1], /saved locally/i);
    assert.ok(h.notifications[0][1].includes(error));
    assert.equal(h.calls.filter(c => c.name === "recordSign").length, 1);
    assert.equal(h.calls.filter(c => c.name === "fileWrite").length, 1);
    assert.equal(h.calls.filter(c => c.name === "sitePublish").length, 1);
  });
}

for (const result of ["ok", true]) {
  test("successful command completion stays quiet and does not claim peer delivery", () => {
    const h = setup({ publishResult: result });
    h.create();
    assert.deepEqual(h.completed, [true]);
    assert.deepEqual(h.notifications, []);
  });
}
