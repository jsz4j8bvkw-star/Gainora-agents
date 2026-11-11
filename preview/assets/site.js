// Alder Ease Aesthetics: menu, gentle fade-up, and the enquiry form check.
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('open', open);
    });
  }

  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });

  // Fade-up: only things still below the screen are hidden, and only when motion is welcome.
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calm && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('js-fade');
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.remove('pending'); seen.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) {
      if (el.getBoundingClientRect().top > window.innerHeight) { el.classList.add('pending'); seen.observe(el); }
    });
  }

  // Opening film: as the website slides up over it, it settles back a touch and dims; once covered it pauses.
  var film = document.getElementById('film');
  if (film) {
    var fv = film.querySelector('video');
    var html = document.documentElement;
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var ticking = false;
    var onScroll = function () {
      ticking = false;
      var p = Math.min(1, Math.max(0, window.scrollY / window.innerHeight));
      html.classList.toggle('film-view', p < 0.6);
      if (!still) {
        fv.style.transform = 'scale(' + (1 + 0.05 * p).toFixed(4) + ')';
        fv.style.filter = 'brightness(' + (1 - 0.35 * p).toFixed(3) + ')';
      }
      film.style.visibility = p >= 1 ? 'hidden' : '';
      if (p >= 1 && !fv.paused) { fv.pause(); film.dataset.wait = '1'; }
      else if (p < 1 && film.dataset.wait && !film.classList.contains('done')) { delete film.dataset.wait; fv.play().catch(function () {}); }
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();
    film.querySelector('.film-down').addEventListener('click', function (ev) {
      ev.preventDefault();
      window.scrollTo({ top: window.innerHeight, behavior: still ? 'auto' : 'smooth' });
    });
  }

  // Enquiry form: a name, and a phone number or an email.
  var form = document.querySelector('form[data-enquiry]');
  if (form) {
    var error = form.querySelector('.form-error');
    var preview = form.hasAttribute('data-preview');
    form.addEventListener('submit', function (ev) {
      var name = form.elements.name.value.trim();
      var phone = form.elements.phone.value.trim();
      var email = form.elements.email.value.trim();
      var problem = !name ? 'Please add your name.' : (!phone && !email) ? 'Please add a phone number or an email, so Mirela can reply.' :
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ? 'That email doesn’t look right. Please check it.' : '';
      if (problem) { ev.preventDefault(); error.textContent = problem; error.hidden = false; return; }
      if (preview) { ev.preventDefault(); error.textContent = 'This is a preview: the form starts sending once the website is live.'; error.hidden = false; }
    });
  }
})();
