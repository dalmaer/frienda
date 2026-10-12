import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SIGNERS = [
  { id: 'dion', name: 'Dion Almaer', group: 'Dion and Emily Almaer' },
  { id: 'emily', name: 'Emily Almaer', group: 'Dion and Emily Almaer' },
  { id: 'ivan', name: 'Ivan Dufresne Lee', group: 'Ivan and Amanda Dufresne Lee' },
  { id: 'amanda', name: 'Amanda Dufresne Lee', group: 'Ivan and Amanda Dufresne Lee' },
  { id: 'juan', name: 'Juan Batlle', group: 'Juan and Kathy Batlle' },
  { id: 'kathy', name: 'Kathy Batlle', group: 'Juan and Kathy Batlle' },
];

export const MAX_BODY = 24_000;
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createInviteToken() {
  return randomBytes(32).toString('base64url');
}

export function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseSignerEmails(value = process.env.SIGNER_EMAILS_JSON || '{}') {
  try {
    const parsed = JSON.parse(value);
    return Object.fromEntries(SIGNERS
      .filter(({ id }) => typeof parsed[id] === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed[id].trim()))
      .map(({ id }) => [id, parsed[id].trim()]));
  } catch {
    return {};
  }
}

export function hasEmailSetup(env = process.env) {
  return Boolean(
    env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 24
    && env.RESEND_API_KEY
    && env.FROM_EMAIL
    && env.PUBLIC_URL
    && Object.keys(parseSignerEmails(env.SIGNER_EMAILS_JSON)).length === SIGNERS.length,
  );
}

export function validStrokes(strokes) {
  return Array.isArray(strokes)
    && strokes.length > 0
    && strokes.length <= 30
    && strokes.every((stroke) => Array.isArray(stroke)
      && stroke.length >= 2
      && stroke.length <= 400
      && stroke.every((point) => Array.isArray(point)
        && point.length === 2
        && point.every((number) => Number.isFinite(number) && number >= 0 && number <= 1)));
}

export function publicSigners(rows) {
  return SIGNERS.map((signer) => {
    const saved = rows.find((row) => row.id === signer.id);
    return {
      id: signer.id,
      name: signer.name,
      group: signer.group,
      signed: Boolean(saved?.signedAt),
      method: saved?.method ?? null,
      signedAt: saved?.signedAt ?? null,
    };
  });
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
