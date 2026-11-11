#!/usr/bin/env python3
"""Builds the Alder Ease Aesthetics website (static HTML for Netlify).

    python3 build.py <out-dir>            production: clean links, tracking tag, live enquiry form
    python3 build.py <out-dir> --preview  preview copy: index.html links, no tracking, form doesn't send

Every fact comes from Mirela's website questionnaire (10 Nov 2026) and her admin draft. Left off on purpose:
IV drips and anything with a vitamin B12 injection (Gainora brief), nails, brows and lashes. Skin boosters added 11 Nov at Adelin's request.
"""
import html, json, os, sys

OUT = sys.argv[1]
PREVIEW = '--preview' in sys.argv

IMG = 'https://kuqdxaeilwpqeneblkyj.supabase.co/storage/v1/object/public/site-media/4ccd42a2-6f19-46e8-b1b0-b232589673e2/from-questions/70abda24-'
P = {k: f'{IMG}{v}.jpg' for k, v in {
    'logo': '4c94d2a0-6ad', 'lips1': '10eea723-073', 'lips2': '6625fe15-b26', 'lips3': '1ea7d16c-ea1', 'lips4': 'f031e182-783',
    'facial': 'ff79e7e0-fcc', 'hero1': 'd2c1c25f-2d0', 'hero2': '2c19ae4c-236', 'detail': '9d28a019-8df', 'needling': 'f51de20a-245',
    'prp': '18f673ad-7b8', 'prf': '7ed4167b-df3'}.items()}
# Sent by Mirela on 11 Nov 2026 (the clinic front), stored with her other photos.
P['front'] = f'{IMG}923f8795-08b.webp'
# Sent by Mirela on 11 Nov 2026: her portrait at the reception. The logo is hers, redrawn on warm beige instead of black.
P['me'] = f'{IMG}2f658043-831.webp'
P['logo'] = f'{IMG}7f0c6106-ad0.png'
# Sent by Mirela on 11 Nov 2026 for these treatments (her labels): Dermapen 4, skin booster, facial.
P['dermapen'] = f'{IMG}0aa33072-b93.webp'
P['booster'] = f'{IMG}d6c0d797-bdb.webp'
P['facial2'] = f'{IMG}51bb9e75-fa5.webp'
# Not used any more: 'facial' (white gloves, actually Dermapen; Adelin asked for it off the site) and 'hero1' (replaced by facial2).

SITE_ID = 'dc156330-3847-4ac1-8a43-1ec287f26412'
TRACK = f'<script src="https://app.gainora.co.uk/api/site-track/{SITE_ID}.js" defer></script>'
FORM_ACTION = f'https://app.gainora.co.uk/api/site-enquiry/{SITE_ID}'
BOOK = 'https://booksy.com/en-gb/190943_alder-ease-aesthetics_aesthetic-medicine_578086_crewe'
PHONE, PHONE_TEL = '07922 509893', '+447922509893'
EMAIL = 'aldereaseaesthetics@gmail.com'
INSTA = 'https://www.instagram.com/alderease_aesthetics/'
ADDRESS = ('167–169 Underwood Lane', 'Crewe', 'CW1 3SD')
MAPS = 'https://www.google.com/maps/search/?api=1&query=Alder+Ease+Aesthetics+167-169+Underwood+Lane+Crewe+CW1+3SD'
HOURS = [('Monday', None), ('Tuesday', '9am – 5pm'), ('Wednesday', '9am – 5pm'), ('Thursday', '9am – 5pm'), ('Friday', '9am – 5pm'), ('Saturday', '9am – 5pm'), ('Sunday', None)]

e = html.escape


def link(path):
    """Site-internal link. path like '' (home), 'treatments/', 'treatments/#prp'."""
    if not PREVIEW:
        return '/' + path
    base, _, frag = path.partition('#')
    return '__ROOT__' + (base + 'index.html' if base.endswith('/') or base == '' else base) + (('#' + frag) if frag else '')


# ---------- Treatments (prices and times exactly as Mirela gave them) ----------

