// Launch & Grow: the business's website as Command Centre holds it. Everything on the site, the Google profile
// text, the listings, the reviews kit, the ads plan and the checks is worked out from this one record, which the
// owner (or Gainora on their behalf) edits in Command Centre → Website. Publishing copies it to `published`,
// which is what visitors see.

export type IndustryId = 'aesthetics' | 'beauty' | 'hair' | 'physio' | 'dental' | 'plumber' | 'electrician' | 'builder' | 'other';
export type Style = 'calm' | 'bold' | 'warm';
/** Typeface pairings Gainora chooses from per client. */
export type FontPair = 'classic' | 'editorial' | 'grand' | 'friendly' | 'modern' | 'clean' | 'geometric';
/** How the top of the home page is laid out. */
export type HeroLayout = 'split' | 'full' | 'centred';
/** The overall tone: plain, softly tinted with the brand colour, or deep (dark top and call-to-action). */
export type Surface = 'light' | 'tinted' | 'deep';
export interface Sections { how: boolean; why: boolean; reviews: boolean; faq: boolean; gallery: boolean }
export const DEFAULT_SECTIONS: Sections = { how: true, why: true, reviews: true, faq: true, gallery: true };
/** Named brand colours to start from; Gainora can also set any colour. */
export const PALETTES: { name: string; accent: string }[] = [
  { name: 'Sage', accent: '#3E5C55' }, { name: 'Forest', accent: '#24463A' }, { name: 'Ink blue', accent: '#22395B' }, { name: 'Harbour', accent: '#2C6E73' },
  { name: 'Plum', accent: '#5B3A57' }, { name: 'Rose clay', accent: '#9A5B5B' }, { name: 'Berry', accent: '#8A3B55' }, { name: 'Terracotta', accent: '#A4512F' },
  { name: 'Ochre', accent: '#8C6A1C' }, { name: 'Olive', accent: '#5B6B3A' }, { name: 'Royal', accent: '#1F5FA8' }, { name: 'Charcoal', accent: '#2E3238' },
];
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAYS: { id: Day; label: string; short: string }[] = [
  { id: 'mon', label: 'Monday', short: 'Mon' }, { id: 'tue', label: 'Tuesday', short: 'Tue' }, { id: 'wed', label: 'Wednesday', short: 'Wed' },
  { id: 'thu', label: 'Thursday', short: 'Thu' }, { id: 'fri', label: 'Friday', short: 'Fri' }, { id: 'sat', label: 'Saturday', short: 'Sat' },
  { id: 'sun', label: 'Sunday', short: 'Sun' },
];

export interface Service { id: string; name: string; price: string; duration: string; summary: string; page: boolean }
export interface Review { id: string; text: string; name: string; source: string }
export interface Photo { id: string; url: string; name: string; alt: string }
export interface Faq { q: string; a: string }

export interface Site {
  /** The site's address before it has its own domain: app.gainora.co.uk/site/<slug>/ */
  slug: string;
  business: {
    name: string; industry: IndustryId; trade: string; phone: string; email: string;
    line1: string; line2: string; town: string; postcode: string;
    /** False for businesses that go to the customer and don't want their address shown (most trades). */
    showAddress: boolean;
    areas: string[];
    hours: Record<Day, string>;
    owner: string; founded: string;
    credentials: string[];
    differences: string[];
    domain: string;
  };
  services: Service[];
  reviews: Review[];
  reviewLink: string;
  booking: { url: string; label: string };
  /** The website form link from Capture & Convert, so enquiries land in their inbox there. */
  captureFormUrl: string;
  tracking: { ga4: string; adsId: string; adsLabel: string };
  ads: { monthly: number; radiusMiles: number };
  /** The design. Only Gainora changes it; clients ask for changes. */
  look: { style: Style; fonts: FontPair; heroLayout: HeroLayout; surface: Surface; sections: Sections; accent: string; logo: Photo | null; hero: Photo | null; about: Photo | null; gallery: Photo[] };
  /** The words on the site the owner has changed. Anything not here is written by the Studio. */
  copy: Record<string, string>;
  faqs: Faq[] | null;
  plan: Record<string, boolean>;
  /** Gainora's private notes about the site. Never shown to the client. */
  notes: string;
  /**
   * A website Gainora built separately (with Claude Code) and hosts elsewhere, e.g. https://aldereaseaesthetics.co.uk.
   * Empty: the builder renders the site. Set: the builder's copy forwards there, and the site reports to Command
   * Centre through the tracking script (/api/site-track/<site id>.js) and posts its form to /api/site-enquiry/<site id>.
   */
  external: { url: string };
}

/** A change the client asked Gainora to make (kept in its own table, site_requests). */
export interface ChangeRequest { id: string; at: string; page: string; text: string; status: 'open' | 'done'; done_at: string | null; reply: string }

