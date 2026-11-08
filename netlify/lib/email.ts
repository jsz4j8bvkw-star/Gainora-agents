// Transactional email through Resend (https://resend.com). Optional: if RESEND_API_KEY is not set, emails are skipped.
import { env } from './core';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function emailHtml(paragraphs: string[], cta?: { label: string; url: string }): string {
  // Black and champagne, matching the app and gainora.co.uk.
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;font:16px/1.6 Georgia,serif;color:#1A1A1C">${esc(p)}</p>`).join('');
  const button = cta ? `<p style="margin:24px 0 4px"><a href="${esc(cta.url)}" style="display:inline-block;background:#111214;color:#E9E5DD;text-decoration:none;font:600 15px/1 Arial,sans-serif;padding:14px 22px;border-radius:6px;border:1px solid #C9B37E">${esc(cta.label)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#F4F4F2"><div style="max-width:560px;margin:0 auto;padding:32px 24px"><div style="background:#111214;border-radius:12px 12px 0 0;padding:18px 28px;font:600 19px Georgia,serif;letter-spacing:0.02em;color:#E9E5DD">Gainora<span style="color:#C9B37E">.</span></div><div style="background:#fff;border:1px solid #E4E3DF;border-top:2px solid #C9B37E;border-radius:0 0 12px 12px;padding:28px">${body}${button}</div><p style="font:12px/1.5 Arial,sans-serif;color:#6F6C66;margin-top:18px">Gainora, gainora.co.uk. You receive this because you subscribe to Gainora Capture &amp; Convert. Change alerts in Settings.</p></div></body></html>`;
}

export async function sendEmail(to: string, subject: string, paragraphs: string[], cta?: { label: string; url: string }) {
  const key = env('RESEND_API_KEY');
  if (!key) { console.log('[gainora] email skipped (no RESEND_API_KEY):', subject); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('EMAIL_FROM', 'Gainora <hello@gainora.co.uk>'), to: [to], subject, html: emailHtml(paragraphs, cta), text: paragraphs.join('\n\n') + (cta ? `\n\n${cta.label}: ${cta.url}` : '') }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
}
