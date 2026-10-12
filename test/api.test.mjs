import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleApi } from '../lib/api.mjs';
import { createFileStore } from '../lib/file-store.mjs';
import { SIGNERS, tokenHash } from '../lib/domain.mjs';
import { createSupabaseStore } from '../lib/supabase-store.mjs';

const env = {
  ADMIN_TOKEN: 'test-admin-secret-that-is-long-enough',
  SIGNER_EMAILS_JSON: JSON.stringify(Object.fromEntries(SIGNERS.map(({ id }) => [id, `${id}@example.test`]))),
  RESEND_API_KEY: 'test-mail-key',
  FROM_EMAIL: 'FrieNDA <pledges@example.test>',
  PUBLIC_URL: 'https://frienda.example.test',
};
const headers = { host: 'frienda.example.test', origin: 'https://frienda.example.test' };
const strokes = [[[0.1, 0.2], [0.2, 0.3], [0.3, 0.4]]];

function fakeStore() {
  const signatures = new Map();
  const invites = new Map();
  const lastInvitedAt = new Map();
  return {
    signatures,
    invites,
    async getSigners() {
      return [...signatures.entries()].map(([id, signature]) => ({ id, ...signature }));
    },
    async issueInvite({ signerId, hash, expiresAt, now }) {
      if (signatures.has(signerId)) return 'signed';
      if (now - (lastInvitedAt.get(signerId) || 0) < 60_000) return 'rate-limited';
      lastInvitedAt.set(signerId, now);
      invites.set(hash, { signerId, expiresAt, usedAt: null });
      return 'created';
    },
    async confirmInvite({ hash, strokes: mark, now }) {
      const invite = invites.get(hash);
      if (!invite || invite.usedAt || Date.parse(invite.expiresAt) <= now || signatures.has(invite.signerId)) return false;
      invite.usedAt = new Date(now).toISOString();
      signatures.set(invite.signerId, { signedAt: invite.usedAt, method: 'email-link', strokes: mark });
      return true;
    },
  };
}

test('anonymous signing routes are gone and public state exposes no private invite data', async () => {
  const store = fakeStore();
  const manual = await handleApi({ method: 'POST', pathname: '/api/manual-sign', headers, body: { signerId: 'dion', accepted: true, strokes }, env, store });
  assert.equal(manual.status, 404);
  const state = await handleApi({ method: 'GET', pathname: '/api/state', headers, env, store });
  assert.equal(state.status, 200);
  assert.equal(state.body.signers.length, 6);
  assert.equal(state.body.signers[0].signed, false);
  assert.equal(JSON.stringify(state.body).includes('example.test'), false);
  assert.equal(JSON.stringify(state.body).includes('token'), false);
});

test('personal invites store only a token hash and a link can be used once', async () => {
  const store = fakeStore();
  let sent;
  const invite = await handleApi({
    method: 'POST', pathname: '/api/admin/invite', headers: { ...headers, authorization: `Bearer ${env.ADMIN_TOKEN}` },
    body: { signerId: 'dion' }, env, store, now: 1_800_000_000_000,
    sendMail: async (message) => { sent = message; },
  });
  assert.equal(invite.status, 202);
  assert.equal(sent.to, 'dion@example.test');
  const link = sent.html.match(/href="([^"]+)"/)[1];
  const url = new URL(link);
  assert.equal(url.search, '');
  const params = new URLSearchParams(url.hash.slice(1));
  const token = params.get('token');
  assert.ok(token);
  assert.equal(store.invites.has(token), false);
  assert.equal(store.invites.has(tokenHash(token)), true);

  const sign = await handleApi({
    method: 'POST', pathname: '/api/email-sign', headers,
    body: { token, accepted: true, strokes }, env, store, now: 1_800_000_000_100,
  });
  assert.equal(sign.status, 201);
  const publicDion = sign.body.signers.find(({ id }) => id === 'dion');
  assert.equal(publicDion.signed, true);
  assert.equal(Object.hasOwn(publicDion, 'signaturePoints'), false);
  assert.equal(Object.hasOwn(publicDion, 'strokes'), false);
  assert.equal(store.signatures.get('dion').method, 'email-link');
  assert.deepEqual(store.signatures.get('dion').strokes, strokes);

  const replay = await handleApi({
    method: 'POST', pathname: '/api/email-sign', headers,
    body: { token, accepted: true, strokes }, env, store, now: 1_800_000_000_200,
  });
  assert.equal(replay.status, 410);
});

