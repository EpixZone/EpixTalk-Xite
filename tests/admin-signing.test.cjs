const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

function harness(options = {}) {
  let raw = options.raw === undefined ? JSON.stringify({mods: [], pinned_topic_uris: []}) : options.raw;
  const calls = [], notifications = [];
  const Page = {
    site_info: {privatekey: options.stored === undefined ? options.owner !== false : options.stored, settings: {own: options.owner !== false}},
    cmd(name, params, cb) {
      calls.push({name, params});
      if (name === "fileGet") cb(raw);
      else if (name === "fileWrite") {
        if (!options.writeError) raw = Buffer.from(params[1], "base64").toString();
        cb(options.writeError || "ok");
      } else if (name === "siteSign") {
        let result;
        if (process.env.TALK_SIGNING_VERIFIER) {
          const child = spawnSync(process.env.TALK_SIGNING_VERIFIER, [], {
            input: JSON.stringify({...params, delegate: options.owner === false}) + "\n", encoding: "utf8"
          });
          assert.equal(child.status, 0, child.stderr);
          result = JSON.parse(child.stdout.trim());
        } else {
          result = params.privatekey === "stored" || options.owner === false ? "ok" : {error: "crypto: Valid signs: 0/1"};
        }
        cb(options.signError || result);
      } else if (name === "sitePublish") cb(options.publishError || (params.sign === false || options.owner === false ? "ok" : {error: "crypto: Valid signs: 0/1"}));
      else if (name === "wrapperNotification") notifications.push(params);
      else throw new Error("Unexpected command: " + name);
    },
  };
  const Moderation = { admin_settings: {mods: [], pinned_topic_uris: []},
    isAdmin: () => options.authorized !== false, isOwner: () => options.owner !== false,
    loadAdminSettings(cb) { this.admin_settings = JSON.parse(raw); cb(); },
  };
  const context = vm.createContext({window: {TopicList: {topic_pinned_uris: {}}}, Page, Moderation,
    LogMixin: {}, btoa: value => Buffer.from(value, "binary").toString("base64"), unescape, encodeURIComponent});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/Admin.js"), "utf8"), context);
  const admin = context.window.Admin;
  admin.loadRoles = () => {};
  return {admin, calls, notifications, Moderation, window: context.window, data: () => JSON.parse(raw)};
}

test("fork owner pins using the saved site key and publishes the verified signature once", () => {
  const h = harness();
  h.admin.pinTopic("12_owner.epix");
  assert.deepEqual(h.notifications.filter(n => n[0] === "error"), []);
  assert.equal(h.calls.filter(c => c.name === "siteSign").length, 1);
  assert.equal(h.calls.find(c => c.name === "siteSign").params.privatekey, "stored");
  assert.equal(h.calls.find(c => c.name === "sitePublish").params.sign, false);
  assert.deepEqual(h.data().pinned_topic_uris, ["12_owner.epix"]);
});

test("delegated admin keeps xID signing and does not sign again on publish", () => {
  const h = harness({owner: false});
  const results = [];
  h.admin.updateAdminSettings(data => { data.mods.push("helper.epix"); return true; }, result => results.push(result));
  assert.deepEqual(h.notifications.filter(n => n[0] === "error"), []);
  assert.equal(h.calls.find(c => c.name === "siteSign").params.privatekey, undefined);
  assert.equal(h.calls.find(c => c.name === "sitePublish").params.sign, false);
  assert.deepEqual(results, [true]);
});

for (const [phase, option] of [["write", "writeError"], ["sign", "signError"], ["publish", "publishError"]]) {
  test(`failed ${phase} reports failure without marking the topic as pinned`, () => {
    const h = harness({[option]: {error: phase + " failed"}});
    const results = [];
    h.admin.pinTopic("12_owner.epix", result => results.push(result));
    assert.deepEqual(results, [false]);
    assert.equal(h.window.TopicList.topic_pinned_uris["12_owner.epix"], undefined);
    assert.equal(h.Moderation.admin_settings.pinned_topic_uris.length, 0);
    assert.equal(h.notifications.filter(n => n[0] === "error").length, 1);
    if (phase !== "publish") assert.equal(h.calls.some(c => c.name === "sitePublish"), false);
  });
}

for (const raw of [null, "", "{bad", "null", "[]"]) {
  test(`unreadable settings ${JSON.stringify(raw)} are never replaced with defaults`, () => {
    const h = harness({raw});
    const results = [];
    h.admin.updateAdminSettings(data => { data.title = "new"; return true; }, result => results.push(result));
    assert.deepEqual(results, [false]);
    assert.equal(h.calls.some(c => c.name === "fileWrite"), false);
    assert.equal(h.calls.some(c => c.name === "siteSign"), false);
  });
}

test("retry after a signing failure signs the existing write and completes the pin", () => {
  const options = {signError: {error: "temporary signer failure"}};
  const h = harness(options), results = [];
  h.admin.pinTopic("12_owner.epix", result => results.push(result));
  assert.deepEqual(results, [false]);
  assert.deepEqual(h.data().pinned_topic_uris, ["12_owner.epix"]);
  options.signError = null;
  h.admin.pinTopic("12_owner.epix", result => results.push(result));
  assert.deepEqual(results, [false, true]);
  assert.equal(h.window.TopicList.topic_pinned_uris["12_owner.epix"], 1);
  assert.equal(h.calls.filter(c => c.name === "fileWrite").length, 1);
  assert.equal(h.calls.filter(c => c.name === "siteSign").length, 2);
});

test("unpin waits for successful persistence and reports denied access", () => {
  const options = {}, h = harness(options), results = [];
  h.admin.pinTopic("12_owner.epix");
  options.publishError = {error: "offline"};
  h.admin.unpinTopic("12_owner.epix", result => results.push(result));
  assert.deepEqual(results, [false]);
  assert.equal(h.window.TopicList.topic_pinned_uris["12_owner.epix"], 1);
  options.publishError = null;
  h.admin.unpinTopic("12_owner.epix", result => results.push(result));
  assert.deepEqual(results, [false, true]);
  assert.equal(h.window.TopicList.topic_pinned_uris["12_owner.epix"], undefined);
  options.authorized = false;
  h.admin.pinTopic("12_owner.epix", result => results.push(result));
  h.admin.unpinTopic("12_owner.epix", result => results.push(result));
  assert.deepEqual(results, [false, true, false, false]);
});

test("owner status without an available stored key still uses the xID signer", () => {
  const h = harness({stored: false});
  h.admin.pinTopic("12_owner.epix");
  assert.equal(h.calls.find(c => c.name === "siteSign").params.privatekey, undefined);
  assert.equal(h.calls.some(c => c.name === "sitePublish"), false);
});
