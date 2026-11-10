// The clinic's own calendar or booking system, when connected: busy times in, new bookings out.
// Filled in by the connection providers (Google Calendar, Pabau, Cliniko). Until a clinic connects one,
// Gainora's own diary is the whole picture.
import type { CaptureSettings } from '../../shared/capture';
import type { Busy } from '../../shared/diary';

export interface PushedBooking { start: string; minutes: number; type: string; who: string; name: string; phone: string; email: string; notes: string; enquiryId: string }

export async function externalBusy(_userId: string, _s: CaptureSettings, _from: Date, _to: Date): Promise<Busy[]> { return []; }
export async function pushBooking(_userId: string, _s: CaptureSettings, _b: PushedBooking): Promise<void> {}
