const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const wrapperOrigin = "https://talk.epix";

test("the current profile requests its display size and ignores a late prior profile", { timeout: 3000 }, async () => {
  const calls = [], slot = { width: 80, images: [] };
  const url = "https://images.example/alice.png";
  const thumbnail = "data:image/png;base64,QQ==";
  const Page = { cmd(name, params, cb) {
    if (name === "wrapperAvatarThumbnailVersion") cb({ version: 1, origin: wrapperOrigin });
    else calls.push({ name, params, cb });
  } };
  const parent = { postMessage(message, target, [port]) {
    calls.push({ name: message.cmd, params: message.params, target, cb(value) { port.postMessage(value); port.close(); } });
  } };
  const textNode = { text() { return this; }, attr() { return this; } };
  function $(selector) {
    if (selector === ".profile-avatar") return {
      empty() { slot.images = []; },
      css() { return String(slot.width) + "px"; },
    };
    if (selector.startsWith("<img")) {
      const image = { setAttribute(key, value) {
        this[key] = value;
        if (key === "src" && this.painted) this.painted();
      } };
      return { 0: image, appendTo() { slot.images.push(image); return this; } };
    }
    return textNode;
  }
  const context = vm.createContext({
    window: { Page, parent }, $, Page, URL, MessageChannel, setTimeout, clearTimeout,
    LogMixin: {}, Text: { formatUsername: name => name },
  });
  function load(relative) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", relative), "utf8"), context);
  }
  load("js/lib/epix-avatar.js");
  context.EpixAvatar = context.window.EpixAvatar;
  load("js/UserProfile.js");
  const profile = context.window.UserProfile;
  profile.loadRole = () => {};
  profile.user_address = "first.epix";
  profile.loadProfile();
  profile.user_address = "alice.epix";
  profile.loadProfile();
  calls[0].cb({ name: "first", tld: "epix", avatar: "https://images.example/old.png" });
  assert.equal(slot.images.length, 0);
  calls[1].cb({ name: "alice", tld: "epix", avatar: url });
  await new Promise(setImmediate);
  const read = calls.find(call => call.name === "wrapperGetAvatarThumbnail");
  assert.equal(read.target, wrapperOrigin);
  assert.equal(read.params.url, url);
  assert.equal(read.params.size, 80);
  assert.equal(slot.images[0].src, undefined);
  await new Promise(resolve => { slot.images[0].painted = resolve; read.cb({ thumbnail }); });
  assert.equal(slot.images[0].src, thumbnail);

  slot.width = 56;
  profile.user_address = "small.epix";
  profile.loadProfile();
  calls.at(-1).cb({ name: "small", tld: "epix", avatar: url });
  await new Promise(setImmediate);
  const mobile = calls.at(-1);
  assert.equal(mobile.params.size, 56);
  await new Promise(resolve => { slot.images[0].painted = resolve; mobile.cb({ thumbnail: null }); });
  assert.equal(slot.images[0].src, url);
});