export interface Industry {
  id: IndustryId;
  label: string;
  trade: string;
  /** What they call the people they serve. */
  person: 'client' | 'patient' | 'customer';
  /** Go to the customer (trades) or the customer comes to them (clinics, salons). */
  mobile: boolean;
  schema: string;
  style: Style;
  accent: string;
  gbp: { primary: string; secondary: string[] };
  cta: { label: string; short: string };
  services: Omit<Service, 'id'>[];
  steps: [string, string][];
  heroLine: string;
  keywordExtras: string[];
  negatives: string[];
  directories: { name: string; url: string; note: string }[];
  reviewWhen: string;
  photoIdeas: string[];
  /** Words that are risky on the site or in ads for this kind of business, and why. */
  caution: { words: RegExp; why: string }[];
}

const GENERAL_DIRECTORIES = [
  { name: 'Google Business Profile', url: 'https://business.google.com/', note: 'The one that matters most. Set up first; verification can take a few days.' },
  { name: 'Bing Places for Business', url: 'https://www.bingplaces.com/', note: 'Can import straight from the Google profile once it is verified.' },
  { name: 'Apple Business Connect', url: 'https://businessconnect.apple.com/', note: 'How the business shows in Apple Maps and Siri.' },
  { name: 'Facebook Page', url: 'https://www.facebook.com/pages/create', note: 'Use exactly the same name, address and phone as Google.' },
  { name: 'Yell', url: 'https://www.yell.com/free-listing/', note: 'Free listing. Turn down the paid upsells.' },
  { name: 'Yelp', url: 'https://biz.yelp.co.uk/', note: 'Free listing.' },
  { name: 'Nextdoor', url: 'https://business.nextdoor.com/', note: 'A free business page; neighbours recommend local businesses here.' },
  { name: 'FreeIndex', url: 'https://www.freeindex.co.uk/', note: 'Free UK directory.' },
];

const CLINIC_STEPS: [string, string][] = [
  ['Book a consultation', 'Choose a time online or call us. We’ll ask a few questions so we’re ready for you.'],
  ['Talk it through', 'We look at what you’d like to change, explain your options and the costs, and answer every question. No pressure to go ahead.'],
  ['Your treatment', 'When you’re ready, we book your treatment and look after you before, during and after it.'],
];

const POM = /\b(botox|botulinum|toxin|anti.?wrinkle (?:injections?|treatments?|jabs?)|azzalure|bocouture|dysport|xeomin|letybo|relfydess|vistabel|fat.?dissolv\w*|aqualyx|lemon bottle|ozempic|wegovy|mounjaro|semaglutide|tirzepatide|skinny jab|weight.?loss injection\w*|vitamin b12 injection\w*)\b/i;
const HEALTH_CLAIMS = /\b(guarantee[ds]?|pain.?free|painless|permanent(ly)?|cure[sd]?|risk.?free|no side.?effects|100%|best in (town|the uk|[a-z]+))\b/i;

