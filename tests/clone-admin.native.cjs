// Use an isolated EpixNet test node whose source xite contains this checkout.
// EPIX_TEST_SOCKET=/fixture/admin.sock EPIX_CLONE_SOURCE=epix1... node --test tests/clone-admin.native.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function command(address, name, params) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(process.env.EPIX_TEST_SOCKET);
    let pending = "";
    socket.on("connect", () => socket.write(JSON.stringify({ cmd: name, xite: address, params }) + "\n"));
    socket.setTimeout(60000, () => { socket.destroy(); reject(new Error("Timed out: " + name)); });
    socket.on("error", reject);
    socket.on("data", chunk => {
      pending += chunk;
      if (!pending.includes("\n")) return;
      socket.end();
      try {
        const response = JSON.parse(pending.split("\n")[0]);
        resolve(response.error ? { error: response.error } : response.result);
      } catch (error) { reject(error); }
    });
  });
}

test("a fresh clone starts with empty admin settings and can sign its first pin", {
  skip: !process.env.EPIX_TEST_SOCKET || !process.env.EPIX_CLONE_SOURCE,
  timeout: 90000
}, async () => {
  const source = process.env.EPIX_CLONE_SOURCE;
  const cloned = await command(source, "siteClone", { address: source });
  assert.equal(typeof cloned.address, "string", JSON.stringify(cloned));
  const address = cloned.address;
  const read = inner_path => command(address, "fileGet", { inner_path, required: false });
  const raw = await read("data/admin/admin-settings.json");
  assert.equal(typeof raw, "string", "the clone must initialize admin-settings.json from defaults");
  const initial = JSON.parse(raw);
  assert.deepEqual(initial.mods, []);
  assert.deepEqual(initial.pinned_topic_uris, []);
  assert.equal(initial.branding, undefined, "source branding must not be copied into a new forum");
  assert.equal(typeof await read("data/admin/content.json"), "string", "admin data must have its own manifest");

  const site_info = await command(address, "siteInfo", {});
  assert.equal(site_info.settings.own, true);
  assert.equal(site_info.privatekey, true);
  const notices = [], publishes = [];
  let transportError;
  const Page = { site_info, cmd(name, params, cb) {
    if (name === "wrapperNotification") { notices.push(params); return; }
    // Keep this fixture local. Signing and its verifier are native; peer
    // delivery is outside this clone initialization regression.
    if (name === "sitePublish") { publishes.push(params); cb("ok"); return; }
    command(address, name, params).then(result => cb && cb(result), error => {
      transportError = error;
      if (cb) cb({ error: error.message });
    });
  } };
  const context = vm.createContext({ window: { TopicList: { topic_pinned_uris: {} } }, Page,
    LogMixin: {}, btoa: value => Buffer.from(value, "binary").toString("base64"), unescape, encodeURIComponent });
  for (const file of ["js/utils/Moderation.js", "js/Admin.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
    context.Moderation = context.window.Moderation;
  }
  const admin = context.window.Admin;
  admin.loadRoles = () => {};
  const pin = "1_fixture.epix";
  const success = await new Promise(resolve => admin.pinTopic(pin, resolve));
  assert.equal(transportError, undefined);
  assert.equal(success, true, JSON.stringify(notices));
  assert.equal(publishes.length, 1);
  assert.equal(publishes[0].sign, false);
  assert.deepEqual(JSON.parse(await read("data/admin/admin-settings.json")).pinned_topic_uris, [pin]);
  assert.equal(typeof JSON.parse(await read("data/admin/content.json")).signs[address], "string");
});
