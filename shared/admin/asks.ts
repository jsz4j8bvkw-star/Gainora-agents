// Asking a client for what Gainora needs: a set of questions sent as a link, answered on a simple form (photos
// included), tracked in the admin until it comes back, then handed on as the next piece of work.

export type QuestionType = 'text' | 'long' | 'links' | 'photos' | 'yesno' | 'choice' | 'multi';
/** choice = pick one, multi = tick all that apply; both use options. */
export interface Question { id: string; label: string; help?: string; type: QuestionType; group?: string; options?: string[] }
export const HAS_OPTIONS = (t: QuestionType) => t === 'choice' || t === 'multi';
export type AskStatus = 'draft' | 'sent' | 'opened' | 'answered' | 'cancelled';
export interface AskFile { url: string; name: string; question: string }
export interface Ask {
  id: string; email: string; token: string; template: string; title: string; intro: string; questions: Question[];
  answers: Record<string, string>; files: AskFile[]; status: AskStatus; due_on: string | null; sent_to: string;
  sent_at: string | null; opened_at: string | null; answered_at: string | null; reminded_at: string | null;
  client_task_id: string | null; next_task_id: string | null; created_by: string; created_at: string; updated_at: string;
}
export const ASK_STATUS_LABEL: Record<AskStatus, string> = { draft: 'Draft', sent: 'Sent, not opened', opened: 'Opened, not answered', answered: 'Answered', cancelled: 'Cancelled' };

const q = (group: string, id: string, label: string, type: QuestionType = 'long', help?: string): Question => ({ id, group, label, type, ...(help ? { help } : {}) });
const pick = (group: string, id: string, label: string, type: 'choice' | 'multi', options: string[], help?: string): Question => ({ id, group, label, type, options, ...(help ? { help } : {}) });

export interface AskTemplate { key: string; title: string; intro: string; dueDays: number; questions: Question[]; next?: { title: string; detail: string; who: 'claude' | 'gainora'; project: 'launch' | 'capture' | 'command' | 'other'; days: number } }

