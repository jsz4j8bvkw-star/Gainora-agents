// Asking clients for details: the questions link, sending it, the answers coming back, and what happens next.
import { randomBytes, randomUUID } from 'node:crypto';
import { db, env, HttpError, insert } from './core';
import { sendEmail } from './email';
import { APP_ORIGIN, gainoraEmails } from './sites';
import { log } from './admin';
import { normEmail } from '../../shared/admin/model';
import { addDays } from '../../shared/admin/templates';
import { ukToday } from '../../shared/admin/board';
import { answersText, type Ask, cleanAnswers, cleanQuestions, templateFor } from '../../shared/admin/asks';

export const askUrl = (token: string) => `${APP_ORIGIN()}/q/${token}`;
export const ADMIN_ORIGIN = () => env('ADMIN_URL', 'https://admin.gainora.co.uk').replace(/\/$/, '');
const REPLY_TO = () => env('GAINORA_REPLY_TO', 'hello@gainora.co.uk');
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const iso = () => new Date().toISOString();

export async function askByToken(token: string): Promise<Ask | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return (await db<Ask[]>(`client_asks?select=*&token=eq.${token}`))[0] ?? null;
}
export async function askById(id: string): Promise<Ask> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown question set.');
  const a = (await db<Ask[]>(`client_asks?select=*&id=eq.${id}`))[0];
  if (!a) throw new HttpError(404, 'That question set no longer exists.');
  return a;
}

/** A draft question set for a client: from a template, or questions written for them. */
export async function saveAsk(raw: any, by: string): Promise<Ask> {
  const email = normEmail(raw?.email || '');
  if (!email) throw new HttpError(400, 'Say which client.');
  const t = templateFor(String(raw?.template || 'custom'));
  const base = Array.isArray(raw?.questions) && raw.questions.length ? raw.questions : t.questions;
  const questions = cleanQuestions([...base, ...(Array.isArray(raw?.extra_questions) ? raw.extra_questions : [])]);
  if (!questions.length) throw new HttpError(400, 'Add at least one question.');
  const row = {
    email, template: t.key, title: String(raw?.title || t.title).trim().slice(0, 160) || t.title,
    intro: String(raw?.intro ?? t.intro).trim().slice(0, 1200), questions,
    due_on: isDate(raw?.due_on) ? raw.due_on : addDays(ukToday(), t.dueDays), updated_at: iso(),
  };
  if (raw?.id) {
    const cur = await askById(String(raw.id));
    if (cur.status === 'answered' || cur.status === 'cancelled') throw new HttpError(409, 'This one is finished. Make a new set of questions.');
    const [saved] = await db<Ask[]>(`client_asks?id=eq.${cur.id}`, { method: 'PATCH', body: row, prefer: 'return=representation' });
    return saved;
  }
  // A new set can start with answers already filled in (what the client told us before), for them to check.
  const answers = cleanAnswers(questions, raw?.answers);
  const [made] = await insert<Ask>('client_asks', { id: randomUUID(), token: randomBytes(18).toString('base64url'), status: 'draft', answers, files: [], created_by: by, created_at: iso(), ...row });
  return made;
}

