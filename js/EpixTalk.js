(function() {
// Variable namings:
// comment_uri: #{comment_id}_#{topic_id}_#{topic_user_id}
// topic_uri: #{topic_id}_#{topic_user_id}

var EpixFrame = window.EpixFrame;

class EpixTalk extends EpixFrame {
  constructor() {
    super();
    this.MIN_VERSION = "0.0.2";
  }

  init() {
    this.log("inited!");
    this.site_info = null;  // Last site info response
    this.server_info = null;  // Last server info response
    this.site_address = null;  // Site address
    // Initial sync of the forum's user content: see noteSync. There is no
    // "sync finished" event, so going quiet for this long is the signal.
    this.SYNC_IDLE = 15000;
    // The longer window used while a fetch pass has been announced
    // (file_added) but its files have not started landing: the node dials
    // the peers first, which over Tor is routinely 30-60s of dead air. With
    // only the short idle the banner sat down through exactly the stretch
    // that looked broken.
    this.SYNC_WAIT = 120000;
    // An initial sync arrives as dozens of files; a single new post from
    // someone else is one or two. Below this the banner stays down, so normal
    // browsing does not flash a "downloading" card every time a post lands.
    this.SYNC_MIN_FILES = 3;
    // How long after the last file the empty-forum message keeps saying
    // "syncing" - longer than the banner, to ride out the gaps between passes.
    this.SYNC_MESSAGE_GRACE = 60000;
    // The page opens the moment the site's own files are down, before any
    // user content has arrived, so an empty list is assumed to be mid-sync
    // until proven otherwise: either a sync runs and goes quiet, or nothing
    // shows up within this window and the forum really is empty.
    this.SYNC_INITIAL_GRACE = 90000;
    this.sync_settled = false;
    this.sync = null;
    this.sync_timer = null;
    setTimeout(() => {
      this.sync_settled = true;
      if ($("body").hasClass("page-main") || $("body").hasClass("page-topics")) {
        TopicList.loadTopics("noanim");
      }
    }, this.SYNC_INITIAL_GRACE);

    // Autoexpand
    var textareas = $("textarea");
    for (var i = 0; i < textareas.length; i++) {
      this.autoExpand($(textareas[i]));
    }

    // Horizontal-scroll hint for the toolbar groups (phone widths)
    $(".radio-group").on("scroll", () => this.updateScrollHints());
    $(window).on("resize", () => this.updateScrollHints());
    // Tapping an end cap advances the strip in that direction (clicks on
    // the cap pseudo-elements target the wrap itself, never a chip
    // underneath; the side is told apart by the tap position)
    $(".radio-group-wrap").on("click", function(e) {
      if (e.target !== this) return;
      var group = $(".radio-group", this)[0];
      var step = Math.round(group.clientWidth * 0.7);
      var rect = this.getBoundingClientRect();
      if ($(this).hasClass("has-prev") && e.clientX - rect.left < 40) {
        group.scrollBy({ left: -step, behavior: "smooth" });
        return false;
      }
      if ($(this).hasClass("has-more")) {
        group.scrollBy({ left: step, behavior: "smooth" });
        return false;
      }
    });

    // Markdown help (editbar)
    $(".editbar .icon-help").on("click", () => {
      $(".editbar .markdown-help").css("display", "block");
      $(".editbar .markdown-help").toggleClassLater("visible", 10);
      $(".editbar .icon-help").toggleClass("active");
      return false;
    });

    // Markdown help (new topic form)
    $(".topic-new-help, .topic-new-help-label").on("click", (e) => {
      e.preventDefault();
      var help = $(".topic-new-markdown-help");
      var btn = $(".topic-new-help");
      if (help.is(":visible")) {
        help.removeClass("visible");
        btn.removeClass("active");
        setTimeout(() => help.css("display", "none"), 300);
      } else {
        var offset = btn.offset();
        help.css({ display: "block", top: offset.top + btn.outerHeight() + 6, left: offset.left });
        setTimeout(() => help.addClass("visible"), 10);
        btn.addClass("active");
      }
      return false;
    });

    // Markdown help close button
    $(".topic-new-markdown-close").on("click", (e) => {
      e.preventDefault();
      var help = $(".topic-new-markdown-help");
      help.removeClass("visible");
      $(".topic-new-help").removeClass("active");
      setTimeout(() => help.css("display", "none"), 300);
      return false;
    });
  }

  // Show the "more options" end cap on toolbar groups whose segments extend
  // past the right edge (phones); hide it once scrolled to the end. The cap
  // lives on the wrap, outside the scroll container, so toggling it never
  // reflows the strip mid-scroll.
  updateScrollHints() {
    $(".radio-group").each(function() {
      var wrap = $(this).closest(".radio-group-wrap");
      wrap.toggleClass("has-more", this.scrollWidth - this.clientWidth - this.scrollLeft > 2);
      wrap.toggleClass("has-prev", this.scrollLeft > 2);
    });
  }

  setLoadingProgress(percent, label) {
    var bar = document.getElementById("loading-bar-fill");
    var step = document.getElementById("loading-step");
    if (bar) bar.style.width = percent + "%";
    if (step) step.textContent = label;
  }

  hideLoading() {
    var overlay = document.getElementById("loading-overlay");
    if (overlay) {
      overlay.classList.add("fade-out");
      setTimeout(function() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 500);
    }
  }

  // Wrapper websocket connection ready
  onOpenWebsocket() {
    this.cmd("wrapperSetViewport", "width=device-width, initial-scale=1");

    this.setLoadingProgress(10, "Fetching server info...");
    this.cmd("serverInfo", {}, (ret) => { // Get server info
      this.server_info = ret;
      this.checkVersion(ret.version);
      this.setLoadingProgress(25, "Loading language...");
      var afterLang = () => {
        translateDOM();
        this.setLoadingProgress(40, "Loading site info...");
        this.cmd("siteInfo", {}, (site) => {
          this.site_address = site.address;
          this.setSiteinfo(site);
          Tipping.init();
          this.setLoadingProgress(55, "Resolving xID identity...");
          User.updateMyInfo(() => {
            this.setLoadingProgress(70, "Loading admin settings...");
            // Load admin settings then moderation data then route
            Moderation.loadAdminSettings(() => {
              this.setLoadingProgress(85, "Loading moderation data...");
              Moderation.loadReports(() => {
                this.setLoadingProgress(100, "Ready!");
                this.updateAdminLink();
                UserPrefs.load(() => {
                  this.routeUrl(window.location.search.substring(1));
                  this.hideLoading();
                });
              });
            });
          });
        });
      };
      if (ret.language) {
        loadLanguage(ret.language, afterLang);
      } else {
        afterLang();
      }
    });
  }

  // All page content loaded
  onPageLoaded() {
    if (!$("body").hasClass("loaded")) {
      $("body").addClass("loaded"); // Back/forward button keep position support
      Page.cmd("wrapperInnerLoaded");
    }
  }

  routeUrl(url) {
    this.log("Routing url:", url);
    var match;
    if (match = url.match(/Topic:([0-9]+)_([0-9a-zA-Z.]+)/)) { // Topic
      $("body").addClass("page-topic");
      // A deep link to one comment: `?Topic:<uri>&comment=<id>_<user>`. The
      // wrapper forwards the query string but never the fragment, so an
      // off-site link (the newsfeed) cannot use a `#comment_...` anchor.
      var focus_match = url.match(/[?&]comment=([0-9]+_[0-9a-zA-Z.]+)/);
      if (!focus_match) {
        focus_match = window.location.hash.match(/^#comment_([0-9]+_[0-9a-zA-Z.]+)/);
      }
      TopicShow.actionShow(parseInt(match[1]), Text.toEpixAddress(match[2]), focus_match ? focus_match[1] : null);
    } else if (match = url.match(/Topics:([0-9]+)_([0-9a-zA-Z.]+)/)) { // Sub-topics
      $("body").addClass("page-topics");
      TopicList.actionList(parseInt(match[1]), Text.toEpixAddress(match[2]));
    } else if (match = url.match(/User:([0-9a-zA-Z.]+)/)) {
      $("body").addClass("page-user");
      UserProfile.actionShow(Text.toEpixAddress(match[1]));
    } else if (url.match(/Admin/)) { // Admin page
      $("body").addClass("page-admin");
      Admin.actionShow();
    } else { // Main
      $("body").addClass("page-main");
      TopicList.actionList();
    }
  }

  addInlineEditors() {
    this.logStart("Adding inline editors");
    var elems = $("[data-editable]");
    for (var i = 0; i < elems.length; i++) {
      var elem = $(elems[i]);
      if (!elem.data("editor") && !elem.hasClass("editor")) {
        var editor = new InlineEditor(elem, this.getContent.bind(this), this.saveContent.bind(this), this.getObject.bind(this));
        elem.data("editor", editor);
      }
    }
    this.logEnd("Adding inline editors");
  }

  // Get content
  getContent(elem, raw) {
    return elem.data("content");
  }

  // Returns the elem parent object
  getObject(elem) {
    if (elem.data("object")) {
      return elem;
    } else {
      return elem.parents("[data-object]");
    }
  }

  // Save content
  saveContent(elem, content, cb) {
    if (!cb) cb = false;
    var delete_object;
    if (elem.data("deletable") && content == null) { // Its a delete request
      delete_object = true;
    } else {
      delete_object = false;
    }

    var object = this.getObject(elem);
    var parts = object.data("object").split(":");
    var type = parts[0], id = parts[1];

    // An edit is a new signed version of the same record; a delete is a signed
    // tombstone. Both go through the merge file and can only ever touch this
    // one item (never another user's, never another item of ours).
    var onDone = (res) => {
      if (res) {
        if (delete_object) { // Delete
          if (cb) cb(true);
          elem.fancySlideUp();
        } else { // Update
          if (type === "Topic") {
            if ($("body").hasClass("page-main") || $("body").hasClass("page-topics")) TopicList.loadTopics("list", function() { if (cb) cb(true); });
            if ($("body").hasClass("page-topic")) TopicShow.loadTopic(function() { if (cb) cb(true); });
          }
          if (type === "Comment") {
            TopicShow.loadComments("normal", function() { if (cb) cb(true); });
          }
        }
      } else {
        if (cb) cb(false);
      }
    };

    if (type === "Topic") {
      var topic_id = parseInt(id.split("_")[0]);
      var changes = {};
      if (!delete_object) changes[elem.data("editable")] = content;
      User.editRecordById("topics", "topic_id", topic_id, changes, delete_object, onDone);
    } else if (type === "Comment") {
      var comment_uri = id.split("@")[0];
      var comment_id = parseInt(comment_uri.split("_")[0]);
      var changes = {};
      if (!delete_object) changes[elem.data("editable")] = content;
      User.editRecordById("comments", "comment_id", comment_id, changes, delete_object, onDone);
    } else {
      if (cb) cb(false);
    }
  }

  // Incoming request from EpixNet API
  onRequest(cmd, message) {
    if (cmd === "setSiteInfo") { // Site updated
      this.actionSetSiteInfo(message);
    } else if (cmd === "setAnnouncerInfo") {
      // Ignore announcer updates silently
    } else {
      this.log("Unknown command", cmd);
    }
  }

  writePublish(inner_path, data, cb) {
    this.cmd("fileWrite", [inner_path, data], (res) => {
      if (res !== "ok") { // fileWrite failed
        this.cmd("wrapperNotification", ["error", "File write error: " + (res.error || res)]);
        cb(false);
        return false;
      }

      this.cmd("sitePublish", {"inner_path": inner_path}, function(res) {
        if (res === "ok") {
          cb(true);
        } else {
          cb(res);
        }
      });
    });
  }

  // Show/hide admin link based on user role, update report badge
  updateAdminLink() {
    if (Moderation.isAdmin()) {
      $(".admin-link").css("display", "block");
      // Count reported items (unique target URIs)
      var count = Object.keys(Moderation.reported_topics).length + Object.keys(Moderation.reported_comments).length;
      var badge = $(".report-badge");
      if (count > 0) {
        badge.text(count).css("display", "inline-block");
      } else {
        badge.css("display", "none");
      }
    } else {
      $(".admin-link").css("display", "none");
    }
  }

  // Siteinfo changed
  actionSetSiteInfo(res) {
    var site_info = res.params;
    this.setSiteinfo(site_info);
    User.updateRole();
    this.updateAdminLink();
    this.noteSync(site_info);
    if (site_info.event && site_info.event[0] === "file_done") {
      var changed_file = site_info.event[1];
      ImageRecovery.fileDone(site_info.address, changed_file);
      // Reload admin settings when admin data changes
      if (changed_file.match(/data\/admin\//)) {
        Moderation.loadAdminSettings(() => {
          User.updateRole();
          this.updateAdminLink();
          // Refresh pinned topic URIs from updated admin settings
          TopicList.topic_pinned_uris = {};
          if (Moderation.admin_settings?.pinned_topic_uris) {
            for (let pinned_uri of Moderation.admin_settings.pinned_topic_uris) {
              TopicList.topic_pinned_uris[pinned_uri] = 1;
            }
          }
          if ($("body").hasClass("page-admin")) {
            Admin.loadRoles();
            Admin.loadReportedContent();
          }
          // Refresh views to reflect dismiss/pin changes
          if ($("body").hasClass("page-topic")) {
            TopicShow.loadTopic();
            TopicShow.loadComments("noanim");
          }
          if ($("body").hasClass("page-main") || $("body").hasClass("page-topics")) {
            TopicList.loadTopics("noanim");
          }
        });
      }
      if (changed_file.match(/.*users.*data.json$/)) { // User data changed
        // Reload moderation reports when user data changes
        Moderation.loadReports(() => {
          this.updateAdminLink();
          if ($("body").hasClass("page-admin")) {
            Admin.loadReportedContent();
          }
        });
      }
      // Background sync refresh: no per-row animations (each slide-down reads
      // as flicker when many files arrive, and animations defeat the
      // browser's scroll anchoring), and a slower cadence while the initial
      // download is still fetching files.
      var refresh_interval = site_info.bad_files > 0 ? 2000 : 500;
      RateLimit(refresh_interval, () => {
        if ($("body").hasClass("page-topic")) {
          TopicShow.loadTopic();
          TopicShow.loadComments("noanim");
        }
        if ($("body").hasClass("page-main") || $("body").hasClass("page-topics")) {
          TopicList.loadTopics("noanim");
        }
      });
    }
  }

  // The forum's user content still coming down. The wrapper's loading screen
  // only covers the site's own files; the topics live in per-user dirs that
  // arrive afterwards, so without this the page opens on an empty list with
  // nothing to say it is still filling.
  //
  // `bad_files` is not the signal: it is already 0 by the time the user
  // content starts, which is exactly the window that looked broken.
  noteSync(site_info) {
    if (!site_info || !site_info.event) return;
    var kind = site_info.event[0];
    if (kind !== "file_done" && kind !== "file_added") return;
    var path = site_info.event[1];
    if (typeof path !== "string" || !/^data\/(users|admin)\//.test(path)) return;
    if (!this.sync) this.sync = { files: 0 };
    if (kind === "file_done") {
      this.sync.files += 1;
      this.sync.last = path;
      this.sync.waiting = false;
    } else {
      // A fetch pass just started (the node announces it before dialing the
      // peers): more files are coming, hold the banner through the dial.
      this.sync.waiting = true;
    }
    this.sync.peers = site_info.peers_serving || site_info.peers || 0;
    this.sync.at = Date.now();
    this.renderSync();
    // One pending timer, re-armed on every file: when they stop arriving the
    // banner has to take itself down.
    if (this.sync_timer) clearTimeout(this.sync_timer);
    this.sync_timer = setTimeout(() => {
      this.sync_timer = null;
      this.sync_settled = true;
      this.renderSync();
      // The empty-forum message was chosen while the sync was still running;
      // re-run the list so it settles on the right one.
      if ($("body").hasClass("page-main") || $("body").hasClass("page-topics")) {
        TopicList.loadTopics("noanim");
      }
    }, this.syncWindow());
  }

  // How long after the last event the sync still counts as live: the short
  // idle normally, the long wait while a just-announced pass is dialing.
  syncWindow() {
    return this.sync && this.sync.waiting ? this.SYNC_WAIT : this.SYNC_IDLE;
  }

  // Whether user content is arriving right now - drives the banner, so it
  // comes down promptly when the transfer ends.
  isSyncing() {
    return !!(this.sync && Date.now() - this.sync.at < this.syncWindow());
  }

  // Whether a sync is still plausibly running - drives the empty-forum
  // message, which needs a longer grace than the banner: the pull comes in
  // passes with quiet gaps between them, and flipping the message to "no
  // topics" in each gap reads as the forum being empty when it is not.
  syncedRecently() {
    if (!this.sync_settled) return true;
    return !!(this.sync && Date.now() - this.sync.at < this.SYNC_MESSAGE_GRACE);
  }

  renderSync() {
    var banner = $(".sync-banner");
    // During the initial sync (not yet settled) any activity shows the
    // banner, including the dialing stretch before the first file. Once
    // settled, the small-pass threshold keeps a routine one-file update
    // from flashing a "downloading" card.
    var enough = !this.sync_settled || (this.sync && this.sync.files >= this.SYNC_MIN_FILES);
    if (!this.isSyncing() || !enough) {
      banner.css("display", "none");
      return;
    }
    var count = "";
    var file = this.sync.last || "";
    if (this.sync.files > 0) {
      count = this.sync.files + " " + (this.sync.files === 1 ? "file" : "files");
      if (this.sync.peers) {
        count += " · " + this.sync.peers + " " + (this.sync.peers === 1 ? "peer" : "peers");
      }
    } else {
      file = "Connecting to peers...";
    }
    $(".sync-banner-count", banner).text(count);
    $(".sync-banner-file", banner).text(file);
    banner.css("display", "block");
  }

  setSiteinfo(site_info) {
    this.site_info = site_info;
    User.checkCert();
  }

  checkVersion(version) {
    if (!version) return;
    var min = this.MIN_VERSION.split(".").map(Number);
    var cur = version.split(".").map(Number);
    for (var i = 0; i < Math.max(min.length, cur.length); i++) {
      var m = min[i] || 0;
      var c = cur[i] || 0;
      if (c > m) return;
      if (c < m) {
        this.cmd("wrapperNotification", ["error", "EpixTalk requires EpixNet " + this.MIN_VERSION + " or newer. You are running " + version + ". Please update your EpixNet client."]);
        return;
      }
    }
  }

  autoExpand(elem) {
    var editor = elem[0];
    // Autoexpand
    if (elem.height() > 0) elem.height(1);

    elem.on("input", function() {
      if (editor.scrollHeight > elem.height()) {
        var old_height = elem.height();
        elem.height(1);
        var new_height = editor.scrollHeight;
        new_height += parseFloat(elem.css("borderTopWidth"));
        new_height += parseFloat(elem.css("borderBottomWidth"));
        new_height -= parseFloat(elem.css("paddingTop"));
        new_height -= parseFloat(elem.css("paddingBottom"));

        var min_height = parseFloat(elem.css("lineHeight")) * 2; // 2 line minimum
        if (new_height < min_height) new_height = min_height + 4;

        elem.height(new_height - 4);
      }
    });
    if (elem.height() > 0) elem.trigger("input");
    else elem.height("48px");
  }
}

window.Page = new EpixTalk();
})();
