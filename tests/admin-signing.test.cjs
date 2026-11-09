const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function harness(options = {}) {
  let raw = options.raw === undefined ? JSON.stringify({mods: [], pinned_topic_uris: []}) : options.raw;
  const calls = [], notifications = [];
  const signerResult = params => options.signError || (params.privatekey === "stored" || options.owner === false ? "ok" : {error: "crypto: Valid signs: 0/1"});
  const Page = {
    site_info: {privatekey: options.stored === undefined ? options.owner !== false : options.stored, settings: {own: options.owner !== false}},
    cmd(name, params, cb) {
      calls.push({name, params});
      if (name === "fileGet") {
        const read = raw;
        if (options.concurrentRaw) { raw = options.concurrentRaw; options.concurrentRaw = null; }
        cb(read);
      } else if (name === "fileWriteSign") {
        if (Object.hasOwn(options, "unsupported")) { cb(options.unsupported); return; }
        if (Buffer.from(params.expected_base64, "base64").toString() !== raw) {
          cb({error: "fileWriteSign conflict: file changed"}); return;
        }
        const result = options.writeError || signerResult(params);
        if (result === "ok") raw = Buffer.from(params.content_base64, "base64").toString();
        if (result === "ok" && options.afterCommitRaw) raw = options.afterCommitRaw;
        cb(result);
      } else if (name === "fileWrite") {
        // Keep the old sequence executable so the baseline reproduces its dirty write.
        if (!options.writeError) raw = Buffer.from(params[1], "base64").toString();
        cb(options.writeError || "ok");
      } else if (name === "siteSign") cb(signerResult(params));
      else if (name === "sitePublish") cb(options.publishError || "ok");
      else if (name === "wrapperNotification") notifications.push(params);
      else throw new Error("Unexpected command: " + name);
    },
  };
  const initial = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
  const Moderation = { admin_settings: initial || {},
    isAdmin: () => options.authorized !== false, isOwner: () => options.owner !== false,
    loadAdminSettings(cb) { this.admin_settings = JSON.parse(raw); cb(); },
  };
  const context = vm.createContext({window: {TopicList: {topic_pinned_uris: {}}}, Page, Moderation,
    LogMixin: {}, btoa: value => Buffer.from(value, "binary").toString("base64"), unescape, encodeURIComponent});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/Admin.js"), "utf8"), context);
  const admin = context.window.Admin;
  admin.loadRoles = () => {};
  return {admin, calls, notifications, Moderation, window: context.window, raw: () => raw, data: () => JSON.parse(raw)};
}

function assertNoLegacyWrite(h) {
  assert.equal(h.calls.some(c => c.name === "fileWrite" || c.name === "siteSign"), false);
}

test("fork owner atomically pins with the saved key before publishing the signature", () => {
  const raw = '{ "mods": [], "pinned_topic_uris": [], "title": "café" }\n';
  const h = harness({raw});
  h.admin.pinTopic("12_owner.epix");
  assert.deepEqual(h.notifications.filter(n => n[0] === "error"), []);
  assertNoLegacyWrite(h);
  const writes = h.calls.filter(c => c.name === "fileWriteSign");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].params.privatekey, "stored");
  assert.equal(writes[0].params.inner_path, "data/admin/admin-settings.json");
  assert.equal(Buffer.from(writes[0].params.expected_base64, "base64").toString(), raw);
  assert.equal(h.calls.find(c => c.name === "sitePublish").params.sign, false);
  assert.deepEqual(h.data().pinned_topic_uris, ["12_owner.epix"]);
});

test("delegated admin keeps xID signing in the atomic operation", () => {
  const h = harness({owner: false}), results = [];
  h.admin.updateAdminSettings(data => { data.mods.push("helper.epix"); return true; }, (success, committed) => results.push([success, committed]));
  assertNoLegacyWrite(h);
  assert.equal(h.calls.find(c => c.name === "fileWriteSign").params.privatekey, undefined);
  assert.deepEqual(results, [[true, true]]);
});

for (const option of ["writeError", "signError"]) {
  test(`rejected atomic ${option} preserves persisted and cached settings`, () => {
    const h = harness({[option]: {error: "crypto: Valid signs: 0/1"}}), before = h.raw(), results = [];
    h.admin.pinTopic("12_owner.epix", (success, committed) => results.push([success, committed]));
    assert.deepEqual(results, [[false, false]]);
    assert.equal(h.raw(), before);
    assert.equal(h.window.TopicList.topic_pinned_uris["12_owner.epix"], undefined);
    assert.equal(h.Moderation.admin_settings.pinned_topic_uris.length, 0);
    assert.equal(h.calls.some(c => c.name === "sitePublish"), false);
    assert.equal(h.notifications.filter(n => n[0] === "error").length, 1);
    assertNoLegacyWrite(h);
  });
}