/** Emails the client the link, and puts "waiting on them" on their checklist with the deadline. */
export async function sendAsk(id: string, by: string, opts: { to?: string; message?: string; firstName?: string } = {}): Promise<Ask> {
  const a = await askById(id);
  if (a.status === 'cancelled' || a.status === 'answered') throw new HttpError(409, 'This one is finished. Make a new set of questions.');
  const to = normEmail(opts.to || a.sent_to || a.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(400, 'That email address doesn’t look right.');
  const due = a.due_on ? new Date(`${a.due_on}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';
  await sendEmail(to, a.title, [
    `Hi ${opts.firstName || 'there'},`,
    String(opts.message || '').trim() || 'We need a few details from you to get things right. It’s a short form you can fill in on your phone, and your answers save as you go.',
    `There are ${a.questions.length} question${a.questions.length === 1 ? '' : 's'}.${due ? ` If you can, please answer by ${due}.` : ''} Any questions, just reply to this email.`,
    'Gainora',
  ], { label: 'Answer the questions', url: askUrl(a.token) }, { replyTo: REPLY_TO() });
  let taskId = a.client_task_id;
  if (!taskId) {
    const [t] = await insert<any>('admin_tasks', { id: randomUUID(), email: a.email, project: templateFor(a.template).next?.project ?? 'other', template_key: null, title: `Answer: ${a.title}`, detail: `Questions sent to ${to}. Their link: ${askUrl(a.token)}`, who: 'client', due_on: a.due_on, status: 'todo', done_at: null, sort: 50, created_by: by, created_at: iso() });
    taskId = t?.id ?? null;
  }
  const [saved] = await db<Ask[]>(`client_asks?id=eq.${a.id}`, { method: 'PATCH', body: { status: a.status === 'draft' ? 'sent' : a.status, sent_to: to, sent_at: a.sent_at ?? iso(), client_task_id: taskId, updated_at: iso() }, prefer: 'return=representation' });
  await log(a.email, by, `${a.sent_at ? 'Sent again' : 'Asked'}: ${a.title} (${a.questions.length} questions, to ${to}).`, 'email');
  return saved;
}

export async function remindAsk(id: string, by: string, firstName?: string): Promise<void> {
  const a = await askById(id);
  if (a.status !== 'sent' && a.status !== 'opened') throw new HttpError(409, 'Only questions that haven’t been answered can be chased.');
  await sendEmail(a.sent_to || a.email, `Reminder: ${a.title}`, [
    `Hi ${firstName || 'there'},`,
    'Just a nudge on the questions we sent. Whatever you’ve already filled in is saved, so it only takes a few minutes to finish.',
    'If anything’s unclear, reply to this email.', 'Gainora',
  ], { label: 'Finish the questions', url: askUrl(a.token) }, { replyTo: REPLY_TO() });
  await db(`client_asks?id=eq.${a.id}`, { method: 'PATCH', body: { reminded_at: iso(), updated_at: iso() } });
  await log(a.email, by, `Reminded them about: ${a.title}.`, 'email');
}

export async function cancelAsk(id: string, by: string): Promise<void> {
  const a = await askById(id);
  if (a.status === 'answered') throw new HttpError(409, 'They’ve already answered.');
  await db(`client_asks?id=eq.${a.id}`, { method: 'PATCH', body: { status: 'cancelled', updated_at: iso() } });
  if (a.client_task_id) await db(`admin_tasks?id=eq.${a.client_task_id}`, { method: 'DELETE' });
  await log(a.email, by, `Cancelled the questions: ${a.title}.`, 'system');
}

/** Saves what the client has typed so far (the form saves as they go). */
export async function saveAnswers(a: Ask, raw: unknown): Promise<Ask> {
  const answers = { ...a.answers, ...cleanAnswers(a.questions, raw) };
  for (const qn of a.questions) if (raw && typeof raw === 'object' && (raw as any)[qn.id] === '' ) delete answers[qn.id];
  const body: Record<string, unknown> = { answers, updated_at: iso() };
  if (a.status === 'sent') { body.status = 'opened'; body.opened_at = iso(); }
  const [saved] = await db<Ask[]>(`client_asks?id=eq.${a.id}`, { method: 'PATCH', body, prefer: 'return=representation' });
  return saved;
}

/** The client pressed send: their checklist step is ticked, the next piece of work is set up, the team is told. */
export async function finishAsk(a: Ask, raw: unknown): Promise<Ask> {
  const first = !a.answered_at;
  const saved = await saveAnswers(a, raw);
  const [done] = await db<Ask[]>(`client_asks?id=eq.${a.id}`, { method: 'PATCH', body: { status: 'answered', answered_at: iso(), updated_at: iso() }, prefer: 'return=representation' });
  const result = done ?? saved;
  if (first) {
    if (a.client_task_id) await db(`admin_tasks?id=eq.${a.client_task_id}`, { method: 'PATCH', body: { status: 'done', done_at: iso() } }).catch(() => {});
    const next = templateFor(a.template).next;
    if (next && !a.next_task_id) {
      const [t] = await insert<any>('admin_tasks', { id: randomUUID(), email: a.email, project: next.project, template_key: null, title: next.title, detail: next.detail, who: next.who, due_on: addDays(ukToday(), next.days), status: 'todo', done_at: null, sort: 40, created_by: 'Gainora (automatic)', created_at: iso() }).catch(() => [null]);
      if (t?.id) await db(`client_asks?id=eq.${a.id}`, { method: 'PATCH', body: { next_task_id: t.id } }).catch(() => {});
    }
  }
  await log(a.email, 'Client', `${first ? 'Answered' : 'Updated their answers'}: ${a.title}.`, 'note');
  const team = gainoraEmails()[0];
  await sendEmail(team, `${first ? 'Answers in' : 'Answers updated'}: ${a.title} (${a.email})`, [
    `${a.email} ${first ? 'answered' : 'updated their answers to'} “${a.title}”.`,
    answersText(result).slice(0, 12000),
  ], { label: 'Open their client page', url: `${ADMIN_ORIGIN()}/clients/${encodeURIComponent(a.email)}?section=questions` }).catch(() => {});
  return result;
}

/** A photo from the form, stored in the site-media bucket in the client's folder (usable on their website). */
export async function addPhoto(a: Ask, questionId: string, name: string, type: string, bytes: ArrayBuffer): Promise<{ url: string; name: string; question: string }> {
  const qn = a.questions.find((x) => x.id === questionId && x.type === 'photos');
  if (!qn) throw new HttpError(400, 'Unknown question.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new HttpError(415, 'Photos only: JPEG, PNG or WebP.');
  if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) throw new HttpError(413, 'That photo is too big. Under 5 MB, please.');
  if (a.files.length >= 40) throw new HttpError(400, 'That’s the most photos we can take here. Email any others to hello@gainora.co.uk.');
  const users = await db<any[]>(`entitlements?select=user_id&email=eq.${encodeURIComponent(a.email)}&user_id=not.is.null&limit=1`).catch(() => []);
  const folder = users[0]?.user_id || 'asks';
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${folder}/from-questions/${a.id.slice(0, 8)}-${randomUUID().slice(0, 12)}.${ext}`;
  const res = await fetch(`${env('SUPABASE_URL')}/storage/v1/object/site-media/${path}`, {
    method: 'POST',
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': type, 'Cache-Control': '31536000' },
    body: bytes,
  }).catch(() => null);
  if (!res?.ok) throw new HttpError(502, 'The photo didn’t upload. Try again.');
  const file = { url: `${env('SUPABASE_URL')}/storage/v1/object/public/site-media/${path}`, name: String(name || 'photo').replace(/[^\w .()-]/g, '').slice(0, 120) || 'photo', question: qn.id };
  const fresh = (await db<Ask[]>(`client_asks?select=files,status&id=eq.${a.id}`))[0];
  await db(`client_asks?id=eq.${a.id}`, { method: 'PATCH', body: { files: [...(fresh?.files ?? []), file], updated_at: iso(), ...(fresh?.status === 'sent' ? { status: 'opened', opened_at: iso() } : {}) } });
  return file;
}
export async function removePhoto(a: Ask, url: string): Promise<void> {
  const fresh = (await db<Ask[]>(`client_asks?select=files&id=eq.${a.id}`))[0];
  await db(`client_asks?id=eq.${a.id}`, { method: 'PATCH', body: { files: (fresh?.files ?? []).filter((f) => f.url !== url), updated_at: iso() } });
}

/** A one-off email to a client from the admin, kept on their record. Replies go to Gainora's inbox. */
export async function emailClient(email: string, to: string, subject: string, message: string, by: string): Promise<void> {
  const addr = normEmail(to || email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) throw new HttpError(400, 'That email address doesn’t look right.');
  const s = String(subject || '').trim().slice(0, 160);
  const m = String(message || '').trim().slice(0, 8000);
  if (!s || !m) throw new HttpError(400, 'Write a subject and a message.');
  await sendEmail(addr, s, m.split(/\n{2,}/), undefined, { replyTo: REPLY_TO() });
  await log(email, by, `Email to ${addr}: “${s}”\n\n${m}`, 'email');
}
