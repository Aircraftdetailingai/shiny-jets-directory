// Builds the same JSON body the public request form posts to
// POST {CRM}/api/lead-intake/leads and creates an intake_leads row in that
// detailer's Shiny Jets CRM. source stays "flow_request_page" so the lead
// lands in the existing Requests inbox.

import type { RateLimiter } from '../rate-limit';

export const INTAKE_PATH = '/api/lead-intake/leads';
export const INTAKE_SOURCE = 'flow_request_page';

export const INTAKE_BODY_KEYS = [
  'detailer_id',
  'name',
  'email',
  'phone',
  'company',
  'aircraft_model',
  'tail_number',
  'airport',
  'services_requested',
  'notes',
  'photo_urls',
  'intake_responses',
  'source',
] as const;

export interface ValidQuote {
  slug: string;
  aircraft: string;
  airport: string;
  preferred_dates: string;
  service: string;
  contact_name: string;
  email: string;
  phone: string;
  notes: string;
}

export interface IntakeLeadBody {
  detailer_id: string;
  name: string;
  email: string;
  phone: string;
  company: null;
  aircraft_model: string;
  tail_number: null;
  airport: string;
  services_requested: string;
  notes: string;
  photo_urls: null;
  intake_responses: Record<string, string>;
  source: typeof INTAKE_SOURCE;
}

export type PostLeadResult = { ok: true; leadId: string } | { ok: false; error: string };

export type QuoteToolResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; retry_after_seconds?: number };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function asText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function validateQuote(input: Record<string, unknown>): { ok: true; value: ValidQuote } | { ok: false; error: string } {
  const missing: string[] = [];
  const slugRaw = asText(input.slug, 80);
  const aircraft = asText(input.aircraft, 120);
  const airportRaw = asText(input.airport, 80);
  const preferred = asText(input.preferred_dates, 200);
  const service = asText(input.service, 160);
  const name = asText(input.contact_name, 120);
  const emailRaw = asText(input.email, 200);
  const phoneRaw = typeof input.phone === 'string' ? input.phone.trim().slice(0, 30) : '';
  if (!slugRaw) missing.push('slug');
  if (!aircraft) missing.push('aircraft');
  if (!airportRaw) missing.push('airport');
  if (!preferred) missing.push('preferred_dates');
  if (!service) missing.push('service');
  if (!name) missing.push('contact_name');
  if (!emailRaw) missing.push('email');
  if (!phoneRaw) missing.push('phone');
  if (missing.length > 0) return { ok: false, error: `Missing ${missing.join(', ')}.` };

  const slug = slugRaw!.toLowerCase();
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'slug must be the detailer slug from search_detailers, such as shiny-jets.' };
  if (aircraft!.length < 2) return { ok: false, error: 'aircraft must include the make and model.' };
  if (!/[A-Za-z]/.test(name!)) return { ok: false, error: 'contact_name must include the customer\'s name.' };
  const email = emailRaw!.toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'email must be a valid email address.' };
  const digits = phoneRaw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || /[A-Za-z]/.test(phoneRaw)) {
    return { ok: false, error: 'phone must be a phone number with 7 to 15 digits.' };
  }
  let notes = '';
  if (input.notes != null && input.notes !== '') {
    if (typeof input.notes !== 'string') return { ok: false, error: 'notes must be a string.' };
    notes = input.notes.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
  }
  const airport = /^[A-Za-z0-9-]{2,7}$/.test(airportRaw!) ? airportRaw!.toUpperCase() : airportRaw!;
  return {
    ok: true,
    value: {
      slug,
      aircraft: aircraft!,
      airport,
      preferred_dates: preferred!,
      service: service!,
      contact_name: name!,
      email,
      phone: phoneRaw,
      notes,
    },
  };
}

export function quoteDedupeKey(value: ValidQuote): string {
  return [value.slug, value.email, value.aircraft, value.airport, value.preferred_dates, value.service]
    .join('|')
    .toLowerCase();
}

export function buildIntakeLeadBody(detailerId: string, value: ValidQuote): IntakeLeadBody {
  const noteLines = [
    `Preferred dates: ${value.preferred_dates}`,
    value.notes ? `Notes: ${value.notes}` : '',
    'Requested via the Shiny Jets directory on Meta Muse.',
  ].filter(Boolean);
  const intake: Record<string, string> = {
    Aircraft: value.aircraft,
    Airport: value.airport,
    'Preferred dates': value.preferred_dates,
    Service: value.service,
  };
  if (value.notes) intake.Notes = value.notes;
  return {
    detailer_id: detailerId,
    name: value.contact_name,
    email: value.email,
    phone: value.phone,
    company: null,
    aircraft_model: value.aircraft,
    tail_number: null,
    airport: value.airport,
    services_requested: value.service,
    notes: noteLines.join('\n'),
    photo_urls: null,
    intake_responses: intake,
    source: INTAKE_SOURCE,
  };
}