export const ASK_TEMPLATES: AskTemplate[] = [
  {
    key: 'website', title: 'Your new website: the full brief', dueDays: 7,
    intro: 'This is everything we need to build a website that’s right first time: your words, your prices, your photos and what you want it to do. Most questions are a tap or a few words. Skip anything you’re not sure about, and come back whenever you like: your answers save as you go.',
    next: { title: 'Build the website draft from their answers', detail: 'Their answers and photos are on their client page (Questions). Build the draft, list anything still missing as a task for them, and don’t publish until they’ve approved it.', who: 'claude', project: 'launch', days: 2 },
    questions: [
      q('About the business', 'business_name', 'The business name exactly as it should appear', 'text', 'Including any capital letters or punctuation, and any trading name you also use.'),
      q('About the business', 'owner', 'Your name as you’d like it shown, your role, your qualifications and training, and how long you’ve been doing this'),
      q('About the business', 'story', 'In a few lines: why you started, and what you’re proud of', 'long', 'This becomes your About page. Your own words are best; we’ll tidy them.'),
      q('About the business', 'team', 'Anyone else who works with you? Their names and roles, and whether they should be on the website'),
      q('About the business', 'trust', 'Insurance, accreditations, memberships, awards or training providers we can mention, with the names', 'long', 'For example “Insured with …”, “Trained with …”, “Member of …”. We only mention what you list here.'),
      pick('Where and when', 'address_show', 'Should your address be on the website?', 'choice', ['Yes, the full address', 'Just the town or area', 'No, it’s by appointment and I share it after booking']),
      q('Where and when', 'address', 'Your address (or the town, if that’s all you want shown)', 'text'),
      q('Where and when', 'areas', 'Which towns and areas do your customers come from? The main ones first', 'long', 'These become the places we help you show up for on Google.'),
      q('Where and when', 'hours', 'Your usual opening hours, day by day', 'long', 'For example: Mon to Fri 10am to 6pm, Sat 9am to 2pm, closed Sunday. If it changes week to week, give your usual pattern and we’ll write “by appointment”.'),
      q('Where and when', 'access', 'Parking, access and how to find you', 'long', 'Free parking? Stairs or step-free? A landmark that helps?'),
      q('Contact and booking', 'contact', 'The phone number and email customers should use', 'text'),
      pick('Contact and booking', 'contact_ways', 'How can customers get in touch? Tick all you’re happy with', 'multi', ['Call', 'Text', 'WhatsApp', 'Email', 'Instagram message', 'A form on the website', 'Book online']),
      pick('Contact and booking', 'booking', 'Where do bookings happen?', 'choice', ['On my online booking page', 'Customers call or message and I book them in', 'Both']),
      q('Contact and booking', 'booking_link', 'Your booking page link (Booksy, Fresha, Treatwell or similar)', 'links'),
      q('Contact and booking', 'policies', 'Deposits, cancellation and late policy, in your words', 'long', 'For example “£20 deposit, taken off the price. 48 hours’ notice to cancel or move.”'),
      q('Contact and booking', 'first_visit', 'What happens the first time someone books with you?', 'long', 'For example a consultation, a patch test, forms to fill in, or how long the first visit takes.'),
      q('Services and prices', 'services', 'Every service you offer, with its price (or “from” price), how long it takes, and one line on what it’s for', 'long', 'Please list them here even if they’re on your booking page, so the names, prices and order on your website are exactly right. Copy and paste is fine.'),
      pick('Services and prices', 'price_display', 'How should prices appear on the website?', 'choice', ['Full prices', '“From” prices', 'No prices: ask for a quote or consultation']),
      q('Services and prices', 'top', 'The services you most want more bookings for, most important first'),
      q('Services and prices', 'offers', 'Any packages, courses, memberships, offers or gift vouchers?'),
      q('Services and prices', 'suitability', 'Who is each main service right for, and who isn’t it right for?', 'long', 'For example age limits, when a consultation is needed first, or who should wait (pregnancy, certain medication).'),
      q('Services and prices', 'not_offered', 'Anything you don’t do, or don’t want enquiries about?'),
      q('Your customers', 'ideal', 'Your ideal customer: who they are, what they want, and what worries them before they book'),
      q('Your customers', 'faqs', 'The questions customers ask you most often', 'long', 'We’ll answer them on the website, so fewer people need to ask.'),
      q('Your customers', 'why', 'Why do customers choose you over others nearby? Three to five reasons'),
      q('Your customers', 'competitors', 'Two or three businesses near you that do something similar (names or links), and what you do differently', 'long'),
      pick('Look and feel', 'feel', 'Which words fit how your website should feel? Tick up to three', 'multi', ['Calm', 'Warm', 'Luxurious', 'Clean and clinical', 'Friendly', 'Bold', 'Natural', 'Modern', 'Classic']),
      q('Look and feel', 'colours', 'Colours you love, and colours to avoid', 'text'),
      pick('Look and feel', 'logo', 'Do you have a logo?', 'choice', ['Yes, I’ll add it in the photos below', 'Yes, but I’d like a better one', 'No, I don’t have one']),
      q('Look and feel', 'liked_sites', 'Websites you like the look of (any business, anywhere), and what you like about them', 'links'),
      q('Photos and reviews', 'photos', 'Photos of you, your premises and your logo', 'photos', 'You at work, the room or shop, the outside and the entrance. Photos from your phone are fine.'),
      q('Photos and reviews', 'work_photos', 'Photos of your work', 'photos', 'Only photos your customers have agreed you can share. We follow the advertising rules for your industry, so we may leave some out.'),
      pick('Photos and reviews', 'review_sites', 'Where do you have reviews?', 'multi', ['Google', 'Booksy', 'Fresha', 'Treatwell', 'Facebook', 'Trustpilot', 'None yet']),
      q('Photos and reviews', 'review_quotes', 'Reviews you’d like on the website (copy and paste them)', 'long', 'Only real reviews from real customers. We show the first name and where the review came from.'),
      q('Online accounts', 'socials', 'Links to your Instagram, Facebook, TikTok and Google listing', 'links'),
      pick('Online accounts', 'google_profile', 'Do you have a Google Business Profile (the listing that shows on Google Maps)?', 'choice', ['Yes, and I can log in to it', 'Yes, but I can’t get into it', 'No', 'Not sure']),
      pick('Online accounts', 'domain_own', 'Do you already own a web address (like yourbusiness.co.uk)?', 'choice', ['Yes', 'No', 'Not sure']),
      q('Online accounts', 'domain', 'If yes: what is it, and who is it with (GoDaddy, 123 Reg, Squarespace or similar)? If no: any addresses you’d like?', 'text'),
      q('Online accounts', 'business_email', 'Would you like an email address on your web address, like hello@yourbusiness.co.uk?', 'yesno'),
      pick('What the website is for', 'goal', 'What should the website do for you? Tick the ones that matter most', 'multi', ['More bookings', 'More enquiries and consultations', 'Show my services and prices clearly', 'Look more professional and trusted', 'Sell gift vouchers or products', 'Fewer “how much is…?” messages']),
      q('What the website is for', 'success', 'Six months from now, what would make you say the website worked?'),
      q('What the website is for', 'baseline', 'Roughly how many enquiries and bookings do you get a month now?', 'text', 'So we can see the difference the website makes.'),
      q('What the website is for', 'deadline', 'Is there a date it needs to be live by (an opening, an event, a busy season)?', 'text'),
      q('Words and rules', 'must_include', 'Anything that must be on the website: registration numbers, legal wording or disclaimers?'),
      q('Words and rules', 'never_say', 'Words, claims or anything you never want on your website', 'long', 'We never promise results, and we follow the advertising rules for your industry.'),
      q('Words and rules', 'case_study', 'Would you be happy for Gainora to share how the new website works for you, with your name?', 'yesno'),
    ],
  },
  {
    key: 'receptionist', title: 'Your receptionist: a few questions', dueDays: 5,
    intro: 'Your receptionist answers calls and messages the way you would. These answers tell it what to say. Short answers are fine; skip anything you’re not sure about.',
    next: { title: 'Set up the receptionist from their answers', detail: 'Their answers are on their client page (Questions). Use them for the wording, booking rules and what to pass to the owner.', who: 'gainora', project: 'capture', days: 2 },
    questions: [
      q('Calls today', 'missed', 'Roughly how many calls do you miss in a normal week, and when (during treatments, evenings, weekends)?'),
      q('Calls today', 'number', 'Which phone number do clients call now, and who is it with (BT, Vodafone, a mobile)?', 'text'),
      q('Booking', 'booking', 'How should the receptionist book people in? Your booking system and link, or should it take details for you to call back?'),
      q('Booking', 'rules', 'Anything it must check before booking (a consultation first, patch tests, age, deposits)?'),
      q('What to say', 'prices', 'Prices it can give, or should it say “from” prices only?'),
      q('What to say', 'never', 'Anything it should never say or promise?'),
      q('What to say', 'urgent', 'What counts as urgent (for example a reaction after treatment), and how should it reach you?'),
      q('Passing it on', 'handover', 'Where should summaries go: text, email or both? To which number or address?', 'text'),
    ],
  },
  { key: 'custom', title: 'A few questions from Gainora', dueDays: 5, intro: 'Short answers are fine. Your answers save as you go.', questions: [] },
];
export const templateFor = (key: string) => ASK_TEMPLATES.find((t) => t.key === key) ?? ASK_TEMPLATES[ASK_TEMPLATES.length - 1];

