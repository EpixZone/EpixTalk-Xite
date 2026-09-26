const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Load EpixTalk.js with just enough of the page around it to construct the
// class. Only setSiteinfo is exercised here.
function page() {
  const checks = [];
  const context = vm.createContext({
    window: {
      EpixFrame: class {
        log() {}
        cmd() {}
      },
    },
    User: { checkCert() { checks.push(true); } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/EpixTalk.js"), "utf8"), context);
  const Page = context.window.Page;
  Page.site_info = null;
  return { Page, checks };
}

const full = () => ({
  address: "epix1talk",
  auth_address: "epix1me",
  cert_user_id: "me@xid.epix",
  xid_directory: "me.epix",
  peers: 4,
  bad_files: 0,
  content: { title: "Talk", settings: { admins: ["epix1admin"] } },
  settings: { own: false, size: 1234 },
});

// What an older node's clone / user-content sync progress event looks like:
// no identity fields and a bare content.
const progress = () => ({
  address: "epix1talk",
  peers: 2,
  bad_files: 7,
  tasks: 7,
  content: { title: "Talk" },
  settings: { size: 0 },
  event: ["file_done", "data/users/bob.epix/content.json"],
});

test("a progress event keeps the identity and admin settings of the last full site info", () => {
  const { Page, checks } = page();
  Page.setSiteinfo(full());
  Page.setSiteinfo(progress());
  assert.equal(Page.site_info.auth_address, "epix1me");
  assert.equal(Page.site_info.cert_user_id, "me@xid.epix");
  assert.equal(Page.site_info.xid_directory, "me.epix");
  assert.deepEqual(Page.site_info.content.settings.admins, ["epix1admin"]);
  // The progress fields themselves are taken from the event.
  assert.equal(Page.site_info.bad_files, 7);
  assert.equal(Page.site_info.peers, 2);
  assert.deepEqual(Page.site_info.event, progress().event);
  assert.equal(checks.length, 2, "the login check runs on every update");
});

test("a full site info still overrides everything, including logging out", () => {
  const { Page } = page();
  Page.setSiteinfo(full());
  const anonymous = full();
  anonymous.auth_address = null;
  anonymous.cert_user_id = null;
  anonymous.xid_directory = null;
  anonymous.content = { title: "Talk", settings: { admins: [] } };
  Page.setSiteinfo(anonymous);
  assert.equal(Page.site_info.auth_address, null);
  assert.deepEqual(Page.site_info.content.settings.admins, []);
});

test("the first site info is stored as is", () => {
  const { Page } = page();
  Page.setSiteinfo(progress());
  assert.equal(Page.site_info.auth_address, undefined);
  assert.equal(Page.site_info.bad_files, 7);
});