TREATMENTS = [
    dict(id='consultation', name='Free consultation', img=None, lead='Where every new client starts.',
         text='A relaxed conversation about your skin, your goals and any worries. Mirela checks your medical history and suitability, and talks you through the options. If it’s appropriate, your treatment can follow on the same day.',
         rows=[('Consultation', '30 to 45 min', 'Free')]),
    dict(id='rf-microneedling', name='Radiofrequency microneedling', img='hero2',
         lead='Microneedling with radiofrequency energy, to work on firmness and texture.',
         text='Fine needles and radiofrequency energy are used together to encourage the skin’s own collagen and elastin. Chosen for skin firmness, fine lines, acne scarring, enlarged pores and uneven texture.',
         rows=[('Face', '60 min', '£170'), ('Face and neck', '80 min', '£220'), ('Face, neck and décolletage', '90 min', '£300'), ('Scar treatment', '40 min', '£150'), ('Body', '45 min', '£180')]),
    dict(id='dermapen', name='Dermapen 4 microneedling', img='dermapen',
         lead='Professional microneedling with serums chosen for your skin.',
         text='Dermapen 4 microneedling with tailored Meso-Glide serums. Chosen for skin texture, fine lines, acne scarring, pigmentation, enlarged pores and overall skin quality.',
         rows=[('Face', '60 min', '£150'), ('Face and neck', '70 min', '£180'), ('Face, neck and décolletage', '90 min', '£200'), ('Scar treatment', '60 min', 'From £100')]),
    dict(id='prp', name='PRP: platelet-rich plasma', img='prp',
         lead='A treatment prepared from your own blood.',
         text='Platelet-rich plasma is prepared from a small sample of your own blood and used to support the skin’s natural renewal, collagen and texture. On the scalp, it is used to support hair follicle health.',
         rows=[('Face', '60 min', '£200'), ('Face and neck', '60 min', '£220'), ('Face, neck and décolletage', '80 min', '£240'), ('Scalp (hair)', '60 min', '£220')]),
    dict(id='prf', name='PRF under-eye treatment', img='prf',
         lead='For the delicate skin under the eyes.',
         text='Platelet-rich fibrin, prepared from your own blood, is used under the eyes to support collagen and skin quality and soften the look of fine lines, for a natural-looking refresh.',
         rows=[('Under-eye', '60 min', '£150')]),
    dict(id='lip-filler', name='Lip filler', img='lips2',
         lead='Soft, natural-looking shape and volume.',
         text='Planned around your lips and the proportions of your face, after a consultation, using Revolax dermal filler. You’ll get written aftercare and can message Mirela with any questions afterwards. Over 18s only.',
         rows=[('Lip filler', '60 min', 'From £200'), ('Ultimate Lip & Skin Glow: lip filler with a deep-cleansing, hydrating facial', '1 hr 40 min', '£250')]),
    dict(id='skin-boosters', name='Skin boosters', img='booster',
         lead='Deep hydration for fresher, more radiant-looking skin.',
         text='Injectable skin boosters such as Profhilo, Seventy Hyal, Ejal 40, Neauvia Hydro Deluxe and Vitaran bring hydrating ingredients into the skin, to support hydration, texture and overall skin quality. Mirela recommends the right one for your skin at a free consultation. Over 18s only. A £50 deposit secures your appointment.',
         rows=[('Skin booster, chosen for your skin', 'At consultation', 'Price at consultation')]),
    dict(id='packages', name='Microneedling and PRP packages', img=None,
         lead='Two treatments combined in one appointment.',
         text='Microneedling or radiofrequency microneedling, combined with PRP in the same session, for skin texture, acne scarring and fine lines.',
         rows=[('RF microneedling and PRP', '90 min', '£250'), ('Microneedling and PRP', '75 min', '£200')]),
    dict(id='facials', name='Professional facials', img='facial2',
         lead='Deep cleansing, exfoliation and a fresh, bright finish.',
         text='Skin Glow combines ultrasonic cavitation peeling and oxybrasion for a deep cleanse and brighter complexion. Facial Rejuvenation pairs cavitation peeling with needle-free radiofrequency for firmer-looking skin. Smooth & Glow combines dermaplaning and oxybrasion to remove dead skin cells and fine facial hair.',
         rows=[('Skin Glow', '60 min', '£65'), ('Facial Rejuvenation', '60 min', '£75'), ('Smooth & Glow', '60 min', '£65')]),
    dict(id='dermomassage', name='Dermomassage body treatment', img=None,
         lead='Non-invasive vacuum massage for the body.',
         text='Vacuum massage to support circulation and lymphatic flow and improve the look of cellulite, for smoother, firmer-looking skin.',
         rows=[('Front of thighs', '50 min', '£50'), ('Back of thighs', '50 min', '£50'), ('Abdomen', '40 min', '£40')]),
    dict(id='lymphatic', name='Mechanical lymphatic drainage', img=None,
         lead='Gentle, sequential compression.',
         text='Pneumatic compression uses controlled, sequential pressure to support lymphatic circulation. Clients often choose it for feelings of heaviness or fluid retention. After surgery, or with a medical condition, suitability is checked at consultation first.',
         rows=[('Single session', '60 min', '£45'), ('Course of 6 sessions', '60 min each', '£240')]),
]
FEATURED = ['skin-boosters', 'lip-filler', 'prp', 'rf-microneedling', 'dermapen', 'prf']   # Mirela's priorities first
T = {t['id']: t for t in TREATMENTS}


def from_price(t):
    prices = [r[2] for r in t['rows']]
    if prices == ['Free']:
        return 'Free'
    nums = [int(''.join(c for c in p if c.isdigit())) for p in prices if any(c.isdigit() for c in p)]
    if not nums:
        return prices[0]
    return f'From £{min(nums)}' if len(prices) > 1 or prices[0].startswith('From') else prices[0]


