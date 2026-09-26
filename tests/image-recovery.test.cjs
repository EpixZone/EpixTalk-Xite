const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function fixture() {
  const events = {}, timers = new Map(), buttons = [];
  let now = 0, next = 0, mutation;
  const addEventListener = (type, cb) => { events[type] = cb; };
  const document = {
    baseURI: "http://localhost:42222/epix1talk/index.html", body: {}, hidden: false, addEventListener,
    createElement() {
      const button = {
        addEventListener(type, cb) { this[type] = cb; },
        remove() { this.removed = true; }
      };
      buttons.push(button);
      return button;
    }
  };
  const context = vm.createContext({
    document, navigator: { connection: { saveData: false } },
    window: {
      location: new URL(document.baseURI), innerWidth: 1000, innerHeight: 800, addEventListener,
      Page: { site_address: "epix1talk" }
    },
    URL, Date: { now: () => now }, _: s => s,
    XiteLinkGuard: { isXiteHost: host => host.endsWith(".epix"), canOpenXiteLinks: () => false },
    MutationObserver: class { constructor(cb) { mutation = cb; } observe() {} },
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/utils/ImageRecovery.js"), "utf8"), context);
  function image(url = "http://localhost:42222/epix1talk/data/picture.jpg") {
    return {
      url, requests: [], isConnected: true, rect: { top: 10, bottom: 100, left: 10, right: 100 },
      get src() { return this.url; },
      set src(value) { this.url = value; this.requests.push(value); },
      matches: selector => selector === ".body img",
      getClientRects() { return [this.rect]; },
      getBoundingClientRect() { return this.rect; },
      closest() { return this.anchor || null; },
      after(button) { this.button = button; }
    };
  }
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    now = end;
  }
  return { context, events, buttons, timers, image, advance, mutation: () => mutation(),
    fail: image => events.error({ target: image }), load: image => events.load({ target: image }),
    click: button => button.click({ preventDefault() {}, stopPropagation() {} }),
    done: (address, file) => context.window.ImageRecovery.fileDone(address, file) };
}

test("slow requests are never interrupted; an actual error retries after backoff", () => {
  const f = fixture(), image = f.image();
  f.advance(180000);
  assert.equal(image.requests.length, 0);
  assert.equal(f.buttons.length, 0);
  f.fail(image);
  f.advance(49999);
  assert.equal(image.requests.length, 0);
  f.advance(1);
  assert.equal(image.requests.length, 1);
  assert.equal(image.button.disabled, true);
  f.advance(180000);
  f.events.scroll();
  assert.equal(image.requests.length, 1, "a pending retry must not be duplicated");
  f.load(image);
  assert.equal(image.button.removed, true);
  assert.equal(f.timers.size, 0);
});

test("automatic requests are limited; a later file completion still recovers", () => {
  const f = fixture(), image = f.image();
  for (let i = 0; i < 4; i++) {
    f.fail(image);
    f.advance(60000);
  }
  f.events.scroll();
  assert.equal(image.requests.length, 3);
  f.done("another-xite", "data/picture.jpg");
  assert.equal(image.requests.length, 3);
  f.done("epix1talk", "data/picture.jpg");
  assert.equal(image.requests.length, 4);
  f.load(image);
  f.advance(180000);
  assert.equal(image.requests.length, 4);
});

test("manual retry bypasses backoff and data saver without duplicating requests", () => {
  const f = fixture(), image = f.image();
  f.context.navigator.connection.saveData = true;
  f.fail(image);
  f.advance(60000);
  assert.equal(image.requests.length, 0);
  f.click(image.button);
  f.click(image.button);
  assert.equal(image.requests.length, 1);
  f.load(image);
  assert.equal(image.button.removed, true);
});

test("offscreen, hidden and data-saver images wait until eligible", () => {
  for (const condition of ["offscreen", "hidden", "data-saver"]) {
    const f = fixture(), image = f.image();
    if (condition === "offscreen") image.rect.top = 900;
    if (condition === "hidden") f.context.document.hidden = true;
    if (condition === "data-saver") f.context.navigator.connection.saveData = true;
    f.fail(image);
    f.advance(60000);
    f.done("epix1talk", "data/picture.jpg");
    assert.equal(image.requests.length, 0);
    image.rect.top = 10;
    f.context.document.hidden = false;
    f.context.navigator.connection.saveData = false;
    f.events.scroll();
    assert.equal(image.requests.length, 1);
  }
});

test("removed or replaced images release pending retries", () => {
  for (const change of [image => { image.isConnected = false; }, image => { image.url += "?different"; }]) {
    const f = fixture(), image = f.image();
    f.fail(image);
    change(image);
    f.mutation();
    assert.equal(image.button.removed, true);
    assert.equal(f.timers.size, 0);
    f.advance(180000);
    assert.equal(image.requests.length, 0);
  }
});

test("external images require manual retry and retain their exact URL", () => {
  const f = fixture(), url = "https://example.org/photo.jpg?signature=abc%2F123", image = f.image(url);
  f.fail(image);
  f.advance(180000);
  assert.equal(image.requests.length, 0);
  f.click(image.button);
  assert.deepEqual(image.requests, [url]);
});

test("xite host retries require a browser capable of resolving them", () => {
  const f = fixture(), image = f.image("https://photos.epix/photo.jpg");
  f.fail(image);
  f.advance(60000);
  assert.equal(image.requests.length, 0);
  f.context.XiteLinkGuard.canOpenXiteLinks = () => true;
  f.events.scroll();
  assert.equal(image.requests.length, 1);
});

test("non-post images and embedded data do not get retry controls", () => {
  const f = fixture(), avatar = f.image();
  avatar.matches = () => false;
  f.fail(avatar);
  f.fail(f.image("data:image/png;base64,broken"));
  assert.equal(f.buttons.length, 0);
  assert.equal(f.timers.size, 0);
});

test("linked images place the retry control outside the hyperlink", () => {
  const f = fixture(), image = f.image();
  image.anchor = { after(button) { this.button = button; } };
  f.fail(image);
  assert.equal(image.button, undefined);
  assert.equal(image.anchor.button, f.buttons[0]);
  f.click(image.anchor.button);
  assert.equal(image.requests.length, 1);
});

test("file completion also matches pathless xite origins", () => {
  const f = fixture();
  f.context.window.location = new URL("https://talk.epix/index.html");
  f.context.document.baseURI = f.context.window.location.href;
  const image = f.image("https://talk.epix/data/picture.jpg");
  f.fail(image);
  f.done("epix1talk", "data/picture.jpg");
  assert.equal(image.requests.length, 1);
});
