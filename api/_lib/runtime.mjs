import { handleApi } from '../../lib/api.mjs';
import { createSupabaseStore } from '../../lib/supabase-store.mjs';

const MAX_BODY = 24_000;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

let store;

async function readJson(request) {
  if (request.body && typeof request.body === 'object' && !request.body[Symbol.asyncIterator]) {
    if (Buffer.byteLength(JSON.stringify(request.body)) > MAX_BODY) throw Object.assign(new Error('Request too large.'), { status: 413 });
    return request.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Send valid JSON.'), { status: 400 }); }
}

export async function runVercelRoute(request, response, pathname) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  response.setHeader('Cache-Control', 'no-store');
  try {
    const method = request.method || 'GET';
    let body;
    if (method === 'POST') {
      if (!(request.headers['content-type'] || '').toLowerCase().includes('application/json')) {
        response.status(415).json({ error: 'Send JSON with Content-Type: application/json.' });
        return;
      }
      body = await readJson(request);
    }
    store ||= createSupabaseStore(process.env);
    const result = await handleApi({ method, pathname, headers: request.headers, body, env: process.env, store });
    response.status(result.status).json(result.body);
  } catch (error) {
    const status = error.status || (error.database ? 503 : 500);
    response.status(status).json({ error: error.status ? error.message : 'Something went wrong. Try again.' });
  }
}
