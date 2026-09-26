(function() {
  // Keep the existing post DOM. Only failed images need another request;
  // a slow Tor/I2P fetch must be allowed to finish on its own deadline.
  const failures = new Map();
  const MAX_RETRIES = 3;

  function forget(image) {
    const state = failures.get(image);
    if (!state) return;
    clearTimeout(state.timer);
    state.button.remove();
    failures.delete(image);
  }

  function visible(image) {
    if (!image.isConnected || document.hidden || !image.getClientRects().length) return false;
    const rect = image.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;
  }

  function usesNode(url) {
    return url.origin === window.location.origin ||
      (XiteLinkGuard.isXiteHost(url.hostname) && XiteLinkGuard.canOpenXiteLinks());
  }

  function retry(image, state, manual) {
    if (!image.isConnected || image.src !== state.url.href) {
      forget(image);
      return;
    }
    if (state.loading) return;
    if (!manual && (!usesNode(state.url) || !visible(image) ||
      navigator.connection?.saveData || (!state.available &&
        (state.retries >= MAX_RETRIES || Date.now() < state.next)))) return;
    clearTimeout(state.timer);
    if (manual) state.retries = 0;
    else if (!state.available) state.retries += 1;
    state.available = false;
    state.loading = true;
    state.button.disabled = true;
    state.button.textContent = _("Downloading image...");
    // Reassign the original URL. Do not alter signed external URLs or start
    // a fileNeed request in this xite for an image belonging to another xite.
    image.src = state.url.href;
  }

  function checkVisible() {
    for (const [image, state] of failures) retry(image, state, false);
  }

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!image.matches?.(".body img") || !image.isConnected) return;
    let url;
    try { url = new URL(image.src); } catch (e) { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    let state = failures.get(image);
    if (state && state.url.href !== url.href) {
      forget(image);
      state = null;
    }
    if (!state) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "image-retry";
      state = { url, button, retries: 0, loading: false, available: false, timer: null, next: 0 };
      failures.set(image, state);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        retry(image, state, true);
      });
      // A Markdown image may itself be inside a link. Keep the retry button
      // outside that link so retrying cannot also navigate away from the post.
      const anchor = image.closest("a");
      (anchor || image).after(button);
    }
    state.loading = false;
    state.button.disabled = false;
    state.button.textContent = _("Image unavailable. Retry");
    clearTimeout(state.timer);
    const delay = state.retries === 0 ? 50000 : 60000;
    state.next = Date.now() + delay;
    if (usesNode(url) && state.retries < MAX_RETRIES) {
      state.timer = setTimeout(checkVisible, delay);
    }
  }, true);

  document.addEventListener("load", (event) => forget(event.target), true);
  window.addEventListener("scroll", checkVisible, { passive: true });
  window.addEventListener("resize", checkVisible);
  document.addEventListener("visibilitychange", checkVisible);

  // Rows can be deleted or rebuilt during sync. Release their controls and
  // timers without waiting for another scroll or image event.
  new MutationObserver(() => {
    for (const [image, state] of failures) {
      if (!image.isConnected || image.src !== state.url.href) forget(image);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });

  window.ImageRecovery = {
    fileDone(address, path) {
      if (typeof address !== "string" || typeof path !== "string") return;
      const paths = [new URL("/" + address + "/" + path, window.location.href).pathname];
      if (window.Page?.site_address === address) paths.push(new URL(path, document.baseURI).pathname);
      for (const [image, state] of failures) {
        if (state.url.origin === window.location.origin && paths.includes(state.url.pathname)) {
          // A completed local file can recover even after the network retry
          // budget is exhausted. Still respect visibility and data saver.
          state.available = true;
          retry(image, state, false);
        }
      }
    }
  };
})();
