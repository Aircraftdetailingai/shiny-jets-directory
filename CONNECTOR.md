# Shiny Jets directory connector for Meta Muse

Remote MCP server for the Shiny Jets aircraft-detailer directory. A Muse user can ask who details aircraft near an airport and submit a quote request to one detailer without leaving Muse.

This file is the tool documentation for the Muse Connector Platform. It does not submit the connector. Brett submits it in the portal after the checklist below.

- Guidelines: https://platform.muse.ai/docs
- Connector Platform Terms: https://muse.ai/platform/terms
- Endpoint (production): `https://directory.shinyjets.com/mcp`
- Transport: stateless [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports). `POST` a single JSON-RPC message. `GET` and `DELETE` return 405 (no server-initiated session stream).
- Protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05`
- Server name: `shiny-jets-directory`

## What it does that the browser does not

The directory site can show a map and a link to `crm.shinyjets.com/request/<slug>`. Muse would still have to browse that form, retype the aircraft, and hope the page loads. This connector:

1. Resolves an airport code or place name to coordinates and airport codes.
2. Returns structured matches (airports, distance, services, certifications, verification, ratings), ranked from those facts.
3. Creates the quote request in that detailer's Shiny Jets CRM, the same `intake_leads` record the public form creates, and returns the lead id.

A list of links is not the result. `requested` means the lead exists in the CRM. It is not a confirmed booking and it is not a price.

## Authentication

Set `MUSE_CONNECTOR_TOKEN` on the directory deployment (Vercel). Every `POST /mcp` must then send:

```http
Authorization: Bearer <MUSE_CONNECTOR_TOKEN>
Accept: application/json, text/event-stream
Content-Type: application/json
```

Until that variable is set, `search_detailers` and `get_detailer` still work and `request_quote` is disabled, so a deploy cannot create leads before the token exists. Give Muse the token as the connector API key. Do not put the token in this repo.

Optional: `MUSE_ALLOWED_ORIGINS` is a comma-separated list of extra browser `Origin` values. Server-to-server calls with no `Origin` are allowed. Requests that send a different `Origin` receive HTTP 403.

`CRM_URL` (default `https://crm.shinyjets.com`) and `NEXT_PUBLIC_SITE_URL` (default `https://directory.shinyjets.com`) configure the CRM and the profile links.

## Tools

Prices are never requested and never returned. If a directory or CRM field contains a currency amount, that field is dropped. `sponsored` is `false` on every result because paid plans do not change rank. `plan` is included only because the public profile already shows membership (Member, Pro, Business, Enterprise).

| Tool | Classification | Sensitive | Side effect |
| --- | --- | --- | --- |
| `search_detailers` | Read | No | None |
| `get_detailer` | Read | No | None |
| `request_quote` | Write | Yes | Creates an `intake_leads` row in the chosen detailer's CRM and discloses the customer's name, email, and phone to that detailer. Does not charge a card, send a Muse message, or confirm a job. |

Muse's permission model asks on first use for reads. `request_quote` is a sensitive write: it should require approval on every use (`Allow once` or `Deny`). The portal's tool-annotation UI is marked "coming soon" in the guidelines; keep this table in the submission until that UI exists.

MCP annotations on the wire: reads set `readOnlyHint: true`. `request_quote` sets `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`.

### search_detailers (Read)

| Input | Required | Notes |
| --- | --- | --- |
| `location` | Yes | Airport code (`KTEB`, `TEB`, `LAS`) or place name (`Teterboro`, `Las Vegas`). |
| `service` | No | Case-insensitive substring of a service name. |
| `radius_miles` | No | 1–500, default 100. |

Resolution uses the same airport-code priority as `/api/resolve-airport` (ICAO, then GPS, then IATA, then local code). A 3-letter code also tries the `K` prefix, then the winning airport's own codes are what detailers match against.

A detailer matches when they list one of those codes (home airport, airports served, or a service location) or their coordinates fall inside the radius. Detailers who list the airport stay in the results even if they are farther than the radius.

Rank, in order:

1. Serves the resolved airport.
2. Shorter distance. Unknown distance sorts after a known distance.
3. Higher combined rating (directory reviews plus Google reviews). Missing ratings sort last.
4. More reviews.
5. Name.

