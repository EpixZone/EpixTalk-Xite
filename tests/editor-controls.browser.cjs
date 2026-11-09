const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, before, after } = require("node:test");
const tools = process.env.EPIX_BROWSER_TEST_TOOLS;
const { chromium } = require(tools ? path.join(tools, "playwright") : "playwright");
const source = process.env.EPIX_TEST_SOURCE_ROOT || path.join(__dirname, "..");
let browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.EPIX_CHROMIUM_PATH ? { executablePath: process.env.EPIX_CHROMIUM_PATH } : {})
  });
});
after(async () => { if (browser) await browser.close(); });

async function fixture(t, { admin = false, author = "alice.epix", initializeEditors = true } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], "the UI must not raise uncaught errors");
  });
  const html = fs.readFileSync(path.join(source, "index.html"), "utf8")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");
  await page.route("http://forum.test/**", route => {
    // Keep the test document after a successful delete redirects to ?Main.
    // A 204 navigation response leaves the current page intact.
    if (route.request().isNavigationRequest() && route.request().url() === "http://forum.test/") {
      return route.fulfill({ contentType: "text/html", body: html });
    }
    return route.fulfill({ status: 204 });
  });
  await page.goto("http://forum.test/");
  await page.addStyleTag({ path: path.join(source, "css/all.css") });
  for (const name of ["js/lib/00-jquery.min.js", "js/lib/jquery.csslater.js", "js/lib/jquery.easing.1.3.js", "js/lib/jquery.cssanim.js"]) {
    await page.addScriptTag({ path: path.join(source, name) });
  }
  await page.evaluate(({ admin, author }) => {
    window.LogMixin = { log() {}, logStart() {}, logEnd() {} };
    window.EpixFrame = class { log() {} logStart() {} logEnd() {} };
    window._ = value => value;
    window.Text = {
      toUrl: value => value.replace(/ /g, "-"), formatUsername: value => value,
      toMarked: value => `<p>${value}</p>`, toMarkedInline: value => value,
      toColor: () => "black"
    };
    window.Time = { since: () => "now", date: () => "today" };
    window.UserPrefs = { get: (_key, fallback) => fallback };
    window.Tipping = { computeContentHash: () => "hash", loadTipCounts() {} };
    window.Moderation = {
      isMod: () => admin, isAdmin: () => admin, isReported: () => false,
      deleteContent(type, uri, callback) { window.deleted.push({ type, uri, moderation: true }); callback(); }
    };
    window.User = {
      my_topic_votes: {}, my_comment_votes: {},
      resolveXidName(_address, callback) { callback("alice", "epix", ""); }, showRowAvatar() {},
      editRecordById(collection, id_field, id_value, changes, deleted, callback) {
        if (deleted) window.deleted.push({ collection, id_field, id_value });
        Object.assign(window.topic, changes);
        callback(window.writeSucceeds);
      }
    };
    window.hljs = { highlightBlock() {} };
    window.deleted = [];
    window.writeSucceeds = true;
    window.confirmation = true;
    window.confirm = () => window.confirmation;
    window.topic = {
      topic_id: 42, topic_creator_address: author, topic_creator_user_name: author,
      row_topic_uri: "42_" + author, title: "Example topic", body: "Original body", added: 1,
      votes: 1, type: "topic", parent_topic_uri: null
    };
  }, { admin, author });
  for (const name of ["js/utils/InlineEditor.js", "js/utils/Menu.js", "js/EpixTalk.js", "js/TopicList.js", "js/TopicShow.js"]) {
    await page.addScriptTag({ path: path.join(source, name) });
  }
  await page.evaluate(async initializeEditors => {
    Page.site_info = { xid_directory: "alice.epix", auth_address: "epix1alice" };
    Page.cmd = (command, params, callback) => {
      if (command === "dbQuery") callback([window.topic]);
      else if (command === "wrapperConfirm") callback(window.confirmation);
    };
    TopicShow.topic_id = 42;
    TopicShow.topic_user_address = window.topic.topic_creator_address;
    TopicShow.topic_uri = window.topic.row_topic_uri;
    $("body").addClass("page-topic");
    $("#loading-overlay").remove();
    // Empty comments can finish before the topic query returns.
    Page.addInlineEditors();
    await new Promise(resolve => TopicShow.loadTopic(resolve));
    if (initializeEditors) Page.addInlineEditors();
  }, initializeEditors);
  return page;
}