REASONS = [
    ('Time for you', 'Appointments are never rushed. Mirela listens, understands what you want, and makes sure you feel comfortable and cared for.'),
    ('Care in every detail', 'Every treatment is carried out with precision and tailored to your skin and your goals.'),
    ('Honest advice', 'You’ll know what each treatment involves and what to expect, so you can decide with confidence.'),
    ('A warm, relaxed room', 'A friendly, easy-going atmosphere where you can chat, unwind and enjoy your appointment.'),
    ('Support afterwards', 'Written aftercare, and Mirela is there to answer questions by phone or message once you’ve gone home.'),
]

EQUIPMENT = [
    ('Radiofrequency microneedling', 'Microneedling and radiofrequency energy in one treatment.'),
    ('Dermapen 4', 'Professional microneedling pen, used with Meso-Glide serums.'),
    ('Meso-Glide serums', 'Serums chosen for your skin during microneedling.'),
    ('Revolax', 'Hyaluronic acid dermal filler, used for lip filler.'),
    ('Skin boosters', 'Profhilo, Seventy Hyal, Ejal 40, Neauvia Hydro Deluxe and Vitaran.'),
    ('PRP and PRF', 'Prepared from your own blood, in clinic.'),
    ('Ultrasonic cavitation peeling', 'Deep, gentle cleansing for facials.'),
    ('Oxybrasion', 'Exfoliation and hydration for a brighter finish.'),
    ('Needle-free radiofrequency', 'Used in Facial Rejuvenation.'),
    ('Dermaplaning', 'Removes dead skin cells and fine facial hair.'),
    ('Vacuum dermomassage', 'Body treatment for thighs and abdomen.'),
    ('Pneumatic compression', 'For mechanical lymphatic drainage.'),
]

FAQS = [
    ('How do I know which treatment is right for me?', 'Book a free consultation. Mirela talks through your skin concerns and goals and recommends what suits you.'),
    ('Do I need a consultation before a treatment?', 'Some treatments need one first, to check suitability and your medical history. It can often happen on the same day as the treatment.'),
    ('Are the treatments painful?', 'Most involve only mild discomfort. For some, numbing cream can be used to keep you comfortable.'),
    ('How many sessions will I need?', 'It depends on the treatment and your goals. Some clients see a difference after one session; others benefit from a course.'),
    ('Is there any downtime?', 'It varies. Some treatments have little or none; others can leave temporary redness, swelling or sensitivity.'),
    ('Can I combine treatments?', 'Yes, some work well together. Mirela will advise on suitable combinations and timing.'),
    ('Is there an age limit?', 'Injectable treatments are for over 18s. Facials are available from 14, with a parent or guardian.'),
    ('What happens after my treatment?', 'You get written aftercare, and you can call or message Mirela with any questions.'),
    ('How do I book?', f'Book online through Booksy, or call or message {PHONE}.'),
]

REVIEW = ('Mirela is an incredibly skilled and caring professional. She is attentive, dedicated and always makes every appointment such a positive experience. Since starting my treatments with her, my skin has never looked healthier or more radiant. What truly stands out is the personalised care she provides: not only are the in-salon treatments amazing, but she also created a tailored skincare routine for me at home, which has made a huge difference. Every treatment is carried out with great attention to detail in such a calm and welcoming atmosphere. I always leave feeling relaxed, refreshed, and genuinely cared for.', 'Gosia', 'Facebook review')


# ---------- Shared parts ----------

def book_btn(label='Book online', cls='btn btn-gold'):
    return f'<a class="{cls}" href="{BOOK}" target="_blank" rel="noopener" data-track="book">{e(label)}</a>'


def tel(cls='', text=None):
    return f'<a class="{cls}" href="tel:{PHONE_TEL}" data-track="call">{e(text or PHONE)}</a>'


def logo_mark(size='md'):
    return f'<img class="mark mark-{size}" src="{P["logo"]}" alt="" width="1080" height="1080">'


def head(title, desc, path, noindex=False):
    schema = {
        '@context': 'https://schema.org', '@type': 'HealthAndBeautyBusiness', 'name': 'Alder Ease Aesthetics',
        'image': P['me'], 'logo': P['logo'], 'telephone': PHONE_TEL, 'email': EMAIL, 'priceRange': '££',
        'address': {'@type': 'PostalAddress', 'streetAddress': '167-169 Underwood Lane', 'addressLocality': 'Crewe', 'postalCode': 'CW1 3SD', 'addressCountry': 'GB'},
        'openingHoursSpecification': [{'@type': 'OpeningHoursSpecification', 'dayOfWeek': ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], 'opens': '09:00', 'closes': '17:00'}],
        'sameAs': [INSTA], 'founder': {'@type': 'Person', 'name': 'Mirela Borowska'},
    }
    return f'''<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
{'<meta name="robots" content="noindex">' if noindex or PREVIEW else ''}
<meta name="theme-color" content="#F5EFE7">
<meta property="og:type" content="website">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{P['me']}">
<link rel="icon" href="{P['logo']}">
<link rel="apple-touch-icon" href="{P['logo']}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://kuqdxaeilwpqeneblkyj.supabase.co">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="__ROOT__assets/site.css">
<script type="application/ld+json">{json.dumps(schema)}</script>
{'' if PREVIEW else TRACK}
<script src="__ROOT__assets/site.js" defer></script>
</head>
'''


