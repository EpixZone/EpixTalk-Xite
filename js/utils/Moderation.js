(function() {
class Moderation {
  constructor() {
    this.reported_topics = {};   // target_uri -> [{report_id, reporter, reason, added}]
    this.reported_comments = {}; // target_uri -> [{report_id, reporter, reason, added}]
    this.admin_settings = {};    // Cached data/admin/admin-settings.json
    this.loaded = false;
  }

  // Load admin settings from data/admin/admin-settings.json
  loadAdminSettings(cb) {
    Page.cmd("fileGet", {"inner_path": "data/admin/admin-settings.json", "required": false}, (raw) => {
      if (raw) {
        try {
          this.admin_settings = JSON.parse(raw);
        } catch (e) {
          this.admin_settings = {};
        }
      } else {
        this.admin_settings = {};
      }
      if (window.Branding) Branding.apply(this.admin_settings.branding);
      if (cb) cb();
    });
  }

  // Get current user's role: "owner", "admin", "mod", or null
  getRole() {
    if (!Page.site_info) return null;
    if (Page.site_info.settings?.own) return "owner";
    var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
    if (!user_dir) return null;
    // Check admin list from root content.json settings
    var settings = Page.site_info.content?.settings;
    if (settings?.admins && settings.admins.includes(user_dir)) return "admin";
    // Mods are stored in admin-settings.json (writable by admins)
    var mods = this.admin_settings.mods || [];
    if (mods.length > 0 && mods.includes(user_dir)) return "mod";
    return null;
  }

  isOwner() { return this.getRole() === "owner"; }
  isAdmin() { var role = this.getRole(); return role === "owner" || role === "admin"; }
  isMod() { var role = this.getRole(); return role === "owner" || role === "admin" || role === "mod"; }

  // Load all reports from the database
  loadReports(cb) {
    var query = `
      SELECT
       report.*,
       reporter_json.directory AS reporter_address
      FROM report
       LEFT JOIN json AS reporter_json ON (reporter_json.json_id = report.json_id)
      ORDER BY report.added DESC
    `;
    Page.cmd("dbQuery", [query], (reports) => {
      this.reported_topics = {};
      this.reported_comments = {};
      if (!Array.isArray(reports)) {
        this.log("Report query error:", reports?.error || reports);
        reports = [];
      }
      for (let report of reports) {
        var entry = {
          report_id: report.report_id,
          reporter: report.reporter_address,
          reason: report.reason,
          added: report.added
        };
        if (report.type === "topic") {
          if (!this.reported_topics[report.target_uri]) this.reported_topics[report.target_uri] = [];
          this.reported_topics[report.target_uri].push(entry);
        } else if (report.type === "comment") {
          if (!this.reported_comments[report.target_uri]) this.reported_comments[report.target_uri] = [];
          this.reported_comments[report.target_uri].push(entry);
        }
      }
      this.loaded = true;
      if (cb) cb();
    });
  }

  // Check if a topic or comment has been reported
  isReported(type, uri) {
    if (type === "topic") {
      return this.reported_topics[uri]?.length > 0;
    } else {
      return this.reported_comments[uri]?.length > 0;
    }
  }

  // Get report entries for a specific item
  getReportsFor(type, uri) {
    if (type === "topic") {
      return this.reported_topics[uri] || [];
    } else {
      return this.reported_comments[uri] || [];
    }
  }

  // Report a topic or comment (a keyed record in the reporter's reports.json,
  // key = type + "_" + target_uri, so re-reporting supersedes).
  reportContent(type, target_uri, reason, cb) {
    User.editRecord("reports", type + "_" + target_uri, {
      "report_id": Date.now(),
      "type": type,
      "target_uri": target_uri,
      "reason": reason,
      "added": Time.timestamp()
    }, false, (res) => {
      if (res) {
        Page.cmd("wrapperNotification", ["done", "Content reported successfully."]);
        this.loadReports();
      } else {
        Page.cmd("wrapperNotification", ["error", "Failed to submit report."]);
      }
      if (cb) cb(res);
    });
  }

  // Remove own report for a topic or comment (a signed tombstone for that key).
  unreportContent(type, target_uri, cb) {
    User.editRecord("reports", type + "_" + target_uri, {}, true, (res) => {
      if (res) {
        this.loadReports();
      }
      if (cb) cb(res);
    });
  }

  // Delete a topic or comment as a moderator (requires admin). Instead of
  // rewriting the author's data.json, write a signed MODERATION TOMBSTONE into
  // the author's merge file (same post_id as the item, deleted:true +
  // moderated:true, signed by this admin) and publish the author's content.json.
  // The node accepts a moderated tombstone from any authorized signer of the
  // dir, so this hides the item without touching any other record.
  deleteContent(type, target_uri, cb) {
    if (!this.isAdmin()) {
      Page.cmd("wrapperNotification", ["error", "Only admins can delete content."]);
      if (cb) cb(false);
      return;
    }

    var parts = target_uri.split("_");
    var user_address = parts.slice(1).join("_");
    var collection, id_field, id_value;
    if (type === "topic") {
      collection = "topics"; id_field = "topic_id"; id_value = parseInt(parts[0]);
    } else if (type === "comment") {
      collection = "comments"; id_field = "comment_id"; id_value = parseInt(parts[0]);
    } else {
      if (cb) cb(false);
      return;
    }

    User.moderateDelete(user_address, collection, id_field, id_value, (res) => {
      if (res) {
        Page.cmd("wrapperNotification", ["done", "Content deleted and published."]);
        this.loadReports();
      } else {
        Page.cmd("wrapperNotification", ["error", "Could not delete content (item not found locally or still syncing)."]);
      }
      if (cb) cb(res);
    });
  }
}

Object.assign(Moderation.prototype, LogMixin);
window.Moderation = new Moderation();
})();
