const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function setup(info = null) {
  const calls = [];
  const elements = new Map();
  function $(selector) {
    if (!elements.has(selector)) {
      const element = { handlers: {}, value: "user_name" };
      element.on = (event, cb) => { element.handlers[event] = cb; return element; };
      element.text = (value) => {
        if (value === undefined) return element.value;
        element.value = value;
        return element;
      };
      for (const method of ["css", "addClass", "removeClass", "remove", "append", "after"]) {
        element[method] = () => element;
      }
      elements.set(selector, element);
    }
    return elements.get(selector);
  }
  const Page = {
    site_info: info,
    cmd(command, params, cb) {
      if (command === "fileRules") return cb({ current_size: 0 });
      calls.push({ command, params, cb });
    },
    setSiteinfo(info) { this.site_info = info; context.window.User.checkCert(); },
  };
  const context = vm.createContext({
    window: { top: { location: "" } }, Page, $, LogMixin: { log() {} },
    Text: { toColor: () => "purple" },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/User.js"), "utf8"), context);
  const user = context.window.User;
  user.maybeMigrate = () => {};
  user.showXidTag = (display) => { user.shown = display; };
  const take = (command) => {
    const index = calls.findIndex(call => call.command === command);
    assert.notEqual(index, -1, `expected ${command}; got ${calls.map(call => call.command)}`);
    return calls.splice(index, 1)[0];
  };
  return { Page, user, calls, $, take };
}

const identity = (name) => ({
  auth_address: `epix1${name}`, cert_user_id: `${name}@xid.epix`, xid_directory: `${name}.epix`,
});

test("clicking Connect xID opens the picker before site information arrives", () => {
  const { $, calls, take } = setup();
  $(".certselect").handlers.click();
  take("certXid");
  assert.equal(calls.some(call => call.command === "wrapperNotification"), false);
});

test("picker completion refreshes identity before resolving its name", () => {
  const { user, take, calls } = setup(identity("old"));
  user.triggerCertXid();
  take("certXid").cb("ok");
  take("siteInfo").cb(identity("new"));
  const lookup = take("xidResolve");
  assert.equal(lookup.params[0], "epix1new");
  lookup.cb({ name: "new", tld: "epix" });
  assert.equal(user.shown, "new.epix");
  assert.equal(calls.some(call => call.command === "certXid"), false);
});

test("a posting action can open login before an identity is selected", () => {
  const { user, take, calls } = setup();
  let resumed = 0;
  assert.equal(user.requireXid(() => { resumed++; }), false);
  take("certXid").cb("ok");
  take("siteInfo").cb(identity("new"));
  take("xidResolve").cb({ name: "new", tld: "epix" });
  assert.equal(resumed, 1);
  assert.equal(calls.some(call => call.command === "wrapperNotification" &&
    call.params[1] === "Please connect to EpixNet first."), false);
});

test("a late lookup for the previous identity cannot replace the selected name", () => {
  const { user, Page, take } = setup(identity("old"));
  user.resolveMyXidName(() => {});
  const old = take("xidResolve");
  Page.site_info = identity("new");
  user.resolveMyXidName(() => {});
  take("xidResolve").cb({ name: "new", tld: "epix" });
  old.cb({ name: "old", tld: "epix" });
  assert.equal(user.xid_name, "new");
});

test("concurrent lookups wait for the resolved name", () => {
  const { user, take } = setup(identity("new"));
  const names = [];
  user.resolveMyXidName(name => names.push(name));
  user.resolveMyXidName(name => names.push(name));
  assert.deepEqual(names, []);
  take("xidResolve").cb({ name: "new", tld: "epix" });
  assert.deepEqual(names, ["new", "new"]);
});

test("choosing None does not resume a pending post or reopen the picker", () => {
  const { user, take, calls } = setup();
  let resumed = false;
  user.requireXid(() => { resumed = true; });
  take("certXid").cb("ok");
  take("siteInfo").cb({ auth_address: "epix1anonymous", cert_user_id: null });
  assert.equal(resumed, false);
  assert.equal(calls.some(call => call.command === "certXid"), false);
});


test("switching identity during login releases the picker without posting", () => {
  const { user, Page, take } = setup();
  let resumed = false;
  user.requireXid(() => { resumed = true; });
  take("certXid").cb("ok");
  take("siteInfo").cb(identity("old"));
  const old = take("xidResolve");
  Page.setSiteinfo(identity("new"));
  take("xidResolve").cb({ name: "new", tld: "epix" });
  old.cb({ name: "old", tld: "epix" });
  assert.equal(resumed, false);
  user.triggerCertXid();
  take("certXid");
});
