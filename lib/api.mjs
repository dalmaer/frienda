import {
  SIGNERS, TOKEN_TTL_MS, createInviteToken, escapeHtml, hasEmailSetup,
  parseSignerEmails, publicSigners, safeEqual, tokenHash, validStrokes,
} from './domain.mjs';

export async function sendResendEmail({ to, subject, html }, env, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
}

function getHeader(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name) || '';
  const key = Object.keys(headers || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? value[0] : value || '';
}

function sameOrigin(headers) {
  const origin = getHeader(headers, 'origin');
  if (!origin) return true;
  const host = getHeader(headers, 'host') || getHeader(headers, 'x-forwarded-host');
  try {
    const actual = new URL(origin);
    return Boolean(host) && actual.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function result(status, body) {
  return { status, body };
}

export async function handleApi({ method, pathname, headers, body, env = process.env, store, sendMail = sendResendEmail, now = Date.now() }) {
  if (method === 'GET' && pathname === '/api/state') {
    const signers = await store.getSigners();
    return result(200, { signers: publicSigners(signers), emailEnabled: hasEmailSetup(env) });
  }
  if (method !== 'POST' || !pathname.startsWith('/api/')) return result(404, { error: 'Not found.' });
  if (!sameOrigin(headers)) return result(403, { error: 'Cross-site requests are not accepted.' });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return result(400, { error: 'Send a JSON object.' });

  if (pathname === '/api/email-sign') {
    if (typeof body.token !== 'string' || body.token.length < 40 || body.token.length > 100 || body.accepted !== true || !validStrokes(body.strokes)) {
      return result(400, { error: 'Open your personal signing link, affirm the pledge, and add a valid signature mark.' });
    }
    const signed = await store.confirmInvite({ hash: tokenHash(body.token), strokes: body.strokes, now });
    if (!signed) return result(410, { error: 'That link is expired, already used, or the pledge is already signed.' });
    const signers = await store.getSigners();
    return result(201, { signers: publicSigners(signers) });
  }

  if (pathname === '/api/admin/invite') {
    const provided = getHeader(headers, 'authorization').replace(/^Bearer\s+/i, '');
    if (!safeEqual(env.ADMIN_TOKEN, provided)) return result(401, { error: 'Organizer token is missing or incorrect.' });
    if (!hasEmailSetup(env)) return result(503, { error: 'Email invitations are not configured.' });
    const signer = SIGNERS.find(({ id }) => id === body.signerId);
    const email = parseSignerEmails(env.SIGNER_EMAILS_JSON)[body.signerId];
    if (!signer || !email) return result(400, { error: 'Choose a group signer.' });

    let baseUrl;
    try {
      baseUrl = new URL(env.PUBLIC_URL);
      if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(baseUrl.hostname)) throw new Error();
      if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) throw new Error();
    } catch {
      return result(503, { error: 'PUBLIC_URL must be a site origin using HTTPS.' });
    }

    const token = createInviteToken();
    const hash = tokenHash(token);
    const expiresAt = new Date(now + TOKEN_TTL_MS).toISOString();
    const issued = await store.issueInvite({ signerId: signer.id, hash, expiresAt, now });
    if (issued === 'signed') return result(409, { error: 'This signer has already signed.' });
    if (issued === 'rate-limited') return result(429, { error: 'Give that invite a minute before sending another.' });
    if (issued !== 'created') return result(429, { error: 'This signer has already signed or a link was sent recently.' });

    const link = `${baseUrl.origin}/#signer=${encodeURIComponent(signer.id)}&token=${encodeURIComponent(token)}`;
    try {
      await sendMail({
        to: email,
        subject: 'A tiny, dramatic FrieNDA pledge awaits',
        html: `<p>Hi ${escapeHtml(signer.name)},</p><p>Your friends have a tiny, non-legal pledge about keeping group stories in the group.</p><p><a href="${link}">Read it and sign your personal FrieNDA link</a></p><p>This one-time link expires in seven days. If you did not expect it, ignore this email.</p>`,
      }, env);
      return result(202, { message: `A personal link was sent to ${signer.name}.` });
    } catch {
      return result(502, { error: 'The email provider did not accept the invite. The invite cooldown will clear in one minute.' });
    }
  }

  return result(404, { error: 'Not found.' });
}