def header(active):
    nav = [('treatments/', 'Treatments'), ('about/', 'About Mirela'), ('contact/', 'Contact')]
    items = ''.join(f'<li><a href="{link(p)}"{" aria-current=\"page\"" if active == p else ""}>{n}</a></li>' for p, n in nav)
    banner = '<div class="preview-bar">Preview for Mirela: not live yet. The booking button and phone links work; the contact form sends once the site is live.</div>' if PREVIEW else ''
    return f'''<body>
{banner}<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-in">
    <a class="brand" href="{link('')}" aria-label="Alder Ease Aesthetics, home">{logo_mark('sm')}<span class="brand-words"><span class="brand-name">Alder Ease</span><span class="brand-sub">Aesthetics</span></span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav"><span class="sr">Menu</span><span class="bars" aria-hidden="true"></span></button>
    <nav id="site-nav" class="site-nav" aria-label="Main">
      <ul>{items}</ul>
      <div class="nav-actions">{tel('nav-phone')}{book_btn('Book', 'btn btn-gold btn-sm')}</div>
    </nav>
  </div>
</header>
<main id="main">
'''


def footer():
    hours = ''.join(f'<li><span>{d}</span><span>{h or "Closed"}</span></li>' for d, h in HOURS)
    return f'''</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      {logo_mark('lg')}
      <p>Advanced skin treatments and lip enhancement with Mirela Borowska, in Crewe.</p>
      <p class="footer-social"><a href="{INSTA}" target="_blank" rel="noopener">Instagram @alderease_aesthetics</a></p>
    </div>
    <div>
      <h2 class="footer-h">Visit</h2>
      <address>{ADDRESS[0]}<br>{ADDRESS[1]} {ADDRESS[2]}</address>
      <p><a href="{MAPS}" target="_blank" rel="noopener">Directions</a></p>
      <p class="footer-small">Free parking on the road next to the building. Disability access.</p>
    </div>
    <div>
      <h2 class="footer-h">Opening hours</h2>
      <ul class="hours">{hours}</ul>
    </div>
    <div>
      <h2 class="footer-h">Get in touch</h2>
      <p>{tel()}<br><a href="mailto:{EMAIL}">{EMAIL}</a></p>
      <p>{book_btn('Book online', 'btn btn-outline-light btn-sm')}</p>
    </div>
  </div>
  <div class="wrap footer-base">
    <p>© <span data-year>2026</span> Alder Ease Aesthetics · Mirela Borowska · Fully insured</p>
    <p><a href="{link('privacy/')}">Privacy</a> · Website by <a href="https://gainora.co.uk" target="_blank" rel="noopener">Gainora</a></p>
  </div>
</footer>
<a class="mobile-book" href="{BOOK}" target="_blank" rel="noopener" data-track="book">Book online</a>
</body>
</html>
'''


def page(path, title, desc, active, body, noindex=False):
    root = '../' * path.count('/') if PREVIEW else '/'
    doc = head(title, desc, path, noindex) + header(active) + body + footer()
    doc = doc.replace('__ROOT__', root)
    d = os.path.join(OUT, path)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'index.html'), 'w') as f:
        f.write(doc)


def brand_panel(t):
    """For a treatment with no photo of that treatment yet: the logo on warm sand, never a photo of something else."""
    return f'<div class="ph brand-panel"><img src="{P["logo"]}" alt="" width="1080" height="1080" loading="lazy" decoding="async"><span>{e(t["name"])}</span></div>'


def hero_slides(slides, side):
    """One side of the hero: three photos that cross-fade and drift slowly, in the clinic's warm colours."""
    figs = ''.join(f'<figure class="ph slide"><img src="{P[k]}" alt="{e(alt)}" width="{w}" height="{h}" {"fetchpriority=\"high\"" if i == 0 else "loading=\"lazy\""} decoding="async" style="object-position:{pos}"></figure>'
                   for i, (k, alt, pos, w, h) in enumerate(slides))
    return f'<div class="hero-slides hero-{side}">{figs}</div>'


