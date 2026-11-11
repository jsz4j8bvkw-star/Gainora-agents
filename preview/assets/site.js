// Alder Ease Aesthetics: menu, gentle fade-up, the moving hero, and the enquiry form check.
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

  // Hero: Mirela's walk in through the door, and her photos.
  // Wide screens: the walk loops on the left, and each time it reaches the reception the photo on the right changes.
  // Phones: one frame. The walk plays, then the three photos one by one, then the walk again.
  // The crop follows the room and then the logo. Nothing moves for people who ask for less motion, and there is a pause button.
  var hero = document.querySelector('[data-hero]');
  var video = hero && hero.querySelector('video');
  if (video) {
    var slides = [].slice.call(hero.querySelectorAll('.hero-shots .slide'));
    var walkTag = hero.querySelector('.walk-tag');
    var pauseBtn = hero.querySelector('.hero-pause');
    var narrow = window.matchMedia('(max-width: 600px)');
    // Where the interesting part of the picture is (0 = left edge, 1 = right edge) at each second of the video.
    var AIM = [[0, 0.32], [0.6, 0.36], [1.2, 0.48], [1.8, 0.66], [2.4, 0.76], [2.9, 0.74], [3.4, 0.62], [3.9, 0.56], [6, 0.55]];
    var shot = 0, phase = 'walk', timer = 0, raf = 0, paused = false, away = false, canPlay = true, pos = -1;

    var aimAt = function (t) {
      for (var k = 1; k < AIM.length; k++) {
        if (t <= AIM[k][0]) { var a = AIM[k - 1], b = AIM[k], u = (t - a[0]) / (b[0] - a[0]); u = u * u * (3 - 2 * u); return a[1] + (b[1] - a[1]) * u; }
      }
      return AIM[AIM.length - 1][1];
    };
    var steer = function (t, snap) {
      var w = video.clientWidth, h = video.clientHeight;
      if (!w || !h) return;
      var sw = h * 16 / 9, spare = sw - w;
      var target = spare > 0 ? Math.min(1, Math.max(0, (aimAt(t) * sw - w / 2) / spare)) : 0.5;
      pos = (snap || pos < 0) ? target : pos + (target - pos) * 0.08;
      video.style.objectPosition = (pos * 100).toFixed(2) + '% 50%';
    };
    var show = function (i) {
      slides.forEach(function (s, k) {
        if (k === i) { s.classList.remove('off'); s.classList.add('on'); }
        else if (s.classList.contains('on')) {
          s.classList.remove('on'); s.classList.add('off');
          setTimeout(function () { s.classList.remove('off'); }, 1800);
        }
      });
    };
    var nextShot = function () { shot = (shot + 1) % slides.length; show(shot); };
    var play = function () {
      if (paused || away || phase !== 'walk' || !canPlay) return;
      var p = video.play();
      if (p && p.catch) p.catch(function (err) { if (err && (err.name === 'NotAllowedError' || err.name === 'NotSupportedError')) fallback(); });
    };
    // Phones: after the walk, the photos come up one by one, then fade away for the walk again.
    var storyShots = function () {
      phase = 'shots'; hero.classList.add('shots-up');
      var shown = 1;
      var step = function () {
        if (paused || away) { timer = setTimeout(step, 600); return; }
        if (shown < slides.length) { nextShot(); shown++; timer = setTimeout(step, 4200); return; }
        hero.classList.remove('shots-up');
        setTimeout(function () { shot = 0; show(0); }, 1500);
        walk();
      };
      timer = setTimeout(step, 4200);
    };
    var walk = function () {
      phase = 'walk';
      if (canPlay) { video.currentTime = 0; play(); }
      else if (narrow.matches) timer = setTimeout(storyShots, 5000);
    };
    var setup = function () {
      clearTimeout(timer); hero.classList.remove('shots-up');
      if (!canPlay && !narrow.matches) {
        var idle = function () { if (!paused && !away) nextShot(); timer = setTimeout(idle, 6500); };
        timer = setTimeout(idle, 6500);
        phase = 'walk'; steer(4.6, true);
        return;
      }
      walk();
    };
    // If the video can't play (for example in battery saver), keep the still of the reception and change the photos on a timer.
    var fallback = function () {
      if (!canPlay) return;
      canPlay = false; video.pause(); steer(4.6, true);
      if (walkTag) walkTag.classList.remove('on');
      setup();
    };
    var tick = function () {
      if (away) { raf = 0; return; }
      if (canPlay) {
        steer(video.currentTime, false);
        if (walkTag) walkTag.classList.toggle('on', phase === 'walk' && video.currentTime > 0.5 && video.currentTime < 3);
      }
      raf = requestAnimationFrame(tick);
    };

    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm) {
      steer(4.6, true);
    } else {
      video.muted = true;
      video.addEventListener('ended', function () {
        if (narrow.matches) { storyShots(); return; }
        nextShot(); video.currentTime = 0; play();
      });
      video.addEventListener('error', fallback, true);
      if (pauseBtn) {
        pauseBtn.hidden = false;
        pauseBtn.addEventListener('click', function () {
          paused = !paused;
          pauseBtn.setAttribute('aria-pressed', String(paused));
          pauseBtn.firstChild.textContent = paused ? 'Play the moving pictures' : 'Pause the moving pictures';
          hero.classList.toggle('paused', paused);
          if (paused) video.pause(); else play();
        });
      }
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          away = !entries[0].isIntersecting;
          if (away) video.pause();
          else { play(); if (!raf) raf = requestAnimationFrame(tick); }
        }).observe(hero);
      }
      if (narrow.addEventListener) narrow.addEventListener('change', setup); else if (narrow.addListener) narrow.addListener(setup);
      steer(0, true);
      setup();
      raf = requestAnimationFrame(tick);
    }
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
