import type { CaptureSettings, EnquiryPatch, EnquiryRecord, MessageRecord, NewEnquiry, Plan, Source, User } from './types';
import type { PageTimes } from '../book/BookingPage';
import type { ImportedBooking } from '../../shared/importer';

export interface DiaryBooking { type: string; slot: string; name: string; phone: string; email?: string; notes?: string; newClient?: boolean }
import { createDemoApi } from './demo';
import { createLiveApi } from './live';

declare const __DEMO__: boolean;

export interface Api {
  mode: 'demo' | 'live';
  getUser(): Promise<User | null>;
  /** In the demo, which sample business to open: a plumber or a physio clinic. */
  /** Emails a sign-in link: the first time in, or when they've forgotten their password. (Demo: opens the demo.) */
  requestSignIn(email: string, sample?: 'trade' | 'clinic' | 'beauty'): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  /** Sets (or changes) the password for the signed-in user. */
  setPassword(password: string): Promise<void>;
  signOut(): Promise<void>;

  getPlan(): Promise<Plan>;
  billingUrl(): Promise<string | null>;
  getSettings(): Promise<CaptureSettings | null>;
  saveSettings(s: CaptureSettings): Promise<void>;

  listEnquiries(): Promise<EnquiryRecord[]>;
  addEnquiry(e: NewEnquiry): Promise<EnquiryRecord>;
  updateEnquiry(id: string, patch: EnquiryPatch): Promise<EnquiryRecord>;
  deleteEnquiry(id: string): Promise<void>;
  draftReply(id: string): Promise<string>;
  sendTest(): Promise<EnquiryRecord>;

  // Messages: automatic ones, the owner's replies and customers' replies
  listMessages(): Promise<MessageRecord[]>;
  reply(enquiryId: string, channel: 'text' | 'email', text: string, subject?: string): Promise<{ message: MessageRecord; enquiry: EnquiryRecord }>;
  approveMessage(id: string, text?: string): Promise<void>;
  skipMessage(id: string): Promise<void>;
  markRead(enquiryId: string): Promise<void>;
  testText(text: string): Promise<void>;

  listSources(): Promise<Source[]>;
  createSource(label: string, channel: Source['channel']): Promise<Source>;
  revokeSource(id: string): Promise<void>;

  // The diary: free times, putting a booking in, and the booking page's address
  diaryTimes(type: string, who: string, from: string, days: number): Promise<PageTimes>;
  diaryBook(b: DiaryBooking): Promise<EnquiryRecord>;
  slugFree(slug: string): Promise<{ slug: string; free: boolean }>;
  /** The demo only: a booking made on the booking page preview, so it lands in the demo diary. */
  pageBook?(b: DiaryBooking): Promise<EnquiryRecord>;
  /** Appointments from the clinic's old system: upcoming ones into the diary, past ones as visit history. */
  importBookings(bookings: ImportedBooking[], system: string): Promise<{ added: number; already: number; rejected: number }>;
  /** Connecting Google Calendar or Cliniko: list, google-start, google-save, cliniko-connect, cliniko-save, disconnect. */
  connect(op: string, payload?: Record<string, unknown>): Promise<any>;

  resetDemo?(): void;
}

export const api: Api = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? createDemoApi() : createLiveApi();
