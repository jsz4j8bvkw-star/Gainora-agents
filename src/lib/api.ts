import type {
  CaptureWeek, WebsiteState, WebsiteEnquiry, WebsiteListItem, ChangeRequest,
  Action, BriefReport, BusinessProfile, ChatMessage, Client, ClientAction, ClientsData, FeedbackKind, FeedbackRecord, HomeData, Lead, LeadStage, Outcome, PlaceSummary, Plan,
  ScoutKind, ScoutSearch, Tender, User, ValueEvent, Visit, WatcherState, WeekNumbers, WinbackDrafts,
} from './types';
import type { Photo, Site } from '../../shared/site/data';
import type { Performance } from '../../shared/site/stats';
import { createDemoApi } from './demo';
import { createLiveApi } from './live';

declare const __DEMO__: boolean;

export interface Api {
  mode: 'demo' | 'live';
  getUser(): Promise<User | null>;
  /** Emails a sign-in link: the first time in, or when they've forgotten their password. */
  requestSignIn(email: string): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  /** Sets (or changes) the password for the signed-in user. */
  setPassword(password: string): Promise<void>;
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
  /** The last seven days from Capture & Convert, when they have it. Null when they don't, or it can't be read. */
  getCaptureWeek(): Promise<CaptureWeek | null>;

  /** Launch & Grow website. Null when it isn't on their plan. */
  getWebsite(): Promise<WebsiteState | null>;
  saveWebsite(data: Site): Promise<WebsiteState>;
  publishWebsite(data: Site): Promise<WebsiteState>;
  unpublishWebsite(): Promise<WebsiteState>;
  setWebsiteSlug(slug: string): Promise<WebsiteState>;
  setWebsiteDomain(domain: string): Promise<WebsiteState>;
  websiteStats(days: number): Promise<Performance>;
  websiteEnquiries(): Promise<WebsiteEnquiry[]>;
  uploadSitePhoto(file: File): Promise<Photo>;
  websiteRequests(): Promise<ChangeRequest[]>;
  /** The client asks Gainora to change the design, wording, photos or pages. */
  requestWebsiteChange(page: string, text: string): Promise<ChangeRequest>;
  /** Gainora's team only. */
  completeWebsiteRequest(id: string, reply: string): Promise<ChangeRequest>;
  listWebsites(): Promise<WebsiteListItem[]>;
  /** Gainora's team only: which client's website the Website page works on (null: their own). */
  setWebsiteClient(slug: string | null): void;
  /** Demo only: switch the Website page between the client's view and Gainora's. */
  setWebsiteRole?(role: 'owner' | 'gainora'): void;
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

  // Your clients: the owner's own records, written by the app under row-level security.
  // Every call tolerates the tables not existing yet (`ready: false`): nothing here can crash the page.
  listClients(): Promise<ClientsData>;
  saveClient(c: Client): Promise<Client>;                       // insert or update
  deleteClient(id: string): Promise<void>;                      // the client and everything about them
  addVisit(v: Visit): Promise<{ visit: Visit; likely: Outcome[] }>;   // and any new "likely" outcomes it creates
  deleteVisit(id: string): Promise<void>;
  importClients(clients: Client[], visits: Visit[], optOutIds: string[]): Promise<void>;
  recordAction(a: ClientAction): Promise<ClientAction>;         // a message the owner approved and sent, or a pack used
  saveOutcome(o: Outcome): Promise<Outcome>;                    // confirm, dismiss or add a booking
  deleteOutcome(id: string): Promise<void>;
  deleteAllClientData(): Promise<void>;
  /** Sends through the connected SMS provider (Twilio) when one is set up; otherwise says so. Never used without the owner's approval. */
  sendSms(action: ClientAction, phone: string): Promise<{ sent: boolean; message?: string }>;

  resetDemo?(): void;
  fillSample?(): BusinessProfile;
}

export const api: Api = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? createDemoApi() : createLiveApi();
