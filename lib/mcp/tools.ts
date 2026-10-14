// Tool definitions for the Shiny Jets Muse connector.
// Read tools do not change data. request_quote is a sensitive write: it
// creates a CRM lead and discloses the customer's contact details to that
// detailer. It does not take payment or confirm a booking.

export const SERVER_NAME = 'shiny-jets-directory';
export const SERVER_VERSION = '1.0.0';

export const SERVER_INSTRUCTIONS =
  'Search the Shiny Jets directory for aircraft detailers and, when the user asks, submit a quote request to one detailer. Rank and describe results only from tool data. Paid plans do not change rank and sponsored is false unless a result says otherwise. Never invent or infer a price, fee, or estimate. A quote request status of requested means the lead was created in that detailer\'s CRM; it is not a confirmed booking.';

const searchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    location: {
      type: 'string',
      description: 'Airport code (KTEB, TEB, LAS) or place name (Teterboro, Van Nuys, Las Vegas).',
    },
    service: {
      type: 'string',
      description: 'Optional service to match, such as ceramic coating or maintenance wash.',
    },
    radius_miles: {
      type: 'number',
      minimum: 1,
      maximum: 500,
      description: 'Search radius in miles. Default 100. Detailers who list the resolved airport are included even when farther.',
    },
  },
  required: ['location'],
} as const;

const getSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slug: {
      type: 'string',
      description: 'Detailer slug returned by search_detailers.',
    },
  },
  required: ['slug'],
} as const;

const quoteSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slug: { type: 'string', description: 'Detailer slug from search_detailers.' },
    aircraft: { type: 'string', description: 'Aircraft make and model, such as Cessna 172 or Gulfstream G650.' },
    airport: { type: 'string', description: 'Airport where the aircraft will be detailed.' },
    preferred_dates: { type: 'string', description: 'Preferred date or date range, in the customer\'s words.' },
    service: { type: 'string', description: 'Service the customer wants quoted.' },
    contact_name: { type: 'string', description: 'Customer name the detailer should reply to.' },
    email: { type: 'string', description: 'Customer email the detailer should reply to.' },
    phone: { type: 'string', description: 'Customer phone the detailer should reply to.' },
    notes: { type: 'string', description: 'Optional notes for the detailer. Do not include a price.' },
  },
  required: ['slug', 'aircraft', 'airport', 'preferred_dates', 'service', 'contact_name', 'email', 'phone'],
} as const;

export const TOOLS = [
  {
    name: 'search_detailers',
    title: 'Search detailers',
    classification: 'read',
    sensitive: false,
    description:
      'Read. Search the Shiny Jets aircraft-detailer directory by airport code or place name. Optional service name and radius in miles. Returns matching businesses with airports, distance, services, certifications, insurance and finish verification, ratings, and plan. Order is factual: detailers who serve the resolved airport, then shorter distance, then higher rating, then more reviews, then name. Paid plans do not change the order. Every result has sponsored set to false. Does not return prices. Does not create a quote.',
    inputSchema: searchSchema,
    annotations: {
      title: 'Search detailers',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'get_detailer',
    title: 'Get detailer',
    classification: 'read',
    sensitive: false,
    description:
      'Read. Get one listed Shiny Jets directory detailer by slug, including public profile fields: description, airports, services, certifications, verification, ratings, phone, and website when the public profile has them. Does not return prices. Does not create a quote.',
    inputSchema: getSchema,
    annotations: {
      title: 'Get detailer',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'request_quote',
    title: 'Request a quote',
    classification: 'write',
    sensitive: true,
    description:
      'Sensitive write. Create a quote request in one detailer\'s Shiny Jets CRM, the same public intake record as the Request Quote form on their directory profile. Required: slug, aircraft make and model, airport, preferred dates, service, contact name, email, and phone. Optional notes. Sends those contact details only to that detailer. Result status requested means the lead was created. It is not a confirmed booking and not a price. Do not send the customer to the website to finish this request. Do not call again for the same request after a lead id is returned.',
    inputSchema: quoteSchema,
    annotations: {
      title: 'Request a quote',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]['name'];
