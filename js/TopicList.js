(function() {
class TopicList {
  constructor() {
    this.thread_sorter = null;
    this.parent_topic_uri = undefined;
    this.limit = 31;
    this.topic_parent_uris = {};
    this.topic_sticky_uris = {};
    this.topic_pinned_uris = {};
    this.topictype = "topic";
    this.topic_search_query = null;
  }

  getSettings() {
    return UserPrefs;
  }

  setUserOption(key, value) {
    UserPrefs.set(key, value);
  }

  initListOrderSwitcher() {
    var selector = 'input[type=radio][name=toolbar-topic_list_order_by]';
    $(selector).off("change").on("change", () => {
      this.setListOrder($('input[name=toolbar-topic_list_order_by]:checked').val());
    });
    var order = UserPrefs.get("topic_list_order_by", "last_activity");
    $(selector).filter("[value=" + order + "]").prop("checked", true);
  }

  setListOrder(new_order) {
    var old_order = UserPrefs.get("topic_list_order_by", "last_activity");
    if (old_order === new_order) return;
    this.setUserOption("topic_list_order_by", new_order);
    this.loadTopics("list");
  }

  initListModeSwitcher() {
    var selector = 'input[type=radio][name=toolbar-topic_list_mode]';
    $(selector).off("change").on("change", () => {
      this.setListMode($('input[name=toolbar-topic_list_mode]:checked').val());
    });
    var mode = UserPrefs.get("topic_list_mode", "normal");
    $(selector).filter("[value=" + mode + "]").prop("checked", true);
  }

  setListMode(new_mode) {
    var old_mode = UserPrefs.get("topic_list_mode", "normal");
    if (old_mode === new_mode) return;
    this.setUserOption("topic_list_mode", new_mode);
    this.loadTopics("list");
  }

  actionList(parent_topic_id, parent_topic_user_address) {
    if (Page.site_info.content?.settings?.topic_sticky_uris) {
      for (let topic_sticky_uri of Page.site_info.content.settings.topic_sticky_uris) {
        this.topic_sticky_uris[topic_sticky_uri] = 1;
      }
    }

    // Load pinned topic URIs from admin settings
    this.topic_pinned_uris = {};
    if (Moderation.admin_settings?.pinned_topic_uris) {
      for (let pinned_uri of Moderation.admin_settings.pinned_topic_uris) {
        this.topic_pinned_uris[pinned_uri] = 1;
      }
    }

    $(".topics-loading").cssLater("top", "0px", 200);

    // Topic group listing
    if (parent_topic_id) {
      $(".topics-title").html("&nbsp;");
      this.parent_topic_uri = parent_topic_id + "_" + parent_topic_user_address;

      // Update visited info
      UserPrefs.set("topic." + parent_topic_id + "_" + parent_topic_user_address + ".visited", Time.timestamp());
    } else {
      $(".topics-title").html(_("Newest topics"));
    }

    this.loadTopics("noanim");

    // Show create new topic form
    $(".topic-new-link").on("click", () => {
      if (Page.site_info.address === "1TaLkFrMwvbNsooF4ioKAY9EuxTBTjipT") {
        $(".topmenu").addClass("highlight");
        $(".topic-new .message").css("display", "block");
      }
      // Show the form instantly (no scale/opacity animation) so the textarea
      // has its final layout/computed styles before EasyMDE initializes.
      // Animating first breaks CodeMirror's character-width measurement and
      // Font Awesome icon rendering on the toolbar.
      $(".topic-new").css({opacity: 1, transform: "none"}).show();
      MarkdownEditor.initTopicEditor();
      $(".topic-new-link").slideUp();
      return false;
    });

    // Create new topic
    $(".topic-new .button-submit").on("click", () => {
      this.submitCreateTopic();
      return false;
    });

    $(".topic-new .topic_type").on("click", () => {
      this.log("Create menu");
      var menu = new Menu($(".topic_type"));
      menu.addItem(_("Create a topic"), () => {
        this.topictype = "topic";
        menu.hide();
        $(".topic-new .image .icon").removeClass("icon-topic-group").addClass("icon-topic-chat");
        $(".topic_type_label").text(_("Topic"));
        $(".topic-new #topic_title").attr("placeholder", _("Topic title"));
        $(".topic-new #topic_body").attr("placeholder", _("Topic description"));
        $(".topic-new .button-submit").text(_("Create topic"));
        $(".topic-new #topic_body").trigger("input").focus();
        return true;
      });
      menu.addItem(_("Create a group"), () => {
        this.topictype = "group";
        menu.hide();
        $(".topic-new .image .icon").removeClass("icon-topic-chat").addClass("icon-topic-group");
        $(".topic_type_label").text(_("Group"));
        $(".topic-new #topic_title").attr("placeholder", _("Group title"));
        $(".topic-new #topic_body").attr("placeholder", _("Group description"));
        $(".topic-new .button-submit").text(_("Create group"));
        $(".topic-new #topic_body").trigger("input").focus();
        return true;
      });
      menu.show();
      return false;
    });

    $(".topics-more").on("click", () => {
      this.limit += 100;
      $(".topics-more").text("Loading...");
      this.loadTopics("noanim");
      return false;
    });

    // Search
    $(".topic-search-button").on("click", () => {
      this.limit = 31;
      this.topic_search_query = $(".topic-search").val();
      $(".topic-search-clear").css("display", this.topic_search_query ? "" : "none");
      this.loadTopics("list");
      return false;
    });
    $(".topic-search").on("keypress", (e) => {
      if (e.keyCode === 13) {
        this.limit = 31;
        this.topic_search_query = e.currentTarget.value;
        $(".topic-search-clear").css("display", this.topic_search_query ? "" : "none");
        this.loadTopics("list");
        return false;
      }
    });
    $(".topic-search-clear").on("click", () => {
      $(".topic-search").val("");
      $(".topic-search-clear").css("display", "none");
      this.limit = 31;
      this.topic_search_query = null;
      this.loadTopics("list");
      return false;
    });

    // Sort order + display mode switchers
    this.initListOrderSwitcher();
    this.initListModeSwitcher();

    // Follow button
    this.initFollowButton();
  }

  initFollowButton() {
    this.follow = new Follow($(".feed-follow-list"));
    if (this.parent_topic_uri) { // Subtopic
      this.follow.addFeed("New topics in this group", `
        SELECT
         title AS title,
         body,
         added AS date_added,
         'topic' AS type,
         '?Topic:' || topic.topic_id || '_' || topic_creator_json.directory AS url,
         parent_topic_uri AS param
        FROM topic
        LEFT JOIN json AS topic_creator_json ON (topic_creator_json.json_id = topic.json_id)
        WHERE parent_topic_uri IN (:params)
      `, true, this.parent_topic_uri);
    } else {
      this.follow.addFeed(_("New topics"), `
        SELECT
         title AS title,
         body,
         added AS date_added,
         'topic' AS type,
         '?Topic:' || topic.topic_id || '_' || topic_creator_json.directory AS url
        FROM topic
        LEFT JOIN json AS topic_creator_json ON (topic_creator_json.json_id = topic.json_id)
        WHERE parent_topic_uri IS NULL
      `, true);
      if (User.xid_name) {
        var username = User.xid_name;
        this.follow.addFeed("Username mentions", `
          SELECT
           'mention' AS type,
           comment.added AS date_added,
           topic.title,
           comment.body AS body,
           commenter_json.directory AS author,
           topic_creator_json.directory AS topic_creator_address,
           topic.topic_id || '_' || topic_creator_json.directory AS row_topic_uri,
           '?Topic:' || topic.topic_id || '_' || topic_creator_json.directory AS url,
           '?Topic:' || topic.topic_id || '_' || topic_creator_json.directory ||
            '&comment=' || comment.comment_id || '_' || commenter_json.directory AS permalink
          FROM topic
           LEFT JOIN json AS topic_creator_json ON (topic_creator_json.json_id = topic.json_id)
           LEFT JOIN comment ON (comment.topic_uri = row_topic_uri)
           LEFT JOIN json AS commenter_json ON (commenter_json.json_id = comment.json_id)
          WHERE
           comment.body LIKE '%[${username}%' OR comment.body LIKE '%@${username}%'
        `, true);
      }
      this.follow.addFeed("All comments", `
        SELECT
         'comment' AS type,
         comment.added AS date_added,
         topic.title,
         comment.body AS body,
         commenter_json.directory AS author,
         topic_creator_json.directory AS topic_creator_address,
         topic.topic_id || '_' || topic_creator_json.directory AS row_topic_uri,
         '?Topic:' || topic.topic_id || '_' || topic_creator_json.directory AS url,
         '?Topic:' || topic.topic_id || '_' || topic_creator_json.directory ||
          '&comment=' || comment.comment_id || '_' || commenter_json.directory AS permalink
        FROM topic
         LEFT JOIN json AS topic_creator_json ON (topic_creator_json.json_id = topic.json_id)
         LEFT JOIN comment ON (comment.topic_uri = row_topic_uri)
         LEFT JOIN json AS commenter_json ON (commenter_json.json_id = comment.json_id)
      `);
    }
    this.follow.init();
  }

  parseTopicSearchQuery() {
    var search_query = this.topic_search_query || "";
    var where_conditions = [], having_conditions = [], types = [], search_words = [];

    for (var s of search_query.split(/\s+/)) {
      var match;
      if ((match = s.match(/^author:([a-zA-Z0-9._@]*)/))) {
        where_conditions.push("topic_creator_address LIKE '" + match[1].replace(/['%]/g, '_') + "%'");
      } else if ((match = s.match(/^date-(before|after):(\d+[.\-]\d+[.\-]\d+)/))) {
        var d = Date.parse(match[2].replace(/\./g, '-'));
        if (!isNaN(d)) {
          var ts = Math.floor(d / 1000);
          where_conditions.push("topic.added " + (match[1] === "after" ? ">" : "<") + " " + ts);
        }
      } else if ((match = s.match(/^(comments|votes):([<>]=?|<>|=)(\d+)/))) {
        var field = match[1] === "comments" ? "comments_num" : "votes";
        var op = match[2] || "=";
        if (field === "votes") {
          where_conditions.push(field + " " + op + " " + match[3]);
        } else {
          having_conditions.push(field + " " + op + " " + match[3]);
        }
      } else if ((match = s.match(/^types?:([a-z,]+)/))) {
        types = match[1].split(",");
      } else {
        s = s.replace(/\s+/g, '');
        if (s) search_words.push(s.replace(/["'%]/g, '_'));
      }
    }

    if (search_words.length > 0) {
      where_conditions.push("(topic.title || ' ' || topic.body) LIKE '%" + search_words.join("%") + "%'");
    }

    var where = where_conditions.length > 0 ? where_conditions.map(v => "(" + v + ")").join(" AND ") : "1=1";
    var having = having_conditions.length > 0 ? having_conditions.map(v => "(" + v + ")").join(" AND ") : "1=1";
    var nonempty = where_conditions.length > 0 || having_conditions.length > 0 || types.length > 0;

    return {
      where, having, types, nonempty,
      isTypeEnabled(type, default_value) {
        if (!this.nonempty || this.types.length === 0) return default_value;
        return this.types.indexOf(type) >= 0 || this.types.indexOf(type + "s") >= 0;
      }
    };
  }

  loadTopics(type, cb) {
    if (!type) type = "list";
    if (!cb) cb = false;
    this.logStart("Load topics...");
    var search_query = this.parseTopicSearchQuery();
    var where;
    if (this.parent_topic_uri) { // Topic group listing
      where = "WHERE parent_topic_uri = '" + this.parent_topic_uri + "' OR row_topic_uri = '" + this.parent_topic_uri + "'";
      if (search_query.nonempty) where += " AND (" + search_query.where + ")";
    } else { // Main listing
      where = "WHERE topic.type IS NULL AND topic.parent_topic_uri IS NULL";
      if (search_query.nonempty) where += " AND (" + search_query.where + ")";
    }
    var last_elem = $(".topics-list .topic.template");

    var sql_sticky;
    if (Page.site_info.content?.settings?.topic_sticky_uris?.length > 0) {
      var sql_sticky_whens = Page.site_info.content.settings.topic_sticky_uris.map(function(topic_uri) {
        return "WHEN '" + topic_uri + "' THEN 1";
      }).join(" ");
      sql_sticky = "CASE topic.topic_id || '_' || topic_creator_content.directory " + sql_sticky_whens + " ELSE 0 END AS sticky";
    } else {
      sql_sticky = "0 AS sticky";
    }

    var query = `
      SELECT
       COUNT(comment_id) AS comments_num, MAX(comment.added) AS last_comment, topic.added as last_added, CASE WHEN MAX(comment.added) IS NULL THEN topic.added ELSE MAX(comment.added) END as last_action,
       topic.*,
       topic_creator_content.directory AS topic_creator_user_name,
       topic_creator_content.directory AS topic_creator_address,
       topic.topic_id || '_' || topic_creator_content.directory AS row_topic_uri,
       NULL AS row_topic_sub_uri, NULL AS row_topic_sub_title, NULL AS row_topic_sub_type,
       (SELECT COUNT(*) FROM topic_vote WHERE topic_vote.topic_uri = topic.topic_id || '_' || topic_creator_content.directory)+1 AS votes,
       ${sql_sticky}
      FROM topic
      LEFT JOIN json AS topic_creator_json ON (topic_creator_json.json_id = topic.json_id)
      LEFT JOIN json AS topic_creator_content ON (topic_creator_content.directory = topic_creator_json.directory AND topic_creator_content.file_name = 'content.json')
      LEFT JOIN comment ON (comment.topic_uri = row_topic_uri AND comment.added < ${Date.now()/1000+120})
      ${where}
      GROUP BY topic.topic_id, topic.json_id
      HAVING last_action < ${Date.now()/1000+120} AND ${search_query.having}
    `;

    if (!this.parent_topic_uri && search_query.isTypeEnabled("group", true)) { // Union topic groups
      query += `
        UNION ALL

        SELECT
         COUNT(comment_id) AS comments_num, MAX(comment.added) AS last_comment,
         MAX(topic_sub.added) AS last_added,
         CASE WHEN MAX(topic_sub.added) > MAX(comment.added) OR MAX(comment.added) IS NULL THEN MAX(topic_sub.added) ELSE MAX(comment.added) END as last_action,
         topic.*,
         topic_creator_content.directory AS topic_creator_user_name,
         topic_creator_content.directory AS topic_creator_address,
         topic.topic_id || '_' || topic_creator_content.directory AS row_topic_uri,
         topic_sub.topic_id || '_' || topic_sub_creator_content.directory AS row_topic_sub_uri,
         topic_sub.title AS row_topic_sub_title, topic_sub.type AS row_topic_sub_type,
         (SELECT COUNT(*) FROM topic_vote WHERE topic_vote.topic_uri = topic.topic_id || '_' || topic_creator_content.directory)+1 AS votes,
         ${sql_sticky}
        FROM topic
        LEFT JOIN json AS topic_creator_json ON (topic_creator_json.json_id = topic.json_id)
        LEFT JOIN json AS topic_creator_content ON (topic_creator_content.directory = topic_creator_json.directory AND topic_creator_content.file_name = 'content.json')
        LEFT JOIN topic AS topic_sub ON (topic_sub.parent_topic_uri = topic.topic_id || '_' || topic_creator_content.directory)
        LEFT JOIN json AS topic_sub_creator_json ON (topic_sub_creator_json.json_id = topic_sub.json_id)
        LEFT JOIN json AS topic_sub_creator_content ON (topic_sub_creator_content.directory = topic_sub_creator_json.directory AND topic_sub_creator_content.file_name = 'content.json')
        LEFT JOIN comment ON (comment.topic_uri = row_topic_sub_uri AND comment.added < ${Date.now()/1000+120})
        WHERE topic.parent_topic_uri IS NULL AND topic.type = "group" ${search_query.nonempty ? "AND (" + search_query.where + ")" : ""}
        GROUP BY topic.topic_id
        HAVING last_action < ${Date.now()/1000+120} AND ${search_query.having}
      `;
    } else if (this.parent_topic_uri) {
      query += `
        UNION ALL

        SELECT
         COUNT(comment_id) AS comments_num, MAX(comment.added) AS last_comment,
         MAX(topic_sub.added) AS last_added,
         CASE WHEN MAX(topic_sub.added) > MAX(comment.added) OR MAX(comment.added) IS NULL THEN MAX(topic_sub.added) ELSE MAX(comment.added) END as last_action,
         topic.*,
         topic_creator_content.directory AS topic_creator_user_name,
         topic_creator_content.directory AS topic_creator_address,
         topic.topic_id || '_' || topic_creator_content.directory AS row_topic_uri,
         topic_sub.topic_id || '_' || topic_sub_creator_content.directory AS row_topic_sub_uri,
         topic_sub.title AS row_topic_sub_title, topic_sub.type AS row_topic_sub_type,
         (SELECT COUNT(*) FROM topic_vote WHERE topic_vote.topic_uri = topic.topic_id || '_' || topic_creator_content.directory)+1 AS votes,
         ${sql_sticky}
        FROM topic
        LEFT JOIN json AS topic_creator_json ON (topic_creator_json.json_id = topic.json_id)
        LEFT JOIN json AS topic_creator_content ON (topic_creator_content.directory = topic_creator_json.directory AND topic_creator_content.file_name = 'content.json')
        LEFT JOIN topic AS topic_sub ON (topic_sub.parent_topic_uri = topic.topic_id || '_' || topic_creator_content.directory)
        LEFT JOIN json AS topic_sub_creator_json ON (topic_sub_creator_json.json_id = topic_sub.json_id)
        LEFT JOIN json AS topic_sub_creator_content ON (topic_sub_creator_content.directory = topic_sub_creator_json.directory AND topic_sub_creator_content.file_name = 'content.json')
        LEFT JOIN comment ON (comment.topic_uri = row_topic_sub_uri AND comment.added < ${Date.now()/1000+120})
        WHERE topic.type = "group" AND topic.parent_topic_uri = '${this.parent_topic_uri}'
        GROUP BY topic.topic_id
        HAVING last_action < ${Date.now()/1000+120} AND ${search_query.having}
      `;
    }

    if (!this.parent_topic_uri) {
      var order_by = UserPrefs.get("topic_list_order_by", "last_activity");
      var order_col;
      if (order_by === "topic_creation")  order_col = "added DESC";
      else if (order_by === "comments_num") order_col = "comments_num DESC";
      else if (order_by === "votes_num")  order_col = "votes DESC";
      else                                order_col = "last_action DESC";
      query += " ORDER BY sticky DESC, " + order_col + " LIMIT " + this.limit;
    }

    Page.cmd("dbQuery", [query], (topics) => {
      if (!Array.isArray(topics)) {
        this.log("DB query error:", topics?.error || topics);
        topics = [];
      }

      // On a fresh list load (or search), remove stale DOM topics so results
      // reflect exactly what the query returned rather than leaving unmatched
      // topics visible from a previous render pass.
      if (type === "list") {
        $(".topics-list .topic:not(.template)").remove();
        last_elem = $(".topics-list .topic.template");
      }

      var order_by = UserPrefs.get("topic_list_order_by", "last_activity");
      topics.sort(function(a, b) {
        // Sticky topics always pinned to top, then pinned topics below sticky,
        // then everything else sorted by the user's selected order.
        var a_sticky = window.TopicList.topic_sticky_uris[a.row_topic_uri] ? 2 : 0;
        var b_sticky = window.TopicList.topic_sticky_uris[b.row_topic_uri] ? 2 : 0;
        var a_pinned = window.TopicList.topic_pinned_uris[a.row_topic_uri] ? 1 : 0;
        var b_pinned = window.TopicList.topic_pinned_uris[b.row_topic_uri] ? 1 : 0;
        var a_rank = a_sticky + a_pinned;
        var b_rank = b_sticky + b_pinned;
        if (a_rank !== b_rank) return b_rank - a_rank;

        // Secondary sort by the selected order
        var va, vb;
        if (order_by === "topic_creation") {
          va = a.added || 0;  vb = b.added || 0;  return vb - va;
        } else if (order_by === "comments_num") {
          va = a.comments_num || 0;  vb = b.comments_num || 0;  return vb - va;
        } else if (order_by === "votes_num") {
          va = a.votes || 0;  vb = b.votes || 0;  return vb - va;
        } else {
          // last_activity (default)
          va = Math.max(a.last_comment || 0, a.last_added || 0);
          vb = Math.max(b.last_comment || 0, b.last_added || 0);
          return vb - va;
        }
      });
      var limited = false;
      var topic_parent;

      for (var i = 0; i < topics.length; i++) {
        var topic = topics[i];
        var topic_uri = topic.row_topic_uri;
        if (topic.last_added) {
          topic.added = topic.last_added;
        }

        // Parent topic for group that we currently listing
        if (this.parent_topic_uri && topic_uri === this.parent_topic_uri) {
          topic_parent = topic;
          continue; // Don't display it
        }

        var elem = $(document.getElementById("topic_" + topic_uri));
        if (elem.length === 0) { // Create if not exits yet
          elem = $(".topics-list .topic.template").clone().removeClass("template").attr("id", "topic_" + topic_uri);
          if (type !== "noanim") elem.cssSlideDown();
          this.applyTopicListeners(elem, topic);
        }

        if (i + 1 < this.limit) {
          // Move the row only when its position actually changed: detaching
          // and re-inserting every row on every sync refresh breaks the
          // browser's scroll anchoring and reads as a full-page flicker.
          if (elem.prev()[0] !== last_elem[0]) {
            elem.insertAfter(last_elem);
          }
        } else {
          limited = true;
        }
        last_elem = elem;

        this.applyTopicData(elem, topic);
      }

      Page.addInlineEditors();

      $("body").css({"overflow": "auto", "height": "auto"}); // Auto height body

      this.logEnd("Load topics...");

      // Hide loading
      if (parseInt($(".topics-loading").css("top")) > -30) { // Loading visible, animate it
        $(".topics-loading").css("top", "-30px");
      } else {
        $(".topics-loading").remove();
      }

      // Set sub-title listing title
      if (this.parent_topic_uri) {
        Page.cmd("wrapperSetTitle", topic_parent.title + " - EpixTalk");
        $(".topics-title").html("<span class='parent-link'><a href='?Main'>" + _("Main") + "</a> &rsaquo;</span> " + topic_parent.title);
      } else if (search_query.nonempty) {
        $(".topics-title").text(_("Search results"));
      } else {
        $(".topics-title").text(_("Newest topics"));
      }

      $(".topics").css("opacity", 1);
      Page.updateScrollHints();

      // Load tip counts for visible topics
      Tipping.loadTipCounts($(".topics-list .topic:not(.template)"));

      // Show loading / empty forum bigmessage
      if (topics.length === 0) {
        if (search_query.nonempty) {
          $(".message-big").text(_("No results found."));
        } else if (Page.site_info.settings?.own) {
          $(".message-big").text("Welcome to your own forum! :)");
          $(".topic-new-link").trigger("click");
        } else if (Page.site_info.bad_files || Page.syncedRecently()) {
          // Still downloading. `bad_files` only covers the site's own files;
          // the topics arrive afterwards in per-user dirs, which is what
          // isSyncing() tracks. Without it a visitor was told "Welcome to your
          // own forum!" - on someone else's forum, with the new-topic composer
          // popped open - for the whole user-content download.
          $(".message-big").text("Initial sync in progress...");
        } else {
          $(".message-big").text(_("No topics yet."));
        }
        $(".message-big").css("display", "block").cssLater("opacity", 1);
      } else {
        $(".message-big").css("display", "none");
      }

      if (limited) {
        $(".topics-more").css("display", "block");
      } else {
        $(".topics-more").css("display", "none");
      }

      if (cb) cb();
    });
  }

  applyTopicListeners(elem, topic) {
    // Tip button click
    $(".tip-btn", elem).on("click", function(e) {
      e.stopPropagation();
      var contentHash = elem.data("content-hash");
      if (!contentHash) return false;
      var parts = (topic.topic_creator_address || "").split(".");
      var xidName = parts[0] || "";
      var xidTld = parts[1] || "epix";
      Tipping.openTipModal(contentHash, xidName, xidTld, topic.row_topic_uri);
      return false;
    });
    // Username click -> profile
    $(".user_name", elem).on("click", function(e) {
      window.top.location = "?User:" + topic.topic_creator_address;
      e.stopPropagation();
      return false;
    });
    // Menu (3-dot) click
    $(".user_menu", elem).on("click", (e) => {
      var menu = new Menu($(".user_menu", elem));
      menu.addItem(_("View profile"), () => {
        window.top.location = "?User:" + topic.topic_creator_address;
      });
      menu.addItem(_("Mute this user"), () => {
        elem.fancySlideUp();
        Page.cmd("muteAdd", [topic.topic_creator_address, topic.topic_creator_user_name, "Topic: " + topic.title]);
      });
      // Mod: Report topic
      if (Moderation.isMod()) {
        var topic_uri = topic.row_topic_uri;
        if (Moderation.isReported("topic", topic_uri)) {
          menu.addItem(_("Unreport topic"), () => {
            Moderation.unreportContent("topic", topic_uri, () => {
              this.loadTopics();
            });
          });
        } else {
          menu.addItem(_("Report topic"), () => {
            var reporter_name = User.xid_name ? User.xid_name + "." + User.xid_tld : "moderator";
            Moderation.reportContent("topic", topic_uri, "Reported by " + reporter_name, () => {
              this.loadTopics();
            });
          });
        }
      }
      // Admin: Pin/Unpin topic
      if (Moderation.isAdmin()) {
        var topic_uri = topic.row_topic_uri;
        if (window.TopicList.topic_pinned_uris[topic_uri]) {
          menu.addItem(_("Unpin topic"), () => {
            Admin.unpinTopic(topic_uri, () => {
              this.loadTopics();
            });
          });
        } else {
          menu.addItem(_("Pin topic"), () => {
            Admin.pinTopic(topic_uri, () => {
              this.loadTopics();
            });
          });
        }
      }
      // Admin: Delete topic
      if (Moderation.isAdmin()) {
        menu.addItem(_("Delete topic"), () => {
          if (confirm("Are you sure you want to delete this topic? This action cannot be undone.")) {
            Moderation.deleteContent("topic", topic.row_topic_uri, () => {
              this.loadTopics();
            });
          }
        });
      }
      menu.show();
      e.stopPropagation();
      return false;
    });
  }

  applyTopicData(elem, topic, type) {
    if (!type) type = "list";
    var title_hash = Text.toUrl(topic.title);
    var topic_uri = topic.row_topic_uri;
    $(".title .title-link", elem).text(topic.title);
    $(".title .title-link, a.image, .comment-num", elem).attr("href", "?Topic:" + topic_uri + "/" + title_hash);
    elem.data("topic_uri", topic_uri);

    // Get links in body
    var body = topic.body;
    var url_match = body.match(/http[s]{0,1}:\/\/[^"', \r\n)$]+/);
    if (topic.type === "group") { // Group type topic
      $(elem).addClass("topic-group");
      $(".image .icon", elem).removeClass("icon-topic-chat").addClass("icon-topic-group");
      $(".link", elem).css("display", "none");
      $(".title .title-link, a.image, .comment-num", elem).attr("href", "?Topics:" + topic_uri + "/" + title_hash);
    } else if (url_match) { // Link type topic
      var url = url_match[0];
      if (type !== "show") body = body.replace(/http[s]{0,1}:\/\/[^"' \r\n)$]+$/g, ""); // Remove links from end
      $(".image .icon", elem).removeClass("icon-topic-chat").addClass("icon-topic-link");
      $(".link", elem).css("display", "").attr("href", Text.fixLink(url));
      $(".link .link-url", elem).text(url);
    } else { // Normal type topic
      $(".image .icon", elem).removeClass("icon-topic-link").addClass("icon-topic-chat");
      $(".link", elem).css("display", "none");
    }

    // Apply display mode
    var topic_list_mode = UserPrefs.get("topic_list_mode", "normal");

    // Skip the body re-render when nothing changed: re-setting identical html
    // on every sync refresh makes embedded images re-fetch (visible flicker
    // on Gecko) and breaks scroll anchoring.
    var render_key = type + "|" + topic_list_mode + "|" + body;
    if (elem.data("rendered_body_key") !== render_key) {
      elem.data("rendered_body_key", render_key);
      if (type === "show") {
        $(".body", elem).html(Text.toMarked(body, {}));
      } else {
        // Remove any previous mode class
        elem[0].className = elem[0].className.replace(/\b\w+-mode\b/g, "").trim();
        elem.addClass(topic_list_mode + "-mode");

        if (topic_list_mode === "tiny" || topic_list_mode === "brief") {
          $(".body", elem).text("");
        } else if (topic_list_mode === "full") {
          $(".body", elem).html(Text.toMarked(body, {}));
        } else {
          // normal: single truncated line
          var preview = body.replace(/[\n\r]+/g, " ").trim();
          $(".body", elem).html(Text.toMarkedInline(preview, {"sanitize": true}));
        }
      }
    }

    if (window.TopicList.topic_sticky_uris[topic_uri]) {
      elem.addClass("topic-sticky");
    }

    if (window.TopicList.topic_pinned_uris[topic_uri]) {
      elem.addClass("topic-pinned");
    } else {
      elem.removeClass("topic-pinned");
    }

    // Last activity and comment num
    var last_action = Math.max(topic.last_comment || 0, topic.added || 0);
    if (type !== "show") {
      if (topic.type === "group") {
        $(".comment-num", elem).text("last activity");
        $(".added", elem).text(Time.since(last_action));
      } else if (topic.comments_num === 1) {
        $(".comment-num", elem).text(topic.comments_num + " comment");
        $(".added", elem).text("last " + Time.since(last_action));
      } else if (topic.comments_num > 0) {
        $(".comment-num", elem).text(topic.comments_num + " comments");
        $(".added", elem).text("last " + Time.since(last_action));
      } else {
        $(".comment-num", elem).text("0 comments");
        $(".added", elem).text(Time.since(last_action));
      }
    }

    // Creator address and user name - resolve via xID
    var display_name = Text.formatUsername(topic.topic_creator_user_name);
    $(".user_name", elem)
      .text(display_name)
      .attr("title", topic.topic_creator_address)
      .attr("href", "?User:" + topic.topic_creator_address)
      .css("cursor", "pointer")
      .off("click").on("click", function() {
        window.top.location = "?User:" + topic.topic_creator_address;
        return false;
      });
    // Asynchronously resolve xID name for display
    if (topic.topic_creator_address) {
      User.resolveXidName(topic.topic_creator_address, function(name, tld, avatar) {
        if (name) {
          $(".user_name", elem).text(name + "." + tld);
        }
        if (avatar) {
          // Only touch src when it changed: re-assigning the same src makes
          // Gecko re-fetch the image (avatar flicker on every sync refresh)
          var img = $(".user-avatar", elem);
          if (img.attr("src") !== avatar) {
            img.attr("src", avatar).off("error").on("error", function() { $(this).hide(); });
          }
          img.css("display", "");
        }
      });
    }

    // Apply topic score
    if (User.my_topic_votes[topic_uri]) { // Voted on topic
      $(".score-inactive .score-num", elem).text(topic.votes - 1);
      $(".score-active .score-num", elem).text(topic.votes);
      $(".score", elem).addClass("active");
    } else { // Not voted on it
      $(".score-inactive .score-num", elem).text(topic.votes);
      $(".score-active .score-num", elem).text(topic.votes + 1);
    }
    $(".score", elem).off("click").on("click", (e) => this.submitTopicVote(e));

    // Visited
    elem.removeClass("visit-none visit-newcomment");
    var visited = UserPrefs.get("topic." + topic_uri + ".visited", null);
    if (!visited) {
      elem.addClass("visit-none");
    } else if (visited < last_action) {
      elem.addClass("visit-newcomment");
    }

    if (type === "show") $(".added", elem).text(Time.since(topic.added));

    // Modified timestamp — only on topic-full view (not on list rows)
    if (type === "show" && topic.modified && topic.modified > topic.added) {
      $(".modified .date", elem).text(Time.since(topic.modified)).attr("title", Time.date(topic.modified));
      $(".modified", elem).css("display", "");
    } else {
      $(".modified", elem).css("display", "none");
    }

    // Latest sub-topic preview, group topics only (sub-topics are created
    // inside groups; regular topics never show this row)
    if (topic.type === "group" && topic.row_topic_sub_title) {
      var subtopic_title_hash = Text.toUrl(topic.row_topic_sub_title);
      var subtopic_uri = topic.row_topic_sub_uri;
      $(".subtopic", elem).css("display", "block");
      if (topic.row_topic_sub_type === "group") {
        $(".subtopic-link", elem)
          .attr("href", "?Topics:" + subtopic_uri + "/" + subtopic_title_hash)
          .text(topic.row_topic_sub_title);
      } else {
        $(".subtopic-link", elem)
          .attr("href", "?Topic:" + subtopic_uri + "/" + subtopic_title_hash)
          .text(topic.row_topic_sub_title);
      }
    } else {
      $(".subtopic", elem).css("display", "none");
    }

    // Reported topic indicator
    if (Moderation.isReported("topic", topic_uri)) {
      elem.addClass("topic-reported");
      if (!Moderation.isMod()) {
        // Hide reported content from regular users
        elem.addClass("topic-hidden");
      }
    } else {
      elem.removeClass("topic-reported topic-hidden");
    }

    // Tipping: compute content hash and store on element
    if (topic.topic_creator_address && topic.topic_id) {
      var contentHash = Tipping.computeContentHash(topic.topic_creator_address, String(topic.topic_id));
      elem.data("content-hash", contentHash);
    }

    // My topic
    var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
    if (topic.topic_creator_address === user_dir) {
      $(elem).attr("data-object", "Topic:" + topic_uri).attr("data-deletable", "yes");
      $(".title .title-link", elem).attr("data-editable", "title").data("content", topic.title);
      $(".body", elem).attr("data-editable", "body").data("content", topic.body);
    }
  }

  submitCreateTopic() {
    if (!User.requireXid(() => this.submitCreateTopic())) {
      return false;
    }

    var title = $(".topic-new #topic_title").val().trim();
    var body = $(".topic-new #topic_body").val().trim();
    if (!title) return $(".topic-new #topic_title").focus();

    $(".topic-new .button-submit").addClass("loading");
    // A new topic is a fresh signed record in topics.json. topic_id stays the
    // stable app id used in every topic_uri (URLs, votes, comments); the node
    // derives a separate immutable CRDT post_id from the record's nonce.
    var topic = {
      "topic_id": Date.now(),
      "title": title,
      "body": body,
      "added": Time.timestamp()
    };
    // Check Chinese characters
    if (Page.site_info.address === "1TaLkFrMwvbNsooF4ioKAY9EuxTBTjipT" && (title + body).match(/[\u3400-\u9FBF]/)) {
      topic.parent_topic_uri = "10_1J3rJ8ecnwH2EPYa6MrgZttBNc61ACFiCj";
    }

    if (this.parent_topic_uri) topic.parent_topic_uri = this.parent_topic_uri;
    if (this.topictype === "group") topic.type = "group";
    User.createRecord("topics", topic, (res) => {
      $(".topic-new .button-submit").removeClass("loading");
      if (!res) return;
      $(".topic-new").slideUp();
      $(".topic-new-link").slideDown();
      var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
      setTimeout(() => {
        if (this.topictype === "group") {
          window.top.location = "?Topics:" + topic.topic_id.toString() + "_" + user_dir;
          return;
        } else if (topic.parent_topic_uri && this.parent_topic_uri !== topic.parent_topic_uri) {
          window.top.location = "?Topics:" + topic.parent_topic_uri;
        } else {
          this.loadTopics();
        }
        // Follow topic comments
        window.TopicShow.topic_uri = topic.topic_id + "_" + user_dir;
        window.TopicShow.initFollowButton(function() {
          for (var title in window.TopicShow.follow.feeds) {
            var feed = window.TopicShow.follow.feeds[title];
            feed[1].addClass("selected");
          }
          window.TopicShow.follow.saveFeeds();
        });
      }, 600);
      $(".topic-new #topic_body").val("");
      $(".topic-new #topic_title").val("");
    });
  }

  submitTopicVote(e) {
    if (!User.requireXid(() => this.submitTopicVote(e))) {
      return false;
    }

    var elem = $(e.currentTarget);
    elem.toggleClass("active").addClass("loading");
    var topic_uri = elem.parents(".topic").data("topic_uri");
    // A vote is a keyed record in topic_votes.json (key = topic_uri): voting is
    // a live record, un-voting a signed tombstone for the same key.
    var voting = elem.hasClass("active");
    User.editRecord("topic_votes", topic_uri, {"topic_uri": topic_uri, "added": Math.floor(Date.now() / 1000)}, !voting, function(res) {
      elem.removeClass("loading");
      if (res) {
        if (voting) User.my_topic_votes[topic_uri] = true;
        else delete User.my_topic_votes[topic_uri];
      } else {
        elem.toggleClass("active"); // revert optimistic toggle on failure
      }
    });
    return false;
  }
}

Object.assign(TopicList.prototype, LogMixin);
window.TopicList = new TopicList();
})();
