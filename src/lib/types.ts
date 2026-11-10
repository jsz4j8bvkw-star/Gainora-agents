export type {
  CaptureSettings, EnquiryRecord, PackageId, EnquiryPatch, EnquiryStatus, EnquiryKind, Channel, Urgency, FollowItem, FollowKind, Report, HistoryItem, QuotePolicy,
} from '../../shared/capture';

export interface User {
  id: string; email: string;
  /** They've chosen a password for their Gainora login. */
  hasPassword?: boolean;
  /** A password must be chosen before the app opens: 'create' the first time, 'new' after an email-link sign-in. */
  passwordStep?: 'create' | 'new';
}

export interface Plan {
  active: boolean;
  package?: import('../../shared/capture').PackageId;
  renewsOn?: string;
  alsoCommandCentre: boolean;   // the same login also has Gainora Agents
}

export interface Source {
  id: string;
  label: string;
  channel: 'call' | 'form' | 'email' | 'text';
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  url?: string;                  // only straight after it's made
  lookupUrl?: string;            // call links: the returning-caller lookup, same secret, shown once
  toolsUrl?: string;             // call links: the receptionist's diary tools, same secret, shown once
}

export interface NewEnquiry { channel: 'call' | 'form' | 'email' | 'text'; name: string; phone: string; email: string; postcode: string; summary: string }

export interface MessageRecord {
  id: string;
  enquiryId: string | null;
  direction: 'in' | 'out';
  audience: 'customer' | 'owner';
  channel: 'text' | 'email';
  to: string; from: string;
  subject: string; body: string;
  automatic: boolean;
  workflow: string | null; step: string | null; key: string | null;
  status: 'awaiting_approval' | 'sending' | 'sent' | 'failed' | 'skipped' | 'received';
  error: string | null;
  read: boolean;
  createdAt: string; sentAt: string | null;
}