export const INDUSTRIES: Record<IndustryId, Industry> = {
  aesthetics: {
    id: 'aesthetics', label: 'Aesthetics clinic', trade: 'aesthetics clinic', person: 'client', mobile: false, schema: 'MedicalBusiness', style: 'calm', accent: '#3E5C55',
    gbp: { primary: 'Skin care clinic', secondary: ['Medical spa', 'Facial spa', 'Beauty salon'] },
    cta: { label: 'Book a consultation', short: 'Book' },
    services: [
      { name: 'Free consultation', price: 'Free', duration: '30 minutes', summary: 'A relaxed chat about what you’d like to change, what’s possible and what it costs. Nothing is booked until you’re sure.', page: false },
      { name: 'Lip filler', price: 'From £250', duration: '45 minutes', summary: 'Subtle, natural-looking shape and hydration, planned around your face and what you want.', page: true },
      { name: 'Skin boosters', price: 'From £200', duration: '45 minutes', summary: 'Deep hydration for brighter, smoother-looking skin, usually as a course of treatments.', page: true },
      { name: 'Chemical peel', price: 'From £90', duration: '45 minutes', summary: 'A peel chosen for your skin to refresh texture and tone, with aftercare explained.', page: false },
      { name: 'Microneedling', price: 'From £150', duration: '60 minutes', summary: 'Collagen induction to improve texture and the look of scarring over a course of sessions.', page: true },
    ],
    steps: CLINIC_STEPS,
    heroLine: 'Natural-looking results, planned with you',
    keywordExtras: ['aesthetics clinic', 'skin clinic', 'aesthetic practitioner'],
    negatives: ['course', 'courses', 'training', 'academy', 'jobs', 'job', 'salary', 'wholesale', 'buy', 'kit', 'diy', 'at home', 'nhs', 'cheap', 'free', 'gone wrong', 'botched', 'reddit'],
    directories: [
      ...GENERAL_DIRECTORIES,
      { name: 'Save Face', url: 'https://www.saveface.co.uk/', note: 'Government-approved register of accredited practitioners. Paid accreditation; strong trust signal if they qualify.' },
      { name: 'Consulting Room', url: 'https://www.consultingroom.com/', note: 'UK aesthetics clinic finder.' },
      { name: 'Treatwell', url: 'https://www.treatwell.co.uk/', note: 'Booking marketplace. It takes a commission; only if they want marketplace bookings.' },
    ],
    reviewWhen: 'Two weeks after a filler or injectable treatment (once results have settled); the day after facials and peels.',
    photoIdeas: ['The treatment room, tidy and well lit', 'The practitioner at work (with consent), in uniform', 'The entrance and signage, so people find you', 'Certificates and accreditations on the wall', 'Products you use, on a clean surface'],
    caution: [
      { words: POM, why: 'Prescription-only medicines (anti-wrinkle toxins, weight-loss injections and similar) can’t be advertised to the public in the UK. Promote a consultation instead and don’t name the medicine.' },
      { words: HEALTH_CLAIMS, why: 'Health and beauty claims must be backed by evidence. Avoid “guaranteed”, “pain-free”, “permanent” and similar.' },
    ],
  },
  beauty: {
    id: 'beauty', label: 'Beauty salon', trade: 'beauty salon', person: 'client', mobile: false, schema: 'BeautySalon', style: 'warm', accent: '#8A4B5C',
    gbp: { primary: 'Beauty salon', secondary: ['Nail salon', 'Eyelash salon', 'Waxing hair removal service'] },
    cta: { label: 'Book online', short: 'Book' },
    services: [
      { name: 'Gel manicure', price: 'From £28', duration: '45 minutes', summary: 'Shape, cuticle care and a long-lasting gel colour.', page: false },
      { name: 'Lash lift and tint', price: 'From £45', duration: '60 minutes', summary: 'Lifted, darker lashes for around six weeks, no extensions needed.', page: true },
      { name: 'Brow lamination', price: 'From £40', duration: '45 minutes', summary: 'Fuller, brushed-up brows set in place, with shaping and tint.', page: true },
      { name: 'Facial', price: 'From £55', duration: '60 minutes', summary: 'A facial matched to your skin on the day, with advice to keep it glowing.', page: false },
      { name: 'Waxing', price: 'From £12', duration: '15 to 45 minutes', summary: 'Quick, hygienic waxing for face and body.', page: false },
    ],
    steps: [['Choose your treatment', 'Book online in a minute or give us a call.'], ['Relax with us', 'Arrive a few minutes early, sit back and let us look after you.'], ['Leave feeling great', 'We’ll tell you how to look after it and when to come back.']],
    heroLine: 'Treatments you’ll look forward to',
    keywordExtras: ['beauty salon', 'beautician'],
    negatives: ['course', 'courses', 'training', 'academy', 'jobs', 'job', 'salary', 'wholesale', 'kit', 'diy', 'at home', 'products'],
    directories: [...GENERAL_DIRECTORIES, { name: 'Treatwell', url: 'https://www.treatwell.co.uk/', note: 'Booking marketplace. It takes a commission on new clients.' }, { name: 'Booksy', url: 'https://booksy.com/en-gb/', note: 'Booking app with a marketplace; only if they use it.' }],
    reviewWhen: 'The same evening or the next morning, while the visit is fresh.',
    photoIdeas: ['The salon from the door, bright and tidy', 'Close-ups of finished work (with consent)', 'Treatment beds and stations', 'The team, smiling, in uniform', 'The shop front and signage'],
    caution: [{ words: HEALTH_CLAIMS, why: 'Avoid claims that can’t be backed up, such as “guaranteed”, “pain-free” or “permanent”.' }],
  },
  hair: {
    id: 'hair', label: 'Hair salon or barber', trade: 'hair salon', person: 'client', mobile: false, schema: 'HairSalon', style: 'warm', accent: '#4F4A7A',
    gbp: { primary: 'Hair salon', secondary: ['Barber shop', 'Hairdresser'] },
    cta: { label: 'Book online', short: 'Book' },
    services: [
      { name: 'Cut and blow-dry', price: 'From £45', duration: '60 minutes', summary: 'A consultation, wash, cut and finish, styled the way you like it.', page: false },
      { name: 'Colour', price: 'From £70', duration: '2 hours', summary: 'Full colour, roots or a refresh, matched to you. Patch test needed 48 hours before.', page: true },
      { name: 'Balayage', price: 'From £120', duration: '3 hours', summary: 'Soft, hand-painted lightness that grows out gently.', page: true },
      { name: 'Men’s cut', price: 'From £22', duration: '30 minutes', summary: 'Clipper or scissor cut, finished and styled.', page: false },
    ],
    steps: [['Book your appointment', 'Online or by phone, at a time that suits you.'], ['Talk it through', 'We start every appointment with a chat about what you want.'], ['Walk out happy', 'We’ll show you how to style it at home.']],
    heroLine: 'Hair you’ll love living with',
    keywordExtras: ['hairdresser', 'hair salon'],
    negatives: ['course', 'training', 'academy', 'jobs', 'job', 'salary', 'wholesale', 'products', 'diy', 'at home', 'wigs'],
    directories: [...GENERAL_DIRECTORIES, { name: 'Treatwell', url: 'https://www.treatwell.co.uk/', note: 'Booking marketplace. It takes a commission on new clients.' }, { name: 'Booksy', url: 'https://booksy.com/en-gb/', note: 'Booking app with a marketplace; only if they use it.' }],
    reviewWhen: 'The same evening, while they still love their hair.',
    photoIdeas: ['Finished cuts and colours (with consent), in good light', 'The salon floor and chairs', 'The team at work', 'The shop front'],
    caution: [{ words: HEALTH_CLAIMS, why: 'Avoid claims that can’t be backed up, such as “guaranteed” or “permanent”.' }],
  },
  physio: {
    id: 'physio', label: 'Physiotherapy clinic', trade: 'physiotherapy clinic', person: 'patient', mobile: false, schema: 'Physiotherapy', style: 'calm', accent: '#2F5D7C',
    gbp: { primary: 'Physiotherapist', secondary: ['Sports massage therapist', 'Massage therapist'] },
    cta: { label: 'Book an assessment', short: 'Book' },
    services: [
      { name: 'Initial assessment', price: '£65', duration: '45 minutes', summary: 'We find out what’s going on, explain it clearly and agree a plan with you.', page: true },
      { name: 'Follow-up treatment', price: '£55', duration: '30 minutes', summary: 'Hands-on treatment and exercises, adjusted as you get better.', page: false },
      { name: 'Sports massage', price: '£50', duration: '45 minutes', summary: 'For tight, sore muscles from training, work or everyday life.', page: true },
      { name: 'Back and neck pain', price: 'From £65', duration: '45 minutes', summary: 'Assessment and treatment to ease pain and get you moving with confidence.', page: true },
    ],
    steps: [['Book an assessment', 'Online or by phone. Most people are seen within a few days.'], ['Understand the problem', 'We assess you properly and explain what we find in plain English.'], ['Get back to normal', 'Treatment and a home plan that fits around your life.']],
    heroLine: 'Get moving again, without the guesswork',
    keywordExtras: ['physio', 'physiotherapist', 'physiotherapy'],
    negatives: ['course', 'degree', 'training', 'jobs', 'job', 'salary', 'nhs', 'apprenticeship', 'exercises pdf', 'equipment', 'band 5', 'band 6'],
    directories: [...GENERAL_DIRECTORIES, { name: 'Physio First', url: 'https://www.physiofirst.org.uk/', note: 'Directory for private physios who are members.' }],
    reviewWhen: 'At the end of a course of treatment, or after the third visit.',
    photoIdeas: ['The treatment room', 'The physio working with a patient (with consent)', 'The gym or rehab space', 'Outside and the entrance, so people find you'],
    caution: [{ words: HEALTH_CLAIMS, why: 'Health claims must be backed by evidence. Avoid “cure”, “guaranteed” and “pain-free”.' }],
  },
  dental: {
    id: 'dental', label: 'Dental practice', trade: 'dental practice', person: 'patient', mobile: false, schema: 'Dentist', style: 'calm', accent: '#2C6E73',
    gbp: { primary: 'Dentist', secondary: ['Cosmetic dentist', 'Dental clinic', 'Teeth whitening service'] },
    cta: { label: 'Book an appointment', short: 'Book' },
    services: [
      { name: 'New patient check-up', price: 'From £60', duration: '30 minutes', summary: 'A full check of your teeth and gums and a clear plan, with costs before anything is done.', page: false },
      { name: 'Hygienist visit', price: 'From £65', duration: '30 minutes', summary: 'A thorough clean and advice to keep your gums healthy.', page: false },
      { name: 'Teeth whitening', price: 'From £300', duration: 'Over 2 to 3 weeks', summary: 'Dentist-led whitening with custom trays, after a check that it’s right for you.', page: true },
      { name: 'Clear aligners', price: 'From £2,000', duration: 'Usually 6 to 12 months', summary: 'Straighter teeth with nearly invisible aligners, planned by your dentist.', page: true },
    ],
    steps: [['Book online or call', 'Tell us if you’re nervous; we’ll take it slowly.'], ['Your check-up', 'We look at everything and explain your options and costs.'], ['Your treatment plan', 'Nothing goes ahead until you’re happy with the plan and price.']],
    heroLine: 'Calm, careful dentistry, explained clearly',
    keywordExtras: ['dentist', 'dental practice'],
    negatives: ['course', 'degree', 'jobs', 'job', 'salary', 'nurse', 'nhs dentist list', 'kit', 'diy', 'at home', 'wholesale'],
    directories: [...GENERAL_DIRECTORIES],
    reviewWhen: 'The day after the visit.',
    photoIdeas: ['The surgery, clean and bright', 'Reception and waiting area', 'The team', 'The building from the street'],
    caution: [{ words: HEALTH_CLAIMS, why: 'Dental adverts must not mislead. Avoid “guaranteed”, “pain-free” and “permanent”; only call someone a specialist if they’re on the GDC specialist list.' }],
  },
  plumber: {
    id: 'plumber', label: 'Plumbing and heating', trade: 'plumber', person: 'customer', mobile: true, schema: 'Plumber', style: 'bold', accent: '#1F5FA8',
    gbp: { primary: 'Plumber', secondary: ['Heating contractor', 'Gas engineer'] },
    cta: { label: 'Get a quote', short: 'Quote' },
    services: [
      { name: 'Boiler repair', price: 'From £80', duration: 'Same or next day', summary: 'No heating or hot water? We find the fault and fix it, with parts on the van for most boilers.', page: true },
      { name: 'Boiler installation', price: 'Free quote', duration: '1 to 2 days', summary: 'A new boiler sized for your home, fitted neatly, registered and explained.', page: true },
      { name: 'Leaks and repairs', price: 'From £70', duration: 'Same or next day', summary: 'Dripping taps, leaking pipes, toilets that won’t stop running.', page: false },
      { name: 'Bathroom fitting', price: 'Free quote', duration: 'From 5 days', summary: 'From a new shower to a full bathroom, planned and fitted by one team.', page: true },
    ],
    steps: [['Tell us what’s wrong', 'Call or send a message with a photo if you can.'], ['Clear price first', 'We tell you the cost before we start. No surprises.'], ['Fixed and tidied', 'We do the job properly and leave the place clean.']],
    heroLine: 'Local plumbing and heating, done properly',
    keywordExtras: ['plumber', 'heating engineer', 'emergency plumber'],
    negatives: ['course', 'courses', 'training', 'apprenticeship', 'jobs', 'job', 'salary', 'wholesale', 'parts', 'screwfix', 'b&q', 'diy', 'how to', 'youtube', 'manual'],
    directories: [...GENERAL_DIRECTORIES, { name: 'Checkatrade', url: 'https://www.checkatrade.com/', note: 'Paid membership. Worth it for some trades; compare with what the ads cost.' }, { name: 'TrustATrader', url: 'https://www.trustatrader.com/', note: 'Paid membership.' }, { name: 'Which? Trusted Traders', url: 'https://trustedtraders.which.co.uk/', note: 'Paid, with an assessment. Strong trust signal.' }],
    reviewWhen: 'The same day the job is finished, before they forget your name.',
    photoIdeas: ['The van with the business name', 'Finished work: a tidy boiler, a new bathroom', 'Before and after of a repair', 'The owner on the job (in branded clothing)'],
    caution: [{ words: /\bgas\b|boiler/i, why: 'Gas work must be done by a Gas Safe registered engineer. Show the Gas Safe number on the site if they do gas work.' }, { words: HEALTH_CLAIMS, why: 'Avoid claims that can’t be backed up, such as “guaranteed cheapest”.' }],
  },
  electrician: {
    id: 'electrician', label: 'Electrician', trade: 'electrician', person: 'customer', mobile: true, schema: 'Electrician', style: 'bold', accent: '#B5651D',
    gbp: { primary: 'Electrician', secondary: ['Lighting contractor', 'Electrical installation service'] },
    cta: { label: 'Get a quote', short: 'Quote' },
    services: [
      { name: 'Fault finding and repairs', price: 'From £75', duration: 'Same or next day', summary: 'Tripping switches, dead sockets, flickering lights: found and fixed safely.', page: true },
      { name: 'Consumer unit upgrades', price: 'Free quote', duration: '1 day', summary: 'A modern fuse board with proper protection, tested and certified.', page: true },
      { name: 'EICR safety checks', price: 'From £150', duration: 'Half a day', summary: 'Electrical safety reports for homeowners and landlords.', page: true },
      { name: 'Lighting and sockets', price: 'Free quote', duration: 'Varies', summary: 'New lights, extra sockets, outdoor power and EV charger points.', page: false },
    ],
    steps: [['Tell us what you need', 'Call or send a message with a photo if you can.'], ['Clear price first', 'We tell you the cost before we start.'], ['Safe and certified', 'Work tested and certified, and the mess cleared up.']],
    heroLine: 'Safe, tidy electrical work from a local electrician',
    keywordExtras: ['electrician', 'local electrician'],
    negatives: ['course', 'courses', 'training', 'apprenticeship', 'jobs', 'job', 'salary', 'wholesale', 'screwfix', 'toolstation', 'diy', 'how to', 'youtube', 'regulations book'],
    directories: [...GENERAL_DIRECTORIES, { name: 'Checkatrade', url: 'https://www.checkatrade.com/', note: 'Paid membership.' }, { name: 'NICEIC find a contractor', url: 'https://www.niceic.com/', note: 'Only if they’re NICEIC registered.' }, { name: 'NAPIT find an installer', url: 'https://www.napit.org.uk/', note: 'Only if they’re NAPIT registered.' }],
    reviewWhen: 'The same day the job is finished.',
    photoIdeas: ['The van', 'A neat consumer unit you fitted', 'Lighting you installed, switched on', 'The owner on site'],
    caution: [{ words: HEALTH_CLAIMS, why: 'Avoid claims that can’t be backed up, such as “guaranteed cheapest”.' }],
  },
  builder: {
    id: 'builder', label: 'Builder', trade: 'builder', person: 'customer', mobile: true, schema: 'GeneralContractor', style: 'bold', accent: '#5B6B3A',
    gbp: { primary: 'Builder', secondary: ['General contractor', 'Construction company'] },
    cta: { label: 'Get a quote', short: 'Quote' },
    services: [
      { name: 'Extensions', price: 'Free quote', duration: 'Usually 8 to 16 weeks', summary: 'Single and double-storey extensions, managed from plans to finish.', page: true },
      { name: 'Loft conversions', price: 'Free quote', duration: 'Usually 6 to 10 weeks', summary: 'Turn the loft into a bedroom or office, with building control sign-off.', page: true },
      { name: 'Renovations', price: 'Free quote', duration: 'Varies', summary: 'Kitchens, knock-throughs and full renovations by one team.', page: true },
      { name: 'Small works', price: 'From £300', duration: 'Days', summary: 'Repairs, brickwork and the jobs bigger firms won’t take on.', page: false },
    ],
    steps: [['Tell us about the job', 'A quick call or message, with photos if you have them.'], ['Visit and written quote', 'We come out, measure up and send a clear written quote.'], ['Built properly', 'One point of contact, regular updates and a tidy site.']],
    heroLine: 'Extensions and renovations, built properly',
    keywordExtras: ['builder', 'local builders', 'building company'],
    negatives: ['course', 'training', 'apprenticeship', 'jobs', 'job', 'salary', 'merchant', 'supplies', 'diy', 'how to', 'youtube', 'kit', 'cost calculator'],
    directories: [...GENERAL_DIRECTORIES, { name: 'Checkatrade', url: 'https://www.checkatrade.com/', note: 'Paid membership.' }, { name: 'MyBuilder', url: 'https://www.mybuilder.com/', note: 'Pay per lead. Compare with what the ads cost.' }, { name: 'Federation of Master Builders', url: 'https://www.fmb.org.uk/', note: 'Only if they’re members.' }],
    reviewWhen: 'At handover, while you’re still on site.',
    photoIdeas: ['Finished projects, inside and out', 'Before and after of the same room', 'The team on site, in branded workwear', 'The van'],
    caution: [{ words: HEALTH_CLAIMS, why: 'Avoid claims that can’t be backed up, such as “guaranteed cheapest”.' }],
  },
  other: {
    id: 'other', label: 'Another local business', trade: 'local business', person: 'customer', mobile: false, schema: 'LocalBusiness', style: 'calm', accent: '#3D4F6B',
    gbp: { primary: '', secondary: [] },
    cta: { label: 'Get in touch', short: 'Enquire' },
    services: [
      { name: 'Your main service', price: 'From £', duration: '', summary: 'What it is and who it’s for, in a sentence.', page: true },
      { name: 'Your second service', price: 'From £', duration: '', summary: 'What it is and who it’s for, in a sentence.', page: false },
    ],
    steps: [['Get in touch', 'Call or send a message.'], ['A clear price', 'We tell you what it costs before we start.'], ['Done properly', 'We do what we said, when we said.']],
    heroLine: 'Local, reliable and easy to deal with',
    keywordExtras: [],
    negatives: ['course', 'training', 'jobs', 'job', 'salary', 'diy', 'how to', 'youtube', 'wholesale'],
    directories: [...GENERAL_DIRECTORIES],
    reviewWhen: 'Within a day of the work or visit.',
    photoIdeas: ['Where you work', 'Your work, finished', 'You and the team', 'Outside, so people find you'],
    caution: [{ words: HEALTH_CLAIMS, why: 'Avoid claims that can’t be backed up, such as “guaranteed” or “best in town”.' }],
  },
};

