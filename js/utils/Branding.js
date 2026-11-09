(function() {
class Branding {
  defaults() {
    return { title: "Epix Talk", logo: "img/logo.svg", accent: { lightness: 0.73, chroma: 0.12, hue: 200 } };
  }

  normalize(value) {
    var defaults = this.defaults();
    value = value && typeof value === "object" ? value : {};
    var accent = value.accent || {};
    var number = (key, min, max) => Number.isFinite(accent[key]) ? Math.max(min, Math.min(max, accent[key])) : defaults.accent[key];
    return {
      title: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 80) : defaults.title,
      logo: this.validLogo(value.logo) ? value.logo : defaults.logo,
      accent: { lightness: number("lightness", 0.35, 0.9), chroma: number("chroma", 0, 0.3), hue: number("hue", 0, 360) }
    };
  }

  validLogo(value) {
    if (typeof value !== "string" || value.length > 180000) return false;
    if (/^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(value)) return true;
    if (/^https:\/\//i.test(value)) {
      try { var url = new URL(value); return !!url.hostname && !url.username && !url.password; } catch (e) { return false; }
    }
    return /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(svg|png|jpe?g|webp|gif)$/i.test(value);
  }

  // OKLCH is OKLab expressed as lightness, chroma and hue. Reduce chroma
  // until the color fits sRGB, preserving perceptual lightness across hues.
  color(lightness, chroma, hue) {
    var radians = hue * Math.PI / 180;
    var rgb = c => {
      var a = c * Math.cos(radians), b = c * Math.sin(radians);
      var l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
      var m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
      var s = Math.pow(lightness - 0.0894841775 * a - 1.2914855480 * b, 3);
      return [4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
        -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
        -0.0041960863*l - 0.7034186147*m + 1.7076147010*s];
    };
    var fits = c => rgb(c).every(channel => channel >= 0 && channel <= 1);
    var low = 0, high = chroma;
    if (!fits(chroma)) {
      for (var i = 0; i < 24; i++) {
        var mid = (low + high) / 2;
        if (fits(mid)) low = mid; else high = mid;
      }
      chroma = low;
    }
    var channels = rgb(chroma);
    var luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    return { css: `oklch(${lightness} ${chroma} ${hue})`, channels, lightness, chroma,
      ink: luminance > 0.179 ? "#000000" : "#ffffff" };
  }

  setTitle(section) {
    this.section = section || "";
    var title = (this.current || this.defaults()).title;
    var full = this.section ? this.section + " - " + title : title;
    document.title = full;
    Page.cmd("wrapperSetTitle", full);
  }

  apply(value) {
    this.current = this.normalize(value);
    $(".logo-title, .loading-title").text(this.current.title);
    $(".head .logo img, .loading-logo").each((i, image) => {
      if (image.getAttribute("src") !== this.current.logo) {
        image.onerror = () => { image.onerror = null; image.src = "img/logo.svg"; };
        image.setAttribute("src", this.current.logo);
      }
    });
    var accent = this.current.accent;
    var fill = this.color(accent.lightness, accent.chroma, accent.hue);
    var style = document.body.style;
    // Keep the existing theme unchanged until an admin saves branding.
    document.body.classList.toggle("has-branding", !!value);
    style.setProperty("--branding-accent", fill.css);
    style.setProperty("--branding-ink", fill.ink);
    style.setProperty("--branding-link-light", this.color(0.46, accent.chroma, accent.hue).css);
    style.setProperty("--branding-link-dark", this.color(0.8, accent.chroma, accent.hue).css);
    this.setTitle(this.section);
  }

  readForm() {
    var title = $(".admin-branding-title").val().trim();
    var logo = $(".admin-branding-logo").val().trim() || this.defaults().logo;
    if (!title || title.length > 80) throw new Error("Enter a title between 1 and 80 characters.");
    if (!this.validLogo(logo)) throw new Error("Use an HTTPS image URL, a local image path, or upload an image.");
    return this.normalize({ title, logo, accent: {
      lightness: Number($(".admin-branding-lightness").val()) / 100,
      chroma: Number($(".admin-branding-chroma").val()) / 100,
      hue: Number($(".admin-branding-hue").val())
    } });
  }

  preview() {
    try {
      var value = this.readForm(), accent = value.accent;
      var fill = this.color(accent.lightness, accent.chroma, accent.hue);
      $(".admin-branding-preview-title").text(value.title);
      $(".admin-branding-preview img").attr("src", value.logo);
      $(".admin-branding-swatch").css({ background: fill.css, color: fill.ink });
      $(".admin-branding-values").text(`Hue ${accent.hue}° · Lightness ${Math.round(accent.lightness * 100)}% · Chroma ${accent.chroma.toFixed(2)}`);
      $(".admin-branding-status").text("");
    } catch (error) { $(".admin-branding-status").text(error.message); }
  }

  initAdmin() {
    var value = this.normalize(Moderation.admin_settings.branding);
    $(".admin-branding-title").val(value.title);
    $(".admin-branding-logo").val(value.logo);
    $(".admin-branding-hue").val(value.accent.hue);
    $(".admin-branding-lightness").val(value.accent.lightness * 100);
    $(".admin-branding-chroma").val(value.accent.chroma * 100);
    $(".admin-branding input").off("input.branding").on("input.branding", () => this.preview());
    $(".admin-branding-file").off("change.branding").on("change.branding", event => {
      var file = event.target.files[0];
      if (!file) return;
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 128 * 1024) {
        $(".admin-branding-status").text("Choose a PNG, JPEG, WebP or GIF up to 128 KB.");
        return;
      }
      var reader = new FileReader();
      reader.onload = () => { $(".admin-branding-logo").val(reader.result); this.preview(); };
      reader.onerror = () => $(".admin-branding-status").text("Could not read the image.");
      reader.readAsDataURL(file);
    });
    $(".admin-branding-form").off("submit.branding").on("submit.branding", event => {
      event.preventDefault();
      this.save();
    });
    this.preview();
  }

  save() {
    if (!Moderation.isAdmin() || this.saving) return;
    var value;
    try { value = this.readForm(); }
    catch (error) { $(".admin-branding-status").text(error.message); return; }
    this.saving = true;
    $(".admin-branding-save").prop("disabled", true).addClass("loading");
    $(".admin-branding-status").text("Saving...");
    Admin.updateAdminSettings(data => { data.branding = value; return true; }, success => {
      this.saving = false;
      $(".admin-branding-save").prop("disabled", false).removeClass("loading");
      if (success) this.apply(value);
      $(".admin-branding-status").text(success ? "Branding saved and published." : "Could not publish branding. Your changes are ready to retry.");
    });
  }
}
window.Branding = new Branding();
})();
