# Alder Ease Aesthetics website

Built by Gainora for Mirela Borowska (Launch & Grow). Static HTML, CSS and a little JavaScript.

- `site/`: the live website (Netlify publishes this folder).
- `preview/`: a copy for showing before go-live (no tracking, form doesn't send, not indexed).
- `tools/build.py`: makes both. Edit facts there, then run
  `python3 tools/build.py site && python3 tools/build.py preview --preview` (copy `site/assets` into `preview/` first).

Facts come from Mirela's website questionnaire (10 Nov 2026). Left off on purpose: IV drips,
anything with a B12 injection. Before go-live: choose the domain, add canonical links and sitemap.xml,
set external.url in the admin and publish there so tracking and the form work.

Opening film (home page): `assets/intro-wide.mp4` and `assets/intro-tall.mp4` are Mirela's walk-in video (sent 11 Nov 2026),
steadied, slowed a little, coloured to match the photos and ending on the reception logo. It plays full screen, then fades
into the website. Live: once per visit. Preview: every time. A tap skips it.
