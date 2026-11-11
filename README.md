# Alder Ease Aesthetics website

Built by Gainora for Mirela Borowska (Launch & Grow). Static HTML, CSS and a little JavaScript.

- `site/`: the live website (Netlify publishes this folder).
- `preview/`: a copy for showing before go-live (no tracking, form doesn't send, not indexed).
- `tools/build.py`: makes both. Edit facts there, then run
  `python3 tools/build.py site && python3 tools/build.py preview --preview` (copy `site/assets` into `preview/` first).

Facts come from Mirela's website questionnaire (10 Nov 2026). Left off on purpose: IV drips,
anything with a B12 injection. Before go-live: choose the domain, add canonical links and sitemap.xml,
set external.url in the admin and publish there so tracking and the form work.

Opening film (home page): `assets/film-wide.mp4` (computers) and `assets/film-tall.mp4` (phones), with start and end
stills. Made in Higgsfield (Seedance 2.5, 720p) from Mirela's walk-in video, using her real first frame (the door) and
last frame (the reception logo), then smoothed to 48 frames a second with a gentle slow-down onto the logo and a light
warm grade. It fills the first screen, plays once, stays on the logo, and the website slides up over it on scroll.
Originals are in Adelin's Downloads/alder-film.
