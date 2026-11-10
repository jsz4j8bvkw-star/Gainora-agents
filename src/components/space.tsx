import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link } from '../lib/router';
import { Button, Icon, copyText, useToast } from './ui';
import { who } from './enquiry';
import { money, time12 } from '../lib/format';
import { openSpaces, spaceCandidates, type OpenSpace } from '../../shared/insight';
import type { EnquiryRecord } from '../lib/types';

/**
 * A cancelled appointment that's still ahead: who could take the space, each with a text drafted for them.
 * The owner reads and sends each one. With Gainora texting on it sends from the clinic's number; otherwise it
 * opens their own Messages app.
 */
export function FillTheSpace({ e }: { e: EnquiryRecord }) {
  const { enquiries, settings, putEnquiry, putMessage } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const space: OpenSpace | undefined = useMemo(() => openSpaces(enquiries ?? [], settings).find((x) => x.enquiry.id === e.id), [enquiries, settings, e.id]);
  const list = useMemo(() => (space ? spaceCandidates(space, enquiries ?? [], settings) : []), [space, enquiries, settings]);
  if (!space) return null;
  const texting = settings.texting?.status === 'on';

  const send = async (c: EnquiryRecord) => {
    setBusy(true);
    try {
      const r = await api.reply(c.id, 'text', text.trim());
      putMessage(r.message); putEnquiry(r.enquiry);
      setSent((x) => [...x, c.id]); setOpen(null);
      toast(`Text sent to ${who(c)}.`);
    } catch (err: any) { toast(err?.message || 'Not sent. Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel space-panel" aria-labelledby="space-h">
      <div className="panel-head">
        <div>
          <h2 className="subhead" id="space-h">Fill the space</h2>
          <p className="small faint">{new Date(space.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, {time12(space.at)}{space.who ? ` with ${space.who}` : ''}{space.value ? ` · ${space.value.from ? 'from ' : ''}${money(space.value.amount)}` : ''}</p>
        </div>
      </div>
      <div className="rows">
        {list.length === 0 && <p className="small muted" style={{ padding: '14px 22px' }}>Nobody’s waiting for an appointment or due back right now. If someone rings, your receptionist can offer this time.</p>}
        {list.map((c) => (
          <div key={c.enquiry.id} className="space-row">
            <div className="row gap-8 wrap" style={{ justifyContent: 'space-between' }}>
              <span className="stack" style={{ minWidth: 0 }}>
                <span className="small" style={{ fontWeight: 600 }}><Link to={`/enquiries/${c.enquiry.id}`}>{who(c.enquiry)}</Link></span>
                <span className="xsmall faint">{c.why}{c.sameTreatment ? ' · same treatment' : ''}</span>
              </span>
              {sent.includes(c.enquiry.id)
                ? <span className="tag tag-forest"><Icon name="check" className="tag-ico" />Sent</span>
                : <Button small kind={open === c.enquiry.id ? 'quiet' : 'secondary'} onClick={() => { if (open === c.enquiry.id) setOpen(null); else { setOpen(c.enquiry.id); setText(c.text); } }}>{open === c.enquiry.id ? 'Close' : 'Offer it'}</Button>}
            </div>
            {open === c.enquiry.id && (
              <div className="stack gap-8 mt-8">
                <label className="sr-only" htmlFor={`sp-${c.enquiry.id}`}>Text to {who(c.enquiry)}</label>
                <textarea id={`sp-${c.enquiry.id}`} className="textarea" rows={5} value={text} onChange={(ev: any) => setText(ev.target.value)} />
                <div className="row gap-8 wrap">
                  {texting
                    ? <Button small icon="send" busy={busy} onClick={() => send(c.enquiry)}>Send text</Button>
                    : <a className="btn btn-primary btn-small" href={`sms:${c.enquiry.phone.replace(/\s/g, '')}?&body=${encodeURIComponent(text)}`} onClick={() => setSent((x) => [...x, c.enquiry.id])}><Icon name="send" />Open in Messages</a>}
                  <Button small kind="quiet" icon="copy" onClick={async () => toast((await copyText(text)) ? 'Copied.' : 'Select it and copy.')}>Copy</Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="xsmall faint" style={{ padding: '10px 22px 16px' }}>People who asked for an appointment and haven’t booked come first, then clients due back. When someone says yes, open their enquiry and mark it booked: they get the confirmation as usual.</p>
    </section>
  );
}

/** For the Today page: cancelled appointments still ahead, with how many people could take each. */
export function useOpenSpaces() {
  const { enquiries, settings } = useApp();
  return useMemo(() => openSpaces(enquiries ?? [], settings).map((sp) => ({ space: sp, count: spaceCandidates(sp, enquiries ?? [], settings).length })), [enquiries, settings]);
}