`plan` is not a sort key. Output includes `rank` (the rule above), `total_matches`, and up to 15 `detailers`. Each hit has company, slug, profile URL, airports, distance, services, certifications, `insurance_verified`, `verified_finish`, rating, review count, plan, and `sponsored: false`.

Errors: unknown place, invalid radius. No write occurs.

### get_detailer (Read)

| Input | Required | Notes |
| --- | --- | --- |
| `slug` | Yes | Slug from `search_detailers`. |

Returns the listed directory row plus public profile fields the profile page already shows (description, phone, website, service blurbs). Unlisted slugs return "No listed detailer with that slug." Phone and website come from `GET {CRM}/api/detailers/profile/{slug}` and are omitted when that call fails. Insurer name and any price-like description are not returned.

### request_quote (Write, sensitive)

| Input | Required | Limits |
| --- | --- | --- |
| `slug` | Yes | Listed directory slug. |
| `aircraft` | Yes | Make and model, 2–120 characters. |
| `airport` | Yes | Where the aircraft will be, 2–80 characters. Codes are uppercased. |
| `preferred_dates` | Yes | Customer's words, 2–200 characters. |
| `service` | Yes | 1–160 characters. |
| `contact_name` | Yes | 2–120 characters. |
| `email` | Yes | Valid email, stored lowercased. |
| `phone` | Yes | 7–15 digits. |
| `notes` | No | Up to 2000 characters. |

Validation failures name the missing or invalid fields and do not call the CRM. There is no price input.

On success the tool returns:

- `status`: `requested`
- `lead_id`: CRM lead id
- `duplicate`: `true` when this same request was already created in the last 10 minutes (same slug, email, aircraft, airport, dates, and service). The CRM is not called again.
- `detailer`, `submitted`, and a message that this is not a booking and not a price

The tool does not return a CRM request URL. Muse should not send the user to the website to finish.

Rate limits (per warm server instance; the directory does not share counters across instances):

- 5 requests per email per hour
- 20 requests per IP per hour

A limited call returns `retry_after_seconds` and does not create a lead. Failed validation does not consume the limit. A CRM or network failure is an error and must not be described as a created request. The same payload can be retried after a failure; a confirmed `lead_id` should not be submitted again.

## How request_quote reaches the CRM

No CRM change is required.

The public profile button links to `https://crm.shinyjets.com/request/<slug>`. That page loads the detailer with `GET /api/detailers/resolve?slug=`, then posts the lead with:

```http
POST https://crm.shinyjets.com/api/lead-intake/leads
Content-Type: application/json
```

```json
{
  "detailer_id": "<detailer uuid>",
  "name": "<contact name>",
  "email": "<email>",
  "phone": "<phone>",
  "company": null,
  "aircraft_model": "<make and model>",
  "tail_number": null,
  "airport": "<airport>",
  "services_requested": "<service>",
  "notes": "Preferred dates: ...\nNotes: ...\nRequested via the Shiny Jets directory on Meta Muse.",
  "photo_urls": null,
  "intake_responses": {
    "Aircraft": "...",
    "Airport": "...",
    "Preferred dates": "...",
    "Service": "..."
  },
  "source": "flow_request_page"
}
```

Those are the same keys the request page sends. `source` stays `flow_request_page`, which is what the form sends, so the row shows up in that detailer's existing Requests inbox (`intake_leads`). Preferred dates are not a column on that form; they are stored in `notes` and `intake_responses`, which is where the form stores answers that are not their own columns. The last notes line marks the lead as coming from Muse.

The directory looks up `detailer_id` from the listed slug. Callers cannot pass an arbitrary id. The CRM response is reduced to the lead id. Tokens, insurer names, and prices are not copied back.

A confirmed response looks like `{ "success": true, "lead": { "id": "..." } }`. Anything else is returned to Muse as a failure.

## Data use

Ask only for the fields in the tool table.

| Data | Use | Shared with | Retention |
| --- | --- | --- | --- |
| Airport or place, optional service, radius | Find listed detailers | Nobody. Read from the directory database the public site already uses. | Not stored by the connector. Directory listings are cached in memory for about 60 seconds. |
| Slug | Load one public profile | The CRM profile endpoint, which is already public. | Not stored by the connector. |
| Name, email, phone, aircraft, airport, dates, service, notes | Create the quote request the user asked for | The one detailer's Shiny Jets CRM, as an `intake_leads` row, the same store as the website form. | The CRM keeps the lead under the detailer's existing account. This connector keeps the dedupe key and lead id in memory for 10 minutes and keeps rate-limit counters in memory for the limit window. Restarting the server drops both. |

