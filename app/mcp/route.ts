import { createProductionMcpHandler } from '@/lib/mcp/production';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const handle = createProductionMcpHandler();

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 80);
  const realIp = req.headers.get('x-real-ip');
  return (realIp || 'unknown').slice(0, 80);
}

async function respond(req: Request): Promise<Response> {
  const body = req.method === 'POST' ? await req.text() : '';
  const result = await handle({
    method: req.method,
    headers: {
      accept: req.headers.get('accept'),
      authorization: req.headers.get('authorization'),
      origin: req.headers.get('origin'),
    },
    body,
    ip: clientIp(req),
  });
  return new Response(result.body, { status: result.status, headers: result.headers });
}

export function GET(req: Request) {
  return respond(req);
}

export function POST(req: Request) {
  return respond(req);
}

export function DELETE(req: Request) {
  return respond(req);
}

export function OPTIONS(req: Request) {
  return respond(req);
}
