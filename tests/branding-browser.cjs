// Run with EPIX_BROWSER_TEST_TOOLS=/path/to/node_modules node tests/branding-browser.cjs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.EPIX_BROWSER_TEST_TOOLS
  ? path.join(process.env.EPIX_BROWSER_TEST_TOOLS, "playwright") : "playwright");
const root = path.resolve(__dirname, "..");

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    let content = fs.readFileSync(file);
    if (file.endsWith(".html")) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "application/javascript");
    res.end(content);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.EPIX_CHROMIUM_PATH ? { executablePath: process.env.EPIX_CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ path: path.join(root, "js/lib/00-jquery.min.js") });
    await page.evaluate(() => {
      window.LogMixin = {};
      window.testSettings = { mods: ["mod.epix"], pinned_topic_uris: ["1_alice.epix"] };
      window.testWrites = [];
      window.testNotices = [];
      window.testRole = "admin";
      window.Moderation = {
        isAdmin: () => testRole === "admin", admin_settings: testSettings,
        loadAdminSettings(cb) { this.admin_settings = structuredClone(testSettings); if (window.Branding) Branding.apply(this.admin_settings.branding); cb(); }
      };
      window.Page = {
        site_info: { settings: {}, content: {} }, onPageLoaded() {},
        cmd(name, args, cb) {
          if (name === "fileGet") cb(JSON.stringify(testSettings));
          else if (name === "fileWrite") {
            if (window.testFailWrite) { cb({ error: "disk full" }); return; }
            testSettings = JSON.parse(decodeURIComponent(escape(atob(args[1]))));
            testWrites.push(args[0]); cb("ok");
          } else if (name === "sitePublish" && window.testDelayPublish) window.testFinishPublish = cb;
          else if (name === "siteSign" || name === "sitePublish") cb("ok");
          else if (name === "wrapperNotification") testNotices.push(args);
        }
      };
    });
    if (fs.existsSync(path.join(root, "js/utils/Branding.js"))) await page.addScriptTag({ path: path.join(root, "js/utils/Branding.js") });
    await page.addScriptTag({ path: path.join(root, "js/Admin.js") });
    await page.evaluate(() => { Admin.loadRoles = () => {}; Admin.loadReportedContent = () => {}; Admin.actionShow(); $(".loading-overlay").hide(); });
    assert.equal(await page.locator(".admin-branding-title").count(), 1, "admin can change the site title");
    assert.equal(await page.locator(".admin-branding-logo").count(), 1, "admin can change the logo");
    assert.equal(await page.locator(".admin-branding-hue").count(), 1, "admin can change accent hue at fixed OKLab lightness");
    console.log("PASS: admin branding controls available");
    await page.locator(".admin-branding-title").fill("Community <Forum>");
    await page.locator(".admin-branding-logo").fill("img/logo.svg");
    await page.locator(".admin-branding-hue").fill("280");
    await page.locator(".admin-branding-lightness").fill("75");
    await page.locator(".admin-branding-chroma").fill("22");
    await page.locator(".admin-branding-file").setInputFiles({
      name: "logo.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=", "base64")
    });
    await page.waitForFunction(() => !Branding.readingLogo);
    assert.equal(await page.locator(".admin-branding-preview-title").textContent(), "Community <Forum>");
    await page.locator(".admin-branding-save").click();
    assert.equal(await page.locator(".admin-branding-status").textContent(), "Branding saved and published.");
    assert.equal(await page.locator(".logo-title").textContent(), "Community <Forum>");
    assert.equal(await page.title(), "Admin - Community <Forum>");
    await page.waitForFunction(() => document.querySelector(".head .logo img").naturalWidth === 1);
    assert.match(await page.locator(".head .logo img").getAttribute("src"), /^data:image\/png;base64,/);
    assert.deepEqual(await page.evaluate(() => ({ mods: testSettings.mods, pins: testSettings.pinned_topic_uris })), { mods: ["mod.epix"], pins: ["1_alice.epix"] });
    await page.evaluate(() => { Branding.apply(); Moderation.loadAdminSettings(() => {}); Branding.initAdmin(); });
    assert.equal(await page.locator(".admin-branding-title").inputValue(), "Community <Forum>");
    assert.equal(await page.locator(".admin-branding-hue").inputValue(), "280");
    assert.match(await page.locator(".head .logo img").getAttribute("src"), /^data:image\/png;base64,/);
    console.log("PASS: branding persists, renders title as text, and preserves roles and pins");

    await page.evaluate(() => { testFailWrite = true; });
    await page.locator(".admin-branding-title").fill("Retry title");
    await page.locator(".admin-branding-save").click();
    assert.match(await page.locator(".admin-branding-status").textContent(), /ready to retry/);
    assert.equal(await page.locator(".admin-branding-save").isEnabled(), true);
    assert.equal(await page.locator(".logo-title").textContent(), "Community <Forum>");
    await page.evaluate(() => { testFailWrite = false; });
    await page.locator(".admin-branding-save").click();
    assert.equal(await page.locator(".logo-title").textContent(), "Retry title");
    await page.evaluate(() => { testRole = "mod"; });
    const writes = await page.evaluate(() => testWrites.length);
    await page.locator(".admin-branding-title").fill("Unauthorized");
    await page.locator(".admin-branding-save").click();
    assert.equal(await page.evaluate(() => testWrites.length), writes);
    await page.evaluate(() => { testRole = "admin"; });
    await page.locator(".admin-branding-logo").fill("javascript:alert(1)");
    await page.locator(".admin-branding-save").click();
    assert.equal(await page.evaluate(() => testWrites.length), writes);
    console.log("PASS: save failures can be retried and invalid or unauthorized changes cannot write");

    await page.locator(".admin-branding-title").fill("Community Forum");
    await page.locator(".admin-branding-logo").fill("img/logo.svg");
    await page.evaluate(() => { testDelayPublish = true; });
    await page.locator(".admin-branding-save").click();
    assert.equal(await page.locator(".admin-branding-title").isDisabled(), true);
    assert.equal(await page.locator(".admin-branding-file").isDisabled(), true);
    await page.evaluate(() => { testFinishPublish("ok"); testDelayPublish = false; });
    assert.equal(await page.locator(".admin-branding-title").isEnabled(), true);
    await page.evaluate(() => {
      window.testReaders = [];
      window.FileReader = class { constructor() { testReaders.push(this); } readAsDataURL() {} };
    });
    await page.locator(".admin-branding-file").setInputFiles({ name: "first.png", mimeType: "image/png", buffer: Buffer.from("first") });
    assert.equal(await page.locator(".admin-branding-save").isDisabled(), true);
    const beforeRead = await page.evaluate(() => testWrites.length);
    await page.evaluate(() => Branding.save());
    assert.equal(await page.evaluate(() => testWrites.length), beforeRead);
    await page.locator(".admin-branding-file").setInputFiles({ name: "second.png", mimeType: "image/png", buffer: Buffer.from("second") });
    await page.evaluate(() => { testReaders[0].result = "data:image/png;base64,AAAA"; testReaders[0].onload(); });
    assert.equal(await page.locator(".admin-branding-logo").inputValue(), "img/logo.svg");
    await page.evaluate(() => { testReaders[1].result = "data:image/png;base64,BBBB"; testReaders[1].onload(); });
    assert.equal(await page.locator(".admin-branding-logo").inputValue(), "data:image/png;base64,BBBB");
    assert.equal(await page.locator(".admin-branding-save").isEnabled(), true);
    await page.locator(".admin-branding-logo").fill("img/logo.svg");
    console.log("PASS: pending uploads and publishes cannot report unsaved edits as saved");
    for (const theme of ["theme-light", "theme-dark"]) {
      await page.evaluate(theme => { document.body.classList.remove("theme-light", "theme-dark"); document.body.classList.add(theme); }, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, theme + " mobile fits viewport");
      if (process.env.EPIX_SCREENSHOTS) {
        await page.screenshot({ path: path.join(process.env.EPIX_SCREENSHOTS, "branding-" + theme + ".png"), fullPage: false });
      }
    }
    console.log("PASS: branding layout fits mobile light and dark themes");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
