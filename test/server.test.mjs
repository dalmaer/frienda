import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSignerEmails, hasEmailSetup, SIGNERS, tokenHash } from '../server.mjs';

const emails = Object.fromEntries(SIGNERS.map(({ id }) => [id, `${id}@example.test`]));
const env = {
  ADMIN_TOKEN: 'test-admin-secret',
  SIGNER_EMAILS_JSON: JSON.stringify(emails),
  RESEND_API_KEY: 'test-mail-key',
  FROM_EMAIL: 'FrieNDA <pledges@example.test>',
  PUBLIC_URL: 'https://frienda.example.test',
};

test('email invitations require all six addresses and provider credentials', () => {
  assert.equal(hasEmailSetup(env), true);
  assert.equal(hasEmailSetup({ ...env, SIGNER_EMAILS_JSON: JSON.stringify({ dion: emails.dion }) }), false);
  assert.equal(hasEmailSetup({ ...env, RESEND_API_KEY: '' }), false);
  assert.deepEqual(parseSignerEmails(env.SIGNER_EMAILS_JSON), emails);
});

test('the group contains the six requested signers and complete surnames', async () => {
  assert.deepEqual(SIGNERS.map(({ name }) => name), [
    'Dion Almaer', 'Emily Almaer', 'Ivan Dufresne Lee',
    'Amanda Dufresne Lee', 'Juan Batlle', 'Kathy Batlle',
  ]);
  const manuscript = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const name of ['Juan and Kathy Batlle', 'Ivan and Amanda Dufresne Lee', 'Dion and Emily Almaer']) {
    assert.ok(manuscript.includes(name));
  }
  assert.match(manuscript, /NO ACTUAL BLOOD WAS DRAWN/);
});

test('email tokens are stored as one-way SHA-256 hashes', () => {
  const token = 'a-private-random-link-token';
  assert.equal(tokenHash(token), '7362ee084442678a1fb181d85314fd84707936457e5912ad12492bce41547d3a');
  assert.notEqual(tokenHash(token), token);
});