export const INDUSTRY_LIST = Object.values(INDUSTRIES);
export const industryOf = (b: Pick<Site, 'business'>) => INDUSTRIES[b.business.industry] ?? INDUSTRIES.other;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const slug = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';

const EMPTY_HOURS: Record<Day, string> = { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' };

/** A new, empty site for a business of this kind, with its usual services filled in as a starting point. */
export function newSite(industry: IndustryId = 'aesthetics'): Site {
  const ind = INDUSTRIES[industry];
  return {
    slug: '',
    business: {
      name: '', industry, trade: ind.trade, phone: '', email: '', line1: '', line2: '', town: '', postcode: '',
      showAddress: !ind.mobile, areas: [], hours: ind.mobile
        ? { ...EMPTY_HOURS, mon: '8:00-18:00', tue: '8:00-18:00', wed: '8:00-18:00', thu: '8:00-18:00', fri: '8:00-18:00', sat: '9:00-13:00' }
        : { ...EMPTY_HOURS, tue: '9:30-18:00', wed: '9:30-18:00', thu: '9:30-20:00', fri: '9:30-18:00', sat: '9:00-16:00' },
      owner: '', founded: '', credentials: [], differences: [], domain: '',
    },
    services: ind.services.map((s) => ({ ...s, id: uid() })),
    reviews: [], reviewLink: '', booking: { url: '', label: '' }, captureFormUrl: '',
    tracking: { ga4: '', adsId: '', adsLabel: '' }, ads: { monthly: 600, radiusMiles: ind.mobile ? 15 : 8 },
    look: { style: ind.style, fonts: ind.style === 'bold' ? 'modern' : ind.style === 'warm' ? 'friendly' : 'classic', heroLayout: 'split', surface: ind.style === 'bold' ? 'light' : 'tinted', sections: { ...DEFAULT_SECTIONS }, accent: ind.accent, logo: null, hero: null, about: null, gallery: [] },
    copy: {}, faqs: null, plan: {}, notes: '', external: { url: '' },
  };
}

/** Fills in anything an older saved site is missing, so the Studio never trips over it. */
export function withDefaults(raw: any): Site {
  const base = newSite(raw?.business?.industry in INDUSTRIES ? raw.business.industry : 'other');
  const b = { ...base, ...raw } as Site;
  b.business = { ...base.business, ...(raw?.business ?? {}), hours: { ...base.business.hours, ...(raw?.business?.hours ?? {}) } };
  b.look = { ...base.look, ...(raw?.look ?? {}), sections: { ...DEFAULT_SECTIONS, ...(raw?.look?.sections ?? {}) } };
  // Sites saved before font choices existed keep the fonts their style gave them.
  if (!raw?.look?.fonts) b.look.fonts = b.look.style === 'bold' ? 'modern' : b.look.style === 'warm' ? 'friendly' : 'classic';
  b.booking = { ...base.booking, ...(raw?.booking ?? {}) };
  b.tracking = { ...base.tracking, ...(raw?.tracking ?? {}) };
  b.ads = { ...base.ads, ...(raw?.ads ?? {}) };
  b.external = { ...base.external, ...(raw?.external ?? {}) };
  b.copy = { ...(raw?.copy ?? {}) };
  b.plan = { ...(raw?.plan ?? {}) };
  for (const k of ['services', 'reviews'] as const) if (!Array.isArray(b[k])) (b as any)[k] = base[k];
  if (!Array.isArray(b.business.areas)) b.business.areas = [];
  if (!Array.isArray(b.business.credentials)) b.business.credentials = [];
  if (!Array.isArray(b.business.differences)) b.business.differences = [];
  if (!Array.isArray(b.look.gallery)) b.look.gallery = [];
  return b;
}

/* ---------- Small helpers used across the Studio ---------- */

export const townOf = (b: Site) => b.business.town.trim() || b.business.areas[0] || '';
export const areasOf = (b: Site) => {
  const all = [townOf(b), ...b.business.areas].map((a) => a.trim()).filter(Boolean);
  return [...new Set(all.map((a) => a.toLowerCase()))].map((l) => all.find((a) => a.toLowerCase() === l)!);
};
export const personOf = (b: Site) => industryOf(b).person;
export const ctaOf = (b: Site) => (b.booking.label.trim() || industryOf(b).cta.label);
export const tradeOf = (b: Site) => b.business.trade.trim() || industryOf(b).trade;
export const nameOf = (b: Site) => b.business.name.trim() || 'Your business';

/** "9:00-17:30" → [540, 1050]. Empty or unreadable → null (closed). */
export function readHours(raw: string): [number, number] | null {
  const m = raw.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?:[:.](\d{2}))?$/i);
  if (!m) return null;
  const a = +m[1] * 60 + +(m[2] || 0); const z = +m[3] * 60 + +(m[4] || 0);
  return a < z && z <= 24 * 60 ? [a, z] : null;
}
export const clock = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};
export const hoursLabel = (raw: string) => { const r = readHours(raw); return r ? `${clock(r[0])} to ${clock(r[1])}` : 'Closed'; };
export const iso = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "Tuesday to Saturday" style summary of the days they open. */
export function openDays(b: Site): string {
  const open = DAYS.filter((d) => readHours(b.business.hours[d.id]));
  if (!open.length) return '';
  const idx = open.map((d) => DAYS.indexOf(d));
  const run = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (open.length === 7) return 'Open 7 days';
  if (run && open.length > 2) return `Open ${open[0].label} to ${open[open.length - 1].label}`;
  return `Open ${open.map((d) => d.short).join(', ')}`;
}

