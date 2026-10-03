(function () {
  "use strict";

  // Site settings. FORM_ENDPOINT takes a Formspree form URL; until it
  // is set, the contact form opens the visitor's email app instead.
  var SITE = {
    email: "nadaveron@gmail.com",
    whatsapp: "https://chat.whatsapp.com/GjGj4pwP7kKLCDzW4AS8f1",
    FORM_ENDPOINT: ""
  };

  // Third-party players (YouTube, Spotify) are blocked inside sandboxed
  // previews, so there the cards stay as plain links.
  var EMBEDS = !/(^|\.)claude\.ai$|claudeusercontent|anthropic/.test(location.hostname);

  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function gigRow(g, past) {
    var p = g.date.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var dateBox = el("div", { class: "gig-date" }, [
      el("span", { class: "day", text: String(+p[2]) }),
      el("span", { class: "my", text: MONTHS[+p[1] - 1] + " " + p[0] })
    ]);
    var where = [g.venue, g.city].filter(Boolean).join(", ");
    var when = WEEKDAYS[d.getDay()] + (g.time ? " · " + g.time : "");
    var main = el("div", { class: "gig-main" }, [
      g.project && g.project !== g.title ? el("span", { class: "project", text: g.project.toLowerCase() }) : null,
      el("h3", { text: g.title }),
      (past ? where : when + (where ? " · " + where : "")) ? el("span", { class: "where", text: (past ? where : when + (where ? " · " + where : "")) }) : null,
      g.note ? el("span", { class: "where", text: g.note }) : null
    ]);
    var act = null;
    if (!past) {
      act = g.tickets
        ? el("a", { class: "btn", href: g.tickets, target: "_blank", rel: "noopener", text: "tickets" })
        : el("a", { class: "btn ghost", href: SITE.whatsapp, target: "_blank", rel: "noopener", text: "get updates" });
    }
    return el("article", { class: "gig" + (past ? " past" : "") }, [dateBox, main, act ? el("div", { class: "gig-act" }, [act]) : null]);
  }

  function renderConcerts() {
    var all = (window.CONCERTS || []).slice();
    var today = todayISO();
    var upcoming = all.filter(function (g) { return g.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var past = all.filter(function (g) { return g.date < today; }).sort(function (a, b) { return a.date > b.date ? -1 : 1; });

    document.querySelectorAll("[data-concerts]").forEach(function (box) {
      var kind = box.getAttribute("data-concerts");
      var limit = +box.getAttribute("data-limit") || 999;
      var list = (kind === "past" ? past : upcoming).slice(0, limit);
      box.textContent = "";
      if (!list.length) {
        box.appendChild(el("div", { class: "gigs-empty" }, [
          el("p", { text: kind === "past" ? "No past shows listed yet." : "New dates are on the way. Join the WhatsApp group to hear about them first." }),
          kind === "past" ? null : el("a", { class: "btn ghost", href: SITE.whatsapp, target: "_blank", rel: "noopener", text: "join the whatsapp group" })
        ]));
        return;
      }
      list.forEach(function (g) { box.appendChild(gigRow(g, kind === "past")); });
    });

    // Structured data so upcoming shows can appear in Google's event results.
    if (upcoming.length && document.querySelector("[data-concerts='upcoming']")) {
      var ld = upcoming.map(function (g) {
        return {
          "@context": "https://schema.org", "@type": "MusicEvent",
          name: g.title, startDate: g.date + (g.time ? "T" + g.time : ""),
          eventStatus: "https://schema.org/EventScheduled",
          location: { "@type": "Place", name: g.venue || g.city, address: g.city },
          performer: { "@type": "Person", name: "Nadav Friedman" },
          url: g.tickets || location.href
        };
      });
      var s = document.createElement("script");
      s.type = "application/ld+json";
      s.textContent = JSON.stringify(ld);
      document.head.appendChild(s);
    }
  }

  function initVideos() {
    if (!EMBEDS) return;
    document.querySelectorAll("a.video[data-yt]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var frame = a.querySelector(".frame");
        if (frame.querySelector("iframe")) return;
        var f = document.createElement("iframe");
        f.src = "https://www.youtube-nocookie.com/embed/" + a.getAttribute("data-yt") + "?autoplay=1&rel=0";
        f.title = a.querySelector(".t").textContent;
        f.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture";
        f.allowFullscreen = true;
        frame.appendChild(f);
      });
    });
  }

  function initSpotify() {
    if (!EMBEDS) return;
    document.querySelectorAll("[data-spotify]").forEach(function (slot) {
      var f = document.createElement("iframe");
      f.src = "https://open.spotify.com/embed/" + slot.getAttribute("data-spotify") + "?theme=0";
      f.height = slot.getAttribute("data-height") || "352";
      f.loading = "lazy";
      f.title = slot.getAttribute("data-title") || "Spotify player";
      f.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
      slot.textContent = "";
      slot.classList.add("loaded");
      slot.appendChild(f);
    });
  }

  function initCopy() {
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.getAttribute("data-copy"));
        var text = target ? target.innerText.trim() : "";
        var done = function () { var t = btn.textContent; btn.textContent = "copied"; setTimeout(function () { btn.textContent = t; }, 1600); };
        var fallback = function () {
          var r = document.createRange(); r.selectNodeContents(target);
          var s = getSelection(); s.removeAllRanges(); s.addRange(r);
          btn.textContent = "selected, press ctrl+c";
        };
        try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
      });
    });
  }

  function initForm() {
    var form = document.getElementById("contact-form");
    if (!form) return;
    var status = document.getElementById("form-status");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var data = Object.fromEntries(new FormData(form).entries());
      if (SITE.FORM_ENDPOINT) {
        status.className = "form-status"; status.textContent = "Sending…";
        fetch(SITE.FORM_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) })
          .then(function (r) { if (!r.ok) throw new Error(r.status); form.reset(); status.className = "form-status ok"; status.textContent = "Thanks, your message reached Nadav. He usually answers within a few days."; })
          .catch(function () { status.className = "form-status"; status.textContent = "The message didn't go through. Please email " + SITE.email + " directly."; });
        return;
      }
      var subject = "[" + data.topic + "] " + data.name;
      var body = data.message + "\n\n" + data.name + (data.email ? " · " + data.email : "");
      location.href = "mailto:" + SITE.email + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      status.className = "form-status";
      status.textContent = "Your email app should open with the message ready. If it doesn't, write to " + SITE.email + ".";
    });
  }

  function initYear() {
    document.querySelectorAll("[data-year]").forEach(function (n) { n.textContent = new Date().getFullYear(); });
  }

  function start() {
    renderConcerts(); initVideos(); initSpotify(); initCopy(); initForm(); initYear();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
