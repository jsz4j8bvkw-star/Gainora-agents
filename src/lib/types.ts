import type { SpeedState } from '../../shared/speed';
import type { ReviewsState } from '../../shared/reviews';
import type { PriceTable } from '../../shared/prices';
import type { LeadStage } from '../../shared/leads';
import type { TodayItem } from '../../shared/today';
import type { CompetitorsState } from '../../shared/competitors';
import type { ScoutFocus } from '../../shared/scout';
export type { ScoutFocus, ScoutMode } from '../../shared/scout';
export type { ValueEvent, ValueKind, ValueSummary } from '../../shared/value';
export type { FeedbackRecord, FeedbackKind, Learned } from '../../shared/learning';
export type { SpeedState, Fix } from '../../shared/speed';
export type { ReviewsState, ReviewItem, PlaceSummary } from '../../shared/reviews';
export type { PriceTable, PriceRow, PriceCell } from '../../shared/prices';
export type { LeadStage } from '../../shared/leads';
export type { TodayItem } from '../../shared/today';
export type { CompetitorsState, TrackedCompetitor, NearbyPlace, ReachEvent, ReachAdvice, ServiceLine, OfferLine, InstagramSnapshot, InstaPost } from '../../shared/competitors';
export type { Client, Visit, Consent, ClientSettings, DueInfo, DueStatus, ClientFilter, MessageKind } from '../../shared/clients';
export type { ClientAction, Outcome, OutcomeStatus, ActionKind, Channel, MoneySummary } from '../../shared/money';
import type { ClientSettings } from '../../shared/clients';
import type { Client, Visit } from '../../shared/clients';
import type { ClientAction, Outcome } from '../../shared/money';

export type AgentId = 'watcher' | 'scout' | 'brief';

/**
 * Everything under "Your clients". `ready` is false when the account's database does not have the
 * client tables yet (the migration has not been run): the app shows a "being set up" state and never crashes.
 */
export interface ClientsData {
  ready: boolean;
  clients: Client[];
  visits: Visit[];
  actions: ClientAction[];
  outcomes: Outcome[];
}
export const emptyClientsData = (ready = false): ClientsData => ({ ready, clients: [], visits: [], actions: [], outcomes: [] });

export interface Competitor { name: string; url: string }

export interface BusinessProfile {
  business: {
    name: string; website: string; instagram?: string; facebook?: string; oneLiner: string; industry: string; location: string; postcode?: string;
    tradingSince: string; teamSize: string; legalForm: string; ownerName: string;
  };
  offer: {
    products: string; typicalPrice: string; salesChannels: string[]; bestSeller: string;
    /** The booking system (Fresha, Phorest…), the public booking page, and the owner's own price list, one line per treatment. All optional. */
    bookingSystem?: string; bookingUrl?: string; priceList?: string;
  };
  customers: { ideal: string; sources: string[]; areas: string[]; repeat: string };
  competitors: { list: Competitor[]; ourEdge: string; theirEdge: string };
  numbers: { revenueBand: string; enquiriesPerWeek: string; salesPerWeek: string; averageOrder: string; track: string[] };
  goals: { focus: string; detail: string; target: string; twelveMonth: string; obstacle: string; timePerWeek: string };
  preferences: { reportDay: string; reportTime: string; alerts: string; style: string; extraRecipient: string };
  /** Settings for "Your clients": per-treatment intervals, quiet hours, the weekly cap, the sending mode. Optional; defaults apply. */
  clientSettings?: ClientSettings;
  completedAt?: string;
}

export interface Plan {
  agents: AgentId[];
  status: 'active' | 'trial' | 'none';
  renewsOn?: string;
  /** They also have Gainora Capture & Convert (same login). */
  capture?: boolean;
}

/** The last seven days from Capture & Convert, for The Brief. */
export interface CaptureWeek { from: string; to: string; enquiries: number; afterHours: number; booked: number; bookedValue: number; valueIsMinimum: boolean }

