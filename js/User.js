(function() {
class User {
  constructor() {
    this.my_topic_votes = {};
    this.my_comment_votes = {};
    this.rules = {};  // Last result for fileRules command
    this.xid_name = null;  // Resolved xID primary name
    this.xid_tld = null;
    this.xid_avatar = null;
    this.xid_loading = false;
    this.role = null;  // "owner", "admin", "mod", or null
    this.xid_prompt_shown = false;

    this.initXidButtons();
  }

  updateMyInfo(cb) {
    this.log("Updating user info...", this.my_address);
    this.updateRole();
    this.updateMyVotes(cb);
  }

  updateRole() {
    this.role = Moderation.getRole();
    this.log("User role:", this.role);
  }

  // Load my votes
  updateMyVotes(cb, attempt) {
    var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
    var query = `
      SELECT 'topic_vote' AS type, topic_uri AS uri FROM json LEFT JOIN topic_vote USING (json_id) WHERE directory = "${user_dir}" AND file_name = 'data.json'
      UNION
      SELECT 'comment_vote' AS type, comment_uri AS uri FROM json LEFT JOIN comment_vote USING (json_id) WHERE directory = "${user_dir}" AND file_name = 'data.json'
    `;
    Page.cmd("dbQuery", [query], (votes) => {
      if (!Array.isArray(votes)) {
        // Right after a clone the site db can still be rebuilding, and
        // dbQuery answers with an error object. Iterating it threw, which
        // killed the whole boot chain and froze the loading overlay forever.
        // Retry until the db is queryable, then give up gracefully: the page
        // must load even if votes could not.
        if ((attempt || 0) < 20) {
          this.log("Votes query not ready, retrying:", votes && votes.error);
          setTimeout(() => this.updateMyVotes(cb, (attempt || 0) + 1), 1500);
          return;
        }
        votes = [];
      }
      for (let vote of votes) {
        if (vote.type === "topic_vote") {
          this.my_topic_votes[vote.uri] = true;
        } else {
          this.my_comment_votes[vote.uri] = true;
        }
      }
      if (cb) cb();
    });
  }

  initXidButtons() {
    $(".certselect").on("click", () => {
      if (!Page.site_info?.auth_address) {
        Page.cmd("wrapperNotification", ["info", "Please connect to EpixNet first."]);
      } else if (!this.xid_name) {
        this.triggerCertXid();
      } else {
        var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
        window.top.location = "?User:" + user_dir;
      }
      return false;
    });
  }

  // Resolve xID primary name for an auth_address via EpixNet xidResolve plugin
  resolveXidName(authAddress, cb) {
    if (!authAddress) {
      if (cb) cb(null);
      return;
    }

    Page.cmd("xidResolve", [authAddress], (result) => {
      if (result?.name) {
        if (cb) cb(result.name, result.tld, result.avatar || "");
      } else {
        if (cb) cb(null);
      }
    });
  }

  // Resolve and store my own xID name
  resolveMyXidName(cb) {
    if (this.xid_loading) {
      if (cb) cb(this.xid_name);
      return;
    }
    this.xid_loading = true;
    this.resolveXidName(Page.site_info.auth_address, (name, tld, avatar) => {
      this.xid_name = name;
      this.xid_tld = tld;
      this.xid_avatar = avatar || "";
      this.xid_loading = false;
      if (cb) cb(name);
    });
  }

  checkCert(type) {
    if (Page.site_info.auth_address) {
      if (!Page.site_info.cert_user_id) {
        // No cert selected — show connect prompt
        $(".user_name-my").text("Connect xID").css({"color": "#f39c12"});
        $(".comment-new").addClass("comment-nocert");
        $(".topic-new-link").css({"display": "none"});
        $(".topic-new").css({"display": "none"});
        this.showXidFab();
        if (!this.xid_prompt_shown) {
          this.xid_prompt_shown = true;
          this.triggerCertXid();
        }
      } else {
        // Cert present: migrate legacy data.json into the merge files (once).
        this.maybeMigrate();
        this.resolveMyXidName((name) => {
          if (name) {
            var display = name + "." + this.xid_tld;
            $(".user_name-my").text(display).css({"color": Text.toColor(display)});
            $(".comment-new").removeClass("comment-nocert");
            $(".topic-new-link").css({"display": ""});
            this.showXidTag(display);
          } else {
            $(".user_name-my").text("Connect xID").css({"color": "#f39c12"});
            $(".comment-new").addClass("comment-nocert");
            $(".topic-new-link").css({"display": "none"});
            $(".topic-new").css({"display": "none"});
            this.showXidFab();
            if (!this.xid_prompt_shown) {
              this.xid_prompt_shown = true;
              this.triggerCertXid();
            }
          }
        });
      }
      var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
      Page.cmd("fileRules", "data/users/" + user_dir + "/content.json", (rules) => {
        this.rules = rules;
        if (rules.max_size) this.setCurrentSize(rules.current_size); else this.setCurrentSize(0);
      });
    } else {
      $(".comment-new").addClass("comment-nocert");
      $(".user_name-my").text("Not connected");
      this.setCurrentSize(0);
    }
  }

  triggerCertXid() {
    Page.cmd("certXid", [], (result) => {
      if (result === "ok") {
        this.xid_loading = false;
        this.resolveMyXidName((name) => {
          if (name) {
            var display = name + "." + this.xid_tld;
            $(".user_name-my").text(display).css({"color": Text.toColor(display)});
            $(".comment-new").removeClass("comment-nocert");
            $(".topic-new-link").css({"display": ""});
            Page.cmd("wrapperNotification", ["done", "Connected as " + display]);
            this.showXidTag(display);
          }
        });
      }
    });
  }

  showXidFab() {
    $(".xid-fab, .xid-tag").remove();
    var fab = $('<a href="#" class="xid-fab nolink" title="Register xID">xID</a>');
    fab.on("click", (e) => {
      e.preventDefault();
      this.triggerCertXid();
      return false;
    });
    $(".head").append(fab);
  }

  showXidTag(display) {
    $(".xid-fab, .xid-tag").remove();
    // Compute hue from display name for consistent color
    var hash = 0;
    for (var i = 0; i < display.length; i++) {
      hash += display.charCodeAt(i) * i;
    }
    var hue = hash % 360;
    var bgColor = "hsl(" + hue + ", 50%, 25%)";
    var textColor = "hsl(" + hue + ", 80%, 80%)";
    var avatar = this.xid_avatar;
    var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
    var tag;
    if (avatar) {
      tag = $('<a href="?User:' + user_dir + '" class="xid-tag nolink" style="background-color: ' + bgColor + ';">' +
        '<img src="' + avatar + '" style="border: 2px solid ' + textColor + ';" onerror="this.style.display=\'none\'">' +
        '<span style="color: ' + textColor + ';">' + display + '</span>' +
      '</a>');
    } else {
      tag = $('<a href="?User:' + user_dir + '" class="xid-tag nolink" style="background-color: ' + bgColor + ';">' +
        '<span style="color: ' + textColor + ';">' + display + '</span>' +
      '</a>');
    }
    $(".head").append(tag);
  }

  // Check if user has xID name (required to post)
  requireXid(cb) {
    if (!Page.site_info?.auth_address) {
      Page.cmd("wrapperNotification", ["info", "Please connect to EpixNet first."]);
      return false;
    }
    if (this.xid_name) {
      return true;
    }
    // Try to resolve again in case it was just registered
    this.xid_loading = false;
    this.resolveMyXidName((name) => {
      if (name) {
        cb();
      } else {
        // No xID found — start the cert acquisition flow
        Page.cmd("certXid", [], (result) => {
          if (result === "ok") {
            // Cert acquired, re-resolve and continue
            this.xid_loading = false;
            this.resolveMyXidName(function(name2) {
              if (name2) {
                cb();
              }
            });
          }
        });
      }
    });
    return false;
  }

  setCurrentSize(current_size) {
    if (current_size) {
      var current_size_kb = current_size / 1000;
      var label = "used: " + current_size_kb.toFixed(1) + "k/" + Math.round(this.rules.max_size / 1000) + "k";
      $(".user-size").not(".user-size-used").text(label).attr("title",
        "Every new user has limited space to store comments, topics and votes.\n" +
        "This indicator shows your used/total allowed KBytes.\n" +
        "The site admin can increase it if you about to run out of it."
      );
      // Overlay is a pure visual bar — keep it empty so copy/paste only picks
      // up the track's label once.
      $(".user-size.user-size-used").text("");
      var percent = Math.min(100, 100 * current_size / this.rules.max_size);
      var $track = $(".user-size").not(".user-size-used").first();
      var trackWidth = $track.outerWidth() || 120;
      var fillPx = current_size > 0 ? Math.max(3, trackWidth * percent / 100) : 0;
      $(".user-size-used")
        .css("width", fillPx + "px")
        .toggleClass("is-high", percent >= 90)
        .toggleClass("is-mid", percent >= 70 && percent < 90);
      if (percent > 80 && Page.site_info.content?.settings?.admin) {
        $(".user-size-warning")
          .css("display", "block")
          .find("a")
          .text(Page.site_info.content.settings.admin)
          .attr("href", Text.fixLink(Page.site_info.content.settings.admin_href));
      }
    } else {
      $(".user-size").text("");
    }
  }

  dataInnerPath() {
    var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
    return "data/users/" + user_dir + "/data.json";
  }

  // Blank/default data.json used only when a user genuinely has no data yet.
  getDefaultData() {
    return {"next_topic_id": 1, "topic": [], "topic_vote": {}, "next_comment_id": 1, "comment": {}, "comment_vote": {}, "next_report_id": 1, "report": []};
  }

  getData(cb) {
    Page.cmd("fileGet", {"inner_path": this.dataInnerPath(), "required": false}, (data) => {
      cb(data ? JSON.parse(data) : this.getDefaultData());
    });
  }

  // Guarded read for any action that mutates the user's data.json.
  //
  // data.json is a single last-writer-wins file read with required:false. On a
  // device that has not synced it yet, the plain read misses; if the caller
  // then falls back to a blank default and publishes, the fileWrite +
  // sitePublish signs that blank over the network and wipes the user's real
  // topics/comments/votes everywhere. So on a MISSED read we do not hand back a
  // blank right away: we force a sync (siteUpdate) and re-read a few times.
  //  - If the real file arrives, use it (no clobber).
  //  - If it is still absent AND this is a first-time creation AND the site is
  //    fully synced (no bad_files), there is genuinely nothing to overwrite, so
  //    seed a default (a brand-new account's first post/comment/vote/report).
  //  - Otherwise (a mutation of existing data, or the site is still syncing)
  //    abort the write and ask the user to retry, rather than risk a clobber.
  //
  // options: { allowCreate: bool, onAbort: fn }
  getDataForWrite(cb, options) {
    options = options || {};
    var allowCreate = !!options.allowCreate;
    var onAbort = options.onAbort;
    var inner_path = this.dataInnerPath();
    var self = this;
    Page.cmd("fileGet", {"inner_path": inner_path, "required": false}, function(data) {
      if (data) { // Present on this device - normal path, no clobber risk
        cb(JSON.parse(data));
        return;
      }
      // Missed read: try to fetch the real file before deciding anything.
      self.syncAndReread(inner_path, function(synced) {
        if (synced) { // Real data arrived - use it, never clobber
          cb(JSON.parse(synced));
          return;
        }
        var fully_synced = !Page.site_info || !Page.site_info.bad_files;
        if (allowCreate && fully_synced) {
          cb(self.getDefaultData()); // Genuinely new account: safe to seed
          return;
        }
        Page.cmd("wrapperNotification", ["info", "Your data is still syncing, please try again in a moment."]);
        if (onAbort) onAbort();
      });
    });
  }

  // Force a re-sync of the site (siteUpdate runs in the background and returns
  // immediately), then poll the file back a few times. cb(raw) once it arrives,
  // or cb(null) if still missing after the attempts.
  syncAndReread(inner_path, cb) {
    var address = Page.site_address || (Page.site_info && Page.site_info.address);
    if (address) {
      Page.cmd("siteUpdate", {"address": address});
    } else {
      Page.cmd("siteUpdate", {});
    }
    var attempts = 0;
    var max_attempts = 6;
    var tryRead = function() {
      setTimeout(function() {
        Page.cmd("fileGet", {"inner_path": inner_path, "required": false}, function(data) {
          if (data) { cb(data); return; }
          attempts += 1;
          if (attempts >= max_attempts) { cb(null); return; }
          tryRead();
        });
      }, 700);
    };
    tryRead();
  }

  publishData(data, cb) {
    Page.writePublish(this.dataInnerPath(), Text.jsonEncode(data), (res) => {
      this.checkCert("updaterules"); // Update used space
      if (cb) cb(res);
    });
  }

  // ---- Signed-CRDT merge files ------------------------------------------
  //
  // Each collection lives in its OWN merge file under the user's directory:
  //   topics.json         - topics             -> topic table
  //   comments.json       - comments           -> comment table
  //   topic_votes.json    - topic vote toggles -> topic_vote table
  //   comment_votes.json  - comment vote toggles-> comment_vote table
  //   reports.json        - reports            -> report table
  // A record is signed by the node (recordSign fills author + post_id + sign)
  // and UNION-merged into the on-disk set, so a write can never overwrite
  // another record. Deletes are signed tombstones, edits/re-toggles are new
  // versions of the same id. The node folds every version to its live winners
  // for the DB, so the reads/feeds queries stay unchanged.

  userDir() {
    return Page.site_info.xid_directory || Page.site_info.auth_address;
  }

  // The collections declared as merge files for this user directory.
  mergeCollections() {
    return ["topics", "comments", "topic_votes", "comment_votes", "reports"];
  }

  collectionPath(collection) {
    return "data/users/" + this.userDir() + "/" + collection + ".json";
  }

  contentPathFor(user_dir) {
    return "data/users/" + user_dir + "/content.json";
  }

  // A 128-bit random nonce (hex): the entropy that makes a nonce-based post_id
  // unique. Part of every record's signed payload.
  randNonce() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Read a collection's merge file (all signed record versions).
  getRecords(collection, cb) {
    Page.cmd("fileGet", {"inner_path": this.collectionPath(collection), "required": false}, (data) => {
      var container = data ? JSON.parse(data) : null;
      if (!container || !container.post) container = {"record_format": "epix-orset-1", "post": []};
      cb(container);
    });
  }

  // Make sure EVERY declared merge file exists on disk (empty if new) BEFORE a
  // publish declares them, so the first content.json signing auto-declares all
  // of them at once (files first seen in a later publish would otherwise be
  // signed as hashed last-writer-wins files).
  ensureCollections(cb) {
    var pending = this.mergeCollections().slice();
    var next = () => {
      if (!pending.length) { if (cb) cb(); return; }
      var path = "data/users/" + this.userDir() + "/" + pending.shift() + ".json";
      Page.cmd("fileGet", {"inner_path": path, "required": false}, (data) => {
        if (data != null) {
          next();
        } else {
          var empty = {"record_format": "epix-orset-1", "post": []};
          Page.cmd("fileWrite", [path, Text.jsonEncode(empty)], () => next());
        }
      });
    };
    next();
  }

  // Write ONE signed record to my <collection>.json and publish my content.json.
  // The node union-merges the record into the on-disk set (never overwriting
  // other records) and signs+bumps content.json (auto-declaring the merge
  // files), which propagates the merge. cb(true) on success, cb(false) on error.
  saveRecord(collection, record, cb) {
    var container = {"record_format": "epix-orset-1", "post": [record]};
    Page.cmd("fileWrite", [this.collectionPath(collection), Text.jsonEncode(container)], (res_write) => {
      if (res_write !== "ok") {
        Page.cmd("wrapperNotification", ["error", "File write error: " + (res_write && res_write.error ? res_write.error : res_write)]);
        if (cb) cb(false);
        return;
      }
      this.ensureCollections(() => {
        Page.cmd("sitePublish", {"inner_path": this.contentPathFor(this.userDir())}, (res_pub) => {
          this.checkCert("updaterules"); // Update used space
          if (cb) cb(res_pub === "ok" || res_pub === true);
        });
      });
    });
  }

  // Create a NEW nonce-based item (a topic or a comment). `fields` are the app
  // columns (topic_id/comment_id, title/body, added, ...). The node derives a
  // unique post_id from the random nonce + date_added. cb(true/false).
  createRecord(collection, fields, cb) {
    var record = {
      "nonce": this.randNonce(),
      "clock": Date.now(),
      "supersedes": 0,
      "deleted": false,
      "date_added": Time.timestamp()
    };
    for (var k in fields) if (fields[k] !== undefined) record[k] = fields[k];
    Page.cmd("recordSign", [record], (signed) => {
      if (!signed || signed.error) { if (cb) cb(false); return; }
      this.saveRecord(collection, signed, cb);
    });
  }

  // Edit or DELETE (tombstone) an existing nonce-based item found by an app id
  // field (topic_id / comment_id). Carries the item's immutable origin
  // (nonce/date_added) forward so the node re-derives the SAME post_id and the
  // merge supersedes the prior version; a delete writes a signed tombstone.
  // cb(true/false); cb(false) if no such item is present locally.
  editRecordById(collection, id_field, id_value, changes, deleted, cb) {
    this.getRecords(collection, (container) => {
      var maxClock = 0, orig = null;
      container.post.forEach((r) => {
        if (r[id_field] === id_value) {
          if (r.clock > maxClock) maxClock = r.clock;
          if (!orig || (r.clock || 0) >= (orig.clock || 0)) orig = r;
        }
      });
      if (!orig) { if (cb) cb(false); return; }
      var record = {};
      var skip = {author: 1, sign: 1, clock: 1, supersedes: 1, deleted: 1, moderated: 1, post_id: 1};
      for (var k in orig) if (!skip[k]) record[k] = orig[k]; // keep nonce, date_added, app fields
      record["clock"] = Math.max(maxClock + 1, Date.now());
      record["supersedes"] = maxClock;
      record["deleted"] = deleted === true;
      if (deleted === true) {
        record["body"] = ""; // a tombstone may carry no body
      } else {
        for (var c in changes) if (changes[c] !== undefined) record[c] = changes[c];
        record["modified"] = Math.floor(Date.now() / 1000);
      }
      Page.cmd("recordSign", [record], (signed) => {
        if (!signed || signed.error) { if (cb) cb(false); return; }
        this.saveRecord(collection, signed, cb);
      });
    });
  }

  // Write a KEY-based record (a vote toggle, a report): the node derives a
  // STABLE per-(author,key) post_id, so a re-toggle/edit SUPERSEDES the prior
  // record and a delete (deleted:true) writes a tombstone for the same key.
  // `fields` are the app columns (skipped on a tombstone). cb(true/false).
  editRecord(collection, key, fields, deleted, cb) {
    this.getRecords(collection, (container) => {
      var maxClock = 0, orig = null;
      container.post.forEach((r) => {
        if (r.key === key) {
          if (r.clock > maxClock) maxClock = r.clock;
          if (!orig || (r.clock || 0) >= (orig.clock || 0)) orig = r;
        }
      });
      var record = {
        "key": key,
        "nonce": orig && orig.nonce ? orig.nonce : this.randNonce(),
        "clock": Math.max(maxClock + 1, Date.now()),
        "supersedes": maxClock,
        "deleted": deleted === true,
        "date_added": orig ? orig.date_added : Time.timestamp()
      };
      if (deleted !== true) {
        for (var k in fields) if (fields[k] !== undefined) record[k] = fields[k];
      }
      Page.cmd("recordSign", [record], (signed) => {
        if (!signed || signed.error) { if (cb) cb(false); return; }
        this.saveRecord(collection, signed, cb);
      });
    });
  }

  // Cross-author MODERATION delete: write a signed tombstone into the TARGET
  // user's <collection>.json for the record found by (id_field, id_value),
  // carrying the item's OWN post_id + id-origin so it groups with (and hides)
  // the target item; then publish the TARGET user's content.json. The record is
  // deleted:true + moderated:true, which the node's verify_record accepts from
  // ANY authorized signer of the dir (the admin is one via user_contents rules),
  // so a moderator can tombstone another user's item without re-signing content.
  // Never edits content - it can only tombstone. cb(true/false).
  moderateDelete(target_dir, collection, id_field, id_value, cb) {
    var path = "data/users/" + target_dir + "/" + collection + ".json";
    Page.cmd("fileGet", {"inner_path": path, "required": false}, (raw) => {
      var container = raw ? JSON.parse(raw) : null;
      if (!container || !container.post) { if (cb) cb(false); return; }
      var maxClock = 0, orig = null;
      container.post.forEach((r) => {
        if (r[id_field] === id_value) {
          if (r.clock > maxClock) maxClock = r.clock;
          if (!orig || (r.clock || 0) >= (orig.clock || 0)) orig = r;
        }
      });
      if (!orig || orig.post_id == null) { if (cb) cb(false); return; }
      var record = {
        "post_id": orig.post_id,
        "clock": Math.max(maxClock + 1, Date.now()),
        "supersedes": maxClock,
        "deleted": true,
        "moderated": true,
        "body": "",
        "date_added": orig.date_added
      };
      if (orig.nonce != null) record["nonce"] = orig.nonce;
      if (orig.key != null) record["key"] = orig.key;
      Page.cmd("recordSign", [record], (signed) => {
        if (!signed || signed.error) { if (cb) cb(false); return; }
        var tombstone = {"record_format": "epix-orset-1", "post": [signed]};
        Page.cmd("fileWrite", [path, Text.jsonEncode(tombstone)], (res_write) => {
          if (res_write !== "ok") { if (cb) cb(false); return; }
          Page.cmd("sitePublish", {"inner_path": this.contentPathFor(target_dir)}, (res_pub) => {
            if (cb) cb(res_pub === "ok" || res_pub === true);
          });
        });
      });
    });
  }

  // Sign a batch of UNSIGNED legacy records into <collection>.json (union-merge)
  // and publish once. ADDITIVE + per-item idempotent: only signs items whose
  // `id_field` is not already present.
  migrateCollection(collection, records, id_field, cb) {
    var done = () => { if (cb) cb(); };
    if (!records || !records.length) return done();
    this.getRecords(collection, (container) => {
      var have = {};
      container.post.forEach((r) => { if (r[id_field] != null) have[r[id_field]] = true; });
      var todo = records.filter((r) => r && r[id_field] != null && !have[r[id_field]]);
      if (!todo.length) return done();
      var signed = [];
      var i = 0;
      var signNext = () => {
        if (i >= todo.length) {
          if (!signed.length) return done();
          var merged = {"record_format": "epix-orset-1", "post": signed};
          return Page.cmd("fileWrite", [this.collectionPath(collection), Text.jsonEncode(merged)], () => {
            this.ensureCollections(() => {
              Page.cmd("sitePublish", {"inner_path": this.contentPathFor(this.userDir())}, () => done());
            });
          });
        }
        var rec = todo[i++];
        Page.cmd("recordSign", [rec], (s) => {
          if (s && !s.error) signed.push(s);
          signNext();
        });
      };
      signNext();
    });
  }

  // Run the one-time-ish migration once per session, when we have a cert to sign
  // and publish with. ADDITIVE + per-item idempotent; never strips data.json.
  maybeMigrate() {
    if (this.migrated) return;
    if (!Page.site_info || !Page.site_info.auth_address || !Page.site_info.cert_user_id) return;
    this.migrated = true;
    this.migrate();
  }

  // One-time-ish migration of legacy data.json (topic[]/comment{}/topic_vote{}/
  // comment_vote{}/report[]) into the signed-CRDT merge files. ADDITIVE and
  // per-item idempotent (keyed by topic_id/comment_id for the nonce-based
  // collections, by `key` for the vote/report collections so future toggles
  // supersede), runs in the background, and NEVER strips the data.json arrays.
  migrate(cb) {
    if (this.migrating) { if (cb) cb(); return; }
    this.migrating = true;
    var finish = () => { this.migrating = false; if (cb) cb(); };
    this.getData((data) => {
      // topics
      var topic_records = ((data && data.topic) || []).map((t) => {
        var rec = {
          "nonce": this.randNonce(),
          "clock": 1,
          "supersedes": 0,
          "deleted": false,
          "topic_id": t.topic_id,
          "title": t.title,
          "body": t.body,
          "added": t.added,
          "date_added": t.added
        };
        if (t.type != null) rec["type"] = t.type;
        if (t.parent_topic_uri != null) rec["parent_topic_uri"] = t.parent_topic_uri;
        if (t.modified != null) rec["modified"] = t.modified;
        return rec;
      });
      // comments: a dict of topic_uri -> [comment, ...]
      var comment_records = [];
      var legacy_comments = (data && data.comment) || {};
      for (var topic_uri in legacy_comments) {
        var list = legacy_comments[topic_uri];
        if (!Array.isArray(list)) continue;
        list.forEach((c) => {
          var rec = {
            "nonce": this.randNonce(),
            "clock": 1,
            "supersedes": 0,
            "deleted": false,
            "comment_id": c.comment_id,
            "topic_uri": topic_uri,
            "body": c.body,
            "added": c.added,
            "date_added": c.added
          };
          if (c.modified != null) rec["modified"] = c.modified;
          comment_records.push(rec);
        });
      }
      // topic votes: a dict of topic_uri -> added timestamp
      var topic_vote_records = [];
      var legacy_tv = (data && data.topic_vote) || {};
      for (var tv_uri in legacy_tv) {
        topic_vote_records.push({
          "key": tv_uri,
          "nonce": this.randNonce(),
          "clock": 1,
          "supersedes": 0,
          "deleted": false,
          "topic_uri": tv_uri,
          "added": legacy_tv[tv_uri],
          "date_added": legacy_tv[tv_uri]
        });
      }
      // comment votes: a dict of comment_uri -> added timestamp
      var comment_vote_records = [];
      var legacy_cv = (data && data.comment_vote) || {};
      for (var cv_uri in legacy_cv) {
        comment_vote_records.push({
          "key": cv_uri,
          "nonce": this.randNonce(),
          "clock": 1,
          "supersedes": 0,
          "deleted": false,
          "comment_uri": cv_uri,
          "added": legacy_cv[cv_uri],
          "date_added": legacy_cv[cv_uri]
        });
      }
      // reports: an array
      var report_records = ((data && data.report) || []).map((r) => {
        return {
          "key": r.type + "_" + r.target_uri,
          "nonce": this.randNonce(),
          "clock": 1,
          "supersedes": 0,
          "deleted": false,
          "report_id": r.report_id,
          "type": r.type,
          "target_uri": r.target_uri,
          "reason": r.reason,
          "added": r.added,
          "date_added": r.added
        };
      });
      this.migrateCollection("topics", topic_records, "topic_id", () => {
        this.migrateCollection("comments", comment_records, "comment_id", () => {
          this.migrateCollection("topic_votes", topic_vote_records, "key", () => {
            this.migrateCollection("comment_votes", comment_vote_records, "key", () => {
              this.migrateCollection("reports", report_records, "key", () => {
                finish();
              });
            });
          });
        });
      });
    });
  }
}

Object.assign(User.prototype, LogMixin);
window.User = new User();
})();