test("topic editors initialize when the topic arrives after comments", async t => {
  const page = await fixture(t, { initializeEditors: false });
  assert.equal(await page.evaluate(() => !!$(".topic-full .body").data("editor")), true);
  assert.equal(await page.locator(".topic-full .editable-edit").count(), 2);
});

test("cancel and immediately reopen keeps editing controls usable", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const editor = $(".topic-full .body").data("editor");
    editor.startEdit();
    editor.cancelEdit();
    editor.startEdit();
  });
  await page.waitForTimeout(1200);
  assert.notEqual(await page.locator(".editbar").evaluate(el => getComputedStyle(el).display), "none");
  assert.notEqual(await page.locator(".editbg").evaluate(el => getComputedStyle(el).display), "none");
  await page.locator(".editbar .cancel").click();
  assert.equal(await page.locator(".topic-full textarea.editor").count(), 0);
  assert.notEqual(await page.locator(".topic-full > .editable-edit").evaluate(el => getComputedStyle(el).display), "none");
});

test("saving and immediately editing again keeps the new edit session usable", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const editor = $(".topic-full .body").data("editor");
    editor.startEdit();
    editor.editor.val("Updated body");
    editor.saveEdit();
    editor.startEdit();
  });
  await page.waitForTimeout(1200);
  assert.notEqual(await page.locator(".editbar").evaluate(el => getComputedStyle(el).display), "none");
  assert.equal(await page.locator(".topic-full textarea.editor").inputValue(), "Updated body");
});

test("starting an already active editor does not leave orphan textareas", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const editor = $(".topic-full .body").data("editor");
    editor.startEdit();
    editor.editor.val("Unsaved draft");
    editor.startEdit();
  });
  assert.equal(await page.locator(".topic-full textarea.editor").count(), 1);
  assert.equal(await page.locator(".topic-full textarea.editor").inputValue(), "Unsaved draft");
});

for (const admin of [false, true]) {
  test(`an ${admin ? "admin author" : "ordinary author"} gets one working Delete topic action`, async t => {
    const page = await fixture(t, { admin });
    await page.locator(".topic-full > .menu_3dot").click();
    const actions = page.locator(".menu.visible .menu-item").filter({ hasText: /^Delete topic$/ });
    assert.equal(await actions.count(), 1);
    await actions.click();
    assert.equal(await page.evaluate(() => window.deleted.length), 1);
    assert.deepEqual(await page.evaluate(() => window.deleted[0]), {
      collection: "topics", id_field: "topic_id", id_value: 42
    });
  });
}

test("an admin can delete another author's topic through moderation", async t => {
  const page = await fixture(t, { admin: true, author: "bob.epix" });
  await page.locator(".topic-full > .menu_3dot").click();
  const actions = page.locator(".menu.visible .menu-item").filter({ hasText: /^Delete topic$/ });
  assert.equal(await actions.count(), 1);
  await actions.click();
  assert.deepEqual(await page.evaluate(() => window.deleted[0]), {
    type: "topic", uri: "42_bob.epix", moderation: true
  });
});

test("canceling the author's delete confirmation never writes a tombstone", async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.confirmation = false; });
  await page.locator(".topic-full > .menu_3dot").click();
  await page.locator(".menu.visible .menu-item").filter({ hasText: /^Delete topic$/ }).click();
  assert.equal(await page.evaluate(() => window.deleted.length), 0);
});