Not done with connector data: selling it, using it for advertising or lookalike audiences, building a profile for another product, inferring sensitive traits, or training a model. The connector process does not send the payload to an ad pixel. Quote data is not written to a separate directory table.

Directory reads use the service role already configured for `/api/detailers` (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`). That key stays on the server.

If a detailer deletes a lead in the CRM, this connector cannot restore it and has no copy. A customer who wants a lead deleted asks that detailer or Shiny Jets support (`support@shinyjets.com`). There is no Muse-side login to revoke; rotating `MUSE_CONNECTOR_TOKEN` stops new Muse calls.

Security incident involving this data: email `vendor-incident@meta.com` within 48 hours, as the Connector Platform Terms require, and notify the detailer if their lead was involved.

## Errors

| Situation | HTTP | Tool result |
| --- | --- | --- |
| Malformed JSON | 400 | JSON-RPC parse error |
| Missing or wrong bearer token, when a token is configured | 401 | — |
| Disallowed `Origin` | 403 | — |
| `Accept` has neither JSON nor event stream | 406 | — |
| `GET` or `DELETE` | 405 | — |
| Unknown place, bad arguments, unknown slug | 200 | `isError: true` and an `error` string |
| Rate limit | 200 | `isError: true`, `retry_after_seconds` |
| CRM down, CRM rejection, database down | 200 | `isError: true`. The quote was not created. |
| Duplicate of a quote created in the last 10 minutes | 200 | `status: requested`, `duplicate: true`, same `lead_id` |

`notifications/initialized` returns 202 and an empty body.

## Submission checklist

Do this in the Muse Connector Platform. Nothing in this repo files the submission.

1. Deploy this directory app with `MUSE_CONNECTOR_TOKEN` set, then confirm `POST https://directory.shinyjets.com/mcp` rejects a call with no bearer token and accepts `tools/list` with the token.
2. Business verification. Submit the legal entity and evidence that the submitter can act for it. Keep the name consistent with https://shinyjets.com and https://crm.shinyjets.com. The CRM privacy policy names Vector Aviation Artificial Intelligence; the site policy names Shiny Jets LLC. Use the entity that actually operates the connector and explain the relationship if both appear.
3. Accept the Connector Platform Terms: https://muse.ai/platform/terms
4. Brand assets. Logo: `public/logos/shiny-jets-dark.png` in this repo (also used on the directory). Directory background `#0a0e1a`, accent `#0081b8`.
5. Policies and contacts.
   - Privacy: https://shinyjets.com/policies/privacy-policy and https://crm.shinyjets.com/privacy
   - Terms: https://shinyjets.com/policies/terms-of-service
   - Support: support@shinyjets.com
   - Security contact: a named person who will email vendor-incident@meta.com within 48 hours
   - Developer who will maintain the connector
6. Data-processing questionnaire. Use the table in "Data use" above. Say that connector payloads are not sold, not used for ads, and not used for model training, and that a quote is shared only with the detailer the user picked.
7. Integration. Endpoint `https://directory.shinyjets.com/mcp`, production, bearer API key as above, no OAuth scopes. Attach this file as the tool documentation (Read / Write / sensitive, inputs, side effects, statuses, errors, rate limits).
8. Test account. The directory has no end-user login. Reviewers need a dedicated detailer whose CRM inbox they can open, not a customer's inbox. Create or designate one test detailer, put representative services and an airport on it, and tell reviewers:
   - Search that airport with `search_detailers`.
   - Open it with `get_detailer`.
   - Call `request_quote` only with that slug. Each successful call creates a real lead. There is no charge to test.
   - Sign-in for the CRM inbox is the detailer's own Shiny Jets CRM login.
   Keep that account available for the whole review.
9. In the portal, mark `search_detailers` and `get_detailer` as Read, and `request_quote` as a sensitive Write, when that annotation UI is available.
10. Do not treat a link back to `crm.shinyjets.com/request/<slug>` as completing the task. The review flow is search, then `request_quote`, then the `lead_id`.
