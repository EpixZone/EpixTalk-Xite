(function () {
  const path = "data/admin/forum-icon.png";

  async function imagePng(source, size, square = true) {
    const image = new Image();
    if (/^https:\/\//i.test(source)) image.crossOrigin = "anonymous";
    image.src = source;
    await image.decode();
    const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = square ? size : width;
    canvas.height = square ? size : height;
    const context = canvas.getContext("2d");
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas.toDataURL("image/png");
  }

  async function render(logo) {
    try {
      return await imagePng(logo, 64);
    } catch {
      const thumbnail = /^https:\/\//i.test(logo) && await window.EpixAvatar?.get(logo, 64, Page);
      if (thumbnail) return imagePng(thumbnail, 64);
      throw new Error("Could not read the logo for the forum icon. Choose an image file or a readable image URL.");
    }
  }

  // Each pass reads the icon before the accepted settings. A competing save
  // either loses the byte comparison or is picked up on the next pass.
  async function sync() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const previous = await Page.cmd("fileGet", {inner_path: path, required: false, format: "base64"});
      const settings = JSON.parse(await Page.cmd("fileGet", {inner_path: "data/admin/admin-settings.json"}));
      const icon = settings?.branding?.favicon;
      if (!icon) return;
      if (typeof previous !== "string") throw new Error("The forum icon file is missing. Update the forum and retry.");
      if (icon === previous) return;
      const args = {inner_path: path, content_base64: icon, expected_base64: previous};
      if (Page.site_info?.privatekey) args.privatekey = "stored";
      const result = await Page.cmd("fileWriteSign", args);
      if (result !== "ok" && !/changed since it was read/i.test(result?.error)) {
        throw new Error(result?.error || "The forum icon could not be signed.");
      }
    }
    throw new Error("The forum icon changed during the save. Please retry.");
  }

  // Older clones keep their own root manifest during a source upgrade.
  // Stage only the favicon pointer. The wrapper lets the owner review and
  // sign the root separately from delegated edits to data/admin.
  async function configure() {
    if (Page.site_info.content?.favicon === path) return "";
    if (!Page.site_info.settings?.own && !Page.site_info.privatekey) return "Ask the owner to save the appearance and publish the forum icon path.";
    const raw = await Page.cmd("fileGet", {inner_path: "content.json"});
    const manifest = JSON.parse(raw);
    if (!manifest?.address || manifest.address !== Page.site_info.address) throw new Error("Could not read this forum's manifest.");
    if (manifest.favicon !== path) {
      manifest.favicon = path;
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 1))));
      const result = await Page.cmd("fileWrite", ["content.json", encoded]);
      if (result !== "ok") throw new Error("Could not set the forum icon path in content.json.");
    }
    return "Sign and publish content.json in the wrapper to enable the forum icon.";
  }

  window.ForumIcon = { imagePng, render, sync, configure };
})();
