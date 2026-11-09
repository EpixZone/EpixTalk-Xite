const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH ||
  (process.env.EPIX_BROWSER_TEST_TOOLS ? path.join(process.env.EPIX_BROWSER_TEST_TOOLS, "playwright") : "playwright"));

const root = path.resolve(__dirname, "..");
const thumbnail = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

async function fixture(t) {
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    if (request.url === "/") {
      return response.end(`<iframe src="/fixture" style="width:100%;height:300px"></iframe><script>
        window.thumbnailRequests = 0;
        addEventListener('message', event => {
          if (event.data.cmd !== 'wrapperGetAvatarThumbnail') return;
          window.thumbnailRequests++;
          setTimeout(() => { event.ports[0].postMessage({thumbnail: ${JSON.stringify(thumbnail)}}); event.ports[0].close(); }, 40);
        });
      </script>`);
    }
    if (request.url === "/fixture") {
      return response.end(`<div class="head"></div><span class="user_name-my"></span><div class="user-size"></div>
        <script src="/js/lib/00-jquery.min.js"></script>
        <script>
          window.LogMixin = {log() {}};
          window.Text = {toColor() { return 'purple'; }};
          window.lookup = {name: 'alice', tld: 'epix', avatar: 'https://images.example/alice.png'};
          window.EpixFrame = class {
            log() {}
            cmd(command, params, callback) {
              if (command === 'xidResolve') callback(window.lookup);
              if (command === 'fileRules') callback({current_size: 0});
              if (command === 'wrapperAvatarThumbnailVersion') callback({version: 1, origin: location.origin});
            }
          };
        </script>
        <script src="/js/lib/epix-avatar.js"></script>
        <script src="/js/User.js"></script>
        <script src="/js/EpixTalk.js"></script>
        <script>
          User.maybeMigrate = () => {};
          window.identity = {auth_address: 'epix1alice', cert_user_id: 'alice@xid.epix', xid_directory: 'alice.epix'};
          Page.setSiteinfo(identity);
        </script>`);
    }
    const file = path.resolve(root, "." + request.url);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
      response.statusCode = 404;
      return response.end();
    }
    response.setHeader("Content-Type", "text/javascript");
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const frame = page.frames().find(frame => frame.url().endsWith("/fixture"));
  await frame.waitForFunction(() => document.querySelector(".xid-tag img")?.complete && document.querySelector(".xid-tag img")?.naturalWidth > 0);
  return {page, frame};
}

test("sync progress keeps the loaded xID avatar visible without re-requesting it", async t => {
  const {page, frame} = await fixture(t);
  const result = await frame.evaluate(async () => {
    const image = document.querySelector(".xid-tag img");
    const src = image.src;
    let blankFrames = 0;
    let replacements = 0;
    for (let i = 0; i < 5; i++) {
      Page.setSiteinfo({event: ['file_done', `data/users/user${i}.epix/content.json`], peers: i + 1});
      await new Promise(requestAnimationFrame);
      const current = document.querySelector(".xid-tag img");
      if (current !== image) replacements++;
      if (!current?.getAttribute('src') || current.src !== src) blankFrames++;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    return {blankFrames, replacements};
  });
  const requests = await page.evaluate(() => window.thumbnailRequests);
  console.log(JSON.stringify({...result, thumbnailRequests: requests}));
  assert.equal(result.blankFrames, 0, "sync events must not blank a loaded avatar");
  assert.equal(result.replacements, 0, "sync events must retain the loaded image");
  assert.equal(requests, 1, "the unchanged avatar only needs one thumbnail request");
});

test("avatar changes, removal, identity changes, and reconnect still update the tag", async t => {
  const {frame} = await fixture(t);
  await frame.evaluate(() => {
    window.lookup.avatar = 'https://images.example/updated.png';
    Page.setSiteinfo({peers: 9});
  });
  await frame.waitForFunction(() => document.querySelector('.xid-tag img')?.getAttribute('src'));
  await frame.evaluate(() => {
    window.lookup.avatar = '';
    Page.setSiteinfo({peers: 10});
  });
  assert.equal(await frame.locator('.xid-tag img').count(), 0);
  await frame.evaluate(() => {
    window.lookup = {name: 'bob', tld: 'epix', avatar: 'https://images.example/bob.png'};
    Page.setSiteinfo({auth_address: 'epix1bob', cert_user_id: 'bob@xid.epix', xid_directory: 'bob.epix'});
  });
  assert.equal(await frame.locator('.xid-tag').textContent(), 'bob.epix');
  assert.equal(await frame.locator('.xid-tag').getAttribute('href'), '?User:bob.epix');
  await frame.evaluate(() => Page.setSiteinfo({auth_address: null, cert_user_id: null, xid_directory: null}));
  assert.equal(await frame.locator('.xid-tag').count(), 0);
  assert.equal(await frame.locator('.xid-fab').count(), 1);
  await frame.evaluate(() => Page.setSiteinfo({auth_address: 'epix1bob', cert_user_id: 'bob@xid.epix', xid_directory: 'bob.epix'}));
  assert.equal(await frame.locator('.xid-tag').count(), 1);
  assert.equal(await frame.locator('.xid-fab').count(), 0);
});
