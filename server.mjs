import { createServer as httpCreateServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFileStore } from './lib/file-store.mjs';
import { handleApi, sendResendEmail } from './lib/api.mjs';
import { hasEmailSetup, parseSignerEmails, SIGNERS, tokenHash } from './lib/domain.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MAX_BODY = 24_000;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Send valid JSON.'), { status: 400 });
  }
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

export function createServer({ dataDir = path.join(ROOT, '.data'), env = process.env, sendMail = sendResendEmail } = {}) {
  const store = createFileStore(dataDir);
  return httpCreateServer(async (request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method.startsWith('POST') && url.pathname.startsWith('/api/')) {
        const contentType = request.headers['content-type'] || '';
        if (!contentType.toLowerCase().includes('application/json')) return json(response, 415, { error: 'Send JSON with Content-Type: application/json.' });
        const body = await readJson(request);
        const result = await handleApi({ method: request.method, pathname: url.pathname, headers: request.headers, body, env, store, sendMail });
        return json(response, result.status, result.body);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/')) {
        const result = await handleApi({ method: request.method, pathname: url.pathname, headers: request.headers, env, store });
        return json(response, result.status, result.body);
      }
      if (request.method === 'GET') {
        const assets = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/signing.css': 'signing.css', '/robots.txt': 'robots.txt' };
        for (const { id } of SIGNERS) assets[`/photos/${id}.jpg`] = `photos/${id}.jpg`;
        const asset = assets[url.pathname];
        if (!asset) return json(response, 404, { error: 'Not found.' });
        const types = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'styles.css': 'text/css; charset=utf-8', 'signing.css': 'text/css; charset=utf-8', 'robots.txt': 'text/plain; charset=utf-8' };
        response.writeHead(200, { 'Content-Type': types[asset] || 'image/jpeg', ...(asset === 'index.html' ? { 'Cache-Control': 'no-store' } : {}) });
        response.end(await readFile(path.join(PUBLIC, asset)));
        return;
      }
      return json(response, 404, { error: 'Not found.' });
    } catch (error) {
      if (!response.headersSent) {
        const status = error.status || (error.database ? 503 : 500);
        json(response, status, { error: error.status ? error.message : 'Something went wrong. Try again.' });
      } else response.destroy();
    }
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const server = createServer();
  const port = Number(process.env.PORT || 4317);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`FrieNDA is listening at http://${host}:${port}`);
    if (!hasEmailSetup(process.env)) console.log('Email-link signing is off; configure the documented .env values to enable it.');
  });
}

export { SIGNERS, hasEmailSetup, parseSignerEmails, tokenHash };