test("a visitor cannot delete another author's topic", async t => {
  const page = await fixture(t, { author: "bob.epix" });
  await page.locator(".topic-full > .menu_3dot").click();
  assert.equal(await page.locator(".menu.visible .menu-item").filter({ hasText: /^Delete topic$/ }).count(), 0);
});


test("the first own-topic Delete action works when comments arrive first", async t => {
  const page = await fixture(t, { admin: true, initializeEditors: false });
  await page.locator(".topic-full > .menu_3dot").click();
  await page.locator(".menu.visible .menu-item").filter({ hasText: /^Delete topic$/ }).first().click();
  assert.equal(await page.evaluate(() => window.deleted.length), 1);
});

test("failed deletion keeps the current editor and draft available", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.writeSucceeds = false;
    const editor = $(".topic-full .body").data("editor");
    editor.startEdit();
    editor.editor.val("Keep this draft");
    editor.deleteObject();
  });
  assert.equal(await page.locator(".topic-full textarea.editor").count(), 1);
  assert.equal(await page.locator(".topic-full textarea.editor").inputValue(), "Keep this draft");
  assert.equal(await page.locator(".editbar .delete").evaluate(el => el.classList.contains("loading")), false);
});

test("failed saving preserves the draft and enables retry", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.writeSucceeds = false;
    const editor = $(".topic-full .body").data("editor");
    editor.startEdit();
    editor.editor.val("Keep this draft");
    editor.saveEdit();
  });
  assert.equal(await page.locator(".topic-full textarea.editor").inputValue(), "Keep this draft");
  assert.equal(await page.locator(".editbar .save").evaluate(el => el.classList.contains("loading")), false);
});


test("switching fields after cancel does not inherit delayed toolbar cleanup", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const body = $(".topic-full .body").data("editor");
    body.startEdit();
    body.cancelEdit();
    $(".topic-full .title-link").data("editor").startEdit();
  });
  await page.waitForTimeout(1200);
  assert.notEqual(await page.locator(".editbar").evaluate(el => getComputedStyle(el).display), "none");
  assert.equal(await page.locator(".topic-full textarea.editor").inputValue(), "Example topic");
});

test("a delayed save completion does not close a later edit or erase its draft", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const write = User.editRecordById;
    User.editRecordById = (...args) => { window.finishSave = () => write(...args); };
    const editor = $(".topic-full .body").data("editor");
    editor.startEdit();
    editor.editor.val("Saved change");
    editor.saveEdit();
    editor.cancelEdit();
    editor.startEdit();
    editor.editor.val("New unsaved draft");
    window.finishSave();
  });
  assert.equal(await page.locator(".topic-full textarea.editor").count(), 1);
  assert.equal(await page.locator(".topic-full textarea.editor").inputValue(), "New unsaved draft");
  assert.notEqual(await page.locator(".editbar").evaluate(el => getComputedStyle(el).display), "none");
});


test("pending deletion blocks new edits until failure or cancellation permits retry", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const write = User.editRecordById;
    User.editRecordById = (...args) => { window.finishDelete = () => write(...args); };
    const editor = $(".topic-full .body").data("editor");
    editor.startEdit();
    editor.deleteObject();
    editor.cancelEdit();
    editor.startEdit();
    $(".topic-full .title-link").data("editor").startEdit();
  });
  assert.equal(await page.locator(".topic-full textarea.editor").count(), 0,
    "a confirmed deletion must not accept a new draft that its completion would discard");
  await page.evaluate(() => {
    window.writeSucceeds = false;
    window.finishDelete();
    $(".topic-full .body").data("editor").startEdit();
  });
  assert.equal(await page.locator(".topic-full textarea.editor").count(), 1,
    "a failed deletion must allow editing again");
});

test("a canceled delete releases the object for another edit", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.confirmation = false;
    const editor = $(".topic-full .body").data("editor");
    editor.deleteObject();
    editor.startEdit();
  });
  assert.equal(await page.locator(".topic-full textarea.editor").count(), 1);
});
