export type {
  CaptureSettings, EnquiryRecord, EnquiryPatch, EnquiryStatus, EnquiryKind, Channel, Urgency, FollowItem, FollowKind, Report, HistoryItem, QuotePolicy,
} from '../../shared/capture';

export interface User { id: string; email: string }

export interface Plan {
  active: boolean;
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
}

export interface NewEnquiry { channel: 'call' | 'form' | 'email' | 'text'; name: string; phone: string; email: string; postcode: string; summary: string }
