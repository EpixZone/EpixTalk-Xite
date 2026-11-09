(function() {
class UserProfile {
  actionShow(user_address) {
    this.user_address = user_address;
    this.loadProfile();
    this.loadUserTopics();
    this.loadUserComments();
    Page.onPageLoaded();
  }

  loadProfile() {
    $(".profile-address").text(this.user_address).attr("title", this.user_address);
    $(".profile-name").text(Text.formatUsername(this.user_address));
    this.loadRole();
    var address = this.user_address;
    $(".profile-avatar").empty();
    // Determine if user_address is an xID name (contains dot) or a cosmos address
    var isXidName = this.user_address.indexOf(".") !== -1;
    var resolveCmd = isXidName ? "xidResolveName" : "xidResolve";
    Page.cmd(resolveCmd, [address], (result) => {
      if (this.user_address !== address) return;
      if (result?.name) {
        var display = result.name + "." + result.tld;
        $(".profile-name").text(display);
        if (window.Branding) Branding.setTitle(display);
        else Page.cmd("wrapperSetTitle", display + " - EpixTalk");
      } else {
        if (window.Branding) Branding.setTitle(Text.formatUsername(this.user_address));
        else Page.cmd("wrapperSetTitle", Text.formatUsername(this.user_address) + " - EpixTalk");
      }
      if (result?.avatar) {
        var container = $(".profile-avatar");
        var image = $('<img alt="">').appendTo(container);
        EpixAvatar.bind(image[0], result.avatar, parseFloat(container.css("width")) || 80);
      }
      if (result?.bio) {
        $(".profile-bio").text(result.bio);
      }
    });
  }

  loadRole() {
    var role_elem = $(".profile-role");
    role_elem.css("display", "none").removeClass("profile-role-owner profile-role-admin profile-role-mod");
    // Check if this user is the site owner
    if (this.user_address === Page.site_info?.address) {
      role_elem.text("Owner").addClass("profile-role-owner").css("display", "inline-block");
      return;
    }
    // Check admins from content.json settings
    var settings = Page.site_info?.content?.settings;
    var admins = settings?.admins || [];
    if (admins.includes(this.user_address)) {
      role_elem.text("Admin").addClass("profile-role-admin").css("display", "inline-block");
      return;
    }
    // Check mods from admin-settings.json
    var mods = Moderation.admin_settings?.mods || [];
    if (mods.includes(this.user_address)) {
      role_elem.text("Mod").addClass("profile-role-mod").css("display", "inline-block");
      return;
    }
  }

  loadUserTopics() {
    // Count
    Page.cmd("dbQuery", ["SELECT COUNT(*) AS cnt FROM topic LEFT JOIN json ON (json.json_id = topic.json_id) WHERE json.directory = '" + this.user_address + "'"], (res) => {
      var cnt = res?.[0]?.cnt || 0;
      $(".stat-topics").text(cnt + " topic" + (cnt !== 1 ? "s" : ""));
    });
    // Recent 20
    Page.cmd("dbQuery", ["SELECT topic.*, json.directory AS creator_address, topic.topic_id || '_' || json.directory AS row_topic_uri FROM topic LEFT JOIN json ON (json.json_id = topic.json_id) WHERE json.directory = '" + this.user_address + "' ORDER BY topic.added DESC LIMIT 20"], (topics) => {
      $(".profile-topics .profile-topic:not(.template)").remove();
      $(".profile-topics .profile-empty").remove();
      if (!topics || topics.length === 0) {
        $(".profile-topics").append("<div class='profile-empty'>No topics yet.</div>");
        return;
      }
      for (let topic of topics) {
        var elem = $(".profile-topics .profile-topic.template").clone().removeClass("template");
        $(".profile-topic-link", elem).text(topic.title).attr("href", "?Topic:" + topic.row_topic_uri + "/" + Text.toUrl(topic.title));
        $(".profile-topic-added", elem).text(Time.since(topic.added));
        elem.appendTo(".profile-topics");
      }
    });
  }

  loadUserComments() {
    // Count
    Page.cmd("dbQuery", ["SELECT COUNT(*) AS cnt FROM comment LEFT JOIN json ON (json.json_id = comment.json_id) WHERE json.directory = '" + this.user_address + "'"], (res) => {
      var cnt = res?.[0]?.cnt || 0;
      $(".stat-comments").text(cnt + " comment" + (cnt !== 1 ? "s" : ""));
    });
    // Recent 20 with topic title
    var query = `
      SELECT comment.*, json.directory AS user_address,
        topic_match.title AS topic_title, comment.topic_uri AS topic_uri
      FROM comment
      LEFT JOIN json ON (json.json_id = comment.json_id)
      LEFT JOIN (
        SELECT topic.topic_id, topic.title, topic.json_id,
          topic.topic_id || '_' || tj.directory AS full_uri
        FROM topic
        LEFT JOIN json AS tj ON (tj.json_id = topic.json_id)
      ) AS topic_match ON (topic_match.full_uri = comment.topic_uri)
      WHERE json.directory = '${this.user_address}'
      ORDER BY comment.added DESC LIMIT 20
    `;
    Page.cmd("dbQuery", [query], (comments) => {
      $(".profile-comments .profile-comment:not(.template)").remove();
      $(".profile-comments .profile-empty").remove();
      if (!comments || comments.length === 0) {
        $(".profile-comments").append("<div class='profile-empty'>No comments yet.</div>");
        return;
      }
      for (let comment of comments) {
        var elem = $(".profile-comments .profile-comment.template").clone().removeClass("template");
        if (comment.topic_title && comment.topic_uri) {
          $(".profile-comment-topic-link", elem).text("In: " + comment.topic_title).attr("href", "?Topic:" + comment.topic_uri + "/" + Text.toUrl(comment.topic_title));
        } else {
          $(".profile-comment-topic-link", elem).text("In: (unknown topic)");
        }
        var body = comment.body;
        // Strip username prefix (e.g. "jibz.epix:" or "@mud:")
        body = body.replace(/^(([a-zA-Z0-9.]+)@[a-zA-Z0-9.]+|@(.*?)):/, "");
        // Extract reply quote before stripping: > [user](#anchor): text
        var quoteMatch = body.match(/^[ ]*> \[([^\]]*)\](?:\([^)]*\))?[: ]*(.*)/m);
        if (quoteMatch && quoteMatch[2]) {
          var quoteUser = quoteMatch[1];
          var quoteText = quoteMatch[2].replace(/^\s+/, "").slice(0, 100);
          $(".profile-comment-reply", elem)
            .text(quoteUser + ": " + quoteText)
            .css("display", "");
        }
        // Strip reply quote lines
        body = body.replace(/^[ ]*>.*$/gm, "").trim();
        if (body.length > 200) body = body.substring(0, 200) + "...";
        $(".profile-comment-body", elem).html(Text.toMarked(body, {"sanitize": true}));
        $(".profile-comment-added", elem).text(Time.since(comment.added));
        elem.appendTo(".profile-comments");
      }
    });
  }
}

Object.assign(UserProfile.prototype, LogMixin);
window.UserProfile = new UserProfile();
})();
