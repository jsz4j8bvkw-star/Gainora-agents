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

export function EnquiryRow({ e, compact = false }: { e: EnquiryRecord; compact?: boolean }) {
  const { messages } = useApp();
  const replied = messages.some((m) => m.enquiryId === e.id && m.direction === 'in' && !m.read);
  return (
    <Link to={`/enquiries/${e.id}`} className={`enq-row ${e.status === 'new' || replied ? 'unread' : ''} urg-${e.urgency}`}>
      <span className="enq-ico" title={CHANNEL_LABEL[e.channel]}><Icon name={CHANNEL_ICON[e.channel]} /><span className="sr-only">{CHANNEL_LABEL[e.channel]}</span></span>
      <span className="enq-main">
        <span className="enq-top">
          <span className="enq-name">{who(e)}</span>
          <UrgencyTag e={e} />
          {e.afterHours && <span className="tag tag-plain"><Icon name="moon" className="tag-ico" />Out of hours</span>}
          {!compact && e.kind !== 'other' && e.kind !== 'spam' && <span className="tag tag-plain">{e.status === 'booked' ? 'Booked' : KIND_LABEL[e.kind]}</span>}
          {replied && <span className="tag tag-brass"><Icon name="message" className="tag-ico" />New reply</span>}
          {e.isTest && <span className="tag tag-plain">Test</span>}
        </span>
        <span className="enq-summary">{e.summary || 'No summary sent.'}</span>
      </span>
      <span className="enq-side">
        <span className="xsmall faint" style={{ whiteSpace: 'nowrap' }}>{relative(e.receivedAt)}</span>
        {!compact && <StatusTag e={e} />}
      </span>
    </Link>
  );
}
