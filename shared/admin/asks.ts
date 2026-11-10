// Asking a client for what Gainora needs: a set of questions sent as a link, answered on a simple form (photos
// included), tracked in the admin until it comes back, then handed on as the next piece of work.

export type QuestionType = 'text' | 'long' | 'links' | 'photos' | 'yesno';
export interface Question { id: string; label: string; help?: string; type: QuestionType; group?: string }
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

export interface AskTemplate { key: string; title: string; intro: string; dueDays: number; questions: Question[]; next?: { title: string; detail: string; who: 'claude' | 'gainora'; project: 'launch' | 'capture' | 'command' | 'other'; days: number } }

export const ASK_TEMPLATES: AskTemplate[] = [
  {
    key: 'website', title: 'Your new website: a few questions', dueDays: 5,
    intro: 'So your new website is right from the start, we need a few details from you. Short answers are fine, and skip anything you’re not sure about. Your answers save as you go, so you can come back to finish later.',
    next: { title: 'Build the website draft from their answers', detail: 'Their answers and photos are on their client page (Questions). Build the draft, list anything still missing as a task for them, and don’t publish until they’ve approved it.', who: 'claude', project: 'launch', days: 2 },
    questions: [
      q('About you and the clinic', 'owner', 'Your name as you’d like it shown, your qualifications and training, and how long you’ve been practising'),
      q('About you and the clinic', 'insured', 'Are you insured? Who with?', 'text', 'We can say you’re fully insured.'),
      q('About you and the clinic', 'where', 'Where are you based, and should the address be on the website? Which towns do your clients come from?'),
      q('About you and the clinic', 'contact', 'The phone number and email clients should use, and your opening hours'),
      q('About you and the clinic', 'booking', 'How do clients book with you now: online (Fresha or similar), a message or a call? Add the booking link if there is one'),
      q('About you and the clinic', 'links', 'Links to your Instagram, Facebook and Google listing', 'links'),
      q('Your treatments', 'treatments', 'Each treatment with its price and how long it takes, plus one line on what it’s for'),
      q('Your treatments', 'more', 'Which treatments would you like more bookings for?', 'text'),
      q('Why clients choose you', 'why', 'Two to four things clients love about coming to you', 'long', 'For example one-to-one appointments, free consultations, or checking in after a treatment.'),
      q('Look and feel', 'look', 'Calm, warm or bold? Any colours you love or want to avoid? Do you have a logo?'),
      q('Photos and reviews', 'photos', 'Photos you’re happy for us to use', 'photos', 'You at work, the treatment room, the entrance, your logo, and before-and-afters you have your clients’ permission to share.'),
      q('Photos and reviews', 'reviews', 'Your Google review link, and any reviews you’d like on the site'),
      q('Web address', 'domain', 'Do you already own a web address? If not, are there any names you like?', 'text'),
      q('Your results', 'case_study', 'Would you be happy for Gainora to share how the new website works for you, with your name?', 'yesno'),
      q('Your results', 'baseline', 'Roughly how many enquiries and bookings do you get a month now?', 'text', 'So we can see the difference the new website makes.'),
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

const TYPES: QuestionType[] = ['text', 'long', 'links', 'photos', 'yesno'];
/** Questions as the admin or Claude wrote them, made safe: ids unique, labels short, at most 30. */
export function cleanQuestions(raw: unknown): Question[] {
  const out: Question[] = [];
  const seen = new Set<string>();
  for (const [i, r] of (Array.isArray(raw) ? raw : []).slice(0, 30).entries()) {
    const label = String((r as any)?.label ?? '').trim().slice(0, 300);
    if (!label) continue;
    let id = String((r as any)?.id ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30) || `q${i + 1}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const type = TYPES.includes((r as any)?.type) ? (r as any).type : 'long';
    const help = String((r as any)?.help ?? '').trim().slice(0, 300);
    const group = String((r as any)?.group ?? '').trim().slice(0, 80);
    out.push({ id, label, type, ...(help ? { help } : {}), ...(group ? { group } : {}) });
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
        : ask.answers[qn.id] || '(not answered)';
    return `${qn.label}\n${a}`;
  }).join('\n\n');
}
