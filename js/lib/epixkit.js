/**
 * EpixKit - Wallet connection library for Epix Chain dApps
 * https://github.com/EpixZone/epixkit
 * MIT License
 */
(function() {
 "use strict"

 var config = null
 // Solana-only Phantom, and Leap (no longer a wallet). Matched as substrings of
 // a wallet's EIP-6963 name or rdns, and of its fallback name.
 var defaultExclude = ["phantom", "app.phantom", "leap", "io.leapwallet"]
 // The Epix Wallet's EIP-6963 identity (the EpixNet browser injects it).
 var EPIX_WALLET_RDNS = "zone.epix.wallet"
 // Extensions can announce a little after the request; wait this long.
 var DISCOVERY_SETTLE_MS = 150
 var state = { provider: null, address: null, walletName: null, walletIcon: null }
 var discoveredWallets = {}
 var styleInjected = false
 var modalInjected = false
 var modalResolve = null
 var activeConnection = null
 var REQUEST_TIMEOUT_MS = 60000
 var STORAGE_KEY = "epixkit_wallet"

 function saveWalletPref(info) {
  try { localStorage.setItem(STORAGE_KEY, info.rdns || info.uuid || info.name) } catch (e) {}
 }

 function loadWalletPref() {
  try { return localStorage.getItem(STORAGE_KEY) } catch (e) { return null }
 }

 function clearWalletPref() {
  try { localStorage.removeItem(STORAGE_KEY) } catch (e) {}
 }

 function findSavedWallet(wallets) {
  var pref = loadWalletPref()
  if (!pref) return null
  for (var i = 0; i < wallets.length; i++) {
   var info = wallets[i].info
   if ((info.rdns && info.rdns === pref) || info.uuid === pref || info.name === pref) return wallets[i]
  }
  return null
 }

 // EIP-6963 wallet discovery - start listening immediately
 window.addEventListener("eip6963:announceProvider", function(e) {
  var d = e.detail
  if (d && d.info && d.provider) {
   discoveredWallets[d.info.uuid] = { info: d.info, provider: d.provider }
  }
 })
 window.dispatchEvent(new Event("eip6963:requestProvider"))

 // Name a provider that only injects window.ethereum (no EIP-6963
 // announcement). Specific flags come BEFORE isMetaMask: Rabby, Brave,
 // Coinbase, Trust and the Epix Wallet all set isMetaMask for compatibility.
 function detectFallbackName(p) {
  if (p.isEpixWallet) return "Epix Wallet"
  if (p.isRabby) return "Rabby"
  if (p.isBraveWallet) return "Brave Wallet"
  if (p.isCoinbaseWallet) return "Coinbase Wallet"
  if (p.isTrust || p.isTrustWallet) return "Trust Wallet"
  if (p.isOkxWallet || p.isOKExWallet) return "OKX Wallet"
  if (p.isZerion) return "Zerion"
  if (p.isExodus) return "Exodus"
  if (p.isTally || p.isTaho) return "Taho"
  if (p.isTokenPocket) return "TokenPocket"
  if (p.isBitKeep) return "Bitget Wallet"
  if (p.isFrame) return "Frame"
  if (p.isKeplr) return "Keplr"
  if (p.isMetaMask) return "MetaMask"
  return "Browser Wallet"
 }

 // Sort: the Epix Wallet first, then by name.
 function walletOrder(a, b) {
  var ea = a.info.rdns === EPIX_WALLET_RDNS ? 0 : 1
  var eb = b.info.rdns === EPIX_WALLET_RDNS ? 0 : 1
  if (ea !== eb) return ea - eb
  return (a.info.name || "").localeCompare(b.info.name || "")
 }

 function settle() {
  return new Promise(function(r) { setTimeout(r, DISCOVERY_SETTLE_MS) })
 }

 function isExcluded(info) {
  var exclude = defaultExclude.concat(config && config.excludeWallets ? config.excludeWallets : [])
  var name = (info.name || "").toLowerCase()
  var rdns = (info.rdns || "").toLowerCase()
  for (var i = 0; i < exclude.length; i++) {
   var ex = exclude[i].toLowerCase()
   if (name.indexOf(ex) !== -1 || rdns.indexOf(ex) !== -1) return true
  }
  return false
 }

 // Every installed wallet, and only installed wallets: the EIP-6963
 // announcements, plus any provider that only injected window.ethereum (the
 // same provider object is never listed twice). Nothing here is a download
 // link or a "popular" placeholder.
 function getWalletListInternal() {
  var list = []
  var seen = []
  for (var uuid in discoveredWallets) {
   var w = discoveredWallets[uuid]
   if (isExcluded(w.info) || seen.indexOf(w.provider) !== -1) continue
   seen.push(w.provider)
   list.push(w)
  }
  if (window.ethereum) {
   var legacy = window.ethereum.providers && window.ethereum.providers.length > 0
    ? window.ethereum.providers
    : [window.ethereum]
   legacy.forEach(function(p, i) {
    if (!p || p.isPhantom || p.isLeap || seen.indexOf(p) !== -1) return
    var info = { uuid: "_fallback_" + i, name: detectFallbackName(p), icon: null, rdns: null }
    if (isExcluded(info)) return
    seen.push(p)
    list.push({ info: info, provider: p })
   })
  }
  list.sort(walletOrder)
  return list
 }

 function escHtml(s) {
  var d = document.createElement("div")
  d.appendChild(document.createTextNode(s))
  return d.innerHTML
 }

 function injectStyle() {
  if (styleInjected) return
  styleInjected = true
  var style = document.createElement("style")
  style.textContent = [
   ".epixkit-overlay {",
   " position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7);",
   " display: flex; align-items: center; justify-content: center; z-index: 10000;",
   "}",
   ".epixkit-box {",
   " background: #161b22; border: 1px solid #30363d; border-radius: 12px;",
   " padding: 24px; max-width: 380px; width: 90%; max-height: 80vh; overflow-y: auto;",
   "}",
   ".epixkit-box h3 { color: #e0e0e0; font-size: 1.1em; margin-bottom: 16px; margin-top: 0; }",
   ".epixkit-item {",
   " display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px;",
   " margin-bottom: 6px; background: #0d1117; border: 1px solid #30363d; color: #e0e0e0;",
   " border-radius: 8px; cursor: pointer; font-size: 0.95em; font-weight: 500;",
   " font-family: inherit; transition: border-color 0.15s, background 0.15s;",
   " box-sizing: border-box;",
   "}",
   ".epixkit-item:hover { border-color: #58a6ff; background: #1a2332; }",
   ".epixkit-item img { width: 32px; height: 32px; border-radius: 6px; }",
   ".epixkit-close {",
   " float: right; background: none; border: none; color: #484f58; font-size: 1.4em;",
   " cursor: pointer; margin: 0; padding: 0; line-height: 1;",
   "}",
   ".epixkit-close:hover { color: #e0e0e0; }",
   ".epixkit-connecting {",
   " display: flex; align-items: center; gap: 12px; padding: 20px 0; justify-content: center;",
   " color: #8b949e; font-size: 0.9em;",
   "}",
   ".epixkit-spinner {",
   " width: 20px; height: 20px; border: 2px solid #30363d; border-top-color: #58a6ff;",
   " border-radius: 50%; animation: epixkit-spin 0.8s linear infinite;",
   "}",
   "@keyframes epixkit-spin { to { transform: rotate(360deg); } }",
   ".epixkit-empty a { color: #58a6ff; text-decoration: none; }",
   ".epixkit-empty a:hover { text-decoration: underline; }"
  ].join("\n")
  document.head.appendChild(style)
 }

 function injectModal() {
  if (modalInjected) return
  modalInjected = true
  var modal = document.createElement("div")
  modal.id = "epixkit-modal"
  modal.style.display = "none"
  modal.innerHTML = [
   '<div class="epixkit-overlay">',
   ' <div class="epixkit-box">',
   '  <button class="epixkit-close">&times;</button>',
   '  <h3>Connect Wallet</h3>',
   '  <div id="epixkit-list"></div>',
   '  <div id="epixkit-empty" class="epixkit-empty" style="display:none;color:#8b949e;font-size:0.85em;text-align:center;padding:20px 0;"></div>',
   ' </div>',
   '</div>'
  ].join("")

  // Close on overlay click
  modal.querySelector(".epixkit-overlay").addEventListener("click", function(e) {
   if (e.target === this) closeModal()
  })
  // Close button
  modal.querySelector(".epixkit-close").addEventListener("click", closeModal)
  // Stop propagation on box
  modal.querySelector(".epixkit-box").addEventListener("click", function(e) {
   e.stopPropagation()
  })

  document.body.appendChild(modal)
 }

 function showModal(wallets) {
  injectStyle()
  injectModal()

  var list = document.getElementById("epixkit-list")
  var empty = document.getElementById("epixkit-empty")
  list.innerHTML = ""

  if (wallets.length === 0) {
   empty.innerHTML = emptyStateHtml()
   empty.style.display = "block"
   document.getElementById("epixkit-modal").style.display = "block"
   return new Promise(function(resolve) { modalResolve = resolve })
  }

  empty.style.display = "none"
  wallets.forEach(function(w) {
   var btn = document.createElement("button")
   btn.className = "epixkit-item"
   if (w.info.icon) {
    var img = document.createElement("img")
    img.src = w.info.icon
    img.alt = w.info.name
    btn.appendChild(img)
   } else {
    var placeholder = document.createElement("div")
    placeholder.style.cssText = "width:32px;height:32px;border-radius:6px;background:#30363d;display:flex;align-items:center;justify-content:center;color:#8b949e;font-size:1.2em;flex-shrink:0;"
    placeholder.textContent = w.info.name.charAt(0)
    btn.appendChild(placeholder)
   }
   var name = document.createElement("span")
   name.textContent = w.info.name
   btn.appendChild(name)
   btn.onclick = function() {
    var resolve = modalResolve
    modalResolve = null
    if (resolve) resolve(w)
   }
   list.appendChild(btn)
  })

  document.getElementById("epixkit-modal").style.display = "block"
  return new Promise(function(resolve) { modalResolve = resolve })
 }

 // What to say when no wallet is installed. The EpixNet browser ships the Epix
 // Wallet, so that is the first suggestion; `init({installUrl, installLabel})`
 // names a download of your choice; MetaMask and Rabby remain as examples. On
 // iOS no extension can inject a wallet into a page yet.
 function emptyStateHtml() {
  var parts = ["No wallets detected.<br>"]
  if (config && config.installUrl) {
   parts.push('Install <a href="' + escHtml(config.installUrl) + '" target="_blank" rel="noopener">' +
    escHtml(config.installLabel || "a wallet") + '</a>, or ')
  } else {
   parts.push("Use the EpixNet browser, which includes the Epix Wallet, or install ")
  }
  parts.push('<a href="https://metamask.io/download/" target="_blank" rel="noopener">MetaMask</a>, ')
  parts.push('<a href="https://rabby.io/" target="_blank" rel="noopener">Rabby</a>, or another EVM wallet.')
  return parts.join("")
 }

 function showConnecting(name) {
  injectStyle()
  injectModal()
  var list = document.getElementById("epixkit-list")
  var empty = document.getElementById("epixkit-empty")
  empty.style.display = "none"
  list.innerHTML = '<div class="epixkit-connecting" role="status"><div class="epixkit-spinner"></div>Connecting to ' + escHtml(name) + '...</div><p style="color:#8b949e;font-size:0.85em;text-align:center;">Check your wallet for a connection or network prompt. Close this dialog to cancel.</p>'
  document.getElementById("epixkit-modal").style.display = "block"
 }

 function showError(msg) {
  var list = document.getElementById("epixkit-list")
  list.innerHTML = '<div style="color:#f85149;font-size:0.85em;text-align:center;padding:12px 0;">' + escHtml(msg) + '</div>'
 }

 function closeModal() {
  var modal = document.getElementById("epixkit-modal")
  if (modal) modal.style.display = "none"
  if (modalResolve) { modalResolve(null); modalResolve = null }
  if (activeConnection) {
   activeConnection.cancelled = true
   if (activeConnection.cancelRequest) activeConnection.cancelRequest()
  }
 }

 function timeoutMessage() {
  if (window.origin === "null") {
   return "The wallet did not respond. This xite's restricted frame can block wallet connections. For now, try the desktop EpixNet browser with a .epix address. Close any pending wallet prompt before retrying."
  }
  return "The wallet did not respond. Open your wallet and check for a pending connection or network prompt. Close any pending prompt before retrying."
 }

 // Wallet requests can remain unresolved when an extension cannot talk to a
 // sandboxed page. Cancelling only stops this connection attempt; it cannot
 // dismiss a prompt that the wallet already opened.
 function request(provider, args, attempt) {
  return new Promise(function(resolve, reject) {
   var settled = false
   var timer
   function finish(error, result) {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (attempt) attempt.cancelRequest = null
    if (error) reject(error)
    else resolve(result)
   }
   if (attempt && attempt.cancelled) { finish(new Error("User cancelled")); return }
   var timeout = config && config.requestTimeoutMs
   if (!(typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0)) timeout = REQUEST_TIMEOUT_MS
   timer = setTimeout(function() { finish(new Error(timeoutMessage())) }, timeout)
   if (attempt) attempt.cancelRequest = function() { finish(new Error("User cancelled")) }
   try {
    Promise.resolve(provider.request(args)).then(function(result) { finish(null, result) }, function(error) { finish(error) })
   } catch (error) { finish(error) }
  })
 }

 async function switchChain(provider, attempt) {
  if (!config || !config.chainId) return
  try {
   await request(provider, { method: "wallet_switchEthereumChain", params: [{ chainId: config.chainId }] }, attempt)
  } catch (err) {
   if (err.code === 4902) {
    var params = { chainId: config.chainId }
    if (config.chainName) params.chainName = config.chainName
    if (config.rpcUrls) params.rpcUrls = config.rpcUrls
    if (config.blockExplorerUrls) params.blockExplorerUrls = config.blockExplorerUrls
    if (config.nativeCurrency) params.nativeCurrency = config.nativeCurrency
    await request(provider, { method: "wallet_addEthereumChain", params: [params] }, attempt)
   } else {
    throw err
   }
  }
 }

 // Public API
 window.EpixKit = {
  init: function(cfg) {
   config = cfg || {}
   if (config.onReconnect) {
    var cb = config.onReconnect
    ;(async function() {
     try {
      var result = await window.EpixKit.reconnect()
      if (result) cb(result)
     } catch (err) {}
    })()
   }
  },

  connect: async function() {
   if (activeConnection || modalResolve) throw new Error("A wallet connection is already in progress")
   var attempt = { cancelled: false, cancelRequest: null }
   activeConnection = attempt
   try {
   // Re-request providers in case wallets loaded after page init
   window.dispatchEvent(new Event("eip6963:requestProvider"))

   // Let late wallets announce
   await settle()
   if (attempt.cancelled) throw new Error("User cancelled")

   var wallets = getWalletListInternal()

   var selected
   if (wallets.length === 0) {
    // Show modal with install links, then reject when closed
    await showModal(wallets)
    return Promise.reject(new Error("No wallet detected"))
   }

   // The wallet used last time connects again without asking.
   selected = findSavedWallet(wallets)

   // Otherwise the picker always shows, even for a single installed wallet:
   // the user sees which wallet (the Epix Wallet inside the EpixNet browser)
   // is about to be connected.
   if (!selected) {
    selected = await showModal(wallets)
    if (!selected) return Promise.reject(new Error("User cancelled"))
   }

   showConnecting(selected.info.name)

   try {
    var raw = selected.provider

    // Request accounts
    await request(raw, { method: "eth_requestAccounts" }, attempt)

    // Switch chain
    await switchChain(raw, attempt)

    // Get the connected address
    var accounts = await request(raw, { method: "eth_accounts" }, attempt)
    if (attempt.cancelled) throw new Error("User cancelled")
    if (!accounts || !accounts.length) throw new Error("The wallet did not share an account. Unlock it and approve the connection, then try again.")
    var address = accounts[0]

    // Store state + remember wallet choice
    state.provider = raw
    state.address = address
    state.walletName = selected.info.name
    state.walletIcon = selected.info.icon
    saveWalletPref(selected.info)

    // Close modal
    var modal = document.getElementById("epixkit-modal")
    if (modal) modal.style.display = "none"

    return {
     provider: raw,
     address: address,
     walletName: selected.info.name,
     walletIcon: selected.info.icon
    }
   } catch (err) {
    if (!attempt.cancelled) showError(err.message || "Connection failed")
    throw err
   }
   } finally {
    if (activeConnection === attempt) activeConnection = null
   }
  },

  reconnect: async function() {
   var pref = loadWalletPref()
   if (!pref) return null

   window.dispatchEvent(new Event("eip6963:requestProvider"))
   await settle()

   var wallets = getWalletListInternal()
   var saved = findSavedWallet(wallets)
   if (!saved) return null

   try {
    var raw = saved.provider
    // Silent check - no popup, just see if already authorized
    var accounts = await request(raw, { method: "eth_accounts" })
    if (!accounts || accounts.length === 0) return null

    await switchChain(raw)

    state.provider = raw
    state.address = accounts[0]
    state.walletName = saved.info.name
    state.walletIcon = saved.info.icon

    return {
     provider: raw,
     address: accounts[0],
     walletName: saved.info.name,
     walletIcon: saved.info.icon
    }
   } catch (err) {
    return null
   }
  },

  disconnect: function() {
   state.provider = null
   state.address = null
   state.walletName = null
   state.walletIcon = null
   clearWalletPref()
  },

  isConnected: function() {
   return !!(state.provider && state.address)
  },

  getAddress: function() {
   return state.address
  },

  getProvider: function() {
   return state.provider
  },

  getWalletName: function() {
   return state.walletName
  },

  // Every installed wallet as [{uuid, name, rdns, icon, provider}], the Epix
  // Wallet first. Async: it re-requests announcements and waits for them.
  getWallets: async function() {
   window.dispatchEvent(new Event("eip6963:requestProvider"))
   await settle()
   return getWalletListInternal().map(function(w) {
    return { uuid: w.info.uuid, name: w.info.name, rdns: w.info.rdns || null, icon: w.info.icon || null, provider: w.provider }
   })
  },

  // The Epix Wallet's EIP-6963 rdns, for callers that want to special-case it.
  EPIX_WALLET_RDNS: EPIX_WALLET_RDNS
 }
})()