export function quoteSuccess(value: ValidQuote, detailer: { company: string; slug: string }, leadId: string, duplicate: boolean): Record<string, unknown> {
  return {
    status: 'requested',
    duplicate,
    lead_id: leadId,
    detailer: { slug: detailer.slug, company: detailer.company },
    submitted: {
      aircraft: value.aircraft,
      airport: value.airport,
      preferred_dates: value.preferred_dates,
      service: value.service,
      contact_name: value.contact_name,
      email: value.email,
      phone: value.phone,
      notes: value.notes || null,
    },
    message:
      'Quote request created in the detailer\'s Shiny Jets CRM. Status is requested: the detailer has the lead and follows up with the customer. This is not a confirmed booking and not a price.',
  };
}

export class QuoteDeduper {
  private hits = new Map<string, { at: number; leadId: string }>();
  private windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  get(key: string, now = Date.now()): string | null {
    const hit = this.hits.get(key);
    if (!hit) return null;
    if (now - hit.at > this.windowMs) {
      this.hits.delete(key);
      return null;
    }
    return hit.leadId;
  }

  set(key: string, leadId: string, now = Date.now()) {
    this.hits.set(key, { at: now, leadId });
  }
}

export async function requestQuote(
  input: Record<string, unknown>,
  ctx: { ip: string },
  deps: {
    findDetailer: (slug: string) => Promise<{ id: string; company: string; slug: string } | null>;
    postLead: (body: IntakeLeadBody) => Promise<PostLeadResult>;
    limitEmail: RateLimiter;
    limitIp: RateLimiter;
    deduper: QuoteDeduper;
    now?: () => number;
  },
): Promise<QuoteToolResult> {
  const parsed = validateQuote(input);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const now = deps.now ? deps.now() : Date.now();
  const key = quoteDedupeKey(value);
  const existing = deps.deduper.get(key, now);
  if (existing) {
    const detailer = await deps.findDetailer(value.slug);
    return {
      ok: true,
      data: quoteSuccess(value, { company: detailer?.company || value.slug, slug: value.slug }, existing, true),
    };
  }

  const ip = (ctx.ip || 'unknown').slice(0, 80);
  const ipLimit = deps.limitIp.check(ip, now);
  if (!ipLimit.ok) {
    return { ok: false, error: 'Too many quote requests from this network. Try again later.', retry_after_seconds: ipLimit.retryAfterSec };
  }
  const emailLimit = deps.limitEmail.check(value.email, now);
  if (!emailLimit.ok) {
    return { ok: false, error: 'Too many quote requests for this email. Try again later.', retry_after_seconds: emailLimit.retryAfterSec };
  }

  const detailer = await deps.findDetailer(value.slug);
  if (!detailer) return { ok: false, error: `No listed detailer with slug "${value.slug}".` };

  const posted = await deps.postLead(buildIntakeLeadBody(detailer.id, value));
  if (!posted.ok) return { ok: false, error: posted.error };
  deps.deduper.set(key, posted.leadId, now);
  return { ok: true, data: quoteSuccess(value, detailer, posted.leadId, false) };
}

export async function postCrmIntakeLead(
  crmUrl: string,
  body: IntakeLeadBody,
  fetchImpl: typeof fetch = fetch,
): Promise<PostLeadResult> {
  const endpoint = `${crmUrl.replace(/\/$/, '')}${INTAKE_PATH}`;
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return { ok: false, error: 'The detailer CRM could not be reached. The quote request was not created.' };
  }

  let payload: { success?: boolean; error?: string; lead?: { id?: string } } | null = null;
  try {
    payload = (await res.json()) as { success?: boolean; error?: string; lead?: { id?: string } };
  } catch {
    payload = null;
  }
  const leadId = payload?.lead?.id;
  if (!res.ok || !payload?.success || !leadId) {
    const raw = typeof payload?.error === 'string' ? payload.error : '';
    if (/foreign key|detailer_id/i.test(raw)) {
      return { ok: false, error: 'That detailer is not accepting quote requests in the CRM right now.' };
    }
    if (/invalid action/i.test(raw)) {
      return { ok: false, error: 'The CRM rejected the quote request as incomplete. It was not created.' };
    }
    return { ok: false, error: 'The CRM did not confirm the quote request. It was not recorded as created.' };
  }
  return { ok: true, leadId: String(leadId) };
}
