/* Book page: prefill from the address bar and require at least one enquiry channel. */
(function () {
  "use strict";
  var params = new URLSearchParams(window.location.search);

  function preselect(id, value) {
    var el = document.getElementById(id);
    if (!el || !value) return;
    for (var i = 0; i < el.options.length; i++) {
      if (el.options[i].value === value) { el.selectedIndex = i; return; }
    }
  }
  preselect("dx-package", params.get("package"));
  preselect("dx-type", params.get("type"));
  preselect("dx-size", params.get("size"));

  var source = document.getElementById("dx-source");
  if (source && params.get("from")) source.value = "website: " + params.get("from").slice(0, 60);

  // At least one channel must be ticked. The shared form script handles the other fields.
  var form = document.querySelector("form[name=diagnostic]");
  if (!form) return;
  var boxes = form.querySelectorAll("input[name=channels]");
  var error = document.getElementById("dx-channels-error");
  function channelsOk() { return Array.prototype.some.call(boxes, function (b) { return b.checked; }); }
  function showChannelError() {
    if (!error) return;
    error.textContent = channelsOk() ? "" : "Please tick at least one.";
  }
  Array.prototype.forEach.call(boxes, function (b) { b.addEventListener("change", showChannelError); });
  form.addEventListener("submit", function (e) {
    if (channelsOk()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    showChannelError();
    var status = form.querySelector(".form-status");
    if (status) { status.textContent = "Please tick how enquiries come in."; status.classList.add("is-error"); }
    if (boxes[0]) boxes[0].focus();
  }, true);

  // Mark step 2 as current once the visitor reaches the form
  var steps = document.querySelectorAll(".book-steps li");
  var details = document.getElementById("details");
  if (steps.length === 2 && details && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        steps[0].classList.toggle("is-current", !en.isIntersecting);
        steps[1].classList.toggle("is-current", en.isIntersecting);
      });
    }, { rootMargin: "-40% 0px -40% 0px" }).observe(details);
  }
})();
