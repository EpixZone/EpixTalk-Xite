const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function harness() {
  const reads = [], applied = [];
  const context = vm.createContext({
    window: {Branding: true},
    Branding: {apply: value => applied.push(value)},
    LogMixin: {},
    Page: {cmd(name, params, cb) {
      assert.equal(name, "fileGet");
      assert.equal(params.inner_path, "data/admin/admin-settings.json");
      reads.push(cb);
    }},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/utils/Moderation.js"), "utf8"), context);
  return {moderation: context.window.Moderation, reads, applied};
}

for (const olderFirst of [false, true]) {
  test(`overlapping admin reads complete with the newest cache (${olderFirst ? "older" : "newer"} response first)`, () => {
    const h = harness(), completed = [];
    const older = JSON.stringify({branding: {title: "Earlier title"}, pinned_topic_uris: ["earlier"]});
    const newer = JSON.stringify({branding: {title: "Latest title"}, pinned_topic_uris: ["latest"]});
    h.moderation.loadAdminSettings(() => completed.push(["first", h.moderation.admin_settings.branding.title]));
    h.moderation.loadAdminSettings(() => completed.push(["second", h.moderation.admin_settings.branding.title]));
    if (olderFirst) {
      h.reads[0](older);
      assert.deepEqual(completed, [], "wait for the newer in-flight read");
      assert.deepEqual(h.applied, [], "do not apply a superseded response");
    }
    h.reads[1](newer);
    if (!olderFirst) h.reads[0](older);
    assert.deepEqual(completed, [["first", "Latest title"], ["second", "Latest title"]]);
    assert.equal(h.applied.length, 1);
    assert.equal(h.applied[0].title, "Latest title");
    assert.equal(JSON.stringify(h.moderation.admin_settings), newer);
  });
}

test("a completed reload does not consume callbacks from a later reload", () => {
  const h = harness(), completed = [];
  h.moderation.loadAdminSettings(() => {
    completed.push("first");
    h.moderation.loadAdminSettings(() => completed.push("second"));
  });
  h.reads[0](JSON.stringify({branding: {title: "First"}}));
  assert.deepEqual(completed, ["first"]);
  h.reads[1](JSON.stringify({branding: {title: "Second"}}));
  assert.deepEqual(completed, ["first", "second"]);
  assert.equal(h.moderation.admin_settings.branding.title, "Second");
});