test("a concurrent settings edit is preserved and a stale save is rejected", () => {
  const concurrentRaw = JSON.stringify({mods: ["other.epix"], pinned_topic_uris: []});
  const h = harness({concurrentRaw}), results = [];
  h.admin.pinTopic("12_owner.epix", success => results.push(success));
  assert.deepEqual(results, [false]);
  assert.equal(h.raw(), concurrentRaw);
  assert.equal(h.calls.some(c => c.name === "sitePublish"), false);
  assert.match(h.notifications[0][1], /file changed/);
  assertNoLegacyWrite(h);
});

for (const unsupported of [null, {error: "unknown command: fileWriteSign"}, "unsupported"]) {
  test("an older runtime fails safely without separate write and sign fallback", () => {
    const h = harness({unsupported}), before = h.raw(), results = [];
    h.admin.pinTopic("12_owner.epix", success => results.push(success));
    assert.deepEqual(results, [false]);
    assert.equal(h.raw(), before);
    assert.equal(h.calls.some(c => c.name === "sitePublish"), false);
    assertNoLegacyWrite(h);
  });
}

for (const raw of [null, "", "{bad", "null", "[]"]) {
  test(`unreadable settings ${JSON.stringify(raw)} are never replaced with defaults`, () => {
    const h = harness({raw}), results = [];
    h.admin.updateAdminSettings(data => { data.title = "new"; return true; }, success => results.push(success));
    assert.deepEqual(results, [false]);
    assert.equal(h.calls.some(c => c.name === "fileWriteSign"), false);
    assertNoLegacyWrite(h);
  });
}

test("retry after rejected signing submits a fresh complete atomic update", () => {
  const options = {signError: {error: "temporary signer failure"}};
  const h = harness(options), results = [];
  h.admin.pinTopic("12_owner.epix", success => results.push(success));
  assert.deepEqual(h.data().pinned_topic_uris, []);
  options.signError = null;
  h.admin.pinTopic("12_owner.epix", success => results.push(success));
  assert.deepEqual(results, [false, true]);
  assert.equal(h.window.TopicList.topic_pinned_uris["12_owner.epix"], 1);
  assert.equal(h.calls.filter(c => c.name === "fileWriteSign").length, 2);
  assertNoLegacyWrite(h);
});

test("publication failure retains the signed local commit and permits explicit retry", () => {
  const options = {publishError: {error: "offline"}}, h = harness(options), results = [];
  h.admin.pinTopic("12_owner.epix", (success, committed) => results.push([success, committed]));
  assert.deepEqual(results, [[false, true]]);
  assert.deepEqual(h.data().pinned_topic_uris, ["12_owner.epix"]);
  assert.deepEqual(h.Moderation.admin_settings.pinned_topic_uris, ["12_owner.epix"]);
  assert.equal(h.window.TopicList.topic_pinned_uris["12_owner.epix"], 1);
  assert.match(h.notifications.find(n => n[0] === "error")[1], /saved locally.*offline/i);
  const saved = h.raw();
  options.publishError = null;
  h.admin.pinTopic("12_owner.epix", (success, committed) => results.push([success, committed]));
  assert.deepEqual(results, [[false, true], [true, true]]);
  assert.equal(h.raw(), saved, "an unchanged retry preserves the exact settings bytes");
  assertNoLegacyWrite(h);
});

test("unpin reflects a local commit even when publication fails and denies unauthorized edits", () => {
  const options = {}, h = harness(options), results = [];
  h.admin.pinTopic("12_owner.epix");
  options.publishError = {error: "offline"};
  h.admin.unpinTopic("12_owner.epix", (success, committed) => results.push([success, committed]));
  assert.deepEqual(results, [[false, true]]);
  assert.equal(h.window.TopicList.topic_pinned_uris["12_owner.epix"], undefined);
  assert.deepEqual(h.data().pinned_topic_uris, []);
  options.authorized = false;
  h.admin.pinTopic("12_owner.epix", success => results.push(success));
  h.admin.unpinTopic("12_owner.epix", success => results.push(success));
  assert.deepEqual(results.slice(1), [false, false]);
});

test("owner status without a stored key does not make an unauthorized identity valid", () => {
  const h = harness({stored: false}), before = h.raw();
  h.admin.pinTopic("12_owner.epix");
  assert.equal(h.calls.find(c => c.name === "fileWriteSign").params.privatekey, undefined);
  assert.equal(h.calls.some(c => c.name === "sitePublish"), false);
  assert.equal(h.raw(), before);
});

test("a later accepted edit controls the pin display after publication completes", () => {
  const afterCommitRaw = JSON.stringify({mods: [], pinned_topic_uris: []});
  const h = harness({afterCommitRaw});
  h.admin.pinTopic("12_owner.epix");
  assert.equal(h.raw(), afterCommitRaw);
  assert.equal(h.window.TopicList.topic_pinned_uris["12_owner.epix"], undefined);
});

test("rejected moderator edits preserve the cached role list", () => {
  const h = harness({raw: JSON.stringify({mods: ["helper.epix"], pinned_topic_uris: []}), signError: {error: "rejected"}});
  h.admin.removeMod("helper.epix");
  h.admin.addMod("new.epix");
  assert.deepEqual(h.Moderation.admin_settings.mods, ["helper.epix"]);
  assert.deepEqual(h.data().mods, ["helper.epix"]);
});
