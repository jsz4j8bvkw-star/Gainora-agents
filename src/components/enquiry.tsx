import { Link } from '../lib/router';
import { Icon } from './ui';
import { phone, relative } from '../lib/format';
import { CHANNEL_LABEL, KIND_LABEL, statusLabel } from '../../shared/capture';
import { useApp } from '../app';
import type { EnquiryRecord } from '../lib/types';

export const CHANNEL_ICON: Record<EnquiryRecord['channel'], string> = { call: 'phone', form: 'form', email: 'mail', text: 'message' };

export const who = (e: EnquiryRecord) => e.name || phone(e.phone) || e.email || 'Unknown caller';

export function StatusTag({ e }: { e: EnquiryRecord }) {
  const cls = e.status === 'new' ? 'tag-brass' : e.status === 'won' ? 'tag-forest' : e.status === 'spam' || e.status === 'lost' ? 'tag-plain' : 'tag-plain';
  const { settings } = useApp();
  return <span className={`tag ${cls}`}>{statusLabel(e.status, settings.business.kind)}</span>;
}

export function UrgencyTag({ e }: { e: EnquiryRecord }) {
  if (e.urgency === 'emergency') return <span className="tag tag-danger"><Icon name="alert" className="tag-ico" />Emergency</span>;
  if (e.urgency === 'urgent') return <span className="tag tag-brass">Urgent</span>;
  return null;
}

/** why: the one-line reason this enquiry is where it is in the list (from shared/insight priority). */
export function EnquiryRow({ e, compact = false, why, step }: { e: EnquiryRecord; compact?: boolean; why?: string; step?: string }) {
  const { messages } = useApp();
  const reply = messages.filter((m) => m.enquiryId === e.id && m.direction === 'in' && !m.read).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return (
    <Link to={`/enquiries/${e.id}`} className={`enq-row ${e.status === 'new' || reply ? 'unread' : ''} urg-${e.urgency}`}>
      <span className="enq-ico" title={CHANNEL_LABEL[e.channel]}><Icon name={CHANNEL_ICON[e.channel]} /><span className="sr-only">{CHANNEL_LABEL[e.channel]}</span></span>
      <span className="enq-main">
        <span className="enq-top">
          <span className="enq-name">{who(e)}</span>
          <UrgencyTag e={e} />
          {e.afterHours && <span className="tag tag-plain"><Icon name="moon" className="tag-ico" />Out of hours</span>}
          {!compact && e.kind !== 'other' && e.kind !== 'spam' && e.status !== 'booked' && <span className="tag tag-plain">{KIND_LABEL[e.kind]}</span>}
          {reply && <span className="tag tag-brass"><Icon name="message" className="tag-ico" />New reply</span>}
          {e.isTest && <span className="tag tag-plain">Test</span>}
          {why && <span className="xsmall faint">{why}</span>}
        </span>
        {step && <span className="enq-step">{step}</span>}
        <span className="enq-summary">{reply ? `“${reply.body}”` : e.summary || 'No summary sent.'}</span>
      </span>
      <span className="enq-side">
        <span className="xsmall faint" style={{ whiteSpace: 'nowrap' }}>{relative(e.receivedAt)}</span>
        {!compact && <StatusTag e={e} />}
      </span>
    </Link>
  );
}
