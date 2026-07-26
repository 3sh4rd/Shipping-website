/* Meridian Imports — site scripts */
(function () {
  "use strict";

  /* Mobile nav toggle */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* Current year in footer */
  var yr = document.querySelector("[data-year]");
  if (yr) yr.textContent = new Date().getFullYear();

  /* Helper: field validation */
  function markInvalid(field, invalid) {
    if (!field) return;
    field.classList.toggle("invalid", invalid);
  }
  function emailValid(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  /* Shipment tracking demo */
  var trackForm = document.querySelector("#track-form");
  if (trackForm) {
    var out = document.querySelector("#track-result");
    trackForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = trackForm.querySelector("input[name=tracking]");
      var id = (input.value || "").trim();
      if (id.length < 4) {
        out.className = "result info show";
        out.innerHTML = "Please enter a valid tracking number (e.g. <strong>MI-4820-1177</strong>).";
        return;
      }
      // Deterministic demo status based on the tracking string
      var stages = [
        { title: "Order received", meta: "Booking confirmed" },
        { title: "Collected at origin", meta: "Warehouse scan" },
        { title: "In transit — ocean freight", meta: "Vessel departed" },
        { title: "Customs clearance", meta: "Destination port" },
        { title: "Out for delivery", meta: "Local courier" },
        { title: "Delivered", meta: "Signed for" }
      ];
      var sum = 0;
      for (var i = 0; i < id.length; i++) sum += id.charCodeAt(i);
      var current = sum % stages.length;
      var html = '<p class="mb-0"><strong>Shipment ' + id.toUpperCase() +
        '</strong> — status: <strong>' + stages[current].title + '</strong></p><ul class="timeline">';
      for (var j = 0; j < stages.length; j++) {
        var cls = j < current ? "done" : j === current ? "active" : "";
        html += '<li class="' + cls + '"><span class="t-title">' + stages[j].title +
          '</span><br><span class="t-meta">' + stages[j].meta + "</span></li>";
      }
      html += "</ul>";
      out.className = "result info show";
      out.innerHTML = html;
    });
  }

  /* Generic form validation + fake submit (quote & contact) */
  function wireForm(sel, successMsg) {
    var form = document.querySelector(sel);
    if (!form) return;
    var result = form.querySelector(".result");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ok = true;
      var required = form.querySelectorAll("[required]");
      required.forEach(function (el) {
        var field = el.closest(".field");
        var empty = !el.value.trim();
        var badEmail = el.type === "email" && el.value && !emailValid(el.value);
        var invalid = empty || badEmail;
        markInvalid(field, invalid);
        if (invalid) ok = false;
      });
      if (!ok) {
        if (result) {
          result.className = "result info show";
          result.textContent = "Please complete the highlighted fields.";
        }
        return;
      }
      form.reset();
      if (result) {
        result.className = "result ok show";
        result.textContent = successMsg;
      }
    });
    // clear error on input
    form.addEventListener("input", function (e) {
      var field = e.target.closest(".field");
      if (field) markInvalid(field, false);
    });
  }

  wireForm("#quote-form", "Thanks! Your quote request has been received. Our team will email you within one business day.");
  wireForm("#contact-form", "Thanks for reaching out — we'll get back to you within one business day.");
})();
