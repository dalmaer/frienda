import { createServer as httpCreateServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const SIGNERS = [
  { id: 'dion', name: 'Dion Almaer', group: 'Dion and Emily Almaer' },
  { id: 'emily', name: 'Emily Almaer', group: 'Dion and Emily Almaer' },
  { id: 'ivan', name: 'Ivan Dufresne Lee', group: 'Ivan and Amanda Dufresne Lee' },
  { id: 'amanda', name: 'Amanda Dufresne Lee', group: 'Ivan and Amanda Dufresne Lee' },
  { id: 'juan', name: 'Juan Batlle', group: 'Juan and Kathy Batlle' },
  { id: 'kathy', name: 'Kathy Batlle', group: 'Juan and Kathy Batlle' },
];
const MAX_BODY = 24_000;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const mailRateLimit = new Map();

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function signerFor(id) {
  return SIGNERS.find((signer) => signer.id === id);
}

function parseSignerEmails(value = process.env.SIGNER_EMAILS_JSON || '{}') {
  try {
    const parsed = JSON.parse(value);
    return Object.fromEntries(SIGNERS
      .filter(({ id }) => typeof parsed[id] === 'string' && parsed[id].includes('@'))
      .map(({ id }) => [id, parsed[id].trim()]));
  } catch {
    return {};
  }
}

function defaultState() {
  return { signatures: {}, invites: {} };
}

function createStateStore(directory) {
  const stateFile = path.join(directory, 'signatures.json');
  let queue = Promise.resolve();

  async function read() {
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf8'));
      return {
        signatures: state.signatures && typeof state.signatures === 'object' ? state.signatures : {},
        invites: state.invites && typeof state.invites === 'object' ? state.invites : {},
      };
    } catch (error) {
      if (error.code === 'ENOENT') return defaultState();
      throw error;
    }
  }

  function update(mutator) {
    const next = queue.then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const state = await read();
      const result = await mutator(state);
      const temp = `${stateFile}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, stateFile);
      return result;
    });
    queue = next.catch(() => {});
    return next;
  }

  return { read, update };
}

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
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function html(response, content) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(content);
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function hasEmailSetup(env = process.env) {
  return Boolean(
    env.ADMIN_TOKEN
    && env.RESEND_API_KEY
    && env.FROM_EMAIL
    && env.PUBLIC_URL
    && Object.keys(parseSignerEmails(env.SIGNER_EMAILS_JSON)).length === SIGNERS.length,
  );
}

async function sendEmail({ to, subject, html: body }, env) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html: body }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email provider returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

function publicSignatures(state) {
  return SIGNERS.map((signer) => {
    const saved = state.signatures[signer.id];
    return {
      id: signer.id,
      name: signer.name,
      group: signer.group,
      signed: Boolean(saved),
      method: saved?.method ?? null,
      signedAt: saved?.signedAt ?? null,
    };
  });
}

export function createServer({ dataDir = path.join(ROOT, '.data'), env = process.env, sendMail = sendEmail } = {}) {
  const store = createStateStore(dataDir);
  const configuredEnv = env;
  const server = httpCreateServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const state = await store.read();
        return json(response, 200, { signers: publicSignatures(state), emailEnabled: hasEmailSetup(configuredEnv) });
      }

      if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (!sameOrigin(request)) return json(response, 403, { error: 'Cross-site requests are not accepted.' });
        const body = await readJson(request);

        if (url.pathname === '/api/manual-sign') {
          const signer = signerFor(body.signerId);
          const strokes = body.strokes;
          if (!signer || body.accepted !== true) return json(response, 400, { error: 'Pick a signer and affirm the pledge first.' });
          if (!Array.isArray(strokes) || strokes.length > 30 || strokes.some((stroke) => !Array.isArray(stroke) || stroke.length < 2 || stroke.length > 400 || stroke.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((number) => !Number.isFinite(number) || number < 0 || number > 1)))) {
            return json(response, 400, { error: 'Add a valid signature mark.' });
          }
          const saved = await store.update((state) => {
            if (state.signatures[signer.id]) return false;
            state.signatures[signer.id] = { method: 'handwritten', signedAt: new Date().toISOString(), strokes };
            return true;
          });
          if (!saved) return json(response, 409, { error: 'This signer has already signed.' });
          const state = await store.read();
          return json(response, 201, { signers: publicSignatures(state) });
        }

        if (url.pathname === '/api/email-sign') {
          if (typeof body.token !== 'string' || body.token.length < 40 || body.accepted !== true) return json(response, 400, { error: 'Open your personal signing link and affirm the pledge.' });
          const hash = tokenHash(body.token);
          const result = await store.update((state) => {
            const invite = state.invites[hash];
            const signer = invite && signerFor(invite.signerId);
            if (!invite || !signer || invite.usedAt || Date.parse(invite.expiresAt) < Date.now() || state.signatures[signer.id]) return null;
            invite.usedAt = new Date().toISOString();
            state.signatures[signer.id] = { method: 'email-link', signedAt: invite.usedAt, strokes: [] };
            return signer.id;
          });
          if (!result) return json(response, 410, { error: 'That link is expired, already used, or the pledge is already signed.' });
          const state = await store.read();
          return json(response, 201, { signers: publicSignatures(state) });
        }

        if (url.pathname === '/api/admin/invite') {
          const expected = configuredEnv.ADMIN_TOKEN;
          const provided = request.headers.authorization?.replace(/^Bearer\s+/i, '');
          if (!safeEqual(expected, provided)) return json(response, 401, { error: 'Admin token is missing or incorrect.' });
          const signer = signerFor(body.signerId);
          const email = parseSignerEmails(configuredEnv.SIGNER_EMAILS_JSON)[body.signerId];
          if (!hasEmailSetup(configuredEnv) || !email) return json(response, 503, { error: 'Email invitations are not configured.' });
          if (!signer) return json(response, 400, { error: 'Choose a group signer.' });

          const now = Date.now();
          const previous = mailRateLimit.get(signer.id) ?? 0;
          if (now - previous < 60_000) return json(response, 429, { error: 'Give that invite a minute before sending another.' });
          const state = await store.read();
          if (state.signatures[signer.id]) return json(response, 409, { error: 'This signer has already signed.' });
          const token = randomBytes(32).toString('base64url');
          const hash = tokenHash(token);
          const expiresAt = new Date(now + TOKEN_TTL_MS).toISOString();
          const baseUrl = configuredEnv.PUBLIC_URL.replace(/\/$/, '');
          const link = `${baseUrl}/?signer=${encodeURIComponent(signer.id)}&token=${encodeURIComponent(token)}`;
          try {
            await store.update((current) => {
              current.invites[hash] = { signerId: signer.id, createdAt: new Date(now).toISOString(), expiresAt, usedAt: null };
            });
            await sendMail({
              to: email,
              subject: 'A tiny, dramatic FrieNDA pledge awaits',
              html: `<p>Hi ${signer.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;')},</p><p>Your friends have a tiny, non-legal pledge about keeping group stories in the group.</p><p><a href="${link}">Read it and sign your personal FrieNDA link</a></p><p>This one-time link expires in seven days. If you did not expect it, ignore this email.</p>`,
            }, configuredEnv);
            mailRateLimit.set(signer.id, now);
            return json(response, 202, { message: `A personal link was sent to ${signer.name}.` });
          } catch (error) {
            await store.update((current) => { delete current.invites[hash]; });
            console.error('Invite delivery failed:', error.message);
            return json(response, 502, { error: 'The email provider did not accept the invite.' });
          }
        }
        return json(response, 404, { error: 'Not found.' });
      }

      if (request.method === 'GET') {
        const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!['index.html', 'app.js', 'styles.css'].includes(asset)) return json(response, 404, { error: 'Not found.' });
        const types = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'styles.css': 'text/css; charset=utf-8' };
        response.writeHead(200, { 'Content-Type': types[asset], ...(asset === 'index.html' ? { 'Cache-Control': 'no-store' } : {}) });
        response.end(await readFile(path.join(PUBLIC, asset)));
        return;
      }

      return json(response, 404, { error: 'Not found.' });
    } catch (error) {
      console.error('Request failed:', error.message);
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Try again.' });
      else response.destroy();
    }
  });
  return server;
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
