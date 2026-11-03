(function() {

var popup = null;
var hideTimer = null;
var currentMention = null;
var cache = {};

function getPopup() {
  if (!popup) popup = $(".mention-popup");
  return popup;
}

function show(elem, name) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  var $popup = getPopup();
  currentMention = name;

  // Position near the mention link
  var offset = $(elem).offset();
  var left = offset.left;
  var top = offset.top + $(elem).outerHeight() + 5;
  // Keep within viewport
  if (left + 280 > $(window).width()) {
    left = $(window).width() - 290;
  }
  $popup.css({ top: top, left: left });

  // Show loading state
  $popup.find(".mention-popup-avatar").html("").css("display", "none");
  $popup.find(".mention-popup-name").text(name);
  $popup.find(".mention-popup-bio").text("Loading...");
  var initialFullName = name.indexOf(".") >= 0 ? name : name + ".epix";
  $popup.find(".mention-popup-profile").attr("href", "?User:" + initialFullName);
  $popup.show();

  // Resolve xID
  if (cache[name]) {
    renderData(cache[name]);
  } else {
    // Try forward resolve (name might be "mud" or "mud.epix")
    var resolveName = name.indexOf(".") >= 0 ? name : name + ".epix";
    Page.cmd("xidResolveName", [resolveName], function(result) {
      if (result) {
        cache[name] = result;
        if (currentMention === name) renderData(result);
      } else {
        if (currentMention === name) {
          $popup.find(".mention-popup-bio").text("");
        }
      }
    });
  }
}

function getFullName(data) {
  var name = data.name || "";
  if (data.tld) name += "." + data.tld;
  return name;
}

function renderData(data) {
  var $popup = getPopup();
  var displayName = getFullName(data);
  $popup.find(".mention-popup-name").text(displayName);
  $popup.find(".mention-popup-bio").text(data.bio || "");
  $popup.find(".mention-popup-profile").attr("href", "?User:" + displayName);
  if (data.avatar) {
    var slot = $popup.find(".mention-popup-avatar").empty().css("display", "");
    var image = $('<img alt="">').appendTo(slot);
    EpixAvatar.bind(image[0], data.avatar, 44);
  } else {
    $popup.find(".mention-popup-avatar").html("").css("display", "none");
  }
}

function hide() {
  hideTimer = setTimeout(function() {
    getPopup().hide();
    currentMention = null;
  }, 200);
}

// Event delegation for mention links
$(document).on("mouseenter", ".mention-link", function() {
  var name = $(this).data("mention");
  if (name) show(this, name);
});

$(document).on("mouseleave", ".mention-link", function() {
  hide();
});

// Keep popup open while hovering it
$(document).on("mouseenter", ".mention-popup", function() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
});

$(document).on("mouseleave", ".mention-popup", function() {
  hide();
});

// Click mention link navigates to profile
$(document).on("click", ".mention-link", function(e) {
  e.preventDefault();
  var name = $(this).data("mention");
  var resolved = cache[name];
  var fullName = resolved ? getFullName(resolved) : (name.indexOf(".") >= 0 ? name : name + ".epix");
  window.top.location = "?User:" + fullName;
});

// Click "View Profile" in popup
$(document).on("click", ".mention-popup-profile", function(e) {
  e.preventDefault();
  window.top.location = $(this).attr("href");
});

})();
