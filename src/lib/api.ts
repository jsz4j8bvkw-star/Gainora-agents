import type {
  Action, BriefReport, BusinessProfile, ChatMessage, FeedbackKind, FeedbackRecord, HomeData, Lead, LeadStage, PlaceSummary, Plan,
  ScoutKind, ScoutSearch, Tender, User, ValueEvent, WatcherState, WeekNumbers, WinbackDrafts,
} from './types';
import { createDemoApi } from './demo';
import { createLiveApi } from './live';

declare const __DEMO__: boolean;

export interface Api {
  mode: 'demo' | 'live';
  getUser(): Promise<User | null>;
  requestSignIn(email: string): Promise<void>;
  signOut(): Promise<void>;

  getProfile(): Promise<BusinessProfile | null>;
  saveProfile(p: BusinessProfile): Promise<void>;
  getPlan(): Promise<Plan>;
  billingUrl(): Promise<string | null>;

  getHome(): Promise<HomeData>;
  setActionDone(id: string, done: boolean): Promise<void>;
  addAction(text: string): Promise<Action>;
  markAlertsRead(): Promise<void>;

  getWatcher(): Promise<WatcherState>;
  runWatcher(): Promise<WatcherState>;

  listScout(): Promise<ScoutSearch[]>;
  startScout(query: string, area: string, kind?: ScoutKind): Promise<ScoutSearch>;
  getScout(id: string): Promise<ScoutSearch>;
  setScoutSaved(searchId: string, resultId: string, saved: boolean): Promise<void>;
  draftIntro(searchId: string, resultId: string): Promise<string>;

  getNumbers(): Promise<WeekNumbers[]>;
  saveNumbers(w: WeekNumbers): Promise<BriefReport>;
  listBriefs(): Promise<BriefReport[]>;

  getChat(): Promise<ChatMessage[]>;
  sendChat(text: string): Promise<ChatMessage>;

  // Value tracker and learning
  listValue(): Promise<ValueEvent[]>;
  sendFeedback(f: { agent: 'watcher' | 'scout' | 'brief'; itemKind: FeedbackKind; itemId: string; verdict: 'useful' | 'not_relevant'; reason?: string; text: string; host?: string; changeKind?: string }): Promise<void>;
  listFeedback(): Promise<FeedbackRecord[]>;
  forgetFeedback(id: string): Promise<void>;

  // Google reviews and website speed (The Watcher)
  findPlaces(query: string): Promise<PlaceSummary[]>;
  selectPlace(placeId: string): Promise<WatcherState>;
  draftReviewReply(reviewId: string): Promise<string>;
  setFixDone(fixTitle: string, done: boolean): Promise<void>;
  /** Shape the watched competitors: not a competitor / watch another nearby / restore / set an Instagram handle. */
  updateCompetitor(op: 'dismiss' | 'watch' | 'restore' | 'instagram', key: string, handle?: string): Promise<WatcherState>;
  /** Ask the Watcher to look for businesses nearby now (at most weekly). */
  findCompetitors(): Promise<{ started: boolean; message?: string }>;

  // Lead pipeline (The Scout)
  listLeads(): Promise<Lead[]>;
  addLead(searchId: string, resultId: string): Promise<Lead>;
  updateLead(id: string, patch: { stage?: LeadStage; value?: number | null; followUpSent?: boolean }): Promise<Lead>;
  draftFollowUp(id: string): Promise<string>;

  // Public contracts (The Scout)
  listTenders(): Promise<Tender[]>;
  updateTender(id: string, status: Tender['status']): Promise<void>;

  // Win-back messages (The Brief)
  draftWinback(): Promise<WinbackDrafts>;

  resetDemo?(): void;
  fillSample?(): BusinessProfile;
}

export const api: Api = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? createDemoApi() : createLiveApi();
