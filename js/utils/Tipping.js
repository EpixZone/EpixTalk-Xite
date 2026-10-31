(function() {

var TIPPING_CONTRACT = "0xD0793a2a11Fa3600Ec941115937FB8E259cfdbf1";
var TIPPING_ABI = [
  "function tip(bytes32 contentHash, address recipient) external payable",
  "function tipByXid(bytes32 contentHash, string name, string tld) external payable",
  "function getContentInfo(bytes32 contentHash) external view returns (tuple(address creator, uint256 totalAmount, uint32 uniqueTippers, uint8 topCount, uint8 recentCount, tuple(address tipper, uint96 amount, string xidName)[3] top3, tuple(address tipper, uint256 amount, uint64 timestamp, string xidName)[3] last3))",
  "function getTipperCount(bytes32 contentHash) external view returns (uint32)",
  "function getTipperCountBatch(bytes32[] contentHashes) external view returns (uint32[])",
  "function computeContentHash(string siteAddress, string authorDirectory, string postId) external pure returns (bytes32)",
  "event Tipped(bytes32 indexed contentHash, address indexed tipper, address indexed recipient, uint256 amount)"
];

var SITE_ADDRESS = "epix1talk58lw26c0cyrtuu8axptne2p6zf33s7xxwu";

var wallet = { provider: null, signer: null, address: null, contract: null, name: null };
var readProvider = null;
var readContract = null;
var explorerUrl = "https://scan.epix.zone";
var epixkitReady = false;
var currentTipTarget = null; // { contentHash, xidName, xidTld, topicUri }

// --- Initialization ---

function initTipping() {
  if (typeof ethers === "undefined") {
    console.log("[Tipping] ethers.js not loaded - tipping disabled");
    return;
  }
  Page.chainEvmRpcUrl().then(function(evmRpc) {
    Page.chainBlockExplorerUrl().then(function(explorer) {
      // Read-only provider for loading tip counts
      var rpcUrl = evmRpc || "https://evmrpc.epix.zone";
      explorerUrl = (explorer || "https://scan.epix.zone").replace(/\/+$/, "");
      readProvider = new ethers.JsonRpcProvider(rpcUrl);
      readContract = new ethers.Contract(TIPPING_CONTRACT, TIPPING_ABI, readProvider);

      // Init EpixKit for wallet connection (on-demand)
      if (typeof EpixKit !== "undefined") {
        EpixKit.init({
          chainId: "0x77C",
          chainName: "Epix",
          nativeCurrency: { name: "EPIX", symbol: "EPIX", decimals: 18 },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: [explorer || "https://scan.epix.zone"],
          onReconnect: setupWallet
        });
        epixkitReady = true;
      }
    });
  });

  // Modal event listeners
  $(".tip-overlay").on("click", function(e) {
    if ($(e.target).hasClass("tip-overlay")) closeTipModal();
  });
  $(".tip-modal-close").on("click", function() { closeTipModal(); return false; });
  $(".tip-modal-send").on("click", function() { sendTip(); return false; });
  $(".tip-wallet-connect").on("click", function() { connectWallet(); return false; });
  $(".tip-wallet-disconnect").on("click", function() { disconnectWallet(); return false; });
}

// --- Content Hash ---

function computeContentHash(authorDirectory, topicId) {
  if (typeof ethers === "undefined") return null;
  var coder = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(
    coder.encode(
      ["string", "string", "string"],
      [SITE_ADDRESS, authorDirectory, String(topicId)]
    )
  );
}

// --- Load Tip Counts (batch for page load) ---

function loadTipCounts(elems) {
  if (!readContract) return;

  var hashes = [];
  var elemList = [];

  elems.each(function() {
    var el = $(this);
    var hash = el.data("content-hash");
    if (hash) {
      hashes.push(hash);
      elemList.push(el);
    }
  });

  if (hashes.length === 0) return;

  readContract.getTipperCountBatch(hashes).then(function(counts) {
    for (var i = 0; i < counts.length; i++) {
      var count = Number(counts[i]);
      var tipBtn = $(".tip-btn", elemList[i]);
      $(".tip-count", tipBtn).text(count);
      if (count > 0) tipBtn.addClass("has-tips");
    }
  }).catch(function(err) {
    console.log("[Tipping] Batch load error:", err.message);
  });
}

// --- Tip Button Click ---

function openTipModal(contentHash, xidName, xidTld, topicUri) {
  if (!contentHash) return;
  currentTipTarget = { contentHash: contentHash, xidName: xidName, xidTld: xidTld, topicUri: topicUri };

  // Reset modal state
  $(".tip-modal-amount").val("");
  $(".tip-modal-error").hide().text("");
  $(".tip-modal-success").hide().text("");
  $(".tip-modal-send").removeClass("loading");
  $(".tip-stat-summary").text("Loading...");
  $(".tip-stat-top3").empty();
  $(".tip-stat-recent").empty();

  // Update wallet bar
  updateWalletBar();

  // Show modal
  $(".tip-overlay").css("display", "flex");
  setTimeout(function() { $(".tip-overlay").addClass("visible"); }, 10);
  $(".tip-modal-amount").focus();

  // Load full stats
  if (readContract) {
    readContract.getContentInfo(contentHash).then(function(info) {
      var totalEpix = ethers.formatEther(info.totalAmount);
      var uniqueTippers = Number(info.uniqueTippers);
      if (uniqueTippers === 0) {
        $(".tip-stat-summary").text("No tips yet \u2014 be the first!");
      } else {
        $(".tip-stat-summary").text(uniqueTippers + " tipper" + (uniqueTippers !== 1 ? "s" : "") + " \u00b7 " + formatEpix(totalEpix) + " EPIX total");
      }

      // Top 3
      var topCount = Number(info.topCount);
      if (topCount > 0) {
        $(".tip-stat-top3").closest(".tip-stat-section").show();
        for (var i = 0; i < topCount; i++) {
          var t = info.top3[i];
          var amt = ethers.formatEther(t.amount);
          var row = $("<div class='tip-stat-row'></div>");
          row.append("<span class='tip-stat-addr'>" + displayName(t.tipper, t.xidName) + "</span>");
          row.append("<span class='tip-stat-amt'>" + formatEpix(amt) + " EPIX</span>");
          row.append("<a class='tip-stat-link' href='" + explorerUrl + "/address/" + t.tipper + "' target='_blank' title='View on explorer'>\u2197</a>");
          $(".tip-stat-top3").append(row);
        }
      } else {
        $(".tip-stat-top3").closest(".tip-stat-section").hide();
      }

      // Recent 3
      var recentCount = Number(info.recentCount);
      if (recentCount > 0) {
        $(".tip-stat-recent").closest(".tip-stat-section").show();
        for (var i = 0; i < recentCount; i++) {
          var r = info.last3[i];
          var amt = ethers.formatEther(r.amount);
          var ts = Number(r.timestamp);
          var row = $("<div class='tip-stat-row'></div>");
          row.append("<span class='tip-stat-addr'>" + displayName(r.tipper, r.xidName) + "</span>");
          row.append("<span class='tip-stat-amt'>" + formatEpix(amt) + " EPIX</span>");
          if (ts > 0) row.append("<span class='tip-stat-time'>" + Time.since(ts) + "</span>");
          row.append("<a class='tip-stat-link' href='" + explorerUrl + "/address/" + r.tipper + "' target='_blank' title='View on explorer'>\u2197</a>");
          $(".tip-stat-recent").append(row);
        }
      } else {
        $(".tip-stat-recent").closest(".tip-stat-section").hide();
      }
    }).catch(function(err) {
      $(".tip-stat-summary").text("Could not load stats");
      console.log("[Tipping] Stats error:", err.message);
    });
  }
}

function closeTipModal() {
  $(".tip-overlay").removeClass("visible");
  setTimeout(function() { $(".tip-overlay").css("display", "none"); }, 300);
  currentTipTarget = null;
}

// --- Send Tip ---

async function sendTip() {
  if (!currentTipTarget) return;

  var amountStr = $(".tip-modal-amount").val().trim();
  if (!amountStr || parseFloat(amountStr) <= 0) {
    showTipError("Enter a tip amount");
    return;
  }

  $(".tip-modal-error").hide();
  $(".tip-modal-success").hide();

  // Connect wallet if not connected
  if (!wallet.signer) {
    if (!epixkitReady) {
      showTipError("Wallet connector not loaded yet, please try again");
      return;
    }
    try {
      await setupWallet(await EpixKit.connect());
    } catch (err) {
      if (err.message !== "User cancelled" && err.message !== "No wallet detected") {
        showTipError(err.message || "Wallet connection failed");
      }
      return;
    }
  }

  $(".tip-modal-send").addClass("loading").text("Sending...");

  try {
    var value = ethers.parseEther(amountStr);
    var tx = await wallet.contract.tipByXid(currentTipTarget.contentHash, currentTipTarget.xidName, currentTipTarget.xidTld, { value: value });
    $(".tip-modal-send").text("Confirming...");
    await tx.wait();

    $(".tip-modal-send").removeClass("loading").text("Send Tip");
    $(".tip-modal-success").text("Tip sent! " + formatEpix(amountStr) + " EPIX").show();
    $(".tip-modal-amount").val("");

    // Refresh the tip count on the button
    refreshTipCount(currentTipTarget.contentHash, currentTipTarget.topicUri);

    // Reload stats in the modal
    openTipModal(currentTipTarget.contentHash, currentTipTarget.xidName, currentTipTarget.xidTld, currentTipTarget.topicUri);
  } catch (err) {
    $(".tip-modal-send").removeClass("loading").text("Send Tip");
    showTipError(tipErrorMessage(err));
  }
}

function refreshTipCount(contentHash, topicUri) {
  if (!readContract) return;
  readContract.getTipperCount(contentHash).then(function(count) {
    var num = Number(count);
    var elem = $(document.getElementById("topic_" + topicUri));
    if (elem.length) {
      $(".tip-count", elem).text(num);
      if (num > 0) $(".tip-btn", elem).addClass("has-tips");
    }
    // Also update topic-full if visible
    var full = $(".topic-full");
    if (full.length && full.data("content-hash") === contentHash) {
      $(".tip-count", full).text(num);
      if (num > 0) $(".tip-btn", full).addClass("has-tips");
    }
    // Also update any comment with this content hash
    $(".comments .comment:not(.template)").each(function() {
      var el = $(this);
      if (el.data("content-hash") === contentHash) {
        $(".tip-count", el).text(num);
        if (num > 0) $(".tip-btn", el).addClass("has-tips");
      }
    });
  });
}

// --- Wallet Management ---

async function setupWallet(result) {
  wallet.provider = new ethers.BrowserProvider(result.provider);
  wallet.signer = await wallet.provider.getSigner();
  wallet.address = result.address;
  wallet.name = result.walletName || "";
  wallet.contract = new ethers.Contract(TIPPING_CONTRACT, TIPPING_ABI, wallet.signer);
  updateWalletBar();
}

async function connectWallet() {
  if (!epixkitReady) return;
  try {
    await setupWallet(await EpixKit.connect());
  } catch (err) {
    if (err.message !== "User cancelled" && err.message !== "No wallet detected") {
      showTipError(err.message || "Wallet connection failed");
    }
  }
}

function disconnectWallet() {
  if (typeof EpixKit !== "undefined") EpixKit.disconnect();
  wallet.provider = null;
  wallet.signer = null;
  wallet.contract = null;
  wallet.address = null;
  wallet.name = null;
  updateWalletBar();
}

function updateWalletBar() {
  if (wallet.address) {
    var label = shortAddr(wallet.address);
    if (wallet.name) label = wallet.name + " " + label;
    $(".tip-wallet-badge").text(label);
    $(".tip-wallet-connect").hide();
    $(".tip-wallet-badge, .tip-wallet-disconnect").show();
  } else {
    $(".tip-wallet-badge, .tip-wallet-disconnect").hide();
    $(".tip-wallet-connect").show();
  }
}

// --- Helpers ---

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr || "";
  return addr.substring(0, 6) + "\u2026" + addr.substring(addr.length - 4);
}

function displayName(addr, xidName) {
  if (xidName && xidName.length > 0) return xidName;
  return shortAddr(addr);
}

function formatEpix(val) {
  var n = parseFloat(val);
  if (n === 0) return "0";
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toFixed(4);
}

function showTipError(msg) {
  $(".tip-modal-error").text(msg).show();
}

function tipErrorMessage(err) {
  if (!err || typeof err !== "object") return "Transaction failed";
  var rpcError = (err.info && err.info.error) || err.error;
  if (err.code === "ACTION_REJECTED" || err.code === 4001 || (rpcError && rpcError.code === 4001)) {
    return "Tip cancelled.";
  }

  // ethers can wrap a node rejection as "missing revert data". Keep the
  // decoded contract reason or the RPC message instead of its request dump.
  var messages = [err.reason, rpcError && rpcError.message, err.shortMessage, err.message];
  var message = messages.find(function(value) { return typeof value === "string" && value.trim(); });
  if (!message) return "Transaction failed";
  if (/insufficient (?:funds|balance)/i.test(message)) {
    return "Not enough EPIX to cover this tip and the transaction fee.";
  }
  message = message.split(/\r?\n/)[0].split(/\s+\((?:action|argument|error|transaction|payload|code)=/)[0].trim();
  return message.slice(0, 240) || "Transaction failed";
}

// --- Exports ---

window.Tipping = {
  init: initTipping,
  computeContentHash: computeContentHash,
  loadTipCounts: loadTipCounts,
  openTipModal: openTipModal,
  ready: function() { return !!readContract; }
};

})();
