/* Home page: the progress rail follows the stage in view. */
(function () {
  "use strict";
  var marks = document.querySelectorAll(".rail-marks li");
  var stages = document.querySelectorAll(".rail-stages .stage");
  if (!marks.length || !stages.length || !("IntersectionObserver" in window)) return;

  function setActive(n) {
    marks.forEach(function (m) {
      var on = m.getAttribute("data-stage") === n;
      m.classList.toggle("is-active", on);
      var idx = parseInt(m.getAttribute("data-stage"), 10);
      m.classList.toggle("is-done", idx < parseInt(n, 10));
    });
    stages.forEach(function (s) { s.classList.toggle("is-active", s.getAttribute("data-stage") === n); });
  }
  setActive("1");

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) setActive(en.target.getAttribute("data-stage"));
    });
  }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
  stages.forEach(function (s) { observer.observe(s); });
})();
