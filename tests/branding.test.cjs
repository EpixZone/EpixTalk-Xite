const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const context = vm.createContext({ window: {}, URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/utils/Branding.js"), "utf8"), context);
const branding = context.window.Branding;

test("all accent hues preserve OKLab lightness in the sRGB gamut", () => {
  for (const lightness of [0.35, 0.46, 0.73, 0.8, 0.9]) {
    for (let hue = 0; hue <= 360; hue += 5) {
      const color = branding.color(lightness, 0.3, hue);
      assert.ok(color.channels.every(channel => channel >= 0 && channel <= 1));
      const [r, g, b] = color.channels;
      const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
      const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
      const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
      const measured = 0.2104542553*l + 0.793617785*m - 0.0040720468*s;
      assert.ok(Math.abs(measured - lightness) < 0.000001, `${hue}: ${measured}`);
      const luminance = 0.2126*r + 0.7152*g + 0.0722*b;
      const contrast = color.ink === "#000000" ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
      assert.ok(contrast >= 4.5);
    }
  }
});

test("logo inputs accept image sources and reject active or malformed schemes", () => {
  for (const value of ["img/logo.svg", "data/admin/my-logo.png", "https://images.example/logo.png", "data:image/png;base64,AAAA"]) assert.equal(branding.validLogo(value), true, value);
  for (const value of ["javascript:alert(1)", "data:text/html;base64,AAAA", "data:image/svg+xml;base64,AAAA", "//evil.example/a.png", "https://a:b@example.com/a.png", "../a.png", "https://", null]) assert.equal(branding.validLogo(value), false, String(value));
  assert.equal(branding.normalize({ accent: { hue: NaN, lightness: Infinity, chroma: -3 } }).accent.chroma, 0);
});
