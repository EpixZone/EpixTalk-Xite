(function() {
class TopicShow {
  actionShow(topic_id, topic_user_address, focus_comment) {
    this.topic_id = topic_id;
    this.topic_user_address = topic_user_address;
    this.topic_uri = this.topic_id + "_" + this.topic_user_address;
    this.topic = null;
    // Comment to scroll to once the list renders (a permalink from the
    // newsfeed or an in-page quote anchor), cleared after one jump so a
    // background refresh never yanks the reader back.
    this.focus_comment = focus_comment || null;
    this.focus_comment_expanded = false;

    this.list_all = false;
    $(".topic-title").css("display", "none");
    this.loadTopic();
    this.loadComments("noanim");

    $(".comment-new .button-submit-form").on("click", () => {
      this.submitComment();
      return false;
    });

    MarkdownEditor.initCommentEditor();

    var textarea = $(".comment-new #comment_body");
    $(".comment-new #comment_body").on("input", () => {
      // Update used space
      if (User.rules.max_size) {
        var current_size;
        if (textarea.val().length > 0) {
          current_size = User.rules.current_size + textarea.val().length + 90;
        } else {
          current_size = User.rules.current_size;
        }
        User.setCurrentSize(current_size);
      }
    });

    $(".comments-more").on("click", () => {
      this.list_all = true;
      $(".comments-more").text("Loading...");
      this.loadComments("noanim");
      return false;
    });

    // Follow button
    this.initFollowButton();
  }

  initFollowButton(cb) {
    this.follow = new Follow($(".feed-follow-show"));
    this.follow.addFeed("Comments in this topic", `
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
      WHERE
       row_topic_uri IN (:params)
    `, true, this.topic_uri);
    this.follow.init(cb);
  }

  queryTopic(topic_id, topic_user_address) {
    return `
     SELECT
      topic.*,
      topic_creator_content.directory AS topic_creator_user_name,
      topic_creator_content.directory AS topic_creator_address,
      topic.topic_id || '_' || topic_creator_content.directory AS row_topic_uri,
      (SELECT COUNT(*) FROM topic_vote WHERE topic_vote.topic_uri = topic.topic_id || '_' || topic_creator_content.directory)+1 AS votes
     FROM topic
      LEFT JOIN json AS topic_creator_json ON (topic_creator_json.json_id = topic.json_id)
      LEFT JOIN json AS topic_creator_content ON (topic_creator_content.directory = topic_creator_json.directory AND topic_creator_content.file_name = 'content.json')
     WHERE
      topic.topic_id = ${topic_id} AND topic_creator_address = '${topic_user_address}'
     LIMIT 1`;
  }

  loadTopic(cb) {
    if (!cb) cb = false;
    this.logStart("Loading topic...");

    $(".topic-full").attr("id", "topic_" + this.topic_uri);

    Page.cmd("dbQuery", [this.queryTopic(this.topic_id, this.topic_user_address)], (res) => {
      this.topic = res[0];
      TopicList.applyTopicData($(".topic-full"), this.topic, "show");
      // The topic query can finish after comments, which initialize their own
      // editors independently. Attach these controls as soon as the topic loads.
      Page.addInlineEditors();
      Page.cmd("wrapperSetTitle", this.topic.title + " - EpixTalk");

      // Topic-level 3-dot menu
      $(".topic-full > .menu_3dot").off("click").on("click", () => {
        var topic = this.topic;
        var elem = $(".topic-full");
        var menu = new Menu($(".topic-full > .menu_3dot"));
        var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
        if (topic.topic_creator_address === user_dir) {
          menu.addItem(_("Edit topic"), () => {
            var body_elem = $(".body", elem);
            var editor = body_elem.data("editor");
            if (editor) editor.startEdit();
          });
          menu.addItem(_("Delete topic"), () => {
            var body_elem = $(".body", elem);
            var editor = body_elem.data("editor");
            if (editor) editor.deleteObject();
          });
        }
        menu.addItem(_("View profile"), () => {
          window.top.location = "?User:" + topic.topic_creator_address;
        });
        menu.addItem(_("Mute this user"), () => {
          Page.cmd("muteAdd", [topic.topic_creator_address, topic.topic_creator_user_name, "Topic: " + topic.title]);
        });
        // Mod: Report topic
        if (Moderation.isMod()) {
          var topic_uri = topic.row_topic_uri;
          if (Moderation.isReported("topic", topic_uri)) {
            menu.addItem(_("Unreport topic"), () => {
              Moderation.unreportContent("topic", topic_uri, () => {
                this.loadTopic();
              });
            });
          } else {
            menu.addItem(_("Report topic"), () => {
              var reporter_name = User.xid_name ? User.xid_name + "." + User.xid_tld : "moderator";
              Moderation.reportContent("topic", topic_uri, "Reported by " + reporter_name, () => {
                this.loadTopic();
              });
            });
          }
        }
        // Admin: Pin/Unpin topic
        if (Moderation.isAdmin()) {
          var topic_uri = topic.row_topic_uri;
          var pinned_uris = (Moderation.admin_settings && Moderation.admin_settings.pinned_topic_uris) || [];
          if (pinned_uris.indexOf(topic_uri) !== -1) {
            menu.addItem(_("Unpin topic"), () => {
              Admin.unpinTopic(topic_uri, () => {
                this.loadTopic();
              });
            });
          } else {
            menu.addItem(_("Pin topic"), () => {
              Admin.pinTopic(topic_uri, () => {
                this.loadTopic();
              });
            });
          }
        }
        // Authors already have a delete action. Use moderation for other authors.
        if (Moderation.isAdmin() && topic.topic_creator_address !== user_dir) {
          menu.addItem(_("Delete topic"), () => {
            if (confirm("Are you sure you want to delete this topic? This action cannot be undone.")) {
              Moderation.deleteContent("topic", topic.row_topic_uri, () => {
                window.top.location = "?Main";
              });
            }
          });
        }
        menu.show();
        return false;
      });

      // Topic has parent, update title breadcrumb
      if (this.topic.parent_topic_uri) {
        $(".topic-title").css("display", "");
        var parts = this.topic.parent_topic_uri.split("_");
        var parent_topic_id = parts[0];
        var parent_topic_user_address = parts.slice(1).join("_");
        Page.cmd("dbQuery", [this.queryTopic(parent_topic_id, parent_topic_user_address)], (parent_res) => {
          var parent_topic = parent_res[0];
          $(".topic-title").html(
            "<span class='parent-link'><a href='?Main'>Main</a> &rsaquo;</span> " +
            "<span class='parent-link'><a href='?Topics:" + parent_topic.row_topic_uri + "/" + Text.toUrl(parent_topic.title) + "'>" + parent_topic.title + "</a> &rsaquo;</span> " +
            this.topic.title
          );
        });
      }

      // Tipping: compute content hash for the full topic view
      if (this.topic.topic_creator_address && this.topic.topic_id) {
        var contentHash = Tipping.computeContentHash(this.topic.topic_creator_address, String(this.topic.topic_id));
        $(".topic-full").data("content-hash", contentHash);
        var parts = (this.topic.topic_creator_address || "").split(".");
        var xidName = parts[0] || "";
        var xidTld = parts[1] || "epix";
        $(".topic-full .tip-btn").off("click").on("click", function(e) {
          e.stopPropagation();
          Tipping.openTipModal(contentHash, xidName, xidTld, window.TopicShow.topic_uri);
          return false;
        });
        Tipping.loadTipCounts($(".topic-full"));
      }

      $(".topic-full").css("opacity", 1);
      $("body").addClass("page-topic");

      this.logEnd("Loading topic...");

      if (cb) cb();
    });
  }

  loadComments(type, cb) {
    if (!type) type = "show";
    if (!cb) cb = false;

    this.logStart("Loading comments...");

    // Load comments
    var query = `
      SELECT
       comment.*,
       user_json_content.directory AS user_name,
       user_json_content.directory AS user_address,
       (SELECT COUNT(*) FROM comment_vote WHERE comment_vote.comment_uri = comment.comment_id || '_' || user_json_content.directory)+1 AS votes
      FROM comment
       LEFT JOIN json AS user_json_data ON (user_json_data.json_id = comment.json_id)
       LEFT JOIN json AS user_json_content ON (user_json_content.directory = user_json_data.directory AND user_json_content.file_name = 'content.json')
      WHERE comment.topic_uri = '${this.topic_id}_${this.topic_user_address}' AND added < ${Date.now()/1000+120}
      ORDER BY added DESC
    `;

    if (!this.list_all) {
      query += " LIMIT 60";
    }

    Page.cmd("dbQuery", [query], (comments) => {
      var focused = $(":focus");
      this.logEnd("Loading comments...");
      $(".comments .comment:not(.template)").attr("missing", "true");
      var last_comment_dom = null;
      for (let comment of comments) {
        var comment_uri = comment.comment_id + "_" + comment.user_address;
        var elem = $(document.getElementById("comment_" + comment_uri));
        if (elem.length === 0) { // Create if not exists
          elem = $(".comment.template").clone().removeClass("template").attr("id", "comment_" + comment_uri).data("topic_uri", this.topic_uri);
          if (type !== "noanim") {
            elem.cssSlideDown();
          }
          this.applyCommentListeners(elem, comment);
          $(".score", elem).attr("id", "comment_score_" + comment_uri).on("click", (e) => this.submitCommentVote(e)); // Submit vote
        }
        this.applyCommentData(elem, comment);
        // Move the row only when its position actually changed: detaching and
        // re-appending every comment on every sync refresh breaks the
        // browser's scroll anchoring and reads as a full-page flicker.
        var in_place;
        if (last_comment_dom) {
          in_place = elem.prev()[0] === last_comment_dom;
        } else {
          in_place = elem.parent().length !== 0 && elem.prevAll(".comment:not(.template)").length === 0;
        }
        if (!in_place) {
          if (last_comment_dom) {
            elem.insertAfter(last_comment_dom);
          } else {
            elem.prependTo(".comments");
          }
        }
        elem.removeAttr("missing");
        last_comment_dom = elem[0];
      }

      Page.onPageLoaded();
      $(".comment[missing]").remove();

      // Load tip counts for all comments
      Tipping.loadTipCounts($(".comments .comment:not(.template)"));

      Page.addInlineEditors();

      if (comments.length === 60) {
        $(".comments-more").css("display", "block");
      } else {
        $(".comments-more").css("display", "none");
      }

      // Update last visited
      var visited_ts = comments.length > 0 ? comments[0].added : this.topic.added;
      UserPrefs.set("topic." + this.topic_id + "_" + this.topic_user_address + ".visited", visited_ts);
      focused.focus();

      this.focusComment(comments.length);

      if (cb) cb();
    });
  }

  // Jump to the comment a permalink asked for. Comments render after the page
  // does, so the browser's own anchor handling has already given up by now.
  focusComment(rendered_num) {
    if (!this.focus_comment) {
      return false;
    }
    var elem = document.getElementById("comment_" + this.focus_comment);
    if (!elem) {
      // Out of the newest-60 window: widen the query once, then try again.
      if (!this.list_all && !this.focus_comment_expanded && rendered_num >= 60) {
        this.log("Comment not in view, loading all comments:", this.focus_comment);
        this.focus_comment_expanded = true;
        this.list_all = true;
        this.loadComments("noanim");
      } else {
        this.log("Comment not found:", this.focus_comment);
        this.focus_comment = null;
      }
      return false;
    }
    var target = this.focus_comment;
    this.focus_comment = null;
    setTimeout(function() {
      elem.scrollIntoView({ behavior: "smooth", block: "center" });
      var $elem = $(elem).addClass("focused");
      setTimeout(function() {
        $elem.removeClass("focused");
      }, 2600);
    }, 100);
    this.log("Focused comment", target);
    return true;
  }

  applyCommentListeners(elem, comment) {
    $(".reply", elem).on("click", (e) => { // Reply link
      return this.buttonReply($(e.target).parents(".comment"));
    });

    // Tipping: compute content hash for comment and attach click handler
    if (comment.user_address && comment.comment_id) {
      var commentContentHash = Tipping.computeContentHash(comment.user_address, "comment_" + String(comment.comment_id));
      elem.data("content-hash", commentContentHash);
      var parts = (comment.user_address || "").split(".");
      var xidName = parts[0] || "";
      var xidTld = parts[1] || "epix";
      $(".tip-btn", elem).off("click").on("click", function(e) {
        e.stopPropagation();
        Tipping.openTipModal(commentContentHash, xidName, xidTld);
        return false;
      });
    }

    $(".menu_3dot", elem).on("click", () => {
      var menu = new Menu($(".menu_3dot", elem));
      menu.addItem(_("View profile"), () => {
        window.top.location = "?User:" + comment.user_address;
      });
      menu.addItem(_("Mute this user"), () => {
        elem.fancySlideUp();
        Page.cmd("muteAdd", [comment.user_address, comment.user_name, "Comment: " + comment.body.substring(0, 21)]);
      });
      menu.addItem(_("Permalink"), () => {
        window.top.location = "#" + elem.attr('id');
      });
      // Mod: Report comment
      if (Moderation.isMod()) {
        var comment_uri = comment.comment_id + "_" + comment.user_address;
        if (Moderation.isReported("comment", comment_uri)) {
          menu.addItem(_("Unreport comment"), () => {
            Moderation.unreportContent("comment", comment_uri, () => {
              this.loadComments();
            });
          });
        } else {
          menu.addItem(_("Report comment"), () => {
            var reporter_name = User.xid_name ? User.xid_name + "." + User.xid_tld : "moderator";
            Moderation.reportContent("comment", comment_uri, "Reported by " + reporter_name, () => {
              this.loadComments();
            });
          });
        }
      }
      // Admin: Delete comment
      if (Moderation.isAdmin()) {
        var comment_uri = comment.comment_id + "_" + comment.user_address;
        menu.addItem(_("Delete comment"), () => {
          if (confirm("Are you sure you want to delete this comment? This action cannot be undone.")) {
            Moderation.deleteContent("comment", comment_uri, () => {
              this.loadComments();
            });
          }
        });
      }
      menu.show();
      return false;
    });
  }

  // Update elem based on data of comment dict
  applyCommentData(elem, comment) {
    var user_name = comment.user_name;
    var display_name = Text.formatUsername(user_name);
    // Skip the body re-render when unchanged: re-setting identical html on
    // every sync refresh makes embedded images re-fetch (visible flicker on
    // Gecko) and breaks scroll anchoring.
    if (elem.data("rendered_body") !== comment.body) {
      elem.data("rendered_body", comment.body);
      $(".body", elem).html(Text.toMarked(comment.body, {}));
    }
    $(".user_name", elem).text(display_name).css({"color": Text.toColor(user_name || "anonymous")}).attr("title", comment.user_address);
    $(".user_name", elem).css("cursor", "pointer").on("click", function() {
      window.top.location = "?User:" + comment.user_address;
      return false;
    });
    $(".added", elem).text(Time.since(comment.added)).attr("title", Time.date(comment.added, "long"));

    // Modified timestamp
    if (comment.modified && comment.modified > comment.added) {
      $(".modified .date", elem).text(Time.since(comment.modified)).attr("title", Time.date(comment.modified));
      $(".modified", elem).css("display", "");
    } else {
      $(".modified", elem).css("display", "none");
    }

    // Asynchronously resolve xID name for display
    elem.data("xid-author", comment.user_address || "");
    if (comment.user_address) {
      User.resolveXidName(comment.user_address, function(name, tld, avatar) {
        if (elem.data("xid-author") !== comment.user_address) return;
        if (name) $(".user_name", elem).text(name + "." + tld);
        User.showRowAvatar(elem, avatar);
      });
    } else {
      User.showRowAvatar(elem, "");
    }

    var comment_uri = elem.attr("id").replace("comment_", "");
    if (User.my_comment_votes[comment_uri]) { // Voted on it
      $(".score-inactive .score-num", elem).text(comment.votes - 1);
      $(".score-active .score-num", elem).text(comment.votes);
      $(".score", elem).addClass("active");
    } else { // Not voted on it
      $(".score-inactive .score-num", elem).text(comment.votes);
      $(".score-active .score-num", elem).text(comment.votes + 1);
    }

    // Reported comment indicator
    var comment_uri_full = comment.comment_id + "_" + comment.user_address;
    if (Moderation.isReported("comment", comment_uri_full)) {
      elem.addClass("comment-reported");
      if (!Moderation.isMod()) {
        elem.addClass("comment-hidden");
      }
    } else {
      elem.removeClass("comment-reported comment-hidden");
    }

    // My comment
    var user_dir = Page.site_info.xid_directory || Page.site_info.auth_address;
    if (comment.user_address === user_dir) {
      $(elem).attr("data-object", "Comment:" + comment_uri + "@" + this.topic_uri).attr("data-deletable", "yes");
      $(".body", elem).attr("data-editable", "body").data("content", comment.body);
    }
  }

  buttonReply(elem) {
    this.log("Reply to", elem);
    var user_name = $(".user_name", elem).text();
    var post_id = elem.attr("id");
    var body_add = "> [" + user_name + "](#" + post_id + "): ";
    var elem_quote = $(".body", elem).clone();
    $("blockquote", elem_quote).remove(); // Remove other people's quotes
    var selected_text = window.getSelection().toString();
    if (selected_text) {
      body_add += selected_text;
    } else {
      body_add += elem_quote.text().trim("\n").replace(/\n[\s\S]+/g, " [...]");
    }
    body_add += "\n\n";

    MarkdownEditor.appendToComment(body_add);

    return false;
  }

  submitComment() {
    if (!User.requireXid(() => this.submitComment())) {
      return false;
    }
    if (!this.follow.feeds["Comments in this topic"][1].hasClass("selected")) {
      this.follow.feeds["Comments in this topic"][1].trigger("click");
    }
    var body = $(".comment-new #comment_body").val().trim();
    if (!body) {
      $(".comment-new #comment_body").focus();
      return;
    }

    $(".comment-new .button-submit").addClass("loading");

    // A new comment is a fresh signed record in comments.json. comment_id stays
    // the stable app id used in the comment_uri (votes/reports/permalinks); the
    // node derives a separate immutable CRDT post_id from the record's nonce.
    User.createRecord("comments", {
      "comment_id": Date.now(),
      "topic_uri": this.topic_uri,
      "body": body,
      "added": Time.timestamp()
    }, (res) => {
      $(".comment-new .button-submit").removeClass("loading");
      if (res) {
        this.log("File written");
        this.loadComments();
        $(".comment-new #comment_body").val("").delay(600).animate({"height": 72}, {"duration": 1000, "easing": "easeInOutCubic"});
      }
    });
  }

  submitCommentVote(e) {
    if (!User.requireXid(() => this.submitCommentVote(e))) {
      return false;
    }

    var elem = $(e.currentTarget);
    elem.toggleClass("active").addClass("loading");
    var comment_uri = elem.attr("id").match("_([0-9]+_[A-Za-z0-9.]+)$")[1];
    // A vote is a keyed record in comment_votes.json (key = comment_uri): voting
    // is a live record, un-voting a signed tombstone for the same key.
    var voting = elem.hasClass("active");
    User.editRecord("comment_votes", comment_uri, {"comment_uri": comment_uri, "added": Math.floor(Date.now() / 1000)}, !voting, function(res) {
      elem.removeClass("loading");
      if (res) {
        if (voting) User.my_comment_votes[comment_uri] = true;
        else delete User.my_comment_votes[comment_uri];
      } else {
        elem.toggleClass("active"); // revert optimistic toggle on failure
      }
    });
    return false;
  }
}

Object.assign(TopicShow.prototype, LogMixin);
window.TopicShow = new TopicShow();
})();