const TYPES: QuestionType[] = ['text', 'long', 'links', 'photos', 'yesno', 'choice', 'multi'];
export const MAX_QUESTIONS = 60;
/** Questions as the admin or Claude wrote them, made safe: ids unique, labels short, options tidy, at most 60. */
export function cleanQuestions(raw: unknown): Question[] {
  const out: Question[] = [];
  const seen = new Set<string>();
  for (const [i, r] of (Array.isArray(raw) ? raw : []).slice(0, MAX_QUESTIONS).entries()) {
    const label = String((r as any)?.label ?? '').trim().slice(0, 300);
    if (!label) continue;
    let id = String((r as any)?.id ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30) || `q${i + 1}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    let type: QuestionType = TYPES.includes((r as any)?.type) ? (r as any).type : 'long';
    const help = String((r as any)?.help ?? '').trim().slice(0, 300);
    const group = String((r as any)?.group ?? '').trim().slice(0, 80);
    const options = HAS_OPTIONS(type) ? [...new Set((Array.isArray((r as any)?.options) ? (r as any).options : []).map((o: unknown) => String(o ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)).filter(Boolean))].slice(0, 12) as string[] : [];
    if (HAS_OPTIONS(type) && options.length < 2) type = 'long';   // a pick list needs something to pick
    out.push({ id, label, type, ...(help ? { help } : {}), ...(group ? { group } : {}), ...(HAS_OPTIONS(type) ? { options } : {}) });
  }
  return out;
}

/** Answers kept only for the questions asked, as plain text. */
export function cleanAnswers(questions: Question[], raw: unknown): Record<string, string> {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const qn of questions) {
    if (qn.type === 'photos') continue;
    const v = src[qn.id];
    if (v === undefined || v === null) continue;
    const s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    if (qn.type === 'yesno') { if (s === 'yes' || s === 'no') out[qn.id] = s; continue; }
    if (qn.type === 'choice') { if (qn.options?.includes(s)) out[qn.id] = s; continue; }
    if (qn.type === 'multi') { const picked = [...new Set(s.split('\n').map((x) => x.trim()))].filter((x) => qn.options?.includes(x)); if (picked.length) out[qn.id] = picked.join('\n'); continue; }
    if (s) out[qn.id] = s.slice(0, qn.type === 'text' ? 600 : 4000);
  }
  return out;
}

/** How far through the client is. Photos count as answered once one is added. */
export function progressOf(ask: Pick<Ask, 'questions' | 'answers' | 'files'>): { answered: number; total: number } {
  const total = ask.questions.length;
  const answered = ask.questions.filter((qn) => (qn.type === 'photos' ? ask.files.some((f) => f.question === qn.id) : !!ask.answers[qn.id])).length;
  return { answered, total };
}

/** The answers as text: for the team email, the client's record and Claude. */
export function answersText(ask: Pick<Ask, 'questions' | 'answers' | 'files'>): string {
  return ask.questions.map((qn) => {
    const a = qn.type === 'photos'
      ? (ask.files.filter((f) => f.question === qn.id).map((f) => f.url).join('\n') || '(no photos added)')
      : qn.type === 'yesno' ? (ask.answers[qn.id] === 'yes' ? 'Yes' : ask.answers[qn.id] === 'no' ? 'No' : '(not answered)')
        : qn.type === 'multi' ? (ask.answers[qn.id] ? ask.answers[qn.id].split('\n').join(', ') : '(not answered)')
          : ask.answers[qn.id] || '(not answered)';
    return `${qn.label}\n${a}`;
  }).join('\n\n');
}
