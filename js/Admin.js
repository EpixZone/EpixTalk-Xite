(function() {
class Admin {
  actionShow() {
    if (!Moderation.isAdmin()) {
      Page.cmd("wrapperNotification", ["error", "Access denied. Admin privileges required."]);
      window.top.location = "?Main";
      return;
    }

    $(".admin-page").css("display", "block");
    if (window.Branding) { Branding.setTitle("Admin"); Branding.initAdmin(); }
    else Page.cmd("wrapperSetTitle", "Admin - EpixTalk");
    this.loadRoles();
    this.loadReportedContent();
    Page.onPageLoaded();
  }

  // Load and display current admins and mods
  loadRoles() {
    var settings = Page.site_info.content?.settings || {};
    var admins = settings.admins || [];
    var mods = Moderation.admin_settings.mods || [];

    // Render admins list
    $(".admin-admins-list").empty();
    if (admins.length === 0) {
      $(".admin-admins-list").append("<div class='admin-empty'>No admins configured</div>");
    }
    for (let admin_addr of admins) {
      let item = $(`
        <div class="admin-role-item" data-address="${admin_addr}">
          <a href="?User:${admin_addr}" class="admin-role-address">${admin_addr}</a>
          <a href="#" class="admin-role-remove" title="Remove admin">x</a>
        </div>
      `);
      // Resolve xID name
      User.resolveXidName(admin_addr, function(name, tld) {
        if (name) {
          $(".admin-role-address", item).text(name + "." + tld);
        }
      });
      // Remove button (owner only)
      if (Moderation.isOwner()) {
        $(".admin-role-remove", item).on("click", (e) => {
          e.preventDefault();
          this.removeAdmin(admin_addr);
          return false;
        });
      } else {
        $(".admin-role-remove", item).css("display", "none");
      }
      $(".admin-admins-list").append(item);
    }

    // Render mods list
    $(".admin-mods-list").empty();
    if (mods.length === 0) {
      $(".admin-mods-list").append("<div class='admin-empty'>No moderators configured</div>");
    }
    for (let mod_addr of mods) {
      let item = $(`
        <div class="admin-role-item" data-address="${mod_addr}">
          <a href="?User:${mod_addr}" class="admin-role-address">${mod_addr}</a>
          <a href="#" class="admin-role-remove" title="Remove mod">x</a>
        </div>
      `);
      User.resolveXidName(mod_addr, function(name, tld) {
        if (name) {
          $(".admin-role-address", item).text(name + "." + tld);
        }
      });
      if (Moderation.isAdmin()) {
        $(".admin-role-remove", item).on("click", (e) => {
          e.preventDefault();
          this.removeMod(mod_addr);
          return false;
        });
      } else {
        $(".admin-role-remove", item).css("display", "none");
      }
      $(".admin-mods-list").append(item);
    }

    // Show owner-only controls (add admin form)
    if (Moderation.isOwner()) {
      $(".admin-owner-controls").css("display", "block");
    } else {
      $(".admin-owner-controls").css("display", "none");
    }
    // Show admin controls (add mod form)
    if (Moderation.isAdmin()) {
      $(".admin-mod-controls").css("display", "block");
    } else {
      $(".admin-mod-controls").css("display", "none");
    }

    // Bind add buttons
    $(".admin-add-admin-btn").off("click").on("click", (e) => {
      e.preventDefault();
      this.validateAndAdd($(".admin-add-admin-input"), "admin");
      return false;
    });

    $(".admin-add-mod-btn").off("click").on("click", (e) => {
      e.preventDefault();
      this.validateAndAdd($(".admin-add-mod-input"), "mod");
      return false;
    });
  }

  // Validate xID exists on-chain before adding as admin/mod
  validateAndAdd(input_elem, role) {
    var addr = input_elem.val().trim();
    if (!addr) return;

    // Basic format check: must look like name.tld
    if (!addr.match(/^[a-zA-Z0-9_-]+\.[a-zA-Z]+$/)) {
      Page.cmd("wrapperNotification", ["error", 'Invalid format. Enter an xID like "smile.epix".']);
      input_elem.focus();
      return;
    }

    // Check duplicate
    var settings = Page.site_info.content?.settings || {};
    var admins = settings.admins || [];
    var mods = Moderation.admin_settings.mods || [];
    if (role === "admin" && admins.includes(addr)) {
      Page.cmd("wrapperNotification", ["info", addr + " is already an admin."]);
      return;
    }
    if (role === "mod" && mods.includes(addr)) {
      Page.cmd("wrapperNotification", ["info", addr + " is already a moderator."]);
      return;
    }
    if (role === "mod" && admins.includes(addr)) {
      Page.cmd("wrapperNotification", ["info", addr + " is already an admin — no need to add as mod."]);
      return;
    }

    // Show loading state
    var btn = input_elem.siblings(".button");
    btn.addClass("loading");
    input_elem.prop("disabled", true);

    // Forward-resolve xID name on-chain via XidResolver plugin
    Page.cmd("xidResolveName", [addr], (result) => {
      btn.removeClass("loading");
      input_elem.prop("disabled", false);
      if (result && result.owner) {
        // Valid xID — add the role
        input_elem.val("");
        if (role === "admin") {
          this.addAdmin(addr);
        } else {
          this.addMod(addr);
        }
      } else {
        Page.cmd("wrapperNotification", ["error", 'xID "' + addr + '" not found on-chain. Please enter a valid registered xID.']);
        input_elem.focus();
      }
    });
  }

  // Load all reported content for the admin queue
  loadReportedContent() {
    // Query reported topics
    var query = `
      SELECT
       report.report_id, report.type, report.target_uri, report.reason, report.added AS report_added,
       reporter_json.directory AS reporter_address,
       topic.title AS topic_title, topic.body AS topic_body, topic.added AS topic_added,
       topic_creator_json.directory AS topic_creator_address
      FROM report
       LEFT JOIN json AS reporter_json ON (reporter_json.json_id = report.json_id)
       LEFT JOIN topic ON (report.type = 'topic' AND report.target_uri = topic.topic_id || '_' || (SELECT directory FROM json WHERE json_id = topic.json_id))
       LEFT JOIN json AS topic_creator_json ON (topic_creator_json.json_id = topic.json_id)
      WHERE report.type = 'topic'
      ORDER BY report.added DESC
    `;
    Page.cmd("dbQuery", [query], (topic_reports) => {
      if (!Array.isArray(topic_reports)) topic_reports = [];
      this.renderReportedTopics(topic_reports);
    });

    // Query reported comments
    var query_comments = `
      SELECT
       report.report_id, report.type, report.target_uri, report.reason, report.added AS report_added,
       reporter_json.directory AS reporter_address,
       comment.body AS comment_body, comment.added AS comment_added,
       comment_creator_json.directory AS comment_creator_address
      FROM report
       LEFT JOIN json AS reporter_json ON (reporter_json.json_id = report.json_id)
       LEFT JOIN comment ON (report.type = 'comment' AND CAST(report.target_uri AS TEXT) LIKE comment.comment_id || '_%')
       LEFT JOIN json AS comment_creator_json ON (comment_creator_json.json_id = comment.json_id)
      WHERE report.type = 'comment'
      ORDER BY report.added DESC
    `;
    Page.cmd("dbQuery", [query_comments], (comment_reports) => {
      if (!Array.isArray(comment_reports)) comment_reports = [];
      this.renderReportedComments(comment_reports);
    });
  }

  renderReportedTopics(reports) {
    var container = $(".admin-reported-topics");
    container.empty();
    if (reports.length === 0) {
      container.append("<div class='admin-empty'>No reported topics</div>");
      return;
    }

    // Group by target_uri to deduplicate
    var grouped = {};
    for (let report of reports) {
      if (!grouped[report.target_uri]) grouped[report.target_uri] = {reports: [], data: report};
      grouped[report.target_uri].reports.push(report);
    }

    for (let uri in grouped) {
      let group = grouped[uri];
      let report = group.data;
      let report_count = group.reports.length;
      let reporters = group.reports.map(function(r) { return r.reporter_address; }).join(", ");
      let item = $(`
        <div class="admin-report-item" data-uri="${uri}">
          <div class="admin-report-header">
            <span class="admin-report-type">Topic</span>
            <span class="admin-report-count">${report_count} report${report_count > 1 ? 's' : ''}</span>
            <span class="admin-report-time">${Time.since(group.reports[0].report_added)}</span>
          </div>
          <div class="admin-report-content">
            <div class="admin-report-title">${report.topic_title || '[Topic data not available]'}</div>
            <div class="admin-report-body">${Text.toMarked(report.topic_body || '', {"sanitize": true})}</div>
            <div class="admin-report-meta">By: <span class="admin-report-author">${report.topic_creator_address || 'unknown'}</span></div>
            <div class="admin-report-reason">Reason: ${report.reason}</div>
            <div class="admin-report-reporters">Reported by: <span class="reporter-names">${reporters}</span></div>
          </div>
          <div class="admin-report-actions">
            <a href="#" class="button admin-report-delete">Delete Topic</a>
            <a href="#" class="button button-outline admin-report-dismiss">Dismiss</a>
            <a href="#" class="button button-outline admin-report-view">View Topic</a>
          </div>
        </div>
      `);
      // Resolve reporter names to xID display names
      let resolved_names = [];
      let remaining = group.reports.length;
      for (let r of group.reports) {
        User.resolveXidName(r.reporter_address, function(name, tld) {
          if (name) {
            resolved_names.push(name + "." + tld);
          } else {
            resolved_names.push(r.reporter_address);
          }
          remaining -= 1;
          if (remaining === 0) {
            $(".reporter-names", item).text(resolved_names.join(", "));
          }
        });
      }

      // Resolve topic creator name
      if (report.topic_creator_address) {
        User.resolveXidName(report.topic_creator_address, function(name, tld) {
          if (name) {
            $(".admin-report-author", item).text(name + "." + tld);
          }
        });
      }

      // Bind actions
      $(".admin-report-delete", item).on("click", (e) => {
        e.preventDefault();
        if (confirm("Are you sure you want to permanently delete this topic?")) {
          Moderation.deleteContent("topic", uri, (res) => {
            if (res) {
              this.dismissAllReports("topic", uri, () => {
                this.loadReportedContent();
              });
            }
          });
        }
        return false;
      });
      $(".admin-report-dismiss", item).on("click", (e) => {
        e.preventDefault();
        this.dismissAllReports("topic", uri, () => {
          this.loadReportedContent();
        });
        return false;
      });
      $(".admin-report-view", item).on("click", function(e) {
        e.preventDefault();
        window.top.location = "?Topic:" + uri;
        return false;
      });
      container.append(item);
    }
  }

  renderReportedComments(reports) {
    var container = $(".admin-reported-comments");
    container.empty();
    if (reports.length === 0) {
      container.append("<div class='admin-empty'>No reported comments</div>");
      return;
    }

    var grouped = {};
    for (let report of reports) {
      if (!grouped[report.target_uri]) grouped[report.target_uri] = {reports: [], data: report};
      grouped[report.target_uri].reports.push(report);
    }

    for (let uri in grouped) {
      let group = grouped[uri];
      let report = group.data;
      let report_count = group.reports.length;
      let reporters = group.reports.map(function(r) { return r.reporter_address; }).join(", ");
      let item = $(`
        <div class="admin-report-item" data-uri="${uri}">
          <div class="admin-report-header">
            <span class="admin-report-type">Comment</span>
            <span class="admin-report-count">${report_count} report${report_count > 1 ? 's' : ''}</span>
            <span class="admin-report-time">${Time.since(group.reports[0].report_added)}</span>
          </div>
          <div class="admin-report-content">
            <div class="admin-report-body">${Text.toMarked(report.comment_body || '[Comment data not available]', {"sanitize": true})}</div>
            <div class="admin-report-meta">By: <span class="admin-report-author">${report.comment_creator_address || 'unknown'}</span></div>
            <div class="admin-report-reason">Reason: ${report.reason}</div>
            <div class="admin-report-reporters">Reported by: <span class="reporter-names">${reporters}</span></div>
          </div>
          <div class="admin-report-actions">
            <a href="#" class="button admin-report-delete">Delete Comment</a>
            <a href="#" class="button button-outline admin-report-dismiss">Dismiss</a>
          </div>
        </div>
      `);
      if (report.comment_creator_address) {
        User.resolveXidName(report.comment_creator_address, function(name, tld) {
          if (name) {
            $(".admin-report-author", item).text(name + "." + tld);
          }
        });
      }

      // Resolve reporter names to xID display names
      let resolved_names = [];
      let remaining = group.reports.length;
      for (let r of group.reports) {
        User.resolveXidName(r.reporter_address, function(name, tld) {
          if (name) {
            resolved_names.push(name + "." + tld);
          } else {
            resolved_names.push(r.reporter_address);
          }
          remaining -= 1;
          if (remaining === 0) {
            $(".reporter-names", item).text(resolved_names.join(", "));
          }
        });
      }

      $(".admin-report-delete", item).on("click", (e) => {
        e.preventDefault();
        if (confirm("Are you sure you want to permanently delete this comment?")) {
          Moderation.deleteContent("comment", uri, (res) => {
            if (res) {
              this.dismissAllReports("comment", uri, () => {
                this.loadReportedContent();
              });
            }
          });
        }
        return false;
      });
      $(".admin-report-dismiss", item).on("click", (e) => {
        e.preventDefault();
        this.dismissAllReports("comment", uri, () => {
          this.loadReportedContent();
        });
        return false;
      });
      container.append(item);
    }
  }

  // Dismiss all reports for a given content item
  dismissAllReports(type, target_uri, cb) {
    if (!Moderation.isAdmin()) {
      Page.cmd("wrapperNotification", ["error", "Only admins can dismiss reports."]);
      if (cb) cb();
      return;
    }

    var reports = Moderation.getReportsFor(type, target_uri);
    if (reports.length === 0) {
      if (cb) cb();
      return;
    }

    var pending = reports.length;
    var done = () => {
      pending -= 1;
      if (pending <= 0) {
        Moderation.loadReports(function() {
          if (cb) cb();
        });
      }
    };

    // Dismissing a report writes a signed moderation tombstone into the
    // reporter's reports.json (key = type + "_" + target_uri) and publishes the
    // reporter's content.json - no data.json rewrite. The reporter keeps their
    // own dir; we only tombstone the one report record cross-dir.
    for (let report of reports) {
      User.moderateDelete(report.reporter, "reports", "key", type + "_" + target_uri, function(res) {
        done();
      });
    }
  }

  // Add/remove admin (modifies content.json - requires site owner)
  addAdmin(address) {
    if (!Moderation.isOwner()) {
      Page.cmd("wrapperNotification", ["error", "Only the site owner can add admins."]);
      return;
    }
    // Optimistic local update
    if (!Page.site_info.content) Page.site_info.content = {};
    if (!Page.site_info.content.settings) Page.site_info.content.settings = {};
    if (!Page.site_info.content.settings.admins) Page.site_info.content.settings.admins = [];
    if (!Page.site_info.content.settings.admins.includes(address)) {
      Page.site_info.content.settings.admins.push(address);
    }
    this.loadRoles();
    // Persist in background
    this.updateContentJson((content) => {
      if (!content.settings) content.settings = {};
      if (!content.settings.admins) content.settings.admins = [];
      if (content.settings.admins.includes(address)) {
        return false;
      }
      content.settings.admins.push(address);
      // Add xID directory to includes signers
      for (let include_key of ["data/users/content.json", "data/admin/content.json"]) {
        if (!content.includes) content.includes = {};
        if (!content.includes[include_key]) content.includes[include_key] = {"signers": [], "signers_required": 1};
        if (!content.includes[include_key].signers) content.includes[include_key].signers = [];
        if (!content.includes[include_key].signers.includes(address)) {
          content.includes[include_key].signers.push(address);
        }
      }
      return true;
    }, () => {
      // After content.json is saved, also add to user_contents permission_rules signers
      this.updateUsersContentJson(function(users_content) {
        if (!users_content.user_contents) users_content.user_contents = {};
        if (!users_content.user_contents.permission_rules) users_content.user_contents.permission_rules = {};
        if (!users_content.user_contents.permission_rules[".*"]) users_content.user_contents.permission_rules[".*"] = {"files_allowed": "data.json", "max_size": 40000};
        if (!users_content.user_contents.permission_rules[".*"].signers) users_content.user_contents.permission_rules[".*"].signers = [];
        if (!users_content.user_contents.permission_rules[".*"].signers.includes(address)) {
          users_content.user_contents.permission_rules[".*"].signers.push(address);
          return true;
        }
        return false;
      });
    });
  }

  removeAdmin(address) {
    if (!Moderation.isOwner()) {
      Page.cmd("wrapperNotification", ["error", "Only the site owner can remove admins."]);
      return;
    }
    // Optimistic local update
    if (Page.site_info.content?.settings?.admins) {
      var idx = Page.site_info.content.settings.admins.indexOf(address);
      if (idx >= 0) {
        Page.site_info.content.settings.admins.splice(idx, 1);
      }
    }
    this.loadRoles();
    // Persist in background
    this.updateContentJson((content) => {
      if (!content.settings) content.settings = {};
      if (!content.settings.admins) content.settings.admins = [];
      var idx = content.settings.admins.indexOf(address);
      if (idx >= 0) {
        content.settings.admins.splice(idx, 1);
      } else {
        return false;
      }
      // Remove from includes signers
      for (let include_key of ["data/users/content.json", "data/admin/content.json"]) {
        if (content.includes?.[include_key]?.signers) {
          var signer_idx = content.includes[include_key].signers.indexOf(address);
          if (signer_idx >= 0) {
            content.includes[include_key].signers.splice(signer_idx, 1);
          }
        }
      }
      return true;
    }, () => {
      // After content.json is saved, also remove from user_contents permission_rules signers
      this.updateUsersContentJson(function(users_content) {
        var signers = users_content.user_contents?.permission_rules?.[".*"]?.signers;
        if (signers) {
          var idx = signers.indexOf(address);
          if (idx >= 0) {
            signers.splice(idx, 1);
            return true;
          }
        }
        return false;
      });
    });
  }

  addMod(address) {
    if (!Moderation.isAdmin()) {
      Page.cmd("wrapperNotification", ["error", "Only admins can add moderators."]);
      return;
    }
    this.updateAdminSettings(function(data) {
      if (!data.mods) data.mods = [];
      if (data.mods.includes(address)) {
        return false;
      }
      data.mods.push(address);
      return true;
    });
  }

  removeMod(address) {
    if (!Moderation.isAdmin()) {
      Page.cmd("wrapperNotification", ["error", "Only admins can remove moderators."]);
      return;
    }
    this.updateAdminSettings(function(data) {
      if (!data.mods) data.mods = [];
      var idx = data.mods.indexOf(address);
      if (idx >= 0) {
        data.mods.splice(idx, 1);
        return true;
      }
      return false;
    });
  }

  pinTopic(topic_uri, cb) {
    if (!Moderation.isAdmin()) {
      Page.cmd("wrapperNotification", ["error", "Only admins can pin topics."]);
      if (cb) cb(false, false);
      return;
    }
    this.updateAdminSettings(function(data) {
      if (!data.pinned_topic_uris) data.pinned_topic_uris = [];
      if (data.pinned_topic_uris.includes(topic_uri)) {
        return false;
      }
      data.pinned_topic_uris.push(topic_uri);
      return true;
    }, (success, committed) => {
      if (committed) {
        if (Moderation.admin_settings.pinned_topic_uris?.includes(topic_uri)) window.TopicList.topic_pinned_uris[topic_uri] = 1;
        else delete window.TopicList.topic_pinned_uris[topic_uri];
      }
      if (cb) cb(success, committed);
    });
  }

  unpinTopic(topic_uri, cb) {
    if (!Moderation.isAdmin()) {
      Page.cmd("wrapperNotification", ["error", "Only admins can unpin topics."]);
      if (cb) cb(false, false);
      return;
    }
    this.updateAdminSettings(function(data) {
      if (!data.pinned_topic_uris) data.pinned_topic_uris = [];
      var idx = data.pinned_topic_uris.indexOf(topic_uri);
      if (idx >= 0) {
        data.pinned_topic_uris.splice(idx, 1);
        return true;
      }
      return false;
    }, (success, committed) => {
      if (committed) {
        if (Moderation.admin_settings.pinned_topic_uris?.includes(topic_uri)) window.TopicList.topic_pinned_uris[topic_uri] = 1;
        else delete window.TopicList.topic_pinned_uris[topic_uri];
      }
      if (cb) cb(success, committed);
    });
  }

  // Helper: read content.json, apply a modifier function, write only
  updateContentJson(modifier_fn, cb) {
    Page.cmd("fileGet", {"inner_path": "content.json", "required": false}, (raw) => {
      if (!raw) {
        Page.cmd("wrapperNotification", ["error", "Could not read content.json"]);
        return;
      }
      var content = JSON.parse(raw);
      var should_save = modifier_fn(content);
      if (!should_save) return;

      var json_raw = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, ' '))));
      Page.cmd("fileWrite", ["content.json", json_raw], (res) => {
        if (res !== "ok") {
          Page.cmd("wrapperNotification", ["error", "Failed to write content.json: " + (res?.error || res)]);
          return;
        }
        Page.cmd("wrapperNotification", ["done", "Settings saved. Sign and publish when prompted."]);
        // Refresh site info to pick up new settings
        Page.cmd("siteInfo", {}, (site) => {
          Page.setSiteinfo(site);
          User.updateRole();
          this.loadRoles();
          if (cb) cb();
        });
      });
    });
  }

  // Helper: read data/users/content.json, apply modifier, write only (no auto-sign)
  updateUsersContentJson(modifier_fn) {
    var inner_path = "data/users/content.json";
    Page.cmd("fileGet", {"inner_path": inner_path, "required": false}, (raw) => {
      if (!raw) {
        Page.cmd("wrapperNotification", ["error", "Could not read " + inner_path]);
        return;
      }
      var content = JSON.parse(raw);
      var should_save = modifier_fn(content);
      if (!should_save) return;

      var json_raw = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, ' '))));
      Page.cmd("fileWrite", [inner_path, json_raw], (res) => {
        if (res !== "ok") {
          Page.cmd("wrapperNotification", ["error", "Failed to write " + inner_path + ": " + (res?.error || res)]);
          return;
        }
        this.log("User content rules updated. Sign and publish " + inner_path + " manually.");
      });
    });
  }

  // The settings and their signature commit together. The callback separates
  // command success from a local commit whose later publication failed.
  updateAdminSettings(modifier_fn, cb) {
    var inner_path = "data/admin/admin-settings.json";
    var fail = (message) => {
      Page.cmd("wrapperNotification", ["error", message]);
      if (cb) cb(false, false);
    };
    Page.cmd("fileGet", {"inner_path": inner_path, "required": false}, (raw) => {
      var data;
      try {
        data = JSON.parse(raw);
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid settings");
      } catch (e) {
        fail("Could not read admin settings. Existing settings have not been overwritten.");
        return;
      }

      var should_save;
      try {
        should_save = modifier_fn(data);
      } catch (e) {
        fail("Could not update admin settings: " + e.message);
        return;
      }
      if (should_save) data.modified = Math.floor(Date.now() / 1000);
      var encode = value => btoa(unescape(encodeURIComponent(value)));
      var params = {
        "inner_path": inner_path,
        "content_base64": encode(should_save ? JSON.stringify(data, null, '\t') : raw),
        "expected_base64": encode(raw)
      };
      // Owners use the saved site key; delegated admins use their selected xID.
      if (Page.site_info?.privatekey) params.privatekey = "stored";
      Page.cmd("fileWriteSign", params, (res) => {
        if (res !== "ok") {
          var error = res?.error || res;
          if (!error || /unknown command|unhandled.*command/i.test(String(error))) {
            fail("This node does not support atomic admin saves. Update EpixNet and retry.");
          } else {
            fail("Admin settings were not saved: " + error);
          }
          return;
        }
        // Publication is separate from the signed local commit. Never undo an
        // accepted edit because peers are unreachable or publishing fails.
        Page.cmd("sitePublish", {"inner_path": "data/admin/content.json", "sign": false}, (pub_res) => {
          var success = pub_res === "ok";
          if (success) {
            Page.cmd("wrapperNotification", ["done", "Admin settings saved."]);
          } else {
            Page.cmd("wrapperNotification", ["error", "Admin settings saved locally, but publishing failed: " + (pub_res?.error || pub_res || "No response.")]);
          }
          Moderation.loadAdminSettings(() => {
            this.loadRoles();
            if (cb) cb(success, true);
          });
        });
      });
    });
  }
}

Object.assign(Admin.prototype, LogMixin);
window.Admin = new Admin();
})();
