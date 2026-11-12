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