export interface User { id: string; email: string }

export interface Action { id: string; text: string; agent: AgentId | 'you'; done: boolean; createdAt: string }

export interface Alert {
  id: string; agent: AgentId; level: 'urgent' | 'notice' | 'good';
  title: string; body: string; at: string; link?: string; read: boolean;
}

export interface Note { agent: AgentId; body: string }

export interface HealthPoint { at: string; ms: number; up: boolean }

export interface WatcherState {
  site: string;
  social?: { instagram: string; facebook: string };
  lastCheck?: string;
  nextCheck?: string;
  up: boolean;
  responseMs: number;
  uptime30d: number;
  sslDaysLeft: number | null;
  pagesChecked: number;
  brokenLinks: { url: string; foundOn: string; status: number }[];
  issues: { id: string; title: string; detail: string; level: 'urgent' | 'notice'; link?: string }[];
  history: HealthPoint[];
  changes: CompetitorChange[];
  reviews?: ReviewsState | null;
  speed?: SpeedState | null;
  prices?: PriceTable | null;
  /** The competition: who is nearby, what they offer and charge, how their reviews move. */
  competitors?: CompetitorsState | null;
}

export interface CompetitorChange {
  id: string; competitor: string; url: string; at: string;
  kind: 'price' | 'offer' | 'content' | 'new-page';
  summary: string; detail?: string;
}

export interface ScoutResult {
  id: string; name: string; location: string; website: string;
  fit: 'strong' | 'possible'; reason: string;
  source: { title: string; url: string };
  saved: boolean;
  when?: string;          // events: when it happens; public posts: when it was posted
  how?: string;           // events: how to take part
  platform?: string;      // public posts and groups: where it lives ("Reddit r/Crewe", "Nextdoor", "Mumsnet")
  next?: string;          // the concrete next step for the owner
  draft?: string;         // a ready-to-post reply or introduction the owner posts or sends themselves
  dismissed?: boolean;
}

export type ScoutKind = ScoutFocus;

export interface ScoutSearch {
  id: string; query: string; area: string; createdAt: string;
  status: 'running' | 'ready' | 'failed';
  kind?: ScoutKind;
  summary?: string; results: ScoutResult[]; error?: string;
}

export interface Lead {
  id: string;
  name: string; location: string; website: string; reason: string;
  source: { title: string; url: string };
  stage: LeadStage;
  contactedAt?: string | null;
  nextFollowUp?: string | null;
  followUps: number;
  value?: number | null;
  createdAt: string;
}

export interface Tender {
  id: string;              // match id
  tenderId: string;
  title: string; buyer: string; summary: string;
  value: number | null; deadline: string | null; url: string;
  region: string | null; sme: boolean | null;
  fit: 'strong' | 'possible'; reason: string;
  status: 'new' | 'saved' | 'dismissed' | 'applied';
  foundAt: string;
}

export interface WinbackDrafts { email: string; text: string; social: string }

export interface MetricDef { id: string; label: string; unit: 'money' | 'count' | 'percent' }

export interface WeekNumbers { weekOf: string; values: Record<string, number | null>; note?: string }

export interface BriefReport {
  id: string; weekOf: string; headline: string; paragraphs: string[]; actions: string[]; createdAt: string;
}

export interface ChatMessage { id: string; role: 'user' | 'agent'; text: string; at: string; sources?: { title: string; url: string }[] }

export interface HomeData {
  today?: TodayItem[];   // the ranked "do these today" list (see shared/today.ts)
  /** "Your clients" data for Home's due card, money number and getting-started block. */
  clients?: ClientsData;
  notes: Note[];
  actions: Action[];
  alerts: Alert[];
  goalProgress: { current: number | null; target: number | null; label: string; weeksLeft: number; detail?: string };
  agentStatus: Record<AgentId, { line: string; lastRun?: string; nextRun?: string }>;
}
