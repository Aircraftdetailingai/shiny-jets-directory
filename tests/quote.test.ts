import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INTAKE_BODY_KEYS,
  INTAKE_PATH,
  INTAKE_SOURCE,
  QuoteDeduper,
  buildIntakeLeadBody,
  postCrmIntakeLead,
  requestQuote,
  validateQuote,
  type IntakeLeadBody,
} from '../lib/directory/quote';
import { createRateLimiter } from '../lib/rate-limit';

const valid = {
  slug: 'Shiny-Jets',
  aircraft: 'Cessna 172',
  airport: 'kteb',
  preferred_dates: 'Oct 20-22',
  service: 'Ceramic coating',
  contact_name: 'Ada Lovelace',
  email: 'Ada@Example.com',
  phone: '(555) 555-0100',
  notes: 'Hangar 3',
};

function deps(postLead: (body: IntakeLeadBody) => Promise<{ ok: true; leadId: string } | { ok: false; error: string }>) {
  return {
    findDetailer: async (slug: string) => (slug === 'shiny-jets' ? { id: 'detailer-1', company: 'Shiny Jets', slug } : null),
    postLead,
    limitEmail: createRateLimiter({ limit: 5, windowMs: 60_000 }),
    limitIp: createRateLimiter({ limit: 20, windowMs: 60_000 }),
    deduper: new QuoteDeduper(10 * 60 * 1000),
    now: () => 1_700_000_000_000,
  };
}

test('validation rejects a bad email and does not require a price', () => {
  const bad = validateQuote({ ...valid, email: 'not-an-email' });
  assert.equal(bad.ok, false);
  const missing = validateQuote({ slug: 'shiny-jets' });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.match(missing.error, /email/);
  assert.equal(missing.error.toLowerCase().includes('price'), false);
});

test('the CRM body matches the public request form', () => {
  const parsed = validateQuote(valid);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const body = buildIntakeLeadBody('detailer-1', parsed.value);
  assert.deepEqual(Object.keys(body).sort(), [...INTAKE_BODY_KEYS].sort());
  assert.equal(body.source, INTAKE_SOURCE);
  assert.equal(body.detailer_id, 'detailer-1');
  assert.equal(body.name, 'Ada Lovelace');
  assert.equal(body.email, 'ada@example.com');
  assert.equal(body.airport, 'KTEB');
  assert.equal(body.aircraft_model, 'Cessna 172');
  assert.equal(body.services_requested, 'Ceramic coating');
  assert.equal(body.company, null);
  assert.equal(body.tail_number, null);
  assert.equal(body.photo_urls, null);
  assert.match(body.notes, /Preferred dates: Oct 20-22/);
  assert.match(body.notes, /Meta Muse/);
  assert.equal(body.intake_responses.Service, 'Ceramic coating');
  assert.equal('price' in body, false);
});

test('request_quote posts once and treats an immediate retry as the same lead', async () => {
  const bodies: IntakeLeadBody[] = [];
  const resultDeps = deps(async (body) => {
    bodies.push(body);
    return { ok: true, leadId: 'lead-1' };
  });
  const first = await requestQuote(valid, { ip: '203.0.113.4' }, resultDeps);
  const second = await requestQuote(valid, { ip: '203.0.113.4' }, resultDeps);
  assert.equal(first.ok && first.data.lead_id, 'lead-1');
  assert.equal(first.ok && first.data.duplicate, false);
  assert.equal(first.ok && first.data.status, 'requested');
  assert.equal(second.ok && second.data.duplicate, true);
  assert.equal(second.ok && second.data.lead_id, 'lead-1');
  assert.equal(bodies.length, 1);
  assert.equal(JSON.stringify(first.ok ? first.data : {}).includes('$'), false);
});

test('a CRM rejection is not reported as a created quote', async () => {
  const result = await requestQuote(
    { ...valid, aircraft: 'King Air 350' },
    { ip: '203.0.113.5' },
    deps(async () => ({ ok: false, error: 'The CRM did not confirm the quote request. It was not recorded as created.' })),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /not recorded as created/);
});

test('rate limit blocks repeated emails before the CRM is called', async () => {
  let calls = 0;
  const limited = deps(async () => {
    calls += 1;
    return { ok: true, leadId: `lead-${calls}` };
  });
  limited.limitEmail = createRateLimiter({ limit: 2, windowMs: 60_000 });
  const one = await requestQuote(valid, { ip: '198.51.100.2' }, limited);
  const two = await requestQuote({ ...valid, aircraft: 'Pilatus PC-12' }, { ip: '198.51.100.2' }, limited);
  const three = await requestQuote({ ...valid, aircraft: 'Citation X' }, { ip: '198.51.100.2' }, limited);
  assert.equal(one.ok, true);
  assert.equal(two.ok, true);
  assert.equal(three.ok, false);
  if (three.ok) return;
  assert.ok(three.retry_after_seconds && three.retry_after_seconds > 0);
  assert.equal(calls, 2);
});

test('unknown slugs are rejected', async () => {
  const result = await requestQuote({ ...valid, slug: 'not-a-detailer' }, { ip: '198.51.100.3' }, deps(async () => ({ ok: true, leadId: 'x' })));
  assert.equal(result.ok, false);
});

test('postCrmIntakeLead uses the public lead intake endpoint and ignores prices in the response', async () => {
  const parsed = validateQuote(valid);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const seen: { url: string; init: RequestInit } = { url: '', init: {} };
  const result = await postCrmIntakeLead('https://crm.shinyjets.com/', buildIntakeLeadBody('detailer-1', parsed.value), async (url, init) => {
    seen.url = String(url);
    seen.init = init || {};
    return new Response(JSON.stringify({ success: true, lead: { id: 'lead-9', price: 480 } }), { status: 200 });
  });
  assert.equal(seen.url, `https://crm.shinyjets.com${INTAKE_PATH}`);
  assert.equal((seen.init.method || '').toUpperCase(), 'POST');
  assert.equal(result.ok && result.leadId, 'lead-9');
  assert.equal(JSON.stringify(result).includes('480'), false);
});
