(function() {
var active_editor = null;
var transition_timers = [];

function resetTransitions() {
  transition_timers.forEach(clearTimeout);
  transition_timers = [];
}

function afterTransition(callback, delay) {
  transition_timers.push(setTimeout(callback, delay));
}

class InlineEditor {
  constructor(elem, getContent, saveContent, getObject) {
    this.elem = elem;
    this.getContent = getContent;
    this.saveContent = saveContent;
    this.getObject = getObject;
    this.edit_button = $("<a href='#Edit' class='editable-edit icon-edit'></a>");
    this.edit_button.on("click", () => this.startEdit());
    this.elem.addClass("editable").before(this.edit_button);
    this.editor = null;
    this.content_before = null;

    this.elem.on("mouseenter", (e) => {
      this.edit_button.css("opacity", "0.4");
      // Keep in display
      var scrolltop = $(window).scrollTop();
      var top = this.edit_button.offset().top - parseInt(this.edit_button.css("margin-top"));
      if (scrolltop > top) {
        this.edit_button.css("margin-top", scrolltop - top + e.clientY - 20);
      } else {
        this.edit_button.css("margin-top", "");
      }
    });
    this.elem.on("mouseleave", () => {
      this.edit_button.css("opacity", "");
    });

    if (this.elem.is(":hover")) this.elem.trigger("mouseenter");
  }

  startEdit() {
    // A confirmed deletion can finish after the user cancels editing. Do not
    // accept another draft on that object while its removal is pending.
    if (this.getObject(this.elem).data("delete-pending")) return false;
    // The shared toolbar belongs to one editor at a time. Keep its draft if
    // another menu or repeated click asks to start editing again.
    if (active_editor) {
      active_editor.editor.focus();
      return false;
    }
    resetTransitions();
    active_editor = this;
    this.content_before = this.elem.html(); // Save current to restore on cancel

    this.editor = $("<textarea class='editor'></textarea>");
    this.editor.val(this.getContent(this.elem, "raw"));
    this.elem.after(this.editor);
    $(".editbg").css("display", "block");
    afterTransition(() => $(".editbg").css("opacity", 0.9), 10);
    this.elem.html(Array.from({length: 50}, (_, i) => i + 1).join("fill the width")); // To make sure we span the editor as far as we can
    this.copyStyle(this.elem, this.editor); // Copy elem style to editor
    this.elem.html(this.content_before); // Restore content

    this.autoExpand(this.editor); // Set editor to autoexpand
    this.elem.css("display", "none"); // Hide elem

    if ($(window).scrollTop() === 0) { // Focus textfield if scroll on top
      this.editor[0].selectionEnd = 0;
      this.editor.focus();
    }

    $(".editable-edit").css("display", "none"); // Hide all edit button until its not finished

    $(".editbar").css("display", "inline-block");
    afterTransition(() => $(".editbar").addClass("visible"), 10);
    $(".publishbar").css("opacity", 0); // Hide publishbar
    $(".editbar .object").text(this.getObject(this.elem).data("object") + "." + this.elem.data("editable"));
    $(".editbar .button").removeClass("loading");

    $(".editbar .save").off("click").on("click", () => this.saveEdit());
    $(".editbar .delete").off("click").on("click", () => this.deleteObject());
    $(".editbar .cancel").off("click").on("click", () => this.cancelEdit());

    // Deletable button show/hide
    if (this.getObject(this.elem).data("deletable")) {
      $(".editbar .delete").css("display", "").html("Delete " + this.getObject(this.elem).data("object").split(":")[0]);
    } else {
      $(".editbar .delete").css("display", "none");
    }

    window.onbeforeunload = function() {
      return 'Your unsaved blog changes will be lost!';
    };

    return false;
  }

  stopEdit() {
    if (active_editor !== this) return;
    resetTransitions();
    active_editor = null;
    if (this.editor) {
      this.editor.remove();
    }
    this.editor = null;
    this.elem.css("display", "");
    $(".editbg").css("opacity", 0);
    afterTransition(() => $(".editbg").css("display", "none"), 300);

    $(".editable-edit").css("display", ""); // Show edit buttons

    $(".editbar").removeClass("visible"); // Hide editbar
    afterTransition(() => $(".editbar").css("display", "none"), 1000);
    $(".publishbar").css("opacity", 1); // Show publishbar

    window.onbeforeunload = null;
  }

  saveEdit() {
    if (!this.editor || this.saving) return false;
    var editor = this.editor;
    var content = editor.val();
    this.saving = true;
    $(".editbar .save").addClass("loading");
    this.saveContent(this.elem, content, (content_html) => {
      this.saving = false;
      // A delayed save must not close an editor opened after canceling it.
      if (this.editor !== editor) return;
      if (content_html) { // File write ok
        $(".editbar .save").removeClass("loading");
        this.stopEdit();
        if (typeof content_html === "string") { // Returned the new content
          this.elem.html(content_html);
        }
        $('pre code').each(function(i, block) { // Highlight code blocks
          hljs.highlightBlock(block);
        });
      } else {
        $(".editbar .save").removeClass("loading");
      }
    });
    return false;
  }

  deleteObject() {
    var object = this.getObject(this.elem);
    if (object.data("delete-pending")) return false;
    object.data("delete-pending", true);
    var editor = this.editor;
    var object_type = object.data("object").split(":")[0];
    Page.cmd("wrapperConfirm", ["Are you sure you want to delete this " + object_type + "?", "Delete"], (confirmed) => {
      if (!confirmed) {
        object.removeData("delete-pending");
        return;
      }
      if (active_editor === this) $(".editbar .delete").addClass("loading");
      Page.saveContent(object, null, (saved) => {
        if (!saved) object.removeData("delete-pending");
        if (this.editor !== editor) return;
        if (active_editor === this) $(".editbar .delete").removeClass("loading");
        if (saved) this.stopEdit();
      });
    });
    return false;
  }

  cancelEdit() {
    this.stopEdit();
    this.elem.html(this.content_before);

    $('pre code').each(function(i, block) { // Highlight code blocks
      hljs.highlightBlock(block);
    });

    return false;
  }

  copyStyle(elem_from, elem_to) {
    elem_to.addClass(elem_from[0].className);
    var from_style = getComputedStyle(elem_from[0]);

    elem_to.css({
      fontFamily: from_style.fontFamily,
      fontSize: from_style.fontSize,
      fontWeight: from_style.fontWeight,
      marginTop: from_style.marginTop,
      marginRight: from_style.marginRight,
      marginBottom: from_style.marginBottom,
      marginLeft: from_style.marginLeft,
      paddingTop: from_style.paddingTop,
      paddingRight: from_style.paddingRight,
      paddingBottom: from_style.paddingBottom,
      paddingLeft: from_style.paddingLeft,
      lineHeight: from_style.lineHeight,
      textAlign: from_style.textAlign,
      color: from_style.color,
      letterSpacing: from_style.letterSpacing
    });

    if (elem_from.innerWidth() < 1000) { // inline elems fix
      elem_to.css("minWidth", elem_from.innerWidth());
    }
  }

  autoExpand(elem) {
    var editor = elem[0];
    elem.height(1);
    elem.on("input", function() {
      if (editor.scrollHeight > elem.height()) {
        elem.height(1).height(editor.scrollHeight + parseFloat(elem.css("borderTopWidth")) + parseFloat(elem.css("borderBottomWidth")));
      }
    });
    elem.trigger("input");

    // Tab key support
    elem.on("keydown", function(e) {
      if (e.which === 9) {
        e.preventDefault();
        var s = this.selectionStart;
        var val = elem.val();
        elem.val(val.substring(0, this.selectionStart) + "\t" + val.substring(this.selectionEnd));
        this.selectionEnd = s + 1;
      }
    });
  }
}

window.InlineEditor = InlineEditor;
})();