HERO = {
    'front': ('front', 'The front of Alder Ease Aesthetics on Underwood Lane, Crewe', '35% 40%', 960, 1091),
    'facial2': ('facial2', 'A cleansing facial at Alder Ease Aesthetics', '50% 40%', 1100, 1560),
    'hero2': ('hero2', 'Mirela giving a client a radiofrequency microneedling treatment', '45% 35%', 1200, 1600),
}


def intro():
    """Opening film, home page only: Mirela's walk in through the door, full screen, ending on the gold logo, then it fades into the website.
    Live it plays once per visit; in the preview it plays every time. Skipped for people who ask for less motion. A tap skips it."""
    once = 'false' if PREVIEW else 'true'
    return ('<div class="opening" id="intro" aria-hidden="true"><video muted playsinline preload="auto"></video></div>'
            '<script>(function(){var d=document.documentElement,el=document.getElementById("intro"),v=el.firstChild,once=' + once + ',done=false;'
            'function end(now){if(done)return;done=true;try{sessionStorage.setItem("ae-intro","1")}catch(e){}'
            'if(now){d.classList.remove("intro-on");el.remove();return}'
            'el.classList.add("out");setTimeout(function(){d.classList.remove("intro-on");el.remove()},1300)}'
            'try{if((once&&sessionStorage.getItem("ae-intro"))||matchMedia("(prefers-reduced-motion: reduce)").matches){el.remove();return}}catch(e){}'
            'd.classList.add("intro-on");'
            'var n=innerWidth/innerHeight<0.9?"tall":"wide";v.muted=true;v.poster="__ROOT__assets/intro-"+n+".jpg";v.src="__ROOT__assets/intro-"+n+".mp4";'
            'v.addEventListener("timeupdate",function(){if(v.duration&&v.currentTime>v.duration-0.9)end()});'
            'v.addEventListener("ended",function(){end()});v.addEventListener("error",function(){end(true)});'
            'el.addEventListener("click",function(){end()});'
            'var p=v.play();if(p&&p.catch)p.catch(function(){end(true)});'
            'setTimeout(function(){if(!v.currentTime)end(true)},4000);setTimeout(function(){end()},12000);'
            '})();</script>')


def photo(key, alt, cls='', pos=None, w=1200, h=1600, eager=False):
    style = f' style="object-position:{pos}"' if pos else ''
    return f'<figure class="ph {cls}"><img src="{P[key]}" alt="{e(alt)}" width="{w}" height="{h}" {"fetchpriority=\"high\"" if eager else "loading=\"lazy\""} decoding="async"{style}></figure>'


# ---------- Home ----------