test('invite rate limits and invite confirmation rejects invalid assent or cross-origin calls', async () => {
  const store = fakeStore();
  const sendMail = async () => {};
  const first = await handleApi({ method: 'POST', pathname: '/api/admin/invite', headers: { ...headers, authorization: `Bearer ${env.ADMIN_TOKEN}` }, body: { signerId: 'emily' }, env, store, sendMail, now: 1_800_000_000_000 });
  assert.equal(first.status, 202);
  const second = await handleApi({ method: 'POST', pathname: '/api/admin/invite', headers: { ...headers, authorization: `Bearer ${env.ADMIN_TOKEN}` }, body: { signerId: 'emily' }, env, store, sendMail, now: 1_800_000_000_500 });
  assert.equal(second.status, 429);
  const crossOrigin = await handleApi({ method: 'POST', pathname: '/api/email-sign', headers: { ...headers, origin: 'https://attacker.example' }, body: { token: 'x'.repeat(43), accepted: true, strokes }, env, store });
  assert.equal(crossOrigin.status, 403);
  const invalid = await handleApi({ method: 'POST', pathname: '/api/email-sign', headers, body: { token: 'x'.repeat(43), accepted: true, strokes: [] }, env, store });
  assert.equal(invalid.status, 400);
});

test('email send failure does not disclose provider details or raw invite token', async () => {
  const store = fakeStore();
  const response = await handleApi({
    method: 'POST', pathname: '/api/admin/invite', headers: { ...headers, authorization: `Bearer ${env.ADMIN_TOKEN}` },
    body: { signerId: 'juan' }, env, store, now: 1_800_000_000_000,
    sendMail: async () => { throw new Error('secret provider response'); },
  });
  assert.equal(response.status, 502);
  assert.equal(JSON.stringify(response.body).includes('secret provider response'), false);
  const storedHash = [...store.invites.keys()][0];
  assert.match(storedHash, /^[a-f0-9]{64}$/);
});

test('Supabase adapter uses the server-only API key header and the atomic database functions', async () => {
  const requests = [];
  const store = createSupabaseStore({ SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'sb_secret_test' }, async (url, options) => {
    requests.push({ url, options });
    if (url.includes('signers?')) return new Response(JSON.stringify([{ id: 'dion', signed_at: null, method: null }]), { status: 200 });
    if (url.includes('issue_signing_invite')) return new Response('"created"', { status: 200 });
    if (url.includes('confirm_email_signing')) return new Response('"dion"', { status: 200 });
    throw new Error('Unexpected Supabase request.');
  });
  assert.deepEqual(await store.getSigners(), [{ id: 'dion', signedAt: null, method: null }]);
  assert.equal(await store.issueInvite({ signerId: 'dion', hash: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' }), 'created');
  assert.equal(await store.confirmInvite({ hash: 'a'.repeat(64), strokes }), true);
  assert.equal(requests.length, 3);
  for (const { options } of requests) {
    assert.equal(options.headers.apikey, 'sb_secret_test');
    assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
  }
  assert.match(requests[1].url, /rpc\/issue_signing_invite$/);
  assert.match(requests[2].url, /rpc\/confirm_email_signing$/);
});

test('local store persists a single-use invite and serializes duplicate sign attempts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'frienda-test-'));
  try {
    const store = createFileStore(directory);
    const now = 1_800_000_000_000;
    const invite = { signerId: 'kathy', hash: 'b'.repeat(64), expiresAt: new Date(now + 60_000).toISOString(), now };
    assert.equal(await store.issueInvite(invite), 'created');
    assert.equal(await store.issueInvite({ ...invite, hash: 'c'.repeat(64), now: now + 500 }), 'rate-limited');
    const results = await Promise.all([
      store.confirmInvite({ hash: invite.hash, strokes, now: now + 1_000 }),
      store.confirmInvite({ hash: invite.hash, strokes, now: now + 1_000 }),
    ]);
    assert.deepEqual(results, [true, false]);
    assert.deepEqual(await store.getSigners(), [{ id: 'kathy', signedAt: new Date(now + 1_000).toISOString(), method: 'email-link' }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
