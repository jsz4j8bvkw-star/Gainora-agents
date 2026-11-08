import type { CaptureSettings, EnquiryPatch, EnquiryRecord, NewEnquiry, Plan, Source, User } from './types';
import { createDemoApi } from './demo';
import { createLiveApi } from './live';

declare const __DEMO__: boolean;

export interface Api {
  mode: 'demo' | 'live';
  getUser(): Promise<User | null>;
  /** In the demo, which sample business to open: a plumber or a physio clinic. */
  requestSignIn(email: string, sample?: 'trade' | 'clinic'): Promise<void>;
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

  listSources(): Promise<Source[]>;
  createSource(label: string, channel: Source['channel']): Promise<Source>;
  revokeSource(id: string): Promise<void>;

  resetDemo?(): void;
}

export const api: Api = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? createDemoApi() : createLiveApi();