/** The lowest "from" price, e.g. "From £45", for headlines. Null when there are no prices. */
export function fromPrice(b: Site): string | null {
  const nums = b.services.map((s) => Number((s.price.match(/£\s?([\d,]+)/) || [])[1]?.replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? `£${Math.min(...nums)}` : null;
}

export const telHref = (phone: string) => {
  const d = phone.replace(/[^\d+]/g, '');
  return d.startsWith('0') ? `tel:+44${d.slice(1)}` : `tel:${d}`;
};

/** The closest kind of business for the industry they typed in onboarding. */
export function guessIndustry(text: string): IndustryId {
  const t = (text || '').toLowerCase();
  if (/aesthetic|injectable|filler|skin clinic|medical spa|cosmetic clinic/.test(t)) return 'aesthetics';
  if (/dental|dentist|orthodont/.test(t)) return 'dental';
  if (/physio|osteo|chiro|sports massage|rehab/.test(t)) return 'physio';
  if (/hair|barber|salon.*hair|stylist/.test(t)) return 'hair';
  if (/beauty|nail|lash|brow|spa|wax/.test(t)) return 'beauty';
  if (/plumb|heating|boiler|gas/.test(t)) return 'plumber';
  if (/electric/.test(t)) return 'electrician';
  if (/build|construct|extension|roof|joiner|carpent|plaster|decorat/.test(t)) return 'builder';
  return 'other';
}

/** "Lip filler £250\nSkin boosters - from £200" → services. Lines without a name are skipped. */
export function servicesFromPriceList(text: string): Service[] {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).map((line) => {
    const price = (line.match(/(from\s+)?£\s?[\d,]+(\.\d\d)?/i) || [''])[0];
    const name = line.replace(price, '').replace(/[-–:|,]+\s*$/, '').replace(/\s[-–:|]\s*$/, '').trim();
    return { id: uid(), name: name.slice(0, 80), price: price ? price.replace(/^from/i, 'From').replace(/£\s+/, '£') : '', duration: '', summary: '', page: false };
  }).filter((s) => s.name);
}

/** A first draft of the site from what they told Command Centre in onboarding, so nobody types it twice. */
export function siteFromProfile(p: any): Site {
  const b = p?.business ?? {};
  const industry = guessIndustry(`${b.industry} ${b.oneLiner}`);
  const s = newSite(industry);
  s.business.name = String(b.name || '').slice(0, 120);
  s.business.owner = String(b.ownerName || '').slice(0, 80);
  s.business.founded = String(b.tradingSince || '').match(/\d{4}/)?.[0] ?? '';
  s.business.town = String(b.location || '').split(',')[0].trim().slice(0, 60);
  s.business.postcode = String(b.postcode || '').toUpperCase().slice(0, 10);
  s.business.areas = (Array.isArray(p?.customers?.areas) ? p.customers.areas : []).map((a: any) => String(a).trim()).filter(Boolean).slice(0, 20);
  if (industry === 'other' && b.industry) s.business.trade = String(b.industry).toLowerCase().slice(0, 60);
  const fromList = servicesFromPriceList(p?.offer?.priceList || '');
  if (fromList.length >= 2) s.services = fromList.map((x, i) => ({ ...x, page: i < 3 }));
  if (p?.offer?.bookingUrl) s.booking.url = String(p.offer.bookingUrl);
  if (p?.competitors?.ourEdge) s.business.differences = [String(p.competitors.ourEdge).slice(0, 160)];
  try { const host = new URL(/^https?:/.test(b.website) ? b.website : `https://${b.website}`).hostname.replace(/^www\./, ''); if (host.includes('.')) s.business.domain = host; } catch { /* no website yet */ }
  s.slug = slug(s.business.name);
  return s;
}


/* ---------- Who can change what ----------
 * Clients keep their everyday details up to date themselves: prices, services, opening hours, contact details,
 * reviews and their booking link. The design, the wording and the pages are Gainora's work: clients ask for
 * changes and Gainora makes them. The server applies this, whatever the browser sends. */

/** The client's edit applied to the current site: only the fields a client may change are taken. */
export function mergeClientEdit(current: Site, incoming: Site): Site {
  const known = new Map(current.services.map((x) => [x.id, x]));
  const b = incoming.business;
  return {
    ...current,
    business: {
      ...current.business,
      phone: b.phone, email: b.email, line1: b.line1, line2: b.line2, town: b.town, postcode: b.postcode, areas: b.areas, hours: b.hours,
    },
    // Services: name, price, time and the one-line description are theirs; whether it has its own page is Gainora's.
    services: incoming.services.map((x) => ({ ...x, page: known.get(x.id)?.page ?? false })),
    reviews: incoming.reviews,
    reviewLink: incoming.reviewLink,
    booking: { ...current.booking, url: incoming.booking.url },
    captureFormUrl: incoming.captureFormUrl,
    plan: { ...current.plan, ...incoming.plan },
  };
}

/** What the client's browser receives: everything except Gainora's private notes. */
export function forClient(s: Site): Site { return { ...s, notes: '' }; }
