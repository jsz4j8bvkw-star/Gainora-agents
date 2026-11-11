# Alder Ease Aesthetics website

Built by Gainora for Mirela Borowska (Launch & Grow). Static HTML, CSS and a little JavaScript.

- `site/`: the live website (Netlify publishes this folder).
- `preview/`: a copy for showing before go-live (no tracking, form doesn't send, not indexed).
- `tools/build.py`: makes both. Edit facts there, then run
  `python3 tools/build.py site && python3 tools/build.py preview --preview` (copy `site/assets` into `preview/` first).

Facts come from Mirela's website questionnaire (10 Nov 2026). Left off on purpose: IV drips,
anything with a B12 injection. Before go-live: choose the domain, add canonical links and sitemap.xml,
set external.url in the admin and publish there so tracking and the form work.

Hero: `assets/walk.mp4` (and `.webm`) is Mirela's walk-in video (sent 11 Nov 2026), cut to end on the reception logo,
slowed a little, coloured to match the photos, and faded in and out of the page's sand colour so it loops softly.
`assets/site.js` plays it and changes the photo beside it each time the walk ends (on phones: walk, then the photos).
