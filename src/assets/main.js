/* Site behaviour: mobile navigation and form handling. No dependencies. */
(function () {
  "use strict";

  /* ---------- Mobile navigation ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    var label = toggle.querySelector(".nav-toggle-label");
    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
      document.body.classList.toggle("nav-open", open);
      if (label) label.textContent = open ? "Close" : "Menu";
    }
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        toggle.focus();
      }
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 1024) setOpen(false);
    });
  }

  /* ---------- Reveal on scroll (headings' accent lines, counted figures) ---------- */
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealables = document.querySelectorAll(".pkg-card, .stage, .principles-numbered li, .calc-card");
  if (revealables.length && "IntersectionObserver" in window && !reduceMotion) {
    document.documentElement.classList.add("has-reveal");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -10% 0px" });
    Array.prototype.forEach.call(revealables, function (el) { io.observe(el); });
  }

  /* ---------- Forms ---------- */
  var body = document.body;
  var provider = (body.getAttribute("data-form-provider") || "").toLowerCase();
  var endpoint = body.getAttribute("data-form-endpoint") || "";
  var contactEmail = body.getAttribute("data-contact-email") || "";
  var responseTime = body.getAttribute("data-response-time") || "";

  var messages = {
    valueMissing: "Please fill this in.",
    typeMismatchEmail: "Please enter a valid email address, like name@business.co.uk.",
    typeMismatchUrl: "Please enter the full address, starting with https://",
    tooShort: "Please add a little more detail.",
    tooLong: "This is a bit long. Please shorten it.",
    checkbox: "Please tick this box to continue.",
    select: "Please choose an option."
  };

  function errorFor(field) {
    var v = field.validity;
    if (v.valid) return "";
    if (field.type === "checkbox") return messages.checkbox;
    if (v.valueMissing) return field.tagName === "SELECT" ? messages.select : messages.valueMissing;
    if (v.typeMismatch) return field.type === "email" ? messages.typeMismatchEmail : messages.typeMismatchUrl;
    if (v.tooShort) return messages.tooShort;
    if (v.tooLong) return messages.tooLong;
    return messages.valueMissing;
  }

  function showError(field, text) {
    var id = field.getAttribute("aria-describedby");
    var slot = id ? document.getElementById(id) : null;
    if (slot) slot.textContent = text;
    if (text) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
  }

  function fallbackContact() {
    return contactEmail ? " You can also email us at " + contactEmail + "." : "";
  }

  function setStatus(form, text, isError) {
    var status = form.querySelector(".form-status");
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-error", !!isError);
  }

  function encode(form) {
    var data = new FormData(form);
    var pairs = [];
    data.forEach(function (value, key) {
      pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
    });
    return pairs.join("&");
  }

  function send(form) {
    if (provider === "netlify") {
      return fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encode(form)
      });
    }
    if (provider && endpoint) {
      // Formspree or any endpoint that accepts form posts and returns 2xx on success
      return fetch(endpoint, {
        method: "POST",
        headers: { "Accept": "application/json" },
        body: new FormData(form)
      });
    }
    return Promise.reject(new Error("not-configured"));
  }

  function showSuccess(form) {
    var box = document.createElement("div");
    box.className = "form-success";
    box.setAttribute("role", "status");
    box.setAttribute("tabindex", "-1");
    box.innerHTML =
      "<h2>Thank you. We've got your details.</h2>" +
      "<p>If you've booked a time, your calendar invitation is on its way and we'll have read this before the call. If you haven't picked a time yet, we'll reply " + escapeText(responseTime || "as soon as we can") + " with a few to choose from.</p>" +
      '<p><a class="text-link" href="/calculator/">Try the business improvement calculator while you wait</a></p>';
    form.replaceWith(box);
    box.focus();
  }

  function escapeText(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  Array.prototype.forEach.call(document.querySelectorAll("form.js-form"), function (form) {
    var fields = form.querySelectorAll("input:not([type=hidden]):not([name=bot-field]), select, textarea");

    Array.prototype.forEach.call(fields, function (field) {
      var evt = field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "blur";
      field.addEventListener(evt, function () { showError(field, errorFor(field)); });
      field.addEventListener("input", function () {
        if (field.getAttribute("aria-invalid") === "true") showError(field, errorFor(field));
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      setStatus(form, "", false);

      // Spam trap: humans never fill this field
      var trap = form.querySelector("[name=bot-field]");
      if (trap && trap.value) return;

      var firstInvalid = null;
      Array.prototype.forEach.call(fields, function (field) {
        var msg = errorFor(field);
        showError(field, msg);
        if (msg && !firstInvalid) firstInvalid = field;
      });
      if (firstInvalid) {
        setStatus(form, "Please check the highlighted fields.", true);
        firstInvalid.focus();
        return;
      }

      var button = form.querySelector("button[type=submit]");
      var original = button ? button.textContent : "";
      if (button) { button.disabled = true; button.textContent = "Sending…"; }

      send(form)
        .then(function (res) {
          if (!res.ok) throw new Error("status-" + res.status);
          showSuccess(form);
        })
        .catch(function (err) {
          var text = err && err.message === "not-configured"
            ? "This form isn't connected yet, so your message was not sent." + fallbackContact()
            : "Sorry, your message could not be sent. Please try again in a moment." + fallbackContact();
          setStatus(form, text, true);
          if (button) { button.disabled = false; button.textContent = original; }
        });
    });
  });
})();