def home():
    cards = ''
    for tid in FEATURED:
        t = T[tid]
        cards += f'''<article class="card reveal">
      <a class="card-img" href="{link('treatments/#' + tid)}" tabindex="-1" aria-hidden="true">{photo(t['img'], '', 'graded', w=1200, h=1600) if t['img'] else brand_panel(t)}</a>
      <div class="card-body">
        <h3><a href="{link('treatments/#' + tid)}">{e(t['name'])}</a></h3>
        <p>{e(t['lead'])}</p>
        <div class="card-foot"><span class="price">{e(from_price(t))}</span>{book_btn('Book', 'btn btn-quiet btn-sm')}</div>
      </div>
    </article>'''
    reasons = ''.join(f'<li class="reveal"><h3>{e(a)}</h3><p>{e(b)}</p></li>' for a, b in REASONS)
    equip = ''.join(f'<li><strong>{e(a)}</strong><span>{e(b)}</span></li>' for a, b in EQUIPMENT)
    faqs = ''.join(f'<details class="faq"><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in FAQS[:6])
    body = f'''
{intro()}
<section class="hero" aria-label="Welcome">
  <div class="hero-photos">
    {hero_slides([HERO['front'], HERO['facial2'], HERO['hero2']], 'left')}
    {hero_slides([HERO['facial2'], HERO['hero2'], HERO['front']], 'right')}
  </div>
  <div class="hero-card">
    {logo_mark('md')}
    <p class="eyebrow">Alder Ease Aesthetics · Crewe</p>
    <h1>Natural-looking skin treatments, in a calm and caring clinic</h1>
    <p class="lede">Advanced skin treatments and lip enhancement with Mirela Borowska. Every appointment starts with listening, so your treatment is planned around you.</p>
    <div class="actions">{book_btn('Book online')}<a class="btn btn-outline" href="{link('treatments/#consultation')}">Free consultation</a></div>
  </div>
</section>

<section class="trust" aria-label="About the clinic">
  <ul class="wrap trust-list">
    <li><strong>Level 2, 3 and 4</strong><span>aesthetics trained</span></li>
    <li><strong>Over 3 years</strong><span>in practice</span></li>
    <li><strong>Fully insured</strong><span>for your peace of mind</span></li>
    <li><strong>Free</strong><span>consultations</span></li>
  </ul>
</section>

<section class="section intro">
  <div class="wrap split">
    <div class="split-text reveal">
      <p class="eyebrow">Welcome</p>
      <h2>Unhurried appointments, honest advice and real care</h2>
      <p>I started Alder Ease Aesthetics because I’ve always loved beauty and wanted to make a real difference to how people look and feel. I take pride in attention to detail, high standards and genuine care for every client.</p>
      <p>Seeing clients leave happy, confident and comfortable in their own skin is what I love most. My goal is a welcoming, relaxing place where you feel valued and enjoy coming back.</p>
      <p class="signature">Mirela Borowska</p>
      <a class="text-link" href="{link('about/')}">More about Mirela</a>
    </div>
    <div class="split-media reveal">{photo('me', 'Mirela Borowska at the Alder Ease reception', 'graded-soft tall', pos='50% 28%', w=1000, h=1280)}</div>
  </div>
</section>

<section class="section tinted">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">Treatments</p>
      <h2>Signature treatments</h2>
      <p>Prices are shown for each treatment. Not sure which is right for you? Start with a free consultation.</p>
    </div>
    <div class="cards">{cards}</div>
    <p class="center"><a class="btn btn-outline" href="{link('treatments/')}">All treatments and prices</a></p>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head reveal"><p class="eyebrow">Why clients choose Mirela</p><h2>The care is in the details</h2></div>
    <ul class="reasons">{reasons}</ul>
  </div>
</section>

<section class="section results">
  <div class="wrap">
    <div class="section-head reveal"><p class="eyebrow">Lip filler</p><h2>Soft, natural-looking results</h2><p>Work by Mirela at Alder Ease Aesthetics. Every face is different, and results vary from person to person.</p></div>
    <div class="gallery">
      {photo('lips1', 'Lip filler before and after, by Alder Ease Aesthetics', 'graded-soft', w=1080, h=1350)}
      {photo('lips2', 'Lip filler before and after, side profile', 'graded-soft', w=1080, h=1350)}
      {photo('lips3', 'Lip filler result from three angles', 'graded-soft', w=1080, h=1350)}
      {photo('lips4', 'Lip filler before and after, close-up', 'graded-soft', w=1080, h=1350)}
    </div>
  </div>
</section>

<section class="section quote-band">
  <figure class="wrap quote reveal">
    <blockquote><p>{e(REVIEW[0])}</p></blockquote>
    <figcaption>{e(REVIEW[1])} · {e(REVIEW[2])}</figcaption>
  </figure>
</section>

<section class="section">
  <div class="wrap split split-rev">
    <div class="split-media reveal">{photo('needling', 'Mirela Borowska treating a client in the clinic', 'graded tall', pos='55% 45%')}</div>
    <div class="split-text reveal">
      <p class="eyebrow">Equipment and products</p>
      <h2>Professional equipment, chosen for each treatment</h2>
      <ul class="equip">{equip}</ul>
    </div>
  </div>
</section>

<section class="section tinted">
  <div class="wrap">
    <div class="section-head reveal"><p class="eyebrow">Your first visit</p><h2>Simple from the first message</h2></div>
    <ol class="steps">
      <li class="reveal"><h3>Book a free consultation</h3><p>Online through Booksy, or call or message {e(PHONE)}. It takes 30 to 45 minutes.</p></li>
      <li class="reveal"><h3>Plan it together</h3><p>Mirela checks suitability, explains each option honestly and gives you a form to fill in before any new treatment.</p></li>
      <li class="reveal"><h3>Treatment and aftercare</h3><p>Usually 1 to 1.5 hours, sometimes on the same day. You go home with written aftercare and can message any time.</p></li>
    </ol>
  </div>
</section>

<section class="section">
  <div class="wrap narrow">
    <div class="section-head reveal"><p class="eyebrow">Questions</p><h2>Good to know</h2></div>
    <div class="faqs">{faqs}</div>
  </div>
</section>

<section class="cta">
  <div class="wrap cta-in reveal">
    <h2>Not sure where to start?</h2>
    <p>Book a free consultation and talk it through first.</p>
    <div class="actions">{book_btn('Book online')}{tel('btn btn-outline-light', 'Call ' + PHONE)}</div>
  </div>
</section>
'''
    page('', 'Alder Ease Aesthetics | Skin treatments and lip filler in Crewe',
         'Radiofrequency microneedling, Dermapen 4, PRP, lip filler and facials in Crewe with Mirela Borowska. Free consultations. Prices online. Book on Booksy.',
         '', body)


# ---------- Treatments ----------

def treatments():
    jump = ''.join(f'<li><a href="#{t["id"]}">{e(t["name"])}</a></li>' for t in TREATMENTS)
    blocks = ''
    for t in TREATMENTS:
        rows = ''.join(f'<tr><th scope="row">{e(a)}</th><td>{e(b)}</td><td class="num">{e(c)}</td></tr>' for a, b, c in t['rows'])
        media = photo(t['img'], f'{t["name"]} at Alder Ease Aesthetics', 'graded', w=1200, h=1600) if t['img'] else ''
        blocks += f'''<article class="treat reveal{' has-media' if media else ''}" id="{t['id']}">
      {f'<div class="treat-media">{media}</div>' if media else ''}
      <div class="treat-body">
        <h2>{e(t['name'])}</h2>
        <p class="treat-lead">{e(t['lead'])}</p>
        <p>{e(t['text'])}</p>
        <table class="prices"><caption class="sr">{e(t['name'])} prices</caption><thead><tr><th scope="col">Treatment</th><th scope="col">Time</th><th scope="col" class="num">Price</th></tr></thead><tbody>{rows}</tbody></table>
        <div class="actions">{book_btn('Book ' + ('a free consultation' if t['id'] == 'consultation' else 'this treatment'))}<a class="btn btn-outline" href="{link('contact/')}">Ask a question</a></div>
      </div>
    </article>'''
    body = f'''
<section class="page-hero">
  <div class="wrap">
    <p class="eyebrow">Treatments and prices</p>
    <h1>Treatments</h1>
    <p class="lede">Every new client starts with a free consultation, so your treatment suits your skin and your goals. Some treatments need one first to check suitability.</p>
    <ul class="jump">{jump}</ul>
  </div>
</section>
<section class="section treat-list"><div class="wrap">{blocks}
  <p class="small-print">Prices from Mirela’s current price list. Results vary from person to person, and suitability is checked at consultation. Injectable treatments are for over 18s; facials from 14 with a parent or guardian. Nails, brows and lashes aren’t offered.</p>
</div></section>
'''
    page('treatments/', 'Treatments and prices | Alder Ease Aesthetics, Crewe',
         'RF microneedling from £150, Dermapen 4 from £100, PRP from £200, PRF under-eye £150, lip filler from £200, facials from £65 and more, in Crewe.',
         'treatments/', body)


# ---------- About ----------

def about():
    reasons = ''.join(f'<li class="reveal"><h3>{e(a)}</h3><p>{e(b)}</p></li>' for a, b in REASONS)
    body = f'''
<section class="page-hero">
  <div class="wrap"><p class="eyebrow">About</p><h1>Meet Mirela</h1>
  <p class="lede">Mirela Borowska is the founder of Alder Ease Aesthetics in Crewe. Level 2, 3 and 4 aesthetics trained, fully insured, and in practice for over 3 years.</p></div>
</section>
<section class="section">
  <div class="wrap split">
    <div class="split-text reveal">
      <h2>Why I started</h2>
      <p>I started my aesthetics business because I have always had a passion for beauty and wanted to make a positive difference in how people look and feel about themselves.</p>
      <p>I take pride in my attention to detail, high standards of work and genuine care for every client. What makes me most proud is seeing my clients leave feeling happy, confident and comfortable in their own skin.</p>
      <p>My goal has always been to create a welcoming, relaxing environment where clients feel valued, cared for and genuinely enjoy coming back for their treatments.</p>
      <p class="signature">Mirela</p>
    </div>
    <div class="split-media reveal">{photo('me', 'Mirela Borowska, founder of Alder Ease Aesthetics', 'graded-soft tall', pos='50% 28%', w=1000, h=1280)}</div>
  </div>
</section>
<section class="section tinted">
  <div class="wrap">
    <div class="section-head reveal"><h2>What makes Alder Ease different</h2><p>A personal experience, where every client has Mirela’s full attention, rather than simply coming in for a treatment.</p></div>
    <ul class="reasons">{reasons}</ul>
  </div>
</section>
<section class="cta">
  <div class="wrap cta-in reveal"><h2>Come and meet Mirela</h2><p>Book a free consultation, or call or message with any question.</p>
  <div class="actions">{book_btn('Book online')}{tel('btn btn-outline-light', 'Call ' + PHONE)}</div></div>
</section>
'''
    page('about/', 'About Mirela Borowska | Alder Ease Aesthetics, Crewe',
         'Mirela Borowska: level 2, 3 and 4 aesthetics trained, fully insured, over 3 years in practice. Personal, unhurried care in Crewe.',
         'about/', body)


# ---------- Contact ----------

def contact():
    opts = ''.join(f'<option>{e(t["name"])}</option>' for t in TREATMENTS) + '<option>Something else</option>'
    hours = ''.join(f'<li><span>{d}</span><span>{h or "Closed"}</span></li>' for d, h in HOURS)
    body = f'''
<section class="page-hero">
  <div class="wrap"><p class="eyebrow">Contact</p><h1>Get in touch</h1>
  <p class="lede">Call, text, WhatsApp or message on Instagram, book online, or send a message below. Mirela will get back to you.</p></div>
</section>
<section class="section">
  <div class="wrap contact-grid">
    <form class="enquiry reveal" id="enquire" method="post" action="{FORM_ACTION}" data-enquiry{' data-preview' if PREVIEW else ''} novalidate>
      <h2>Send a message</h2>
      <div class="field"><label for="f-name">Your name</label><input id="f-name" name="name" required autocomplete="name"></div>
      <div class="field-row">
        <div class="field"><label for="f-phone">Phone</label><input id="f-phone" name="phone" type="tel" autocomplete="tel"></div>
        <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="email"></div>
      </div>
      <p class="hint" id="f-contact-hint">Give a phone number or an email, so Mirela can reply.</p>
      <div class="field"><label for="f-service">Treatment you’re interested in</label><select id="f-service" name="service"><option value="">Choose one (optional)</option>{opts}</select></div>
      <div class="field"><label for="f-message">Message</label><textarea id="f-message" name="message" rows="5"></textarea></div>
      <input type="hidden" name="page" value=""><input type="hidden" name="source" value="">
      <div class="hp" aria-hidden="true"><label for="f-hp">Leave this empty</label><input id="f-hp" name="website_url_confirm" tabindex="-1" autocomplete="off"></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-gold" type="submit">Send message</button>
      <p class="small-print">Your details go to Alder Ease Aesthetics only, to reply to you. See the <a href="{link('privacy/')}">privacy page</a>.</p>
    </form>
    <div class="contact-side reveal">
      <div class="contact-card">
        <h2>Visit the clinic</h2>
        <address>{ADDRESS[0]}<br>{ADDRESS[1]} {ADDRESS[2]}</address>
        <p><a href="{MAPS}" target="_blank" rel="noopener">Get directions</a></p>
        <p class="small-print">Free parking on the road next to the building. Disability access available.</p>
      </div>
      <div class="contact-card">
        <h2>Opening hours</h2>
        <ul class="hours">{hours}</ul>
      </div>
      <div class="contact-card">
        <h2>Call, text or message</h2>
        <p>{tel('big-link')}</p>
        <p><a href="mailto:{EMAIL}">{EMAIL}</a><br><a href="{INSTA}" target="_blank" rel="noopener">Instagram @alderease_aesthetics</a></p>
        <p>{book_btn('Book online')}</p>
      </div>
    </div>
  </div>
</section>
'''
    page('contact/', 'Contact and opening hours | Alder Ease Aesthetics, Crewe',
         'Alder Ease Aesthetics, 167-169 Underwood Lane, Crewe CW1 3SD. Open Tuesday to Saturday, 9am to 5pm. Call 07922 509893 or book online.',
         'contact/', body)


def privacy():
    body = f'''
<section class="page-hero"><div class="wrap"><p class="eyebrow">Privacy</p><h1>Privacy</h1></div></section>
<section class="section"><div class="wrap narrow prose">
  <h2>What the contact form collects</h2>
  <p>Your name, your phone number and email (if you give them), the treatment you’re interested in and your message. We also note which page you sent it from and how you found the website, such as Google or Instagram.</p>
  <h2>What it’s used for</h2>
  <p>Your message goes to Alder Ease Aesthetics (Mirela Borowska) so she can reply to you. It isn’t sold or used for anything else. Gainora, who runs this website, stores it securely on Mirela’s behalf.</p>
  <h2>Visit statistics</h2>
  <p>The website counts visits and taps on the phone number and booking buttons, without identifying you, to see how the website is doing. If Google tools are switched on, you’ll be asked first.</p>
  <h2>Bookings</h2>
  <p>Online bookings are made through Booksy, which has its own privacy policy.</p>
  <h2>Seeing or deleting your details</h2>
  <p>To see what we hold about you, or to ask for it to be deleted, email <a href="mailto:{EMAIL}">{EMAIL}</a> or call {tel()}.</p>
</div></section>
'''
    page('privacy/', 'Privacy | Alder Ease Aesthetics', 'How Alder Ease Aesthetics uses the details you send through the website.', 'privacy/', body)


def thanks():
    body = f'''
<section class="page-hero thanks"><div class="wrap narrow center">
  {logo_mark('md')}
  <h1>Thank you</h1>
  <p class="lede">Your message has been sent. Mirela will get back to you as soon as she can.</p>
  <div class="actions center-actions">{book_btn('Book online')}<a class="btn btn-outline" href="{link('')}">Back to the home page</a></div>
</div></section>
'''
    page('thanks/', 'Thank you | Alder Ease Aesthetics', 'Your message has been sent.', '', body, noindex=True)


home(); treatments(); about(); contact(); privacy(); thanks()

with open(os.path.join(OUT, 'robots.txt'), 'w') as f:
    f.write('User-agent: *\nDisallow: /\n' if PREVIEW else 'User-agent: *\nDisallow: /thanks/\n')
print('built', OUT, 'preview' if PREVIEW else 'production')
