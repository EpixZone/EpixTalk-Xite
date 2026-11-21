const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function fixture() {
  const iconPath = "data/admin/forum-icon.png";
  const state = {asset: "old", accepted: "new", writes: [], manifest: {address: "forum", title: "Forum"}};
  const Page = {
    site_info: {address: "forum", settings: {own: true}, privatekey: true, content: {}},
    async cmd(name, params) {
      if (name === "fileGet") {
        if (params.inner_path === iconPath) return state.asset;
        if (params.inner_path === "content.json") return JSON.stringify(state.manifest);
        return JSON.stringify({branding: {favicon: state.accepted}});
      }
      if (name === "fileWriteSign") {
        assert.equal(params.inner_path, iconPath);
        assert.equal(params.expected_base64, state.asset);
        state.writes.push(params);
        if (state.onWrite) return state.onWrite(params);
        state.asset = params.content_base64;
        return "ok";
      }
      assert.equal(name, "fileWrite");
      assert.equal(params[0], "content.json");
      state.manifest = JSON.parse(Buffer.from(params[1], "base64").toString());
      return "ok";
    }
  };
  const context = vm.createContext({window: {}, Page, btoa});
  const file = path.join(__dirname, "../js/utils/ForumIcon.js");
  vm.runInContext(fs.readFileSync(file, "utf8"), context, {filename: file});
  return {icon: context.window.ForumIcon, iconPath, Page, state};
}

test("owner signs the generated icon with the stored key, delegated admins use their identity", async () => {
  const {icon, Page, state} = fixture();
  await icon.sync();
  assert.equal(state.asset, "new");
  assert.equal(state.writes[0].privatekey, "stored");
  Page.site_info.privatekey = false;
  state.accepted = "other";
  await icon.sync();
  assert.equal(state.asset, "other");
  assert.equal(Object.hasOwn(state.writes[1], "privatekey"), false);
});

test("a racing save repairs the icon from the last accepted settings", async () => {
  const {icon, state} = fixture();
  state.onWrite = () => {
    delete state.onWrite;
    state.asset = "concurrent image";
    state.accepted = "latest";
    return {error: "File changed since it was read."};
  };
  await icon.sync();
  assert.equal(state.asset, "latest");
  assert.equal(state.writes.length, 2);
});

test("failed or missing icon writes can be retried from the accepted settings", async () => {
  const {icon, state} = fixture();
  state.asset = null;
  await assert.rejects(icon.sync(), /missing/);
  state.asset = "old";
  state.onWrite = () => ({error: "Signature rejected"});
  await assert.rejects(icon.sync(), /Signature rejected/);
  assert.equal(state.asset, "old");
  state.onWrite = () => ({error: "File changed since it was read."});
  await assert.rejects(icon.sync(), /changed during the save/);
  delete state.onWrite;
  await icon.sync();
  assert.equal(state.asset, state.accepted);
});

test("old clone owners stage only the favicon pointer and delegates leave the root alone", async () => {
  const {icon, Page, state, iconPath} = fixture();
  Page.site_info.settings.own = false;
  Page.site_info.privatekey = false;
  assert.match(await icon.configure(), /owner/);
  assert.equal(state.manifest.favicon, undefined);
  Page.site_info.settings.own = true;
  assert.match(await icon.configure(), /Sign and publish/);
  assert.deepEqual(state.manifest, {address: "forum", title: "Forum", favicon: iconPath});
  Page.site_info.content.favicon = iconPath;
  assert.equal(await icon.configure(), "");
});
